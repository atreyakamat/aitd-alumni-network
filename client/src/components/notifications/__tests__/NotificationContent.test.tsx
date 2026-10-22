import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Bell, HandHeart, Repeat2, UserPlus } from 'lucide-react';
import { NotificationContent, notificationVisual } from '@/components/notifications/NotificationContent';
import type { Notification } from '@/types';

const base: Notification = {
  id: 'n1',
  userId: 'me',
  type: 'POST_REACTED',
  title: 'New reaction',
  message: 'Asha supported your post',
  link: '/posts/p1',
  isRead: false,
  createdAt: '2026-10-19T10:00:00.000Z',
};

describe('notificationVisual', () => {
  it('uses the reaction’s own icon for reactions', () => {
    expect(notificationVisual({ type: 'POST_REACTED', metadata: { reaction: 'SUPPORT' } }).icon).toBe(HandHeart);
  });

  it('maps the new social types', () => {
    expect(notificationVisual({ type: 'POST_REPOSTED' }).icon).toBe(Repeat2);
    expect(notificationVisual({ type: 'NEW_FOLLOWER' }).icon).toBe(UserPlus);
  });

  it('falls back to a bell for unknown types', () => {
    expect(notificationVisual({ type: 'SOMETHING_NEW' as any }).icon).toBe(Bell);
  });
});

describe('NotificationContent', () => {
  it('renders title, message and an unread marker for screen readers', () => {
    render(<NotificationContent notification={base} />);
    expect(screen.getByText('New reaction')).toBeInTheDocument();
    expect(screen.getByText('Asha supported your post')).toBeInTheDocument();
    expect(screen.getByText('(unread)')).toBeInTheDocument();
  });
});
