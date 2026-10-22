import { normalizeComment, normalizePost, type SocialComment, type SocialPost } from '@/lib/social';

export const AUTHOR = { id: 'u-author', fullName: 'Asha Rao', profilePhotoUrl: null, currentDesignation: 'Engineer', batchYear: 2015 };
export const ME = { id: 'me', fullName: 'Me Myself', role: 'MEMBER', userRole: 'MEMBER' };

export function rawPost(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    type: 'GENERAL',
    content: 'Hello #AITD alumni',
    mediaUrls: [],
    videoUrl: null,
    thumbnailUrl: null,
    isReel: false,
    isRepost: false,
    visibility: 'PUBLIC',
    isPinned: false,
    createdAt: '2026-10-19T10:00:00.000Z',
    updatedAt: '2026-10-19T10:00:00.000Z',
    editedAt: null,
    user: AUTHOR,
    counts: { reactions: 2, comments: 0, reposts: 0, views: 0 },
    reactionSummary: { LIKE: 2 },
    topReactions: ['LIKE'],
    hashtags: ['aitd'],
    mentions: [],
    viewer: { reaction: null, saved: false, reposted: false, isAuthor: false, followsAuthor: true },
    repostOf: null,
    ...overrides,
  };
}

export const makePost = (overrides: Record<string, unknown> = {}): SocialPost => normalizePost(rawPost(overrides));

export function makeComment(overrides: Record<string, unknown> = {}): SocialComment {
  return normalizeComment({
    id: 'c1',
    postId: 'p1',
    parentId: null,
    content: 'Great news',
    createdAt: '2026-10-19T10:05:00.000Z',
    updatedAt: '2026-10-19T10:05:00.000Z',
    user: { id: 'u-c', fullName: 'Commenter One', batchYear: 2016 },
    likeCount: 0,
    replyCount: 0,
    viewer: { reaction: null, isAuthor: false },
    previewReplies: [],
    ...overrides,
  });
}

export const page = <T,>(items: T[], nextCursor: string | null = null) => ({ items, nextCursor });

export const apiError = (code: string, status = 400, message = 'Request failed') =>
  Object.assign(new Error(message), { response: { status, data: { success: false, error: { message, code } } } });
