'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Eye } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { getApiErrorMessage, userApi } from '@/lib/api';
import { profileQueryKey, type EditableProfile } from '@/lib/profile';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { BasicInfoSection } from '@/components/profile/BasicInfoSection';
import { PhotosSection } from '@/components/profile/PhotosSection';
import { ContactLinksSection } from '@/components/profile/ContactLinksSection';
import { PrivacySection } from '@/components/profile/PrivacySection';
import { WorkExperienceSection } from '@/components/profile/WorkExperienceSection';
import { EducationSection } from '@/components/profile/EducationSection';
import { SkillsSection } from '@/components/profile/SkillsSection';
import { CompletenessCard } from '@/components/profile/CompletenessCard';

const SECTIONS = [
  { id: 'basic-info', label: 'Basic info' },
  { id: 'photos', label: 'Photos' },
  { id: 'contact', label: 'Contact & links' },
  { id: 'privacy', label: 'Privacy & location' },
  { id: 'experience', label: 'Work experience' },
  { id: 'education', label: 'Education' },
  { id: 'skills', label: 'Skills' },
];

export default function EditProfilePage() {
  const { user, refreshUser } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id;

  const { data: profile, isLoading, error, refetch } = useQuery({
    queryKey: profileQueryKey(userId),
    queryFn: async () => (await userApi.getProfile(userId!)).data.data as EditableProfile,
    enabled: Boolean(userId),
    staleTime: 0,
  });

  // Every section calls this after a successful save: the profile page and the nav avatar/name refresh.
  const handleSaved = React.useCallback(async () => {
    await Promise.all([queryClient.invalidateQueries({ queryKey: profileQueryKey(userId) }), refreshUser()]);
  }, [queryClient, refreshUser, userId]);

  if (!userId || isLoading) {
    return (
      <div className="max-w-5xl mx-auto space-y-4" aria-busy="true">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <Card className="max-w-xl mx-auto">
        <CardContent className="py-10 text-center space-y-4">
          <p role="alert" className="text-sm text-destructive">
            {getApiErrorMessage(error, 'Could not load your profile.')}
          </p>
          <Button variant="outline" onClick={() => refetch()}>
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Edit profile</h1>
          <p className="text-muted-foreground">Each section saves on its own.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href={`/profile/${userId}`}>
              <Eye className="h-4 w-4 mr-2" aria-hidden />
              View profile
            </Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/settings">
              <ArrowLeft className="h-4 w-4 mr-2" aria-hidden />
              Account settings
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="space-y-6 min-w-0">
          <BasicInfoSection profile={profile} onSaved={handleSaved} />
          <PhotosSection profile={profile} onSaved={handleSaved} />
          <ContactLinksSection profile={profile} onSaved={handleSaved} />
          <PrivacySection profile={profile} onSaved={handleSaved} />
          <WorkExperienceSection experiences={profile.workExperiences ?? []} onSaved={handleSaved} />
          <EducationSection educations={profile.educations ?? []} onSaved={handleSaved} />
          <SkillsSection skills={profile.skills} onSaved={handleSaved} />
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <CompletenessCard score={user?.profileCompleteness ?? profile.profileCompleteness ?? 0} profile={profile} />
          <nav aria-label="Profile sections" className="hidden lg:block">
            <ul className="space-y-1 text-sm">
              {SECTIONS.map((section) => (
                <li key={section.id}>
                  <a href={`#${section.id}`} className="block rounded px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                    {section.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
      </div>
    </div>
  );
}
