'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { messageApi } from '@/lib/api';
import { useAuth } from '@/context/auth-context';
import { useSocketContext } from '@/context/socket-context';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { 
  Send, 
  Search, 
  MoreVertical, 
  Phone, 
  Video, 
  Image as ImageIcon,
  Loader2,
  ChevronLeft
} from 'lucide-react';
import { getInitials, cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

function MessagesContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const targetUserId = searchParams.get('u');
  const { user: currentUser } = useAuth();
  const { isConnected } = useSocketContext();
  
  const [conversations, setConversations] = useState<any[]>([]);
  const [activeConversation, setActiveConversation] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchConversations();
  }, []);

  useEffect(() => {
    if (activeConversation) {
      fetchMessages(activeConversation.partner.id);
      // Mark as read
      messageApi.markAsRead(activeConversation.partner.id);
    }
  }, [activeConversation]);

  useEffect(() => {
    if (targetUserId && conversations.length > 0) {
      const existing = conversations.find(c => c.partner.id === targetUserId);
      if (existing) {
        setActiveConversation(existing);
      } else {
        // Fetch specific user profile to start new conversation
        // For simplicity, we just wait for them to show up or handle specially
      }
    }
  }, [targetUserId, conversations]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const fetchConversations = async () => {
    try {
      const response = await messageApi.getConversations();
      setConversations(response.data.data || []);
      
      if (response.data.data?.length > 0 && !targetUserId) {
        setActiveConversation(response.data.data[0]);
      }
    } catch (error) {
      console.error('Failed to fetch conversations:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchMessages = async (partnerId: string) => {
    try {
      const response = await messageApi.getMessages(partnerId);
      setMessages(response.data.data || []);
    } catch (error) {
      console.error('Failed to fetch messages:', error);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !activeConversation || sending) return;

    setSending(true);
    try {
      const response = await messageApi.sendMessage(activeConversation.partner.id, newMessage);
      setMessages(prev => [...prev, response.data.data]);
      setNewMessage('');
      
      // Update last message in conversation list
      setConversations(prev => prev.map(c => 
        c.partner.id === activeConversation.partner.id 
          ? { ...c, lastMessage: response.data.data } 
          : c
      ));
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-[calc(100-200px)] items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-120px)] overflow-hidden rounded-xl border bg-card shadow-sm">
      {/* Sidebar - Conversation List */}
      <div className={cn(
        "w-full md:w-80 flex-shrink-0 border-r flex flex-col",
        activeConversation && "hidden md:flex"
      )}>
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">Messages</h2>
            <div className="flex items-center gap-1">
              <div className={cn("h-2 w-2 rounded-full", isConnected ? "bg-green-500" : "bg-red-500")} />
              <span className="text-xs text-muted-foreground">{isConnected ? 'Online' : 'Offline'}</span>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search messages..." className="pl-9 bg-secondary border-0" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {conversations.length > 0 ? (
            conversations.map((conv) => (
              <div
                key={conv.partner.id}
                onClick={() => setActiveConversation(conv)}
                className={cn(
                  "p-4 flex items-center gap-3 cursor-pointer hover:bg-secondary/50 transition-colors",
                  activeConversation?.partner.id === conv.partner.id && "bg-secondary border-l-4 border-primary"
                )}
              >
                <div className="relative">
                  <Avatar>
                    <AvatarImage src={conv.partner.profilePhotoUrl} />
                    <AvatarFallback>{getInitials(conv.partner.fullName)}</AvatarFallback>
                  </Avatar>
                  {conv.unreadCount > 0 && (
                    <Badge className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-[10px]" variant="destructive">
                      {conv.unreadCount}
                    </Badge>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-baseline">
                    <h4 className="font-semibold text-sm truncate">{conv.partner.fullName}</h4>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {conv.lastMessage?.createdAt && formatDistanceToNow(new Date(conv.lastMessage.createdAt), { addSuffix: false })}
                    </span>
                  </div>
                  <p className={cn(
                    "text-xs truncate",
                    conv.unreadCount > 0 ? "font-bold text-foreground" : "text-muted-foreground"
                  )}>
                    {conv.lastMessage?.senderId === currentUser?.id ? 'You: ' : ''}
                    {conv.lastMessage?.content || 'Started a conversation'}
                  </p>
                </div>
              </div>
            ))
          ) : (
            <div className="p-8 text-center text-muted-foreground">
              <p>No conversations yet.</p>
              <Button variant="link" onClick={() => router.push('/directory')}>Find alumni to chat</Button>
            </div>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className={cn(
        "flex-1 flex flex-col bg-slate-50/30",
        !activeConversation && "hidden md:flex"
      )}>
        {activeConversation ? (
          <>
            {/* Chat Header */}
            <div className="p-4 border-b bg-card flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setActiveConversation(null)}>
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <Avatar className="h-10 w-10 cursor-pointer" onClick={() => router.push(`/profile/${activeConversation.partner.id}`)}>
                  <AvatarImage src={activeConversation.partner.profilePhotoUrl} />
                  <AvatarFallback>{getInitials(activeConversation.partner.fullName)}</AvatarFallback>
                </Avatar>
                <div>
                  <h3 className="font-bold text-sm leading-none">{activeConversation.partner.fullName}</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {activeConversation.partner.currentDesignation || 'Alumni'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon"><Phone className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon"><Video className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4" /></Button>
              </div>
            </div>

            {/* Message List */}
            <div 
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth"
            >
              {messages.map((msg, idx) => {
                const isMine = msg.senderId === currentUser?.id;
                const prevMsg = messages[idx - 1];
                const showAvatar = !isMine && (!prevMsg || prevMsg.senderId !== msg.senderId);
                
                return (
                  <div key={msg.id} className={cn("flex", isMine ? "justify-end" : "justify-start")}>
                    {!isMine && (
                      <div className="w-8 mr-2 flex-shrink-0">
                        {showAvatar && (
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={activeConversation.partner.profilePhotoUrl} />
                            <AvatarFallback className="text-[10px]">{getInitials(activeConversation.partner.fullName)}</AvatarFallback>
                          </Avatar>
                        )}
                      </div>
                    )}
                    <div className={cn(
                      "max-w-[75%] rounded-2xl p-3 text-sm shadow-sm",
                      isMine ? "bg-primary text-primary-foreground rounded-tr-none" : "bg-card border rounded-tl-none"
                    )}>
                      {msg.content}
                      <div className={cn(
                        "text-[10px] mt-1 opacity-70 flex justify-end",
                        isMine ? "text-primary-foreground/80" : "text-muted-foreground"
                      )}>
                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Input Area */}
            <div className="p-4 border-t bg-card">
              <form onSubmit={handleSendMessage} className="flex gap-2">
                <Button type="button" variant="ghost" size="icon" className="shrink-0">
                  <ImageIcon className="h-5 w-5 text-muted-foreground" />
                </Button>
                <Input
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Type a message..."
                  className="bg-secondary border-0 focus-visible:ring-1"
                />
                <Button type="submit" size="icon" disabled={!newMessage.trim() || sending}>
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="h-20 w-20 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <MessageSquare className="h-10 w-10 text-primary" />
            </div>
            <h3 className="text-xl font-bold">Your Messages</h3>
            <p className="text-muted-foreground mt-2 max-w-sm">
              Select a conversation from the left to start chatting with your fellow alumni.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function MessagesPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin" /></div>}>
      <MessagesContent />
    </Suspense>
  );
}
