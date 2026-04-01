'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/auth-context';
import { postApi, networkApi, eventApi } from '@/lib/api';
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
  Loader2,
} from 'lucide-react';
import { getInitials, formatDate } from '@/lib/utils';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function DashboardPage() {
  const { user: currentUser } = useAuth();
  const router = useRouter();
  const [posts, setPosts] = useState<any[]>([]);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newPostContent, setNewPostContent] = useState('');

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      const [postsRes, sugRes, eventsRes] = await Promise.all([
        postApi.getFeed(),
        networkApi.getSuggestions(3),
        eventApi.getUpcomingEvents(2)
      ]);
      setPosts(postsRes.data.data || []);
      setSuggestions(sugRes.data.data || []);
      setUpcomingEvents(eventsRes.data.data || []);
    } catch (error) {
      console.error('Dashboard fetch error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreatePost = async () => {
    if (!newPostContent.trim()) return;
    try {
      const response = await postApi.createPost({ content: newPostContent });
      setPosts(prev => [response.data.data, ...prev]);
      setNewPostContent('');
    } catch (error) {
      console.error('Failed to create post:', error);
    }
  };

  return (
    <div className="grid lg:grid-cols-4 gap-6">
      {/* Left Sidebar - Profile Card */}
      <div className="lg:col-span-1 space-y-6">
        <Card>
          <div className="h-16 bg-gradient-to-r from-primary to-primary/80 rounded-t-lg"></div>
          <CardContent className="pt-0 -mt-8">
            <div className="flex flex-col items-center">
              <Avatar className="h-16 w-16 border-4 border-white">
                <AvatarImage src={currentUser?.avatarUrl} alt={currentUser?.fullName} />
                <AvatarFallback className="text-lg">
                  {currentUser?.fullName ? getInitials(currentUser.fullName) : 'U'}
                </AvatarFallback>
              </Avatar>
              <h3 className="mt-2 font-semibold">{currentUser?.fullName}</h3>
              <p className="text-sm text-muted-foreground">
                {currentUser?.department} • Batch {currentUser?.batchYear}
              </p>
            </div>

            <div className="mt-4 pt-4 border-t space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Profile Completeness</span>
                <span className="font-medium">{currentUser?.profileCompleteness || 0}%</span>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${currentUser?.profileCompleteness || 0}%` }}
                ></div>
              </div>
              <Link href={`/profile/${currentUser?.id}`}>
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
            <Link href="/network" className="flex items-center gap-3 p-2 rounded-lg hover:bg-secondary transition-colors">
              <Users className="h-4 w-4 text-primary" />
              <span className="text-sm">My Connections</span>
            </Link>
            <Link href="/jobs" className="flex items-center gap-3 p-2 rounded-lg hover:bg-secondary transition-colors">
              <Briefcase className="h-4 w-4 text-primary" />
              <span className="text-sm">Job Board</span>
            </Link>
            <Link href="/events" className="flex items-center gap-3 p-2 rounded-lg hover:bg-secondary transition-colors">
              <CalendarDays className="h-4 w-4 text-primary" />
              <span className="text-sm">Upcoming Events</span>
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
                <AvatarImage src={currentUser?.avatarUrl} alt={currentUser?.fullName} />
                <AvatarFallback>{currentUser?.fullName ? getInitials(currentUser.fullName) : 'U'}</AvatarFallback>
              </Avatar>
              <div className="flex-1 space-y-3">
                <Textarea
                  placeholder="Share an update, achievement, or announcement..."
                  className="resize-none"
                  value={newPostContent}
                  onChange={(e) => setNewPostContent(e.target.value)}
                />
                <div className="flex justify-between items-center">
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm">
                      <Image className="h-4 w-4 mr-2" />
                      Photo
                    </Button>
                  </div>
                  <Button size="sm" onClick={handleCreatePost} disabled={!newPostContent.trim()}>
                    <Send className="h-4 w-4 mr-2" />
                    Post
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Posts Feed */}
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : posts.length > 0 ? (
          posts.map((post) => (
            <Card key={post.id}>
              <CardContent className="pt-6">
                <div className="flex gap-4">
                  <Avatar className="cursor-pointer" onClick={() => router.push(`/profile/${post.user.id}`)}>
                    <AvatarImage src={post.user.profilePhotoUrl} />
                    <AvatarFallback>{getInitials(post.user.fullName)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div>
                      <h4 className="font-semibold">{post.user.fullName}</h4>
                      <p className="text-xs text-muted-foreground">
                        {post.user.currentDesignation || 'Alumnus'} • {formatDate(post.createdAt)}
                      </p>
                    </div>
                    <p className="mt-3 text-sm whitespace-pre-wrap">{post.content}</p>
                    
                    {post.media && post.media.length > 0 && (
                      <div className="mt-3 grid gap-2">
                        {post.media.map((m: any) => (
                          <img key={m.id} src={m.url} alt="Post media" className="rounded-lg max-h-96 object-cover w-full" />
                        ))}
                      </div>
                    )}

                    <div className="mt-4 pt-4 border-t flex gap-4">
                      <Button variant="ghost" size="sm" className="text-muted-foreground">
                        <ThumbsUp className="h-4 w-4 mr-2" />
                        {post._count?.likes || 0} Like
                      </Button>
                      <Button variant="ghost" size="sm" className="text-muted-foreground">
                        <MessageCircle className="h-4 w-4 mr-2" />
                        {post._count?.comments || 0} Comment
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <Card className="p-12 text-center text-muted-foreground">
            No posts to show. Start by sharing something with your network!
          </Card>
        )}
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
            {suggestions.map((user) => (
              <div key={user.id} className="flex items-center gap-3">
                <Avatar className="cursor-pointer" onClick={() => router.push(`/profile/${user.id}`)}>
                  <AvatarImage src={user.profilePhotoUrl} />
                  <AvatarFallback>{getInitials(user.fullName)}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{user.fullName}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {user.currentDesignation || 'Alumnus'} • Batch {user.batchYear}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => router.push(`/profile/${user.id}`)}>View</Button>
              </div>
            ))}
            <Link href="/network" className="w-full">
              <Button variant="ghost" size="sm" className="w-full mt-2">
                View All Suggestions
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* Upcoming Events */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Upcoming Events</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {upcomingEvents.map((event) => (
              <div key={event.id} className="flex gap-3 cursor-pointer" onClick={() => router.push(`/events`)}>
                <div className="text-center bg-primary/10 rounded-lg p-2 min-w-[50px]">
                  <p className="text-xs text-primary font-medium">{new Date(event.startDate).toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</p>
                  <p className="text-lg font-bold text-primary">{new Date(event.startDate).getDate()}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{event.title}</p>
                  <p className="text-xs text-muted-foreground truncate">{event.location || 'Online'}</p>
                </div>
              </div>
            ))}
            <Link href="/events">
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
