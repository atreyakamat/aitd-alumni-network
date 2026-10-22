import jwt from 'jsonwebtoken';
import config from '../../config';
import { generateAccessToken, generateRefreshToken } from '../../utils/jwt';
import { socketAuthMiddleware } from '../../utils/socket';
import { prismaMock } from '../../../tests/helpers';

type SocketModule = typeof import('../../utils/socket');

const emit = jest.fn();
const to = jest.fn(() => ({ emit }));
const disconnectSockets = jest.fn();
const inRoom = jest.fn(() => ({ disconnectSockets }));
const use = jest.fn();
const on = jest.fn();
const ServerCtor = jest.fn(() => ({ to, in: inRoom, use, on }));

jest.mock('socket.io', () => ({ Server: jest.fn((...args: unknown[]) => (ServerCtor as any)(...args)) }));

/** Fresh copy of the module so the module-level `io` starts uninitialised. */
const loadFresh = (): SocketModule => {
  let mod!: SocketModule;
  jest.isolateModules(() => {
    mod = require('../../utils/socket');
  });
  return mod;
};

const fakeSocket = (handshake: Record<string, unknown> = {}) => {
  const handlers: Record<string, (...args: any[]) => void> = {};
  return {
    id: 'sock-1',
    handshake: { auth: {}, headers: {}, ...handshake },
    join: jest.fn(),
    leave: jest.fn(),
    on: jest.fn((event: string, fn: (...args: any[]) => void) => {
      handlers[event] = fn;
    }),
    handlers,
  } as any;
};

const USER = '00000000-0000-4000-8000-000000000001';
const validToken = () => generateAccessToken(USER, 'm@aitd.test', 'MEMBER');

beforeEach(() => {
  emit.mockClear();
  to.mockClear();
  inRoom.mockClear();
  disconnectSockets.mockClear();
  use.mockClear();
  on.mockClear();
  ServerCtor.mockClear();
});

