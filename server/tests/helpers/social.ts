/**
 * Fixtures for social-layer unit tests (posts, comments, viewer context) on the Prisma mock.
 * Rows are typed loosely, like prismaMock, so tests can pass partial or deliberately broken rows.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prismaMock } from './index';

export const OWNER = 'owner-1';
export const OTHER = 'other-2';
export const THIRD = 'third-3';

export const authorRow = (id: string = OWNER, overrides: Record<string, unknown> = {}): any => ({
  id,
  fullName: `User ${id}`,
  profilePhotoUrl: null,
  currentDesignation: null,
  batchYear: 2015,
  isActive: true,
  membershipTier: null,
  ...overrides,
});

export const postRow = (overrides: Record<string, unknown> = {}): any => {
  const userId = (overrides.userId as string) ?? OWNER;
  return {
    id: 'p1',
    userId,
    type: 'GENERAL',
    content: 'hello',
    mediaUrls: [],
    videoUrl: null,
    thumbnailUrl: null,
    isReel: false,
    linkUrl: null,
    visibility: 'PUBLIC',
    isPinned: false,
    isPublished: true,
    isRepost: false,
    repostOfId: null,
    plainRepostKey: null,
    likeCount: 0,
    commentCount: 0,
    repostCount: 0,
    viewCount: 0,
    editedAt: null,
    createdAt: new Date('2026-10-18T10:00:00Z'),
    updatedAt: new Date('2026-10-18T10:00:00Z'),
    user: authorRow(userId),
    ...overrides,
  };
};

export const commentRow = (overrides: Record<string, unknown> = {}): any => ({
  id: 'c1',
  postId: 'p1',
  userId: OTHER,
  parentId: null,
  content: 'nice',
  likeCount: 0,
  editedAt: null,
  createdAt: new Date('2026-10-18T11:00:00Z'),
  updatedAt: new Date('2026-10-18T11:00:00Z'),
  user: authorRow(OTHER),
  mentions: [],
  _count: { replies: 0 },
  ...overrides,
});

/** Arrange what loadViewerContext reads: accepted connections, follows and the viewer's batch. */
export const arrangeViewer = (
  viewerId: string,
  { connections = [] as string[], following = [] as string[], batchYear = 2015 } = {}
) => {
  prismaMock.connection.findMany.mockResolvedValue(
    connections.map((other) => ({ requesterId: viewerId, addresseeId: other }))
  );
  prismaMock.follow.findMany.mockResolvedValue(following.map((followingId) => ({ followingId })));
  prismaMock.user.findUnique.mockResolvedValue({ id: viewerId, batchYear, fullName: `User ${viewerId}` });
};
