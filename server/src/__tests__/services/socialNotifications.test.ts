jest.mock('../../services/notificationService', () => ({
  notificationService: { createNotification: jest.fn().mockResolvedValue(undefined) },
}));

import { actorName, notifyOnce, reactionMessage } from '../../services/socialNotifications';
import { notificationService } from '../../services/notificationService';
import { prismaMock } from '../../../tests/helpers';

const createNotification = notificationService.createNotification as jest.Mock;
const notice = (userId: string, type = 'MENTION') => ({ userId, type: type as any, title: 't', message: 'm', link: '/posts/p1' });

beforeEach(() => createNotification.mockClear());

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
