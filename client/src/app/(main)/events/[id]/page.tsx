'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { eventApi, getApiErrorMessage } from '@/lib/api';
import { getEventCapacity, getEventLocation, getRsvpErrorMessage, isVirtualEvent, normalizeAttendee, type AttendeeView } from '@/lib/events';
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
import { buildLoginHref } from '@/lib/public-paths';
import { shareLinkWithToast } from '@/lib/share';

export default function EventDetailsPage() {
  const params = useParams();
  const id = params?.id as string;
  const router = useRouter();
  const pathname = usePathname();
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [event, setEvent] = useState<any>(null);
  const [attendees, setAttendees] = useState<AttendeeView[]>([]);
  const [loading, setLoading] = useState(true);
  const [rsvping, setRsvping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEventDetails = useCallback(async () => {
    setLoading(true);
    try {
      // The attendee list is members-only; anonymous visitors just see the event.
      const [eventRes, attendeesRes] = await Promise.all([
        eventApi.getEvent(id as string),
        isAuthenticated ? eventApi.getAttendees(id as string) : Promise.resolve(null),
      ]);
      setEvent(eventRes.data.data);
      setAttendees((attendeesRes?.data?.data || []).map(normalizeAttendee));
    } catch (err: any) {
      setError(getApiErrorMessage(err, 'Failed to load event details'));
    } finally {
      setLoading(false);
    }
  }, [id, isAuthenticated]);

  useEffect(() => {
    if (id) {
      fetchEventDetails();
    }
  }, [id, fetchEventDetails]);

  const handleRSVP = async () => {
    if (!isAuthenticated) {
      router.push(buildLoginHref(pathname || `/events/${id}`));
      return;
    }
    setRsvping(true);
    try {
      const res = await eventApi.rsvpEvent(id as string);
      const rsvped = res.data?.data?.rsvped;
      toast({
        title: rsvped === false ? 'RSVP cancelled' : "You're registered!",
        description: rsvped === false ? 'You are no longer on the attendee list.' : 'Your RSVP has been recorded.',
      });
      fetchEventDetails(); // Refresh to update attendee list and status
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'RSVP not updated',
        description: getRsvpErrorMessage(err),
      });
    } finally {
      setRsvping(false);
    }
  };

  const handleShare = () => shareLinkWithToast({ title: event?.title, url: window.location.href }, toast);

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
  const capacity = getEventCapacity(event);
  const spotsTaken = typeof event.rsvpCount === 'number' ? event.rsvpCount : attendees.length;
  const isFull = capacity !== null && spotsTaken >= capacity;
  const coverImage = event.bannerUrl || event.coverImageUrl;
  const isVirtual = isVirtualEvent(event);
  const locationText = getEventLocation(event);
  const joinLink: string | undefined = event.joinLink || event.virtualLink;
  const organizer: { id?: string; fullName?: string; profilePhotoUrl?: string | null } | null = event.createdBy ?? null;
  const organizerId: string | undefined = organizer?.id || event.createdById || undefined;
  const isOrganizer = !!organizerId && organizerId === user?.id;
  const contactOrganizerHref = !organizerId || isOrganizer
    ? null
    : isAuthenticated
      ? `/messages?u=${encodeURIComponent(organizerId)}`
      : buildLoginHref(pathname || `/events/${id}`);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <Button variant="ghost" className="mb-2" asChild>
        <Link href="/events">
          <ChevronLeft className="h-4 w-4 mr-2" />
          Back to Events
        </Link>
      </Button>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="overflow-hidden">
            <div className="h-64 bg-muted relative">
              {coverImage ? (
                <Image 
                  src={coverImage} 
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
                <Button variant="outline" size="icon" onClick={handleShare} aria-label="Share event" title="Share event">
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
                    <p className="text-sm font-semibold text-foreground">{isVirtual ? 'Virtual Event' : locationText || 'Location TBD'}</p>
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

                {event.eventType !== 'OFFLINE' && joinLink && (
                  <section className="p-4 bg-primary/5 rounded-lg border border-primary/10">
                    <h3 className="font-bold flex items-center gap-2 mb-2 text-primary">
                      <Globe className="h-4 w-4" />
                      Virtual Meeting Link
                    </h3>
                    <p className="text-sm mb-3">This is a virtual event. You can join using the link below.</p>
                    <Button variant="outline" className="w-full sm:w-auto" onClick={() => window.open(joinLink, '_blank', 'noopener,noreferrer')}>
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
                Attendees{isAuthenticated ? ` (${attendees.length})` : ''}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!isAuthenticated ? (
                <p className="text-center py-8 text-muted-foreground">
                  <Link href={buildLoginHref(pathname || `/events/${id}`)} className="font-medium text-primary hover:underline">
                    Sign in
                  </Link>{' '}
                  to see who&apos;s attending.
                </p>
              ) : attendees.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                  {attendees.map((attendee) => (
                    <div key={attendee.userId} className="flex flex-col items-center text-center p-2 rounded-lg hover:bg-secondary/50 transition-colors cursor-pointer" onClick={() => router.push(`/profile/${attendee.userId}`)}>
                      <Avatar className="h-12 w-12 mb-2">
                        <AvatarImage src={attendee.profilePhotoUrl ?? undefined} />
                        <AvatarFallback>{getInitials(attendee.fullName)}</AvatarFallback>
                      </Avatar>
                      <p className="text-xs font-medium truncate w-full">{attendee.fullName}</p>
                      <p className="text-[10px] text-muted-foreground">{attendee.batchYear ? `Class of ${attendee.batchYear}` : ''}</p>{attendee.email && <p className="text-[10px] text-muted-foreground truncate w-full">{attendee.email}</p>}
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
                <span className="font-medium">{capacity ? `${spotsTaken} / ${capacity}` : 'Unlimited'}</span>
              </div>
              
              <Button 
                className="w-full" 
                size="lg" 
                disabled={rsvping || isPast || (isFull && !isAttending)}
                onClick={handleRSVP}
              >
                {rsvping ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {isPast
                  ? 'Event Ended'
                  : isAttending
                    ? 'Cancel RSVP'
                    : isFull
                      ? 'Event Full'
                      : isAuthenticated
                        ? 'Register for Event'
                        : 'Sign in to RSVP'}
              </Button>
              
              {isPast && (
                <p className="text-xs text-center text-muted-foreground italic">
                  This event has already taken place.
                </p>
              )}
            </CardContent>
          </Card>

          {!isVirtual && locationText && (
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
                <p className="text-sm text-muted-foreground">{[event.city, event.state].filter(Boolean).join(', ')}</p>
                <Button variant="outline" className="w-full" onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([event.venue, event.address, event.city].filter(Boolean).join(' '))}`, '_blank')}>
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
                  {organizer?.profilePhotoUrl && <AvatarImage src={organizer.profilePhotoUrl} alt="" />}
                  <AvatarFallback className="bg-primary/10 text-primary">
                    {organizer?.fullName ? getInitials(organizer.fullName) : 'AC'}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h4 className="font-bold">{organizer?.fullName || 'Alumni Association'}</h4>
                  <p className="text-xs text-muted-foreground">
                    {event.chapter?.name ? `${event.chapter.name} chapter` : 'Official Event Organizer'}
                  </p>
                </div>
              </div>
              {contactOrganizerHref && (
                <Button variant="outline" className="w-full" asChild>
                  <Link href={contactOrganizerHref}>Contact Organizer</Link>
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
