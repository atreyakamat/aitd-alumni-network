import crypto from 'crypto';
import { z } from 'zod';
import { NotificationType } from '@prisma/client';

/**
 * The events that travel through Kafka (or are handled in-process when there is no broker). Every event is a small JSON
 * envelope with a stable id; the data is validated both when it is published and when it is consumed, so a malformed message
 * can neither be sent nor poison the consumer (it goes to the dead-letter topic).
 */
export const NOTIFICATION_EVENT_TYPES = [
  'notification.deliver', // one in-app notification for one member
  'notification.broadcast', // an in-app notification for every active member
  'registration.submitted', // a registration is ready for the college administrator: tell them (in the app and by e-mail)
  'registration.received', // e-mail to the applicant: we received your registration
  'registration.approved', // e-mail to the applicant: you can sign in
  'registration.rejected', // e-mail to the applicant: not approved, and why
] as const;
export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

const notificationType = z.nativeEnum(NotificationType);

const deliverData = z.object({
  userId: z.string().min(1),
  type: notificationType,
  title: z.string(),
  message: z.string(),
  link: z.string().nullish(),
  metadata: z.record(z.unknown()).nullish(),
});

const broadcastData = z.object({
  type: notificationType,
  title: z.string(),
  message: z.string(),
  link: z.string().nullish(),
  metadata: z.record(z.unknown()).nullish(),
  excludeUserId: z.string().optional(),
});

const applicantData = z.object({ applicantId: z.string().min(1) });
const userData = z.object({ userId: z.string().min(1) });
const rejectedData = z.object({ userId: z.string().min(1), reason: z.string().min(1).max(1000) });

export const EVENT_DATA_SCHEMAS = {
  'notification.deliver': deliverData,
  'notification.broadcast': broadcastData,
  'registration.submitted': applicantData,
  'registration.received': userData,
  'registration.approved': userData,
  'registration.rejected': rejectedData,
} as const;

export type NotificationEventData<T extends NotificationEventType> = z.input<(typeof EVENT_DATA_SCHEMAS)[T]>;

export interface NotificationEnvelope<T extends NotificationEventType = NotificationEventType> {
  id: string;
  type: T;
  version: 1;
  occurredAt: string;
  data: unknown;
}

export class EventValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventValidationError';
  }
}

const describe = (error: z.ZodError) =>
  error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join('.') || 'data'}: ${issue.message}`)
    .join('; ');

/** Validates the data for its type and returns the parsed value. */
export const parseEventData = <T extends NotificationEventType>(type: T, data: unknown): z.output<(typeof EVENT_DATA_SCHEMAS)[T]> => {
  const schema = EVENT_DATA_SCHEMAS[type];
  if (!schema) throw new EventValidationError(`Unknown event type "${String(type)}"`);
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new EventValidationError(`Invalid ${type} event: ${describe(parsed.error)}`);
  return parsed.data as z.output<(typeof EVENT_DATA_SCHEMAS)[T]>;
};

export const buildEnvelope = <T extends NotificationEventType>(type: T, data: NotificationEventData<T>): NotificationEnvelope<T> => ({
  id: crypto.randomUUID(),
  type,
  version: 1,
  occurredAt: new Date().toISOString(),
  data: parseEventData(type, data),
});

const envelopeShape = z.object({
  id: z.string().min(8).max(100),
  type: z.string(),
  version: z.literal(1),
  occurredAt: z.string(),
  data: z.unknown(),
});

/** Turns whatever came off the topic into a valid envelope, or throws EventValidationError. */
export const parseEnvelope = (raw: unknown): NotificationEnvelope => {
  const shape = envelopeShape.safeParse(raw);
  if (!shape.success) throw new EventValidationError(`Invalid event envelope: ${describe(shape.error)}`);
  const { type } = shape.data;
  if (!(NOTIFICATION_EVENT_TYPES as readonly string[]).includes(type)) {
    throw new EventValidationError(`Unknown event type "${type.slice(0, 60)}"`);
  }
  const eventType = type as NotificationEventType;
  return { ...shape.data, type: eventType, version: 1, data: parseEventData(eventType, shape.data.data) } as NotificationEnvelope;
};

/** Events with the same key go to the same partition and so are handled in order: one member's events stay in sequence. */
export const defaultKey = (envelope: NotificationEnvelope): string => {
  const data = envelope.data as { userId?: string; applicantId?: string };
  return data.userId ?? data.applicantId ?? envelope.id;
};
