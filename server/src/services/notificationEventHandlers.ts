import type { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { emitToUser } from '../utils/socket';
import { log } from '../utils/logger';
import {
  sendNewRegistrationEmail,
  sendApplicationReceivedEmail,
  sendWelcomeEmail,
  sendRejectionEmail,
} from '../utils/email';
import { fanOutNotification, type BroadcastPayload } from './broadcastService';
import { normalizeEmail } from './inviteService';
import { clientLinks } from '../utils/clientLinks';
import { parseEventData, EventValidationError, type NotificationEnvelope } from './notificationEvents';

/**
 * What happens when an event is delivered. The same handlers run in the Kafka consumer and, without a broker,
 * in-process, so the behaviour does not depend on how the event travelled.
 *
 * `redelivery: true` means the event came through Kafka, which is at-least-once: the handlers then guard against doing
 * the same thing twice (the event id is stored in the notification, a broadcast is marked once it has started).
 */
export interface HandleOptions {
  redelivery?: boolean;
}

/** The college administrator accounts that are told about a registration (bounded: a college has a handful). */
const MAX_ADMINS_NOTIFIED = 200;

type DeliverData = ReturnType<typeof parseEventData<'notification.deliver'>>;

const emit = (userId: string, notification: unknown) => {
  // A socket failure must not undo the stored notification
  try {
    emitToUser(userId, 'new_notification', notification);
  } catch (error) {
    log.warn('Failed to emit notification', { userId, err: error });
  }
};

/** Stores one in-app notification and nudges the member if they are online. */
export const persistNotification = async (data: DeliverData, eventId?: string) => {
  const marked = eventId !== undefined;
  if (marked) {
    const existing = await prisma.notification.findFirst({
      where: { userId: data.userId, metadata: { path: ['eventId'], equals: eventId } },
      select: { id: true },
    });
    if (existing) {
      log.debug('Notification already stored; skipping the redelivered event', { eventId });
      return undefined;
    }
  }
  const notification = await prisma.notification.create({
    data: {
      userId: data.userId,
      type: data.type,
      title: data.title,
      message: data.message,
      link: data.link ?? undefined,
      metadata: (marked ? { ...(data.metadata ?? {}), eventId } : (data.metadata ?? undefined)) as Prisma.InputJsonValue | undefined,
    },
  });
  emit(data.userId, notification);
  return notification;
};

const deliver = (envelope: NotificationEnvelope, options: HandleOptions) =>
  persistNotification(parseEventData('notification.deliver', envelope.data), options.redelivery ? envelope.id : undefined);

const broadcast = async (envelope: NotificationEnvelope, options: HandleOptions) => {
  const data = parseEventData('notification.broadcast', envelope.data);
  const payload = { ...data, link: data.link ?? undefined, metadata: (data.metadata ?? undefined) as Record<string, unknown> | undefined } as BroadcastPayload;
  if (!options.redelivery) return fanOutNotification(payload);

  // Sent to every member in batches: a second run would notify everybody twice. A marker on the first batch tells a
  // redelivered event that the work has started.
  const started = await prisma.notification.findFirst({
    where: { metadata: { path: ['broadcastId'], equals: envelope.id } },
    select: { id: true },
  });
  if (started) {
    log.warn('Broadcast already started; skipping the redelivered event', { eventId: envelope.id });
    return undefined;
  }
  return fanOutNotification({ ...payload, metadata: { ...(payload.metadata ?? {}), broadcastId: envelope.id } } as BroadcastPayload);
};

/** Extra recipients (for example the alumni office mailbox) from APPROVAL_NOTIFY_EMAIL, comma separated. */
const sharedMailboxes = (): string[] => {
  const seen = new Set<string>();
  for (const raw of (process.env.APPROVAL_NOTIFY_EMAIL ?? '').split(',')) {
    const address = normalizeEmail(raw.trim());
    if (address) seen.add(address);
  }
  return [...seen];
};

const registrationSubmitted = async (envelope: NotificationEnvelope) => {
  const { applicantId } = parseEventData('registration.submitted', envelope.data);
  const applicant = await prisma.user.findUnique({
    where: { id: applicantId },
    select: { id: true, fullName: true, batchYear: true, department: true, approvalStatus: true },
  });
  // Gone, or an administrator has already decided: nothing to review
  if (!applicant || applicant.approvalStatus !== 'PENDING') return;

  const summary = { fullName: applicant.fullName, batchYear: applicant.batchYear, department: applicant.department };
  const admins = await prisma.user.findMany({
    where: { isActive: true, approvalStatus: 'APPROVED', userRole: { in: ['ADMIN', 'SUPER_ADMIN'] } },
    select: { id: true, email: true },
    orderBy: { createdAt: 'desc' },
    take: MAX_ADMINS_NOTIFIED,
  });

  let told = 0;
  for (const admin of admins) {
    const already = await prisma.notification.findFirst({
      where: { userId: admin.id, type: 'REGISTRATION_PENDING', metadata: { path: ['applicantId'], equals: applicantId } },
      select: { id: true },
    });
    if (already) continue;
    // The mail goes first: if it fails the event is retried and nothing is recorded. The other order would record the
    // notice, and the retry would then skip this administrator and the mail would never be sent.
    await sendNewRegistrationEmail(admin.email, summary);
    await persistNotification({
      userId: admin.id,
      type: 'REGISTRATION_PENDING',
      title: 'New registration to review',
      message: `${applicant.fullName} (batch ${applicant.batchYear}, ${applicant.department}) is waiting for approval.`,
      link: clientLinks.adminApprovals(),
      metadata: { applicantId },
    });
    told += 1;
  }

  // The shared mailbox only on the first processing: a retry after everybody was told must not mail the office again
  const adminAddresses = new Set(admins.map((admin) => admin.email.toLowerCase()));
  const mailboxes = sharedMailboxes().filter((address) => !adminAddresses.has(address));
  if (told > 0 || admins.length === 0) {
    for (const address of mailboxes) await sendNewRegistrationEmail(address, summary);
  }
  if (admins.length === 0 && mailboxes.length === 0) {
    log.warn('A registration is waiting but there is no administrator account or APPROVAL_NOTIFY_EMAIL to tell', { applicantId });
  }
};

const withApplicant = async (userId: string, send: (user: { email: string; fullName: string }) => Promise<void>) => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, fullName: true } });
  if (!user) {
    log.warn('Cannot notify a person who no longer exists', { userId });
    return;
  }
  await send(user);
};

/** Delivers one event. Throws when delivery failed, so the caller retries (and eventually dead-letters) it. */
export const handleNotificationEvent = async (envelope: NotificationEnvelope, options: HandleOptions = {}): Promise<unknown> => {
  switch (envelope.type) {
    case 'notification.deliver':
      return deliver(envelope, options);
    case 'notification.broadcast':
      return broadcast(envelope, options);
    case 'registration.submitted':
      return registrationSubmitted(envelope);
    case 'registration.received': {
      const { userId } = parseEventData('registration.received', envelope.data);
      return withApplicant(userId, (user) => sendApplicationReceivedEmail(user.email, user.fullName));
    }
    case 'registration.approved': {
      const { userId } = parseEventData('registration.approved', envelope.data);
      return withApplicant(userId, (user) => sendWelcomeEmail(user.email, user.fullName));
    }
    case 'registration.rejected': {
      const { userId, reason } = parseEventData('registration.rejected', envelope.data);
      return withApplicant(userId, (user) => sendRejectionEmail(user.email, user.fullName, reason));
    }
    default:
      throw new EventValidationError(`Unknown event type "${String((envelope as { type: unknown }).type)}"`);
  }
};
