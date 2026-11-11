#!/usr/bin/env node
// Portable runner for the security tooling tests: node scripts/security/run-tests.mjs
//
// `node --test scripts/security/__tests__/` (a directory) works on Node 20, which CI uses, but Node 22+ reads that argument as
// a file or glob and fails. This runner lists the *.test.mjs files itself and hands them to `node --test`, so the same command
// works on every Node version from 20 on, on Windows and on Linux.

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '__tests__');
const files = readdirSync(dir).filter((name) => name.endsWith('.test.mjs')).sort().map((name) => path.join(dir, name));
const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
