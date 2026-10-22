#!/usr/bin/env node
/**
 * Run a throwaway MySQL 8 server locally without Docker (for dev & tests).
 *
 *   node scripts/local-mysql.cjs            # port 3307, db alumni_connect
 *   MYSQL_PORT=3308 MYSQL_DB=foo node scripts/local-mysql.cjs
 *
 * Prints the DATABASE_URL and keeps running until Ctrl+C. The first run
 * downloads the MySQL binaries (~1-2 min); later runs reuse the cache.
 * Data is discarded when the process stops.
 */
const { createDB } = require('mysql-memory-server');

(async () => {
  const port = Number(process.env.MYSQL_PORT || 3307);
  const dbName = process.env.MYSQL_DB || 'alumni_connect';
  const db = await createDB({ version: '8.0.x', port, dbName, logLevel: 'ERROR' });
  const url = `mysql://${db.username}@127.0.0.1:${db.port}/${db.dbName}`;
  console.log(`MySQL ready: DATABASE_URL="${url}"`);
  if (process.env.MYSQL_URL_FILE) require('fs').writeFileSync(process.env.MYSQL_URL_FILE, url);

  const stop = async () => {
    await db.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  setInterval(() => undefined, 1 << 30);
})().catch((err) => {
  console.error('Failed to start local MySQL:', err);
  process.exit(1);
});
