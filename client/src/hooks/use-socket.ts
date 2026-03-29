'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '@/context/auth-context';

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') || 'http://localhost:5000';

interface UseSocketOptions {
  autoConnect?: boolean;
}

export function useSocket(options: UseSocketOptions = {}) {
  const { autoConnect = true } = options;
  const { isAuthenticated } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  // Initialize socket connection
  useEffect(() => {
    if (!autoConnect || !isAuthenticated) return;

    const token = localStorage.getItem('accessToken');
    if (!token) return;

    const socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Socket connected:', socket.id);
      setIsConnected(true);
    });

    socket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
      setIsConnected(false);
    });

    socket.on('connect_error', (error) => {
      console.error('Socket connection error:', error.message);
      setIsConnected(false);
    });

    // Listen for new messages
    socket.on('new_message', (message) => {
      setUnreadMessages((prev) => prev + 1);
      // Dispatch custom event for components to listen
      window.dispatchEvent(new CustomEvent('socket:new_message', { detail: message }));
    });

    // Listen for new notifications
    socket.on('new_notification', (notification) => {
      setUnreadNotifications((prev) => prev + 1);
      // Dispatch custom event for components to listen
      window.dispatchEvent(new CustomEvent('socket:new_notification', { detail: notification }));
    });

    // Listen for message read events
    socket.on('messages_read', (data) => {
      window.dispatchEvent(new CustomEvent('socket:messages_read', { detail: data }));
    });

    // Listen for typing indicators
    socket.on('user_typing', (data) => {
      window.dispatchEvent(new CustomEvent('socket:user_typing', { detail: data }));
    });

    socket.on('user_stop_typing', (data) => {
      window.dispatchEvent(new CustomEvent('socket:user_stop_typing', { detail: data }));
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [autoConnect, isAuthenticated]);

  // Join a chat room
  const joinChat = useCallback((chatId: string) => {
    socketRef.current?.emit('join_chat', chatId);
  }, []);

  // Leave a chat room
  const leaveChat = useCallback((chatId: string) => {
    socketRef.current?.emit('leave_chat', chatId);
  }, []);

  // Send typing indicator
  const sendTyping = useCallback((receiverId: string) => {
    socketRef.current?.emit('typing', { receiverId });
  }, []);

  // Send stop typing indicator
  const sendStopTyping = useCallback((receiverId: string) => {
    socketRef.current?.emit('stop_typing', { receiverId });
  }, []);

  // Reset unread counts
  const resetUnreadMessages = useCallback(() => {
    setUnreadMessages(0);
  }, []);

  const resetUnreadNotifications = useCallback(() => {
    setUnreadNotifications(0);
  }, []);

  // Manually emit an event
  const emit = useCallback((event: string, data: unknown) => {
    socketRef.current?.emit(event, data);
  }, []);

  // Subscribe to a custom event
  const on = useCallback((event: string, callback: (data: unknown) => void) => {
    socketRef.current?.on(event, callback);
    return () => {
      socketRef.current?.off(event, callback);
    };
  }, []);

  return {
    socket: socketRef.current,
    isConnected,
    unreadMessages,
    unreadNotifications,
    joinChat,
    leaveChat,
    sendTyping,
    sendStopTyping,
    resetUnreadMessages,
    resetUnreadNotifications,
    emit,
    on,
  };
}

// Hook for listening to socket events in components
export function useSocketEvent<T = unknown>(
  eventName: string,
  callback: (data: T) => void
) {
  useEffect(() => {
    const handler = (event: CustomEvent<T>) => {
      callback(event.detail);
    };

    window.addEventListener(eventName as keyof WindowEventMap, handler as EventListener);
    
    return () => {
      window.removeEventListener(eventName as keyof WindowEventMap, handler as EventListener);
    };
  }, [eventName, callback]);
}
