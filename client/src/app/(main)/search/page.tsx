'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { searchApi } from '@/lib/api';
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

function SearchResults() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const query = searchParams.get('q') || '';
  
  const [searchInput, setSearchInput] = useState(query);
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('all');

  useEffect(() => {
    if (query) {
      handleSearch(query);
    }
  }, [query]);

  const handleSearch = async (searchTerm: string) => {
    if (!searchTerm || searchTerm.length < 2) return;
    
    setLoading(true);
    try {
      const response = await searchApi.globalSearch(searchTerm);
      setResults(response.data.data);
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchInput.trim()) {
      router.push(`/dashboard/search?q=${encodeURIComponent(searchInput)}`);
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
            />
          </div>
          <Button type="submit" size="lg" className="rounded-full px-8">
            Search
          </Button>
        </form>
      </div>

      {loading ? (
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

          <Tabs defaultValue="all" className="w-full">
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
                      <Card key={user.id} className="hover:border-primary/50 transition-colors cursor-pointer" onClick={() => router.push(`/dashboard/profile/${user.id}`)}>
                        <CardContent className="p-4 flex items-center gap-4">
                          <Avatar className="h-12 w-12">
                            <AvatarImage src={user.profilePhotoUrl} />
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
                      <Card key={job.id} className="hover:border-primary/50 transition-colors cursor-pointer" onClick={() => router.push(`/dashboard/jobs/${job.id}`)}>
                        <CardContent className="p-4 flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div className="h-12 w-12 bg-secondary rounded-md flex items-center justify-center">
                              <Briefcase className="h-6 w-6 text-primary" />
                            </div>
                            <div>
                              <h3 className="font-bold">{job.title}</h3>
                              <p className="text-sm text-muted-foreground">{job.company} • {job.location}</p>
                            </div>
                          </div>
                          <Badge>{job.type}</Badge>
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
                      <Card key={event.id} className="hover:border-primary/50 transition-colors cursor-pointer" onClick={() => router.push(`/dashboard/events/${event.id}`)}>
                        <CardContent className="p-4 flex gap-4">
                          <div className="h-16 w-16 bg-primary/10 rounded-md flex flex-col items-center justify-center text-primary shrink-0">
                            <span className="text-xs font-bold uppercase">{new Date(event.startDate).toLocaleDateString('en-US', { month: 'short' })}</span>
                            <span className="text-xl font-bold">{new Date(event.startDate).getDate()}</span>
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-bold truncate">{event.title}</h3>
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                              <MapPin className="h-3 w-3" /> {event.location || 'Online'}
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
                  <Card key={user.id} className="text-center p-6 hover:shadow-md transition-shadow cursor-pointer" onClick={() => router.push(`/dashboard/profile/${user.id}`)}>
                    <Avatar className="h-20 w-20 mx-auto mb-4">
                      <AvatarImage src={user.profilePhotoUrl} />
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
            
            {/* ... other TabsContent for jobs, events, posts ... */}
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
