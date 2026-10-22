import { chapterService } from '../../services/chapterService';
import { eventService } from '../../services/eventService';
import { prismaMock } from '../../../tests/helpers';

const chapter = { id: 'c1', name: 'Pune', adminUserId: 'ca1', isActive: true };

describe('chapter admin scope', () => {
  describe('chapterService.updateChapter', () => {
    it('lets the chapter admin edit their own chapter', async () => {
      prismaMock.chapter.findUnique.mockResolvedValue(chapter);
      prismaMock.chapter.update.mockResolvedValue({ ...chapter, description: 'new' });

      await chapterService.updateChapter({ id: 'ca1', userRole: 'CHAPTER_ADMIN' }, 'c1', { description: 'new' });

      expect(prismaMock.chapter.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { description: 'new' } });
    });

    it("forbids a chapter admin from editing someone else's chapter", async () => {
      prismaMock.chapter.findUnique.mockResolvedValue(chapter);
      await expect(
        chapterService.updateChapter({ id: 'other', userRole: 'CHAPTER_ADMIN' }, 'c1', { description: 'x' })
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(prismaMock.chapter.update).not.toHaveBeenCalled();
    });

    it('lets platform admins edit any chapter', async () => {
      prismaMock.chapter.findUnique.mockResolvedValue(chapter);
      prismaMock.chapter.update.mockResolvedValue(chapter);
      await chapterService.updateChapter({ id: 'adm', userRole: 'ADMIN' }, 'c1', { region: 'West' });
      expect(prismaMock.chapter.update).toHaveBeenCalled();
    });

    it('ignores fields that must not be mass-assigned', async () => {
      prismaMock.chapter.findUnique.mockResolvedValue(chapter);
      prismaMock.chapter.update.mockResolvedValue(chapter);
      await chapterService.updateChapter({ id: 'ca1', userRole: 'CHAPTER_ADMIN' }, 'c1', {
        description: 'ok',
        memberCount: 9999,
        totalDonations: 1e9,
        adminUserId: 'hijack',
        id: 'other-id',
      } as any);
      expect(prismaMock.chapter.update.mock.calls[0][0].data).toEqual({ description: 'ok' });
    });

    it('404s for unknown chapters', async () => {
      prismaMock.chapter.findUnique.mockResolvedValue(null);
      await expect(
        chapterService.updateChapter({ id: 'adm', userRole: 'ADMIN' }, 'nope', {})
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('chapterService.assignAdmin', () => {
    it('assigns the chapter admin and promotes a plain member to CHAPTER_ADMIN', async () => {
      prismaMock.chapter.findUnique.mockResolvedValue(chapter);
      prismaMock.user.findUnique.mockResolvedValue({ id: 'u9', userRole: 'MEMBER', isActive: true });
      prismaMock.chapter.update.mockResolvedValue({ ...chapter, adminUserId: 'u9' });

      await chapterService.assignAdmin('c1', 'u9');

      expect(prismaMock.chapter.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { adminUserId: 'u9' } });
      expect(prismaMock.user.update).toHaveBeenCalledWith({ where: { id: 'u9' }, data: { userRole: 'CHAPTER_ADMIN' } });
    });

    it('does not demote admins assigned to a chapter', async () => {
      prismaMock.chapter.findUnique.mockResolvedValue(chapter);
      prismaMock.user.findUnique.mockResolvedValue({ id: 'u9', userRole: 'ADMIN', isActive: true });
      prismaMock.chapter.update.mockResolvedValue(chapter);
      await chapterService.assignAdmin('c1', 'u9');
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it('rejects inactive or unknown users', async () => {
      prismaMock.chapter.findUnique.mockResolvedValue(chapter);
      prismaMock.user.findUnique.mockResolvedValue(null);
      await expect(chapterService.assignAdmin('c1', 'ghost')).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('eventService.createEvent', () => {
    const input = { title: 'Meetup', description: 'd', startDate: '2030-01-01T10:00:00Z' };

    it('lets admins create institution-wide events', async () => {
      prismaMock.event.create.mockResolvedValue({ id: 'e1' });
      await eventService.createEvent('adm', input as any, 'ADMIN');
      expect(prismaMock.event.create).toHaveBeenCalled();
    });

    it('requires chapter admins to target a chapter', async () => {
      await expect(eventService.createEvent('ca1', input as any, 'CHAPTER_ADMIN')).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    it('lets chapter admins create events for their own chapter', async () => {
      prismaMock.chapter.findUnique.mockResolvedValue(chapter);
      prismaMock.event.create.mockResolvedValue({ id: 'e1' });
      await eventService.createEvent('ca1', { ...input, chapterId: 'c1' } as any, 'CHAPTER_ADMIN');
      expect(prismaMock.event.create.mock.calls[0][0].data).toMatchObject({ chapterId: 'c1', createdById: 'ca1' });
    });

    it("forbids chapter admins from creating events for another chapter", async () => {
      prismaMock.chapter.findUnique.mockResolvedValue({ ...chapter, adminUserId: 'someone-else' });
      await expect(
        eventService.createEvent('ca1', { ...input, chapterId: 'c1' } as any, 'CHAPTER_ADMIN')
      ).rejects.toMatchObject({ statusCode: 403 });
    });
  });
});
