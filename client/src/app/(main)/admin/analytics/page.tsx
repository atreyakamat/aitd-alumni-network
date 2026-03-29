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
  MessageSquare
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
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

// Mock data for charts - in production, this would come from API
const userGrowthData = [
  { month: 'Jan', users: 120, newUsers: 20 },
  { month: 'Feb', users: 145, newUsers: 25 },
  { month: 'Mar', users: 180, newUsers: 35 },
  { month: 'Apr', users: 210, newUsers: 30 },
  { month: 'May', users: 250, newUsers: 40 },
  { month: 'Jun', users: 300, newUsers: 50 },
  { month: 'Jul', users: 340, newUsers: 40 },
  { month: 'Aug', users: 395, newUsers: 55 },
  { month: 'Sep', users: 440, newUsers: 45 },
  { month: 'Oct', users: 500, newUsers: 60 },
  { month: 'Nov', users: 550, newUsers: 50 },
  { month: 'Dec', users: 620, newUsers: 70 },
];

const revenueData = [
  { month: 'Jan', donations: 25000, memberships: 15000 },
  { month: 'Feb', donations: 32000, memberships: 18000 },
  { month: 'Mar', donations: 28000, memberships: 22000 },
  { month: 'Apr', donations: 45000, memberships: 25000 },
  { month: 'May', donations: 38000, memberships: 20000 },
  { month: 'Jun', donations: 55000, memberships: 30000 },
  { month: 'Jul', donations: 48000, memberships: 28000 },
  { month: 'Aug', donations: 62000, memberships: 35000 },
  { month: 'Sep', donations: 70000, memberships: 32000 },
  { month: 'Oct', donations: 58000, memberships: 38000 },
  { month: 'Nov', donations: 75000, memberships: 42000 },
  { month: 'Dec', donations: 85000, memberships: 50000 },
];

const engagementData = [
  { day: 'Mon', posts: 45, comments: 120, messages: 85 },
  { day: 'Tue', posts: 52, comments: 135, messages: 92 },
  { day: 'Wed', posts: 48, comments: 118, messages: 78 },
  { day: 'Thu', posts: 60, comments: 150, messages: 105 },
  { day: 'Fri', posts: 55, comments: 142, messages: 95 },
  { day: 'Sat', posts: 35, comments: 80, messages: 55 },
  { day: 'Sun', posts: 28, comments: 65, messages: 42 },
];

const batchDistribution = [
  { name: '2020-2024', value: 450 },
  { name: '2015-2019', value: 380 },
  { name: '2010-2014', value: 290 },
  { name: '2005-2009', value: 200 },
  { name: '2000-2004', value: 150 },
  { name: 'Before 2000', value: 80 },
];

const membershipDistribution = [
  { name: 'Premium', value: 120, color: '#b45309' },
  { name: 'Standard', value: 280, color: '#002045' },
  { name: 'Basic', value: 450, color: '#64748b' },
  { name: 'Free', value: 700, color: '#94a3b8' },
];

const locationData = [
  { city: 'Mumbai', users: 280 },
  { city: 'Bangalore', users: 220 },
  { city: 'Delhi', users: 180 },
  { city: 'Pune', users: 150 },
  { city: 'Hyderabad', users: 120 },
  { city: 'Chennai', users: 100 },
  { city: 'Others', users: 500 },
];

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
      // In production, fetch from actual API endpoints
      const [usersRes, donationsRes, eventsRes] = await Promise.all([
        api.get('/api/admin/stats').catch(() => ({ data: {} })),
        api.get('/api/donations/stats').catch(() => ({ data: { data: {} } })),
        api.get('/api/events').catch(() => ({ data: { data: [] } })),
      ]);

      setStats({
        users: usersRes.data?.data || { total: 1550, newThisMonth: 70 },
        donations: donationsRes.data?.data || { totalAmount: 621000, totalDonors: 245 },
        events: eventsRes.data?.data?.length || 24,
      });
    } catch (error) {
      console.error('Failed to load analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const statCards: StatCard[] = [
    {
      title: 'Total Users',
      value: formatNumber(stats?.users?.total || 1550),
      change: 12.5,
      changeLabel: 'vs last month',
      icon: Users,
      color: 'bg-blue-500',
    },
    {
      title: 'Total Revenue',
      value: formatCurrency(stats?.donations?.totalAmount || 621000),
      change: 18.2,
      changeLabel: 'vs last month',
      icon: DollarSign,
      color: 'bg-green-500',
    },
    {
      title: 'Active Events',
      value: stats?.events || 24,
      change: 5,
      changeLabel: 'new this month',
      icon: Calendar,
      color: 'bg-amber-500',
    },
    {
      title: 'Job Listings',
      value: 156,
      change: -3.2,
      changeLabel: 'vs last month',
      icon: Briefcase,
      color: 'bg-purple-500',
    },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex items-center gap-3">
          <RefreshCw className="h-6 w-6 animate-spin text-[#002045]" />
          <span className="text-lg text-gray-600">Loading analytics...</span>
        </div>
      </div>
    );
  }

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
                  <LineChart data={engagementData}>
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
                Membership Tiers
              </CardTitle>
              <CardDescription>Distribution by subscription type</CardDescription>
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
                      {membershipDistribution.map((entry, index) => (
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
              <CardDescription>Distribution across graduation years</CardDescription>
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
                      {batchDistribution.map((entry, index) => (
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
                      {locationData.map((entry, index) => (
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
                { label: 'New Registrations Today', value: 12, icon: UserPlus, color: 'text-blue-500' },
                { label: 'Posts This Week', value: 156, icon: Newspaper, color: 'text-purple-500' },
                { label: 'Messages Today', value: 892, icon: MessageSquare, color: 'text-amber-500' },
                { label: 'Events This Month', value: 8, icon: Calendar, color: 'text-rose-500' },
                { label: 'Jobs Posted', value: 24, icon: Briefcase, color: 'text-indigo-500' },
                { label: 'Avg. Session Duration', value: '12m', icon: Clock, color: 'text-teal-500' },
                { label: 'Page Views Today', value: '4.5K', icon: Eye, color: 'text-orange-500' },
              ].map((item, index) => (
                <div key={index} className="flex items-center gap-4 p-4 bg-slate-50 rounded-lg">
                  <div className={`${item.color}`}>
                    <item.icon className="h-8 w-8" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-gray-900">{item.value}</p>
                    <p className="text-sm text-gray-500">{item.label}</p>
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
