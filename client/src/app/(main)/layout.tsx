'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/context/auth-context';
import { MainNav } from '@/components/layout/MainNav';
import { PublicNav } from '@/components/layout/PublicNav';
import { ChatDrawer } from '@/components/layout/ChatDrawer';
import { FullPageLoader } from '@/components/ui/loading';
import { buildLoginHref, isPublicPath } from '@/lib/public-paths';

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isLoading, isAuthenticated } = useAuth();
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

  if (isLoading) {
    return <FullPageLoader text="Loading..." />;
  }

  if (!isAuthenticated) {
    if (!isPublic) return null;

    // PRD 6.1: events, gallery, news and donations are browsable without an account.
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
