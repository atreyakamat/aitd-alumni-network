/**
 * Component-level proofs that API-supplied URLs go through src/lib/safe-url.ts before reaching the DOM.
 * (PostCard.linkUrl has its own proof in post-link-xss.test.tsx.)
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const getListing = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  marketplaceApi: { getListing },
}));

import { Avatar } from '@/components/ui/avatar';
import { AvatarImage } from '@/components/ui/avatar';
import { RichText } from '@/components/social/RichText';
import { ListingDetailDialog } from '@/components/marketplace/ListingDetailDialog';
import { mediaSrc } from '@/lib/social';
import { getNotificationHref } from '@/lib/notifications';

const EVIL = ['java\tscript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x', '//evil.com'];

const listing = (website: string) => ({
  id: 'l1',
  userId: 'owner',
  title: 'Cafe',
  description: 'Great coffee',
  category: 'FOOD',
  type: 'BUSINESS',
  website,
  user: { id: 'owner', fullName: 'Owner Person' },
  createdAt: '2026-01-01T00:00:00.000Z',
});

function renderListing(website: string) {
  getListing.mockResolvedValue({ data: { data: listing(website) } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ListingDetailDialog listingId="l1" onClose={() => undefined} onEdit={() => undefined} />
    </QueryClientProvider>
  );
}

describe('marketplace website link', () => {
  it.each(EVIL)('does not render %j as a link', async (website) => {
    renderListing(website);
    await screen.findByText('Cafe');
    expect(screen.queryByRole('link', { name: /visit website/i })).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toMatch(/href="[^"]*(script|data:|vbscript)/i);
  });

  it('renders a normal https website with the full rel set', async () => {
    renderListing('https://cafe.example.com');
    const link = await screen.findByRole('link', { name: /visit website/i });
    expect(link).toHaveAttribute('href', 'https://cafe.example.com');
    expect(link).toHaveAttribute('target', '_blank');
    for (const token of ['noopener', 'noreferrer', 'nofollow', 'ugc']) expect(link.getAttribute('rel')).toContain(token);
  });
});

describe('RichText', () => {
  it('links plain https URLs with hardened rel and does not link anything else', () => {
    render(<RichText text="see https://example.com/a and #tag" />);
    const link = screen.getByRole('link', { name: 'https://example.com/a' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('ugc');
    expect(document.querySelector('a[href^="javascript" i]')).toBeNull();
  });
});

describe('media sources', () => {
  it.each(EVIL)('mediaSrc drops %j', (src) => expect(mediaSrc(src)).toBe(''));
  it('mediaSrc keeps http(s) and resolves /uploads paths', () => {
    expect(mediaSrc('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png');
    expect(mediaSrc('/uploads/a.png')).toMatch(/\/uploads\/a\.png$/);
  });

  it('AvatarImage never forwards an unsafe src (Radix renders nothing, so no <img> with it)', () => {
    const { container } = render(
      <Avatar>
        <AvatarImage src="java&#9;script:alert(1)" alt="" />
        <AvatarImage src={'data:text/html,<script>alert(1)</script>'} alt="" />
      </Avatar>
    );
    expect(container.innerHTML).not.toMatch(/script:|data:text/i);
  });
});

describe('notification links', () => {
  it.each(['/\t/evil.com', '//evil.com', '/\\evil.com', '/\n/evil.com', 'javascript:alert(1)'])('refuses %j', (link) => {
    expect(getNotificationHref({ link }, 'http://localhost:3005')).toBeNull();
  });
  it('still maps normal in-app links', () => {
    expect(getNotificationHref({ link: '/events/1' }, 'http://localhost:3005')).toBe('/events/1');
  });
});
