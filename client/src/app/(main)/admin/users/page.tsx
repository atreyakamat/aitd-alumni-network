'use client';

import * as React from 'react';
import Link from 'next/link';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ArrowLeft, Search, UserCheck, UserX, Users } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/hooks/use-toast';
import { adminApi, getApiErrorMessage, type AdminUser, type AdminUserFilters } from '@/lib/api';
import { ROLES, canManageUser, roleLabel, type Role } from '@/lib/roles';
import { formatDate, getInitials } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { UserRoleSelect } from '@/components/admin/UserRoleSelect';
import { UserStatusDialog } from '@/components/admin/UserStatusDialog';
import { Pagination } from '@/components/shared/Pagination';

const PAGE_SIZE = 20;
const ALL = 'ALL';

type StatusFilter = 'ALL' | 'true' | 'false';

export default function AdminUsersPage() {
  const { user: actor } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [role, setRole] = React.useState<string>(ALL);
  const [status, setStatus] = React.useState<StatusFilter>(ALL);
  const [batchYear, setBatchYear] = React.useState('');
  const [page, setPage] = React.useState(1);

  const [roleChange, setRoleChange] = React.useState<{ user: AdminUser; role: Role } | null>(null);
  const [statusChange, setStatusChange] = React.useState<AdminUser | null>(null);

  // Debounce free-text search.
  React.useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filters: AdminUserFilters = {
    search: search || undefined,
    role: role === ALL ? undefined : role,
    isActive: status === ALL ? undefined : status,
    batchYear: /^\d{4}$/.test(batchYear) ? Number(batchYear) : undefined,
    page,
    limit: PAGE_SIZE,
  };

  const usersQuery = useQuery({
    queryKey: ['admin', 'users', filters],
    queryFn: async () => (await adminApi.listUsers(filters)).data,
    placeholderData: keepPreviousData,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) => adminApi.updateUserRole(id, role),
    onSuccess: (_res, vars) => {
      toast({ title: 'Role updated', description: `${roleChange?.user.fullName ?? 'User'} is now ${roleLabel(vars.role)}.` });
      setRoleChange(null);
      invalidate();
    },
    onError: (err) => {
      toast({
        title: 'Could not change role',
        description: getApiErrorMessage(err, 'Please try again.'),
        variant: 'destructive',
      });
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, isActive, reason }: { id: string; isActive: boolean; reason?: string }) =>
      adminApi.updateUserStatus(id, isActive, reason),
    onSuccess: (_res, vars) => {
      toast({
        title: vars.isActive ? 'User reactivated' : 'User deactivated',
        description: `${statusChange?.fullName ?? 'The user'} has been ${vars.isActive ? 'reactivated' : 'deactivated'}.`,
      });
      setStatusChange(null);
      invalidate();
    },
    onError: (err) => {
      toast({
        title: 'Could not update status',
        description: getApiErrorMessage(err, 'Please try again.'),
        variant: 'destructive',
      });
    },
  });

  const users = usersQuery.data?.data ?? [];
  const pagination = usersQuery.data?.pagination;
  const hasFilters = !!search || role !== ALL || status !== ALL || !!batchYear;

  const clearFilters = () => {
    setSearchInput('');
    setSearch('');
    setRole(ALL);
    setStatus(ALL);
    setBatchYear('');
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <Button variant="link" asChild className="px-0 h-auto mb-1 text-muted-foreground">
            <Link href="/admin">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Admin dashboard
            </Link>
          </Button>
          <h1 className="text-2xl font-bold">User management</h1>
          <p className="text-muted-foreground">Search members, adjust roles and manage account access.</p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <form
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(searchInput.trim());
              setPage(1);
            }}
            className="grid gap-3 md:grid-cols-[1fr_180px_160px_130px_auto]"
          >
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                aria-label="Search users"
                placeholder="Search by name or email"
                className="pl-9"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
            <Select
              value={role}
              onValueChange={(v) => {
                setRole(v);
                setPage(1);
              }}
            >
              <SelectTrigger aria-label="Filter by role">
                <SelectValue placeholder="Role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All roles</SelectItem>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {roleLabel(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={status}
              onValueChange={(v) => {
                setStatus(v as StatusFilter);
                setPage(1);
              }}
            >
              <SelectTrigger aria-label="Filter by status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                <SelectItem value="true">Active</SelectItem>
                <SelectItem value="false">Deactivated</SelectItem>
              </SelectContent>
            </Select>
            <Input
              aria-label="Batch year"
              inputMode="numeric"
              placeholder="Batch year"
              maxLength={4}
              value={batchYear}
              onChange={(e) => {
                setBatchYear(e.target.value.replace(/\D/g, ''));
                setPage(1);
              }}
            />
            <Button type="button" variant="ghost" onClick={clearFilters} disabled={!hasFilters}>
              Clear
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Results */}
      {usersQuery.isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Could not load users</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            {getApiErrorMessage(usersQuery.error, 'Please try again.')}
            <Button variant="outline" size="sm" onClick={() => usersQuery.refetch()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : usersQuery.isLoading ? (
        <Card>
          <CardContent className="pt-6 space-y-4" aria-label="Loading users">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
                <Skeleton className="h-8 w-28" />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : users.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <h3 className="font-semibold">{hasFilters ? 'No users match these filters' : 'No users yet'}</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {hasFilters ? 'Try a different search or clear the filters.' : 'New registrations will appear here.'}
            </p>
            {hasFilters && (
              <Button variant="outline" className="mt-4" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">User</th>
                    <th scope="col" className="px-4 py-3 font-medium hidden md:table-cell">Batch</th>
                    <th scope="col" className="px-4 py-3 font-medium">Role</th>
                    <th scope="col" className="px-4 py-3 font-medium">Status</th>
                    <th scope="col" className="px-4 py-3 font-medium hidden lg:table-cell">Last login</th>
                    <th scope="col" className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className={usersQuery.isFetching ? 'opacity-60 transition-opacity' : undefined}>
                  {users.map((u) => {
                    const isSelf = u.id === actor?.id;
                    const manageable = canManageUser(actor, u.userRole, { isSelf });
                    return (
                      <tr key={u.id} className="border-b last:border-0">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3 min-w-[200px]">
                            <Avatar className="h-9 w-9">
                              <AvatarImage src={u.profilePhotoUrl ?? undefined} alt="" />
                              <AvatarFallback>{getInitials(u.fullName || u.email)}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <Link href={`/profile/${u.id}`} className="font-medium hover:underline truncate block">
                                {u.fullName}
                                {isSelf && <span className="text-muted-foreground font-normal"> (you)</span>}
                              </Link>
                              <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell text-muted-foreground">
                          {u.batchYear ?? '—'}
                          {u.department ? <span className="block text-xs">{u.department}</span> : null}
                        </td>
                        <td className="px-4 py-3">
                          <UserRoleSelect
                            actorRole={actor}
                            targetRole={u.userRole}
                            isSelf={isSelf}
                            userName={u.fullName}
                            disabled={roleMutation.isPending}
                            onChange={(newRole) => setRoleChange({ user: u, role: newRole })}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            <Badge variant={u.isActive ? 'success' : 'destructive'}>
                              {u.isActive ? 'Active' : 'Deactivated'}
                            </Badge>
                            {!u.isVerified && <Badge variant="outline">Unverified</Badge>}
                          </div>
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground">
                          {u.lastLoginAt ? formatDate(u.lastLoginAt) : 'Never'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {manageable ? (
                            <Button
                              size="sm"
                              variant={u.isActive ? 'outline' : 'default'}
                              onClick={() => setStatusChange(u)}
                              disabled={statusMutation.isPending}
                            >
                              {u.isActive ? (
                                <>
                                  <UserX className="h-4 w-4 mr-1" /> Deactivate
                                </>
                              ) : (
                                <>
                                  <UserCheck className="h-4 w-4 mr-1" /> Reactivate
                                </>
                              )}
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground" title="Outside your permission level">
                              —
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {!usersQuery.isError && users.length > 0 && (
        <Pagination
          pagination={pagination}
          onPageChange={setPage}
          disabled={usersQuery.isFetching}
          noun="users"
        />
      )}

      {/* Role change confirmation */}
      <Dialog open={!!roleChange} onOpenChange={(o) => !o && !roleMutation.isPending && setRoleChange(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change role?</DialogTitle>
            <DialogDescription>
              {roleChange
                ? `${roleChange.user.fullName} will change from ${roleLabel(roleChange.user.userRole)} to ${roleLabel(
                    roleChange.role
                  )}. This is recorded in the audit log.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoleChange(null)} disabled={roleMutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => roleChange && roleMutation.mutate({ id: roleChange.user.id, role: roleChange.role })}
              disabled={roleMutation.isPending}
            >
              {roleMutation.isPending ? 'Saving...' : 'Change role'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <UserStatusDialog
        open={!!statusChange}
        onOpenChange={(o) => !o && setStatusChange(null)}
        userName={statusChange?.fullName ?? ''}
        nextActive={statusChange ? !statusChange.isActive : false}
        pending={statusMutation.isPending}
        onConfirm={(reason) =>
          statusChange &&
          statusMutation.mutate({ id: statusChange.id, isActive: !statusChange.isActive, reason: reason || undefined })
        }
      />
    </div>
  );
}
