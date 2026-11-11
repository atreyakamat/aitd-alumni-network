import { describe, expect, it, vi } from 'vitest';

const redirect = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ redirect }));

import AdminControlPage, { metadata } from '@/app/(main)/admin/control/page';

describe('/admin/control (the retired Control Center)', () => {
  it('sends old bookmarks to /admin/status', () => {
    redirect.mockClear();
    AdminControlPage();
    expect(redirect).toHaveBeenCalledWith('/admin/status');
  });

  it('is a server component: no client-only code, so the redirect happens on the server', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'control', 'page.tsx'), 'utf8');
    expect(source).not.toMatch(/['"]use client['"]/);
    expect(source).not.toMatch(/platformApi|Platform Team|Planned Modules|Control Center/);
  });

  it('still has a browser-tab title of its own', () => {
    expect(String(metadata.title)).toBe('System status | AIEM Connect');
  });
});
