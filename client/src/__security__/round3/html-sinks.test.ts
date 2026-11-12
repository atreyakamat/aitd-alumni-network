// @vitest-environment node
/**
 * ROUND 3 (client) - the places where text from the API could become markup or a link are few, known and guarded.
 *
 *  1. No raw-HTML sink anywhere (dangerouslySetInnerHTML, innerHTML, outerHTML, insertAdjacentHTML, document.write, eval, new Function).
 *  2. The one document-in-a-document (the admin "custom HTML" landing block) is a sandboxed iframe with NO sandbox permissions.
 *  3. Plain `<a href={...}>` elements fed by data go through the URL allowlists (safeHref / mediaSrc / safeMediaSrc / safeInternalPath);
 *     a new raw one fails here until somebody decides it is safe and adds it to the list below with a reason.
 *  4. Code that navigates away (window.open, location assignment) is on the reviewed list.
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '../..');

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return ['__tests__', '__security__', 'node_modules'].includes(entry.name) ? [] : walk(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });

const files = walk(SRC).map((file) => ({ file: path.relative(SRC, file).replace(/\\/g, '/'), code: fs.readFileSync(file, 'utf8') }));
const lineOf = (code: string, index: number) => code.slice(0, index).split('\n').length;

describe('R3: raw-HTML sinks', () => {
  it('there is none', () => {
    const banned = /dangerouslySetInnerHTML|\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write\(|\beval\(|new Function\(/g;
    const found = files.flatMap(({ file, code }) => [...code.matchAll(banned)].map((m) => `${file}:${lineOf(code, m.index ?? 0)} ${m[0]}`));
    expect(found).toEqual([]);
  });

  it('srcDoc is used once, in the landing block, and the frame carries an empty sandbox (no scripts, no forms, no top navigation, same-origin off)', () => {
    const users = files.filter(({ code }) => /srcDoc\s*=|srcdoc\s*=/.test(code)).map(({ file }) => file);
    expect(users).toEqual(['components/landing/LandingBlockView.tsx']);
    const code = files.find(({ file }) => file === 'components/landing/LandingBlockView.tsx')!.code;
    const frame = code.slice(code.indexOf('<iframe'), code.indexOf('/>', code.indexOf('<iframe')));
    expect(frame).toMatch(/sandbox=""/);
    expect(frame).not.toMatch(/allow-/);
  });

  it('no other iframe, embed or object element exists (the Razorpay checkout is a script, not a frame)', () => {
    const found = files.filter(({ code }) => /<(iframe|embed|object)\b/.test(code)).map(({ file }) => file);
    expect(found).toEqual(['components/landing/LandingBlockView.tsx']);
  });
});

describe('R3: links built from data', () => {
  // `<a ... href={EXPRESSION}`: the expression must be one of the guarded forms, a literal path, an anchor or a mailto
  const GUARDED = /^(safeHref\(|safeMediaSrc\(|mediaSrc\(|safeInternalPath\(|mailtoHref\()/;
  const LITERAL = /^(`\/|`#|`mailto:|"\/|"#|'\/|'#)/;

  /** Raw `<a href={...}>` that were reviewed: where the value comes from and why it is safe. */
  const REVIEWED: Record<string, string> = {
    // `links` are built from profile URLs run through safeHref in the same file
    'app/(main)/profile/[id]/ProfileClient.tsx#href': 'LINKS.map(...) through safeHref(), https only',
    'app/(main)/admin/moderation/page.tsx#link': 'const link = safeHref(job.applicationLink)',
    'components/admin/RegistrationCard.tsx#link': 'const link = profileHref(a.linkedinUrl): safeHref() and https only',
    'components/social/PostCard.tsx#linkHref': 'const linkHref = safeHref(post.linkUrl)',
    'components/social/RichText.tsx#href': 'const href = safeHref(token.href), a plain span when it is refused',
  };

  it('every <a href={...}> is guarded, a site path, an anchor, a mailto, or reviewed', () => {
    const offenders: string[] = [];
    for (const { file, code } of files) {
      for (const m of code.matchAll(/<a\b[^>]*?\bhref=\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g)) {
        const expression = m[1].trim();
        if (GUARDED.test(expression) || LITERAL.test(expression)) continue;
        if (REVIEWED[`${file}#${expression}`]) continue;
        offenders.push(`${file}:${lineOf(code, m.index ?? 0)} href={${expression}}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every window.open / location assignment is on the reviewed list', () => {
    const REVIEWED_NAVIGATION = new Set([
      'lib/safe-url.ts', // openExternal(): safeHref() first, noopener
      'lib/api.ts', // session-expiry redirect to the login page (buildLoginHref)
      'app/error.tsx', // window.location.href = '/'
      'app/(main)/events/[id]/page.tsx', // https://www.google.com/maps/search/?query=<encodeURIComponent(...)>
    ]);
    const found = files
      .filter(({ code }) => /window\.open\(|location\.href\s*=[^=]|location\.assign\(|location\.replace\(/.test(code))
      .map(({ file }) => file)
      .filter((file) => !REVIEWED_NAVIGATION.has(file));
    expect(found).toEqual([]);
  });

  it('notification links are reduced to a path on this site before they are followed', () => {
    const code = files.find(({ file }) => file === 'lib/notifications.ts')!.code;
    expect(code).toMatch(/safeInternalPath\(raw\)/);
    expect(code).toMatch(/url\.origin === origin/);
  });
});
