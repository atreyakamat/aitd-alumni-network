'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Search,
  Filter,
  MapPin,
  Calendar,
  Clock,
  Users,
  Plus,
  Video,
  ExternalLink,
} from 'lucide-react';
import { formatDate, formatDateTime } from '@/lib/utils';

const eventTypes = ['All Events', 'Reunion', 'Workshop', 'Webinar', 'Meetup', 'Conference'];

// Mock data
const events = [
  {
    id: '1',
    title: 'Annual Alumni Reunion 2024',
    description: 'Join us for the grand reunion of all batches. Connect with old friends, make new connections, and relive your college memories.',
    coverImageUrl: null,
    location: 'College Campus, Main Auditorium',
    isVirtual: false,
    startDate: '2024-01-15T09:00:00Z',
    endDate: '2024-01-15T18:00:00Z',
    maxAttendees: 500,
    attendeesCount: 250,
    type: 'REUNION',
    isUserRSVPed: false,
  },
  {
    id: '2',
    title: 'Tech Career Workshop',
    description: 'Learn about career opportunities in tech from industry experts. Q&A session included.',
    coverImageUrl: null,
    location: 'Online (Zoom)',
    isVirtual: true,
    meetingUrl: 'https://zoom.us/j/123456789',
    startDate: '2024-01-20T14:00:00Z',
    endDate: '2024-01-20T16:00:00Z',
    maxAttendees: 200,
    attendeesCount: 120,
    type: 'WORKSHOP',
    isUserRSVPed: true,
  },
  {
    id: '3',
    title: 'Mumbai Chapter Meetup',
    description: 'Monthly networking meetup for Mumbai-based alumni. Great opportunity to expand your network.',
    coverImageUrl: null,
    location: 'Starbucks, Bandra West, Mumbai',
    isVirtual: false,
    startDate: '2024-01-28T17:00:00Z',
    endDate: '2024-01-28T20:00:00Z',
    maxAttendees: 50,
    attendeesCount: 35,
    type: 'MEETUP',
    isUserRSVPed: false,
  },
  {
    id: '4',
    title: 'AI & Future of Work Webinar',
    description: 'Industry leaders discuss how AI is transforming workplaces and what skills you need to stay relevant.',
    coverImageUrl: null,
    location: 'Online (YouTube Live)',
    isVirtual: true,
    startDate: '2024-02-05T18:00:00Z',
    endDate: '2024-02-05T19:30:00Z',
    maxAttendees: null,
    attendeesCount: 450,
    type: 'WEBINAR',
    isUserRSVPed: false,
  },
];

const eventTypeColors: Record<string, string> = {
  REUNION: 'bg-purple-100 text-purple-700',
  WORKSHOP: 'bg-blue-100 text-blue-700',
  WEBINAR: 'bg-green-100 text-green-700',
  MEETUP: 'bg-amber-100 text-amber-700',
  CONFERENCE: 'bg-rose-100 text-rose-700',
};

export default function EventsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState('All Events');

  const now = new Date();
  const upcomingEvents = events.filter((e) => new Date(e.startDate) > now);
  const pastEvents = events.filter((e) => new Date(e.startDate) <= now);

  const filterEvents = (eventList: typeof events) => {
    return eventList.filter((event) => {
      const matchesSearch =
        event.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        event.description.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesType =
        selectedType === 'All Events' ||
        event.type.toLowerCase() === selectedType.toLowerCase();
      return matchesSearch && matchesType;
    });
  };

  const EventCard = ({ event }: { event: (typeof events)[0] }) => (
    <Card className="overflow-hidden hover:shadow-md transition-shadow">
      <div className="aspect-video bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center relative">
        <Calendar className="h-12 w-12 text-primary/50" />
        <div className="absolute top-3 left-3 flex gap-2">
          <Badge className={eventTypeColors[event.type]}>{event.type}</Badge>
          {event.isVirtual && (
            <Badge variant="secondary">
              <Video className="h-3 w-3 mr-1" />
              Virtual
            </Badge>
          )}
        </div>
        {event.isUserRSVPed && (
          <div className="absolute top-3 right-3">
            <Badge variant="default" className="bg-green-600">Registered</Badge>
          </div>
        )}
      </div>
      <CardContent className="p-6">
        <h3 className="font-semibold text-lg mb-2">{event.title}</h3>
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
              {new Date(event.startDate).toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit',
              })} - 
              {new Date(event.endDate).toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            <span className="truncate">{event.location}</span>
          </div>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            <span>
              {event.attendeesCount} attending
              {event.maxAttendees && ` / ${event.maxAttendees} max`}
            </span>
          </div>
        </div>

        <div className="flex gap-2 mt-4">
          <Button variant="outline" className="flex-1">
            View Details
          </Button>
          {event.isUserRSVPed ? (
            event.isVirtual ? (
              <Button className="flex-1">
                Join Event
                <ExternalLink className="ml-2 h-4 w-4" />
              </Button>
            ) : (
              <Button variant="secondary" className="flex-1">
                Cancel RSVP
              </Button>
            )
          ) : (
            <Button className="flex-1">RSVP Now</Button>
          )}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Events</h1>
          <p className="text-muted-foreground">
            Discover reunions, workshops, and networking events
          </p>
        </div>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Create Event
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search events..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={selectedType} onValueChange={setSelectedType}>
              <SelectTrigger className="w-full md:w-[180px]">
                <SelectValue placeholder="Event Type" />
              </SelectTrigger>
              <SelectContent>
                {eventTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline">
              <Filter className="h-4 w-4 mr-2" />
              More Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Event Tabs */}
      <Tabs defaultValue="upcoming">
        <TabsList>
          <TabsTrigger value="upcoming">
            Upcoming ({filterEvents(upcomingEvents).length})
          </TabsTrigger>
          <TabsTrigger value="past">
            Past Events ({filterEvents(pastEvents).length})
          </TabsTrigger>
          <TabsTrigger value="my-events">My Events</TabsTrigger>
        </TabsList>

        <TabsContent value="upcoming" className="mt-6">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filterEvents(upcomingEvents).map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
          {filterEvents(upcomingEvents).length === 0 && (
            <div className="text-center py-12">
              <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No upcoming events found</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="past" className="mt-6">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filterEvents(pastEvents).map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
          {filterEvents(pastEvents).length === 0 && (
            <div className="text-center py-12">
              <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No past events found</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="my-events" className="mt-6">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {events
              .filter((e) => e.isUserRSVPed)
              .map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
          </div>
          {events.filter((e) => e.isUserRSVPed).length === 0 && (
            <div className="text-center py-12">
              <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">You haven't RSVP'd to any events yet</p>
              <Button className="mt-4" variant="outline">
                Browse Events
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
