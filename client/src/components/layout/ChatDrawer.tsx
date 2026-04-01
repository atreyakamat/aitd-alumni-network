'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/auth-context';
import { useSocketContext } from '@/context/socket-context';
import { messageApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { MessageSquare, X, Minus, Maximize2, Send, Loader2 } from 'lucide-react';
import { getInitials, cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';

export function ChatDrawer() {
  const [isOpen, setIsOpen] = useState(false);
  const [conversations, setConversations] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const { isConnected, unreadMessages } = useSocketContext();
  const router = useRouter();

  useEffect(() => {
    if (isOpen) {
      fetchConversations();
    }
  }, [isOpen]);

  const fetchConversations = async () => {
    setLoading(true);
    try {
      const response = await messageApi.getConversations();
      setConversations(response.data.data || []);
    } catch (error) {
      console.error('Failed to fetch conversations:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) {
    return (
      <Button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-2xl z-50 p-0"
      >
        <MessageSquare className="h-6 w-6" />
        {unreadMessages > 0 && (
          <Badge className="absolute -top-1 -right-1 h-6 w-6 flex items-center justify-center p-0 border-2 border-background" variant="destructive">
            {unreadMessages}
          </Badge>
        )}
      </Button>
    );
  }

  return (
    <Card className="fixed bottom-0 right-6 w-80 h-[500px] shadow-2xl z-50 flex flex-col rounded-b-none border-b-0 animate-in slide-in-from-bottom-5 duration-300">
      <CardHeader className="p-4 bg-primary text-primary-foreground flex flex-row items-center justify-between shrink-0">
        <CardTitle className="text-base flex items-center gap-2">
          <MessageSquare className="h-4 w-4" />
          Messages
          <span className={cn("h-2 w-2 rounded-full", isConnected ? "bg-green-400" : "bg-red-400")} />
        </CardTitle>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-primary-foreground hover:bg-primary-foreground/10" onClick={() => router.push('/messages')}>
            <Maximize2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-primary-foreground hover:bg-primary-foreground/10" onClick={() => setIsOpen(false)}>
            <Minus className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      
      <CardContent className="flex-1 overflow-y-auto p-0">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : conversations.length > 0 ? (
          <div className="divide-y">
            {conversations.map((conv) => (
              <div
                key={conv.partner.id}
                onClick={() => {
                  router.push(`/messages?u=${conv.partner.id}`);
                  setIsOpen(false);
                }}
                className="p-3 flex items-center gap-3 cursor-pointer hover:bg-secondary transition-colors"
              >
                <div className="relative">
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={conv.partner.profilePhotoUrl} />
                    <AvatarFallback>{getInitials(conv.partner.fullName)}</AvatarFallback>
                  </Avatar>
                  {conv.unreadCount > 0 && (
                    <Badge className="absolute -top-1 -right-1 h-4 w-4 flex items-center justify-center p-0 text-[8px]" variant="destructive">
                      {conv.unreadCount}
                    </Badge>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-sm truncate">{conv.partner.fullName}</h4>
                  <p className="text-xs text-muted-foreground truncate">
                    {conv.lastMessage?.content || 'No messages yet'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center p-6">
            <MessageSquare className="h-12 w-12 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">No recent conversations.</p>
            <Button variant="link" size="sm" onClick={() => {
              router.push('/directory');
              setIsOpen(false);
            }}>
              Find alumni
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
