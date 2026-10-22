jest.mock('../../services/notificationService', () => ({
  notificationService: { createNotification: jest.fn().mockResolvedValue(undefined) },
}));

import { followService, MENTION_SEARCH_MAX } from '../../services/followService';
import { notificationService } from '../../services/notificationService';
import { prismaMock } from '../../../tests/helpers';

const createNotification = notificationService.createNotification as jest.Mock;
const ME = { id: 'me' };

beforeEach(() => createNotification.mockClear());

describe('followService.follow / unfollow', () => {
  it('follows an active member, notifies them and returns the new count', async () => {
    prismaMock.user.findUnique.mockImplementation(async (args: any) =>
      args.select?.isActive ? { id: 'them', isActive: true } : { fullName: 'Me Myself' }
    );
    prismaMock.follow.count.mockResolvedValue(7);

    await expect(followService.follow(ME, 'them')).resolves.toEqual({ following: true, followerCount: 7 });
    expect(prismaMock.follow.create).toHaveBeenCalledWith({ data: { followerId: 'me', followingId: 'them' } });
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'them', type: 'NEW_FOLLOWER', message: 'Me Myself started following you', link: '/profile/me' })
    );
  });

  it('is idempotent: a repeat follow does not notify again', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'them', isActive: true });
    prismaMock.follow.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    prismaMock.follow.count.mockResolvedValue(undefined);

    await expect(followService.follow(ME, 'them')).resolves.toEqual({ following: true, followerCount: 0 });
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('propagates unexpected errors, rejects self-follows and unknown or inactive members', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'them', isActive: true });
    prismaMock.follow.create.mockRejectedValueOnce(new Error('db down'));
    await expect(followService.follow(ME, 'them')).rejects.toThrow('db down');

    await expect(followService.follow(ME, 'me')).rejects.toMatchObject({ statusCode: 400, code: 'CANNOT_FOLLOW_SELF' });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'them', isActive: false });
    await expect(followService.follow(ME, 'them')).rejects.toMatchObject({ statusCode: 404 });
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(followService.follow(ME, 'them')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('unfollows', async () => {
    prismaMock.follow.count.mockResolvedValue(6);
    await expect(followService.unfollow(ME, 'them')).resolves.toEqual({ following: false, followerCount: 6 });
    expect(prismaMock.follow.deleteMany).toHaveBeenCalledWith({ where: { followerId: 'me', followingId: 'them' } });
  });
});

describe('followService lists', () => {
  const person = (id: string, isActive = true) => ({ id, fullName: id, profilePhotoUrl: null, currentDesignation: null, batchYear: 2015, isActive });

  it('lists followers with the viewer’s own follow state, skipping deactivated people', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'them', isActive: true });
    prismaMock.follow.findMany
      .mockResolvedValueOnce([
        { follower: person('a'), following: person('them') },
        { follower: person('b', false), following: person('them') },
      ])
      .mockResolvedValueOnce([{ followingId: 'a' }]);

    const result = await followService.listFollowers(ME, 'them', {});

    expect(prismaMock.follow.findMany.mock.calls[0][0].where).toMatchObject({ followingId: 'them' });
    expect(result).toEqual({
      items: [{ id: 'a', fullName: 'a', profilePhotoUrl: null, currentDesignation: null, batchYear: 2015, viewerFollows: true }],
      nextCursor: null,
    });
  });

  it('lists who someone follows', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'them', isActive: true });
    prismaMock.follow.findMany.mockResolvedValueOnce([{ follower: person('them'), following: person('c') }]).mockResolvedValueOnce(undefined);

    const result = await followService.listFollowing(ME, 'them', { limit: '5' });

    expect(prismaMock.follow.findMany.mock.calls[0][0]).toMatchObject({ where: { followerId: 'them' }, take: 6 });
    expect(result.items).toEqual([expect.objectContaining({ id: 'c', viewerFollows: false })]);
  });

  it('404s for unknown members and tolerates empty pages', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(followService.listFollowers(ME, 'ghost', {})).rejects.toMatchObject({ statusCode: 404 });

    prismaMock.user.findUnique.mockResolvedValue({ id: 'them', isActive: true });
    prismaMock.follow.findMany.mockResolvedValue(undefined);
    await expect(followService.listFollowing(ME, 'them', {})).resolves.toEqual({ items: [], nextCursor: null });
  });
});

describe('followService.profileStats', () => {
  it('returns counts and whether the viewer follows the member', async () => {
    prismaMock.follow.count.mockResolvedValueOnce(10).mockResolvedValueOnce(3);
    prismaMock.follow.findUnique.mockResolvedValue({ id: 'f1' });
    await expect(followService.profileStats('them', 'me')).resolves.toEqual({ followerCount: 10, followingCount: 3, isFollowing: true });
    expect(prismaMock.follow.findUnique).toHaveBeenCalledWith({
      where: { followerId_followingId: { followerId: 'me', followingId: 'them' } },
    });
  });

  it('never looks up follow state for the member themself or anonymous viewers', async () => {
    prismaMock.follow.count.mockResolvedValue(undefined);
    await expect(followService.profileStats('me', 'me')).resolves.toEqual({ followerCount: 0, followingCount: 0, isFollowing: false });
    await expect(followService.profileStats('me')).resolves.toMatchObject({ isFollowing: false });
    expect(prismaMock.follow.findUnique).not.toHaveBeenCalled();
  });
});

describe('followService.mentionSearch', () => {
  it('finds active verified members by name, people you know first', async () => {
    prismaMock.connection.findMany.mockResolvedValue([{ requesterId: 'me', addresseeId: 'friend' }]);
    prismaMock.follow.findMany.mockResolvedValue([{ followingId: 'idol' }]);
    prismaMock.user.findUnique.mockResolvedValue({ batchYear: 2015 });
    prismaMock.user.findMany.mockResolvedValue([{ id: 'stranger' }, { id: 'friend' }, { id: 'idol' }]);

    const result = await followService.mentionSearch(ME, '  asha ', '2');

    expect(prismaMock.user.findMany.mock.calls[0][0].where).toEqual({
      isActive: true,
      isVerified: true,
      id: { not: 'me' },
      fullName: { contains: 'asha', mode: 'insensitive' },
    });
    expect(result.map((u: any) => u.id)).toEqual(['friend', 'idol']);
  });

  it('caps the limit, tolerates no matches and requires a query', async () => {
    prismaMock.user.findMany.mockResolvedValue(Array.from({ length: 30 }, (_, i) => ({ id: `u${i}` })));
    expect(await followService.mentionSearch(ME, 'a', '99')).toHaveLength(MENTION_SEARCH_MAX);
    expect(await followService.mentionSearch(ME, 'a')).toHaveLength(MENTION_SEARCH_MAX);
    prismaMock.user.findMany.mockResolvedValue(undefined);
    await expect(followService.mentionSearch(ME, 'a')).resolves.toEqual([]);
    await expect(followService.mentionSearch(ME, ' ')).rejects.toMatchObject({ statusCode: 400 });
    await expect(followService.mentionSearch(ME, undefined)).rejects.toMatchObject({ statusCode: 400 });
  });
});
