jest.mock('../../utils/socket', () => ({ emitToUser: jest.fn() }));

import { fanOutNotification, broadcastNotification } from '../../services/broadcastService';
import { emitToUser } from '../../utils/socket';
import { prismaMock } from '../../../tests/helpers';

const emit = emitToUser as jest.Mock;

describe('broadcastService', () => {
  it('fans out in a batch, excludes a user, inserts rows and emits realtime', async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    prismaMock.notification.createMany.mockResolvedValue({ count: 2 });

    const delivered = await fanOutNotification({
      type: 'ADMIN_ANNOUNCEMENT',
      title: 'New video',
      message: 'Watch it',
      link: '/videos',
      excludeUserId: 'z',
    });

    expect(delivered).toBe(2);
    expect(prismaMock.user.findMany.mock.calls[0][0].where).toMatchObject({ isActive: true, id: { not: 'z' } });
    expect(prismaMock.notification.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ userId: 'a', type: 'ADMIN_ANNOUNCEMENT', title: 'New video', link: '/videos' }),
        expect.objectContaining({ userId: 'b' }),
      ],
    });
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('a socket failure never stops the fan-out', async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: 'a' }]);
    prismaMock.notification.createMany.mockResolvedValue({ count: 1 });
    emit.mockImplementationOnce(() => {
      throw new Error('socket down');
    });
    await expect(fanOutNotification({ type: 'ADMIN_ANNOUNCEMENT', title: 't', message: 'm' })).resolves.toBe(1);
  });

  it('broadcastNotification runs inline when no queue is configured (test env)', async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: 'a' }]);
    prismaMock.notification.createMany.mockResolvedValue({ count: 1 });
    await broadcastNotification({ type: 'ADMIN_ANNOUNCEMENT', title: 't', message: 'm' });
    expect(prismaMock.notification.createMany).toHaveBeenCalled();
  });
});
