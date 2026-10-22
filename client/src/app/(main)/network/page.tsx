'use client';

import { useState, useEffect } from 'react';
import { networkApi, getApiErrorMessage } from '@/lib/api';
import { useAuth } from '@/context/auth-context';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { 
  Users, 
  UserPlus, 
  Check, 
  X, 
  Loader2, 
  MessageSquare,
  Search,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getInitials } from '@/lib/utils';
import { useRouter } from 'next/navigation';

export default function NetworkPage() {
  const { user } = useAuth();
  const [connections, setConnections] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const router = useRouter();

  useEffect(() => {
    fetchNetworkData();
  }, []);

  const fetchNetworkData = async () => {
    setLoading(true);
    try {
      const [connRes, reqRes, sugRes] = await Promise.all([
        networkApi.getConnections(),
        networkApi.getPendingRequests(),
        networkApi.getSuggestions(12)
      ]);

      const connData = connRes.data?.data;
      const connList = Array.isArray(connData) ? connData : (connData?.items || []);
      setConnections(connList);

      const reqData = reqRes.data?.data;
      const receivedList = reqData?.received || (Array.isArray(reqData) ? reqData : []);
      setRequests(receivedList);

      const sugData = sugRes.data?.data;
      setSuggestions(Array.isArray(sugData) ? sugData : []);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: getApiErrorMessage(error, 'Failed to load network information.'),
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptRequest = async (requestId: string) => {
    try {
      await networkApi.respondToRequest(requestId, true);
      toast({ title: 'Success', description: 'Connection request accepted.' });
      fetchNetworkData();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: getApiErrorMessage(error, 'Failed to accept request.'),
      });
    }
  };

  const handleDeclineRequest = async (requestId: string) => {
    try {
      await networkApi.respondToRequest(requestId, false);
      toast({ title: 'Success', description: 'Connection request declined.' });
      fetchNetworkData();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: getApiErrorMessage(error, 'Failed to decline request.'),
      });
    }
  };

  const handleConnect = async (userId: string) => {
    try {
      await networkApi.sendRequest(userId);
      toast({ title: 'Request Sent', description: 'Connection request has been sent.' });
      setSuggestions(prev => prev.filter(s => s.id !== userId));
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: getApiErrorMessage(error, 'Failed to send request.'),
      });
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">Loading your network...</p>
      </div>
    );
  }

  return (
    <div className="container py-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold">My Network</h1>
          <p className="text-muted-foreground">Manage your connections and grow your professional circle.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push('/directory')}>
            <Search className="h-4 w-4 mr-2" />
            Find Alumni
          </Button>
        </div>
      </div>

      <Tabs defaultValue="connections" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="connections" className="relative">
            Connections
            {connections.length > 0 && (
              <Badge variant="secondary" className="ml-2">{connections.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="requests" className="relative">
            Requests
            {requests.length > 0 && (
              <Badge variant="destructive" className="ml-2">{requests.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="suggestions">Suggestions</TabsTrigger>
        </TabsList>

        <TabsContent value="connections">
          {connections.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {connections.map((conn) => {
                const partner = conn.fullName
                  ? conn
                  : conn.requesterId === user?.id
                  ? conn.addressee
                  : conn.requester || conn;
                const partnerId = partner?.id || conn.id;
                if (!partnerId) return null;
                const key = conn.connectionId || conn.id || partnerId;

                return (
                  <Card key={key} className="hover:shadow-md transition-shadow">
                    <CardContent className="pt-6 text-center">
                      <Avatar
                        className="h-20 w-20 mx-auto mb-4 cursor-pointer"
                        onClick={() => router.push(`/profile/${encodeURIComponent(partnerId)}`)}
                      >
                        <AvatarImage src={partner.profilePhotoUrl || partner.avatarUrl || undefined} />
                        <AvatarFallback className="text-xl">{getInitials(partner.fullName || 'User')}</AvatarFallback>
                      </Avatar>
                      <h3 className="font-bold text-lg truncate">{partner.fullName || 'Alumnus'}</h3>
                      <p className="text-sm text-primary font-medium truncate">{partner.currentDesignation || partner.headline || 'Alumnus'}</p>
                      {(partner.batchYear || partner.department) && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {[partner.department, partner.batchYear ? `Class of ${partner.batchYear}` : null].filter(Boolean).join(' • ')}
                        </p>
                      )}
                      
                      <div className="flex gap-2 mt-4">
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1"
                          onClick={() => router.push(`/messages?u=${encodeURIComponent(partnerId)}`)}
                        >
                          <MessageSquare className="h-4 w-4 mr-2" />
                          Message
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <Card className="py-12 text-center">
              <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium">No connections yet</h3>
              <p className="text-muted-foreground mb-6">Start building your network by connecting with alumni.</p>
              <Button onClick={() => router.push('/directory')}>Browse Directory</Button>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="requests">
          {requests.length > 0 ? (
            <div className="grid gap-4 max-w-2xl">
              {requests.map((req) => {
                const requester = req.user || req.requester || req;
                const reqId = req.connectionId || req.id;
                if (!requester) return null;

                return (
                  <Card key={reqId || requester.id}>
                    <CardContent className="p-4 flex items-center justify-between">
                      <div
                        className="flex items-center gap-4 cursor-pointer"
                        onClick={() => requester.id && router.push(`/profile/${encodeURIComponent(requester.id)}`)}
                      >
                        <Avatar className="h-12 w-12">
                          <AvatarImage src={requester.profilePhotoUrl || requester.avatarUrl || undefined} />
                          <AvatarFallback>{getInitials(requester.fullName || 'User')}</AvatarFallback>
                        </Avatar>
                        <div>
                          <h4 className="font-bold">{requester.fullName || 'Alumnus'}</h4>
                          <p className="text-sm text-muted-foreground">
                            {[
                              requester.currentDesignation || 'Alumnus',
                              requester.batchYear ? `Class of ${requester.batchYear}` : null,
                            ].filter(Boolean).join(' • ')}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => handleAcceptRequest(reqId)}>
                          <Check className="h-4 w-4 mr-1" />
                          Accept
                        </Button>
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDeclineRequest(reqId)}>
                          <X className="h-4 w-4 mr-1" />
                          Decline
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <Card className="py-12 text-center">
              <UserPlus className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium">No pending requests</h3>
              <p className="text-muted-foreground">You're all caught up!</p>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="suggestions">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {suggestions.map((person) => (
              <Card key={person.id} className="hover:shadow-md transition-shadow">
                <CardContent className="pt-6 text-center">
                  <Avatar
                    className="h-20 w-20 mx-auto mb-4 cursor-pointer"
                    onClick={() => router.push(`/profile/${encodeURIComponent(person.id)}`)}
                  >
                    <AvatarImage src={person.profilePhotoUrl || person.avatarUrl || undefined} />
                    <AvatarFallback className="text-xl">{getInitials(person.fullName || 'User')}</AvatarFallback>
                  </Avatar>
                  <h3 className="font-bold text-lg truncate">{person.fullName}</h3>
                  <p className="text-sm text-primary font-medium truncate">{person.currentDesignation || person.headline || 'Alumnus'}</p>
                  {(person.batchYear || person.department) && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {[person.department, person.batchYear ? `Class of ${person.batchYear}` : null].filter(Boolean).join(' • ')}
                    </p>
                  )}
                  {person.reason && (
                    <Badge variant="secondary" className="mt-2 text-xs font-normal">
                      {person.reason}
                    </Badge>
                  )}
                  
                  <Button variant="outline" size="sm" className="w-full mt-4" onClick={() => handleConnect(person.id)}>
                    <UserPlus className="h-4 w-4 mr-2" />
                    Connect
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
