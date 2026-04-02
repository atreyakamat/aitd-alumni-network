'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { jobApi } from '@/lib/api';
import { useAuth } from '@/context/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  MapPin,
  Briefcase,
  Clock,
  DollarSign,
  Calendar,
  Building,
  ChevronLeft,
  ExternalLink,
  Share2,
  Bookmark,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { getInitials, formatDate, formatCurrency } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

export default function JobDetailsPage() {
  const params = useParams();
  const id = params?.id as string;
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  const [job, setJob] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      fetchJobDetails();
    }
  }, [id]);

  const fetchJobDetails = async () => {
    setLoading(true);
    try {
      const response = await jobApi.getJob(id as string);
      setJob(response.data.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load job details');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">Loading job details...</p>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="max-w-2xl mx-auto py-20 text-center">
        <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
        <h2 className="text-2xl font-bold mb-2">Error</h2>
        <p className="text-muted-foreground mb-6">{error || 'Job not found'}</p>
        <Button onClick={() => router.push('/jobs')}>Back to Job Board</Button>
      </div>
    );
  }

  const jobTypeLabels: Record<string, string> = {
    FULL_TIME: 'Full-time',
    PART_TIME: 'Part-time',
    CONTRACT: 'Contract',
    INTERNSHIP: 'Internship',
    FREELANCE: 'Freelance',
  };

  const jobTypeColors: Record<string, string> = {
    FULL_TIME: 'bg-blue-100 text-blue-700',
    PART_TIME: 'bg-purple-100 text-purple-700',
    CONTRACT: 'bg-amber-100 text-amber-700',
    INTERNSHIP: 'bg-green-100 text-green-700',
    FREELANCE: 'bg-rose-100 text-rose-700',
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <Button variant="ghost" className="mb-2" onClick={() => router.back()}>
        <ChevronLeft className="h-4 w-4 mr-2" />
        Back to Jobs
      </Button>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-start gap-4 mb-6">
                <div className="h-20 w-20 bg-secondary rounded-xl flex items-center justify-center shrink-0">
                  <Building className="h-10 w-10 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <h1 className="text-2xl font-bold">{job.title}</h1>
                    <Badge className={jobTypeColors[job.type]}>
                      {jobTypeLabels[job.type]}
                    </Badge>
                  </div>
                  <p className="text-lg text-primary font-medium">{job.company}</p>
                  <div className="flex flex-wrap gap-4 mt-2 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <MapPin className="h-4 w-4" />
                      <span>{job.location} {job.isRemote && '(Remote)'}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="h-4 w-4" />
                      <span>Posted {formatDate(job.createdAt)}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-3 mb-8">
                <Button className="flex-1 sm:flex-none">
                  Apply Now
                  <ExternalLink className="h-4 w-4 ml-2" />
                </Button>
                <Button variant="outline" size="icon">
                  <Bookmark className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon">
                  <Share2 className="h-4 w-4" />
                </Button>
              </div>

              <div className="space-y-8">
                <section>
                  <h2 className="text-xl font-bold mb-4">Description</h2>
                  <div className="prose prose-sm max-w-none text-muted-foreground whitespace-pre-wrap">
                    {job.description}
                  </div>
                </section>

                {job.requirements && (
                  <section>
                    <h2 className="text-xl font-bold mb-4">Requirements</h2>
                    <div className="prose prose-sm max-w-none text-muted-foreground whitespace-pre-wrap">
                      {job.requirements}
                    </div>
                  </section>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar Info */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Job Overview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 bg-primary/10 rounded-full flex items-center justify-center">
                  <DollarSign className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Salary Range</p>
                  <p className="text-sm font-semibold">
                    {job.salaryMin && job.salaryMax 
                      ? `${formatCurrency(job.salaryMin)} - ${formatCurrency(job.salaryMax)}`
                      : 'Not disclosed'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="h-9 w-9 bg-primary/10 rounded-full flex items-center justify-center">
                  <Briefcase className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Experience Level</p>
                  <p className="text-sm font-semibold">{job.experienceLevel || 'All levels'}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="h-9 w-9 bg-primary/10 rounded-full flex items-center justify-center">
                  <Calendar className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Deadline</p>
                  <p className="text-sm font-semibold">
                    {job.expiresAt ? formatDate(job.expiresAt) : 'No deadline'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Posted By</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3 mb-4">
                <Avatar className="h-12 w-12 cursor-pointer" onClick={() => router.push(`/profile/${job.postedBy.id}`)}>
                  <AvatarImage src={job.postedBy.profilePhotoUrl} />
                  <AvatarFallback>{getInitials(job.postedBy.fullName)}</AvatarFallback>
                </Avatar>
                <div>
                  <h4 className="font-bold">{job.postedBy.fullName}</h4>
                  <p className="text-xs text-muted-foreground">
                    Class of {job.postedBy.batchYear} • {job.postedBy.department}
                  </p>
                </div>
              </div>
              <Button variant="outline" className="w-full" onClick={() => router.push(`/messages?u=${job.postedBy.id}`)}>
                Message Alumni
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
