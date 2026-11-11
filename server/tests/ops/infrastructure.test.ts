/**
 * Deployment files cannot be run in this repository's CI (no Docker, no nginx), so the properties that keep a small
 * deployment alive and safe are pinned here. An edit that quietly loosens one of them fails a test instead of surfacing
 * as a full disk or an exposed database months later.
 */
import fs from 'fs';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require('js-yaml') as { load: (text: string) => any };

const REPO = path.resolve(__dirname, '../../..');
const compose = yaml.load(fs.readFileSync(path.join(REPO, 'docker-compose.yml'), 'utf8'));
const nginx = fs.readFileSync(path.join(REPO, 'nginx/nginx.conf'), 'utf8');
const services: Record<string, any> = compose.services;
const names = Object.keys(services);

const ports = (service: string): string[] => (services[service].ports ?? []).map(String);

describe('package manager and runtime', () => {
  const root = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));

  it('the project is npm-only: the declared manager (if any) is npm, there is a package-lock.json and no other lockfile', () => {
    // A "yarn" declaration makes every npm command fail for anyone with Corepack enabled
    expect(root.packageManager === undefined || String(root.packageManager).startsWith('npm@')).toBe(true);
    expect(fs.existsSync(path.join(REPO, 'package-lock.json'))).toBe(true);
    expect(fs.existsSync(path.join(REPO, 'yarn.lock'))).toBe(false);
    expect(fs.existsSync(path.join(REPO, 'pnpm-lock.yaml'))).toBe(false);
  });

  it('requires the Node version CI and the Docker images actually use (20), not an older one nothing tests', () => {
    expect(String(root.engines.node)).toMatch(/>=\s*20/);
    for (const dockerfile of ['server/Dockerfile', 'client/Dockerfile']) {
      expect(fs.readFileSync(path.join(REPO, dockerfile), 'utf8')).toMatch(/FROM node:20/);
    }
    expect(fs.readFileSync(path.join(REPO, '.github/workflows/ci.yml'), 'utf8')).toMatch(/NODE_VERSION: '20\.x'/);
  });
});

