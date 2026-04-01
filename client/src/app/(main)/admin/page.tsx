'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Users,
  DollarSign,
  Calendar,
  Briefcase,
  TrendingUp,
  ArrowUp,
  ArrowDown,
  Activity,
  UserPlus,
  CreditCard,
  Eye,
  Download,
  RefreshCw,
  Clock,
  MapPin,
  Newspaper,
  MessageSquare,
  ShieldAlert
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { adminApi } from '@/lib/api';
import { useAuth } from '@/context/auth-context';
import { useRouter } from 'next/navigation';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';

const COLORS = ['#002045', '#004488', '#0066cc', '#3388dd', '#66aaee', '#99ccff'];
const CHART_COLORS = {
  primary: '#002045',
  secondary: '#b45309',
  success: '#16a34a',
  warning: '#f59e0b',
  danger: '#dc2626',
};

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

const formatNumber = (value: number) => {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value.toString();
};

export default function AdminDashboardPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('12m');
  const [stats, setStats] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && (!user || user.role !== 'ADMIN' && user.role !== 'SUPERADMIN')) {
      router.push('/dashboard');
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (user && (user.role === 'ADMIN' || user.role === 'SUPERADMIN')) {
      loadStats();
    }
  }, [user, timeRange]);

  const loadStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await adminApi.getStats();
      setStats(response.data.data);
    } catch (err: any) {
      console.error('Failed to load admin stats:', err);
      setError(err.response?.data?.error || 'Failed to load dashboard statistics');
    } finally {
      setLoading(false);
    }
  };

  if (authLoading || (loading && !stats)) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground animate-pulse">Loading analytics data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <ShieldAlert className="h-12 w-12 text-destructive mx-auto mb-4" />
            <h3 className="text-xl font-bold mb-2">Access Denied or Error</h3>
            <p className="text-muted-foreground mb-6">{error}</p>
            <Button onClick={loadStats}>Try Again</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!stats) return null;

  // Process User Growth Data
  const totalUsers = stats.users.total;
  const monthlyGrowth = stats.users.monthlyGrowth || [];
  const sumNewUsers = monthlyGrowth.reduce((acc: number, curr: any) => acc + curr.count, 0);
  let currentCumulative = totalUsers - sumNewUsers;
  
  const userGrowthChartData = monthlyGrowth.map((item: any) => {
    currentCumulative += item.count;
    return {
      month: item.month,
      users: currentCumulative,
      newUsers: item.count
    };
  });

  // Process Revenue Data
  const revenueChartData = stats.financial.donations.monthly || [];

  // Process Batch Distribution
  const batchChartData = (stats.users.byBatch || []).map((item: any) => ({
    name: item.year?.toString() || 'Unknown',
    value: item.count
  }));

  // Process Role Distribution for Pie Chart
  const roleDistribution = (stats.users.byRole || []).map((item: any) => ({
    name: item.role,
    value: item.count
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Admin Dashboard</h1>
          <p className="text-muted-foreground">
            Overview of platform performance, user growth, and financial metrics.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Time Range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="12m">Last 12 months</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={loadStats}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button>
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* Main Stats Grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div className="bg-blue-100 p-2 rounded-lg text-blue-700">
                <Users className="h-5 w-5" />
              </div>
              <Badge variant={stats.users.growthPercent >= 0 ? 'default' : 'destructive'} className={stats.users.growthPercent >= 0 ? 'bg-green-100 text-green-700' : ''}>
                {stats.users.growthPercent >= 0 ? '+' : ''}{stats.users.growthPercent}%
              </Badge>
            </div>
            <div className="mt-3">
              <p className="text-2xl font-bold">{formatNumber(stats.users.total)}</p>
              <p className="text-sm text-muted-foreground font-medium">Total Users</p>
              <p className="text-xs text-muted-foreground mt-1">{stats.users.newThisMonth} new this month</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div className="bg-green-100 p-2 rounded-lg text-green-700">
                <DollarSign className="h-5 w-5" />
              </div>
              <Badge className="bg-green-100 text-green-700">
                Live
              </Badge>
            </div>
            <div className="mt-3">
              <p className="text-2xl font-bold">{formatCurrency(stats.financial.donations.totalAmount)}</p>
              <p className="text-sm text-muted-foreground font-medium">Total Revenue</p>
              <p className="text-xs text-muted-foreground mt-1">{formatCurrency(stats.financial.donations.thisMonth)} this month</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div className="bg-amber-100 p-2 rounded-lg text-amber-700">
                <Calendar className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-3">
              <p className="text-2xl font-bold">{stats.content.events.total}</p>
              <p className="text-sm text-muted-foreground font-medium">Total Events</p>
              <p className="text-xs text-muted-foreground mt-1">{stats.content.events.upcoming} upcoming events</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div className="bg-purple-100 p-2 rounded-lg text-purple-700">
                <Briefcase className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-3">
              <p className="text-2xl font-bold">{stats.content.jobs.total}</p>
              <p className="text-sm text-muted-foreground font-medium">Job Listings</p>
              <p className="text-xs text-muted-foreground mt-1">{stats.content.jobs.active} currently active</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 1 */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* User Growth Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-blue-500" />
              User Growth
            </CardTitle>
            <CardDescription>Registration trends over time</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={userGrowthChartData}>
                  <defs>
                    <linearGradient id="colorUsers" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS.primary} stopOpacity={0.1} />
                      <stop offset="95%" stopColor={CHART_COLORS.primary} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis dataKey="month" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => formatNumber(v)} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="users"
                    stroke={CHART_COLORS.primary}
                    fillOpacity={1}
                    fill="url(#colorUsers)"
                    name="Total Users"
                    strokeWidth={2}
                  />
                  <Line
                    type="monotone"
                    dataKey="newUsers"
                    stroke={CHART_COLORS.secondary}
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    name="New Users"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Financial Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-green-500" />
              Revenue Analytics
            </CardTitle>
            <CardDescription>Monthly donation and membership trends</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenueChartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis dataKey="month" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `₹${v/1000}k`} />
                  <Tooltip 
                    formatter={(v: any) => formatCurrency(v)}
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                  />
                  <Legend />
                  <Bar dataKey="donations" fill={CHART_COLORS.primary} radius={[4, 4, 0, 0]} name="Donations" />
                  <Bar dataKey="memberships" fill={CHART_COLORS.secondary} radius={[4, 4, 0, 0]} name="Memberships" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 2 */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* User Roles Pie Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">User Roles</CardTitle>
            <CardDescription>Distribution of user types</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={roleDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {roleDistribution.map((entry: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Batch Distribution */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Users className="h-4 w-4 text-blue-500" />
              Alumni by Batch
            </CardTitle>
            <CardDescription>Recent graduation years distribution</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={batchChartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                  />
                  <Bar dataKey="value" fill={CHART_COLORS.primary} radius={[4, 4, 0, 0]} name="Alumni" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Engagement Stats */}
      <Card>
        <CardHeader>
          <CardTitle>Platform Engagement</CardTitle>
          <CardDescription>Key activity metrics for the platform</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div className="space-y-1">
              <div className="flex items-center text-muted-foreground gap-2">
                <MessageSquare className="h-4 w-4" />
                <span className="text-sm font-medium">Total Messages</span>
              </div>
              <p className="text-2xl font-bold">{formatNumber(stats.engagement.messages.total)}</p>
              <p className="text-xs text-green-600 font-medium">
                {stats.engagement.messages.thisMonth} this month
              </p>
            </div>
            
            <div className="space-y-1">
              <div className="flex items-center text-muted-foreground gap-2">
                <Users className="h-4 w-4" />
                <span className="text-sm font-medium">Connections</span>
              </div>
              <p className="text-2xl font-bold">{formatNumber(stats.engagement.connections)}</p>
              <p className="text-xs text-muted-foreground font-medium">
                Accepted requests
              </p>
            </div>

            <div className="space-y-1">
              <div className="flex items-center text-muted-foreground gap-2">
                <Newspaper className="h-4 w-4" />
                <span className="text-sm font-medium">Total Posts</span>
              </div>
              <p className="text-2xl font-bold">{formatNumber(stats.content.posts.total)}</p>
              <p className="text-xs text-green-600 font-medium">
                {stats.content.posts.thisMonth} this month
              </p>
            </div>

            <div className="space-y-1">
              <div className="flex items-center text-muted-foreground gap-2">
                <ShieldAlert className="h-4 w-4" />
                <span className="text-sm font-medium">Verified Users</span>
              </div>
              <p className="text-2xl font-bold">{formatNumber(stats.users.verified)}</p>
              <p className="text-xs text-muted-foreground font-medium">
                {((stats.users.verified / stats.users.total) * 100).toFixed(1)}% of total
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Recent Registrations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {stats.recentActivity.users.map((u: any) => (
                <div key={u.id} className="flex items-center justify-between border-b pb-3 last:border-0 last:pb-0">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-full bg-slate-100 flex items-center justify-center font-bold text-primary text-xs">
                      {u.fullName.split(' ').map((n: string) => n[0]).join('')}
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{u.fullName}</p>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-medium">Batch {u.batchYear}</p>
                    <p className="text-[10px] text-muted-foreground">{new Date(u.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Recent Posts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {stats.recentActivity.posts.map((p: any) => (
                <div key={p.id} className="border-b pb-3 last:border-0 last:pb-0">
                  <div className="flex justify-between items-start mb-1">
                    <p className="text-sm font-semibold">{p.author}</p>
                    <p className="text-[10px] text-muted-foreground">{new Date(p.createdAt).toLocaleDateString()}</p>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-1 mb-2">{p.content}</p>
                  <div className="flex gap-4 text-[10px] text-muted-foreground font-medium">
                    <span className="flex items-center gap-1"><Heart className="h-3 w-3" /> {p.likes}</span>
                    <span className="flex items-center gap-1"><MessageSquare className="h-3 w-3" /> {p.comments}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
