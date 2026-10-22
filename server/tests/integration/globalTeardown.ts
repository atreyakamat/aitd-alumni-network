export default async function globalTeardown() {
  const db = (globalThis as any).__AITD_TEST_DB__;
  if (db) await db.stop();
}
