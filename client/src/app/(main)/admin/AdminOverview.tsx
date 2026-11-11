'use client';

import Link from 'next/link';
import {
  Briefcase,
  Calendar,
  Download,
  Heart,
  IndianRupee,
  LayoutDashboard,
  MessageSquare,
  Newspaper,
  RefreshCw,
  TrendingUp,
  UserCheck,
  Users,
  Activity,
  type LucideIcon,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ExportPanel } from '@/components/admin/ExportPanel';
import { MentorshipOverviewCard } from '@/components/admin/MentorshipOverviewCard';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { AdminErrorState } from '@/components/admin/AdminErrorState';
import { StatTile } from '@/components/admin/StatTile';
import { GrowthBadge } from '@/components/admin/GrowthBadge';
import { RevenueChart } from '@/components/admin/RevenueChart';
import { RoleDistributionChart } from '@/components/admin/RoleDistributionChart';
import { ApprovalStatusBadge } from '@/components/admin/StatusBadges';
import { useAdminStats } from '@/lib/use-admin-stats';
import type { AdminStats } from '@/lib/admin-stats';
import { formatDate, formatInr, formatNumber, pluralize } from '@/lib/format';
import { getInitials } from '@/lib/utils';

const PRIMARY = '#002045';
const SECONDARY = '#b45309';
const ERROR_FALLBACK = 'Failed to load dashboard statistics';

function ChartEmpty({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <div className="flex h-[250px] flex-col items-center justify-center gap-2 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <p className="font-medium">{title}</p>
      <p className="max-w-xs text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-label="Loading dashboard" aria-busy="true" className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-36" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-[380px]" />
        <Skeleton className="h-[380px]" />
      </div>
      <Skeleton className="h-48" />
    </div>
  );
}

