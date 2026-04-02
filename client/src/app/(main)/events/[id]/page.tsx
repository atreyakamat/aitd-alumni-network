'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { eventApi } from '@/lib/api';
import { useAuth } from '@/context/auth-context';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  MapPin,
  Calendar,
  Clock,
  Users,
  ChevronLeft,
  Share2,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Globe,
  Map as MapIcon
} from 'lucide-react';
import { getInitials, formatDate } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

export default function EventDetailsPage() {
  const params = useParams();
  const id = params?.id as string;
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  const [event, setEvent] = useState<any>(null);
  const [attendees, setAttendees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [rsvping, setRsvping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      fetchEventDetails();
    }
  }, [id]);

  const fetchEventDetails = async () => {
    setLoading(true);
    try {
      const [eventRes, attendeesRes] = await Promise.all([
        eventApi.getEvent(id as string),
        eventApi.getAttendees(id as string)
      ]);
      setEvent(eventRes.data.data);
      setAttendees(attendeesRes.data.data || []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load event details');
    } finally {
      setLoading(false);
    }
  };

  const handleRSVP = async () => {
    setRsvping(true);
    try {
      await eventApi.rsvpEvent(id as string);
      toast({
        title: 'Success!',
        description: 'Your RSVP has been recorded.',
      });
      fetchEventDetails(); // Refresh to update attendee list and status
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err.response?.data?.error || 'Failed to RSVP',
      });
    } finally {
      setRsvping(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">Loading event details...</p>
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="max-w-2xl mx-auto py-20 text-center">
        <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
        <h2 className="text-2xl font-bold mb-2">Error</h2>
        <p className="text-muted-foreground mb-6">{error || 'Event not found'}</p>
        <Button onClick={() => router.push('/events')}>Back to Events</Button>
      </div>
    );
  }

  const isAttending = attendees.some(a => a.userId === user?.id);
  const isPast = new Date(event.startDate) < new Date();

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <Button variant="ghost" className="mb-2" onClick={() => router.back()}>
        <ChevronLeft className="h-4 w-4 mr-2" />
        Back to Events
      </Button>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="overflow-hidden">
            <div className="h-64 bg-muted relative">
              {event.coverImageUrl ? (
                <Image 
                  src={event.coverImageUrl} 
                  alt={event.title} 
                  fill 
                  className="object-cover" 
                  unoptimized
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-primary/40">
                  <Calendar className="h-20 w-20 text-primary/40" />
                </div>
              )}
              {isAttending && (
                <Badge className="absolute top-4 right-4 bg-green-500 hover:bg-green-600">
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  You're Attending
                </Badge>
              )}
            </div>
            <CardContent className="pt-6">
              <div className="flex justify-between items-start mb-4">
                <h1 className="text-3xl font-bold">{event.title}</h1>
                <Button variant="outline" size="icon">
                  <Share2 className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex flex-wrap gap-6 mb-8 text-muted-foreground">
                <div className="flex items-center gap-2">
                  <div className="h-10 w-10 bg-secondary rounded-lg flex items-center justify-center">
                    <Calendar className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs font-medium">Date</p>
                    <p className="text-sm font-semibold text-foreground">{new Date(event.startDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-10 w-10 bg-secondary rounded-lg flex items-center justify-center">
                    <Clock className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs font-medium">Time</p>
                    <p className="text-sm font-semibold text-foreground">
                      {new Date(event.startDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-10 w-10 bg-secondary rounded-lg flex items-center justify-center">
                    <MapPin className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs font-medium">Location</p>
                    <p className="text-sm font-semibold text-foreground">{event.isVirtual ? 'Virtual Event' : (event.venue || event.location)}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <section>
                  <h2 className="text-xl font-bold mb-3">About This Event</h2>
                  <div className="prose prose-sm max-w-none text-muted-foreground whitespace-pre-wrap">
                    {event.description}
                  </div>
                </section>

                {event.isVirtual && event.virtualLink && (
                  <section className="p-4 bg-primary/5 rounded-lg border border-primary/10">
                    <h3 className="font-bold flex items-center gap-2 mb-2 text-primary">
                      <Globe className="h-4 w-4" />
                      Virtual Meeting Link
                    </h3>
                    <p className="text-sm mb-3">This is a virtual event. You can join using the link below.</p>
                    <Button variant="outline" className="w-full sm:w-auto" onClick={() => window.open(event.virtualLink, '_blank')}>
                      Join Meeting
                    </Button>
                  </section>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Attendees List */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Attendees ({attendees.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {attendees.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                  {attendees.map((attendee) => (
                    <div key={attendee.id} className="flex flex-col items-center text-center p-2 rounded-lg hover:bg-secondary/50 transition-colors cursor-pointer" onClick={() => router.push(`/profile/${attendee.user.id}`)}>
                      <Avatar className="h-12 w-12 mb-2">
                        <AvatarImage src={attendee.user.profilePhotoUrl} />
                        <AvatarFallback>{getInitials(attendee.user.fullName)}</AvatarFallback>
                      </Avatar>
                      <p className="text-xs font-medium truncate w-full">{attendee.user.fullName}</p>
                      <p className="text-[10px] text-muted-foreground">Class of {attendee.user.batchYear}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center py-8 text-muted-foreground">No attendees yet. Be the first!</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar Info */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">RSVP Now</CardTitle>
              <CardDescription>Secure your spot for this event</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-muted-foreground">Capacity</span>
                <span className="font-medium">{event.maxAttendees ? `${attendees.length} / ${event.maxAttendees}` : 'Unlimited'}</span>
              </div>
              
              <Button 
                className="w-full" 
                size="lg" 
                disabled={rsvping || isPast || (event.maxAttendees && attendees.length >= event.maxAttendees && !isAttending)}
                onClick={handleRSVP}
              >
                {rsvping ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {isPast ? 'Event Ended' : isAttending ? 'Change RSVP' : 'Register for Event'}
              </Button>
              
              {isPast && (
                <p className="text-xs text-center text-muted-foreground italic">
                  This event has already taken place.
                </p>
              )}
            </CardContent>
          </Card>

          {!event.isVirtual && (event.venue || event.location) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <MapIcon className="h-4 w-4" />
                  Venue
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm font-semibold">{event.venue}</p>
                <p className="text-sm text-muted-foreground">{event.address}</p>
                <p className="text-sm text-muted-foreground">{event.city}, {event.state}</p>
                <Button variant="outline" className="w-full" onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${event.venue} ${event.address} ${event.city}`)}`, '_blank')}>
                  Get Directions
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Organizer</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3 mb-4">
                <Avatar className="h-10 w-10">
                  <AvatarFallback className="bg-primary/10 text-primary">AC</AvatarFallback>
                </Avatar>
                <div>
                  <h4 className="font-bold">Alumni Association</h4>
                  <p className="text-xs text-muted-foreground">Official Event Organizer</p>
                </div>
              </div>
              <Button variant="outline" className="w-full">
                Contact Organizer
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
