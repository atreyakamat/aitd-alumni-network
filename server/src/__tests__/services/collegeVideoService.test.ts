jest.mock('../../services/broadcastService', () => ({ broadcastNotification: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../services/notificationService', () => ({
  notificationService: { createNotification: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../../utils/storage', () => ({ deleteFromStorage: jest.fn().mockResolvedValue(undefined) }));

import { collegeVideoService } from '../../services/collegeVideoService';
import { broadcastNotification } from '../../services/broadcastService';
import { notificationService } from '../../services/notificationService';
import { deleteFromStorage } from '../../utils/storage';
import { prismaMock } from '../../../tests/helpers';
import { Actor } from '../../config/permissions';

const broadcast = broadcastNotification as jest.Mock;
const notify = notificationService.createNotification as jest.Mock;
const delStorage = deleteFromStorage as jest.Mock;

const admin: Actor = { id: 'admin1', userRole: 'ADMIN' };
const member: Actor = { id: 'u1', userRole: 'MEMBER' };

const video = (o: Record<string, unknown> = {}) => ({
  id: 'v1',
  title: 'Convocation 2026',
  description: null,
  videoUrl: '/uploads/college-videos/v.mp4',
  thumbnailUrl: null,
  category: null,
  status: 'PENDING',
  viewCount: 3,
  submittedById: 'u1',
  ...o,
});

describe('collegeVideoService', () => {
  beforeEach(() => {
    broadcast.mockClear();
    notify.mockClear();
    delStorage.mockClear();
  });

  describe('getVideos', () => {
    beforeEach(() => {
      prismaMock.collegeVideo.findMany.mockResolvedValue([]);
      prismaMock.collegeVideo.count.mockResolvedValue(0);
    });

    it('forces APPROVED for the public', async () => {
      await collegeVideoService.getVideos({}, null);
      expect(prismaMock.collegeVideo.findMany.mock.calls[0][0].where.status).toBe('APPROVED');
    });

    it('lets an admin review the PENDING queue', async () => {
      await collegeVideoService.getVideos({ status: 'PENDING' }, admin);
      expect(prismaMock.collegeVideo.findMany.mock.calls[0][0].where.status).toBe('PENDING');
    });

    it('ignores a status filter from a non-admin', async () => {
      await collegeVideoService.getVideos({ status: 'PENDING' }, member);
      expect(prismaMock.collegeVideo.findMany.mock.calls[0][0].where.status).toBe('APPROVED');
    });

    it('rejects an invalid status from an admin', async () => {
      await expect(collegeVideoService.getVideos({ status: 'BOGUS' }, admin)).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe('getVideo', () => {
    it('counts a view on an approved video', async () => {
      prismaMock.collegeVideo.findUnique.mockResolvedValue(video({ status: 'APPROVED', viewCount: 4 }));
      prismaMock.collegeVideo.update.mockResolvedValue({});
      const result = await collegeVideoService.getVideo('v1', null);
      expect(prismaMock.collegeVideo.update).toHaveBeenCalledWith({ where: { id: 'v1' }, data: { viewCount: { increment: 1 } } });
      expect(result.viewCount).toBe(5);
    });

    it('hides a pending video from strangers', async () => {
      prismaMock.collegeVideo.findUnique.mockResolvedValue(video({ status: 'PENDING' }));
      await expect(collegeVideoService.getVideo('v1', null)).rejects.toMatchObject({ statusCode: 404 });
    });

    it('shows a pending video to its submitter without counting a view', async () => {
      prismaMock.collegeVideo.findUnique.mockResolvedValue(video({ status: 'PENDING', submittedById: 'u1' }));
      const result = await collegeVideoService.getVideo('v1', member);
      expect(result.id).toBe('v1');
      expect(prismaMock.collegeVideo.update).not.toHaveBeenCalled();
    });
  });

  describe('createVideo', () => {
    it('an admin upload is APPROVED and broadcast', async () => {
      prismaMock.collegeVideo.create.mockResolvedValue(video({ status: 'APPROVED' }));
      await collegeVideoService.createVideo(admin, { title: 'T', videoUrl: '/u/v.mp4' });
      expect(prismaMock.collegeVideo.create.mock.calls[0][0].data.status).toBe('APPROVED');
      expect(broadcast).toHaveBeenCalled();
    });

    it('a member submission is PENDING and notifies admins (no broadcast)', async () => {
      prismaMock.collegeVideo.create.mockResolvedValue(video({ status: 'PENDING' }));
      prismaMock.user.findMany.mockResolvedValue([{ id: 'admin1' }]);
      await collegeVideoService.createVideo(member, { title: 'T', videoUrl: '/u/v.mp4' });
      expect(prismaMock.collegeVideo.create.mock.calls[0][0].data.status).toBe('PENDING');
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: 'admin1' }));
      expect(broadcast).not.toHaveBeenCalled();
    });

    it('requires a title and a video url', async () => {
      await expect(collegeVideoService.createVideo(admin, { title: '  ', videoUrl: '/u/v.mp4' } as any)).rejects.toMatchObject({
        statusCode: 400,
      });
      await expect(collegeVideoService.createVideo(admin, { title: 'T' } as any)).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe('approveVideo / rejectVideo', () => {
    it('approves a pending video, notifies the submitter and broadcasts', async () => {
      prismaMock.collegeVideo.findUnique.mockResolvedValue(video({ status: 'PENDING', submittedById: 'u1' }));
      prismaMock.collegeVideo.update.mockResolvedValue(video({ status: 'APPROVED' }));
      await collegeVideoService.approveVideo('admin1', 'v1');
      expect(prismaMock.collegeVideo.update.mock.calls[0][0].data.status).toBe('APPROVED');
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }));
      expect(broadcast).toHaveBeenCalled();
    });

    it('approve is a no-op when already approved', async () => {
      prismaMock.collegeVideo.findUnique.mockResolvedValue(video({ status: 'APPROVED' }));
      await collegeVideoService.approveVideo('admin1', 'v1');
      expect(prismaMock.collegeVideo.update).not.toHaveBeenCalled();
    });

    it('rejects with a reason and notifies the submitter', async () => {
      prismaMock.collegeVideo.findUnique.mockResolvedValue(video({ status: 'PENDING', submittedById: 'u1' }));
      prismaMock.collegeVideo.update.mockResolvedValue(video({ status: 'REJECTED', rejectionReason: 'blurry' }));
      await collegeVideoService.rejectVideo('admin1', 'v1', 'blurry');
      expect(prismaMock.collegeVideo.update.mock.calls[0][0].data.status).toBe('REJECTED');
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }));
      expect(broadcast).not.toHaveBeenCalled();
    });
  });

  describe('deleteVideo', () => {
    it('an admin can delete any video and cleans up storage', async () => {
      prismaMock.collegeVideo.findUnique.mockResolvedValue(video({ status: 'APPROVED', videoUrl: '/u/v.mp4', thumbnailUrl: '/u/t.jpg' }));
      prismaMock.collegeVideo.delete.mockResolvedValue({});
      await collegeVideoService.deleteVideo(admin, 'v1');
      expect(prismaMock.collegeVideo.delete).toHaveBeenCalledWith({ where: { id: 'v1' } });
      expect(delStorage).toHaveBeenCalledWith('/u/v.mp4');
    });

    it('a submitter can delete their own pending video', async () => {
      prismaMock.collegeVideo.findUnique.mockResolvedValue(video({ status: 'PENDING', submittedById: 'u1' }));
      prismaMock.collegeVideo.delete.mockResolvedValue({});
      await expect(collegeVideoService.deleteVideo(member, 'v1')).resolves.toMatchObject({ message: expect.any(String) });
    });

    it('a submitter cannot delete their own approved video', async () => {
      prismaMock.collegeVideo.findUnique.mockResolvedValue(video({ status: 'APPROVED', submittedById: 'u1' }));
      await expect(collegeVideoService.deleteVideo(member, 'v1')).rejects.toMatchObject({ statusCode: 403 });
    });
  });
});
