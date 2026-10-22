'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '@/context/auth-context';

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') || 'http://localhost:5000';

// socket.io does not retry after the server closes the socket or rejects the
// handshake (e.g. tokens revoked by a password change), so we do, with backoff.
const MAX_MANUAL_RETRIES = 5;
const retryDelay = (attempt: number) => Math.min(1000 * 2 ** attempt, 16000);

interface UseSocketOptions {
  autoConnect?: boolean;
}

export function useSocket(options: UseSocketOptions = {}) {
  const { autoConnect = true } = options;
  const { isAuthenticated } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);

  // Initialize socket connection
  useEffect(() => {
    if (!autoConnect || !isAuthenticated) return;

    if (!localStorage.getItem('accessToken')) return;

    const socket = io(SOCKET_URL, {
      // Called before every (re)connection attempt, so a rotated token is always used
      auth: (cb) => cb({ token: localStorage.getItem('accessToken') }),
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    let retries = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleRetry = () => {
      if (retryTimer || retries >= MAX_MANUAL_RETRIES) return;
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        // Signed out meanwhile: nothing to reconnect with
        if (!localStorage.getItem('accessToken')) return;
        retries += 1;
        socket.connect();
      }, retryDelay(retries));
    };

    socket.on('connect', () => {
      retries = 0;
      setIsConnected(true);
    });

    socket.on('disconnect', (reason) => {
      setIsConnected(false);
      if (reason === 'io server disconnect') scheduleRetry();
    });

    socket.on('connect_error', (error) => {
      console.error('Socket connection error:', error.message);
      setIsConnected(false);
      // A rejected handshake is not retried by socket.io; the access token may
      // simply be mid-rotation, so try again shortly with whatever is stored then
      if (!socket.active) scheduleRetry();
    });

    // Listen for new messages
    socket.on('new_message', (message) => {
      setUnreadMessages((prev) => prev + 1);
      // Dispatch custom event for components to listen
      window.dispatchEvent(new CustomEvent('socket:new_message', { detail: message }));
    });

    // New notifications: re-broadcast only. NotificationBell refetches the unread
    // count from the server on this event, so no client-side counter is kept.
    socket.on('new_notification', (notification) => {
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
      clearTimeout(retryTimer);
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

  // Reset unread message count
  const resetUnreadMessages = useCallback(() => {
    setUnreadMessages(0);
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
    joinChat,
    leaveChat,
    sendTyping,
    sendStopTyping,
    resetUnreadMessages,
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
