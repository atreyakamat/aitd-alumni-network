jest.mock('../../services/notificationService', () => ({ notificationService: { createNotification: jest.fn().mockResolvedValue(undefined) } }));

import { referralService } from '../../services/referralService';
import { notificationService } from '../../services/notificationService';
import { prismaMock } from '../../../tests/helpers';

const notify = notificationService.createNotification as jest.Mock;

describe('referralService', () => {
  beforeEach(() => notify.mockClear());

  describe('createRequest', () => {
    beforeEach(() => {
      prismaMock.user.findUnique.mockImplementation((args: any) =>
        Promise.resolve(args.where.id === 't1' ? { id: 't1', isActive: true } : { fullName: 'Asha' })
      );
      prismaMock.referralRequest.count.mockResolvedValue(0);
      prismaMock.referralRequest.create.mockResolvedValue({ id: 'ref1' });
    });

    it('creates a request and notifies the target', async () => {
      await referralService.createRequest('u1', { targetId: 't1', company: 'Acme', message: 'Please refer me' });
      expect(prismaMock.referralRequest.create).toHaveBeenCalled();
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: 't1', title: 'Referral request' }));
    });
    it('refuses a self-referral', async () => {
      await expect(referralService.createRequest('u1', { targetId: 'u1', company: 'Acme', message: 'x' })).rejects.toMatchObject({ statusCode: 400 });
    });
    it('enforces the pending cap', async () => {
      prismaMock.referralRequest.count.mockResolvedValue(10);
      await expect(referralService.createRequest('u1', { targetId: 't1', company: 'Acme', message: 'x' })).rejects.toMatchObject({ statusCode: 429 });
    });
    it('maps a duplicate (P2002) to 409', async () => {
      prismaMock.referralRequest.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
      await expect(referralService.createRequest('u1', { targetId: 't1', company: 'Acme', message: 'x' })).rejects.toMatchObject({ statusCode: 409 });
    });
    it('requires company and message', async () => {
      await expect(referralService.createRequest('u1', { targetId: 't1', company: '', message: 'x' })).rejects.toMatchObject({ statusCode: 400 });
      await expect(referralService.createRequest('u1', { targetId: 't1', company: 'Acme', message: '' })).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe('respond', () => {
    it('accepts and notifies the requester', async () => {
      prismaMock.referralRequest.findUnique.mockResolvedValue({ id: 'ref1', targetId: 't1', requesterId: 'u1', company: 'Acme', status: 'PENDING' });
      prismaMock.referralRequest.update.mockResolvedValue({ id: 'ref1', status: 'ACCEPTED' });
      prismaMock.user.findUnique.mockResolvedValue({ fullName: 'Target' });
      await referralService.respond('t1', 'ref1', true);
      expect(prismaMock.referralRequest.update.mock.calls[0][0].data.status).toBe('ACCEPTED');
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }));
    });
    it('only the target may respond', async () => {
      prismaMock.referralRequest.findUnique.mockResolvedValue({ id: 'ref1', targetId: 't1', requesterId: 'u1', status: 'PENDING' });
      await expect(referralService.respond('someone', 'ref1', true)).rejects.toMatchObject({ statusCode: 403 });
    });
    it('cannot re-answer a processed request', async () => {
      prismaMock.referralRequest.findUnique.mockResolvedValue({ id: 'ref1', targetId: 't1', requesterId: 'u1', status: 'ACCEPTED' });
      await expect(referralService.respond('t1', 'ref1', true)).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe('findReferrers', () => {
    it('de-duplicates people with multiple roles at the company', async () => {
      prismaMock.workExperience.findMany.mockResolvedValue([
        { role: 'SWE', isCurrent: true, user: { id: 'a', fullName: 'A' } },
        { role: 'Intern', isCurrent: false, user: { id: 'a', fullName: 'A' } },
        { role: 'PM', isCurrent: true, user: { id: 'b', fullName: 'B' } },
      ]);
      const people = await referralService.findReferrers('Acme', 'u1');
      expect(people.map((p) => p.user.id)).toEqual(['a', 'b']);
    });
    it('requires a company name', async () => {
      await expect(referralService.findReferrers('a', 'u1')).rejects.toMatchObject({ statusCode: 400 });
    });
  });
});
