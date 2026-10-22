'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertCircle, GraduationCap } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { adminApi, getApiErrorMessage, type MentorshipOverview } from '@/lib/api';

const REQUEST_STATUSES: Array<{ key: keyof MentorshipOverview['requests']; label: string }> = [
  { key: 'PENDING', label: 'Pending' },
  { key: 'ACCEPTED', label: 'Accepted' },
  { key: 'DECLINED', label: 'Declined' },
  { key: 'COMPLETED', label: 'Completed' },
];

/** Server sends completionRate as a 0..100 percentage. */
const formatRate = (rate: number) => Math.max(0, Math.min(100, Math.round(Number(rate) || 0)));

export function MentorshipOverviewCard() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'mentorship-overview'],
    queryFn: async () => (await adminApi.getMentorshipOverview()).data.data,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <GraduationCap className="h-4 w-4 text-blue-500" />
          Mentorship overview
        </CardTitle>
        <CardDescription>Mentor supply, request pipeline and session completion</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3" aria-label="Loading mentorship overview">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : isError ? (
          <div className="flex items-start gap-3 text-sm">
            <AlertCircle className="h-4 w-4 text-destructive mt-0.5" />
            <div className="space-y-2">
              <p>{getApiErrorMessage(error, 'Could not load mentorship overview.')}</p>
              <Button size="sm" variant="outline" onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          </div>
        ) : !data || (data.mentors.total === 0 && data.requests.total === 0) ? (
          <p className="text-sm text-muted-foreground">
            No mentorship activity yet. Mentor profiles and requests will appear here.
          </p>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-2xl font-bold">{data.mentors.active}</p>
                <p className="text-xs text-muted-foreground">Active mentors ({data.mentors.total} total)</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{data.requests.total}</p>
                <p className="text-xs text-muted-foreground">Requests</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{data.sessions.total}</p>
                <p className="text-xs text-muted-foreground">Sessions ({data.sessions.completed} completed)</p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {REQUEST_STATUSES.map(({ key, label }) => (
                <div key={key} className="rounded-md border p-2 text-center">
                  <p className="text-lg font-semibold">{data.requests[key] ?? 0}</p>
                  <p className="text-[11px] text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Session completion rate</span>
                <span className="font-medium">{formatRate(data.sessions.completionRate)}%</span>
              </div>
              <Progress value={formatRate(data.sessions.completionRate)} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
