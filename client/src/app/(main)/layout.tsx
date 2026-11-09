'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/context/auth-context';
import { MainNav } from '@/components/layout/MainNav';
import { ChatDrawer } from '@/components/layout/ChatDrawer';
import { FullPageLoader } from '@/components/ui/loading';
import { buildLoginHref } from '@/lib/public-paths';

/**
 * Client-side gate for the (main) group. The platform is private: EVERY page here needs a signed-in, approved member.
 * Defence in depth, in order:
 *  1. `src/middleware.ts` keeps the member app shell from being served to visitors without the
 *     non-secret `aitd_session` hint cookie (anonymous requests get a 307 to /login?next=...).
 *  2. THIS layout renders nothing until `/auth/me` confirms a real session; a visitor is sent to
 *     /login?next=<this page> and lands back here after signing in.
 *  3. The API enforces authorization (and roles) on every request; the UI checks are UX only.
 */
export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isLoading, isAuthenticated } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      const current =
        typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : pathname;
      router.replace(buildLoginHref(current));
    }
  }, [isLoading, isAuthenticated, pathname, router]);

  if (isLoading) {
    return <FullPageLoader text="Loading..." />;
  }

  if (!isAuthenticated) return null;

  return (
    <div className="min-h-screen bg-background relative">
      <MainNav />
      <main className="container py-6">{children}</main>
      <ChatDrawer />
    </div>
  );
}
