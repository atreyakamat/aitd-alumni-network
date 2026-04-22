'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { platformApi } from '@/lib/api';
import { useAuth } from '@/context/auth-context';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, CheckCircle2, Clock3, ShieldAlert } from 'lucide-react';

const statusVariant: Record<string, 'default' | 'secondary' | 'outline'> = {
  IMPLEMENTED: 'default',
  PARTIAL: 'secondary',
  PLANNED: 'outline',
};

export default function AdminControlPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  const canAccess = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN' || user?.role === 'SUPERADMIN';

  if (!authLoading && !canAccess) {
    router.push('/dashboard');
  }

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['platform-readiness'],
    queryFn: async () => {
      const response = await platformApi.getReadiness();
      return response.data.data;
    },
    enabled: !!canAccess,
  });

  const blockers = useMemo(
    () => (data?.modules || []).filter((module: any) => module.status === 'PARTIAL' && module.risk === 'HIGH'),
    [data]
  );

  if (isLoading || authLoading) {
    return <div className="text-sm text-muted-foreground">Loading control center...</div>;
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Could not load platform readiness</AlertTitle>
        <AlertDescription>
          {(error as any)?.response?.data?.error || 'Please try again.'}
          <Button variant="outline" size="sm" className="ml-3" onClick={() => refetch()}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Platform Control Center</h1>
          <p className="text-muted-foreground">Execution readiness across all core modules.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/admin">Back to Admin</Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Implemented Modules</p>
            <p className="text-2xl font-bold mt-1">{data?.summary?.implemented ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Partial Modules</p>
            <p className="text-2xl font-bold mt-1">{data?.summary?.partial ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Planned Modules</p>
            <p className="text-2xl font-bold mt-1">{data?.summary?.planned ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">High-Risk Blockers</p>
            <p className="text-2xl font-bold mt-1">{blockers.length}</p>
          </CardContent>
        </Card>
      </div>

      {blockers.length > 0 && (
        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Release attention needed</AlertTitle>
          <AlertDescription>
            {blockers.length} high-risk partial module(s) should be completed before broad release.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {(data?.modules || []).map((module: any) => (
          <Card key={module.key}>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">{module.name}</CardTitle>
                <Badge variant={statusVariant[module.status] || 'outline'}>{module.status}</Badge>
              </div>
              <CardDescription>
                Owner: {module.owner} • Risk: {module.risk}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {module.features.map((feature: any) => (
                <div key={feature.key} className="flex items-start justify-between gap-3 border rounded-md p-2">
                  <div>
                    <p className="text-sm font-medium">{feature.name}</p>
                    <p className="text-xs text-muted-foreground">{feature.notes}</p>
                  </div>
                  <div className="pt-0.5">
                    {feature.status === 'IMPLEMENTED' ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : feature.status === 'PARTIAL' ? (
                      <AlertCircle className="h-4 w-4 text-amber-600" />
                    ) : (
                      <Clock3 className="h-4 w-4 text-slate-500" />
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