describe('socket util', () => {
  describe('before initialisation', () => {
    it('emitToUser / emitToRoom are silent no-ops', () => {
      const socket = loadFresh();
      expect(() => socket.emitToUser(USER, 'evt', { a: 1 })).not.toThrow();
      expect(() => socket.emitToRoom('room', 'evt', { a: 1 })).not.toThrow();
      expect(to).not.toHaveBeenCalled();
    });

    it('disconnectUser is a silent no-op', () => {
      const socket = loadFresh();
      expect(() => socket.disconnectUser(USER)).not.toThrow();
      expect(inRoom).not.toHaveBeenCalled();
    });

    it('getIO throws', () => {
      const socket = loadFresh();
      expect(() => socket.getIO()).toThrow('Socket.io not initialized');
    });
  });

  describe('initSocket', () => {
    it('creates the server with CORS config and wires auth + connection handlers', () => {
      const socket = loadFresh();
      const httpServer = {} as any;

      const io = socket.initSocket(httpServer);

      expect(ServerCtor).toHaveBeenCalledWith(httpServer, { cors: { origin: config.corsOrigins, credentials: true } });
      expect(use).toHaveBeenCalledWith(socket.socketAuthMiddleware);
      expect(on).toHaveBeenCalledWith('connection', socket.registerConnectionHandlers);
      expect(socket.getIO()).toBe(io);
    });

    it('emits to user and arbitrary rooms once initialised', () => {
      const socket = loadFresh();
      socket.initSocket({} as any);

      socket.emitToUser(USER, 'new_message', { id: 'm1' });
      expect(to).toHaveBeenLastCalledWith(`user:${USER}`);
      expect(emit).toHaveBeenLastCalledWith('new_message', { id: 'm1' });

      socket.emitToRoom('chat:abc', 'typing', { x: 1 });
      expect(to).toHaveBeenLastCalledWith('chat:abc');
      expect(emit).toHaveBeenLastCalledWith('typing', { x: 1 });
    });

    it("disconnectUser closes every live socket in the user's room", () => {
      const socket = loadFresh();
      socket.initSocket({} as any);
      socket.disconnectUser(USER);
      expect(inRoom).toHaveBeenCalledWith(`user:${USER}`);
      expect(disconnectSockets).toHaveBeenCalledWith(true);
    });

    it('ignores empty targets', () => {
      const socket = loadFresh();
      socket.initSocket({} as any);
      socket.emitToUser('', 'evt', {});
      socket.emitToRoom('', 'evt', {});
      socket.disconnectUser('');
      expect(to).not.toHaveBeenCalled();
      expect(inRoom).not.toHaveBeenCalled();
    });
  });

  describe('socketAuthMiddleware', () => {
    // Imported from the main registry (not loadFresh) so it shares prismaMock
    const run = async (s: any) => {
      const next = jest.fn();
      await socketAuthMiddleware(s, next);
      return next;
    };
    const arrangeUser = (overrides: Record<string, unknown> = {}) =>
      prismaMock.user.findUnique.mockResolvedValue({ id: USER, isActive: true, tokenVersion: 0, ...overrides });

    it('rejects a handshake without a token', async () => {
      const next = await run(fakeSocket());
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Authentication error' }));
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    });

    it('rejects a handshake with no auth object at all', async () => {
      const next = await run({ id: 'x', handshake: {} });
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it.each([
      ['garbage', 'not-a-jwt'],
      ['wrong secret', jwt.sign({ userId: USER }, 'some-other-secret', { algorithm: 'HS256' })],
      ['refresh token', generateRefreshToken(USER)],
      ['expired', jwt.sign({ userId: USER, exp: Math.floor(Date.now() / 1000) - 60 }, config.jwt.secret as string, { algorithm: 'HS256' })],
      ['no userId claim', jwt.sign({ email: 'x' }, config.jwt.secret as string, { algorithm: 'HS256' })],
    ])('rejects an invalid token (%s)', async (_label, token) => {
      arrangeUser();
      const s = fakeSocket({ auth: { token } });
      const next = await run(s);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Authentication error' }));
      expect(s.userId).toBeUndefined();
    });

    it('accepts a valid token from the auth payload after loading the user', async () => {
      arrangeUser();
      const s = fakeSocket({ auth: { token: validToken() } });
      const next = await run(s);
      expect(next).toHaveBeenCalledWith();
      expect(s.userId).toBe(USER);
      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: USER },
        select: { id: true, isActive: true, tokenVersion: true },
      });
    });

    it('accepts a valid Bearer token from the Authorization header', async () => {
      arrangeUser();
      const s = fakeSocket({ headers: { authorization: `Bearer ${validToken()}` } });
      const next = await run(s);
      expect(next).toHaveBeenCalledWith();
      expect(s.userId).toBe(USER);
    });

    it('accepts a token whose tv matches the current tokenVersion', async () => {
      arrangeUser({ tokenVersion: 3 });
      const s = fakeSocket({ auth: { token: generateAccessToken(USER, 'm@aitd.test', 'MEMBER', 3) } });
      expect(await run(s)).toHaveBeenCalledWith();
    });

    it.each([
      ['deleted user', null],
      ['deactivated user', { id: USER, isActive: false, tokenVersion: 0 }],
      ['revoked token (tokenVersion bumped)', { id: USER, isActive: true, tokenVersion: 1 }],
    ])('rejects a %s', async (_label, record) => {
      prismaMock.user.findUnique.mockResolvedValue(record);
      const s = fakeSocket({ auth: { token: validToken() } });
      const next = await run(s);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Authentication error' }));
      expect(s.userId).toBeUndefined();
    });

    it('rejects (does not crash) when the user lookup fails', async () => {
      prismaMock.user.findUnique.mockRejectedValue(new Error('db down'));
      const s = fakeSocket({ auth: { token: validToken() } });
      const next = await run(s);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Authentication error' }));
      expect(s.userId).toBeUndefined();
    });

    it('rejects a non-Bearer Authorization header', async () => {
      arrangeUser();
      const s = fakeSocket({ headers: { authorization: `Basic ${validToken()}` } });
      const next = await run(s);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('extractSocketToken', () => {
    it('prefers the auth payload and trims it', () => {
      const { extractSocketToken } = loadFresh();
      expect(extractSocketToken({ handshake: { auth: { token: ' abc ' }, headers: { authorization: 'Bearer def' } } } as any)).toBe('abc');
      expect(extractSocketToken({ handshake: { auth: { token: '' }, headers: { authorization: 'bearer def' } } } as any)).toBe('def');
      expect(extractSocketToken({ handshake: { auth: {}, headers: { authorization: 'Bearer' } } } as any)).toBeUndefined();
    });
  });

  describe('connection handlers', () => {
    const connect = () => {
      const socket = loadFresh();
      socket.initSocket({} as any);
      const s = fakeSocket();
      s.userId = USER;
      socket.registerConnectionHandlers(s);
      return s;
    };

    it('joins the private user room on connect', () => {
      const s = connect();
      expect(s.join).toHaveBeenCalledWith(`user:${USER}`);
    });

    it('only lets a user join chat rooms they are a participant of', () => {
      const s = connect();
      s.join.mockClear();

      s.handlers.join_chat(`${USER}:${'b'.repeat(8)}`);
      s.handlers.join_chat(`other_${USER}`);
      expect(s.join.mock.calls).toEqual([[`chat:${USER}:${'b'.repeat(8)}`], [`chat:other_${USER}`]]);

      s.join.mockClear();
      s.handlers.join_chat('someone:else');
      s.handlers.join_chat(`${USER}x:y`);
      s.handlers.join_chat(42);
      s.handlers.join_chat('');
      s.handlers.join_chat(`${USER}:${'z'.repeat(200)}`);
      expect(s.join).not.toHaveBeenCalled();
    });

    it('leaves chat rooms, ignoring junk', () => {
      const s = connect();
      s.handlers.leave_chat('abc');
      s.handlers.leave_chat(undefined);
      expect(s.leave.mock.calls).toEqual([['chat:abc']]);
    });

    it('relays typing indicators to the recipient only', () => {
      const s = connect();
      s.handlers.typing({ receiverId: 'r1' });
      expect(to).toHaveBeenLastCalledWith('user:r1');
      expect(emit).toHaveBeenLastCalledWith('user_typing', { userId: USER });

      s.handlers.stop_typing({ receiverId: 'r1' });
      expect(emit).toHaveBeenLastCalledWith('user_stop_typing', { userId: USER });

      to.mockClear();
      s.handlers.typing({ receiverId: USER });
      s.handlers.typing({});
      s.handlers.typing(undefined);
      s.handlers.stop_typing({ receiverId: 5 });
      s.handlers.stop_typing(undefined);
      expect(to).not.toHaveBeenCalled();
    });

    it('handles disconnects', () => {
      const s = connect();
      expect(() => s.handlers.disconnect()).not.toThrow();
    });
  });
});
