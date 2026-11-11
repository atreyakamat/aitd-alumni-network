import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Every page has its own title ("Directory | AIEM Connect"), so a browser tab, a bookmark and the history list say where
 * you are. Pages are client components and cannot export metadata themselves, so a route gets its title from a
 * `layout.tsx` next to it (or from `generateMetadata` in a server page). This guard fails when a page is added without one.
 */

const APP = path.join(__dirname, '..', 'app');

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });

/** Route groups such as `(main)` share a layout that has no title of its own. */
const isGroupLevel = (dir: string) => path.dirname(dir) === APP;

const hasTitle = (file: string) => {
  if (!fs.existsSync(file)) return false;
  const source = fs.readFileSync(file, 'utf8');
  return /export const metadata\b|export (async )?function generateMetadata\b/.test(source) && /title/.test(source);
};

const titleSources = (pageFile: string): string[] => {
  const sources = [pageFile];
  let dir = path.dirname(pageFile);
  while (dir.startsWith(APP) && dir !== APP) {
    if (!isGroupLevel(dir)) sources.push(path.join(dir, 'layout.tsx'));
    dir = path.dirname(dir);
  }
  return sources;
};

const pages = walk(APP)
  .filter((file) => path.basename(file) === 'page.tsx')
  // the landing page ("/") uses the site-wide default title
  .filter((file) => path.dirname(file) !== APP);

describe('page titles', () => {
  it('finds the pages', () => {
    expect(pages.length).toBeGreaterThan(40);
  });

  it('every page has a title of its own', () => {
    const untitled = pages
      .filter((page) => !titleSources(page).some(hasTitle))
      .map((page) => path.relative(APP, page).split(path.sep).join('/'));
    expect(untitled).toEqual([]);
  });

  it('every title names the product, through the shared helper or in full', () => {
    const wrong: string[] = [];
    for (const page of pages) {
      const file = titleSources(page).find(hasTitle);
      if (!file) continue;
      const source = fs.readFileSync(file, 'utf8');
      const usesHelper = /pageTitle\(/.test(source);
      const spellsItOut = /\| AIEM Connect/.test(source);
      const generated = /generateMetadata/.test(source);
      if (!usesHelper && !spellsItOut && !generated) wrong.push(path.relative(APP, file).split(path.sep).join('/'));
    }
    expect(wrong).toEqual([]);
  });
});
