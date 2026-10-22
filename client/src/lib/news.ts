import type { NewsCategory } from '@/types';

/** Server `NewsCategory` enum values with display labels. */
export const NEWS_CATEGORIES: ReadonlyArray<{ value: NewsCategory; label: string }> = [
  { value: 'EVENT_RECAP', label: 'Event Recap' },
  { value: 'ALUMNI_STORY', label: 'Alumni Story' },
  { value: 'INSTITUTE_UPDATE', label: 'Institute Update' },
  { value: 'NEWSLETTER', label: 'Newsletter' },
];

export const NEWS_CATEGORY_COLORS: Record<string, string> = {
  EVENT_RECAP: 'bg-green-100 text-green-700',
  ALUMNI_STORY: 'bg-amber-100 text-amber-700',
  INSTITUTE_UPDATE: 'bg-blue-100 text-blue-700',
  NEWSLETTER: 'bg-purple-100 text-purple-700',
};

const titleCase = (value: string) =>
  value
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');

export function newsCategoryLabel(category: string | null | undefined): string {
  if (!category) return 'News';
  return NEWS_CATEGORIES.find((c) => c.value === category)?.label ?? titleCase(category);
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

const decodeEntities = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });

const BLOCK_END = /<\/(p|div|h[1-6]|blockquote|ul|ol|pre|section|article|figure|table)\s*>/gi;

/**
 * Convert article content (plain text or admin-authored HTML) into plain-text
 * paragraphs. No sanitizer ships with the client, so markup is never rendered:
 * tags are stripped (script/style bodies dropped) and the text is rendered by
 * React, which escapes it.
 */
export function contentToParagraphs(content: string | null | undefined): string[] {
  if (!content) return [];
  const text = content
    .replace(/\r\n?/g, '\n')
    .replace(/<(script|style|iframe|noscript)[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/li\s*>/gi, '\n')
    .replace(BLOCK_END, '\n\n')
    .replace(/<[^>]*>/g, '');

  return decodeEntities(text)
    .split(/\n[ \t]*\n+/)
    .map((p) =>
      p
        .split('\n')
        .map((line) => line.replace(/[ \t]+/g, ' ').trim())
        .filter(Boolean)
        .join('\n')
    )
    .filter(Boolean);
}

/** Stored excerpt, or a plain-text excerpt derived from the content. */
export function newsExcerpt(article: { excerpt?: string | null; content?: string | null }, max = 160): string {
  if (article.excerpt && article.excerpt.trim()) return article.excerpt.trim();
  const text = contentToParagraphs(article.content).join(' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}...` : text;
}
