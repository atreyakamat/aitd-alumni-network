'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PUBLIC_SECTIONS, buildLoginHref, buildRegisterHref, isPublicPath } from '@/lib/public-paths';

const isActive = (pathname: string | null, href: string) => !!pathname && (pathname === href || pathname.startsWith(`${href}/`));

/**
 * Header of the pages a visitor may open: the landing page and the guest donation page (the one public section).
 *
 * The platform is private: events, gallery, news, chapters, search and everything else need an approved account, so
 * there is deliberately nothing else to browse here. The section links come from PUBLIC_SECTIONS (just "Donate"): no
 * search box, no links to members-only pages. Sign in and registration bring a visitor on the donation page back to it.
 */
export function PublicNav() {
  const pathname = usePathname();
  const returnPath = isPublicPath(pathname) ? pathname : null;
  const loginHref = buildLoginHref(returnPath);
  const registerHref = buildRegisterHref(returnPath);

  return (
    <header className="fixed top-0 z-50 w-full border-b border-slate-200/70 bg-slate-50/70 backdrop-blur-xl shadow-xl shadow-blue-900/5">
      <div className="mx-auto flex h-20 w-full max-w-[1400px] items-center justify-between gap-2 px-4 md:px-8">
        <Link href="/" className="text-xl italic text-blue-900 font-headline sm:text-2xl">
          AIEM Connection
        </Link>

        <div className="flex items-center gap-1 sm:gap-2 md:gap-4">
          <nav aria-label="Public sections" className="flex items-center">
            {PUBLIC_SECTIONS.map((section) => {
              const active = isActive(pathname, section.href);
              return (
                <Button key={section.href} variant="ghost" className="px-2 font-label sm:px-4" asChild>
                  <Link
                    href={section.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(active && 'font-bold text-blue-900')}
                  >
                    {section.label}
                  </Link>
                </Button>
              );
            })}
          </nav>
          <Button variant="ghost" className="px-2 font-label sm:px-4" asChild>
            <Link href={loginHref}>Sign In</Link>
          </Button>
          <Button className="px-3 font-label sm:px-4" asChild>
            <Link href={registerHref}>Join Now</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
