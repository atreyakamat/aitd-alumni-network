// Runs a program and resolves with { code, stdout, stderr, timedOut } (never rejects, never uses a shell).
// Everything in docker-verify takes an `exec` with this shape, so the tests can pass a fake and run without Docker.
import { spawn } from 'node:child_process';

export const run = (command, args = [], { cwd, env, input, timeoutMs = 600_000 } = {}) =>
  new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env: env ? { ...process.env, ...env } : process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
      });
    } catch (error) {
      resolve({ code: 127, stdout: '', stderr: String(error?.message ?? error), timedOut: false });
      return;
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: `${stderr}${error.message}`, timedOut: false });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: timedOut ? 124 : (code ?? 1), stdout, stderr, timedOut });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
  });

/** First line of the combined output, for a one-line explanation of a failed command. */
export const brief = (result, max = 300) =>
  `${result.stderr || result.stdout || `exit ${result.code}`}`.trim().split('\n').slice(-3).join(' | ').slice(0, max);
