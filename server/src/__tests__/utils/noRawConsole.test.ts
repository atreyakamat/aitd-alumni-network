/**
 * Guard: server code logs through `utils/logger` (structured, redacted, request-aware), never with raw `console.*`.
 * A raw call bypasses LOG_LEVEL/LOG_FORMAT, prints stack traces as plain text, and cannot be searched by request id.
 * See docs/ROBUSTNESS.md.
 */
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '..', '..');
const CONSOLE_CALL = /\bconsole\s*\.\s*(log|info|warn|error|debug|trace|dir|table)\b/;

/**
 * Files that may use `console` directly.
 *  - utils/logger.ts is the sink itself.
 *  - utils/email.ts prints the development "e-mail log" (a developer-facing preview of a message, not an application log).
 * Nothing else: new code logs through utils/logger.
 */
const ALLOWED: Record<string, string> = {
  'utils/logger.ts': 'the structured logger writes to stdout/stderr through console',
  'utils/email.ts': 'development-only preview of an outgoing e-mail, printed for the developer',
};

const listSources = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '__tests__' || entry.name === 'node_modules') return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSources(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [full] : [];
  });

/** Source without comments, so prose that mentions console.log does not count. */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|\s)\/\/.*$/gm, '$1');

const rel = (file: string) => path.relative(SRC, file).split(path.sep).join('/');

describe('structured logging only', () => {
  const files = listSources(SRC);

  it('scans the source tree', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('has no raw console.* call outside the documented allow-list', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (rel(file) in ALLOWED) continue;
      code(fs.readFileSync(file, 'utf8')).split(/\r?\n/).forEach((line, index) => {
        if (CONSOLE_CALL.test(line)) offenders.push(`${rel(file)}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the allow-list honest: every entry names a file that exists', () => {
    for (const entry of Object.keys(ALLOWED)) {
      expect(fs.existsSync(path.join(SRC, entry))).toBe(true);
    }
  });
});
