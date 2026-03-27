'use client';

import { useAuth } from '@/context/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Users,
  Briefcase,
  CalendarDays,
  Image,
  ThumbsUp,
  MessageCircle,
  Share2,
  Send,
  TrendingUp,
  Sparkles,
} from 'lucide-react';
import { getInitials } from '@/lib/utils';
import Link from 'next/link';

export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <div className="grid lg:grid-cols-4 gap-6">
      {/* Left Sidebar - Profile Card */}
      <div className="lg:col-span-1 space-y-6">
        <Card>
          <div className="h-16 bg-gradient-to-r from-primary to-primary/80 rounded-t-lg"></div>
          <CardContent className="pt-0 -mt-8">
            <div className="flex flex-col items-center">
              <Avatar className="h-16 w-16 border-4 border-white">
                <AvatarImage src={user?.avatarUrl} alt={user?.fullName} />
                <AvatarFallback className="text-lg">
                  {user?.fullName ? getInitials(user.fullName) : 'U'}
                </AvatarFallback>
              </Avatar>
              <h3 className="mt-2 font-semibold">{user?.fullName}</h3>
              <p className="text-sm text-muted-foreground">
                {user?.department} • Batch {user?.batchYear}
              </p>
              {user?.membershipTier && (
                <Badge className="mt-2" variant="secondary">
                  {user.membershipTier}
                </Badge>
              )}
            </div>

            <div className="mt-4 pt-4 border-t space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Profile Completeness</span>
                <span className="font-medium">{user?.profileCompleteness || 0}%</span>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${user?.profileCompleteness || 0}%` }}
                ></div>
              </div>
              <Link href={`/dashboard/profile/${user?.id}`}>
                <Button variant="outline" size="sm" className="w-full mt-2">
                  Complete Profile
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Quick Links */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Quick Links</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <Link href="/dashboard/network" className="flex items-center gap-3 p-2 rounded-lg hover:bg-secondary transition-colors">
              <Users className="h-4 w-4 text-primary" />
              <span className="text-sm">My Connections</span>
            </Link>
            <Link href="/dashboard/jobs" className="flex items-center gap-3 p-2 rounded-lg hover:bg-secondary transition-colors">
              <Briefcase className="h-4 w-4 text-primary" />
              <span className="text-sm">Job Board</span>
            </Link>
            <Link href="/dashboard/events" className="flex items-center gap-3 p-2 rounded-lg hover:bg-secondary transition-colors">
              <CalendarDays className="h-4 w-4 text-primary" />
              <span className="text-sm">Upcoming Events</span>
            </Link>
            <Link href="/dashboard/gallery" className="flex items-center gap-3 p-2 rounded-lg hover:bg-secondary transition-colors">
              <Image className="h-4 w-4 text-primary" />
              <span className="text-sm">Photo Gallery</span>
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Main Feed */}
      <div className="lg:col-span-2 space-y-6">
        {/* Create Post */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex gap-4">
              <Avatar>
                <AvatarImage src={user?.avatarUrl} alt={user?.fullName} />
                <AvatarFallback>{user?.fullName ? getInitials(user.fullName) : 'U'}</AvatarFallback>
              </Avatar>
              <div className="flex-1 space-y-3">
                <Textarea
                  placeholder="Share an update, achievement, or announcement..."
                  className="resize-none"
                />
                <div className="flex justify-between items-center">
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm">
                      <Image className="h-4 w-4 mr-2" />
                      Photo
                    </Button>
                    <Button variant="ghost" size="sm">
                      <CalendarDays className="h-4 w-4 mr-2" />
                      Event
                    </Button>
                  </div>
                  <Button size="sm">
                    <Send className="h-4 w-4 mr-2" />
                    Post
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Sample Posts */}
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent className="pt-6">
              <div className="flex gap-4">
                <Avatar>
                  <AvatarFallback>AB</AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-semibold">Alumni Member</h4>
                      <p className="text-sm text-muted-foreground">
                        Software Engineer at Tech Corp • 2h ago
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-sm">
                    Excited to share that I've just been promoted to Senior Engineer! 
                    Grateful for the amazing support from our alumni network. 
                    The connections I made through this platform have been invaluable. 🚀
                  </p>
                  <div className="mt-4 pt-4 border-t flex gap-4">
                    <Button variant="ghost" size="sm" className="text-muted-foreground">
                      <ThumbsUp className="h-4 w-4 mr-2" />
                      Like
                    </Button>
                    <Button variant="ghost" size="sm" className="text-muted-foreground">
                      <MessageCircle className="h-4 w-4 mr-2" />
                      Comment
                    </Button>
                    <Button variant="ghost" size="sm" className="text-muted-foreground">
                      <Share2 className="h-4 w-4 mr-2" />
                      Share
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Right Sidebar */}
      <div className="lg:col-span-1 space-y-6">
        {/* Suggestions */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              People You May Know
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Avatar>
                  <AvatarFallback>JD</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">John Doe</p>
                  <p className="text-xs text-muted-foreground truncate">
                    Software Engineer • Batch 2018
                  </p>
                </div>
                <Button variant="outline" size="sm">Connect</Button>
              </div>
            ))}
            <Button variant="ghost" size="sm" className="w-full">
              View All Suggestions
            </Button>
          </CardContent>
        </Card>

        {/* Trending Topics */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              Trending in Network
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {['#TechJobs', '#AlumniMeetup2024', '#CareerGrowth', '#Mentorship'].map((tag) => (
              <Link
                key={tag}
                href="#"
                className="block text-sm text-primary hover:underline"
              >
                {tag}
              </Link>
            ))}
          </CardContent>
        </Card>

        {/* Upcoming Events Preview */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Upcoming Events</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3">
              <div className="text-center bg-primary/10 rounded-lg p-2 min-w-[50px]">
                <p className="text-xs text-primary font-medium">JAN</p>
                <p className="text-lg font-bold text-primary">15</p>
              </div>
              <div>
                <p className="text-sm font-medium">Annual Reunion 2024</p>
                <p className="text-xs text-muted-foreground">College Campus</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="text-center bg-primary/10 rounded-lg p-2 min-w-[50px]">
                <p className="text-xs text-primary font-medium">JAN</p>
                <p className="text-lg font-bold text-primary">20</p>
              </div>
              <div>
                <p className="text-sm font-medium">Tech Career Workshop</p>
                <p className="text-xs text-muted-foreground">Online</p>
              </div>
            </div>
            <Link href="/dashboard/events">
              <Button variant="ghost" size="sm" className="w-full">
                View All Events
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
