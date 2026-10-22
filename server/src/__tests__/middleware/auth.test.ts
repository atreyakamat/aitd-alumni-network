import jwt from 'jsonwebtoken';
import { authenticate, authorize, optionalAuth, requireRole } from '../../middleware/auth';
import { AppError } from '../../middleware/errorHandler';
import { authAs, makeUser, mockReqRes, prismaMock, tokenFor } from '../../../tests/helpers';
import { generateAccessToken, generateRefreshToken, generateTwoFactorToken } from '../../utils/jwt';
import { config } from '../../config';

const withHeader = (authorization?: string) => mockReqRes({ headers: authorization ? { authorization } : {} });

describe('authenticate', () => {
  it('attaches the DB user (not token claims) and calls next()', async () => {
    const { user, header } = authAs('ADMIN');
    const { req, res, next } = withHeader(header);
    await authenticate(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(req.user).toEqual(user);
    expect(prismaMock.user.findUnique.mock.calls[0][0]).toMatchObject({ where: { id: user.id } });
    expect(prismaMock.user.findUnique.mock.calls[0][0].select.passwordHash).toBeUndefined();
  });

  it('uses the current DB role even if the token claims a higher one', async () => {
    const member = makeUser('MEMBER');
    prismaMock.user.findUnique.mockResolvedValue(member);
    const forgedClaims = jwt.sign({ userId: member.id, email: member.email, userRole: 'SUPER_ADMIN' }, config.jwt.secret);
    const { req, res, next } = withHeader(`Bearer ${forgedClaims}`);
    await authenticate(req, res, next);
    expect(req.user.userRole).toBe('MEMBER');
  });

  const expectAuthError = async (header: string | undefined, code: string) => {
    const { req, res, next } = withHeader(header);
    await authenticate(req, res, next);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ statusCode: 401, code });
    expect(req.user).toBeUndefined();
  };

  it('rejects a missing header with NO_TOKEN', () => expectAuthError(undefined, 'NO_TOKEN'));
  it('rejects a non-Bearer scheme with NO_TOKEN', () => expectAuthError('Basic abc', 'NO_TOKEN'));
  it('rejects garbage with INVALID_TOKEN', () => expectAuthError('Bearer not.a.jwt', 'INVALID_TOKEN'));
  it('rejects an empty bearer token', () => expectAuthError('Bearer ', 'INVALID_TOKEN'));

  it('rejects a token signed with another secret', () =>
    expectAuthError(`Bearer ${jwt.sign({ userId: 'x' }, 'wrong-secret')}`, 'INVALID_TOKEN'));

  it('reports an expired token as TOKEN_EXPIRED (so clients know to refresh)', () =>
    expectAuthError(
      `Bearer ${jwt.sign({ userId: 'x', exp: Math.floor(Date.now() / 1000) - 5 }, config.jwt.secret)}`,
      'TOKEN_EXPIRED'
    ));

  it('rejects refresh tokens and 2FA challenge tokens used as access tokens', async () => {
    await expectAuthError(`Bearer ${generateRefreshToken('u1')}`, 'INVALID_TOKEN');
    await expectAuthError(`Bearer ${generateTwoFactorToken('u1')}`, 'INVALID_TOKEN');
  });

  it('rejects a valid token for a deleted user', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expectAuthError(`Bearer ${tokenFor(makeUser())}`, 'USER_NOT_FOUND');
  });

  it('rejects a valid token for a deactivated user', async () => {
    const user = makeUser('MEMBER', { isActive: false });
    prismaMock.user.findUnique.mockResolvedValue(user);
    await expectAuthError(`Bearer ${tokenFor(user)}`, 'ACCOUNT_DEACTIVATED');
  });

  it('selects tokenVersion but does not expose it on req.user', async () => {
    const user = { ...makeUser('MEMBER'), tokenVersion: 0 };
    prismaMock.user.findUnique.mockResolvedValue(user);
    const { req, res, next } = withHeader(`Bearer ${tokenFor(user)}`);
    await authenticate(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(prismaMock.user.findUnique.mock.calls[0][0].select.tokenVersion).toBe(true);
    expect(req.user.tokenVersion).toBeUndefined();
    expect(req.user.id).toBe(user.id);
  });

  it('rejects a token whose tv no longer matches the user (revoked) with TOKEN_REVOKED', async () => {
    const user = makeUser('MEMBER');
    prismaMock.user.findUnique.mockResolvedValue({ ...user, tokenVersion: 1 });
    await expectAuthError(`Bearer ${generateAccessToken(user.id, user.email, user.userRole, 0)}`, 'TOKEN_REVOKED');
  });

  it('accepts a token whose tv matches a bumped tokenVersion', async () => {
    const user = makeUser('MEMBER');
    prismaMock.user.findUnique.mockResolvedValue({ ...user, tokenVersion: 3 });
    const { req, res, next } = withHeader(`Bearer ${generateAccessToken(user.id, user.email, user.userRole, 3)}`);
    await authenticate(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(req.user.id).toBe(user.id);
  });

  it('treats a legacy token without a tv claim as version 0', async () => {
    const user = makeUser('MEMBER');
    const legacy = jwt.sign({ userId: user.id, email: user.email, userRole: user.userRole }, config.jwt.secret);
    prismaMock.user.findUnique.mockResolvedValue({ ...user, tokenVersion: 0 });
    const ok = withHeader(`Bearer ${legacy}`);
    await authenticate(ok.req, ok.res, ok.next);
    expect(ok.next).toHaveBeenCalledWith();

    prismaMock.user.findUnique.mockResolvedValue({ ...user, tokenVersion: 2 });
    await expectAuthError(`Bearer ${legacy}`, 'TOKEN_REVOKED');
  });

  it('passes unexpected errors through untouched', async () => {
    const boom = new Error('db down');
    prismaMock.user.findUnique.mockRejectedValue(boom);
    const { req, res, next } = withHeader(`Bearer ${tokenFor(makeUser())}`);
    await authenticate(req, res, next);
    expect(next).toHaveBeenCalledWith(boom);
  });
});

