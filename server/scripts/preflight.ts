/**
 * Go-live preflight: `npm run preflight -w server -- [--env-file ../.env] [--no-db]`
 *
 * Options:
 *   --env-file <path>      read variables from a file (the docker-compose .env works as it is)
 *   --database-url <url>   database to inspect (default: DATABASE_URL). With docker-compose use the published port, e.g.
 *                          postgresql://aiem:<password>@127.0.0.1:5432/aiem_connect, or an SSH tunnel to it
 *   --no-db                skip the database stage
 *
 * Reads the configuration the way production will see it (NODE_ENV is forced to "production"), applies the same rules
 * the API enforces at start-up (src/config/productionChecks.ts), and, unless --no-db is given, looks inside the database
 * for demo accounts and default passwords (src/config/databaseChecks.ts). Prints a report and exits 1 on any error.
 * It never prints secrets: only variable names, account e-mail addresses and what to change.
 */
import path from 'path';
import dotenv from 'dotenv';
import { evaluateProductionConfig, type ConfigFinding } from '../src/config/productionChecks';

// Quiet Prisma query logging (it is on outside production) and make every NODE_ENV-dependent default match production
process.env.NODE_ENV = 'production';

const args = process.argv.slice(2);
const flagValue = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};

const envFile = flagValue('--env-file');
const skipDb = args.includes('--no-db');
const databaseUrlFlag = flagValue('--database-url');

if (envFile) {
  const result = dotenv.config({ path: path.resolve(process.cwd(), envFile), override: true });
  if (result.error) {
    console.error(`Cannot read ${envFile}: ${result.error.message}`);
    process.exit(2);
  }
} else {
  dotenv.config();
}

const print = (heading: string, items: ConfigFinding[], mark: string) => {
  if (items.length === 0) return;
  console.log(`\n${heading} (${items.length})`);
  for (const item of items) {
    console.log(`  ${mark} ${item.code}\n      ${item.message}\n      fix: ${item.fix}`);
  }
};

const main = async () => {
  console.log('AIEM Connect production preflight');
  console.log(`  configuration: ${envFile ?? 'the current environment / server/.env'}`);

  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'production' };
  // docker-compose has no DATABASE_URL in .env: it builds one from POSTGRES_*. Check the same value it will build.
  if (!env.DATABASE_URL && env.POSTGRES_PASSWORD !== undefined) {
    env.DATABASE_URL = `postgresql://${env.POSTGRES_USER || 'aiem'}:${encodeURIComponent(env.POSTGRES_PASSWORD)}@postgres:5432/${env.POSTGRES_DB || 'aiem_connect'}`;
    // ... and its api service always gets the bundled Redis
    env.REDIS_URL = env.REDIS_URL || 'redis://redis:6379';
  }
  const result = evaluateProductionConfig(env);
  const errors = [...result.errors];
  const warnings = [...result.warnings];

  // The database to inspect must be reachable from THIS machine (the compose host name "postgres" is not)
  const inspectUrl = databaseUrlFlag || process.env.DATABASE_URL;
  if (skipDb) {
    warnings.push({ code: 'DATABASE_NOT_CHECKED', level: 'warning', waivable: false, message: 'The database was not inspected (--no-db).', fix: 'Run again without --no-db against the production database before go-live.' });
  } else if (!inspectUrl) {
    warnings.push({
      code: 'DATABASE_NOT_CHECKED',
      level: 'warning',
      waivable: false,
      message: 'The database was not inspected: no DATABASE_URL that is reachable from this machine.',
      fix: 'Run again with --database-url postgresql://aiem:<password>@127.0.0.1:5432/aiem_connect (compose publishes Postgres on 127.0.0.1) before go-live.',
    });
  } else {
    process.env.DATABASE_URL = inspectUrl;
    // Imported late: the Prisma client reads DATABASE_URL when it is created
    const { default: prisma } = await import('../src/config/database');
    const { findDatabaseProblems } = await import('../src/config/databaseChecks');
    try {
      await prisma.$queryRaw`SELECT 1`;
      errors.push(...(await findDatabaseProblems(prisma as never)));
    } catch (error) {
      errors.push({
        code: 'DATABASE_UNREACHABLE',
        level: 'error',
        waivable: false,
        message: `Could not query the database: ${(error as Error).message.split('\n')[0]}`,
        fix: 'Check DATABASE_URL, that migrations are applied (npm run db:deploy) and that this machine can reach the server.',
      });
    } finally {
      await prisma.$disconnect();
    }
  }

  print('ERRORS: fix before go-live', errors, '✗');
  print('WARNINGS: review', warnings, '!');
  console.log(`\nResult: ${errors.length === 0 ? `PASS${warnings.length ? ` (${warnings.length} warning(s) to review)` : ''}` : `FAIL (${errors.length} error(s))`}`);
  process.exit(errors.length === 0 ? 0 : 1);
};

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
