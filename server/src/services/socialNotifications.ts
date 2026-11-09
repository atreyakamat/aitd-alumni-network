/**
 * Social notifications with the contract's dedupe rules: nobody is notified about their own
 * action, and one action notifies each person at most once (the first matching entry wins).
 *
 * A notice can also ask not to repeat itself over time (`dedupeBy`): follow -> unfollow -> follow, reacting again after taking a
 * reaction back, or sending a connection request again after it was declined would otherwise tell the other person every
 * single time. Only the notification is skipped; the action itself always goes through.
 */
import { NotificationType, ReactionType } from '@prisma/client';
import prisma from '../config/database';
import { log } from '../utils/logger';
import { notificationService } from './notificationService';

/** An equal notification (same recipient, type, actor and entity) younger than this suppresses a new one. */
export const NOTIFICATION_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface SocialNotice {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link: string;
  metadata?: Record<string, unknown>;
  /**
   * Names of `metadata` keys that identify "the same notice again": normally the actor and the entity the notice is about
   * (e.g. `['postId', 'reactorId']`). When the recipient already has a notification of this type whose metadata holds the
   * same values, created within NOTIFICATION_DEDUPE_WINDOW_MS, no new one is made.
   */
  dedupeBy?: string[];
}

/** True when the recipient already has an equal notification inside the window. A failing lookup counts as "no". */
async function hasRecentEqualNotice(notice: SocialNotice): Promise<boolean> {
  const keys = notice.dedupeBy ?? [];
  if (keys.length === 0) return false;
  const values = keys.map((key) => notice.metadata?.[key]);
  // Without a value for every key there is nothing reliable to compare
  if (values.some((value) => value === undefined || value === null)) return false;
  try {
    const earlier = await prisma.notification.findFirst({
      where: {
        userId: notice.userId,
        type: notice.type,
        createdAt: { gte: new Date(Date.now() - NOTIFICATION_DEDUPE_WINDOW_MS) },
        AND: keys.map((key, index) => ({ metadata: { path: [key], equals: values[index] as string } })),
      },
      select: { id: true },
    });
    return !!earlier;
  } catch (err) {
    log.warn('Could not check for an earlier equal notification; sending it', { type: notice.type, err });
    return false;
  }
}

export async function notifyOnce(actorId: string, notices: SocialNotice[]): Promise<number> {
  const sent = new Set<string>([actorId]);
  let count = 0;
  for (const notice of notices) {
    if (!notice.userId || sent.has(notice.userId)) continue;
    // Marked first: a duplicate skipped below must not let a later notice for the same person through
    sent.add(notice.userId);
    if (await hasRecentEqualNotice(notice)) continue;
    const { dedupeBy: _dedupeBy, ...payload } = notice; // eslint-disable-line @typescript-eslint/no-unused-vars
    await notificationService.createNotification(payload);
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
