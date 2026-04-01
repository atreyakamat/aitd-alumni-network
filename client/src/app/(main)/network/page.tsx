'use client';

import { useState, useEffect } from 'react';
import { networkApi } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
  Filter
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getInitials } from '@/lib/utils';
import { useRouter } from 'next/navigation';

export default function NetworkPage() {
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
      setConnections(connRes.data.data || []);
      setRequests(reqRes.data.data || []);
      setSuggestions(sugRes.data.data || []);
    } catch (error) {
      console.error('Failed to fetch network data:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load network information.',
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
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to accept request.' });
    }
  };

  const handleDeclineRequest = async (requestId: string) => {
    try {
      await networkApi.respondToRequest(requestId, false);
      toast({ title: 'Success', description: 'Connection request declined.' });
      fetchNetworkData();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to decline request.' });
    }
  };

  const handleConnect = async (userId: string) => {
    try {
      await networkApi.sendRequest(userId);
      toast({ title: 'Request Sent', description: 'Connection request has been sent.' });
      setSuggestions(prev => prev.filter(s => s.id !== userId));
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to send request.' });
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
                const partner = conn.requesterId === conn.userId ? conn.addressee : conn.requester;
                return (
                  <Card key={conn.id} className="hover:shadow-md transition-shadow">
                    <CardContent className="pt-6 text-center">
                      <Avatar className="h-20 w-20 mx-auto mb-4 cursor-pointer" onClick={() => router.push(`/profile/${partner.id}`)}>
                        <AvatarImage src={partner.profilePhotoUrl} />
                        <AvatarFallback className="text-xl">{getInitials(partner.fullName)}</AvatarFallback>
                      </Avatar>
                      <h3 className="font-bold text-lg truncate">{partner.fullName}</h3>
                      <p className="text-sm text-primary font-medium truncate">{partner.currentDesignation || 'Alumnus'}</p>
                      <p className="text-xs text-muted-foreground mt-1">Class of {partner.batchYear} • {partner.department}</p>
                      
                      <div className="flex gap-2 mt-4">
                        <Button variant="outline" size="sm" className="flex-1" onClick={() => router.push(`/messages?u=${partner.id}`)}>
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
              {requests.map((req) => (
                <Card key={req.id}>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-4 cursor-pointer" onClick={() => router.push(`/profile/${req.requester.id}`)}>
                      <Avatar className="h-12 w-12">
                        <AvatarImage src={req.requester.profilePhotoUrl} />
                        <AvatarFallback>{getInitials(req.requester.fullName)}</AvatarFallback>
                      </Avatar>
                      <div>
                        <h4 className="font-bold">{req.requester.fullName}</h4>
                        <p className="text-sm text-muted-foreground">{req.requester.currentDesignation || 'Alumnus'} • Class of {req.requester.batchYear}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => handleAcceptRequest(req.id)}>
                        <Check className="h-4 w-4 mr-1" />
                        Accept
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDeclineRequest(req.id)}>
                        <X className="h-4 w-4 mr-1" />
                        Decline
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
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
            {suggestions.map((user) => (
              <Card key={user.id} className="hover:shadow-md transition-shadow">
                <CardContent className="pt-6 text-center">
                  <Avatar className="h-20 w-20 mx-auto mb-4 cursor-pointer" onClick={() => router.push(`/profile/${user.id}`)}>
                    <AvatarImage src={user.profilePhotoUrl} />
                    <AvatarFallback className="text-xl">{getInitials(user.fullName)}</AvatarFallback>
                  </Avatar>
                  <h3 className="font-bold text-lg truncate">{user.fullName}</h3>
                  <p className="text-sm text-primary font-medium truncate">{user.currentDesignation || 'Alumnus'}</p>
                  <p className="text-xs text-muted-foreground mt-1">Class of {user.batchYear} • {user.department}</p>
                  
                  <Button variant="outline" size="sm" className="w-full mt-4" onClick={() => handleConnect(user.id)}>
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
