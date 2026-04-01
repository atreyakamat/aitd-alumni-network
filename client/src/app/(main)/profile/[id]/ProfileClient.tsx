'use client';

import { useState } from 'react';
import { useAuth } from '@/context/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  MapPin,
  Mail,
  Phone,
  Linkedin,
  Github,
  Globe,
  Briefcase,
  GraduationCap,
  Edit,
  Plus,
  Building,
  Award,
} from 'lucide-react';
import { getInitials, formatDate } from '@/lib/utils';
import { useRouter } from 'next/navigation';

export function ProfileClient({ profile, id }: { profile: any; id: string }) {
  const { user } = useAuth();
  const isOwnProfile = user?.id === id;
  const router = useRouter();

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Cover & Profile Header */}
      <Card className="overflow-hidden">
        <div className="h-48 bg-gradient-to-r from-primary to-primary/60"></div>
        <CardContent className="relative pb-6">
          <div className="flex flex-col sm:flex-row sm:items-end gap-4 -mt-16 sm:-mt-12">
            <Avatar className="h-32 w-32 border-4 border-white shadow-lg">
              <AvatarImage src={profile.avatarUrl || undefined} alt={profile.fullName} />
              <AvatarFallback className="text-3xl">
                {getInitials(profile.fullName)}
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
                    {profile.membershipTier}
                  </Badge>
                )}
              </div>
              <p className="text-muted-foreground mt-1">{profile.headline || `${profile.department} Alumnus, Class of ${profile.batchYear}`}</p>
              <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <GraduationCap className="h-4 w-4" />
                  <span>{profile.department} • Batch {profile.batchYear}</span>
                </div>
                <div className="flex items-center gap-1">
                  <MapPin className="h-4 w-4" />
                  <span>{profile.currentCity || 'N/A'}, {profile.currentCountry || 'N/A'}</span>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              {isOwnProfile ? (
                <Button variant="outline">
                  <Edit className="h-4 w-4 mr-2" />
                  Edit Profile
                </Button>
              ) : (
                <>
                  <Button variant="outline" onClick={() => router.push(`/messages?u=${id}`)}>Message</Button>
                  <Button>Connect</Button>
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
              <p className="text-sm text-muted-foreground">{profile.bio || 'No bio provided.'}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Contact</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{profile.email}</span>
              </div>
              {profile.phone && (
                <div className="flex items-center gap-3">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">{profile.phone}</span>
                </div>
              )}
            </CardContent>
          </Card>
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
              {profile.workExperiences?.length > 0 ? profile.workExperiences.map((exp: any) => (
                <div key={exp.id} className="flex gap-4">
                  <div className="flex-shrink-0 w-12 h-12 bg-secondary rounded-lg flex items-center justify-center">
                    <Building className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold">{exp.title}</h4>
                    <p className="text-sm text-muted-foreground">{exp.company}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDate(exp.startDate)} - {exp.isCurrent ? 'Present' : formatDate(exp.endDate!)}
                    </p>
                  </div>
                </div>
              )) : <p className="text-sm text-muted-foreground">No work experience listed.</p>}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
