'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Menu, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { PUBLIC_SECTIONS, buildLoginHref, buildRegisterHref, isPublicPath } from '@/lib/public-paths';

const links = [{ href: '/', label: 'Home' }, ...PUBLIC_SECTIONS];

const isActive = (pathname: string | null, href: string) =>
  href === '/' ? pathname === '/' : !!pathname && (pathname === href || pathname.startsWith(`${href}/`));

/**
 * Header for anonymous visitors: the landing page and the public sections
 * (events, gallery, news, donations). Sign-in and sign-up return to the current public page.
 */
export function PublicNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const returnPath = isPublicPath(pathname) ? pathname : null;
  const loginHref = buildLoginHref(returnPath);
  const registerHref = buildRegisterHref(returnPath);

  return (
    <header className="fixed top-0 z-50 w-full border-b border-slate-200/70 bg-slate-50/70 backdrop-blur-xl shadow-xl shadow-blue-900/5">
      <div className="mx-auto flex h-20 w-full max-w-[1400px] items-center justify-between px-4 md:px-8">
        <Link href="/" className="text-2xl italic text-blue-900 font-headline">
          AIEM Connection
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

        <div className="flex items-center gap-2 md:gap-4">
          <form
            role="search"
            className="relative hidden lg:block"
            onSubmit={(e) => {
              e.preventDefault();
              const q = new FormData(e.currentTarget).get('q');
              if (typeof q === 'string' && q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
            }}
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              name="q"
              type="text"
              placeholder="Search the network..."
              aria-label="Search the network"
              className="h-10 w-64 rounded-full border-none bg-slate-100 pl-10 pr-4 text-sm focus-visible:ring-2 focus-visible:ring-primary"
            />
          </form>
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
