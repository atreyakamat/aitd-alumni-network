'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  BarChart3,
  Briefcase,
  Calendar,
  Download,
  IndianRupee,
  MapPin,
  MessageSquare,
  Newspaper,
  RefreshCw,
  TrendingUp,
  UserCheck,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { AdminErrorState } from '@/components/admin/AdminErrorState';
import { StatTile } from '@/components/admin/StatTile';
import { GrowthBadge } from '@/components/admin/GrowthBadge';
import { RevenueChart } from '@/components/admin/RevenueChart';
import { RoleDistributionChart } from '@/components/admin/RoleDistributionChart';
import { useAdminStats } from '@/lib/use-admin-stats';
import type { AdminStats } from '@/lib/admin-stats';
import { formatInr, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

const COLORS = ['#002045', '#004488', '#0066cc', '#3388dd', '#66aaee', '#99ccff'];
const CHART_COLORS = {
  primary: '#002045',
  secondary: '#b45309',
  success: '#16a34a',
  warning: '#f59e0b',
};
const TOOLTIP_STYLE = { backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px' };

type Range = '3m' | '6m' | '12m';

function ChartEmpty({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <div className="flex h-72 flex-col items-center justify-center gap-2 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <p className="font-medium">{title}</p>
      <p className="max-w-xs text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

interface SummaryItemProps {
  label: string;
  value: number;
  icon: LucideIcon;
  color: string;
  href?: string;
  highlight?: boolean;
}

/** One figure of the summary: only ever a number the stats API reports. */
function SummaryItem({ label, value, icon: Icon, color, href, highlight }: SummaryItemProps) {
  const content = (
    <>
      <Icon className={cn('h-8 w-8 shrink-0', color)} aria-hidden="true" />
      <div>
        <p className="text-2xl font-bold tabular-nums">{formatNumber(value)}</p>
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
    </>
  );
  const box = cn('flex items-center gap-4 rounded-lg p-4', highlight ? 'border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30' : 'bg-muted/50');
  if (href) {
    return (
      <Link href={href} className={cn(box, 'transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background')}>
        {content}
      </Link>
    );
  }
  return <div className={box}>{content}</div>;
}

function AnalyticsSkeleton() {
  return (
    <div aria-label="Loading analytics" aria-busy="true" className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-36" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-[420px]" />
        <Skeleton className="h-[420px]" />
      </div>
    </div>
  );
}

function Analytics({ stats, monthsShown }: { stats: AdminStats; monthsShown: number }) {
  const { users, content, financial, engagement } = stats;

  // Members by month: the running total ends at today's number of members
  const addedInPeriod = users.monthlyGrowth.reduce((sum, m) => sum + m.count, 0);
  let running = users.total - addedInPeriod;
  const memberGrowth = users.monthlyGrowth
    .map((m) => {
      running += m.count;
      return { month: m.month, members: running, newMembers: m.count };
    })
    .slice(-monthsShown);

  const revenue = financial.donations.monthly.slice(-monthsShown);
  const batches = users.byBatch.map((b) => ({ name: b.year?.toString() ?? 'Unknown', value: b.count }));
  const locations = users.byLocation.map((l) => ({ city: l.city || 'Unknown', users: l.count }));
  // Real per-day activity for the last 7 days (oldest first)
  const weekly = engagement.daily;
  const weekHasActivity = weekly.some((d) => d.posts > 0 || d.comments > 0 || d.messages > 0);

  return (
    <>
      {/* Headline figures */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={Users}
          tone="blue"
          label="Members"
          value={formatNumber(users.total)}
          badge={<GrowthBadge value={users.growthPercent} />}
          sub="new members vs last month"
        />
        <StatTile
          icon={IndianRupee}
          tone="green"
          label="Total Donations"
          value={formatInr(financial.donations.totalAmount)}
          badge={<GrowthBadge value={financial.donations.growthPercent} />}
          sub="donations vs last month"
        />
        <StatTile
          icon={Calendar}
          tone="amber"
          label="Events"
          value={formatNumber(content.events.total)}
          badge={<GrowthBadge value={content.events.newThisMonth} unit="count" />}
          sub="new this month"
        />
        <StatTile
          icon={Briefcase}
          tone="purple"
          label="Job Listings"
          value={formatNumber(content.jobs.total)}
          badge={<GrowthBadge value={content.jobs.newThisMonth} unit="count" />}
          sub="new this month"
        />
      </div>

      {/* Charts row 1 */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-blue-500" aria-hidden="true" />
              Member growth
            </CardTitle>
            <CardDescription>Approved members, month by month</CardDescription>
          </CardHeader>
          <CardContent>
            {memberGrowth.length === 0 ? (
              <ChartEmpty icon={Users} title="No members yet" text="Growth will be charted here once members have been approved." />
            ) : (
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={memberGrowth}>
                    <defs>
                      <linearGradient id="analyticsMembers" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={CHART_COLORS.primary} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={CHART_COLORS.primary} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="month" stroke="#6b7280" fontSize={12} />
                    <YAxis stroke="#6b7280" fontSize={12} allowDecimals={false} width={40} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Legend />
                    <Area type="monotone" dataKey="members" stroke={CHART_COLORS.primary} fillOpacity={1} fill="url(#analyticsMembers)" name="Members" />
                    <Line type="monotone" dataKey="newMembers" stroke={CHART_COLORS.secondary} strokeWidth={2} dot={{ r: 4 }} name="New members" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <IndianRupee className="h-5 w-5 text-green-500" aria-hidden="true" />
              Revenue Overview
            </CardTitle>
            <CardDescription>Donations and membership revenue</CardDescription>
          </CardHeader>
          <CardContent>
            <RevenueChart data={revenue} heightClass="h-80" />
          </CardContent>
        </Card>
      </div>

      {/* Charts row 2 */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-purple-500" aria-hidden="true" />
              Weekly Engagement
            </CardTitle>
            <CardDescription>Posts, comments, and messages over the last 7 days</CardDescription>
          </CardHeader>
          <CardContent>
            {!weekHasActivity ? (
              <ChartEmpty icon={Activity} title="No activity this week" text="Posts, comments and messages from the last 7 days will be charted here." />
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={weekly}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="day" stroke="#6b7280" fontSize={12} />
                    <YAxis stroke="#6b7280" fontSize={12} allowDecimals={false} width={40} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Legend />
                    <Line type="monotone" dataKey="posts" stroke={CHART_COLORS.primary} strokeWidth={2} dot={{ r: 4 }} name="Posts" />
                    <Line type="monotone" dataKey="comments" stroke={CHART_COLORS.success} strokeWidth={2} dot={{ r: 4 }} name="Comments" />
                    <Line type="monotone" dataKey="messages" stroke={CHART_COLORS.warning} strokeWidth={2} dot={{ r: 4 }} name="Messages" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-amber-500" aria-hidden="true" />
              Member roles
            </CardTitle>
            <CardDescription>Distribution by role</CardDescription>
          </CardHeader>
          <CardContent>
            <RoleDistributionChart byRole={users.byRole} heightClass="h-[200px]" />
          </CardContent>
        </Card>
      </div>

      {/* Charts row 3 */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-blue-500" aria-hidden="true" />
              Alumni by Batch
            </CardTitle>
            <CardDescription>Recent graduation years distribution</CardDescription>
          </CardHeader>
          <CardContent>
            {batches.length === 0 ? (
              <ChartEmpty icon={Users} title="No batch details yet" text="Members' graduation years will be charted here." />
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={batches} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis type="number" stroke="#6b7280" fontSize={12} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" stroke="#6b7280" fontSize={12} width={70} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="value" name="Alumni" fill={CHART_COLORS.primary} radius={[0, 4, 4, 0]}>
                      {batches.map((entry, index) => (
                        <Cell key={`${entry.name}-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-rose-500" aria-hidden="true" />
              Alumni by Location
            </CardTitle>
            <CardDescription>Top cities with most alumni</CardDescription>
          </CardHeader>
          <CardContent>
            {locations.length === 0 ? (
              <ChartEmpty icon={MapPin} title="No locations yet" text="Cities will be charted here as members add them to their profiles." />
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={locations}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="city" stroke="#6b7280" fontSize={12} />
                    <YAxis stroke="#6b7280" fontSize={12} allowDecimals={false} width={40} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="users" name="Alumni" fill={CHART_COLORS.primary} radius={[4, 4, 0, 0]}>
                      {locations.map((entry, index) => (
                        <Cell key={`${entry.city}-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Summary: every figure is a field of the stats API */}
      <Card role="region" aria-label="Platform Activity Summary">
        <CardHeader>
          <CardTitle>Platform Activity Summary</CardTitle>
          <CardDescription>Key figures as of this page load</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryItem label="Active members (last 30 days)" value={users.active} icon={Activity} color="text-green-500" />
            <SummaryItem label="New members this month" value={users.newThisMonth} icon={UserPlus} color="text-blue-500" />
            <SummaryItem label="Posts This Month" value={content.posts.thisMonth} icon={Newspaper} color="text-purple-500" />
            <SummaryItem label="Messages This Month" value={engagement.messages.thisMonth} icon={MessageSquare} color="text-amber-500" />
            <SummaryItem label="Upcoming Events" value={content.events.upcoming} icon={Calendar} color="text-rose-500" />
            <SummaryItem label="Active Jobs" value={content.jobs.active} icon={Briefcase} color="text-indigo-500" />
            <SummaryItem label="Connections" value={engagement.connections} icon={Users} color="text-teal-500" />
            <SummaryItem
              label="Awaiting approval"
              value={users.pendingApproval}
              icon={UserCheck}
              color="text-amber-600"
              href="/admin/approvals"
              highlight={users.pendingApproval > 0}
            />
          </div>
        </CardContent>
      </Card>
    </>
  );
}

export default function AdminAnalyticsPage() {
  const { stats, loading, error, reload } = useAdminStats('Failed to load analytics');
  // The API returns 12 months of monthly series; the range trims them client-side
  const [timeRange, setTimeRange] = useState<Range>('12m');
  const monthsShown = Number(timeRange.replace('m', ''));

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Analytics Dashboard"
        icon={BarChart3}
        description="Comprehensive overview of platform performance and growth metrics"
        actions={
          <>
            <Select value={timeRange} onValueChange={(v) => setTimeRange(v as Range)}>
              <SelectTrigger className="w-40" aria-label="Time range">
                <SelectValue placeholder="Time Range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="3m">Last 3 months</SelectItem>
                <SelectItem value="6m">Last 6 months</SelectItem>
                <SelectItem value="12m">Last 12 months</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={() => void reload()} disabled={loading} aria-label="Refresh data">
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden="true" />
            </Button>
            <Button asChild>
              <Link href="/admin#data-exports">
                <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                Data Exports
              </Link>
            </Button>
          </>
        }
      />

      {stats ? (
        <Analytics stats={stats} monthsShown={monthsShown} />
      ) : error ? (
        <AdminErrorState title="Could not load analytics" message={error} onRetry={() => void reload()} retrying={loading} />
      ) : (
        <AnalyticsSkeleton />
      )}
    </div>
  );
}
