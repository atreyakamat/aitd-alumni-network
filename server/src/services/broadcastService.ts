import prisma from '../config/database';
import { NotificationType } from '@prisma/client';
import { emitToUser } from '../utils/socket';
import { notificationQueue, BROADCAST_JOB } from '../config/queue';

export interface BroadcastPayload {
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  metadata?: Record<string, unknown>;
  /** Exclude one user (e.g. the admin who triggered it) from the broadcast. */
  excludeUserId?: string;
}

const FAN_OUT_BATCH = 1000;

/**
 * Insert a notification for every active member, in id-ordered batches, emitting a
 * realtime event to each. Written to be safe for tens of thousands of users without
 * loading them all into memory. Called by the BullMQ worker, or inline when no queue.
 */
export async function fanOutNotification(payload: BroadcastPayload): Promise<number> {
  let cursor: string | undefined;
  let delivered = 0;

  for (;;) {
    const users = await prisma.user.findMany({
      where: { isActive: true, ...(payload.excludeUserId ? { id: { not: payload.excludeUserId } } : {}) },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: FAN_OUT_BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (users.length === 0) break;

    await prisma.notification.createMany({
      data: users.map((u) => ({
        userId: u.id,
        type: payload.type,
        title: payload.title,
        message: payload.message,
        link: payload.link,
        metadata: payload.metadata as object | undefined,
      })),
    });

    // Realtime nudge to anyone currently connected; a socket failure must not stop the fan-out.
    for (const u of users) {
      try {
        emitToUser(u.id, 'new_notification', {
          type: payload.type,
          title: payload.title,
          message: payload.message,
          link: payload.link,
        });
      } catch {
        /* ignore per-user socket errors */
      }
    }

    delivered += users.length;
    if (users.length < FAN_OUT_BATCH) break;
    cursor = users[users.length - 1].id;
  }

  return delivered;
}

/**
 * Enqueue a broadcast for background processing when the queue is available;
 * otherwise run the fan-out inline so the feature still works without Redis.
 */
export async function broadcastNotification(payload: BroadcastPayload): Promise<void> {
  if (notificationQueue) {
    await notificationQueue.add(BROADCAST_JOB, payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: 100,
    });
    return;
  }
  await fanOutNotification(payload);
}
