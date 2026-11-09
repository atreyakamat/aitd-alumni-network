/**
 * In-app notifications and broadcasts travel through the notification bus (Kafka when brokers are configured), and the
 * services keep working exactly as before when they are not.
 */
const publish = jest.fn();
const settings = { enabled: false };

jest.mock('../../services/notificationBus', () => ({ publishNotificationEvent: (...args: unknown[]) => publish(...args) }));
jest.mock('../../config/kafka', () => ({ readKafkaSettings: () => settings }));
jest.mock('../../config/queue', () => ({ notificationQueue: null, BROADCAST_JOB: 'broadcast' }));
jest.mock('../../services/notificationEventHandlers', () => ({ handleNotificationEvent: jest.fn() }));

import { notificationService } from '../../services/notificationService';
import { broadcastNotification } from '../../services/broadcastService';
import { prismaMock } from '../../../tests/helpers';

beforeEach(() => {
  jest.clearAllMocks();
  settings.enabled = false;
  publish.mockResolvedValue({ id: 'n1' });
});

describe('notificationService.createNotification', () => {
  const input = { userId: 'u1', type: 'POST_LIKED' as const, title: 'Liked', message: 'Ada liked your post', link: '/posts/1', metadata: { postId: 'p1' } };

  it('hands the notification to the bus instead of writing the row itself', async () => {
    await expect(notificationService.createNotification(input)).resolves.toEqual({ id: 'n1' });
    expect(publish).toHaveBeenCalledWith('notification.deliver', { userId: 'u1', type: 'POST_LIKED', title: 'Liked', message: 'Ada liked your post', link: '/posts/1', metadata: { postId: 'p1' } });
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });

  it('answers undefined when the notification is stored later by the consumer (Kafka)', async () => {
    publish.mockResolvedValue(undefined);
    await expect(notificationService.createNotification(input)).resolves.toBeUndefined();
  });

  it('passes a delivery error on to the caller', async () => {
    publish.mockRejectedValue(new Error('db down'));
    await expect(notificationService.createNotification(input)).rejects.toThrow('db down');
  });
});

describe('broadcastNotification', () => {
  const payload = { type: 'ADMIN_ANNOUNCEMENT' as const, title: 'Reunion', message: 'Join us' };

  it('goes through Kafka when brokers are configured', async () => {
    settings.enabled = true;
    await broadcastNotification(payload);
    expect(publish).toHaveBeenCalledWith('notification.broadcast', payload, { key: 'broadcast' });
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });

  it('keeps the previous behaviour without Kafka (inline fan-out when there is no Redis queue either)', async () => {
    prismaMock.user.findMany.mockResolvedValue([]);
    await broadcastNotification(payload);
    expect(publish).not.toHaveBeenCalled();
    expect(prismaMock.user.findMany).toHaveBeenCalled();
  });
});
