'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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
  Briefcase,
  Clock,
  DollarSign,
  ExternalLink,
  Plus,
  Building,
} from 'lucide-react';
import { getInitials, formatDate, formatCurrency } from '@/lib/utils';

const jobTypes = ['All Types', 'Full-time', 'Part-time', 'Contract', 'Internship', 'Freelance'];

// Mock data
const jobs = [
  {
    id: '1',
    title: 'Senior Software Engineer',
    company: 'Google',
    companyLogoUrl: null,
    location: 'Bangalore, India',
    type: 'FULL_TIME',
    isRemote: false,
    salaryMin: 3000000,
    salaryMax: 5000000,
    description: 'We are looking for a Senior Software Engineer to join our team...',
    requirements: ['5+ years experience', 'React/Node.js', 'System Design'],
    postedBy: {
      fullName: 'Priya Sharma',
      avatarUrl: null,
      batchYear: 2015,
    },
    createdAt: '2024-01-10T10:00:00Z',
    expiresAt: '2024-02-10T10:00:00Z',
  },
  {
    id: '2',
    title: 'Product Manager',
    company: 'Microsoft',
    companyLogoUrl: null,
    location: 'Hyderabad, India',
    type: 'FULL_TIME',
    isRemote: true,
    salaryMin: 2500000,
    salaryMax: 4000000,
    description: 'Join our team as a Product Manager to lead innovative products...',
    requirements: ['3+ years PM experience', 'Agile/Scrum', 'Data-driven'],
    postedBy: {
      fullName: 'Rahul Patel',
      avatarUrl: null,
      batchYear: 2016,
    },
    createdAt: '2024-01-08T10:00:00Z',
    expiresAt: '2024-02-08T10:00:00Z',
  },
  {
    id: '3',
    title: 'Data Science Intern',
    company: 'Amazon',
    companyLogoUrl: null,
    location: 'Remote',
    type: 'INTERNSHIP',
    isRemote: true,
    salaryMin: 50000,
    salaryMax: 80000,
    description: 'Summer internship opportunity in our Data Science team...',
    requirements: ['Final year student', 'Python/ML basics', 'Statistics'],
    postedBy: {
      fullName: 'Anita Desai',
      avatarUrl: null,
      batchYear: 2018,
    },
    createdAt: '2024-01-05T10:00:00Z',
    expiresAt: '2024-01-30T10:00:00Z',
  },
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
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState('All Types');

  const filteredJobs = jobs.filter((job) => {
    const matchesSearch =
      job.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.company.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType =
      selectedType === 'All Types' ||
      jobTypeLabels[job.type] === selectedType;
    return matchesSearch && matchesType;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Job Opportunities</h1>
          <p className="text-muted-foreground">
            Explore jobs and internships posted by alumni
          </p>
        </div>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Post a Job
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by job title, company..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={selectedType} onValueChange={setSelectedType}>
              <SelectTrigger className="w-full md:w-[180px]">
                <SelectValue placeholder="Job Type" />
              </SelectTrigger>
              <SelectContent>
                {jobTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline">
              <Filter className="h-4 w-4 mr-2" />
              More Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Job Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-primary">{jobs.length}</div>
            <p className="text-sm text-muted-foreground">Active Jobs</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-green-600">12</div>
            <p className="text-sm text-muted-foreground">New This Week</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-amber-600">8</div>
            <p className="text-sm text-muted-foreground">Remote Jobs</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-purple-600">5</div>
            <p className="text-sm text-muted-foreground">Internships</p>
          </CardContent>
        </Card>
      </div>

      {/* Job Listings */}
      <div className="space-y-4">
        {filteredJobs.map((job) => (
          <Card key={job.id} className="hover:shadow-md transition-shadow">
            <CardContent className="pt-6">
              <div className="flex flex-col md:flex-row md:items-start gap-4">
                <div className="flex items-center justify-center h-16 w-16 bg-secondary rounded-lg flex-shrink-0">
                  <Building className="h-8 w-8 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-start gap-2 mb-2">
                    <h3 className="text-lg font-semibold">{job.title}</h3>
                    <Badge className={jobTypeColors[job.type]}>
                      {jobTypeLabels[job.type]}
                    </Badge>
                    {job.isRemote && (
                      <Badge variant="outline">Remote</Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground font-medium">{job.company}</p>
                  
                  <div className="flex flex-wrap gap-4 mt-3 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <MapPin className="h-4 w-4" />
                      <span>{job.location}</span>
                    </div>
                    {job.salaryMin && job.salaryMax && (
                      <div className="flex items-center gap-1">
                        <DollarSign className="h-4 w-4" />
                        <span>
                          {formatCurrency(job.salaryMin)} - {formatCurrency(job.salaryMax)}
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
                    {job.requirements.map((req, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">
                        {req}
                      </Badge>
                    ))}
                  </div>

                  <div className="flex items-center justify-between mt-4 pt-4 border-t">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={job.postedBy.avatarUrl || undefined} />
                        <AvatarFallback className="text-xs">
                          {getInitials(job.postedBy.fullName)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-sm font-medium">{job.postedBy.fullName}</p>
                        <p className="text-xs text-muted-foreground">
                          Batch {job.postedBy.batchYear}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm">
                        View Details
                      </Button>
                      <Button size="sm">
                        Apply Now
                        <ExternalLink className="ml-2 h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
