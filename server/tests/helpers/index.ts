/**
 * Shared helpers for unit and route-level tests.
 */
import request from 'supertest';
import type { Express } from 'express';
import type { UserRole } from '@prisma/client';
import { generateAccessToken } from '../../src/utils/jwt';

// Typed loosely on purpose: DeepMockProxy<PrismaClient> trips TS2615 on Prisma's groupBy types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const prismaMock: any = jest.requireMock('../../src/config/database').default;

export const USER_IDS: Record<UserRole, string> = {
  MEMBER: '00000000-0000-4000-8000-000000000001',
  CHAPTER_ADMIN: '00000000-0000-4000-8000-000000000002',
  ADMIN: '00000000-0000-4000-8000-000000000003',
  SUPER_ADMIN: '00000000-0000-4000-8000-000000000004',
};

export const OTHER_USER_ID = '00000000-0000-4000-8000-0000000000ff';

export interface TestUser {
  id: string;
  email: string;
  fullName: string;
  userRole: UserRole;
  isActive: boolean;
}

export const makeUser = (role: UserRole = 'MEMBER', overrides: Partial<TestUser> = {}): TestUser => ({
  id: USER_IDS[role],
  email: `${role.toLowerCase()}@aitd.test`,
  fullName: `Test ${role}`,
  userRole: role,
  isActive: true,
  ...overrides,
});

export const tokenFor = (user: TestUser) => generateAccessToken(user.id, user.email, user.userRole);

/**
 * Arrange the prisma mock so `authenticate` resolves the given user, then
 * return an Authorization header value for them.
 */
export const authAs = (role: UserRole = 'MEMBER', overrides: Partial<TestUser> = {}) => {
  const user = makeUser(role, overrides);
  prismaMock.user.findUnique.mockImplementation(((args: any) => {
    if (args?.where?.id === user.id) return Promise.resolve(user) as any;
    return Promise.resolve(null) as any;
  }) as any);
  return { user, header: `Bearer ${tokenFor(user)}` };
};

let cachedApp: Express | undefined;
export const getApp = (): Express => {
  if (!cachedApp) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createApp } = require('../../src/app');
    cachedApp = createApp({ disableRateLimit: true });
  }
  return cachedApp!;
};

export const api = () => request(getApp());

/** Minimal Express req/res/next doubles for controller-level tests. */
export const mockReqRes = (req: Record<string, unknown> = {}) => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res);
  res.redirect = jest.fn().mockReturnValue(res);
  const next = jest.fn();
  return {
    req: { params: {}, query: {}, body: {}, headers: {}, ...req } as any,
    res,
    next,
  };
};
