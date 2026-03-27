import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CalendarDays, MapPin, Users, ArrowRight } from 'lucide-react';

// Mock data - in real app, this would come from API
const events = [
  {
    id: '1',
    title: 'Annual Alumni Reunion 2024',
    date: 'Jan 15, 2024',
    location: 'College Campus',
    attendees: 250,
    type: 'REUNION',
    image: '/images/events/reunion.jpg',
  },
  {
    id: '2',
    title: 'Tech Career Workshop',
    date: 'Jan 20, 2024',
    location: 'Online (Zoom)',
    attendees: 120,
    type: 'WORKSHOP',
    image: '/images/events/workshop.jpg',
  },
  {
    id: '3',
    title: 'Mumbai Chapter Meetup',
    date: 'Jan 28, 2024',
    location: 'Mumbai, India',
    attendees: 45,
    type: 'MEETUP',
    image: '/images/events/meetup.jpg',
  },
];

const eventTypeColors: Record<string, string> = {
  REUNION: 'bg-purple-100 text-purple-700',
  WORKSHOP: 'bg-blue-100 text-blue-700',
  MEETUP: 'bg-green-100 text-green-700',
  WEBINAR: 'bg-amber-100 text-amber-700',
  CONFERENCE: 'bg-rose-100 text-rose-700',
};

export function UpcomingEvents() {
  return (
    <section className="py-20 bg-secondary/50">
      <div className="container">
        <div className="flex justify-between items-center mb-12">
          <div>
            <h2 className="text-3xl font-bold mb-2">Upcoming Events</h2>
            <p className="text-muted-foreground">
              Don't miss out on these exciting opportunities to connect
            </p>
          </div>
          <Link href="/events">
            <Button variant="outline">
              View All Events
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {events.map((event) => (
            <Card key={event.id} className="overflow-hidden hover:shadow-lg transition-shadow">
              <div className="aspect-video bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                <CalendarDays className="h-12 w-12 text-primary/50" />
              </div>
              <CardContent className="p-6">
                <div className="flex gap-2 mb-3">
                  <Badge className={eventTypeColors[event.type] || 'bg-gray-100 text-gray-700'}>
                    {event.type}
                  </Badge>
                </div>
                <h3 className="font-semibold text-lg mb-3 line-clamp-2">
                  {event.title}
                </h3>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <CalendarDays className="h-4 w-4" />
                    <span>{event.date}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    <span>{event.location}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    <span>{event.attendees} attending</span>
                  </div>
                </div>
                <Button className="w-full mt-4" variant="outline">
                  Learn More
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
