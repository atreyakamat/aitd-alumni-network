/**
 * Social notifications with the contract's dedupe rules: nobody is notified about their own
 * action, and one action notifies each person at most once (the first matching entry wins).
 *
 * A notice can also ask not to repeat itself over time (`dedupeBy`): follow -> unfollow -> follow, reacting again after taking a
 * reaction back, or sending a connection request again after it was declined would otherwise tell the other person every
 * single time. Only the notification is skipped; the action itself always goes through.
 *
 * The cooldown is per (recipient, type, the `dedupeBy` values), which is "per actor and subject" because those values name the
 * actor and what the notice is about. The default window is a day; chatty things (comments, messages) pass a shorter `windowMs`.
 * Two layers: the database lookup (survives restarts, shared by every process) and an in-process reservation made synchronously
 * before the first await, so a burst of parallel requests, or a Kafka consumer that has not stored the row yet, cannot all
 * pass the lookup together.
 */
import { NotificationType, ReactionType } from '@prisma/client';
import prisma from '../config/database';
import { log } from '../utils/logger';
import { notificationService } from './notificationService';
import { claimCooldown, releaseCooldown, resetCooldowns } from '../utils/cooldownStore';

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
  /** Cooldown for this notice (default NOTIFICATION_DEDUPE_WINDOW_MS). Only used together with `dedupeBy`. */
  windowMs?: number;
}

const reservationKey = (notice: SocialNotice, values: unknown[]) => JSON.stringify([notice.userId, notice.type, values]);

/** Test helper: forget every in-process reservation. */
export const resetNotificationCooldowns = resetCooldowns;

/** True when the recipient already has an equal notification inside the window. A failing lookup counts as "no". */
async function hasRecentEqualNotice(notice: SocialNotice, values: unknown[], windowMs: number): Promise<boolean> {
  const keys = notice.dedupeBy ?? [];
  try {
    const earlier = await prisma.notification.findFirst({
      where: {
        userId: notice.userId,
        type: notice.type,
        createdAt: { gte: new Date(Date.now() - windowMs) },
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

    const keys = notice.dedupeBy ?? [];
    const values = keys.map((key) => notice.metadata?.[key]);
    // Without a value for every key there is nothing reliable to compare: send it
    const comparable = keys.length > 0 && !values.some((value) => value === undefined || value === null);
    const windowMs = notice.windowMs ?? NOTIFICATION_DEDUPE_WINDOW_MS;
    const key = comparable ? reservationKey(notice, values) : null;
    if (key && !claimCooldown(key, windowMs)) continue;
    if (key && (await hasRecentEqualNotice(notice, values, windowMs))) continue;

    const { dedupeBy: _dedupeBy, windowMs: _windowMs, ...payload } = notice; // eslint-disable-line @typescript-eslint/no-unused-vars
    try {
      await notificationService.createNotification(payload);
    } catch (err) {
      // Nothing was sent, so the next attempt must not be suppressed
      if (key) releaseCooldown(key);
      throw err;
    }
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
