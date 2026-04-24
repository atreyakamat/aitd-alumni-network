'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { eventApi } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  Calendar, 
  MapPin, 
  Clock, 
  Search, 
  Plus, 
  Video, 
  Filter,
  Trophy,
  AlertCircle
} from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { useAuth } from '@/context/auth-context';
import Link from 'next/link';
import { LoadingSpinner } from '@/components/ui/loading';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const eventTypeColors: Record<string, string> = {
  ONLINE: 'bg-green-100 text-green-700',
  OFFLINE: 'bg-blue-100 text-blue-700',
  HYBRID: 'bg-purple-100 text-purple-700',
};

const eventTypes = [
  { label: 'All Events', value: 'ALL' },
  { label: 'Online', value: 'ONLINE' },
  { label: 'Offline', value: 'OFFLINE' },
  { label: 'Hybrid', value: 'HYBRID' },
];

export default function EventsPage() {
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState('ALL');
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['events', searchQuery, selectedType, page],
    queryFn: async () => {
      const params: any = {
        page,
        limit: 12,
        search: searchQuery || undefined,
        type: selectedType !== 'ALL' ? selectedType : undefined,
      };
      const response = await eventApi.getEvents(params);
      return response.data;
    },
  });

  const events = data?.items || [];
  const pagination = data || { total: 0, pages: 0, page: 1 };

  const canCreateEvent = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN' || user?.role === 'SUPERADMIN';

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    refetch();
  };

  const EventCard = ({ event }: { event: any }) => (
    <Card className="overflow-hidden hover:shadow-md transition-shadow">
      <div className="aspect-video bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center relative">
        {event.bannerUrl ? (
          <img src={event.bannerUrl} alt={event.title} className="w-full h-full object-cover" />
        ) : (
          <Calendar className="h-12 w-12 text-primary/50" />
        )}
        <div className="absolute top-3 left-3 flex gap-2">
          <Badge className={eventTypeColors[event.eventType] || 'bg-slate-100 text-slate-700'}>
            {event.eventType}
          </Badge>
          {event.eventType === 'ONLINE' && (
            <Badge variant="secondary">
              <Video className="h-3 w-3 mr-1" />
              Virtual
            </Badge>
          )}
        </div>
      </div>
      <CardContent className="p-6">
        <h3 className="font-semibold text-lg mb-2 truncate">{event.title}</h3>
        <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
          {event.description}
        </p>

        <div className="space-y-2 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            <span>{formatDate(event.startDate)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            <span>
              {new Date(event.startDate).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            <span className="truncate">{event.location || event.venue || 'Location TBD'}</span>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {event.rsvpCount || 0} registered
          </span>
          <Link href={`/events/${event.id}`}>
            <Button size="sm">View Details</Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Upcoming Events</h1>
          <p className="text-muted-foreground">
            Stay connected through webinars, meetups, and reunions
          </p>
        </div>
        {canCreateEvent && (
          <Link href="/admin/events/new">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Create Event
            </Button>
          </Link>
        )}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSearch} className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search events..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select 
              value={selectedType} 
              onValueChange={(val) => {
                setSelectedType(val);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full md:w-[180px]">
                <SelectValue placeholder="Event Type" />
              </SelectTrigger>
              <SelectContent>
                {eventTypes.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit">Search</Button>
          </form>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            {(error as any)?.response?.data?.error || 'Failed to load events. Please try again later.'}
          </AlertDescription>
        </Alert>
      ) : events.length === 0 ? (
        <div className="text-center py-12 border rounded-lg bg-muted/20">
          <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4 opacity-20" />
          <h3 className="text-lg font-medium">No events found</h3>
          <p className="text-muted-foreground">Try adjusting your search or filters</p>
        </div>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {events.map((event: any) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>

          {/* Pagination */}
          {pagination.pages > 1 && (
            <div className="flex justify-center gap-2 mt-8">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                Previous
              </Button>
              <div className="flex items-center px-4 text-sm font-medium">
                Page {page} of {pagination.pages}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(pagination.pages, p + 1))}
                disabled={page === pagination.pages}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
