/**
 * Client-side proof that PostCard renders a stored `post.linkUrl` straight
 * into an anchor `href` with no scheme check
 * (client/src/components/social/PostCard.tsx ~line 105:
 *   <a href={post.linkUrl} target="_blank" rel="noopener noreferrer nofollow ugc">).
 *
 * Paired with server/tests/security/input/stored-xss-url-schemes.sec.test.ts,
 * which shows the server stores a tab-smuggled `javascript:` URI unmodified
 * (it survives sanitizeInput and zod's `.url()` check, which itself
 * normalizes away the tab per the WHATWG URL spec). This test proves the
 * other half of the chain: once such a value reaches the client, nothing
 * here stops it from becoming a clickable `javascript:` link, and the app
 * ships no Content-Security-Policy to fall back on (see platform findings
 * in the final report — confirmed via curl against the dev server; no CSP /
 * X-Frame-Options header at all on http://localhost:3005).
 *
 * Reuses the existing PostCard test harness/mocks/fixtures
 * (src/components/social/__tests__/PostCard.test.tsx, ./fixtures.ts).
 */
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import { makePost } from '@/components/social/__tests__/fixtures';
import type { SocialPost } from '@/lib/social';

const authState = vi.hoisted(() => ({ user: { id: 'me', fullName: 'Me', userRole: 'MEMBER' } as any }));
vi.mock('@/context/auth-context', () => ({ useAuth: () => authState }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

const socialApi = vi.hoisted(() => ({
  react: vi.fn(),
  toggleSave: vi.fn(),
  repost: vi.fn(),
  undoRepost: vi.fn(),
  updatePost: vi.fn(),
  deletePost: vi.fn(),
  comments: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  reactions: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  reportPost: vi.fn(),
  follow: vi.fn(),
  mentionSearch: vi.fn(),
  view: vi.fn(),
}));
vi.mock('@/lib/social', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/social')>()),
  socialApi,
}));

import { PostCard } from '@/components/social/PostCard';

function Harness({ initial }: { initial: SocialPost }) {
  const [post, setPost] = useState(initial);
  return <PostCard post={post} onChange={setPost} />;
}

// What the server is shown (stored-xss-url-schemes.sec.test.ts) to accept and
// return verbatim: a tab character sitting inside the word "javascript".
const TAB_SMUGGLED_JS = 'java\tscript:alert(document.cookie)';

describe('PostCard renders post.linkUrl as a raw href with no scheme check', () => {
  it('a tab-smuggled javascript: linkUrl never becomes a javascript: href', () => {
    const post = makePost({ linkUrl: TAB_SMUGGLED_JS });
    const { container } = render(<Harness initial={post} />);

    // getByText normalizes whitespace (it would hide the embedded tab), so
    // find the link by its href attribute directly instead.
    const link = container.querySelector('a[href*="alert(document.cookie)"]');
    // Secure outcomes: the link is not rendered at all (PostCard now drops it via safeHref),
    // or it is rendered with a neutralised href. Either way nothing may navigate to javascript:.
    const href = link?.getAttribute('href') ?? '';
    for (const a of Array.from(container.querySelectorAll('a[href]'))) {
      expect(a.getAttribute('href')?.replace(/[\s\u0000-\u001f]/g, '').toLowerCase()).not.toMatch(/^javascript:/);
    }

    // SECURE expectation: the component should refuse to render (or should
    // neutralize) an href whose scheme — once control characters a browser
    // would strip are accounted for — is javascript:.
    let normalizedProtocol = '';
    try {
      normalizedProtocol = new URL(href).protocol;
    } catch {
      /* not parseable -> fine */
    }
    expect(normalizedProtocol).not.toBe('javascript:');
  });

  it('control: a plain http(s) linkUrl renders safely with noopener/noreferrer', () => {
    const post = makePost({ linkUrl: 'https://example.com/safe' });
    render(<Harness initial={post} />);
    const link = screen.getByText('https://example.com/safe').closest('a');
    expect(link).toHaveAttribute('href', 'https://example.com/safe');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(link).toHaveAttribute('target', '_blank');
  });
});
