import { getProducer, readKafkaSettings, type KafkaSettings } from '../config/kafka';
import { log } from '../utils/logger';
import { handleNotificationEvent } from './notificationEventHandlers';
import {
  buildEnvelope,
  defaultKey,
  type NotificationEnvelope,
  type NotificationEventData,
  type NotificationEventType,
} from './notificationEvents';

/**
 * Publishes notification events.
 *
 * With KAFKA_BROKERS the event is sent to the notifications topic and a consumer delivers it. Without a broker (development,
 * tests) or when the broker cannot be reached, it is delivered in-process by the same handlers, so a notification is never
 * lost because Kafka is down.
 *
 * An in-app notification is delivered before the call returns when it runs in-process (the caller sees a database error, as
 * it did when the row was written directly). An e-mail event never makes the request wait for the mail server: in-process it
 * is handled right after the response, and a failure is logged.
 */
const DEFERRED_IN_PROCESS: ReadonlySet<NotificationEventType> = new Set<NotificationEventType>([
  'registration.submitted',
  'registration.received',
  'registration.approved',
  'registration.rejected',
]);

const send = async (envelope: NotificationEnvelope, settings: KafkaSettings, key?: string) => {
  const producer = await getProducer();
  await producer.send({
    topic: settings.topic,
    acks: -1,
    messages: [
      {
        key: key ?? defaultKey(envelope),
        value: JSON.stringify(envelope),
        headers: { type: envelope.type, 'event-id': envelope.id, version: String(envelope.version) },
      },
    ],
  });
};

const deliverInProcess = (envelope: NotificationEnvelope): Promise<unknown> => {
  if (!DEFERRED_IN_PROCESS.has(envelope.type)) return handleNotificationEvent(envelope);
  const timer = setImmediate(() => {
    handleNotificationEvent(envelope).catch((error: unknown) =>
      log.error('Delivering a notification event in-process failed', { eventId: envelope.id, type: envelope.type, err: error })
    );
  });
  timer.unref?.();
  return Promise.resolve(undefined);
};

export async function publishNotificationEvent<T extends NotificationEventType>(
  type: T,
  data: NotificationEventData<T>,
  options: { key?: string } = {}
): Promise<unknown> {
  const envelope = buildEnvelope(type, data);
  const settings = readKafkaSettings();

  if (settings.enabled) {
    try {
      await send(envelope, settings, options.key);
      return undefined;
    } catch (error) {
      log.error('Kafka publish failed; delivering in-process', { eventId: envelope.id, type, err: error });
    }
  }
  return deliverInProcess(envelope);
}
