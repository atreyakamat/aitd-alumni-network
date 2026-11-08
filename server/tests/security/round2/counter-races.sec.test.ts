/**
 * ROUND 2 - race conditions: counters that are "re-derived from the rows" inside a transaction.
 *
 * Under READ COMMITTED two concurrent transactions each count the rows they can see (their own insert, not the other's
 * uncommitted one), so the later UPDATE of the denormalised counter overwrites the earlier one with a stale total.
 * Same root cause as the RSVP / mentorship check-then-act races fixed in round 1 (AZ-01 / AZ-02).
 *
 * Each test fires a Promise.all burst from DISTINCT users against one parent and asserts counter === number of rows.
 */
import { createUser, http, prisma } from '../../integration/helpers';

afterAll(async () => {
  await prisma.$disconnect();
});

type U = Awaited<ReturnType<typeof createUser>>;
const BURST = 8;
const ROUNDS = 3;

const makeUsers = (n: number) => Promise.all(Array.from({ length: n }, () => createUser('MEMBER')));

const makePost = async (author: U) => {
  const res = await http().post('/api/posts').set('Authorization', author.auth).send({ content: 'race target post' });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
};

describe('R2-08 denormalised counters stay equal to the rows under concurrent writers', () => {
  it('post reactions: likeCount equals the number of PostLike rows', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const author = await createUser('MEMBER');
      const id = await makePost(author);
      const users = await makeUsers(BURST);
      const results = await Promise.all(
        users.map((u) => http().post(`/api/posts/${id}/react`).set('Authorization', u.auth).send({ type: 'LIKE' }))
      );
      expect(results.every((r) => r.status === 200)).toBe(true);
      const rows = await prisma.postLike.count({ where: { postId: id } });
      const stored = await prisma.post.findUniqueOrThrow({ where: { id } });
      expect(rows).toBe(BURST);
      expect(stored.likeCount).toBe(rows);
    }
  });

  it('comments: commentCount equals the number of comments', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const author = await createUser('MEMBER');
      const id = await makePost(author);
      const users = await makeUsers(BURST);
      const results = await Promise.all(
        users.map((u) => http().post(`/api/posts/${id}/comments`).set('Authorization', u.auth).send({ content: 'burst comment' }))
      );
      expect(results.every((r) => r.status === 201)).toBe(true);
      const rows = await prisma.postComment.count({ where: { postId: id } });
      const stored = await prisma.post.findUniqueOrThrow({ where: { id } });
      expect(rows).toBe(BURST);
      expect(stored.commentCount).toBe(rows);
    }
  });

  it('comment deletions racing a new comment keep commentCount equal to the remaining rows', async () => {
    const author = await createUser('MEMBER');
    const id = await makePost(author);
    const users = await makeUsers(BURST);
    const created = await Promise.all(
      users.map((u) => http().post(`/api/posts/${id}/comments`).set('Authorization', u.auth).send({ content: 'to be deleted' }))
    );
    const commentIds = created.map((r) => r.body.data.id as string);
    const newcomer = await createUser('MEMBER');
    await Promise.all([
      ...commentIds.slice(0, 6).map((cid, i) => http().delete(`/api/comments/${cid}`).set('Authorization', users[i].auth)),
      http().post(`/api/posts/${id}/comments`).set('Authorization', newcomer.auth).send({ content: 'late comment' }),
    ]);
    const rows = await prisma.postComment.count({ where: { postId: id } });
    const stored = await prisma.post.findUniqueOrThrow({ where: { id } });
    expect(stored.commentCount).toBe(rows);
  });

  it('reposts: repostCount equals the number of reposts', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const author = await createUser('MEMBER');
      const id = await makePost(author);
      const users = await makeUsers(BURST);
      const results = await Promise.all(users.map((u) => http().post(`/api/posts/${id}/repost`).set('Authorization', u.auth).send({})));
      expect(results.every((r) => r.status === 201)).toBe(true);
      const rows = await prisma.post.count({ where: { repostOfId: id, isRepost: true } });
      const stored = await prisma.post.findUniqueOrThrow({ where: { id } });
      expect(rows).toBe(BURST);
      expect(stored.repostCount).toBe(rows);
    }
  });

  it('comment reactions: likeCount equals the number of CommentReaction rows', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const author = await createUser('MEMBER');
      const id = await makePost(author);
      const comment = await http().post(`/api/posts/${id}/comments`).set('Authorization', author.auth).send({ content: 'react to me' });
      const commentId = comment.body.data.id as string;
      const users = await makeUsers(BURST);
      const results = await Promise.all(
        users.map((u) => http().post(`/api/comments/${commentId}/react`).set('Authorization', u.auth).send({ type: 'LIKE' }))
      );
      expect(results.every((r) => r.status === 200)).toBe(true);
      const rows = await prisma.commentReaction.count({ where: { commentId } });
      const stored = await prisma.postComment.findUniqueOrThrow({ where: { id: commentId } });
      expect(rows).toBe(BURST);
      expect(stored.likeCount).toBe(rows);
    }
  });
});

describe('counters that already use atomic SQL (regression coverage)', () => {
  it('chapter join/leave bursts keep memberCount equal to the memberships', async () => {
    const admin = await createUser('ADMIN');
    const chapter = await prisma.chapter.create({ data: { name: `Race chapter ${Date.now()}`, region: 'Test', adminUserId: admin.user.id } });
    const users = await makeUsers(BURST);
    const joins = await Promise.all(users.map((u) => http().post(`/api/chapters/${chapter.id}/join`).set('Authorization', u.auth)));
    expect(joins.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    // double-join burst from one member: exactly one row
    await Promise.all(Array.from({ length: 4 }, () => http().post(`/api/chapters/${chapter.id}/join`).set('Authorization', users[0].auth)));
    expect(await prisma.chapterMembership.count({ where: { chapterId: chapter.id } })).toBe(BURST);
    expect((await prisma.chapter.findUniqueOrThrow({ where: { id: chapter.id } })).memberCount).toBe(BURST);

    // everybody leaves twice at once
    await Promise.all(users.flatMap((u) => [1, 2].map(() => http().post(`/api/chapters/${chapter.id}/leave`).set('Authorization', u.auth))));
    expect(await prisma.chapterMembership.count({ where: { chapterId: chapter.id } })).toBe(0);
    expect((await prisma.chapter.findUniqueOrThrow({ where: { id: chapter.id } })).memberCount).toBe(0);
  });

  it('simultaneous follows from many members report a consistent follower count and never 500', async () => {
    const target = await createUser('MEMBER');
    const users = await makeUsers(BURST);
    const results = await Promise.all(users.map((u) => http().post(`/api/users/${target.user.id}/follow`).set('Authorization', u.auth)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await prisma.follow.count({ where: { followingId: target.user.id } })).toBe(BURST);
  });

  it('post views from many members are each counted once', async () => {
    const author = await createUser('MEMBER');
    const id = await makePost(author);
    const users = await makeUsers(BURST);
    await Promise.all(users.flatMap((u) => [1, 2].map(() => http().post(`/api/posts/${id}/view`).set('Authorization', u.auth))));
    const stored = await prisma.post.findUniqueOrThrow({ where: { id } });
    expect(stored.viewCount).toBe(BURST);
  });
});
