'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/auth-context';
import { ProfileSkeleton } from './[id]/ProfileClient';

/**
 * /profile redirects signed-in members to their own canonical profile (/profile/:id),
 * or unauthenticated visitors to login with a redirect back here.
 */
export default function ProfileRedirectPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    if (user?.id) {
      router.replace(`/profile/${encodeURIComponent(user.id)}`);
    } else {
      router.replace('/login?redirect=/profile');
    }
  }, [user, isLoading, router]);

  return <ProfileSkeleton />;
}
