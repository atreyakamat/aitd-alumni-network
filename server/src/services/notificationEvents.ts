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

/**
 * A notification link is a path on this site (the server builds them with `clientLinks`), never a URL: the client opens it on click,
 * so an external address, a `javascript:` URI or a protocol-relative `//host` in an event would be a phishing or script link inside
 * the member's own notification list. Checked where an event is built and again where it is consumed (a forged message on the topic).
 */
export const MAX_LINK_LENGTH = 500;
// eslint-disable-next-line no-control-regex
const SITE_PATH = /^\/(?![/\\])[^\\\s\u0000-\u001f\u007f]*$/;
export const isSitePath = (value: string): boolean => value.length <= MAX_LINK_LENGTH && SITE_PATH.test(value);
const sitePath = z.string().refine(isSitePath, 'link must be a path on this site, such as /posts/123');

/** Bounds on what an event may carry, so one message cannot be a megabyte-sized row in every member's list. */
export const MAX_TITLE_LENGTH = 300;
export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_METADATA_BYTES = 8 * 1024;
const metadata = z
  .record(z.unknown())
  .refine((value) => JSON.stringify(value).length <= MAX_METADATA_BYTES, `metadata must be at most ${MAX_METADATA_BYTES} bytes`);

const deliverData = z.object({
  userId: z.string().min(1).max(100),
  type: notificationType,
  title: z.string().max(MAX_TITLE_LENGTH),
  message: z.string().max(MAX_MESSAGE_LENGTH),
  link: sitePath.nullish(),
  metadata: metadata.nullish(),
  // Delivered even if the member switched that category off (a payment problem reported to an administrator, for example)
  essential: z.boolean().optional(),
});

const broadcastData = z.object({
  type: notificationType,
  title: z.string().max(MAX_TITLE_LENGTH),
  message: z.string().max(MAX_MESSAGE_LENGTH),
  link: sitePath.nullish(),
  metadata: metadata.nullish(),
  excludeUserId: z.string().max(100).optional(),
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
