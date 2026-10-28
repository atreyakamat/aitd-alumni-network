'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/hooks/use-toast';
import { getApiErrorMessage, networkApi, userApi } from '@/lib/api';
import { formatMonth, isHttpUrl, profileQueryKey } from '@/lib/profile';
import { mediaSrc } from '@/lib/social';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import {
  MapPin,
  Mail,
  Phone,
  Linkedin,
  Github,
  Globe,
  Twitter,
  Briefcase,
  GraduationCap,
  Edit,
  Building,
  Sparkles,
  Check,
  Clock,
  AlertCircle,
  ArrowLeft,
  RefreshCw,
} from 'lucide-react';
import { getInitials } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { ProfileActivity, ProfileFollowBar } from '@/components/social/ProfileSocial';

const LINKS = [
  { field: 'linkedinUrl', label: 'LinkedIn', Icon: Linkedin },
  { field: 'githubUrl', label: 'GitHub', Icon: Github },
  { field: 'twitterUrl', label: 'Twitter / X', Icon: Twitter },
  { field: 'websiteUrl', label: 'Website', Icon: Globe },
] as const;

export function ProfileSkeleton() {
  return (
    <div className="max-w-4xl mx-auto space-y-6" data-testid="profile-skeleton">
      <Card className="overflow-hidden">
        <Skeleton className="h-48 w-full rounded-none" />
        <CardContent className="relative pb-6">
          <div className="flex flex-col sm:flex-row sm:items-end gap-4 -mt-16 sm:-mt-12">
            <Skeleton className="h-32 w-32 rounded-full border-4 border-background shrink-0" />
            <div className="flex-1 space-y-2 mt-2 sm:mt-0">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-4 w-72" />
              <Skeleton className="h-4 w-36" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-10 w-24" />
              <Skeleton className="h-10 w-24" />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="space-y-6">
          <Card>
            <CardHeader><Skeleton className="h-6 w-20" /></CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><Skeleton className="h-6 w-24" /></CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </CardContent>
          </Card>
        </div>
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader><Skeleton className="h-6 w-32" /></CardHeader>
            <CardContent className="space-y-4">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export function ProfileNotFound({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="max-w-2xl mx-auto py-16 px-4" data-testid="profile-not-found">
      <Card className="text-center p-8">
        <div className="flex justify-center mb-4">
          <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
            <AlertCircle className="h-8 w-8" />
          </div>
        </div>
        <CardTitle className="text-2xl font-bold mb-2">Profile Not Found</CardTitle>
        <p className="text-muted-foreground mb-6 max-w-md mx-auto">
          This user profile either doesn't exist, has been deactivated, or is private.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {onRetry && (
            <Button variant="outline" onClick={onRetry} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Try again
            </Button>
          )}
          <Button asChild>
            <Link href="/directory" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back to Directory
            </Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}

export function ProfileClient({ profile: initialProfile, id }: { profile: any; id: string }) {
  const { user } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [connectState, setConnectState] = useState<'idle' | 'sending' | 'sent'>('idle');

  // The server render is anonymous and cached; refetch on mount so signed-in viewers get
  // their personalised view (contact details, own-profile fields, connection status).
  const { data, isLoading, refetch } = useQuery({
    queryKey: profileQueryKey(id),
    queryFn: async () => (await userApi.getProfile(id)).data.data,
    initialData: initialProfile ?? undefined,
    initialDataUpdatedAt: initialProfile ? 0 : undefined,
    retry: false,
  });

  const profile = data ?? initialProfile;

  const isOwnProfile =
    (Boolean(user?.id) && Boolean(profile?.id) && user?.id === profile?.id) ||
    (Boolean(user?.id) && user?.id === id) ||
    Boolean(profile?.isOwnProfile);

  const handleConnect = async () => {
    if (!user) {
      router.push(`/login?redirect=${encodeURIComponent(`/profile/${id}`)}`);
      return;
    }
    setConnectState('sending');
    try {
      await networkApi.sendRequest(id);
      setConnectState('sent');
      toast({ title: 'Connection request sent', description: `${profile?.fullName ?? 'Member'} will be notified.` });
    } catch (err) {
      setConnectState('idle');
      toast({ variant: 'destructive', title: 'Could not send request', description: getApiErrorMessage(err, 'Please try again.') });
    }
  };

  if (isLoading && !profile) {
    return <ProfileSkeleton />;
  }

  if (!profile) {
    return <ProfileNotFound onRetry={() => refetch()} />;
  }

  const links = LINKS.filter(({ field }) => typeof profile[field] === 'string' && isHttpUrl(profile[field]));
  const phone = profile.phone || profile.phoneNumber;
  const skills: string[] = (profile.skills ?? [])
    .map((entry: any) => entry?.skill?.name || (typeof entry === 'string' ? entry : null))
    .filter(Boolean);
  const educations: any[] = profile.educations ?? [];
  const workExperiences: any[] = profile.workExperiences ?? [];
  const hasContact = Boolean(profile.email || phone || profile.secondaryEmail || links.length);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Cover & Profile Header */}
      <Card className="overflow-hidden">
        <div className="h-48 bg-gradient-to-r from-primary to-primary/60">
          {profile.coverPhotoUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- user-uploaded covers come from arbitrary storage hosts
            <img src={mediaSrc(profile.coverPhotoUrl)} alt="" className="h-full w-full object-cover" />
          )}
        </div>
        <CardContent className="relative pb-6">
          <div className="flex flex-col sm:flex-row sm:items-end gap-4 -mt-16 sm:-mt-12">
            <Avatar className="h-32 w-32 border-4 border-white shadow-lg">
              <AvatarImage src={mediaSrc(profile.profilePhotoUrl || profile.avatarUrl) || undefined} alt={profile.fullName} />
              <AvatarFallback className="text-3xl">
                {getInitials(profile.fullName || 'User')}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="flex items-center gap-2 mt-2 sm:mt-0">
                <h1 className="text-2xl font-bold">{profile.fullName}</h1>
                {profile.isVerified && (
                  <Badge variant="secondary" className="bg-blue-100 text-blue-700">
                    Verified
                  </Badge>
                )}
                {profile.membershipTier && (
                  <Badge className="bg-amber-100 text-amber-700">
                    {typeof profile.membershipTier === 'object' ? profile.membershipTier.name : profile.membershipTier}
                  </Badge>
                )}
              </div>
              <p className="text-muted-foreground mt-1">
                {profile.headline || profile.currentDesignation || [profile.department, profile.batchYear ? `Class of ${profile.batchYear}` : null].filter(Boolean).join(', ')}
              </p>
              <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-muted-foreground">
                {(profile.department || profile.batchYear) && (
                  <div className="flex items-center gap-1">
                    <GraduationCap className="h-4 w-4" />
                    <span>{[profile.department, profile.batchYear ? `Batch ${profile.batchYear}` : null].filter(Boolean).join(' • ')}</span>
                  </div>
                )}
                {(profile.city || profile.currentCity || profile.currentCountry) && (
                  <div className="flex items-center gap-1">
                    <MapPin className="h-4 w-4" />
                    <span>{[profile.city || profile.currentCity, profile.currentCountry].filter(Boolean).join(', ')}</span>
                  </div>
                )}
              </div>
              <ProfileFollowBar profile={profile} userId={id} canFollow={Boolean(user) && !isOwnProfile} />
            </div>
            <div className="flex gap-2">
              {isOwnProfile ? (
                <Button variant="outline" asChild>
                  <Link href="/profile/edit">
                    <Edit className="h-4 w-4 mr-2" />
                    Edit profile
                  </Link>
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (!user) {
                        router.push(`/login?redirect=${encodeURIComponent(`/profile/${id}`)}`);
                        return;
                      }
                      router.push(`/messages?u=${id}`);
                    }}
                  >
                    Message
                  </Button>
                  {profile.isConnected || profile.connectionStatus === 'ACCEPTED' ? (
                    <Button variant="secondary" disabled className="gap-1.5">
                      <Check className="h-4 w-4" />
                      Connected
                    </Button>
                  ) : connectState === 'sent' || profile.connectionStatus === 'PENDING' ? (
                    <Button variant="outline" disabled className="gap-1.5">
                      <Clock className="h-4 w-4" />
                      Request sent
                    </Button>
                  ) : (
                    <Button onClick={handleConnect} disabled={connectState === 'sending'}>
                      {connectState === 'sending' ? 'Connecting...' : 'Connect'}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">About</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground whitespace-pre-line">{profile.bio || profile.shortBio || 'No bio provided.'}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Contact</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!hasContact && <p className="text-sm text-muted-foreground">Contact details are private.</p>}
              {profile.email && (
                <div className="flex items-center gap-3">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <a href={`mailto:${profile.email}`} className="text-sm hover:underline break-all">
                    {profile.email}
                  </a>
                </div>
              )}
              {profile.secondaryEmail && (
                <div className="flex items-center gap-3">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <a href={`mailto:${profile.secondaryEmail}`} className="text-sm hover:underline break-all">
                    {profile.secondaryEmail}
                  </a>
                </div>
              )}
              {phone && (
                <div className="flex items-center gap-3">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">{phone}</span>
                </div>
              )}
              {links.map(({ field, label, Icon }) => (
                <div key={field} className="flex items-center gap-3">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <a href={profile[field]} target="_blank" rel="noopener noreferrer nofollow" className="text-sm hover:underline">
                    {label}
                  </a>
                </div>
              ))}
            </CardContent>
          </Card>

          {skills.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Sparkles className="h-5 w-5" />
                  Skills
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {skills.map((name) => (
                  <Badge key={name} variant="secondary">
                    {name}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Briefcase className="h-5 w-5" />
                Experience
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {workExperiences.length > 0 ? workExperiences.map((exp: any) => (
                <div key={exp.id || `${exp.company}-${exp.startDate}`} className="flex gap-4">
                  <div className="flex-shrink-0 w-12 h-12 bg-secondary rounded-lg flex items-center justify-center">
                    <Building className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold">{exp.role || exp.title}</h4>
                    <p className="text-sm text-muted-foreground">
                      {exp.company}
                      {exp.location ? ` · ${exp.location}` : ''}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatMonth(exp.startDate)} - {exp.isCurrent ? 'Present' : formatMonth(exp.endDate)}
                    </p>
                    {exp.description && <p className="text-sm mt-2 whitespace-pre-line">{exp.description}</p>}
                  </div>
                </div>
              )) : <p className="text-sm text-muted-foreground">No work experience listed.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <GraduationCap className="h-5 w-5" />
                Education
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {educations.length > 0 ? educations.map((edu: any) => (
                <div key={edu.id || `${edu.institution}-${edu.startYear}`}>
                  <h4 className="font-semibold flex items-center gap-2">
                    {edu.institution}
                    {edu.isPrimary && <Badge variant="secondary">Primary</Badge>}
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    {[edu.degree, edu.fieldOfStudy].filter(Boolean).join(', ')}
                    {edu.grade ? ` · ${edu.grade}` : ''}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {edu.startYear} - {edu.endYear ?? 'Present'}
                  </p>
                </div>
              )) : <p className="text-sm text-muted-foreground">No education listed.</p>}
            </CardContent>
          </Card>
        </div>
      </div>

      <ProfileActivity userId={id} name={profile.fullName ?? 'This member'} isOwn={isOwnProfile} />
    </div>
  );
}
