'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Heart,
  Trophy,
  Users,
  TrendingUp,
  Gift,
  MapPin,
  Search,
  Filter,
  ChevronDown,
  Sparkles,
  Crown,
  Medal,
  Star,
  Download,
  Share2
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { donationApi } from '@/lib/api';
import { getPaymentErrorMessage, openRazorpayCheckout } from '@/lib/payments';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-context';
import { shareLinkWithToast } from '@/lib/share';
import { getInitials, formatCurrency } from '@/lib/utils';
import Link from 'next/link';

interface Donor {
  id: string;
  fullName: string;
  profilePhotoUrl: string | null;
  batchYear: number | null;
}

interface Donation {
  id: string;
  amount: number;
  isAnonymous: boolean;
  dedicatedTo: string | null;
  message: string | null;
  createdAt: string;
  user: Donor | null;
  chapter: { id: string; name: string } | null;
}

interface ChapterDonation {
  id: string;
  name: string;
  totalDonations: number;
  _count: { donations: number };
}

interface DonationStats {
  totalAmount: number;
  totalDonors: number;
  thisMonthAmount: number;
}

const getRankIcon = (index: number) => {
  switch (index) {
    case 0:
      return <Crown className="h-5 w-5 text-yellow-500" />;
    case 1:
      return <Medal className="h-5 w-5 text-gray-400" />;
    case 2:
      return <Medal className="h-5 w-5 text-amber-600" />;
    default:
      return <span className="text-sm font-medium text-gray-500">#{index + 1}</span>;
  }
};

