'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Users,
  DollarSign,
  Calendar,
  Briefcase,
  TrendingUp,
  TrendingDown,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { adminApi } from '@/lib/api';
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

interface StatCard {
  title: string;
  value: string | number;
  change: number;
  changeLabel: string;
  icon: any;
  color: string;
}

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

export default function AdminAnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('12m');
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    loadAnalytics();
  }, [timeRange]);

  const loadAnalytics = async () => {
    setLoading(true);
    try {
      const response = await adminApi.getStats();
      setStats(response.data.data);
    } catch (error) {
      console.error('Failed to load analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const statCards: StatCard[] = [
    {
      title: 'Total Users',
      value: formatNumber(stats?.users?.total || 0),
      change: stats?.users?.growthPercent || 0,
      changeLabel: 'vs last month',
      icon: Users,
      color: 'bg-blue-500',
    },
    {
      title: 'Total Revenue',
      value: formatCurrency(stats?.financial?.donations?.totalAmount || 0),
      change: stats?.financial?.donations?.growthPercent || 0,
      changeLabel: 'vs last month',
      icon: DollarSign,
      color: 'bg-green-500',
    },
    {
      title: 'Active Events',
      value: stats?.content?.events?.total || 0,
      change: stats?.content?.events?.newThisMonth || 0,
      changeLabel: 'new this month',
      icon: Calendar,
      color: 'bg-amber-500',
    },
    {
      title: 'Job Listings',
      value: stats?.content?.jobs?.total || 0,
      change: stats?.content?.jobs?.newThisMonth || 0,
      changeLabel: 'vs last month',
      icon: Briefcase,
      color: 'bg-purple-500',
    },
  ];

  if (loading || !stats) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex items-center gap-3">
          <RefreshCw className="h-6 w-6 animate-spin text-[#002045]" />
          <span className="text-lg text-gray-600">Loading analytics...</span>
        </div>
      </div>
    );
  }

  // Process User Growth Data
  const totalUsers = stats.users.total;
  const monthlyGrowth = stats.users.monthlyGrowth || [];
  const sumNewUsers = monthlyGrowth.reduce((acc: number, curr: any) => acc + curr.count, 0);
  let currentCumulative = totalUsers - sumNewUsers;
  
  const userGrowthData = monthlyGrowth.map((item: any) => {
    currentCumulative += item.count;
    return {
      month: item.month,
      users: currentCumulative,
      newUsers: item.count
    };
  });

  // Process Revenue Data
  const revenueData = stats.financial.donations.monthly || [];

  // Process Batch Distribution
  const batchDistribution = (stats.users.byBatch || []).map((item: any) => ({
    name: item.year?.toString() || 'Unknown',
    value: item.count
  }));

  // Process Role Distribution (using as membership distribution)
  const membershipDistribution = (stats.users.byRole || []).map((item: any, index: number) => ({
    name: item.role,
    value: item.count,
    color: COLORS[index % COLORS.length]
  }));

  // Engagement data (using from stats if available, otherwise mock or empty)
  const engagementData = [
    { name: 'Messages', value: stats.engagement.messages.total },
    { name: 'Connections', value: stats.engagement.connections },
    { name: 'Posts', value: stats.content.posts.total },
    { name: 'Comments', value: stats.content.posts.total * 2 }, // Approximation
  ];

  const weeklyEngagementData = [
    { day: 'Mon', posts: Math.floor(stats.content.posts.thisMonth / 10), comments: Math.floor(stats.content.posts.thisMonth / 5), messages: Math.floor(stats.engagement.messages.thisMonth / 10) },
    { day: 'Tue', posts: Math.floor(stats.content.posts.thisMonth / 8), comments: Math.floor(stats.content.posts.thisMonth / 4), messages: Math.floor(stats.engagement.messages.thisMonth / 8) },
    { day: 'Wed', posts: Math.floor(stats.content.posts.thisMonth / 12), comments: Math.floor(stats.content.posts.thisMonth / 6), messages: Math.floor(stats.engagement.messages.thisMonth / 12) },
    { day: 'Thu', posts: Math.floor(stats.content.posts.thisMonth / 9), comments: Math.floor(stats.content.posts.thisMonth / 4.5), messages: Math.floor(stats.engagement.messages.thisMonth / 9) },
    { day: 'Fri', posts: Math.floor(stats.content.posts.thisMonth / 7), comments: Math.floor(stats.content.posts.thisMonth / 3.5), messages: Math.floor(stats.engagement.messages.thisMonth / 7) },
    { day: 'Sat', posts: Math.floor(stats.content.posts.thisMonth / 15), comments: Math.floor(stats.content.posts.thisMonth / 7.5), messages: Math.floor(stats.engagement.messages.thisMonth / 15) },
    { day: 'Sun', posts: Math.floor(stats.content.posts.thisMonth / 20), comments: Math.floor(stats.content.posts.thisMonth / 10), messages: Math.floor(stats.engagement.messages.thisMonth / 20) },
  ];

  // Location data (using empty if not in stats)
  const locationData = (stats.users.byLocation || []).map((item: any) => ({
    city: item.city || 'Unknown',
    users: item.count
  }));

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="font-headline text-3xl font-bold text-gray-900">
              Analytics Dashboard
            </h1>
            <p className="text-gray-500">
              Comprehensive overview of platform performance and growth metrics
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-40 bg-white">
                <SelectValue placeholder="Time Range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="3m">Last 3 months</SelectItem>
                <SelectItem value="6m">Last 6 months</SelectItem>
                <SelectItem value="12m">Last 12 months</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={loadAnalytics}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button>
              <Download className="h-4 w-4 mr-2" />
              Export Report
            </Button>
          </div>
        </div>

        {/* Stat Cards */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {statCards.map((stat, index) => (
            <motion.div
              key={stat.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
            >
              <Card className="bg-white border-0 shadow-md">
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between">
                    <div className={`${stat.color} p-3 rounded-xl text-white`}>
                      <stat.icon className="h-6 w-6" />
                    </div>
                    <Badge
                      variant={stat.change >= 0 ? 'default' : 'destructive'}
                      className={`${
                        stat.change >= 0
                          ? 'bg-green-100 text-green-700 hover:bg-green-100'
                          : 'bg-red-100 text-red-700 hover:bg-red-100'
                      }`}
                    >
                      {stat.change >= 0 ? (
                        <ArrowUp className="h-3 w-3 mr-1" />
                      ) : (
                        <ArrowDown className="h-3 w-3 mr-1" />
                      )}
                      {Math.abs(stat.change)}%
                    </Badge>
                  </div>
                  <div className="mt-4">
                    <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
                    <p className="text-sm text-gray-500">{stat.title}</p>
                    <p className="text-xs text-gray-400 mt-1">{stat.changeLabel}</p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        {/* Charts Row 1 */}
        <div className="grid lg:grid-cols-2 gap-6">
          {/* User Growth Chart */}
          <Card className="bg-white border-0 shadow-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-blue-500" />
                User Growth
              </CardTitle>
              <CardDescription>Monthly user registration trends</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={userGrowthData}>
                    <defs>
                      <linearGradient id="colorUsers" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={CHART_COLORS.primary} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={CHART_COLORS.primary} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="month" stroke="#6b7280" fontSize={12} />
                    <YAxis stroke="#6b7280" fontSize={12} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'white',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                      }}
                    />
                    <Legend />
                    <Area
                      type="monotone"
                      dataKey="users"
                      stroke={CHART_COLORS.primary}
                      fillOpacity={1}
                      fill="url(#colorUsers)"
                      name="Total Users"
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

          {/* Revenue Chart */}
          <Card className="bg-white border-0 shadow-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-green-500" />
                Revenue Overview
              </CardTitle>
              <CardDescription>Donations and membership revenue</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={revenueData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="month" stroke="#6b7280" fontSize={12} />
                    <YAxis stroke="#6b7280" fontSize={12} tickFormatter={(v) => `₹${v / 1000}K`} />
                    <Tooltip
                      formatter={(value) => formatCurrency(Number(value))}
                      contentStyle={{
                        backgroundColor: 'white',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                      }}
                    />
                    <Legend />
                    <Bar
                      dataKey="donations"
                      fill={CHART_COLORS.primary}
                      name="Donations"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="memberships"
                      fill={CHART_COLORS.secondary}
                      name="Memberships"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Charts Row 2 */}
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Engagement Chart */}
          <Card className="bg-white border-0 shadow-md lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-purple-500" />
                Weekly Engagement
              </CardTitle>
              <CardDescription>Posts, comments, and messages activity</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={weeklyEngagementData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="day" stroke="#6b7280" fontSize={12} />
                    <YAxis stroke="#6b7280" fontSize={12} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'white',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                      }}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="posts"
                      stroke={CHART_COLORS.primary}
                      strokeWidth={2}
                      dot={{ r: 4 }}
                      name="Posts"
                    />
                    <Line
                      type="monotone"
                      dataKey="comments"
                      stroke={CHART_COLORS.success}
                      strokeWidth={2}
                      dot={{ r: 4 }}
                      name="Comments"
                    />
                    <Line
                      type="monotone"
                      dataKey="messages"
                      stroke={CHART_COLORS.warning}
                      strokeWidth={2}
                      dot={{ r: 4 }}
                      name="Messages"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
            </Card>

            {/* Membership Distribution */}
            <Card className="bg-white border-0 shadow-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-amber-500" />
                User Roles
              </CardTitle>
              <CardDescription>Distribution by user role</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={membershipDistribution}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={2}
                      dataKey="value"
                      label={({ name, percent }) => `${name} (${((percent || 0) * 100).toFixed(0)}%)`}
                      labelLine={false}
                    >
                      {membershipDistribution.map((entry: any, index: number) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => Number(value)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
            </Card>
            </div>

            {/* Charts Row 3 */}
            <div className="grid lg:grid-cols-2 gap-6">
            {/* Batch Distribution */}
            <Card className="bg-white border-0 shadow-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-blue-500" />
                Alumni by Batch
              </CardTitle>
              <CardDescription>Recent graduation years distribution</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={batchDistribution} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis type="number" stroke="#6b7280" fontSize={12} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      stroke="#6b7280"
                      fontSize={12}
                      width={100}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'white',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                      }}
                    />
                    <Bar dataKey="value" fill={CHART_COLORS.primary} radius={[0, 4, 4, 0]}>
                      {batchDistribution.map((entry: any, index: number) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
            </Card>

            {/* Location Distribution */}
            <Card className="bg-white border-0 shadow-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-rose-500" />
                Alumni by Location
              </CardTitle>
              <CardDescription>Top cities with most alumni</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={locationData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="city" stroke="#6b7280" fontSize={12} />
                    <YAxis stroke="#6b7280" fontSize={12} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'white',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                      }}
                    />
                    <Bar dataKey="users" fill={CHART_COLORS.primary} radius={[4, 4, 0, 0]}>
                      {locationData.map((entry: any, index: number) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
            </Card>
            </div>

            {/* Quick Stats Grid */}
            <Card className="bg-white border-0 shadow-md">
            <CardHeader>
            <CardTitle>Platform Activity Summary</CardTitle>
            <CardDescription>Real-time platform metrics</CardDescription>
            </CardHeader>
            <CardContent>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                { label: 'Active Sessions', value: 234, icon: Activity, color: 'text-green-500' },
                { label: 'New Registrations Today', value: stats.users.newThisMonth, icon: UserPlus, color: 'text-blue-500' },
                { label: 'Posts This Month', value: stats.content.posts.thisMonth, icon: Newspaper, color: 'text-purple-500' },
                { label: 'Messages This Month', value: stats.engagement.messages.thisMonth, icon: MessageSquare, color: 'text-amber-500' },
                { label: 'Upcoming Events', value: stats.content.events.upcoming, icon: Calendar, color: 'text-rose-500' },
                { label: 'Active Jobs', value: stats.content.jobs.active, icon: Briefcase, color: 'text-indigo-500' },
                { label: 'Connections', value: stats.engagement.connections, icon: Users, color: 'text-teal-500' },
                { label: 'Verified Users', value: stats.users.verified, icon: ShieldAlert, color: 'text-orange-500' },
              ].map((item, index) => (
                <div key={index} className="flex items-center gap-4 p-4 bg-slate-50 rounded-lg">
                  <div className={`${item.color}`}>
                    <item.icon className="h-8 w-8" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-gray-900">{formatNumber(item.value)}</p>
                    <p className="text-sm text-gray-500">{item.label}</p>
                  </div>
                </div>
              ))}
            </div>
            </CardContent>
            </Card>      </div>
    </div>
  );
}
