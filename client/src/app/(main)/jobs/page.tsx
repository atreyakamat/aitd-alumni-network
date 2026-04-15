'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { jobApi } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuth } from '@/context/auth-context';
import Link from 'next/link';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Search,
  Filter,
  MapPin,
  Clock,
  DollarSign,
  ExternalLink,
  Plus,
  Building,
  AlertCircle,
} from 'lucide-react';
import { getInitials, formatDate, formatCurrency } from '@/lib/utils';
import { LoadingSpinner } from '@/components/ui/loading';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const jobTypes = [
  { label: 'All Types', value: 'ALL' },
  { label: 'Full-time', value: 'FULL_TIME' },
  { label: 'Part-time', value: 'PART_TIME' },
  { label: 'Contract', value: 'CONTRACT' },
  { label: 'Internship', value: 'INTERNSHIP' },
  { label: 'Freelance', value: 'FREELANCE' },
];

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

export default function JobsPage() {
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState('ALL');
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['jobs', searchQuery, selectedType, page],
    queryFn: async () => {
      const params: any = {
        page,
        limit: 10,
        search: searchQuery || undefined,
        type: selectedType !== 'ALL' ? selectedType : undefined,
      };
      const response = await jobApi.getJobs(params);
      return response.data;
    },
  });

  const jobs = data?.data?.items || [];
  const pagination = data?.data || { total: 0, pages: 0, page: 1 };

  const canPostJob = user?.role === 'ADMIN' || user?.role === 'SUPERADMIN' || user?.role === 'ALUMNI';

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    refetch();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Job Opportunities</h1>
          <p className="text-muted-foreground">
            Explore jobs and internships posted by alumni
          </p>
        </div>
        {canPostJob && (
          <Link href="/jobs/new">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Post a Job
            </Button>
          </Link>
        )}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSearch} className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by job title, company..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select 
              value={selectedType} 
              onValueChange={(val) => {
                setSelectedType(val);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full md:w-[180px]">
                <SelectValue placeholder="Job Type" />
              </SelectTrigger>
              <SelectContent>
                {jobTypes.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit">Search</Button>
          </form>
        </CardContent>
      </Card>

      {/* Job Stats - Optional, showing total found for now */}
      <div className="flex items-center gap-2">
        <Building className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          {isLoading ? 'Loading jobs...' : `${pagination.total} active jobs found`}
        </span>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            {(error as any)?.response?.data?.error || 'Failed to load job opportunities. Please try again later.'}
          </AlertDescription>
        </Alert>
      ) : jobs.length === 0 ? (
        <div className="text-center py-12 border rounded-lg bg-muted/20">
          <Building className="h-12 w-12 mx-auto text-muted-foreground mb-4 opacity-20" />
          <h3 className="text-lg font-medium">No jobs found</h3>
          <p className="text-muted-foreground">Try adjusting your search or filters</p>
        </div>
      ) : (
        <div className="space-y-4">
          {jobs.map((job: any) => (
            <Card key={job.id} className="hover:shadow-md transition-shadow">
              <CardContent className="pt-6">
                <div className="flex flex-col md:flex-row md:items-start gap-4">
                  <div className="flex items-center justify-center h-16 w-16 bg-secondary rounded-lg flex-shrink-0">
                    {job.companyLogoUrl ? (
                      <img src={job.companyLogoUrl} alt={job.company} className="h-10 w-10 object-contain" />
                    ) : (
                      <Building className="h-8 w-8 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-start gap-2 mb-2">
                      <h3 className="text-lg font-semibold">{job.title}</h3>
                      <Badge className={jobTypeColors[job.type]}>
                        {jobTypeLabels[job.type]}
                      </Badge>
                      {job.location === 'Remote' && (
                        <Badge variant="outline">Remote</Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground font-medium">{job.company}</p>
                    
                    <div className="flex flex-wrap gap-4 mt-3 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <MapPin className="h-4 w-4" />
                        <span>{job.location}</span>
                      </div>
                      {job.salaryMin && (
                        <div className="flex items-center gap-1">
                          <DollarSign className="h-4 w-4" />
                          <span>
                            {formatCurrency(job.salaryMin)}
                            {job.salaryMax ? ` - ${formatCurrency(job.salaryMax)}` : ''}
                            {job.type === 'INTERNSHIP' ? '/month' : '/year'}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        <span>Posted {formatDate(job.createdAt)}</span>
                      </div>
                    </div>

                    <p className="mt-3 text-sm line-clamp-2">{job.description}</p>

                    <div className="flex flex-wrap gap-2 mt-3">
                      {(job.requirements || []).slice(0, 5).map((req: string, i: number) => (
                        <Badge key={i} variant="secondary" className="text-xs">
                          {req}
                        </Badge>
                      ))}
                    </div>

                    <div className="flex flex-col sm:flex-row items-center justify-between mt-4 pt-4 border-t gap-4">
                      <div className="flex items-center gap-2 self-start">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={job.postedBy?.avatarUrl || undefined} />
                          <AvatarFallback className="text-xs">
                            {getInitials(job.postedBy?.fullName || 'U')}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium">{job.postedBy?.fullName}</p>
                          <p className="text-xs text-muted-foreground">
                            Batch {job.postedBy?.batchYear}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2 w-full sm:w-auto">
                        <Link href={`/jobs/${job.id}`} className="flex-1 sm:flex-initial">
                          <Button variant="outline" size="sm" className="w-full">
                            View Details
                          </Button>
                        </Link>
                        {job.applicationUrl ? (
                          <Button size="sm" className="flex-1 sm:flex-initial" asChild>
                            <a href={job.applicationUrl} target="_blank" rel="noopener noreferrer">
                              Apply Now
                              <ExternalLink className="ml-2 h-4 w-4" />
                            </a>
                          </Button>
                        ) : (
                          <Button size="sm" className="flex-1 sm:flex-initial">
                            Apply Now
                            <ExternalLink className="ml-2 h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Pagination */}
      {!isLoading && pagination.pages > 1 && (
        <div className="flex justify-center gap-2 mt-8">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            Previous
          </Button>
          <div className="flex items-center px-4 text-sm font-medium">
            Page {page} of {pagination.pages}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(pagination.pages, p + 1))}
            disabled={page === pagination.pages}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
