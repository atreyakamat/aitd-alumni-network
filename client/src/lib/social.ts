/**
 * Alumni Social: API calls, response normalisers and pure helpers for the social layer
 * (reactions, comments, reposts, mentions, hashtags, follows, saved posts, reels, reports).
 * Contract: docs/SOCIAL_API.md. Normalisers are defensive so older (v1) payloads still render.
 */
import type { AxiosProgressEvent } from 'axios';
import {
  Heart,
  HandHeart,
  Laugh,
  Lightbulb,
  PartyPopper,
  ThumbsUp,
  type LucideIcon,
} from 'lucide-react';
import { api } from '@/lib/api';

// ---------------------------------------------------------------------------
// Enums & metadata
// ---------------------------------------------------------------------------

export const REACTION_TYPES = ['LIKE', 'CELEBRATE', 'SUPPORT', 'LOVE', 'INSIGHTFUL', 'FUNNY'] as const;
export type ReactionType = (typeof REACTION_TYPES)[number];

export const POST_VISIBILITIES = ['PUBLIC', 'CONNECTIONS'] as const;
export type PostVisibility = (typeof POST_VISIBILITIES)[number];

export const REPORT_REASONS = ['SPAM', 'HARASSMENT', 'INAPPROPRIATE', 'MISINFORMATION', 'OTHER'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_STATUSES = ['OPEN', 'RESOLVED', 'DISMISSED'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const FEED_TABS = ['for-you', 'following', 'latest'] as const;
export type FeedTab = (typeof FEED_TABS)[number];

export const POST_CONTENT_MAX = 5000;
export const COMMENT_CONTENT_MAX = 2000;
export const REPORT_DETAILS_MAX = 500;
export const MAX_POST_IMAGES = 5;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const VIDEO_MIME_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'] as const;

export interface ReactionMeta {
  type: ReactionType;
  label: string;
  /** Past-tense phrase for "Asha celebrated this". */
  verb: string;
  icon: LucideIcon;
  /** Tailwind text colour for the active state. */
  colorClass: string;
  /** Tailwind background tint for the summary bubble. */
  bgClass: string;
}

export const REACTIONS: Record<ReactionType, ReactionMeta> = {
  LIKE: { type: 'LIKE', label: 'Like', verb: 'liked', icon: ThumbsUp, colorClass: 'text-blue-600', bgClass: 'bg-blue-100' },
  CELEBRATE: { type: 'CELEBRATE', label: 'Celebrate', verb: 'celebrated', icon: PartyPopper, colorClass: 'text-green-600', bgClass: 'bg-green-100' },
  SUPPORT: { type: 'SUPPORT', label: 'Support', verb: 'supported', icon: HandHeart, colorClass: 'text-purple-600', bgClass: 'bg-purple-100' },
  LOVE: { type: 'LOVE', label: 'Love', verb: 'loved', icon: Heart, colorClass: 'text-red-600', bgClass: 'bg-red-100' },
  INSIGHTFUL: { type: 'INSIGHTFUL', label: 'Insightful', verb: 'found insightful', icon: Lightbulb, colorClass: 'text-amber-600', bgClass: 'bg-amber-100' },
  FUNNY: { type: 'FUNNY', label: 'Funny', verb: 'found funny', icon: Laugh, colorClass: 'text-sky-600', bgClass: 'bg-sky-100' },
};

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  SPAM: 'Spam or scam',
  HARASSMENT: 'Harassment or bullying',
  INAPPROPRIATE: 'Inappropriate content',
  MISINFORMATION: 'False information',
  OTHER: 'Something else',
};

export const FEED_TAB_LABELS: Record<FeedTab, string> = {
  'for-you': 'For you',
  following: 'Following',
  latest: 'Latest',
};

export const isReactionType = (value: unknown): value is ReactionType =>
  typeof value === 'string' && (REACTION_TYPES as readonly string[]).includes(value);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthorLite {
  id: string;
  fullName: string;
  profilePhotoUrl: string | null;
  currentDesignation: string | null;
  batchYear: number | null;
  membershipTier?: { name: string; badgeColor?: string | null } | null;
}

export interface MentionRef {
  id: string;
  fullName: string;
}

export type ReactionSummary = Partial<Record<ReactionType, number>>;

export interface PostViewer {
  reaction: ReactionType | null;
  saved: boolean;
  reposted: boolean;
  isAuthor: boolean;
  followsAuthor: boolean;
}

export interface PostCounts {
  reactions: number;
  comments: number;
  reposts: number;
  views: number;
}

export interface UnavailablePost {
  id: string;
  unavailable: true;
}

export interface SocialPost {
  id: string;
  type: string;
  content: string;
  mediaUrls: string[];
  videoUrl: string | null;
  thumbnailUrl: string | null;
  isReel: boolean;
  isRepost: boolean;
  linkUrl: string | null;
  visibility: PostVisibility;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  user: AuthorLite;
  counts: PostCounts;
  reactionSummary: ReactionSummary;
  topReactions: ReactionType[];
  hashtags: string[];
  mentions: MentionRef[];
  viewer: PostViewer;
  repostOf: SocialPost | UnavailablePost | null;
  reason: string | null;
}

export interface CommentViewer {
  reaction: ReactionType | null;
  isAuthor: boolean;
}

export interface SocialComment {
  id: string;
  postId: string;
  parentId: string | null;
  content: string;
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  user: AuthorLite;
  mentions: MentionRef[];
  likeCount: number;
  replyCount: number;
  viewer: CommentViewer;
  previewReplies: SocialComment[];
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface FollowPerson extends AuthorLite {
  viewerFollows: boolean;
}

export interface ReactionEntry {
  user: AuthorLite;
  type: ReactionType;
  createdAt: string;
}

export interface TrendingTag {
  tag: string;
  postCount: number;
}

export interface ContentReport {
  id: string;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  createdAt: string;
  reportCount: number;
  reporter: AuthorLite | null;
  post: SocialPost | null;
  comment: SocialComment | null;
  resolvedBy: AuthorLite | null;
  resolvedAt: string | null;
  resolution: string | null;
}

// ---------------------------------------------------------------------------
// Normalisers
// ---------------------------------------------------------------------------

type Raw = Record<string, any>;

const asObject = (value: unknown): Raw => (value && typeof value === 'object' ? (value as Raw) : {});
const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);
const optStr = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);
const num = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};
const firstDefined = (...values: unknown[]): unknown => values.find((v) => v !== undefined && v !== null);

