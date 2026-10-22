/**
 * Graceful shutdown for SIGTERM/SIGINT (docker stop, rolling deploys, Ctrl+C): stop taking new
 * connections, let in-flight requests finish, then release the database and cache. A timer
 * forces the exit if draining hangs, so the orchestrator never has to SIGKILL us mid-write.
 */
interface Closable {
  close(cb: (err?: Error) => void): unknown;
}

export interface ShutdownDeps {
  server: Closable;
  io?: { close(cb?: () => void): unknown } | null;
  prisma: { $disconnect(): Promise<unknown> };
  redis?: { quit(): Promise<unknown> } | null;
  timeoutMs: number;
  exit: (code: number) => void;
  log: (message: string) => void;
}

export const createShutdown = (deps: ShutdownDeps) => {
  let pending: Promise<void> | null = null;

  return (signal: string): Promise<void> => {
    if (pending) return pending;

    deps.log(`${signal} received: shutting down gracefully`);
    const timer = setTimeout(() => {
      deps.log(`Shutdown did not finish within ${deps.timeoutMs}ms; forcing exit`);
      deps.exit(1);
    }, deps.timeoutMs);
    timer.unref?.();

    pending = (async () => {
      let code = 0;
      try {
        // socket.io first: its close() also closes the attached HTTP server's upgrade handling
        if (deps.io) await new Promise<void>((resolve) => deps.io!.close(() => resolve()));
        await new Promise<void>((resolve, reject) =>
          deps.server.close((err) => (err && (err as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING' ? reject(err) : resolve()))
        );
        await deps.prisma.$disconnect();
        if (deps.redis) await deps.redis.quit();
      } catch (error) {
        deps.log(`Error during shutdown: ${(error as Error).message}`);
        code = 1;
      } finally {
        clearTimeout(timer);
      }
      deps.exit(code);
    })();

    return pending;
  };
};
