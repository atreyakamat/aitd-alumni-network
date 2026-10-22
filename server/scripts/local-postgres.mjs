#!/usr/bin/env node
/**
 * Run PostgreSQL 17 locally without Docker (for dev & tests).
 *
 *   node scripts/local-postgres.mjs              # port 5433, db alumni_connect, data kept in server/.local-pg
 *   node scripts/local-postgres.mjs --fresh      # wipe the data directory first
 *   PG_PORT=5434 PG_DB=foo PG_DATA_DIR=/tmp/pg node scripts/local-postgres.mjs
 *
 * Prints the DATABASE_URL and keeps running until Ctrl+C. The binaries come from the
 * `embedded-postgres` npm package (no download at runtime). Use docker-compose for
 * anything resembling production.
 */
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PG_PORT || 5433);
const dbName = process.env.PG_DB || 'alumni_connect';
const user = process.env.PG_USER || 'postgres';
const password = process.env.PG_PASSWORD || 'postgres';
const databaseDir = path.resolve(process.env.PG_DATA_DIR || path.join(serverRoot, '.local-pg'));

if (process.argv.includes('--fresh')) {
  fs.rmSync(databaseDir, { recursive: true, force: true });
}

const pg = new EmbeddedPostgres({
  databaseDir,
  port,
  user,
  password,
  persistent: true,
  onLog: () => undefined,
  onError: (err) => console.error(String(err)),
});

const alreadyInitialised = fs.existsSync(path.join(databaseDir, 'PG_VERSION'));
if (!alreadyInitialised) await pg.initialise();
await pg.start();

try {
  await pg.createDatabase(dbName);
} catch (err) {
  // 42P04 = duplicate_database: reusing an existing data directory
  if (!/already exists/i.test(String(err?.message ?? err))) throw err;
}

const url = `postgresql://${user}:${password}@127.0.0.1:${port}/${dbName}`;
console.log(`PostgreSQL ready: DATABASE_URL="${url}"`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => undefined, 1 << 30);