describe('optionalAuth', () => {
  it('continues anonymously without a header', async () => {
    const { req, res, next } = withHeader();
    await optionalAuth(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(req.user).toBeUndefined();
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('attaches an active user', async () => {
    const { user, header } = authAs('MEMBER');
    const { req, res, next } = withHeader(header);
    await optionalAuth(req, res, next);
    expect(req.user).toEqual(user);
    expect(next).toHaveBeenCalledWith();
  });

  it('ignores deactivated users', async () => {
    const user = makeUser('MEMBER', { isActive: false });
    prismaMock.user.findUnique.mockResolvedValue(user);
    const { req, res, next } = withHeader(`Bearer ${tokenFor(user)}`);
    await optionalAuth(req, res, next);
    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
  });

  it('ignores a revoked token (tv mismatch)', async () => {
    const user = makeUser('MEMBER');
    prismaMock.user.findUnique.mockResolvedValue({ ...user, tokenVersion: 4 });
    const { req, res, next } = withHeader(`Bearer ${generateAccessToken(user.id, user.email, user.userRole, 3)}`);
    await optionalAuth(req, res, next);
    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
  });

  it('attaches the user without exposing tokenVersion', async () => {
    const user = makeUser('MEMBER');
    prismaMock.user.findUnique.mockResolvedValue({ ...user, tokenVersion: 0 });
    const { req, res, next } = withHeader(`Bearer ${tokenFor(user)}`);
    await optionalAuth(req, res, next);
    expect(req.user).toEqual(user);
  });

  it('continues anonymously with an invalid or non-access token', async () => {
    for (const token of ['junk', generateRefreshToken('u1'), generateTwoFactorToken('u1')]) {
      const { req, res, next } = withHeader(`Bearer ${token}`);
      await optionalAuth(req, res, next);
      expect(req.user).toBeUndefined();
      expect(next).toHaveBeenCalledWith();
    }
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });
});

// Characterisation only: authorize/requireRole semantics are owned by the RBAC work.
describe('role guards', () => {
  const guard = (mw: any, user?: Record<string, unknown>) => {
    const { req, res, next } = mockReqRes(user ? { user } : {});
    mw(req, res, next);
    return next.mock.calls[0][0];
  };

  it('authorize: 401 without a user, 403 for other roles, passes listed roles', () => {
    const mw = authorize('ADMIN', 'SUPER_ADMIN');
    expect(guard(mw)).toMatchObject({ statusCode: 401, code: 'AUTH_REQUIRED' });
    expect(guard(mw, { userRole: 'MEMBER' })).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    expect(guard(mw, {})).toMatchObject({ statusCode: 403 });
    expect(guard(mw, { userRole: 'ADMIN' })).toBeUndefined();
  });

  it('requireRole: enforces the minimum role in the hierarchy', () => {
    const mw = requireRole('CHAPTER_ADMIN');
    expect(guard(mw)).toMatchObject({ statusCode: 401, code: 'AUTH_REQUIRED' });
    expect(guard(mw, { userRole: 'MEMBER' })).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    expect(guard(mw, { userRole: 'CHAPTER_ADMIN' })).toBeUndefined();
    expect(guard(mw, { userRole: 'SUPER_ADMIN' })).toBeUndefined();
  });
});
