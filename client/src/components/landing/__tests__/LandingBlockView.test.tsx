import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/components/features/StatsSection', () => ({ StatsSection: () => <div>stats</div> }));

import { LandingBlockView } from '@/components/landing/LandingBlockView';

const block = (type: string, config: Record<string, unknown>) =>
  ({ id: 'b1', type, config, order: 0, isPublished: true }) as never;

describe('LandingBlockView links', () => {
  it('links the hero call to action to a page of the site or an https address', () => {
    const { rerender } = render(<LandingBlockView block={block('HERO', { title: 'Hi', ctaText: 'Join', ctaHref: '/register' })} />);
    expect(screen.getByRole('link', { name: 'Join' })).toHaveAttribute('href', '/register');

    rerender(<LandingBlockView block={block('HERO', { title: 'Hi', ctaText: 'Join', ctaHref: 'https://example.edu/apply' })} />);
    expect(screen.getByRole('link', { name: 'Join' })).toHaveAttribute('href', 'https://example.edu/apply');
  });

  it.each([
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a data: URL', 'data:text/html,<script>alert(1)</script>'],
    ['a protocol-relative URL', '//evil.example/x'],
    ['an https URL with credentials', 'https://good.example@evil.example/'],
  ])('renders no link for %s (hero)', (_label, href) => {
    render(<LandingBlockView block={block('HERO', { title: 'Hi', ctaText: 'Join', ctaHref: href })} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it.each([
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a vbscript: URL', 'vbscript:msgbox(1)'],
  ])('renders no link for %s (call-to-action block)', (_label, href) => {
    render(<LandingBlockView block={block('CTA', { title: 'Join', buttonText: 'Go', buttonHref: href })} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('keeps the HTML block in a script-free sandbox', () => {
    const { container } = render(<LandingBlockView block={block('HTML', { html: '<script>alert(1)</script><p>hello</p>' })} />);
    const frame = container.querySelector('iframe');
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('sandbox')).toBe('');
  });
});