describe('docker-compose.yml', () => {
  it('describes the six services', () => {
    expect(names.sort()).toEqual(['api', 'kafka', 'nginx', 'postgres', 'redis', 'web']);
  });

  it.each(names)('%s: container logs are rotated, so they cannot fill the disk', (name) => {
    const logging = services[name].logging;
    expect(logging?.driver).toBe('json-file');
    expect(logging?.options?.['max-size']).toMatch(/^\d+[km]$/i);
    expect(Number(logging?.options?.['max-file'])).toBeGreaterThanOrEqual(2);
  });

  it.each(names)('%s: comes back after a crash or a reboot', (name) => {
    expect(services[name].restart).toBe('unless-stopped');
  });

  it.each(['postgres', 'redis', 'kafka', 'api', 'web'])('%s: has a health check', (name) => {
    expect(services[name].healthcheck?.test).toBeTruthy();
  });

  it('the database is only reachable from the machine itself', () => {
    for (const mapping of ports('postgres')) expect(mapping).toMatch(/^127\.0\.0\.1:/);
  });

  it('Redis and Kafka are not published at all', () => {
    expect(ports('redis')).toEqual([]);
    expect(ports('kafka')).toEqual([]);
  });

  it('the API port is on loopback unless the operator opts in', () => {
    for (const mapping of ports('api')) expect(mapping).toContain('${API_BIND:-127.0.0.1}');
  });

  it('secrets have no default: starting without them fails loudly', () => {
    const env = services.api.environment;
    expect(env.JWT_SECRET).toContain(':?');
    expect(env.JWT_REFRESH_SECRET).toContain(':?');
    expect(services.postgres.environment.POSTGRES_PASSWORD).toContain(':?');
  });

  it('the insecure-configuration waiver is OFF unless the operator turns it on', () => {
    expect(services.api.environment.ALLOW_INSECURE_PRODUCTION_CONFIG).toBe('${ALLOW_INSECURE_PRODUCTION_CONFIG:-false}');
  });

  it('the API runs in production mode with short-lived access tokens by default', () => {
    expect(services.api.environment.NODE_ENV).toBe('production');
    expect(services.api.environment.JWT_EXPIRES_IN).toContain(':-15m');
  });

  it('the API waits for a healthy database and Redis before it starts', () => {
    expect(services.api.depends_on.postgres.condition).toBe('service_healthy');
    expect(services.api.depends_on.redis.condition).toBe('service_healthy');
  });

  it('the API gets Redis, so rate limits and background jobs work', () => {
    expect(services.api.environment.REDIS_URL).toBe('redis://redis:6379');
  });

  describe('Kafka (notification events)', () => {
    const env = () => services.kafka.environment as Record<string, string>;

    it('runs one broker that is its own controller (KRaft: no ZooKeeper), reachable only inside the compose network', () => {
      expect(String(services.kafka.image)).toMatch(/^apache\/kafka:\d+\.\d+/);
      expect(env().KAFKA_PROCESS_ROLES).toBe('broker,controller');
      expect(env().KAFKA_ADVERTISED_LISTENERS).toBe('PLAINTEXT://kafka:9092');
      expect(env().KAFKA_CONTROLLER_QUORUM_VOTERS).toBe('1@kafka:9093');
      expect(services.kafka.networks).toEqual(['backend']);
    });

    it('keeps its data in a named volume, so notifications survive a restart', () => {
      const volumes = services.kafka.volumes as string[];
      expect(volumes.some((v) => v.startsWith('kafka_data:'))).toBe(true);
      expect(Object.keys(compose.volumes)).toContain('kafka_data');
    });

    it('is a single node, so every internal topic has one replica (the default of 3 would never become ready)', () => {
      expect(String(env().KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR)).toBe('1');
      expect(String(env().KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR)).toBe('1');
      expect(String(env().KAFKA_TRANSACTION_STATE_LOG_MIN_ISR)).toBe('1');
    });

    it('does not create topics on its own: the API creates the two it needs with the partitions it wants', () => {
      expect(String(env().KAFKA_AUTO_CREATE_TOPICS_ENABLE)).toBe('false');
    });

    it('the API waits for a healthy broker and is told where it is', () => {
      expect(services.api.depends_on.kafka.condition).toBe('service_healthy');
      expect(services.api.environment.KAFKA_BROKERS).toBe('kafka:9092');
    });

    it('the settings an operator may change are passed through with safe defaults', () => {
      const api = services.api.environment;
      expect(api.KAFKA_TOPIC_PREFIX).toContain('${KAFKA_TOPIC_PREFIX:-aiem}');
      expect(api.KAFKA_PARTITIONS).toContain(':-3');
      expect(api.APPROVAL_NOTIFY_EMAIL).toContain('${APPROVAL_NOTIFY_EMAIL:-}');
    });
  });

  it('the proxy is optional (a profile), not started by default', () => {
    expect(services.nginx.profiles).toEqual(['proxy']);
  });
});

describe('nginx/nginx.conf', () => {
  it('rate-limits the sign-in and sign-up endpoints per address', () => {
    expect(nginx).toMatch(/limit_req_zone\s+\$binary_remote_addr\s+zone=auth_endpoints/);
    expect(nginx).toMatch(/location \/api\/auth\/\s*\{[^}]*limit_req zone=auth_endpoints/);
  });

  it('turns an unreachable API into a JSON 503 the web app can show, not an HTML error page', () => {
    expect(nginx).toMatch(/error_page\s+502\s+503\s+504\s*=\s*@api_unavailable/);
    expect(nginx).toMatch(/location @api_unavailable\s*\{[^}]*application\/json[^}]*SERVICE_UNAVAILABLE/s);
  });

  it('does not wait forever for the API', () => {
    expect(nginx).toMatch(/location \/api\/\s*\{[^}]*proxy_connect_timeout\s+\d+s/s);
    expect(nginx).toMatch(/location \/api\/\s*\{[^}]*proxy_read_timeout\s+\d+s/s);
  });

  it('protects against slow clients and hides dotfiles and its own version', () => {
    expect(nginx).toMatch(/client_header_timeout\s+\d+s/);
    expect(nginx).toMatch(/client_body_timeout\s+\d+s/);
    expect(nginx).toMatch(/server_tokens\s+off/);
    expect(nginx).toMatch(/location ~ \/\\\.\(\?!well-known\)/);
  });

  it('has balanced braces (it cannot be run through nginx -t here)', () => {
    const open = (nginx.match(/\{/g) ?? []).length;
    const close = (nginx.match(/\}/g) ?? []).length;
    expect(open).toBe(close);
  });

  it('every directive line ends with a semicolon or a block brace', () => {
    const bad = nginx
      .split('\n')
      .map((line) => line.replace(/#.*$/, '').trim())
      .filter((line) => line && !/[;{}]$/.test(line));
    expect(bad).toEqual([]);
  });
});
