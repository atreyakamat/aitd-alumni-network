jest.mock('../../services/notificationService', () => ({
  notificationService: { createNotification: jest.fn().mockResolvedValue(undefined) },
}));

import { NOTIFICATION_DEDUPE_WINDOW_MS, actorName, notifyOnce, reactionMessage, resetNotificationCooldowns } from '../../services/socialNotifications';
import { notificationService } from '../../services/notificationService';
import { prismaMock } from '../../../tests/helpers';

const createNotification = notificationService.createNotification as jest.Mock;
const notice = (userId: string, type = 'MENTION') => ({ userId, type: type as any, title: 't', message: 'm', link: '/posts/p1' });

beforeEach(() => {
  createNotification.mockClear();
  resetNotificationCooldowns();
});

describe('notifyOnce', () => {
  it('never notifies the actor and notifies each person once (first entry wins)', async () => {
    const sent = await notifyOnce('actor', [
      notice('a', 'COMMENT_REPLIED'),
      notice('actor'),
      notice('a', 'POST_COMMENTED'),
      notice(''),
      notice('b'),
    ]);

    expect(sent).toBe(2);
    expect(createNotification.mock.calls.map((c) => [c[0].userId, c[0].type])).toEqual([
      ['a', 'COMMENT_REPLIED'],
      ['b', 'MENTION'],
    ]);
  });
});

describe('actorName', () => {
  it('uses the full name, falling back to "Someone"', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ fullName: 'Asha Rao' }).mockResolvedValueOnce(null);
    await expect(actorName('u1')).resolves.toBe('Asha Rao');
    await expect(actorName('u2')).resolves.toBe('Someone');
  });
});

describe('reactionMessage', () => {
  it.each([
    ['LIKE', 'post', 'Asha liked your post'],
    ['CELEBRATE', 'post', 'Asha celebrated your post'],
    ['SUPPORT', 'post', 'Asha supports your post'],
    ['LOVE', 'comment', 'Asha loved your comment'],
    ['INSIGHTFUL', 'post', 'Asha found your post insightful'],
    ['FUNNY', 'comment', 'Asha found your comment funny'],
  ])('%s on a %s reads naturally', (type, target, expected) => {
    expect(reactionMessage('Asha', type as any, target as any)).toBe(expected);
  });
});

