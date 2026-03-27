'use client';

import { useState } from 'react';
import { useAuth } from '@/context/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  MapPin,
  Mail,
  Phone,
  Linkedin,
  Github,
  Globe,
  Briefcase,
  GraduationCap,
  Calendar,
  Edit,
  Plus,
  Building,
  Award,
} from 'lucide-react';
import { getInitials, formatDate } from '@/lib/utils';

// Mock profile data
const profileData = {
  id: '1',
  fullName: 'Priya Sharma',
  email: 'priya.sharma@example.com',
  phone: '+91 98765 43210',
  avatarUrl: null,
  coverPhotoUrl: null,
  headline: 'Senior Software Engineer at Google | Building impactful products',
  bio: 'Passionate about technology and innovation. Love to mentor aspiring engineers and contribute to open source projects. When not coding, you can find me hiking or reading tech blogs.',
  batchYear: 2018,
  department: 'Computer Science',
  degree: 'B.Tech',
  currentCity: 'Bangalore',
  currentCountry: 'India',
  linkedinUrl: 'https://linkedin.com/in/priyasharma',
  githubUrl: 'https://github.com/priyasharma',
  websiteUrl: 'https://priyasharma.dev',
  membershipTier: 'Premium',
  profileCompleteness: 85,
  connectionsCount: 256,
  isVerified: true,
  workExperiences: [
    {
      id: '1',
      company: 'Google',
      title: 'Senior Software Engineer',
      location: 'Bangalore, India',
      startDate: '2021-06-01',
      endDate: null,
      isCurrent: true,
      description: 'Working on Google Search infrastructure, improving latency and reliability.',
    },
    {
      id: '2',
      company: 'Microsoft',
      title: 'Software Engineer',
      location: 'Hyderabad, India',
      startDate: '2018-07-01',
      endDate: '2021-05-31',
      isCurrent: false,
      description: 'Developed features for Azure cloud services.',
    },
  ],
  educations: [
    {
      id: '1',
      institution: 'College of Engineering',
      degree: 'B.Tech',
      fieldOfStudy: 'Computer Science',
      startYear: 2014,
      endYear: 2018,
      grade: '8.5 CGPA',
      activities: 'Coding Club President, Hackathon Organizer',
    },
  ],
  skills: [
    { id: '1', name: 'JavaScript' },
    { id: '2', name: 'TypeScript' },
    { id: '3', name: 'React' },
    { id: '4', name: 'Node.js' },
    { id: '5', name: 'Python' },
    { id: '6', name: 'System Design' },
    { id: '7', name: 'Leadership' },
  ],
};

export default function ProfilePage({ params }: { params: { id: string } }) {
  const { user } = useAuth();
  const isOwnProfile = user?.id === params.id;
  const profile = profileData; // In real app, fetch from API

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
              <p className="text-muted-foreground mt-1">{profile.headline}</p>
              <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <GraduationCap className="h-4 w-4" />
                  <span>{profile.department} • Batch {profile.batchYear}</span>
                </div>
                <div className="flex items-center gap-1">
                  <MapPin className="h-4 w-4" />
                  <span>{profile.currentCity}, {profile.currentCountry}</span>
                </div>
                <span>{profile.connectionsCount} connections</span>
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
                  <Button variant="outline">Message</Button>
                  <Button>Connect</Button>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left Column - Info */}
        <div className="space-y-6">
          {/* About */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">About</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{profile.bio}</p>
            </CardContent>
          </Card>

          {/* Contact Info */}
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
              {profile.linkedinUrl && (
                <a
                  href={profile.linkedinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 text-primary hover:underline"
                >
                  <Linkedin className="h-4 w-4" />
                  <span className="text-sm">LinkedIn</span>
                </a>
              )}
              {profile.githubUrl && (
                <a
                  href={profile.githubUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 text-primary hover:underline"
                >
                  <Github className="h-4 w-4" />
                  <span className="text-sm">GitHub</span>
                </a>
              )}
              {profile.websiteUrl && (
                <a
                  href={profile.websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 text-primary hover:underline"
                >
                  <Globe className="h-4 w-4" />
                  <span className="text-sm">Website</span>
                </a>
              )}
            </CardContent>
          </Card>

          {/* Skills */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg">Skills</CardTitle>
              {isOwnProfile && (
                <Button variant="ghost" size="icon">
                  <Plus className="h-4 w-4" />
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {profile.skills.map((skill) => (
                  <Badge key={skill.id} variant="secondary">
                    {skill.name}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Experience & Education */}
        <div className="lg:col-span-2 space-y-6">
          {/* Work Experience */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Briefcase className="h-5 w-5" />
                Experience
              </CardTitle>
              {isOwnProfile && (
                <Button variant="ghost" size="icon">
                  <Plus className="h-4 w-4" />
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-6">
              {profile.workExperiences.map((exp, index) => (
                <div key={exp.id} className="flex gap-4">
                  <div className="flex-shrink-0 w-12 h-12 bg-secondary rounded-lg flex items-center justify-center">
                    <Building className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold">{exp.title}</h4>
                    <p className="text-sm text-muted-foreground">{exp.company}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDate(exp.startDate)} - {exp.isCurrent ? 'Present' : formatDate(exp.endDate!)}
                      {exp.location && ` • ${exp.location}`}
                    </p>
                    {exp.description && (
                      <p className="text-sm mt-2">{exp.description}</p>
                    )}
                  </div>
                  {isOwnProfile && (
                    <Button variant="ghost" size="icon">
                      <Edit className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Education */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <GraduationCap className="h-5 w-5" />
                Education
              </CardTitle>
              {isOwnProfile && (
                <Button variant="ghost" size="icon">
                  <Plus className="h-4 w-4" />
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-6">
              {profile.educations.map((edu) => (
                <div key={edu.id} className="flex gap-4">
                  <div className="flex-shrink-0 w-12 h-12 bg-secondary rounded-lg flex items-center justify-center">
                    <Award className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold">{edu.institution}</h4>
                    <p className="text-sm text-muted-foreground">
                      {edu.degree} in {edu.fieldOfStudy}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {edu.startYear} - {edu.endYear}
                      {edu.grade && ` • ${edu.grade}`}
                    </p>
                    {edu.activities && (
                      <p className="text-sm mt-2 text-muted-foreground">
                        Activities: {edu.activities}
                      </p>
                    )}
                  </div>
                  {isOwnProfile && (
                    <Button variant="ghost" size="icon">
                      <Edit className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
