/**
 * Source-level guardrails for token handling (tokens live in localStorage, so they must never be
 * logged, placed in URLs, or sent to a host other than the API).
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === '__security__' || entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(SRC).map((file) => ({ file: path.relative(SRC, file), text: fs.readFileSync(file, 'utf8') }));

describe('token hygiene', () => {
  it('scans a meaningful number of source files', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('never passes a token, Authorization header or OAuth code to console.*', () => {
    const offenders: string[] = [];
    for (const { file, text } of files) {
      text.split('\n').forEach((line, i) => {
        if (/console\.(log|info|warn|error|debug|trace)\(/.test(line) && /(accessToken|refreshToken|authorization|bearer|\btoken\b|oauth.*code)/i.test(line)) {
          offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('never puts a token in a URL (query string or path)', () => {
    const offenders: string[] = [];
    for (const { file, text } of files) {
      text.split('\n').forEach((line, i) => {
        const l = line.trim();
        if (l.startsWith('//') || l.startsWith('*')) return;
        if (/[?&](access_?token|refresh_?token|token)=/i.test(l) && /(accessToken|refreshToken|localStorage)/.test(l)) offenders.push(`${file}:${i + 1}: ${l}`);
        if (/\$\{[^}]*(accessToken|refreshToken)[^}]*\}/.test(l) && /(href|url|push|replace|open|fetch|get|post)\b/i.test(l) && !/Authorization|Bearer/.test(l)) {
          offenders.push(`${file}:${i + 1}: ${l}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('only reads tokens from localStorage inside the auth plumbing', () => {
    const allowed = new Set(['context/auth-context.tsx', 'lib/api.ts', 'hooks/use-socket.ts']);
    const readers = files
      .filter(({ text }) => /localStorage\.(getItem|setItem)\(\s*['"](accessToken|refreshToken)['"]/.test(text))
      .map(({ file }) => file.replace(/\\/g, '/'))
      .filter((file) => !allowed.has(file));
    // components/settings/ChangePasswordCard.tsx must go through setAuthData, not touch storage itself.
    expect(readers).toEqual([]);
  });

  it('sends the bearer token only through the API client (axios instance) or the socket handshake', () => {
    const offenders = files
      .filter(({ text }) => /Authorization['"]?\s*[:=]/.test(text) || /headers\.Authorization/.test(text))
      .map(({ file }) => file.replace(/\\/g, '/'))
      .filter((file) => file !== 'lib/api.ts');
    expect(offenders).toEqual([]);
  });
});
