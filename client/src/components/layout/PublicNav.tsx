import Link from 'next/link';
import { Button } from '@/components/ui/button';

/**
 * Header of the landing page, the only page a visitor sees besides the auth screens and the legal pages.
 *
 * The platform is private: events, gallery, news, donations, chapters, search and everything else need an approved
 * account, so there is deliberately nothing to browse here. No section links, no search box. Both buttons are plain
 * links: a visitor has no public page to come back to.
 */
export function PublicNav() {
  return (
    <header className="fixed top-0 z-50 w-full border-b border-slate-200/70 bg-slate-50/70 backdrop-blur-xl shadow-xl shadow-blue-900/5">
      <div className="mx-auto flex h-20 w-full max-w-[1400px] items-center justify-between px-4 md:px-8">
        <Link href="/" className="text-2xl italic text-blue-900 font-headline">
          AIEM Connection
        </Link>

        <div className="flex items-center gap-2 md:gap-4">
          <Button variant="ghost" className="font-label" asChild>
            <Link href="/login">Sign In</Link>
          </Button>
          <Button className="font-label" asChild>
            <Link href="/register">Join Now</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
