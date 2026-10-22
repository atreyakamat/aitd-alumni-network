/**
 * Regenerates docs/API_REFERENCE.md from the live router: `npm run docs:api`.
 */
import fs from 'fs';
import path from 'path';
import router from '../src/routes';
import { collectRoutes, renderApiReference } from '../tests/docs/apiReference';

const target = path.resolve(__dirname, '../../docs/API_REFERENCE.md');
fs.writeFileSync(target, `${renderApiReference(collectRoutes(router))}\n`);
console.log(`Wrote ${path.relative(process.cwd(), target)}`);
process.exit(0);