function Dashboard({ stats }: { stats: AdminStats }) {
  const { users, content, financial, engagement, recentActivity } = stats;

  // Members by month: the running total ends at today's number of members
  const addedInPeriod = users.monthlyGrowth.reduce((sum, m) => sum + m.count, 0);
  let running = users.total - addedInPeriod;
  const growthData = users.monthlyGrowth.map((m) => {
    running += m.count;
    return { month: m.month, members: running, newMembers: m.count };
  });
  const batchData = users.byBatch.map((b) => ({ name: b.year?.toString() ?? 'Unknown', value: b.count }));

  const pending = users.pendingApproval;

  return (
    <>
      {/* Main stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={Users}
          tone="blue"
          label="Members"
          value={formatNumber(users.total)}
          badge={<GrowthBadge value={users.growthPercent} suffix="vs last month" />}
          sub={`${pluralize(users.newThisMonth, 'new member')} this month`}
        />
        <StatTile
          icon={IndianRupee}
          tone="green"
          label="Total donations"
          value={formatInr(financial.donations.totalAmount)}
          sub={`${formatInr(financial.donations.thisMonth)} this month`}
        />
        <StatTile
          icon={Calendar}
          tone="amber"
          label="Total Events"
          value={formatNumber(content.events.total)}
          sub={pluralize(content.events.upcoming, 'upcoming event')}
        />
        <StatTile
          icon={Briefcase}
          tone="purple"
          label="Job Listings"
          value={formatNumber(content.jobs.total)}
          sub={`${formatNumber(content.jobs.active)} currently active`}
        />
      </div>

      {/* Charts row 1 */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <TrendingUp className="h-4 w-4 text-blue-500" aria-hidden="true" />
              Member growth
            </CardTitle>
            <CardDescription>Approved members, month by month, over the last 12 months</CardDescription>
          </CardHeader>
          <CardContent>
            {growthData.length === 0 ? (
              <ChartEmpty icon={Users} title="No members yet" text="Growth will be charted here once members have been approved." />
            ) : (
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={growthData}>
                    <defs>
                      <linearGradient id="overviewMembers" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={PRIMARY} stopOpacity={0.15} />
                        <stop offset="95%" stopColor={PRIMARY} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                    <XAxis dataKey="month" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
                    <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }} />
                    <Area type="monotone" dataKey="members" stroke={PRIMARY} fillOpacity={1} fill="url(#overviewMembers)" name="Members" strokeWidth={2} />
                    <Line type="monotone" dataKey="newMembers" stroke={SECONDARY} strokeWidth={2} dot={{ r: 4 }} name="New members" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <IndianRupee className="h-4 w-4 text-green-500" aria-hidden="true" />
              Revenue Analytics
            </CardTitle>
            <CardDescription>Monthly donation and membership payments</CardDescription>
          </CardHeader>
          <CardContent>
            <RevenueChart data={financial.donations.monthly} />
          </CardContent>
        </Card>
      </div>

      {/* Charts row 2 */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Member roles</CardTitle>
            <CardDescription>Distribution of members by role</CardDescription>
          </CardHeader>
          <CardContent>
            <RoleDistributionChart byRole={users.byRole} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Users className="h-4 w-4 text-blue-500" aria-hidden="true" />
              Alumni by Batch
            </CardTitle>
            <CardDescription>Recent graduation years distribution</CardDescription>
          </CardHeader>
          <CardContent>
            {batchData.length === 0 ? (
              <ChartEmpty icon={Users} title="No batch details yet" text="Members' graduation years will be charted here." />
            ) : (
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={batchData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                    <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
                    <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }} />
                    <Bar dataKey="value" fill={PRIMARY} radius={[4, 4, 0, 0]} name="Alumni" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Engagement */}
      <Card>
        <CardHeader>
          <CardTitle>Platform Engagement</CardTitle>
          <CardDescription>Key activity metrics for the platform</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              icon={MessageSquare}
              tone="blue"
              label="Total Messages"
              value={formatNumber(engagement.messages.total)}
              sub={`${formatNumber(engagement.messages.thisMonth)} this month`}
            />
            <StatTile icon={Users} tone="teal" label="Connections" value={formatNumber(engagement.connections)} sub="Accepted requests" />
            <StatTile
              icon={Newspaper}
              tone="purple"
              label="Total Posts"
              value={formatNumber(content.posts.total)}
              sub={`${formatNumber(content.posts.thisMonth)} this month`}
            />
            <StatTile
              icon={UserCheck}
              tone="amber"
              label="Awaiting approval"
              value={formatNumber(pending)}
              href="/admin/approvals"
              highlight={pending > 0}
              sub={pending > 0 ? 'Review registrations' : 'Nobody is waiting'}
            />
          </div>
        </CardContent>
      </Card>

      {/* Mentorship + exports */}
      <div className="grid gap-6 lg:grid-cols-2">
        <MentorshipOverviewCard />
        <ExportPanel />
      </div>

      {/* Recent activity */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Recent Registrations</CardTitle>
          </CardHeader>
          <CardContent>
            {recentActivity.users.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No registrations yet.</p>
            ) : (
              <ul className="space-y-4">
                {recentActivity.users.map((u) => (
                  <li key={u.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b pb-3 last:border-0 last:pb-0">
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-primary"
                        aria-hidden="true"
                      >
                        {getInitials(u.fullName || u.email)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{u.fullName || 'Unnamed applicant'}</p>
                        <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {u.approvalStatus && <ApprovalStatusBadge status={u.approvalStatus} />}
                      <p className="text-xs text-muted-foreground">
                        {u.batchYear ? `Batch ${u.batchYear} · ` : ''}
                        {formatDate(u.createdAt)}
                      </p>
                      {u.approvalStatus === 'PENDING' && (
                        <Link
                          href={`/admin/approvals?search=${encodeURIComponent(u.email)}`}
                          className="rounded text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          Review<span className="sr-only"> registration of {u.fullName || u.email}</span>
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Recent Posts</CardTitle>
          </CardHeader>
          <CardContent>
            {recentActivity.posts.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No posts yet.</p>
            ) : (
              <ul className="space-y-4">
                {recentActivity.posts.map((p) => (
                  <li key={p.id} className="border-b pb-3 last:border-0 last:pb-0">
                    <div className="mb-1 flex items-start justify-between gap-3">
                      <p className="text-sm font-semibold">{p.author}</p>
                      <p className="shrink-0 text-xs text-muted-foreground">{formatDate(p.createdAt)}</p>
                    </div>
                    <p className="mb-2 line-clamp-1 text-xs text-muted-foreground">{p.content}</p>
                    <div className="flex gap-4 text-xs font-medium text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Heart className="h-3 w-3" aria-hidden="true" /> {p.likes}
                        <span className="sr-only"> likes</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <MessageSquare className="h-3 w-3" aria-hidden="true" /> {p.comments}
                        <span className="sr-only"> comments</span>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

/** The admin landing page: the numbers an administrator checks first, and what is waiting for them. */
export default function AdminOverview() {
  const { stats, loading, error, reload } = useAdminStats(ERROR_FALLBACK);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Admin Dashboard"
        icon={LayoutDashboard}
        description="Overview of platform performance, member growth, and financial metrics."
        actions={
          <>
            <Button variant="outline" size="icon" onClick={() => void reload()} disabled={loading} aria-label="Refresh data">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            </Button>
            <Button variant="outline" asChild>
              <Link href="/admin/status">
                <Activity className="mr-2 h-4 w-4" aria-hidden="true" />
                System status
              </Link>
            </Button>
            <Button asChild>
              <a href="#data-exports">
                <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                Export
              </a>
            </Button>
          </>
        }
      />

      {stats ? (
        <Dashboard stats={stats} />
      ) : error ? (
        <AdminErrorState title="Could not load dashboard" message={error} onRetry={() => void reload()} retryLabel="Try again" retrying={loading} />
      ) : (
        <DashboardSkeleton />
      )}
    </div>
  );
}
