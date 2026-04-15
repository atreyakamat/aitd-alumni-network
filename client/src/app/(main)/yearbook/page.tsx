'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { userApi } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
  GraduationCap,
  Users,
  AlertCircle,
  BookOpen,
} from 'lucide-react';
import { getInitials } from '@/lib/utils';
import { LoadingSpinner } from '@/components/ui/loading';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const departments = [
  'All Departments',
  'Computer Science',
  'Information Technology',
  'Electronics',
  'Electrical',
  'Mechanical',
  'Civil',
];

const currentYear = new Date().getFullYear();
const batchYears = Array.from({ length: 30 }, (_, i) => String(currentYear - i));

export default function YearbookPage() {
  const [selectedYear, setSelectedYear] = useState(batchYears[0]);
  const [selectedDepartment, setSelectedDepartment] = useState('All Departments');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['yearbook', selectedYear, selectedDepartment],
    queryFn: async () => {
      const response = await userApi.getYearbook(
        parseInt(selectedYear),
        selectedDepartment !== 'All Departments' ? selectedDepartment : undefined
      );
      return response.data;
    },
  });

  const alumni = data?.data?.alumni || data?.data || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary" />
            Alumni Yearbook
          </h1>
          <p className="text-muted-foreground">
            Browse alumni by graduation batch and department
          </p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 flex flex-col gap-1.5">
              <label className="text-sm font-medium">Batch Year</label>
              <Select value={selectedYear} onValueChange={setSelectedYear}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select Year" />
                </SelectTrigger>
                <SelectContent>
                  {batchYears.map((year) => (
                    <SelectItem key={year} value={year}>
                      Class of {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 flex flex-col gap-1.5">
              <label className="text-sm font-medium">Department</label>
              <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Department" />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((dept) => (
                    <SelectItem key={dept} value={dept}>
                      {dept}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results Count */}
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          {isLoading ? 'Loading...' : `${alumni.length} alumni in this batch`}
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
            {(error as any)?.response?.data?.error || 'Failed to load yearbook data. Please try again later.'}
          </AlertDescription>
        </Alert>
      ) : alumni.length === 0 ? (
        <div className="text-center py-12 border rounded-lg bg-muted/20">
          <BookOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4 opacity-20" />
          <h3 className="text-lg font-medium">No records found</h3>
          <p className="text-muted-foreground">There are no records for Class of {selectedYear} in {selectedDepartment}</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {alumni.map((person: any) => (
            <Card key={person.id} className="hover:shadow-md transition-shadow">
              <CardContent className="pt-6">
                <div className="flex flex-col items-center text-center">
                  <Avatar className="h-24 w-24 mb-4 border-2 border-primary/10">
                    <AvatarImage src={person.avatarUrl || undefined} alt={person.fullName} />
                    <AvatarFallback className="text-2xl">
                      {getInitials(person.fullName)}
                    </AvatarFallback>
                  </Avatar>
                  <h3 className="font-semibold text-lg">{person.fullName}</h3>
                  <p className="text-sm text-muted-foreground line-clamp-1 mt-1">
                    {person.headline || 'Alumni'}
                  </p>
                  
                  <div className="mt-3 flex flex-col items-center gap-1">
                    <div className="flex items-center gap-1 text-xs font-medium bg-primary/5 text-primary px-2.5 py-1 rounded-full">
                      <GraduationCap className="h-3.5 w-3.5" />
                      <span>{person.department}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1 mt-4 justify-center">
                    {(person.skills || []).slice(0, 3).map((skill: string) => (
                      <Badge key={skill} variant="outline" className="text-[10px] px-1.5 py-0">
                        {skill}
                      </Badge>
                    ))}
                  </div>

                  <Button
                    className="w-full mt-6"
                    variant="outline"
                    size="sm"
                    asChild
                  >
                    <a href={`/profile/${person.id}`}>View Profile</a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