describe('notifyOnce de-duplication (follow / react / connect loops)', () => {
  const equalNotice = (overrides: Record<string, unknown> = {}) => ({
    userId: 'them',
    type: 'NEW_FOLLOWER' as any,
    title: 'New follower',
    message: 'Asha started following you',
    link: '/profile/asha',
    metadata: { followerId: 'asha' },
    dedupeBy: ['followerId'],
    ...overrides,
  });

  it('skips a notice when the same person already got an equal one from the same actor within the window', async () => {
    prismaMock.notification.findFirst.mockResolvedValue({ id: 'n-earlier' });

    const sent = await notifyOnce('asha', [equalNotice()]);

    expect(sent).toBe(0);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('looks for the same recipient, type and entity, only inside the last 24 hours', async () => {
    prismaMock.notification.findFirst.mockResolvedValue(null);
    const before = Date.now();

    const sent = await notifyOnce('asha', [
      equalNotice({ metadata: { postId: 'p1', reactorId: 'asha' }, dedupeBy: ['postId', 'reactorId'], type: 'POST_REACTED' }),
    ]);

    expect(sent).toBe(1);
    const args = prismaMock.notification.findFirst.mock.calls[0][0];
    expect(args.where.userId).toBe('them');
    expect(args.where.type).toBe('POST_REACTED');
    expect(args.where.AND).toEqual([
      { metadata: { path: ['postId'], equals: 'p1' } },
      { metadata: { path: ['reactorId'], equals: 'asha' } },
    ]);
    const since = args.where.createdAt.gte.getTime();
    expect(NOTIFICATION_DEDUPE_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
    expect(since).toBeGreaterThanOrEqual(before - NOTIFICATION_DEDUPE_WINDOW_MS);
    expect(since).toBeLessThanOrEqual(Date.now() - NOTIFICATION_DEDUPE_WINDOW_MS);
  });

  it('creates the notification when there is no earlier equal one, without the dedupe instruction in it', async () => {
    prismaMock.notification.findFirst.mockResolvedValue(null);

    await notifyOnce('asha', [equalNotice()]);

    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(createNotification.mock.calls[0][0]).not.toHaveProperty('dedupeBy');
    expect(createNotification.mock.calls[0][0]).toMatchObject({ userId: 'them', type: 'NEW_FOLLOWER', metadata: { followerId: 'asha' } });
  });

  it('does not let a later notice for the same person through when the first was a duplicate', async () => {
    prismaMock.notification.findFirst.mockResolvedValue({ id: 'n-earlier' });

    const sent = await notifyOnce('asha', [equalNotice({ type: 'COMMENT_REPLIED' }), notice('them', 'POST_COMMENTED')]);

    expect(sent).toBe(0);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('checks each recipient on its own', async () => {
    prismaMock.notification.findFirst.mockImplementation(async (args: any) => (args.where.userId === 'a' ? { id: 'n' } : null));

    const sent = await notifyOnce('asha', [equalNotice({ userId: 'a' }), equalNotice({ userId: 'b' })]);

    expect(sent).toBe(1);
    expect(createNotification.mock.calls.map((c) => c[0].userId)).toEqual(['b']);
  });

  it('sends the notification anyway when the duplicate check itself fails', async () => {
    prismaMock.notification.findFirst.mockRejectedValue(new Error('db down'));
    await expect(notifyOnce('asha', [equalNotice()])).resolves.toBe(1);
    expect(createNotification).toHaveBeenCalledTimes(1);
  });

  it('does not look anything up for a notice that does not ask for it, or whose key is missing from the metadata', async () => {
    await notifyOnce('asha', [notice('them')]);
    await notifyOnce('asha', [equalNotice({ metadata: {} })]);
    expect(prismaMock.notification.findFirst).not.toHaveBeenCalled();
    expect(createNotification).toHaveBeenCalledTimes(2);
  });
});

describe('notifyOnce cooldown (R3-07): per notice window and bursts inside one process', () => {
  const chat = (overrides: Record<string, unknown> = {}) => ({
    userId: 'them',
    type: 'MESSAGE_RECEIVED' as any,
    title: 'New Message',
    message: 'Asha sent you a message',
    link: '/messages/asha',
    metadata: { messageId: 'm1', senderId: 'asha' },
    dedupeBy: ['senderId'],
    windowMs: 10 * 60 * 1000,
    ...overrides,
  });

  it('uses the window the notice asks for, and does not pass the option on to the notification', async () => {
    prismaMock.notification.findFirst.mockResolvedValue(null);
    const before = Date.now();
    await notifyOnce('asha', [chat()]);
    const since = prismaMock.notification.findFirst.mock.calls[0][0].where.createdAt.gte.getTime();
    expect(since).toBeGreaterThanOrEqual(before - 10 * 60 * 1000);
    expect(since).toBeLessThanOrEqual(Date.now() - 10 * 60 * 1000);
    expect(createNotification.mock.calls[0][0]).not.toHaveProperty('windowMs');
  });

  it('a burst of equal notices started together sends one, even though the database lookup finds nothing for all of them', async () => {
    prismaMock.notification.findFirst.mockResolvedValue(null);
    const results = await Promise.all(Array.from({ length: 8 }, () => notifyOnce('asha', [chat()])));
    expect(results.reduce((a, b) => a + b, 0)).toBe(1);
    expect(createNotification).toHaveBeenCalledTimes(1);
  });

  it('a different actor or recipient is a different key', async () => {
    prismaMock.notification.findFirst.mockResolvedValue(null);
    await notifyOnce('asha', [chat()]);
    await notifyOnce('ravi', [chat({ metadata: { messageId: 'm2', senderId: 'ravi' } })]);
    await notifyOnce('asha', [chat({ userId: 'other' })]);
    expect(createNotification).toHaveBeenCalledTimes(3);
  });

  it('a failed delivery does not use up the cooldown', async () => {
    prismaMock.notification.findFirst.mockResolvedValue(null);
    createNotification.mockRejectedValueOnce(new Error('bus down'));
    await expect(notifyOnce('asha', [chat()])).rejects.toThrow('bus down');
    await expect(notifyOnce('asha', [chat()])).resolves.toBe(1);
  });

  it('forgets a reservation once its window is over', async () => {
    prismaMock.notification.findFirst.mockResolvedValue(null);
    const spy = jest.spyOn(Date, 'now');
    const start = Date.now();
    spy.mockReturnValue(start);
    await notifyOnce('asha', [chat()]);
    spy.mockReturnValue(start + 5 * 60 * 1000);
    await expect(notifyOnce('asha', [chat()])).resolves.toBe(0);
    spy.mockReturnValue(start + 11 * 60 * 1000);
    await expect(notifyOnce('asha', [chat()])).resolves.toBe(1);
    spy.mockRestore();
  });
});
