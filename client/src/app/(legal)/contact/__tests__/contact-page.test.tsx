import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ContactPage from '@/app/(legal)/contact/page';
import { DEFAULT_CONTACT_EMAIL, getContactEmail, mailtoHref } from '@/lib/contact';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('contact helpers', () => {
  it('uses NEXT_PUBLIC_CONTACT_EMAIL when it is a valid address', () => {
    expect(getContactEmail(' team@example.org ')).toBe('team@example.org');
  });

  it('falls back for missing or malformed values', () => {
    expect(getContactEmail(undefined)).toBe(DEFAULT_CONTACT_EMAIL);
    expect(getContactEmail('')).toBe(DEFAULT_CONTACT_EMAIL);
    expect(getContactEmail('not-an-email')).toBe(DEFAULT_CONTACT_EMAIL);
    // Anything that could smuggle extra mailto parameters is rejected.
    expect(getContactEmail('a@b.org?bcc=evil@x.y')).toBe(DEFAULT_CONTACT_EMAIL);
    expect(getContactEmail('a@b.org?subject=x')).toBe(DEFAULT_CONTACT_EMAIL);
  });

  it('builds mailto links with encoded subjects', () => {
    expect(mailtoHref('a@b.org')).toBe('mailto:a@b.org');
    expect(mailtoHref('a@b.org', 'Privacy request')).toBe('mailto:a@b.org?subject=Privacy%20request');
  });
});

describe('Contact page', () => {
  it('renders the fallback contact email and topic links', () => {
    vi.stubEnv('NEXT_PUBLIC_CONTACT_EMAIL', '');
    render(<ContactPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Contact Us' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: DEFAULT_CONTACT_EMAIL })).toHaveAttribute('href', `mailto:${DEFAULT_CONTACT_EMAIL}`);
    const topicLinks = screen.getAllByRole('link', { name: 'Email about this' });
    expect(topicLinks).toHaveLength(4);
    expect(topicLinks[2]).toHaveAttribute('href', `mailto:${DEFAULT_CONTACT_EMAIL}?subject=Privacy%20request`);
  });

  it('uses the configured contact email', () => {
    vi.stubEnv('NEXT_PUBLIC_CONTACT_EMAIL', 'alumni@example.org');
    render(<ContactPage />);
    expect(screen.getByRole('link', { name: 'alumni@example.org' })).toHaveAttribute('href', 'mailto:alumni@example.org');
  });

  it('links to related pages that exist', () => {
    render(<ContactPage />);
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(expect.arrayContaining(['/privacy', '/terms', '/cookies', '/settings', '/forgot-password']));
  });
});