export default function DonationsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [donations, setDonations] = useState<Donation[]>([]);
  const [donorSearch, setDonorSearch] = useState('');
  const [featuredDonors, setFeaturedDonors] = useState<any[]>([]);
  const [chapterDonations, setChapterDonations] = useState<ChapterDonation[]>([]);
  const [stats, setStats] = useState<DonationStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('wall');
  const [donationAmount, setDonationAmount] = useState<number>(1000);
  const [showDonateModal, setShowDonateModal] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [wallRes, leaderboardRes, chaptersRes, statsRes] = await Promise.all([
        donationApi.getDonorsWall(),
        donationApi.getLeaderboard(),
        donationApi.getChapterDonations(),
        donationApi.getStats(),
      ]);
      
      setDonations(wallRes.data?.data?.data || wallRes.data?.data || []);
      setFeaturedDonors(leaderboardRes.data?.data || []);
      setChapterDonations(chaptersRes.data?.data || []);
      setStats(statsRes.data?.data || null);
    } catch (error) {
      console.error('Failed to load donations data:', error);
    } finally {
      setLoading(false);
    }
  };

  const [donating, setDonating] = useState(false);

  const handleDonate = async (amount: number) => {
    if (donating) return;
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: 'Enter a donation amount', variant: 'destructive' });
      return;
    }
    setDonating(true);
    try {
      // Guests may leave a name/e-mail: the receipt is e-mailed to them (members get theirs in Settings).
      const guest: { donorName?: string; donorEmail?: string } = user
        ? {}
        : { donorName: guestName.trim() || undefined, donorEmail: guestEmail.trim() || undefined };
      const response = await donationApi.createOrder({ amount, isAnonymous: false, ...guest });
      const order = response.data.data;

      await openRazorpayCheckout(order, {
        description: 'Donation to Alumni Network',
        prefill: user
          ? { name: user.fullName, email: user.email }
          : guest.donorName || guest.donorEmail
            ? { name: guest.donorName, email: guest.donorEmail }
            : undefined,
        onDismiss: () => setDonating(false),
        onSuccess: async (verification) => {
          try {
            await donationApi.verifyPayment(verification);
            toast({
              title: 'Thank you!',
              description: user
                ? 'Your donation was received. A receipt is available in Settings.'
                : guest.donorEmail
                  ? `Your donation was received. A receipt has been e-mailed to ${guest.donorEmail}.`
                  : 'Your donation was received. Sign in or join to keep receipts in your account.',
            });
            loadData();
          } catch (err) {
            toast({
              title: 'Payment verification failed',
              description: getPaymentErrorMessage(err, 'If you were charged, contact support with your payment ID.'),
              variant: 'destructive',
            });
          } finally {
            setDonating(false);
          }
        },
      });
    } catch (err) {
      toast({
        title: 'Could not start payment',
        description: getPaymentErrorMessage(err, 'Please try again in a moment.'),
        variant: 'destructive',
      });
      setDonating(false);
    }
  };

  const campaignGoal = 500000;
  const campaignProgress = stats ? (stats.totalAmount / campaignGoal) * 100 : 0;

  const filteredDonations = donations.filter((donation) => {
    if (!donorSearch.trim()) return true;
    const q = donorSearch.toLowerCase();
    const name = donation.isAnonymous ? 'anonymous' : (donation.user?.fullName || '').toLowerCase();
    const message = (donation.message || '').toLowerCase();
    const dedicatedTo = (donation.dedicatedTo || '').toLowerCase();
    const chapterName = (donation.chapter?.name || '').toLowerCase();
    return name.includes(q) || message.includes(q) || dedicatedTo.includes(q) || chapterName.includes(q);
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-pulse text-lg text-gray-600">Loading donations...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Hero Section */}
      <section className="relative bg-gradient-to-br from-[#002045] via-[#003366] to-[#004488] text-white py-16 overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 left-10 w-72 h-72 bg-amber-400 rounded-full blur-3xl" />
          <div className="absolute bottom-10 right-10 w-96 h-96 bg-blue-400 rounded-full blur-3xl" />
        </div>
        
        <div className="container mx-auto px-6 relative z-10">
          <div className="max-w-4xl mx-auto text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 mb-4">
                <Sparkles className="h-3 w-3 mr-1" />
                Support Your Alumni Network
              </Badge>
              <h1 className="font-headline text-4xl md:text-5xl font-bold mb-4">
                Make an Impact Today
              </h1>
              <p className="text-lg text-blue-100 mb-8 max-w-2xl mx-auto">
                Your generous contribution helps fund scholarships, events, and initiatives 
                that strengthen our alumni community and support future generations.
              </p>
            </motion.div>

            {/* Campaign Progress */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 mb-8"
            >
              <div className="flex justify-between items-center mb-3">
                <span className="text-sm text-blue-200">Annual Campaign Progress</span>
                <span className="text-sm font-medium text-amber-300">
                  {Math.round(campaignProgress)}% of goal
                </span>
              </div>
              <Progress value={Math.min(campaignProgress, 100)} className="h-3 mb-3" />
              <div className="flex justify-between">
                <span className="text-2xl font-bold">{formatCurrency(stats?.totalAmount || 0)}</span>
                <span className="text-blue-200">Goal: {formatCurrency(campaignGoal)}</span>
              </div>
            </motion.div>

            {/* Quick Donate Buttons */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="flex flex-wrap gap-3 justify-center mb-4"
            >
              {[500, 1000, 2500, 5000, 10000].map((amount) => (
                <Button
                  key={amount}
                  variant={donationAmount === amount ? 'default' : 'outline'}
                  className={`${
                    donationAmount === amount
                      ? 'bg-amber-500 hover:bg-amber-600 text-white'
                      : 'border-white/30 text-white hover:bg-white/10'
                  }`}
                  onClick={() => setDonationAmount(amount)}
                >
                  {formatCurrency(amount)}
                </Button>
              ))}
            </motion.div>
            
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.4 }}
            >
              {!user && (
                <div className="mx-auto mb-4 grid max-w-md gap-3 sm:grid-cols-2">
                  <Input
                    aria-label="Your name (optional)"
                    placeholder="Your name (optional)"
                    maxLength={100}
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    className="border-white/30 bg-white/10 text-white placeholder:text-blue-200"
                  />
                  <Input
                    type="email"
                    aria-label="E-mail for your receipt (optional)"
                    placeholder="E-mail for your receipt"
                    maxLength={254}
                    value={guestEmail}
                    onChange={(e) => setGuestEmail(e.target.value)}
                    className="border-white/30 bg-white/10 text-white placeholder:text-blue-200"
                  />
                </div>
              )}
              <Button
                size="lg"
                className="bg-amber-500 hover:bg-amber-600 text-white px-8 py-6 text-lg"
                onClick={() => handleDonate(donationAmount)}
                disabled={donating}
              >
                <Heart className="h-5 w-5 mr-2" />
                Donate {formatCurrency(donationAmount)}
              </Button>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Stats Cards */}
      <section className="container mx-auto px-6 -mt-8 relative z-20">
        <div className="grid md:grid-cols-3 gap-6">
          {[
            {
              icon: Heart,
              label: 'Total Donations',
              value: formatCurrency(stats?.totalAmount || 0),
              color: 'bg-rose-500',
            },
            {
              icon: Users,
              label: 'Total Donors',
              value: stats?.totalDonors?.toString() || '0',
              color: 'bg-blue-500',
            },
            {
              icon: TrendingUp,
              label: 'This Month',
              value: formatCurrency(stats?.thisMonthAmount || 0),
              color: 'bg-green-500',
            },
          ].map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
            >
              <Card className="bg-white shadow-lg border-0">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className={`${stat.color} p-3 rounded-xl text-white`}>
                      <stat.icon className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">{stat.label}</p>
                      <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Main Content */}
      <section className="container mx-auto px-6 py-12">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-8">
          <TabsList className="bg-white border shadow-sm">
            <TabsTrigger value="wall" className="data-[state=active]:bg-[#002045] data-[state=active]:text-white">
              <Gift className="h-4 w-4 mr-2" />
              Wall of Donors
            </TabsTrigger>
            <TabsTrigger value="leaderboard" className="data-[state=active]:bg-[#002045] data-[state=active]:text-white">
              <Trophy className="h-4 w-4 mr-2" />
              Leaderboard
            </TabsTrigger>
            <TabsTrigger value="chapters" className="data-[state=active]:bg-[#002045] data-[state=active]:text-white">
              <MapPin className="h-4 w-4 mr-2" />
              By Chapter
            </TabsTrigger>
          </TabsList>

          {/* Wall of Donors */}
          <TabsContent value="wall" className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="font-headline text-2xl font-bold text-gray-900">
                Recent Contributors
              </h2>
              <div className="flex gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="Search donors..."
                    className="pl-9 w-64"
                    value={donorSearch}
                    onChange={(e) => setDonorSearch(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              <AnimatePresence>
                {filteredDonations.map((donation, index) => (
                  <motion.div
                    key={donation.id}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.3, delay: index * 0.05 }}
                  >
                    <Card className="bg-white hover:shadow-lg transition-shadow border-0 shadow-md overflow-hidden">
                      <CardContent className="pt-6">
                        <div className="flex items-start gap-4">
                          <Avatar className="h-12 w-12 border-2 border-amber-100">
                            <AvatarImage src={donation.user?.profilePhotoUrl || ''} />
                            <AvatarFallback className="bg-gradient-to-br from-[#002045] to-[#004488] text-white">
                              {donation.isAnonymous
                                ? '?'
                                : getInitials(donation.user?.fullName || 'A')}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <h3 className="font-semibold text-gray-900 truncate">
                                {donation.isAnonymous
                                  ? 'Anonymous Donor'
                                  : donation.user?.fullName || 'Anonymous'}
                              </h3>
                              <span className="text-lg font-bold text-amber-600">
                                {formatCurrency(donation.amount)}
                              </span>
                            </div>
                            {donation.user?.batchYear && !donation.isAnonymous && (
                              <p className="text-sm text-gray-500">
                                Class of {donation.user.batchYear}
                              </p>
                            )}
                            {donation.dedicatedTo && (
                              <p className="text-sm text-gray-500 mt-1 italic">
                                "In honor of {donation.dedicatedTo}"
                              </p>
                            )}
                            {donation.message && (
                              <p className="text-sm text-gray-600 mt-2 line-clamp-2">
                                "{donation.message}"
                              </p>
                            )}
                            <div className="flex items-center gap-2 mt-2">
                              {donation.chapter && (
                                <Badge variant="secondary" className="text-xs">
                                  <MapPin className="h-3 w-3 mr-1" />
                                  {donation.chapter.name}
                                </Badge>
                              )}
                              <span className="text-xs text-gray-400">
                                {new Date(donation.createdAt).toLocaleDateString('en-IN', {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric',
                                })}
                              </span>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            {filteredDonations.length === 0 && (
              <div className="text-center py-16 bg-white rounded-xl shadow-sm">
                <Heart className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  {donorSearch ? 'No matching donors found' : 'No donations yet'}
                </h3>
                <p className="text-gray-500 mb-4">
                  {donorSearch ? 'Try a different search term.' : 'Be the first to contribute!'}
                </p>
                {!donorSearch && (
                  <Button onClick={() => handleDonate(1000)} disabled={donating}>
                    <Heart className="h-4 w-4 mr-2" />
                    Donate Now
                  </Button>
                )}
              </div>
            )}
          </TabsContent>

          {/* Leaderboard */}
          <TabsContent value="leaderboard" className="space-y-6">
            <div className="grid lg:grid-cols-3 gap-6">
              {/* Top 3 Featured */}
              <div className="lg:col-span-2">
                <h2 className="font-headline text-2xl font-bold text-gray-900 mb-6">
                  Top Contributors
                </h2>
                <div className="grid md:grid-cols-3 gap-4 mb-8">
                  {featuredDonors.slice(0, 3).map((donor, index) => (
                    <motion.div
                      key={donor.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: index * 0.1 }}
                      className={`relative ${index === 0 ? 'md:-mt-4' : ''}`}
                    >
                      <Card
                        className={`bg-white border-0 shadow-lg overflow-hidden ${
                          index === 0
                            ? 'ring-2 ring-amber-400'
                            : index === 1
                            ? 'ring-2 ring-gray-300'
                            : 'ring-2 ring-amber-600'
                        }`}
                      >
                        <div
                          className={`h-2 ${
                            index === 0
                              ? 'bg-gradient-to-r from-amber-400 to-yellow-500'
                              : index === 1
                              ? 'bg-gradient-to-r from-gray-300 to-gray-400'
                              : 'bg-gradient-to-r from-amber-600 to-amber-700'
                          }`}
                        />
                        <CardContent className="pt-6 text-center">
                          <div className="relative inline-block mb-4">
                            <Avatar className="h-20 w-20 border-4 border-white shadow-lg">
                              <AvatarImage src={donor.user?.profilePhotoUrl || ''} />
                              <AvatarFallback className="bg-gradient-to-br from-[#002045] to-[#004488] text-white text-xl">
                                {getInitials(donor.user?.fullName || 'A')}
                              </AvatarFallback>
                            </Avatar>
                            <div className="absolute -top-2 -right-2">
                              {getRankIcon(index)}
                            </div>
                          </div>
                          <h3 className="font-semibold text-gray-900 mb-1">
                            {donor.user?.fullName || 'Anonymous'}
                          </h3>
                          {donor.user?.batchYear && (
                            <p className="text-sm text-gray-500 mb-2">
                              Class of {donor.user.batchYear}
                            </p>
                          )}
                          <p className="text-2xl font-bold text-amber-600">
                            {formatCurrency(donor.amount)}
                          </p>
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))}
                </div>

                {/* Rest of leaderboard */}
                <Card className="bg-white border-0 shadow-lg">
                  <CardContent className="pt-6">
                    <div className="space-y-4">
                      {featuredDonors.slice(3, 10).map((donor, index) => (
                        <div
                          key={donor.id}
                          className="flex items-center justify-between py-3 border-b last:border-0"
                        >
                          <div className="flex items-center gap-4">
                            <span className="text-lg font-medium text-gray-400 w-8">
                              #{index + 4}
                            </span>
                            <Avatar className="h-10 w-10">
                              <AvatarImage src={donor.user?.profilePhotoUrl || ''} />
                              <AvatarFallback className="bg-gradient-to-br from-[#002045] to-[#004488] text-white">
                                {getInitials(donor.user?.fullName || 'A')}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-medium text-gray-900">
                                {donor.user?.fullName || 'Anonymous'}
                              </p>
                              {donor.user?.batchYear && (
                                <p className="text-sm text-gray-500">
                                  Class of {donor.user.batchYear}
                                </p>
                              )}
                            </div>
                          </div>
                          <span className="text-lg font-semibold text-amber-600">
                            {formatCurrency(donor.amount)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* How Donations Are Used */}
              <div>
                <h2 className="font-headline text-2xl font-bold text-gray-900 mb-6">
                  How We Use Your Donations
                </h2>
                <Card className="bg-white border-0 shadow-lg">
                  <CardContent className="pt-6 space-y-6">
                    {[
                      { label: 'Scholarships', percent: 40, color: 'bg-blue-500' },
                      { label: 'Events & Reunions', percent: 25, color: 'bg-amber-500' },
                      { label: 'Infrastructure', percent: 20, color: 'bg-green-500' },
                      { label: 'Student Programs', percent: 15, color: 'bg-purple-500' },
                    ].map((item) => (
                      <div key={item.label}>
                        <div className="flex justify-between mb-2">
                          <span className="text-sm font-medium text-gray-700">
                            {item.label}
                          </span>
                          <span className="text-sm text-gray-500">{item.percent}%</span>
                        </div>
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${item.color} rounded-full`}
                            style={{ width: `${item.percent}%` }}
                          />
                        </div>
                      </div>
                    ))}
                    
                    <div className="pt-4 border-t">
                      <h4 className="font-medium text-gray-900 mb-3">Recent Impact</h4>
                      <ul className="space-y-2 text-sm text-gray-600">
                        <li className="flex items-start gap-2">
                          <Star className="h-4 w-4 text-amber-500 mt-0.5" />
                          <span>25 scholarships awarded this year</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <Star className="h-4 w-4 text-amber-500 mt-0.5" />
                          <span>New computer lab funded</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <Star className="h-4 w-4 text-amber-500 mt-0.5" />
                          <span>Annual reunion organized</span>
                        </li>
                      </ul>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* By Chapter */}
          <TabsContent value="chapters" className="space-y-6">
            <h2 className="font-headline text-2xl font-bold text-gray-900">
              Chapter Contributions
            </h2>
            
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {chapterDonations.map((chapter, index) => (
                <motion.div
                  key={chapter.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                >
                  <Card className="bg-white border-0 shadow-lg hover:shadow-xl transition-shadow">
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="bg-gradient-to-br from-[#002045] to-[#004488] p-3 rounded-xl text-white">
                            <MapPin className="h-5 w-5" />
                          </div>
                          <div>
                            <h3 className="font-semibold text-gray-900">{chapter.name}</h3>
                            <p className="text-sm text-gray-500">
                              {chapter._count.donations} donations
                            </p>
                          </div>
                        </div>
                        {index < 3 && getRankIcon(index)}
                      </div>
                      <div className="flex items-end justify-between">
                        <p className="text-2xl font-bold text-amber-600">
                          {formatCurrency(chapter.totalDonations)}
                        </p>
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/chapters/${encodeURIComponent(chapter.id)}`} aria-label={`View ${chapter.name} chapter`}>
                            View chapter
                          </Link>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>

            {chapterDonations.length === 0 && (
              <div className="text-center py-16 bg-white rounded-xl shadow-sm">
                <MapPin className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No chapters yet</h3>
                <p className="text-gray-500">Chapter data will appear here once available.</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </section>

      {/* CTA Section */}
      <section className="bg-gradient-to-br from-[#002045] to-[#004488] py-16">
        <div className="container mx-auto px-6 text-center">
          <h2 className="font-headline text-3xl font-bold text-white mb-4">
            Ready to Make a Difference?
          </h2>
          <p className="text-blue-100 mb-8 max-w-2xl mx-auto">
            Every contribution counts. Join our community of generous alumni 
            who are investing in the future of our institution.
          </p>
          <div className="flex gap-4 justify-center flex-wrap">
            <Button
              size="lg"
              className="bg-amber-500 hover:bg-amber-600 text-white"
              onClick={() => handleDonate(5000)}
                disabled={donating}
            >
              <Heart className="h-5 w-5 mr-2" />
              Donate Now
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-white/30 text-white hover:bg-white/10"
              onClick={() =>
                shareLinkWithToast({ title: 'Support AIEM — donate', url: `${window.location.origin}/donations` }, toast)
              }
            >
              <Share2 className="h-5 w-5 mr-2" />
              Share Campaign
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
