'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { searchApi, getApiErrorMessage } from '@/lib/api';
import { getEventLocation } from '@/lib/events';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Search, 
  User, 
  Briefcase, 
  Calendar, 
  MessageSquare, 
  Loader2,
  ChevronRight,
  MapPin
} from 'lucide-react';
import Link from 'next/link';
import { getInitials } from '@/lib/utils';

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;

function SearchResults() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const query = searchParams?.get('q') || '';
  
  const [searchInput, setSearchInput] = useState(query);
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('all');

  useEffect(() => {
    if (query) {
      handleSearch(query);
    }
  }, [query]);

  const handleSearch = async (searchTerm: string) => {
    const term = searchTerm.trim().slice(0, MAX_QUERY_LENGTH);
    if (term.length < MIN_QUERY_LENGTH) return;
    
    setLoading(true);
    setError(null);
    try {
      const response = await searchApi.globalSearch(term);
      const data = response.data.data;
      setResults({
        users: data?.users ?? [],
        jobs: data?.jobs ?? [],
        events: data?.events ?? [],
        posts: data?.posts ?? [],
      });
    } catch (err) {
      setResults(null);
      setError(getApiErrorMessage(err, 'Search failed. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const term = searchInput.trim();
    if (term.length >= MIN_QUERY_LENGTH) {
      router.push(`/search?q=${encodeURIComponent(term.slice(0, MAX_QUERY_LENGTH))}`);
    }
  };

  const totalResults = results ? (
    results.users.length + 
    results.jobs.length + 
    results.events.length + 
    results.posts.length
  ) : 0;

  return (
    <div className="container py-8 max-w-5xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-4">Search Results</h1>
        <form onSubmit={onSearchSubmit} className="flex gap-2 max-w-2xl">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input 
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search alumni, jobs, events..."
              className="pl-10 h-12 text-lg rounded-full"
              maxLength={MAX_QUERY_LENGTH}
              aria-label="Search"
            />
          </div>
          <Button type="submit" size="lg" className="rounded-full px-8">
            Search
          </Button>
        </form>
        {searchInput.trim().length > 0 && searchInput.trim().length < MIN_QUERY_LENGTH && (
          <p className="text-xs text-muted-foreground mt-2">Type at least {MIN_QUERY_LENGTH} characters to search.</p>
        )}
      </div>

      {error ? (
        <div role="alert" className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-destructive font-medium mb-3">{error}</p>
          <Button variant="outline" onClick={() => handleSearch(query)}>
            Try again
          </Button>
        </div>
      ) : loading ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
          <p className="text-muted-foreground">Searching the network...</p>
        </div>
      ) : results ? (
        <div className="space-y-8">
          <div className="flex items-center justify-between">
            <p className="text-muted-foreground">
              Showing {totalResults} results for "{query}"
            </p>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-5 h-12">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="users">People ({results.users.length})</TabsTrigger>
              <TabsTrigger value="jobs">Jobs ({results.jobs.length})</TabsTrigger>
              <TabsTrigger value="events">Events ({results.events.length})</TabsTrigger>
              <TabsTrigger value="posts">Posts ({results.posts.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="all" className="mt-6 space-y-8">
              {/* People Section */}
              {results.users.length > 0 && (
                <section>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                      <User className="h-5 w-5" /> People
                    </h2>
                    <Button variant="ghost" size="sm" onClick={() => setActiveTab('users')}>
                      View all <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {results.users.map((user: any) => (
                      <Card key={user.id} className="hover:border-primary/50 transition-colors cursor-pointer" onClick={() => router.push(`/profile/${encodeURIComponent(user.id)}`)}>
                        <CardContent className="p-4 flex items-center gap-4">
                          <Avatar className="h-12 w-12">
                            <AvatarImage src={user.profilePhotoUrl ?? undefined} />
                            <AvatarFallback>{getInitials(user.fullName)}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-bold truncate">{user.fullName}</h3>
                            <p className="text-sm text-muted-foreground truncate">
                              {user.currentDesignation || 'Alumnus'} • Class of {user.batchYear}
                            </p>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </section>
              )}

              {/* Jobs Section */}
              {results.jobs.length > 0 && (
                <section>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                      <Briefcase className="h-5 w-5" /> Jobs
                    </h2>
                    <Button variant="ghost" size="sm" onClick={() => setActiveTab('jobs')}>
                      View all <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                  <div className="grid gap-4">
                    {results.jobs.map((job: any) => (
                      <Card key={job.id} className="hover:border-primary/50 transition-colors cursor-pointer" onClick={() => router.push(`/jobs/${encodeURIComponent(job.id)}`)}>
                        <CardContent className="p-4 flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div className="h-12 w-12 bg-secondary rounded-md flex items-center justify-center">
                              <Briefcase className="h-6 w-6 text-primary" />
                            </div>
                            <div>
                              <h3 className="font-bold">{job.title}</h3>
                              <p className="text-sm text-muted-foreground">{[job.company, job.location || (job.workplaceType === 'REMOTE' ? 'Remote' : null)].filter(Boolean).join(' • ')}</p>
                            </div>
                          </div>
                          <Badge>{String(job.jobType ?? job.type ?? '').replace(/_/g, ' ')}</Badge>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </section>
              )}

              {/* Events Section */}
              {results.events.length > 0 && (
                <section>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                      <Calendar className="h-5 w-5" /> Events
                    </h2>
                    <Button variant="ghost" size="sm" onClick={() => setActiveTab('events')}>
                      View all <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {results.events.map((event: any) => (
                      <Card key={event.id} className="hover:border-primary/50 transition-colors cursor-pointer" onClick={() => router.push(`/events/${encodeURIComponent(event.id)}`)}>
                        <CardContent className="p-4 flex gap-4">
                          <div className="h-16 w-16 bg-primary/10 rounded-md flex flex-col items-center justify-center text-primary shrink-0">
                            <span className="text-xs font-bold uppercase">{new Date(event.startDate).toLocaleDateString('en-US', { month: 'short' })}</span>
                            <span className="text-xl font-bold">{new Date(event.startDate).getDate()}</span>
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-bold truncate">{event.title}</h3>
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                              <MapPin className="h-3 w-3" /> {event.eventType === 'ONLINE' ? 'Online' : getEventLocation(event) || 'Location TBD'}
                            </p>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </section>
              )}
            </TabsContent>

            <TabsContent value="users" className="mt-6">
              <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
                {results.users.map((user: any) => (
                  <Card key={user.id} className="text-center p-6 hover:shadow-md transition-shadow cursor-pointer" onClick={() => router.push(`/profile/${encodeURIComponent(user.id)}`)}>
                    <Avatar className="h-20 w-20 mx-auto mb-4">
                      <AvatarImage src={user.profilePhotoUrl ?? undefined} />
                      <AvatarFallback className="text-xl">{getInitials(user.fullName)}</AvatarFallback>
                    </Avatar>
                    <h3 className="font-bold text-lg">{user.fullName}</h3>
                    <p className="text-primary text-sm font-medium">{user.currentDesignation || 'Alumnus'}</p>
                    <p className="text-xs text-muted-foreground mt-1">{user.department} • Class of {user.batchYear}</p>
                    <Button variant="outline" size="sm" className="mt-4 w-full">View Profile</Button>
                  </Card>
                ))}
                {results.users.length === 0 && (
                  <div className="col-span-full py-12 text-center text-muted-foreground">
                    No people found matching your search.
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="jobs" className="mt-6">
              <div className="grid gap-4">
                {results.jobs.map((job: any) => (
                  <Card key={job.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => router.push(`/jobs/${encodeURIComponent(job.id)}`)}>
                    <CardContent className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-start gap-4">
                        <div className="h-12 w-12 bg-secondary rounded-lg flex items-center justify-center shrink-0">
                          <Briefcase className="h-6 w-6 text-primary" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-bold text-lg">{job.title}</h3>
                            <Badge>{String(job.jobType ?? job.type ?? '').replace(/_/g, ' ')}</Badge>
                          </div>
                          <p className="text-muted-foreground font-medium">{job.company}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {[job.location || (job.workplaceType === 'REMOTE' ? 'Remote' : null), job.experienceLevel].filter(Boolean).join(' • ')}
                          </p>
                        </div>
                      </div>
                      <Button variant="outline" size="sm">View Job</Button>
                    </CardContent>
                  </Card>
                ))}
                {results.jobs.length === 0 && (
                  <div className="py-12 text-center text-muted-foreground">
                    No jobs found matching your search.
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="events" className="mt-6">
              <div className="grid gap-4 sm:grid-cols-2">
                {results.events.map((event: any) => (
                  <Card key={event.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => router.push(`/events/${encodeURIComponent(event.id)}`)}>
                    <CardContent className="p-5 flex gap-4">
                      <div className="h-16 w-16 bg-primary/10 rounded-md flex flex-col items-center justify-center text-primary shrink-0">
                        <span className="text-xs font-bold uppercase">{new Date(event.startDate).toLocaleDateString('en-US', { month: 'short' })}</span>
                        <span className="text-xl font-bold">{new Date(event.startDate).getDate()}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-bold truncate">{event.title}</h3>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                          <MapPin className="h-3 w-3" /> {event.eventType === 'ONLINE' ? 'Online' : getEventLocation(event) || 'Location TBD'}
                        </p>
                        <Button variant="outline" size="sm" className="mt-3">View Event</Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
                {results.events.length === 0 && (
                  <div className="col-span-full py-12 text-center text-muted-foreground">
                    No events found matching your search.
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="posts" className="mt-6">
              <div className="grid gap-4 max-w-2xl mx-auto">
                {results.posts.map((post: any) => (
                  <Card key={post.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => router.push(`/posts/${encodeURIComponent(post.id)}`)}>
                    <CardContent className="p-5">
                      <div className="flex items-center gap-3 mb-3">
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={post.user?.profilePhotoUrl ?? undefined} />
                          <AvatarFallback>{getInitials(post.user?.fullName || 'User')}</AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-semibold text-sm">{post.user?.fullName || 'Alumnus'}</p>
                          <p className="text-xs text-muted-foreground">{new Date(post.createdAt).toLocaleDateString()}</p>
                        </div>
                      </div>
                      <p className="text-sm text-foreground line-clamp-3">{post.content}</p>
                      <div className="mt-4 flex justify-end">
                        <Button variant="ghost" size="sm">View Post</Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
                {results.posts.length === 0 && (
                  <div className="py-12 text-center text-muted-foreground">
                    No posts found matching your search.
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      ) : (
        <div className="text-center py-20 border-2 border-dashed rounded-xl">
          <Search className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Start searching</h2>
          <p className="text-muted-foreground">Enter a keyword to search for alumni, jobs, events or posts.</p>
        </div>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="container py-8 flex justify-center"><Loader2 className="animate-spin" /></div>}>
      <SearchResults />
    </Suspense>
  );
}
