'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { hasMinRole, roleLabel, type Role } from '@/lib/roles';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading';

interface RequireRoleProps {
  /** Minimum role in the MEMBER < CHAPTER_ADMIN < ADMIN < SUPER_ADMIN hierarchy. */
  min: Role;
  children: React.ReactNode;
  /** Rendered instead of the default access-denied card. */
  fallback?: React.ReactNode;
  /** When set, unauthorized users are redirected here (replace) as well. */
  redirectTo?: string;
}

/**
 * Client-side role gate (UX only, PRD §11.4). The server enforces access;
 * this only avoids showing privileged screens to users who cannot use them.
 */
export function RequireRole({ min, children, fallback, redirectTo }: RequireRoleProps) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const allowed = !!user && hasMinRole(user, min);

  React.useEffect(() => {
    if (!isLoading && !allowed && redirectTo) {
      router.replace(redirectTo);
    }
  }, [isLoading, allowed, redirectTo, router]);

  if (isLoading) {
    return (
      <div role="status" aria-live="polite" className="min-h-[40vh] flex flex-col items-center justify-center gap-3">
        <LoadingSpinner size="lg" />
        <p className="text-sm text-muted-foreground">Checking access...</p>
      </div>
    );
  }

  if (!allowed) {
    if (fallback !== undefined) return <>{fallback}</>;
    return <AccessDenied min={min} />;
  }

  return <>{children}</>;
}

export function AccessDenied({ min }: { min: Role }) {
  return (
    <div className="min-h-[50vh] flex items-center justify-center">
      <Card className="max-w-md w-full">
        <CardContent className="pt-6 text-center">
          <ShieldAlert className="h-12 w-12 text-destructive mx-auto mb-4" aria-hidden="true" />
          <h2 className="text-xl font-bold mb-2">Access denied</h2>
          <p className="text-muted-foreground mb-6">
            This area requires the {roleLabel(min)} role or higher. If you think this is a mistake, contact a
            platform administrator.
          </p>
          <Button asChild>
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
