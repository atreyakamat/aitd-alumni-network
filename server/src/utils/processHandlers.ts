import { log } from './logger';

export interface ProcessLike {
  on(event: string, handler: (...args: any[]) => void): unknown; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/**
 * What the process does when something outside a request goes wrong.
 *
 * - SIGTERM / SIGINT (docker stop, a deploy, Ctrl+C): shut down gracefully, exit code 0.
 * - An uncaught exception means the process is in a state nobody planned for: log it with its stack, finish what is
 *   in flight, and exit non-zero so the orchestrator starts a clean replacement instead of serving from a corrupt one.
 * - An unhandled promise rejection is logged and the server keeps running: it is nearly always a forgotten `.catch` on
 *   a side effect (a notification, an e-mail), not a reason to drop everybody's connection.
 */
export const registerProcessHandlers = ({
  proc,
  shutdown,
}: {
  proc: ProcessLike;
  shutdown: (signal: string, failed?: boolean) => Promise<void>;
}) => {
  proc.on('SIGTERM', () => void shutdown('SIGTERM'));
  proc.on('SIGINT', () => void shutdown('SIGINT'));
  proc.on('unhandledRejection', (reason: unknown) => {
    log.error('Unhandled promise rejection', { err: reason });
  });
  proc.on('uncaughtException', (error: Error) => {
    log.error('Uncaught exception: shutting down', { err: error });
    void shutdown('uncaughtException', true);
  });
};