export function normalizeAuthor(raw: unknown): AuthorLite {
  const r = asObject(raw);
  const year = Number(r.batchYear);
  const tier = asObject(r.membershipTier);
  return {
    id: str(r.id),
    fullName: str(r.fullName, 'Alumni member') || 'Alumni member',
    profilePhotoUrl: optStr(r.profilePhotoUrl ?? r.avatarUrl),
    currentDesignation: optStr(r.currentDesignation),
    batchYear: Number.isInteger(year) && year > 0 ? year : null,
    membershipTier: typeof tier.name === 'string' ? { name: tier.name, badgeColor: optStr(tier.badgeColor) } : null,
  };
}

const normalizeMentions = (raw: unknown): MentionRef[] =>
  Array.isArray(raw)
    ? raw
        .map((m) => asObject(m))
        .filter((m) => typeof m.id === 'string' && typeof m.fullName === 'string' && m.fullName.trim())
        .map((m) => ({ id: m.id as string, fullName: (m.fullName as string).trim() }))
    : [];

const normalizeSummary = (raw: unknown): ReactionSummary => {
  const r = asObject(raw);
  const out: ReactionSummary = {};
  for (const type of REACTION_TYPES) {
    const n = num(r[type]);
    if (n > 0) out[type] = n;
  }
  return out;
};

/** Up to 3 reaction types, most used first (ties keep the canonical order). */
export function topReactionsOf(summary: ReactionSummary): ReactionType[] {
  return REACTION_TYPES.filter((t) => (summary[t] ?? 0) > 0)
    .sort((a, b) => (summary[b] ?? 0) - (summary[a] ?? 0))
    .slice(0, 3);
}

