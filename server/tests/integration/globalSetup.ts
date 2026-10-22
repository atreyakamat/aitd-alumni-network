/**
 * Boots a real PostgreSQL 17 for the integration suite (no Docker needed) and
 * applies the committed Prisma migrations. Set TEST_DATABASE_URL to reuse an
 * existing server instead (e.g. the Postgres service container in CI).
 */
import { execSync } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

// embedded-postgres is ESM-only; keep a real dynamic import (ts-jest would turn `import()` into require)
const importEsm = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });

export default async function globalSetup() {
  let url = process.env.TEST_DATABASE_URL;

  if (!url) {
    const { default: EmbeddedPostgres } = await importEsm('embedded-postgres');
    const port = await freePort();
    const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aitd-int-pg-'));
    const pg = new EmbeddedPostgres({
      databaseDir,
      port,
      user: 'postgres',
      password: 'postgres',
      persistent: false,
      onLog: () => undefined,
    });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('aitd_integration');
    (globalThis as any).__AITD_TEST_DB__ = pg;
    url = `postgresql://postgres:postgres@127.0.0.1:${port}/aitd_integration`;
  }

  const serverRoot = path.resolve(__dirname, '../..');
  const env = { ...process.env, DATABASE_URL: url };
  execSync('npx prisma migrate reset --force --skip-seed --skip-generate', { cwd: serverRoot, env, stdio: 'pipe' });

  // Workers are forked after globalSetup, so they inherit this (read in tests/integration/env.ts)
  process.env.AITD_INTEGRATION_DATABASE_URL = url;
}
