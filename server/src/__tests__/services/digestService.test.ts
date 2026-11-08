jest.mock('../../utils/email', () => ({ sendEmail: jest.fn().mockResolvedValue(undefined) }));

import { digestService } from '../../services/digestService';
import { sendEmail } from '../../utils/email';
import { prismaMock } from '../../../tests/helpers';

const send = sendEmail as jest.Mock;
const allSections = { nearbyAlumni: true, jobs: true, events: true, videos: true, requirements: true };

describe('digestService', () => {
  beforeEach(() => send.mockClear());

  describe('getSettings / updateSettings', () => {
    it('returns safe defaults when nothing is stored', async () => {
      prismaMock.digestSettings.findUnique.mockResolvedValue(null);
      const s = await digestService.getSettings();
      expect(s).toMatchObject({ enabled: false, dayOfWeek: 1, hour: 9 });
      expect(s.sections).toMatchObject({ jobs: true });
    });
    it('clamps day/hour on update', async () => {
      prismaMock.digestSettings.findUnique.mockResolvedValue(null);
      prismaMock.digestSettings.upsert.mockImplementation((args: any) => Promise.resolve({ id: 'default', ...args.create }));
      await digestService.updateSettings({ enabled: true, dayOfWeek: 99, hour: -5, sections: { jobs: false } });
      const data = prismaMock.digestSettings.upsert.mock.calls[0][0].create;
      expect(data.dayOfWeek).toBe(6);
      expect(data.hour).toBe(0);
      expect(data.enabled).toBe(true);
      expect((data.sections as any).jobs).toBe(false);
    });
  });

  describe('buildDigest', () => {
    const emptyAll = () => {
      prismaMock.jobOpportunity.findMany.mockResolvedValue([]);
      prismaMock.event.findMany.mockResolvedValue([]);
      prismaMock.collegeVideo.findMany.mockResolvedValue([]);
      prismaMock.collegeRequirement.findMany.mockResolvedValue([]);
      prismaMock.user.count.mockResolvedValue(0);
    };
    it('returns null when every section is empty', async () => {
      emptyAll();
      expect(await digestService.buildDigest(allSections)).toBeNull();
    });
    it('composes html + text when there is content', async () => {
      emptyAll();
      prismaMock.jobOpportunity.findMany.mockResolvedValue([{ id: 'j1', title: 'SWE', company: 'Acme' }]);
      prismaMock.user.count.mockResolvedValue(3);
      const digest = await digestService.buildDigest(allSections);
      expect(digest).not.toBeNull();
      expect(digest!.html).toContain('SWE');
      expect(digest!.text).toContain('SWE');
      expect(digest!.html).toContain('3'); // new alumni count
    });
  });

  describe('sendDigest', () => {
    it('sends a single test email to the given user', async () => {
      prismaMock.jobOpportunity.findMany.mockResolvedValue([{ id: 'j1', title: 'SWE', company: 'Acme' }]);
      prismaMock.event.findMany.mockResolvedValue([]);
      prismaMock.collegeVideo.findMany.mockResolvedValue([]);
      prismaMock.collegeRequirement.findMany.mockResolvedValue([]);
      prismaMock.user.count.mockResolvedValue(0);
      prismaMock.digestSettings.findUnique.mockResolvedValue(null);
      prismaMock.user.findUnique.mockResolvedValue({ email: 'me@aiem.test' });
      const sent = await digestService.sendDigest({ testUserId: 'me' });
      expect(sent).toBe(1);
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: 'me@aiem.test', subject: expect.stringContaining('[Test]') }));
    });
  });

  describe('runIfDue', () => {
    it('does nothing when disabled', async () => {
      prismaMock.digestSettings.findUnique.mockResolvedValue({ id: 'default', enabled: false, dayOfWeek: 1, hour: 9, sections: allSections, lastRunAt: null });
      expect(await digestService.runIfDue(new Date('2026-10-26T09:30:00'))).toEqual({ ran: false });
    });
    it('does nothing outside the configured day/hour', async () => {
      prismaMock.digestSettings.findUnique.mockResolvedValue({ id: 'default', enabled: true, dayOfWeek: 1, hour: 9, sections: allSections, lastRunAt: null });
      // A Sunday (day 0) at 09:xx — wrong day
      expect(await digestService.runIfDue(new Date('2026-10-25T09:30:00'))).toEqual({ ran: false });
    });
    it('does nothing if it already ran this week', async () => {
      const now = new Date('2026-10-26T09:30:00'); // Monday
      prismaMock.digestSettings.findUnique.mockResolvedValue({ id: 'default', enabled: true, dayOfWeek: 1, hour: 9, sections: allSections, lastRunAt: new Date('2026-10-26T09:00:00') });
      expect(await digestService.runIfDue(now)).toEqual({ ran: false });
    });
  });
});
