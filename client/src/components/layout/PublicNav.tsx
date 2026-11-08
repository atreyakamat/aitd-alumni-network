'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { HeaderSearch, MobileSearchLink } from '@/components/layout/HeaderSearch';
import { PUBLIC_SECTIONS, buildLoginHref, buildRegisterHref, isPublicPath } from '@/lib/public-paths';

const links = [{ href: '/', label: 'Home' }, ...PUBLIC_SECTIONS];

const isActive = (pathname: string | null, href: string) =>
  href === '/' ? pathname === '/' : !!pathname && (pathname === href || pathname.startsWith(`${href}/`));

/**
 * Header for anonymous visitors: the landing page and the public sections
 * (events, gallery, news, donations). Sign-in and sign-up return to the current public page.
 *
 * It deliberately links ONLY to public pages (see PUBLIC_SECTIONS): members-only pages such as the
 * directory or jobs are not advertised here. Search is: it answers visitors with the public content
 * (events, news, chapters) and tells them that signing in unlocks people, jobs and posts.
 */
export function PublicNav() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const returnPath = isPublicPath(pathname) ? pathname : null;
  const loginHref = buildLoginHref(returnPath);
  const registerHref = buildRegisterHref(returnPath);

  return (
    <header className="fixed top-0 z-50 w-full border-b border-slate-200/70 bg-slate-50/70 backdrop-blur-xl shadow-xl shadow-blue-900/5">
      <div className="mx-auto flex h-20 w-full max-w-[1400px] items-center justify-between px-4 md:px-8">
        <Link href="/" className="text-2xl italic text-blue-900 font-headline">
          AITD Connection
        </Link>

        <nav className="hidden items-center space-x-8 md:flex" aria-label="Public sections">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(pathname, link.href) ? 'page' : undefined}
              className={cn(
                'text-sm font-label transition-colors',
                isActive(pathname, link.href)
                  ? 'border-b-2 border-amber-600 pb-1 font-bold text-blue-900'
                  : 'font-medium text-slate-600 hover:text-blue-800'
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Same search box as the member header; visitors get the public results and a note about the rest */}
        <div className="hidden w-60 xl:block">
          <HeaderSearch placeholder="Search events, news, chapters..." />
        </div>

        <div className="flex items-center gap-2 md:gap-4">
          <MobileSearchLink hideFrom="xl" />
          <Button variant="ghost" className="font-label" asChild>
            <Link href={loginHref}>Sign In</Link>
          </Button>
          <Button className="font-label" asChild>
            <Link href={registerHref}>Join Now</Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((o) => !o)}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {mobileOpen && (
        <nav className="border-t border-slate-200/70 bg-slate-50 px-4 py-3 md:hidden" aria-label="Public sections (mobile)">
          <div className="grid grid-cols-2 gap-2">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  'rounded-md px-3 py-2 text-sm font-label',
                  isActive(pathname, link.href) ? 'bg-primary/10 font-bold text-blue-900' : 'text-slate-600'
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}
