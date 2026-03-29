'use client';

import * as React from 'react';
import { useSocket, useSocketEvent } from '@/hooks/use-socket';
import { useToast } from '@/hooks/use-toast';

interface SocketContextType {
  isConnected: boolean;
  unreadMessages: number;
  unreadNotifications: number;
  resetUnreadMessages: () => void;
  resetUnreadNotifications: () => void;
}

const SocketContext = React.createContext<SocketContextType | undefined>(undefined);

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();
  const {
    isConnected,
    unreadMessages,
    unreadNotifications,
    resetUnreadMessages,
    resetUnreadNotifications,
  } = useSocket();

  // Show toast for new notifications
  useSocketEvent<{ title: string; message: string }>('socket:new_notification', (data) => {
    toast({
      title: data.title,
      description: data.message,
    });
  });

  // Show toast for new messages
  useSocketEvent<{ sender: { fullName: string }; content: string }>('socket:new_message', (data) => {
    toast({
      title: `New message from ${data.sender?.fullName || 'Someone'}`,
      description: data.content.substring(0, 50) + (data.content.length > 50 ? '...' : ''),
    });
  });

  const value = {
    isConnected,
    unreadMessages,
    unreadNotifications,
    resetUnreadMessages,
    resetUnreadNotifications,
  };

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocketContext() {
  const context = React.useContext(SocketContext);
  if (context === undefined) {
    throw new Error('useSocketContext must be used within a SocketProvider');
  }
  return context;
}
