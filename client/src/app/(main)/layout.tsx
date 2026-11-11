'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/context/auth-context';
import { MainNav } from '@/components/layout/MainNav';
import { PublicNav } from '@/components/layout/PublicNav';
import { ChatDrawer } from '@/components/layout/ChatDrawer';
import { FullPageLoader } from '@/components/ui/loading';
import { buildLoginHref, isPublicPath } from '@/lib/public-paths';

/**
 * Client-side gate for the (main) group. The platform is private: every page here needs a signed-in, approved member,
 * EXCEPT the one public section (PUBLIC_SECTIONS: /donations, where alumni donate as guests without an account).
 * Defence in depth, in order:
 *  1. `src/middleware.ts` keeps the member app shell from being served to visitors without the
 *     non-secret `aiem_session` hint cookie (anonymous requests get a 307 to /login?next=...).
 *  2. THIS layout renders nothing for a members-only page until `/auth/me` confirms a real session; a visitor is sent
 *     to /login?next=<this page> and lands back here after signing in. On the public section a visitor gets the
 *     public header and the page, which shows a visitor nothing but the donation form.
 *  3. The API enforces authorization (and roles) on every request; the UI checks are UX only.
 */
export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isLoading, isAuthenticated, clearSession } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isPublic = isPublicPath(pathname);

  useEffect(() => {
    if (!isLoading && !isAuthenticated && !isPublic) {
      const current =
        typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : pathname;
      router.replace(buildLoginHref(current));
    }
  }, [isLoading, isAuthenticated, isPublic, pathname, router]);

  // The session of a signed-in member ended while a public page is open (the API client has already cleared the tokens, but
  // it leaves a page that is open to visitors where it is: there is nowhere to bounce a visitor to). Drop to the visitor
  // view here, so the page does not go on acting as a signed-in member (a donation would go out as a guest, without
  // the member details). A members-only page needs nothing: the API client takes the person to the login page.
  useEffect(() => {
    if (!isPublic) return;
    const onSessionEnded = () => clearSession();
    window.addEventListener('api:session_expired', onSessionEnded);
    window.addEventListener('api:account_not_approved', onSessionEnded);
    return () => {
      window.removeEventListener('api:session_expired', onSessionEnded);
      window.removeEventListener('api:account_not_approved', onSessionEnded);
    };
  }, [isPublic, clearSession]);

  if (isLoading) {
    return <FullPageLoader text="Loading..." />;
  }

  if (!isAuthenticated) {
    if (!isPublic) return null;

    return (
      <div className="min-h-screen bg-background relative">
        <PublicNav />
        <main className="container pb-6 pt-28">{children}</main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background relative">
      <MainNav />
      <main className="container py-6">{children}</main>
      <ChatDrawer />
    </div>
  );
}
