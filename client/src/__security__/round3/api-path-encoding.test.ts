// @vitest-environment node
/**
 * ROUND 3 (client, R3-10) - every id, slug or token the API client puts into a URL path is percent-encoded.
 *
 * Why: an id that contains `/`, `?`, `#` or `..` (a profile route accepts any last URL segment, so an attacker can hand a member a
 * link that carries one) would otherwise change WHICH endpoint the member's own bearer token is sent to: `/posts/${id}` with
 * `id = "x/../../admin/export/users"` is a request to another route. Round 2 found 56 such calls; this test is the rule that
 * stops a new one: any `${...}` inside an API path template in `src/lib` must be wrapped in `seg(...)` / `encodeURIComponent(...)`.
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const LIB = path.resolve(__dirname, '../../lib');

const sources = (): string[] =>
  fs
    .readdirSync(LIB)
    .filter((name) => /\.tsx?$/.test(name))
    .map((name) => path.join(LIB, name));

/** Template literals that are API paths: they start with `/` right after the backtick. */
const pathTemplates = (code: string): Array<{ text: string; line: number }> => {
  const found: Array<{ text: string; line: number }> = [];
  const re = /`(\/[^`]*)`/g;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    if (!m[1].includes('${')) continue;
    found.push({ text: m[1], line: code.slice(0, m.index).split('\n').length });
  }
  return found;
};

/** The expressions inside `${...}` (one level of nested braces and parentheses is enough for what the client writes). */
const expressions = (template: string): string[] => {
  const out: string[] = [];
  for (let i = template.indexOf('${'); i !== -1; i = template.indexOf('${', i + 2)) {
    let depth = 1;
    let j = i + 2;
    while (j < template.length && depth > 0) {
      if (template[j] === '{') depth++;
      else if (template[j] === '}') depth--;
      j++;
    }
    out.push(template.slice(i + 2, j - 1).trim());
  }
  return out;
};

const isEncoded = (expression: string) => /^(seg|encodeURIComponent)\(/.test(expression);

const offenders = (): string[] => {
  const bad: string[] = [];
  for (const file of sources()) {
    for (const { text, line } of pathTemplates(fs.readFileSync(file, 'utf8'))) {
      for (const expression of expressions(text)) {
        if (!isEncoded(expression)) bad.push(`${path.basename(file)}:${line}  \`${text}\`  ->  \${${expression}}`);
      }
    }
  }
  return bad;
};

describe('R3: API path segments are encoded', () => {
  it('no API path in src/lib interpolates a value without seg() or encodeURIComponent()', () => {
    expect(offenders()).toEqual([]);
  });

  it('the scanner itself sees the calls it is meant to guard (a guard that finds nothing guards nothing)', () => {
    const all = sources().flatMap((file) => pathTemplates(fs.readFileSync(file, 'utf8')));
    expect(all.length).toBeGreaterThan(60);
    // and it flags what it should
    expect(expressions('/posts/${id}/like').filter((e) => !isEncoded(e))).toEqual(['id']);
    expect(expressions('/posts/${seg(id)}/like').filter((e) => !isEncoded(e))).toEqual([]);
    expect(expressions('/a/${encodeURIComponent(x)}/${seg(y)}?q=${z}').filter((e) => !isEncoded(e))).toEqual(['z']);
  });

  it('seg() leaves nothing that can change the route: slashes, dots, queries and fragments are escaped', () => {
    const seg = (id: string) => encodeURIComponent(id);
    for (const hostile of ['../../admin/export/users', 'a/b', 'x?role=ADMIN', 'x#frag', '..%2F..', 'a b', '\u0000']) {
      const url = new URL(`http://api.test/api/posts/${seg(hostile)}/like`);
      expect(url.pathname.split('/').filter(Boolean).length).toBe(4); // api, posts, <one segment>, like
      expect(url.search).toBe('');
      expect(url.hash).toBe('');
    }
  });
});
