import { createShutdown } from '../../utils/shutdown';

const deps = (overrides: Record<string, unknown> = {}) => {
  const server = { close: jest.fn((cb: (err?: Error) => void) => cb()) };
  const io = { close: jest.fn((cb?: () => void) => cb?.()) };
  const prisma = { $disconnect: jest.fn().mockResolvedValue(undefined) };
  const redis = { quit: jest.fn().mockResolvedValue('OK') };
  const exit = jest.fn();
  const log = jest.fn();
  return { server, io, prisma, redis, exit, log, timeoutMs: 1000, ...overrides };
};

describe('createShutdown', () => {
  it('stops accepting connections, closes sockets, the database and redis, then exits 0', async () => {
    const d = deps();
    await createShutdown(d as any)('SIGTERM');

    expect(d.io.close).toHaveBeenCalled();
    expect(d.server.close).toHaveBeenCalled();
    expect(d.prisma.$disconnect).toHaveBeenCalled();
    expect(d.redis.quit).toHaveBeenCalled();
    expect(d.exit).toHaveBeenCalledWith(0);
  });

  it('works without socket.io or redis', async () => {
    const d = deps({ io: null, redis: null });
    await createShutdown(d as any)('SIGINT');
    expect(d.exit).toHaveBeenCalledWith(0);
  });

  it('only runs once when several signals arrive', async () => {
    const d = deps();
    const shutdown = createShutdown(d as any);
    await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')]);
    expect(d.prisma.$disconnect).toHaveBeenCalledTimes(1);
    expect(d.exit).toHaveBeenCalledTimes(1);
  });

  it('exits 1 when a resource fails to close', async () => {
    const d = deps({ prisma: { $disconnect: jest.fn().mockRejectedValue(new Error('boom')) } });
    await createShutdown(d as any)('SIGTERM');
    expect(d.exit).toHaveBeenCalledWith(1);
  });

  it('forces exit 1 when draining exceeds the timeout', async () => {
    jest.useFakeTimers();
    try {
      const d = deps({ server: { close: jest.fn() }, timeoutMs: 50 }); // never calls back
      void createShutdown(d as any)('SIGTERM');
      await jest.advanceTimersByTimeAsync(60);
      expect(d.exit).toHaveBeenCalledWith(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