const stringArray = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((u): u is string => typeof u === 'string' && u.trim().length > 0) : [];

export const isUnavailablePost = (post: SocialPost | UnavailablePost | null | undefined): post is UnavailablePost =>
  !!post && (post as UnavailablePost).unavailable === true;

export function normalizePost(raw: unknown, depth = 0): SocialPost {
  const r = asObject(raw);
  const counts = asObject(r.counts);
  const legacyCount = asObject(r._count);
  const viewer = asObject(r.viewer);
  const summary = normalizeSummary(r.reactionSummary);
  const reactionCount = num(firstDefined(counts.reactions, r.likeCount, legacyCount.likes));

  let viewerReaction: ReactionType | null = isReactionType(viewer.reaction) ? viewer.reaction : null;
  if (!viewerReaction && !('reaction' in viewer) && r.isLiked === true) viewerReaction = 'LIKE';

  // v1 payloads have no summary: attribute the total to LIKE so the bubble still shows.
  const effectiveSummary =
    Object.keys(summary).length === 0 && reactionCount > 0 ? ({ LIKE: reactionCount } as ReactionSummary) : summary;
  const top = Array.isArray(r.topReactions)
    ? (r.topReactions as unknown[]).filter(isReactionType).slice(0, 3)
    : topReactionsOf(effectiveSummary);

  let repostOf: SocialPost | UnavailablePost | null = null;
  const rawOriginal = r.repostOf;
  if (rawOriginal && typeof rawOriginal === 'object') {
    const o = rawOriginal as Raw;
    repostOf =
      o.unavailable === true || depth > 0
        ? { id: str(o.id), unavailable: true }
        : normalizePost(o, depth + 1);
  } else if (r.isRepost === true || typeof r.repostOfId === 'string') {
    repostOf = { id: str(r.repostOfId), unavailable: true };
  }

  const visibility = (POST_VISIBILITIES as readonly string[]).includes(r.visibility) ? (r.visibility as PostVisibility) : 'PUBLIC';
  const user = normalizeAuthor(r.user);

  return {
    id: str(r.id),
    type: str(r.type, 'GENERAL') || 'GENERAL',
    content: str(r.content),
    mediaUrls: stringArray(r.mediaUrls),
    videoUrl: optStr(r.videoUrl),
    thumbnailUrl: optStr(r.thumbnailUrl),
    isReel: r.isReel === true,
    isRepost: r.isRepost === true || repostOf !== null,
    linkUrl: optStr(r.linkUrl),
    visibility,
    isPinned: r.isPinned === true,
    createdAt: str(r.createdAt),
    updatedAt: str(r.updatedAt, str(r.createdAt)),
    editedAt: optStr(r.editedAt),
    user,
    counts: {
      reactions: reactionCount,
      comments: num(firstDefined(counts.comments, r.commentCount, legacyCount.comments)),
      reposts: num(firstDefined(counts.reposts, r.repostCount)),
      views: num(firstDefined(counts.views, r.viewCount)),
    },
    reactionSummary: effectiveSummary,
    topReactions: top,
    hashtags: stringArray(r.hashtags).map((t) => t.replace(/^#/, '').toLowerCase()),
    mentions: normalizeMentions(r.mentions),
    viewer: {
      reaction: viewerReaction,
      saved: viewer.saved === true,
      reposted: viewer.reposted === true,
      isAuthor: viewer.isAuthor === true,
      followsAuthor: viewer.followsAuthor === true,
    },
    repostOf,
    reason: optStr(r.reason),
  };
}

export function normalizeComment(raw: unknown): SocialComment {
  const r = asObject(raw);
  const viewer = asObject(r.viewer);
  return {
    id: str(r.id),
    postId: str(r.postId),
    parentId: optStr(r.parentId),
    content: str(r.content),
    createdAt: str(r.createdAt),
    updatedAt: str(r.updatedAt, str(r.createdAt)),
    editedAt: optStr(r.editedAt),
    user: normalizeAuthor(r.user),
    mentions: normalizeMentions(r.mentions),
    likeCount: num(r.likeCount),
    replyCount: num(firstDefined(r.replyCount, Array.isArray(r.replies) ? r.replies.length : undefined)),
    viewer: {
      reaction: isReactionType(viewer.reaction) ? viewer.reaction : null,
      isAuthor: viewer.isAuthor === true,
    },
    previewReplies: (Array.isArray(r.previewReplies) ? r.previewReplies : Array.isArray(r.replies) ? r.replies : []).map(
      (reply: unknown) => ({ ...normalizeComment(reply), previewReplies: [] })
    ),
  };
}

/** Accepts `{ items, nextCursor }`, a bare array, or a v1 `{ data, pagination }` page. */
export function normalizePage<T>(data: unknown, normalizeItem: (raw: unknown) => T): CursorPage<T> {
  if (Array.isArray(data)) return { items: data.map(normalizeItem), nextCursor: null };
  const d = asObject(data);
  const rawItems = Array.isArray(d.items) ? d.items : Array.isArray(d.data) ? d.data : [];
  const next = typeof d.nextCursor === 'string' && d.nextCursor ? d.nextCursor : null;
  return { items: rawItems.map(normalizeItem), nextCursor: next };
}

export const normalizeFollowPerson = (raw: unknown): FollowPerson => ({
  ...normalizeAuthor(raw),
  viewerFollows: asObject(raw).viewerFollows === true,
});

export const normalizeReactionEntry = (raw: unknown): ReactionEntry => {
  const r = asObject(raw);
  return {
    user: normalizeAuthor(r.user),
    type: isReactionType(r.type) ? r.type : 'LIKE',
    createdAt: str(r.createdAt),
  };
};

export function normalizeTrending(data: unknown): TrendingTag[] {
  const list = Array.isArray(data) ? data : Array.isArray(asObject(data).items) ? asObject(data).items : [];
  return (list as unknown[])
    .map((t) => asObject(t))
    .filter((t) => typeof t.tag === 'string' && t.tag.trim())
    .map((t) => ({ tag: (t.tag as string).replace(/^#/, '').toLowerCase(), postCount: num(t.postCount) }));
}

export function normalizeReport(raw: unknown): ContentReport {
  const r = asObject(raw);
  return {
    id: str(r.id),
    reason: (REPORT_REASONS as readonly string[]).includes(r.reason) ? (r.reason as ReportReason) : 'OTHER',
    details: optStr(r.details),
    status: (REPORT_STATUSES as readonly string[]).includes(r.status) ? (r.status as ReportStatus) : 'OPEN',
    createdAt: str(r.createdAt),
    reportCount: Math.max(1, num(r.reportCount)),
    reporter: r.reporter ? normalizeAuthor(r.reporter) : null,
    post: r.post ? normalizePost(r.post) : null,
    comment: r.comment ? normalizeComment(r.comment) : null,
    resolvedBy: r.resolvedBy ? normalizeAuthor(r.resolvedBy) : null,
    resolvedAt: optStr(r.resolvedAt),
    resolution: optStr(r.resolution),
  };
}

// ---------------------------------------------------------------------------
// Optimistic reducers
// ---------------------------------------------------------------------------

/** The reaction a click produces: clicking the current reaction removes it. */
export const nextReaction = (current: ReactionType | null, clicked: ReactionType): ReactionType | null =>
  current === clicked ? null : clicked;

/** The post as it would look after the viewer's reaction becomes `next` (null = removed). */
export function applyPostReaction(post: SocialPost, next: ReactionType | null): SocialPost {
  const prev = post.viewer.reaction;
  if (prev === next) return post;
  const summary: ReactionSummary = { ...post.reactionSummary };
  if (prev) {
    const left = (summary[prev] ?? 0) - 1;
    if (left > 0) summary[prev] = left;
    else delete summary[prev];
  }
  if (next) summary[next] = (summary[next] ?? 0) + 1;
  const delta = (next ? 1 : 0) - (prev ? 1 : 0);
  return {
    ...post,
    reactionSummary: summary,
    topReactions: topReactionsOf(summary),
    counts: { ...post.counts, reactions: Math.max(0, post.counts.reactions + delta) },
    viewer: { ...post.viewer, reaction: next },
  };
}

export function applyCommentReaction(comment: SocialComment, next: ReactionType | null): SocialComment {
  const prev = comment.viewer.reaction;
  if (prev === next) return comment;
  const delta = (next ? 1 : 0) - (prev ? 1 : 0);
  return {
    ...comment,
    likeCount: Math.max(0, comment.likeCount + delta),
    viewer: { ...comment.viewer, reaction: next },
  };
}

/** Merge a server reaction response into a post (server numbers win when present). */
export function mergeReactionResponse(post: SocialPost, data: unknown): SocialPost {
  const d = asObject(data);
  const reaction = isReactionType(d.reaction) ? d.reaction : d.reaction === null ? null : post.viewer.reaction;
  const summary = d.reactionSummary ? normalizeSummary(d.reactionSummary) : post.reactionSummary;
  const counts = asObject(d.counts);
  const total = counts.reactions !== undefined ? num(counts.reactions) : d.likeCount !== undefined ? num(d.likeCount) : post.counts.reactions;
  return {
    ...post,
    reactionSummary: summary,
    topReactions: Array.isArray(d.topReactions) ? (d.topReactions as unknown[]).filter(isReactionType).slice(0, 3) : topReactionsOf(summary),
    counts: { ...post.counts, reactions: total },
    viewer: { ...post.viewer, reaction },
  };
}

/** The post a plain repost stands for (reactions, comments and saves act on the original). */
export function targetPost(post: SocialPost): SocialPost {
  if (post.isRepost && post.content.trim() === '' && post.repostOf && !isUnavailablePost(post.repostOf)) {
    return post.repostOf as SocialPost;
  }
  return post;
}

export const isPlainRepost = (post: SocialPost): boolean =>
  post.isRepost && post.content.trim() === '' && post.mediaUrls.length === 0 && !post.videoUrl;

// ---------------------------------------------------------------------------
// Rich text
// ---------------------------------------------------------------------------

export type ContentToken =
  | { kind: 'text'; value: string }
  | { kind: 'hashtag'; value: string; tag: string; href: string }
  | { kind: 'mention'; value: string; userId: string; href: string }
  | { kind: 'url'; value: string; href: string };

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const URL_PATTERN = String.raw`https?:\/\/[^\s<>"]*[^\s<>".,:;'!?)\]]`;
const HASHTAG_PATTERN = String.raw`#([A-Za-z0-9_]{1,50})(?![A-Za-z0-9_])`;

/**
 * Split post/comment text into plain text, #hashtags, @mentions (only the people the server
 * listed in `mentions`) and http(s) URLs. Output is data for React to render, never HTML.
 */
export function tokenizeContent(text: string, mentions: MentionRef[] = []): ContentToken[] {
  if (!text) return [];
  const names = [...mentions]
    .filter((m) => m.fullName)
    .sort((a, b) => b.fullName.length - a.fullName.length);
  const mentionPattern = names.length ? `@(${names.map((m) => escapeRegExp(m.fullName)).join('|')})(?![A-Za-z0-9_])` : null;
  const pattern = new RegExp(
    [`(${URL_PATTERN})`, HASHTAG_PATTERN, mentionPattern].filter(Boolean).join('|'),
    'g'
  );

  const tokens: ContentToken[] = [];
  let last = 0;
  const pushText = (value: string) => {
    if (!value) return;
    const prev = tokens.at(-1);
    if (prev?.kind === 'text') prev.value += value;
    else tokens.push({ kind: 'text', value });
  };

  for (const match of Array.from(text.matchAll(pattern))) {
    const index = match.index ?? 0;
    const [whole, url, tag, mentionName] = match;
    if (tag !== undefined) {
      // A hashtag must start a word: "C#sharp" or "page#3" stay text.
      const before = index > 0 ? text[index - 1] : '';
      if (before && /[A-Za-z0-9_&]/.test(before)) continue;
    }
    pushText(text.slice(last, index));
    if (url !== undefined) {
      tokens.push({ kind: 'url', value: url, href: url });
    } else if (tag !== undefined) {
      const lower = tag.toLowerCase();
      tokens.push({ kind: 'hashtag', value: whole, tag: lower, href: `/hashtags/${encodeURIComponent(lower)}` });
    } else if (mentionName !== undefined) {
      const person = names.find((m) => m.fullName === mentionName);
      if (person) {
        tokens.push({ kind: 'mention', value: whole, userId: person.id, href: `/profile/${encodeURIComponent(person.id)}` });
      } else {
        pushText(whole);
      }
    }
    last = index + whole.length;
  }
  pushText(text.slice(last));
  return tokens;
}

/** Lower-case hashtags in text, in order, without duplicates (mirrors the server's parser). */
export function extractHashtags(text: string): string[] {
  const seen = new Set<string>();
  for (const token of tokenizeContent(text)) {
    if (token.kind === 'hashtag') seen.add(token.tag);
  }
  return Array.from(seen);
}

/** The `@query` being typed at the caret, or null when the caret is not in a mention. */
export function findMentionQuery(text: string, caret: number): { query: string; start: number } | null {
  const upto = text.slice(0, caret);
  const match = /(^|\s)@([^\s@]{0,30})$/.exec(upto);
  if (!match) return null;
  return { query: match[2], start: upto.length - match[2].length - 1 };
}

/** Replace the `@query` at [start, caret) with `@Full Name ` and return the new caret. */
export function insertMention(text: string, start: number, caret: number, fullName: string): { text: string; caret: number } {
  const inserted = `@${fullName} `;
  return { text: text.slice(0, start) + inserted + text.slice(caret), caret: start + inserted.length };
}

/** Ids of chosen mentions whose `@Name` is still in the text. */
export function activeMentionIds(text: string, chosen: MentionRef[]): string[] {
  const ids = new Set<string>();
  for (const m of chosen) if (text.includes(`@${m.fullName}`)) ids.add(m.id);
  return Array.from(ids);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** 999 → "999", 1200 → "1.2k", 15000 → "15k", 2_500_000 → "2.5M". */
export function compactCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  const fmt = (value: number, suffix: string) => {
    const rounded = value >= 10 ? Math.floor(value) : Math.floor(value * 10) / 10;
    return `${String(rounded).replace(/\.0$/, '')}${suffix}`;
  };
  if (n < 1000) return String(Math.floor(n));
  if (n < 1_000_000) return fmt(n / 1000, 'k');
  return fmt(n / 1_000_000, 'M');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "just now", "5m", "3h", "2d", "3w", then "Oct 3" (or "Oct 3, 2024" in another year). */
export function relativeTime(value: string | Date | null | undefined, now: Date = new Date()): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  const t = date.getTime();
  if (Number.isNaN(t)) return '';
  const seconds = Math.floor((now.getTime() - t) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 28) return `${Math.floor(days / 7)}w`;
  const label = `${MONTHS.at(date.getMonth())} ${date.getDate()}`;
  return date.getFullYear() === now.getFullYear() ? label : `${label}, ${date.getFullYear()}`;
}

/** Absolute link to a post (for sharing). */
export function postUrl(postId: string, origin: string = typeof window !== 'undefined' ? window.location.origin : ''): string {
  return `${origin}/posts/${encodeURIComponent(postId)}`;
}

/** The comment id from a `#comment-<id>` hash, if any. */
export const commentIdFromHash = (hash: string | null | undefined): string | null => {
  const match = /^#comment-([\w-]+)$/.exec(hash ?? '');
  return match ? match[1] : null;
};

/** Resolve an API-relative media path (`/uploads/...`) against the API origin. */
export function mediaSrc(url: string | null | undefined): string {
  if (!url) return '';
  if (/^(https?:|blob:|data:)/i.test(url)) return url;
  const base = String(api.defaults.baseURL || '').replace(/\/api\/?$/, '');
  return url.startsWith('/uploads') && base ? `${base}${url}` : url;
}

export function validateVideoFile(file: Pick<File, 'type' | 'size'>): string | null {
  if (!(VIDEO_MIME_TYPES as readonly string[]).includes(file.type)) return 'Choose an MP4, WebM or MOV video.';
  if (file.size > MAX_VIDEO_BYTES) return 'Videos can be at most 100 MB.';
  return null;
}

const viewedThisSession = new Set<string>();

/** Record one view per post per page session (the server also de-duplicates per member). */
export function recordViewOnce(postId: string): boolean {
  if (!postId || viewedThisSession.has(postId)) return false;
  viewedThisSession.add(postId);
  void socialApi.view(postId).catch(() => undefined);
  return true;
}

/** Test hook: forget which posts were viewed. */
export const resetViewedPosts = () => viewedThisSession.clear();

export const isAdminViewer = (role: unknown): boolean => role === 'ADMIN' || role === 'SUPER_ADMIN';

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

const seg = (id: string) => encodeURIComponent(id);
const data = (res: { data?: { data?: unknown } }) => res.data?.data;
type Opts = { signal?: AbortSignal };

export interface CreatePostInput {
  content?: string;
  type?: string;
  mediaUrls?: string[];
  videoUrl?: string | null;
  thumbnailUrl?: string | null;
  isReel?: boolean;
  visibility?: PostVisibility;
  linkUrl?: string | null;
  mentionIds?: string[];
}

const page = (cursor?: string | null, limit?: number) => ({
  ...(cursor ? { cursor } : {}),
  ...(limit ? { limit } : {}),
});

export const socialApi = {
  feed: async (tab: FeedTab, cursor?: string | null, opts: Opts & { limit?: number } = {}) =>
    normalizePage(data(await api.get('/feed', { params: { tab, ...page(cursor, opts.limit) }, signal: opts.signal })), normalizePost),
  getPost: async (id: string, opts: Opts = {}) => normalizePost(data(await api.get(`/posts/${seg(id)}`, { signal: opts.signal }))),
  createPost: async (input: CreatePostInput) => normalizePost(data(await api.post('/posts', input))),
  updatePost: async (id: string, input: Partial<CreatePostInput> & { isPinned?: boolean }) =>
    normalizePost(data(await api.patch(`/posts/${seg(id)}`, input))),
  deletePost: (id: string) => api.delete(`/posts/${seg(id)}`),
  react: async (id: string, type: ReactionType) => data(await api.post(`/posts/${seg(id)}/react`, { type })),
  reactions: async (id: string, params: { type?: ReactionType; cursor?: string | null; limit?: number } = {}, opts: Opts = {}) =>
    normalizePage(
      data(await api.get(`/posts/${seg(id)}/reactions`, { params: { ...(params.type ? { type: params.type } : {}), ...page(params.cursor, params.limit) }, signal: opts.signal })),
      normalizeReactionEntry
    ),
  view: (id: string) => api.post(`/posts/${seg(id)}/view`),
  comments: async (postId: string, params: { sort?: 'top' | 'newest'; cursor?: string | null; limit?: number } = {}, opts: Opts = {}) =>
    normalizePage(
      data(await api.get(`/posts/${seg(postId)}/comments`, { params: { sort: params.sort ?? 'top', ...page(params.cursor, params.limit) }, signal: opts.signal })),
      normalizeComment
    ),
  replies: async (commentId: string, cursor?: string | null, opts: Opts & { limit?: number } = {}) =>
    normalizePage(data(await api.get(`/comments/${seg(commentId)}/replies`, { params: page(cursor, opts.limit), signal: opts.signal })), normalizeComment),
  addComment: async (postId: string, input: { content: string; parentId?: string | null; mentionIds?: string[] }) =>
    normalizeComment(data(await api.post(`/posts/${seg(postId)}/comments`, input))),
  updateComment: async (id: string, input: { content: string; mentionIds?: string[] }) =>
    normalizeComment(data(await api.patch(`/comments/${seg(id)}`, input))),
  deleteComment: (id: string) => api.delete(`/comments/${seg(id)}`),
  reactComment: async (id: string, type: ReactionType) => data(await api.post(`/comments/${seg(id)}/react`, { type })),
  repost: async (id: string, input: { content?: string; visibility?: PostVisibility } = {}) =>
    normalizePost(data(await api.post(`/posts/${seg(id)}/repost`, input))),
  undoRepost: async (id: string) => data(await api.delete(`/posts/${seg(id)}/repost`)),
  toggleSave: async (id: string) => data(await api.post(`/posts/${seg(id)}/save`)),
  saved: async (cursor?: string | null, opts: Opts = {}) =>
    normalizePage(data(await api.get('/saved', { params: page(cursor), signal: opts.signal })), normalizePost),
  follow: async (userId: string) => data(await api.post(`/users/${seg(userId)}/follow`)),
  unfollow: async (userId: string) => data(await api.delete(`/users/${seg(userId)}/follow`)),
  followers: async (userId: string, cursor?: string | null, opts: Opts = {}) =>
    normalizePage(data(await api.get(`/users/${seg(userId)}/followers`, { params: page(cursor), signal: opts.signal })), normalizeFollowPerson),
  following: async (userId: string, cursor?: string | null, opts: Opts = {}) =>
    normalizePage(data(await api.get(`/users/${seg(userId)}/following`, { params: page(cursor), signal: opts.signal })), normalizeFollowPerson),
  userPosts: async (userId: string, params: { cursor?: string | null; reels?: boolean } = {}, opts: Opts = {}) =>
    normalizePage(
      data(await api.get(`/users/${seg(userId)}/posts`, { params: { ...page(params.cursor), ...(params.reels ? { reels: true } : {}) }, signal: opts.signal })),
      normalizePost
    ),
  mentionSearch: async (q: string, opts: Opts = {}) => {
    const d = data(await api.get('/users/mention-search', { params: { q, limit: 8 }, signal: opts.signal }));
    return (Array.isArray(d) ? d : asObject(d).items ?? []).map(normalizeAuthor) as AuthorLite[];
  },
  trending: async (opts: Opts & { days?: number; limit?: number } = {}) =>
    normalizeTrending(data(await api.get('/hashtags/trending', { params: { days: opts.days ?? 7, limit: opts.limit ?? 10 }, signal: opts.signal }))),
  hashtagPosts: async (tag: string, cursor?: string | null, opts: Opts = {}) =>
    normalizePage(data(await api.get(`/hashtags/${seg(tag)}/posts`, { params: page(cursor), signal: opts.signal })), normalizePost),
  reportPost: async (id: string, input: { reason: ReportReason; details?: string }) => data(await api.post(`/posts/${seg(id)}/report`, input)),
  reportComment: async (id: string, input: { reason: ReportReason; details?: string }) =>
    data(await api.post(`/comments/${seg(id)}/report`, input)),
  adminReports: async (status: ReportStatus, cursor?: string | null, opts: Opts = {}) =>
    normalizePage(data(await api.get('/admin/reports', { params: { status, ...page(cursor) }, signal: opts.signal })), normalizeReport),
  resolveReport: async (id: string, input: { action: 'DISMISS' | 'REMOVE_CONTENT'; note?: string }) =>
    data(await api.patch(`/admin/reports/${seg(id)}`, input)),
  uploadImages: async (files: File[]): Promise<string[]> => {
    const form = new FormData();
    files.forEach((f) => form.append('media', f));
    const d = asObject(data(await api.post('/posts/media', form, { headers: { 'Content-Type': 'multipart/form-data' } })));
    return stringArray(d.urls ?? d.mediaUrls ?? (Array.isArray(d) ? d : []));
  },
  uploadVideo: async (file: File, onProgress?: (percent: number) => void): Promise<{ url: string; mimeType: string; size: number }> => {
    const form = new FormData();
    form.append('video', file);
    const d = asObject(
      data(
        await api.post('/posts/video', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (e: AxiosProgressEvent) => {
            if (onProgress && e.total) onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
          },
        })
      )
    );
    return { url: str(d.url), mimeType: str(d.mimeType, file.type), size: num(d.size) || file.size };
  },
};

export type SocialApi = typeof socialApi;
