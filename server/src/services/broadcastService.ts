import prisma from '../config/database';
import { NotificationType } from '@prisma/client';
import { emitToUser } from '../utils/socket';
import { notificationQueue, BROADCAST_JOB } from '../config/queue';
import { readKafkaSettings } from '../config/kafka';
import { notificationPreferenceService } from './notificationPreferenceService';

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
      // Members only: an applicant who is waiting for approval, or was turned down, is not part of the community
      where: { isActive: true, approvalStatus: 'APPROVED', ...(payload.excludeUserId ? { id: { not: payload.excludeUserId } } : {}) },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: FAN_OUT_BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (users.length === 0) break;

    // Members who switched this kind of notification off are left out (one query per batch; the cursor still moves past them)
    const optedOut = await notificationPreferenceService.optedOutUserIds(
      users.map((u) => u.id),
      payload.type,
      'inApp'
    );
    const recipients = users.filter((u) => !optedOut.has(u.id));

    if (recipients.length > 0) await prisma.notification.createMany({
      data: recipients.map((u) => ({
        userId: u.id,
        type: payload.type,
        title: payload.title,
        message: payload.message,
        link: payload.link,
        metadata: payload.metadata as object | undefined,
      })),
    });

    // Realtime nudge to anyone currently connected; a socket failure must not stop the fan-out.
    for (const u of recipients) {
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

    delivered += recipients.length;
    if (users.length < FAN_OUT_BATCH) break;
    cursor = users[users.length - 1].id;
  }

  return delivered;
}

/**
 * Send a broadcast through Kafka when brokers are configured; otherwise enqueue it for background processing when the queue
 * is available; otherwise run the fan-out inline so the feature still works without either.
 */
export async function broadcastNotification(payload: BroadcastPayload): Promise<void> {
  if (readKafkaSettings().enabled) {
    // Loaded here, not at the top: the bus's handlers call fanOutNotification from this module
    const { publishNotificationEvent } = await import('./notificationBus');
    await publishNotificationEvent('notification.broadcast', payload, { key: 'broadcast' });
    return;
  }
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
