const kafkaSettings = { enabled: false, topic: 'aitd.notifications' };
const send = jest.fn();

jest.mock('../../config/kafka', () => ({
  readKafkaSettings: () => kafkaSettings,
  getProducer: jest.fn(async () => ({ send })),
}));
jest.mock('../../services/notificationEventHandlers', () => ({ handleNotificationEvent: jest.fn() }));

import { publishNotificationEvent } from '../../services/notificationBus';
import { handleNotificationEvent } from '../../services/notificationEventHandlers';
import { getProducer } from '../../config/kafka';
import { EventValidationError } from '../../services/notificationEvents';
import { log } from '../../utils/logger';

const handle = handleNotificationEvent as jest.Mock;
const deliver = { userId: 'u1', type: 'POST_LIKED' as const, title: 't', message: 'm' };
const tick = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  jest.clearAllMocks();
  kafkaSettings.enabled = false;
  send.mockResolvedValue(undefined);
  jest.spyOn(log, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('without Kafka (development, tests)', () => {
  it('delivers an in-app notification in-process and returns what was stored', async () => {
    handle.mockResolvedValue({ id: 'n1' });
    await expect(publishNotificationEvent('notification.deliver', deliver)).resolves.toEqual({ id: 'n1' });
    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ type: 'notification.deliver', version: 1 }));
    expect(send).not.toHaveBeenCalled();
  });

  it('passes a failure of an in-app delivery on to the caller (as the direct database write did)', async () => {
    handle.mockRejectedValue(new Error('db down'));
    await expect(publishNotificationEvent('notification.deliver', deliver)).rejects.toThrow('db down');
  });

  it('does not make the request wait for an e-mail: registration events are handled right after', async () => {
    let finished = false;
    handle.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      finished = true;
    });
    await publishNotificationEvent('registration.approved', { userId: 'u1' });
    expect(finished).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ type: 'registration.approved' }));
    expect(finished).toBe(true);
  });

  it('logs, and does not throw, when an e-mail event fails after the request has been answered', async () => {
    handle.mockRejectedValue(new Error('smtp down'));
    await expect(publishNotificationEvent('registration.rejected', { userId: 'u1', reason: 'No' })).resolves.toBeUndefined();
    await tick();
    expect(log.error).toHaveBeenCalledWith(expect.stringMatching(/in-process/i), expect.objectContaining({ type: 'registration.rejected' }));
  });
});

describe('with Kafka', () => {
  beforeEach(() => {
    kafkaSettings.enabled = true;
  });

  it('publishes a JSON envelope to the notifications topic, keyed by the member, with every replica acknowledging', async () => {
    await expect(publishNotificationEvent('notification.deliver', deliver)).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
    const record = send.mock.calls[0][0];
    expect(record.topic).toBe('aitd.notifications');
    expect(record.acks).toBe(-1);
    const [message] = record.messages;
    expect(message.key).toBe('u1');
    const envelope = JSON.parse(message.value);
    expect(envelope).toMatchObject({ type: 'notification.deliver', version: 1, data: { userId: 'u1', title: 't' } });
    expect(envelope.id).toEqual(expect.any(String));
    expect(message.headers).toMatchObject({ type: 'notification.deliver', 'event-id': envelope.id });
    expect(handle).not.toHaveBeenCalled();
  });

  it('keys a registration event by the applicant so one person\'s events stay in order', async () => {
    await publishNotificationEvent('registration.submitted', { applicantId: 'app1' });
    expect(send.mock.calls[0][0].messages[0].key).toBe('app1');
  });

  it('accepts an explicit key', async () => {
    await publishNotificationEvent('notification.broadcast', { type: 'ADMIN_ANNOUNCEMENT', title: 't', message: 'm' }, { key: 'broadcast' });
    expect(send.mock.calls[0][0].messages[0].key).toBe('broadcast');
  });

  it('falls back to in-process delivery when the broker cannot be reached, so nothing is lost', async () => {
    send.mockRejectedValue(new Error('broker unreachable'));
    handle.mockResolvedValue({ id: 'n-inline' });
    await expect(publishNotificationEvent('notification.deliver', deliver)).resolves.toEqual({ id: 'n-inline' });
    expect(log.error).toHaveBeenCalledWith(expect.stringMatching(/Kafka publish failed/i), expect.objectContaining({ type: 'notification.deliver' }));
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it('falls back when the producer cannot even connect', async () => {
    (getProducer as jest.Mock).mockRejectedValueOnce(new Error('ECONNREFUSED'));
    handle.mockResolvedValue({ id: 'n-inline' });
    await expect(publishNotificationEvent('notification.deliver', deliver)).resolves.toEqual({ id: 'n-inline' });
  });

  it('reports a failure only when the fallback fails as well', async () => {
    send.mockRejectedValue(new Error('broker unreachable'));
    handle.mockRejectedValue(new Error('db down'));
    await expect(publishNotificationEvent('notification.deliver', deliver)).rejects.toThrow('db down');
  });
});

describe('validation', () => {
  it.each([
    ['notification.deliver', { userId: '', type: 'POST_LIKED', title: 't', message: 'm' }],
    ['notification.deliver', { userId: 'u1', type: 'NOT_A_TYPE', title: 't', message: 'm' }],
    ['registration.submitted', {}],
    ['registration.rejected', { userId: 'u1' }],
  ])('refuses invalid %s data before anything is sent or handled', async (type, data) => {
    kafkaSettings.enabled = true;
    await expect(publishNotificationEvent(type as never, data as never)).rejects.toBeInstanceOf(EventValidationError);
    expect(send).not.toHaveBeenCalled();
    expect(handle).not.toHaveBeenCalled();
  });
});
