import { isAdmin, isChapterAdminOrAbove } from '@/lib/roles';
import type { Chapter } from '@/types';

export const ALL_REGIONS = 'ALL';

/**
 * Unique regions (first spelling wins, case-insensitive), sorted. Fallback for
 * list responses without the server's `regions` array.
 */
export function chapterRegions(chapters: Array<Pick<Chapter, 'region'>>): string[] {
  const seen = new Map<string, string>();
  for (const c of chapters) {
    const label = typeof c.region === 'string' ? c.region.trim() : '';
    if (label && !seen.has(label.toLowerCase())) seen.set(label.toLowerCase(), label);
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
}

export function chapterMemberCount(chapter: Partial<Pick<Chapter, 'memberCount' | '_count'>>): number {
  return chapter._count?.memberships ?? chapter.memberCount ?? 0;
}

/**
 * UX gate mirroring PATCH /chapters/:id: ADMIN+ for any chapter, or a
 * CHAPTER_ADMIN who is that chapter's admin. The server enforces.
 */
export function canEditChapter(
  user: { id?: string; role?: unknown; userRole?: unknown } | null | undefined,
  chapter: { adminUserId?: string | null } | null | undefined
): boolean {
  if (!user || !chapter) return false;
  if (isAdmin(user)) return true;
  return isChapterAdminOrAbove(user) && !!user.id && chapter.adminUserId === user.id;
}

export interface ChapterFormValues {
  name: string;
  region: string;
  description: string;
  logoUrl: string;
}

export function validateChapterForm(values: ChapterFormValues): Partial<Record<keyof ChapterFormValues, string>> {
  const errors: Partial<Record<keyof ChapterFormValues, string>> = {};
  if (!values.name.trim()) errors.name = 'Name is required';
  if (!values.region.trim()) errors.region = 'Region is required';
  const logo = values.logoUrl.trim();
  if (logo) {
    let ok = false;
    try {
      const url = new URL(logo);
      ok = url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
      ok = false;
    }
    if (!ok) errors.logoUrl = 'Enter a valid http(s) URL';
  }
  return errors;
}
