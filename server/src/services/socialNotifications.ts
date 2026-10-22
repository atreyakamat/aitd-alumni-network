/**
 * Social notifications with the contract's dedupe rules: nobody is notified about their own
 * action, and one action notifies each person at most once (the first matching entry wins).
 */
import { NotificationType, ReactionType } from '@prisma/client';
import prisma from '../config/database';
import { notificationService } from './notificationService';

export interface SocialNotice {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link: string;
  metadata?: Record<string, unknown>;
}

export async function notifyOnce(actorId: string, notices: SocialNotice[]): Promise<number> {
  const sent = new Set<string>([actorId]);
  let count = 0;
  for (const notice of notices) {
    if (!notice.userId || sent.has(notice.userId)) continue;
    sent.add(notice.userId);
    await notificationService.createNotification(notice);
    count++;
  }
  return count;
}

export async function actorName(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
  return user?.fullName ?? 'Someone';
}

const REACTION_PHRASES: Record<ReactionType, (target: string) => string> = {
  LIKE: (t) => `liked your ${t}`,
  CELEBRATE: (t) => `celebrated your ${t}`,
  SUPPORT: (t) => `supports your ${t}`,
  LOVE: (t) => `loved your ${t}`,
  INSIGHTFUL: (t) => `found your ${t} insightful`,
  FUNNY: (t) => `found your ${t} funny`,
};

/** "Asha celebrated your post", "Asha found your comment insightful". */
export const reactionMessage = (name: string, type: ReactionType, target: 'post' | 'comment') =>
  `${name} ${REACTION_PHRASES[type](target)}`;
