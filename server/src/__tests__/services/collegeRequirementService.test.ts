jest.mock('../../services/broadcastService', () => ({ broadcastNotification: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../services/notificationService', () => ({ notificationService: { createNotification: jest.fn().mockResolvedValue(undefined) } }));

import { collegeRequirementService } from '../../services/collegeRequirementService';
import { broadcastNotification } from '../../services/broadcastService';
import { notificationService } from '../../services/notificationService';
import { prismaMock } from '../../../tests/helpers';
import { Actor } from '../../config/permissions';

const broadcast = broadcastNotification as jest.Mock;
const notify = notificationService.createNotification as jest.Mock;
const admin: Actor = { id: 'admin1', userRole: 'ADMIN' };
const member: Actor = { id: 'u1', userRole: 'MEMBER' };
const req = (o: Record<string, unknown> = {}) => ({ id: 'r1', title: 'Need lab PCs', description: 'd', category: 'HARDWARE', status: 'OPEN', postedById: 'admin1', ...o });

describe('collegeRequirementService', () => {
  beforeEach(() => {
    broadcast.mockClear();
    notify.mockClear();
  });

  describe('getRequirements', () => {
    beforeEach(() => {
      prismaMock.collegeRequirement.findMany.mockResolvedValue([]);
      prismaMock.collegeRequirement.count.mockResolvedValue(0);
    });
    it('shows OPEN only to the public', async () => {
      await collegeRequirementService.getRequirements({}, null);
      expect(prismaMock.collegeRequirement.findMany.mock.calls[0][0].where).toEqual({ status: 'OPEN' });
    });
    it('lets an admin filter by status', async () => {
      await collegeRequirementService.getRequirements({ status: 'FULFILLED' }, admin);
      expect(prismaMock.collegeRequirement.findMany.mock.calls[0][0].where.status).toBe('FULFILLED');
    });
    it('ignores a status filter from the public', async () => {
      await collegeRequirementService.getRequirements({ status: 'CLOSED' }, member);
      expect(prismaMock.collegeRequirement.findMany.mock.calls[0][0].where.status).toBe('OPEN');
    });
  });

  describe('createRequirement', () => {
    it('creates and broadcasts to alumni', async () => {
      prismaMock.collegeRequirement.create.mockResolvedValue(req());
      await collegeRequirementService.createRequirement('admin1', { title: 'Need lab PCs', description: 'd', category: 'HARDWARE' });
      expect(prismaMock.collegeRequirement.create).toHaveBeenCalled();
      expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ excludeUserId: 'admin1', link: '/requirements' }));
    });
    it('requires title and description', async () => {
      await expect(collegeRequirementService.createRequirement('admin1', { title: '', description: 'd' } as any)).rejects.toMatchObject({ statusCode: 400 });
      await expect(collegeRequirementService.createRequirement('admin1', { title: 't', description: '' } as any)).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe('respond', () => {
    it('records an offer and notifies admins', async () => {
      prismaMock.collegeRequirement.findUnique.mockResolvedValue(req({ status: 'OPEN' }));
      prismaMock.requirementResponse.create.mockResolvedValue({ id: 'resp1' });
      prismaMock.user.findMany.mockResolvedValue([{ id: 'admin1' }]);
      prismaMock.user.findUnique.mockResolvedValue({ fullName: 'Asha' });
      await collegeRequirementService.respond('u1', 'r1', 'I can donate 10 PCs');
      expect(prismaMock.requirementResponse.create).toHaveBeenCalled();
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: 'admin1' }));
    });
    it('rejects offers on a non-open requirement', async () => {
      prismaMock.collegeRequirement.findUnique.mockResolvedValue(req({ status: 'CLOSED' }));
      await expect(collegeRequirementService.respond('u1', 'r1', 'hi')).rejects.toMatchObject({ statusCode: 400, code: 'REQUIREMENT_CLOSED' });
    });
    it('rejects a duplicate offer (P2002) with 409', async () => {
      prismaMock.collegeRequirement.findUnique.mockResolvedValue(req({ status: 'OPEN' }));
      prismaMock.requirementResponse.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
      await expect(collegeRequirementService.respond('u1', 'r1', 'hi')).rejects.toMatchObject({ statusCode: 409, code: 'ALREADY_RESPONDED' });
    });
    it('requires a message', async () => {
      prismaMock.collegeRequirement.findUnique.mockResolvedValue(req({ status: 'OPEN' }));
      await expect(collegeRequirementService.respond('u1', 'r1', '  ')).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe('reviewResponse', () => {
    it('accepts an offer and notifies the member', async () => {
      prismaMock.requirementResponse.findUnique.mockResolvedValue({ id: 'resp1', userId: 'u1', requirementId: 'r1', requirement: { title: 'Need lab PCs' } });
      prismaMock.requirementResponse.update.mockResolvedValue({ id: 'resp1', status: 'ACCEPTED' });
      await collegeRequirementService.reviewResponse('resp1', true);
      expect(prismaMock.requirementResponse.update.mock.calls[0][0].data.status).toBe('ACCEPTED');
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }));
    });
  });
});
