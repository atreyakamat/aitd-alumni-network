'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/hooks/use-toast';
import api from '@/lib/api';
import { 
  Users, 
  GraduationCap, 
  Calendar, 
  MessageSquare, 
  Search, 
  Plus,
  CheckCircle,
  XCircle,
  Clock,
  User
} from 'lucide-react';

interface Mentor {
  id: string;
  userId: string;
  focusAreas: string[];
  availability: string | null;
  bio: string | null;
  maxMentees: number;
  currentMentees: number;
  isActive: boolean;
  user: {
    id: string;
    fullName: string;
    profilePhotoUrl: string | null;
    currentDesignation: string | null;
    shortBio: string | null;
    batchYear: number;
    department: string;
  };
}

interface MentorshipRequest {
  id: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'COMPLETED';
  message: string | null;
  createdAt: string;
  mentee: {
    id: string;
    fullName: string;
    profilePhotoUrl: string | null;
    batchYear: number;
    department: string;
  };
  mentor: {
    id: string;
    fullName: string;
    profilePhotoUrl: string | null;
    currentDesignation: string | null;
  };
  profile: {
    focusAreas: string[];
  };
  sessions: Array<{
    id: string;
    scheduledAt: string;
    completed: boolean;
  }>;
}

export default function MentorshipPage() {
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [mentors, setMentors] = useState<Mentor[]>([]);
  const [myMentorRequests, setMyMentorRequests] = useState<MentorshipRequest[]>([]);
  const [myMenteeRequests, setMyMenteeRequests] = useState<MentorshipRequest[]>([]);
  const [myMentorProfile, setMyMentorProfile] = useState<Mentor | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [focusAreaFilter, setFocusAreaFilter] = useState('');
  const [showBecomeMentorDialog, setShowBecomeMentorDialog] = useState(false);
  const [showRequestDialog, setShowRequestDialog] = useState(false);
  const [selectedMentor, setSelectedMentor] = useState<Mentor | null>(null);
  
  // Form states
  const [mentorFormData, setMentorFormData] = useState({
    focusAreas: '',
    availability: '',
    bio: '',
    maxMentees: 5
  });
  const [requestMessage, setRequestMessage] = useState('');

  useEffect(() => {
    if (isAuthenticated) {
      fetchData();
    }
  }, [isAuthenticated]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [mentorsRes, mentorRequestsRes, menteeRequestsRes] = await Promise.all([
        api.get('/mentorship/mentors', { params: { search: searchQuery, focusArea: focusAreaFilter } }),
        api.get('/mentorship/requests/mentor').catch(() => ({ data: { data: [] } })),
        api.get('/mentorship/requests/mentee').catch(() => ({ data: { data: [] } })),
      ]);
      
      setMentors(mentorsRes.data.data?.data || []);
      setMyMentorRequests(mentorRequestsRes.data.data || []);
      setMyMenteeRequests(menteeRequestsRes.data.data || []);
      
      // Try to get my mentor profile
      try {
        const profileRes = await api.get('/mentorship/profile');
        setMyMentorProfile(profileRes.data.data);
      } catch {
        setMyMentorProfile(null);
      }
    } catch (error) {
      console.error('Error fetching mentorship data:', error);
      toast({
        title: 'Error',
        description: 'Failed to load mentorship data',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleBecomeMentor = async () => {
    try {
      const focusAreas = mentorFormData.focusAreas.split(',').map(s => s.trim()).filter(Boolean);
      await api.post('/mentorship/profile', {
        focusAreas,
        availability: mentorFormData.availability,
        bio: mentorFormData.bio,
        maxMentees: mentorFormData.maxMentees
      });
      toast({
        title: 'Success',
        description: 'You are now a mentor!',
      });
      setShowBecomeMentorDialog(false);
      fetchData();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to create mentor profile',
        variant: 'destructive',
      });
    }
  };

  const handleRequestMentorship = async () => {
    if (!selectedMentor) return;
    try {
      await api.post(`/mentorship/request/${selectedMentor.user.id}`, {
        message: requestMessage
      });
      toast({
        title: 'Success',
        description: 'Mentorship request sent!',
      });
      setShowRequestDialog(false);
      setRequestMessage('');
      setSelectedMentor(null);
      fetchData();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      toast({
        title: 'Error',
        description: err.response?.data?.error || 'Failed to send request',
        variant: 'destructive',
      });
    }
  };

  const handleRespondToRequest = async (requestId: string, accept: boolean) => {
    try {
      await api.post(`/mentorship/request/${requestId}/respond`, { accept });
      toast({
        title: 'Success',
        description: accept ? 'Request accepted!' : 'Request declined',
      });
      fetchData();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to respond to request',
        variant: 'destructive',
      });
    }
  };

  const handleSearch = () => {
    fetchData();
  };

  if (!isAuthenticated) {
    return (
      <div className="container mx-auto py-8 px-4">
        <Card>
          <CardContent className="py-12 text-center">
            <GraduationCap className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-xl font-semibold mb-2">Login Required</h2>
            <p className="text-muted-foreground">Please log in to access the mentorship program.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-serif font-bold">Mentorship Program</h1>
          <p className="text-muted-foreground mt-1">Connect with experienced alumni for guidance and growth</p>
        </div>
        {!myMentorProfile && (
          <Dialog open={showBecomeMentorDialog} onOpenChange={setShowBecomeMentorDialog}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Become a Mentor
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Become a Mentor</DialogTitle>
                <DialogDescription>
                  Share your expertise and help fellow alumni grow in their careers.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div>
                  <Label htmlFor="focusAreas">Focus Areas (comma-separated)</Label>
                  <Input
                    id="focusAreas"
                    placeholder="e.g., Web Development, Career Guidance, Startups"
                    value={mentorFormData.focusAreas}
                    onChange={(e) => setMentorFormData({ ...mentorFormData, focusAreas: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="availability">Availability</Label>
                  <Input
                    id="availability"
                    placeholder="e.g., Weekday evenings, Weekends"
                    value={mentorFormData.availability}
                    onChange={(e) => setMentorFormData({ ...mentorFormData, availability: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="bio">Short Bio</Label>
                  <Textarea
                    id="bio"
                    placeholder="Tell potential mentees about your experience..."
                    value={mentorFormData.bio}
                    onChange={(e) => setMentorFormData({ ...mentorFormData, bio: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="maxMentees">Maximum Mentees</Label>
                  <Input
                    id="maxMentees"
                    type="number"
                    min={1}
                    max={20}
                    value={mentorFormData.maxMentees}
                    onChange={(e) => setMentorFormData({ ...mentorFormData, maxMentees: parseInt(e.target.value) || 5 })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowBecomeMentorDialog(false)}>Cancel</Button>
                <Button onClick={handleBecomeMentor}>Create Profile</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Tabs defaultValue="find" className="space-y-6">
        <TabsList>
          <TabsTrigger value="find">
            <Search className="h-4 w-4 mr-2" />
            Find Mentors
          </TabsTrigger>
          <TabsTrigger value="my-mentors">
            <Users className="h-4 w-4 mr-2" />
            My Mentors
          </TabsTrigger>
          {myMentorProfile && (
            <TabsTrigger value="my-mentees">
              <GraduationCap className="h-4 w-4 mr-2" />
              My Mentees
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="find" className="space-y-6">
          {/* Search Bar */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex gap-4">
                <Input
                  placeholder="Search mentors by name or expertise..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1"
                />
                <Input
                  placeholder="Filter by focus area..."
                  value={focusAreaFilter}
                  onChange={(e) => setFocusAreaFilter(e.target.value)}
                  className="w-64"
                />
                <Button onClick={handleSearch}>
                  <Search className="h-4 w-4 mr-2" />
                  Search
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Mentors Grid */}
          {loading ? (
            <div className="text-center py-12">Loading mentors...</div>
          ) : mentors.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold">No mentors found</h3>
                <p className="text-muted-foreground">Try adjusting your search criteria</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {mentors.map((mentor) => (
                <Card key={mentor.id}>
                  <CardHeader>
                    <div className="flex items-start gap-4">
                      <Avatar className="h-16 w-16">
                        <AvatarImage src={mentor.user.profilePhotoUrl || undefined} />
                        <AvatarFallback>{mentor.user.fullName.split(' ').map(n => n[0]).join('')}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <CardTitle className="text-lg">{mentor.user.fullName}</CardTitle>
                        <CardDescription>
                          {mentor.user.currentDesignation || 'Alumni'}
                          <br />
                          {mentor.user.department} • Batch {mentor.user.batchYear}
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {mentor.bio && (
                      <p className="text-sm text-muted-foreground mb-4 line-clamp-2">{mentor.bio}</p>
                    )}
                    <div className="flex flex-wrap gap-2 mb-4">
                      {(mentor.focusAreas as string[]).slice(0, 3).map((area, i) => (
                        <Badge key={i} variant="secondary">{area}</Badge>
                      ))}
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Users className="h-4 w-4" />
                        {mentor.currentMentees}/{mentor.maxMentees} mentees
                      </span>
                      {mentor.availability && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          {mentor.availability}
                        </span>
                      )}
                    </div>
                  </CardContent>
                  <CardFooter>
                    <Button 
                      className="w-full"
                      disabled={mentor.user.id === user?.id || mentor.currentMentees >= mentor.maxMentees}
                      onClick={() => {
                        setSelectedMentor(mentor);
                        setShowRequestDialog(true);
                      }}
                    >
                      {mentor.user.id === user?.id ? 'This is you' : 
                       mentor.currentMentees >= mentor.maxMentees ? 'Not Available' : 
                       'Request Mentorship'}
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="my-mentors" className="space-y-6">
          <h2 className="text-xl font-semibold">My Mentorship Requests</h2>
          {myMenteeRequests.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <User className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold">No mentorship requests</h3>
                <p className="text-muted-foreground">Find a mentor and send a request to get started</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {myMenteeRequests.map((request) => (
                <Card key={request.id}>
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <Avatar>
                          <AvatarImage src={request.mentor.profilePhotoUrl || undefined} />
                          <AvatarFallback>{request.mentor.fullName.split(' ').map(n => n[0]).join('')}</AvatarFallback>
                        </Avatar>
                        <div>
                          <h3 className="font-semibold">{request.mentor.fullName}</h3>
                          <p className="text-sm text-muted-foreground">{request.mentor.currentDesignation}</p>
                        </div>
                      </div>
                      <Badge variant={
                        request.status === 'ACCEPTED' ? 'default' :
                        request.status === 'PENDING' ? 'secondary' :
                        request.status === 'DECLINED' ? 'destructive' : 'outline'
                      }>
                        {request.status}
                      </Badge>
                    </div>
                    {request.message && (
                      <p className="mt-4 text-sm text-muted-foreground">{request.message}</p>
                    )}
                    {request.status === 'ACCEPTED' && (
                      <div className="mt-4 flex gap-2">
                        <Button variant="outline" size="sm">
                          <MessageSquare className="h-4 w-4 mr-2" />
                          Message
                        </Button>
                        <Button variant="outline" size="sm">
                          <Calendar className="h-4 w-4 mr-2" />
                          Schedule Session
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {myMentorProfile && (
          <TabsContent value="my-mentees" className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold">Mentorship Requests</h2>
              <Badge variant="outline">
                {myMentorProfile.currentMentees}/{myMentorProfile.maxMentees} mentees
              </Badge>
            </div>
            {myMentorRequests.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <GraduationCap className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                  <h3 className="text-lg font-semibold">No mentorship requests</h3>
                  <p className="text-muted-foreground">When someone requests your mentorship, it will appear here</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {myMentorRequests.map((request) => (
                  <Card key={request.id}>
                    <CardContent className="py-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <Avatar>
                            <AvatarImage src={request.mentee.profilePhotoUrl || undefined} />
                            <AvatarFallback>{request.mentee.fullName.split(' ').map(n => n[0]).join('')}</AvatarFallback>
                          </Avatar>
                          <div>
                            <h3 className="font-semibold">{request.mentee.fullName}</h3>
                            <p className="text-sm text-muted-foreground">
                              {request.mentee.department} • Batch {request.mentee.batchYear}
                            </p>
                          </div>
                        </div>
                        {request.status === 'PENDING' ? (
                          <div className="flex gap-2">
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => handleRespondToRequest(request.id, false)}
                            >
                              <XCircle className="h-4 w-4 mr-1" />
                              Decline
                            </Button>
                            <Button 
                              size="sm"
                              onClick={() => handleRespondToRequest(request.id, true)}
                            >
                              <CheckCircle className="h-4 w-4 mr-1" />
                              Accept
                            </Button>
                          </div>
                        ) : (
                          <Badge variant={
                            request.status === 'ACCEPTED' ? 'default' :
                            request.status === 'DECLINED' ? 'destructive' : 'outline'
                          }>
                            {request.status}
                          </Badge>
                        )}
                      </div>
                      {request.message && (
                        <p className="mt-4 text-sm border-l-2 pl-4 text-muted-foreground">{request.message}</p>
                      )}
                      {request.status === 'ACCEPTED' && (
                        <div className="mt-4 flex gap-2">
                          <Button variant="outline" size="sm">
                            <MessageSquare className="h-4 w-4 mr-2" />
                            Message
                          </Button>
                          <Button variant="outline" size="sm">
                            <Calendar className="h-4 w-4 mr-2" />
                            Schedule Session
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        )}
      </Tabs>

      {/* Request Mentorship Dialog */}
      <Dialog open={showRequestDialog} onOpenChange={setShowRequestDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Mentorship</DialogTitle>
            <DialogDescription>
              Send a request to {selectedMentor?.user.fullName} to become your mentor.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="requestMessage">Message (optional)</Label>
            <Textarea
              id="requestMessage"
              placeholder="Introduce yourself and explain what you hope to learn..."
              value={requestMessage}
              onChange={(e) => setRequestMessage(e.target.value)}
              className="mt-2"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRequestDialog(false)}>Cancel</Button>
            <Button onClick={handleRequestMentorship}>Send Request</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
