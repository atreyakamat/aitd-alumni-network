import { describe, expect, it } from 'vitest';
import {
  NEWS_CATEGORIES,
  contentToParagraphs,
  newsCategoryLabel,
  newsExcerpt,
} from '@/lib/news';

describe('news categories', () => {
  it('mirrors the server NewsCategory enum', () => {
    expect(NEWS_CATEGORIES.map((c) => c.value)).toEqual([
      'EVENT_RECAP',
      'ALUMNI_STORY',
      'INSTITUTE_UPDATE',
      'NEWSLETTER',
    ]);
  });

  it('labels known categories and falls back for unknown ones', () => {
    expect(newsCategoryLabel('ALUMNI_STORY')).toBe('Alumni Story');
    expect(newsCategoryLabel('SOMETHING_NEW')).toBe('Something New');
    expect(newsCategoryLabel(undefined)).toBe('News');
  });
});

describe('contentToParagraphs', () => {
  it('splits plain text on blank lines', () => {
    expect(contentToParagraphs('First para\nstill first\n\nSecond')).toEqual([
      'First para\nstill first',
      'Second',
    ]);
  });

  it('turns HTML into plain-text paragraphs without any markup', () => {
    const html = '<h2>Title</h2><p>Hello <strong>world</strong>.</p><p>Line<br/>break</p><ul><li>a</li><li>b</li></ul>';
    expect(contentToParagraphs(html)).toEqual(['Title', 'Hello world.', 'Line\nbreak', 'a\nb']);
  });

  it('drops script/style content entirely and decodes entities once', () => {
    const html = '<p>Safe &amp; sound &lt;b&gt;</p><script>alert(1)</script><style>p{}</style><p>&#39;quoted&#39;</p>';
    expect(contentToParagraphs(html)).toEqual(['Safe & sound <b>', "'quoted'"]);
  });

  it('returns an empty list for empty content', () => {
    expect(contentToParagraphs('')).toEqual([]);
    expect(contentToParagraphs(null)).toEqual([]);
    expect(contentToParagraphs('<p> </p>')).toEqual([]);
  });
});

describe('newsExcerpt', () => {
  it('prefers the stored excerpt', () => {
    expect(newsExcerpt({ excerpt: 'Short', content: '<p>Long</p>' })).toBe('Short');
  });

  it('derives a trimmed plain-text excerpt from content', () => {
    const text = newsExcerpt({ content: `<p>${'word '.repeat(60)}</p>` }, 20);
    expect(text.endsWith('...')).toBe(true);
    expect(text).not.toContain('<');
    expect(text.length).toBeLessThanOrEqual(23);
  });
});
