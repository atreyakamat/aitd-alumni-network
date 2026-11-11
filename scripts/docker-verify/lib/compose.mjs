// A thin, testable wrapper around `docker compose` for the verification project (its own project name, so a real stack
// running on the same machine is never touched).

/**
 * `docker compose ps --format json` prints one JSON object per line on newer versions and a JSON array on older ones.
 * Normalised to { service, name, id, state, health, exitCode, publishers: [{ host, hostPort, containerPort, protocol }] }.
 */
export const parseComposePs = (stdout) => {
  const text = String(stdout ?? '').trim();
  if (!text) return [];
  let rows;
  if (text.startsWith('[')) {
    rows = JSON.parse(text);
  } else {
    rows = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
  return rows.map((row) => ({
    service: row.Service ?? row.Name,
    name: row.Name,
    id: row.ID,
    state: String(row.State ?? '').toLowerCase(),
    health: String(row.Health ?? '').toLowerCase(),
    exitCode: row.ExitCode ?? 0,
    publishers: (row.Publishers ?? [])
      .filter((p) => p && p.PublishedPort)
      .map((p) => ({ host: p.URL, hostPort: p.PublishedPort, containerPort: p.TargetPort, protocol: p.Protocol })),
  }));
};

export const createCompose = ({
  exec,
  cwd,
  project = 'aiem-verify',
  files = ['docker-compose.yml', 'docker-compose.test.yml'],
  envFile,
  profiles = ['proxy'],
}) => {
  const base = [
    'compose',
    '-p',
    project,
    ...(envFile ? ['--env-file', envFile] : []),
    ...files.flatMap((file) => ['-f', file]),
    ...profiles.flatMap((profile) => ['--profile', profile]),
  ];
  const compose = (args, options = {}) => exec('docker', [...base, ...args], { cwd, ...options });

  return {
    project,
    /** The argument vector, for the evidence file and for tests. */
    argv: (args) => ['docker', ...base, ...args],
    raw: (args, options) => compose(args, options),
    config: () => compose(['config', '-q']),
    configText: () => compose(['config']),
    up: ({ build = true, services = [], waitTimeoutSec = 900 } = {}) =>
      compose(['up', '-d', ...(build ? ['--build'] : []), '--wait', '--wait-timeout', String(waitTimeoutSec), ...services], {
        timeoutMs: (waitTimeoutSec + 600) * 1000,
      }),
    down: ({ volumes = true } = {}) => compose(['down', ...(volumes ? ['-v'] : []), '--remove-orphans'], { timeoutMs: 300_000 }),
    ps: async () => {
      const result = await compose(['ps', '--all', '--format', 'json']);
      if (result.code !== 0) throw new Error(`docker compose ps failed: ${result.stderr.trim().slice(0, 300)}`);
      return parseComposePs(result.stdout);
    },
    logs: (service, { tail = 300 } = {}) => compose(['logs', '--no-color', '--tail', String(tail), ...(service ? [service] : [])]),
    stop: (service) => compose(['stop', service], { timeoutMs: 180_000 }),
    start: (service) => compose(['start', service], { timeoutMs: 180_000 }),
    restart: (service) => compose(['restart', service], { timeoutMs: 300_000 }),
    /** Runs a command inside a running service container (no TTY, so it works from scripts and CI). */
    execIn: (service, args, { input, user, timeoutMs } = {}) =>
      compose(['exec', '-T', ...(user ? ['-u', user] : []), service, ...args], { input, timeoutMs }),
    containerId: async (service) => {
      const result = await compose(['ps', '-q', service]);
      return result.stdout.trim().split('\n')[0] || null;
    },
  };
};
