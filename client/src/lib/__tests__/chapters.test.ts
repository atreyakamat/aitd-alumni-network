import { describe, expect, it } from 'vitest';
import {
  canEditChapter,
  chapterMemberCount,
  chapterRegions,
  validateChapterForm,
} from '@/lib/chapters';

const chapters = [
  { id: 'c1', name: 'Delhi NCR', region: 'North India', description: 'Capital crew', memberCount: 4 },
  { id: 'c2', name: 'Bay Area', region: 'USA', description: null, memberCount: 2, _count: { memberships: 7, events: 1 } },
  { id: 'c3', name: 'Mumbai', region: 'West India', description: 'Financial capital', memberCount: 0 },
  { id: 'c4', name: 'Seattle', region: 'usa ', description: '', memberCount: 1 },
] as any[];

describe('chapterRegions', () => {
  it('lists unique, sorted, trimmed regions', () => {
    expect(chapterRegions(chapters)).toEqual(['North India', 'USA', 'West India']);
  });
});

describe('chapterMemberCount', () => {
  it('prefers the live membership count over the cached counter', () => {
    expect(chapterMemberCount(chapters[1])).toBe(7);
    expect(chapterMemberCount(chapters[0])).toBe(4);
    expect(chapterMemberCount({} as any)).toBe(0);
  });
});

describe('canEditChapter', () => {
  const chapter = { adminUserId: 'u1' };
  it('allows platform admins for any chapter', () => {
    expect(canEditChapter({ id: 'x', role: 'ADMIN' }, chapter)).toBe(true);
    expect(canEditChapter({ id: 'x', userRole: 'SUPER_ADMIN' }, chapter)).toBe(true);
  });

  it('allows the chapter admin of that chapter only', () => {
    expect(canEditChapter({ id: 'u1', role: 'CHAPTER_ADMIN' }, chapter)).toBe(true);
    expect(canEditChapter({ id: 'u2', role: 'CHAPTER_ADMIN' }, chapter)).toBe(false);
  });

  it('denies members and anonymous users', () => {
    expect(canEditChapter({ id: 'u1', role: 'MEMBER' }, chapter)).toBe(false);
    expect(canEditChapter(null, chapter)).toBe(false);
    expect(canEditChapter({ id: 'u1', role: 'ADMIN' }, null)).toBe(false);
  });
});

describe('validateChapterForm', () => {
  it('requires name and region', () => {
    expect(validateChapterForm({ name: ' ', region: '', description: '', logoUrl: '' })).toEqual({
      name: 'Name is required',
      region: 'Region is required',
    });
  });

  it('accepts only http(s) logo URLs', () => {
    expect(validateChapterForm({ name: 'A', region: 'B', description: '', logoUrl: 'javascript:alert(1)' })).toEqual({
      logoUrl: 'Enter a valid http(s) URL',
    });
    expect(validateChapterForm({ name: 'A', region: 'B', description: '', logoUrl: 'https://x.org/l.png' })).toEqual({});
  });
});
