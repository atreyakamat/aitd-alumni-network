'use client';

import {
  AtSign,
  Bell,
  Briefcase,
  CalendarDays,
  Flag,
  GraduationCap,
  Megaphone,
  MessageCircle,
  MessageSquare,
  Repeat2,
  Reply,
  ThumbsUp,
  UserCheck,
  UserPlus,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatNotificationTime } from '@/lib/notifications';
import { REACTIONS, isReactionType } from '@/lib/social';
import type { Notification } from '@/types';

interface Visual {
  icon: LucideIcon;
  className: string;
}

const VISUALS: Record<string, Visual> = {
  CONNECTION_REQUEST: { icon: UserPlus, className: 'bg-blue-100 text-blue-600' },
  CONNECTION_ACCEPTED: { icon: UserCheck, className: 'bg-green-100 text-green-600' },
  NEW_FOLLOWER: { icon: UserPlus, className: 'bg-indigo-100 text-indigo-600' },
  MESSAGE_RECEIVED: { icon: MessageSquare, className: 'bg-sky-100 text-sky-600' },
  POST_LIKED: { icon: ThumbsUp, className: 'bg-blue-100 text-blue-600' },
  POST_REACTED: { icon: ThumbsUp, className: 'bg-blue-100 text-blue-600' },
  COMMENT_REACTED: { icon: ThumbsUp, className: 'bg-blue-100 text-blue-600' },
  POST_COMMENTED: { icon: MessageCircle, className: 'bg-emerald-100 text-emerald-600' },
  COMMENT_REPLIED: { icon: Reply, className: 'bg-emerald-100 text-emerald-600' },
  POST_REPOSTED: { icon: Repeat2, className: 'bg-green-100 text-green-600' },
  MENTION: { icon: AtSign, className: 'bg-purple-100 text-purple-600' },
  CONTENT_REPORTED: { icon: Flag, className: 'bg-red-100 text-red-600' },
  EVENT_RSVP: { icon: CalendarDays, className: 'bg-orange-100 text-orange-600' },
  MEMBERSHIP_EXPIRY: { icon: Wallet, className: 'bg-amber-100 text-amber-600' },
  JOB_MATCH: { icon: Briefcase, className: 'bg-teal-100 text-teal-600' },
  ADMIN_ANNOUNCEMENT: { icon: Megaphone, className: 'bg-rose-100 text-rose-600' },
  MENTORSHIP_REQUEST: { icon: GraduationCap, className: 'bg-violet-100 text-violet-600' },
  MENTORSHIP_ACCEPTED: { icon: GraduationCap, className: 'bg-violet-100 text-violet-600' },
  MENTORSHIP_DECLINED: { icon: GraduationCap, className: 'bg-slate-100 text-slate-600' },
  MENTORSHIP_SESSION: { icon: GraduationCap, className: 'bg-violet-100 text-violet-600' },
};

/** Icon and tint for a notification; reactions use their own icon (Celebrate, Love, ...). */
export function notificationVisual(notification: Pick<Notification, 'type' | 'metadata'>): Visual {
  const reaction = notification.metadata?.reaction ?? notification.metadata?.reactionType;
  if ((notification.type === 'POST_REACTED' || notification.type === 'COMMENT_REACTED') && isReactionType(reaction)) {
    const r = REACTIONS[reaction];
    return { icon: r.icon, className: cn(r.bgClass, r.colorClass) };
  }
  return VISUALS[notification.type] ?? { icon: Bell, className: 'bg-muted text-muted-foreground' };
}

/** Icon, title, message, relative time and unread dot — shared by the bell dropdown and the page. */
export function NotificationContent({
  notification,
  compact = false,
}: {
  notification: Notification;
  compact?: boolean;
}) {
  const unread = !notification.isRead;
  const { icon: Icon, className } = notificationVisual(notification);
  return (
    <div className="flex min-w-0 flex-1 items-start gap-3">
      <span aria-hidden="true" className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', className)}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm', unread ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground')}>
          {notification.title}
          {unread && <span className="sr-only"> (unread)</span>}
        </p>
        <p className={cn('text-sm text-muted-foreground', compact && 'line-clamp-2')}>{notification.message}</p>
        <time dateTime={notification.createdAt} className="mt-1 block text-xs text-muted-foreground">
          {formatNotificationTime(notification.createdAt)}
        </time>
      </div>
      <span
        aria-hidden="true"
        className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', unread ? 'bg-primary' : 'bg-transparent')}
      />
    </div>
  );
}
