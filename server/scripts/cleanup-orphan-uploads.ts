/**
 * Orphaned-upload cleanup: `npm run uploads:cleanup -w server -- [--delete] [--min-age-hours N] [--list]`
 *
 * Reports (dry run, the default) or removes (--delete) files in the local uploads directory that no database record refers
 * to and that are older than the minimum age (24 hours by default). See src/services/uploadCleanupService.ts for the rules
 * and docs/ROBUSTNESS.md for when to run it. Run it where the uploads directory and the database are: on the server, from the
 * server folder. In the built image: see the one-liner on runCleanupCli.
 */
import 'dotenv/config';
import prisma from '../src/config/database';
import { runCleanupCli } from '../src/services/uploadCleanupService';

runCleanupCli(process.argv.slice(2))
  .then(async (code) => {
    await prisma.$disconnect();
    process.exit(code);
  })
  .catch(async (error) => {
    process.stderr.write(`Cleanup failed: ${(error as Error).message}\n`);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(1);
  });
