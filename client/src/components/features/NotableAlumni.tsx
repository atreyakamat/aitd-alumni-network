'use client';

import { useEffect, useState } from 'react';
import { userApi } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';

const FALLBACK_ALUMNI = [
  {
    id: 'sanjana-yadav',
    fullName: 'Sanjana Yadav',
    currentDesignation: 'Senior Robotics Engineer',
    department: 'Mechanical Engineering',
    batchYear: 2018,
    profilePhotoUrl: null,
    shortBio: 'Pioneer in industrial automation and former Robowar champion.',
    workExperiences: [{ company: 'Tesla' }]
  },
  {
    id: 'elena-vance',
    fullName: 'Dr. Elena Vance',
    currentDesignation: 'Sustainability Consultant',
    department: 'Civil Engineering',
    batchYear: 2012,
    profilePhotoUrl: null,
    shortBio: 'Expert in renewable energy policy and global ethics.',
    workExperiences: [{ company: 'United Nations' }]
  },
  {
    id: 'rahul-sharma',
    fullName: 'Rahul Sharma',
    currentDesignation: 'Tech Entrepreneur',
    department: 'Computer Engineering',
    batchYear: 2015,
    profilePhotoUrl: null,
    shortBio: 'Founder of multiple successful AI startups in Silicon Valley.',
    workExperiences: [{ company: 'Innovate AI' }]
  }
];

export function NotableAlumni() {
  const [alumni, setAlumni] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check if userApi.getNotable exists, if not fallback to static data
    if (typeof (userApi as any).getNotable === 'function') {
      (userApi as any).getNotable(3).then((res: any) => {
        const data = res.data?.data || [];
        if (data.length > 0) {
          setAlumni(data);
        } else {
          setAlumni(FALLBACK_ALUMNI);
        }
        setLoading(false);
      }).catch(() => {
        setAlumni(FALLBACK_ALUMNI);
        setLoading(false);
      });
    } else {
      setAlumni(FALLBACK_ALUMNI);
      setLoading(false);
    }
  }, []);

  if (loading) return null;

  return (
    <section className="py-20 bg-muted/30">
      <div className="container">
        <h2 className="text-3xl font-bold tracking-tight text-center mb-12">Notable Alumni</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {alumni.map((person: any) => (
            <Card key={person.id} className="overflow-hidden hover:shadow-lg transition-shadow">
              <CardContent className="p-6 text-center">
                <Avatar className="w-24 h-24 mx-auto mb-4 border-4 border-primary/10">
                  <AvatarImage src={person.profilePhotoUrl} alt={person.fullName} />
                  <AvatarFallback>{person.fullName.charAt(0)}</AvatarFallback>
                </Avatar>
                <h3 className="text-xl font-bold mb-1">{person.fullName}</h3>
                <p className="text-sm text-primary font-medium mb-2">{person.currentDesignation || 'Alumnus'}</p>
                <p className="text-sm text-muted-foreground mb-4">
                  {person.workExperiences?.[0]?.company ? `at ${person.workExperiences[0].company}` : person.department}
                </p>
                <Badge variant="outline" className="font-normal">Class of {person.batchYear}</Badge>
                {person.shortBio && <p className="mt-4 text-sm line-clamp-3 italic">"{person.shortBio}"</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
