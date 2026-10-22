# Alumni Social — API contract (v2, 2026-10-19)

The contract the server implements and the client builds against for the social layer: reactions,
threaded comments, reposts and quote posts, mentions, hashtags, follows, saved posts, reels, views,
reporting and the ranked feed. AI features are out of scope.

Conventions (unchanged from v1): everything under `/api`; responses are `{ success: true, data }` or
`{ success: false, error: { message, code } }`; auth is the existing Bearer access token. Lists use
**cursor pagination**: `?cursor=<opaque>&limit=<n>` → `data: { items: [...], nextCursor: string | null }`
(limit default 20, max 50; a malformed cursor → 400 `INVALID_CURSOR`).

## Enums

```
ReactionType   = LIKE | CELEBRATE | SUPPORT | LOVE | INSIGHTFUL | FUNNY
PostVisibility = PUBLIC | CONNECTIONS
ReportReason   = SPAM | HARASSMENT | INAPPROPRIATE | MISINFORMATION | OTHER
ReportStatus   = OPEN | RESOLVED | DISMISSED
FeedTab        = for-you | following | latest
```

New notification types: `POST_REACTED` (replaces `POST_LIKED` for new rows), `COMMENT_REPLIED`,
`COMMENT_REACTED`, `POST_REPOSTED`, `NEW_FOLLOWER`, `CONTENT_REPORTED` (to admins). `MENTION` already exists.
Notification links: a post → `/posts/<id>` (optionally `#comment-<commentId>`), a person → `/profile/<id>`,
reports → `/admin/reports`.

## Shapes

`AuthorLite` = `{ id, fullName, profilePhotoUrl, currentDesignation, batchYear }`

`PostView` (feed items, post detail, reels, saved, hashtag pages, create/update/repost responses):

```jsonc
{
  "id": "uuid",
  "type": "GENERAL | JOB | BUSINESS | ANNOUNCEMENT",
  "content": "string (may be '' for a plain repost or a media-only post)",
  "mediaUrls": ["/uploads/posts/a.jpg"],      // images, max 10
  "videoUrl": "/uploads/videos/x.mp4" ,        // or null
  "thumbnailUrl": "/uploads/posts/x.jpg",      // or null (poster image for the video)
  "isReel": false,
  "isRepost": false,                            // true for plain reposts AND quote posts
  "linkUrl": null,
  "visibility": "PUBLIC",
  "isPinned": false,
  "createdAt": "ISO", "updatedAt": "ISO", "editedAt": "ISO | null",
  "user": { /* AuthorLite */ "membershipTier": { "name": "Gold", "badgeColor": "#..." } },
  "counts": { "reactions": 12, "comments": 4, "reposts": 2, "views": 0 },
  "reactionSummary": { "LIKE": 8, "CELEBRATE": 4 },   // only non-zero types
  "topReactions": ["LIKE", "CELEBRATE"],              // up to 3, most used first
  "hashtags": ["placements", "batch2015"],            // lower-case, no '#'
  "mentions": [{ "id": "uuid", "fullName": "Asha Rao" }],
  "viewer": {                                          // all false/null for anonymous viewers
    "reaction": "LIKE | null",
    "saved": false,
    "reposted": false,        // viewer has a PLAIN repost of this post (or of its original)
    "isAuthor": false,
    "followsAuthor": false
  },
  // Present when isRepost: the original, as a PostView without its own repostOf.
  // { "id": "uuid", "unavailable": true } when the original was deleted or is not visible to the viewer.
  "repostOf": null,
  // Feed only: why this item is here, for "Asha reposted" style headers on plain reposts.
  "reason": null,
  // v1 compatibility (kept so older screens keep working)
  "likeCount": 12, "commentCount": 4, "isLiked": true, "_count": { "likes": 12, "comments": 4 }
}
```

A **plain repost** is a Post with `isRepost: true`, `content: ''`, no media, pointing at the original.
In feeds the client renders it as the original with a "<name> reposted" header. A **quote post** is
`isRepost: true` with content; it renders the author's text and the original embedded as a card.
Reposting a repost always targets the root original.

`CommentView`:

```jsonc
{
  "id": "uuid", "postId": "uuid", "parentId": null, "content": "string",
  "createdAt": "ISO", "updatedAt": "ISO", "editedAt": "ISO | null",
  "user": { /* AuthorLite */ },
  "mentions": [{ "id": "uuid", "fullName": "..." }],
  "likeCount": 3,                 // all reaction types counted
  "replyCount": 2,                // top-level comments only (0 on replies)
  "viewer": { "reaction": "LIKE | null", "isAuthor": false }
}
```

Replies are one level deep: replying to a reply attaches to that reply's top-level parent.

## Endpoints

### Feed and posts

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/feed?tab=&cursor=&limit=` | member | `for-you` (default): ranked, last 14 days, connections/followed boosted. `following`: people the viewer follows or is connected with, plus own posts, newest first. `latest`: everything visible, newest first. Includes reels. Plain reposts of the same original collapse to one item. |
| GET | `/posts` | optional | v1 endpoint, unchanged shape (paginated). |
| GET | `/posts/:id` | optional | `PostView`. 404 when deleted, unpublished, or CONNECTIONS-only and the viewer is not connected/author/admin. |
| POST | `/posts` | member | Body `{ content?, type?, mediaUrls?, videoUrl?, thumbnailUrl?, isReel?, visibility?, linkUrl?, mentionIds? }`. Needs content, an image or a video. `isReel` requires `videoUrl`. `videoUrl`/`thumbnailUrl` must be files uploaded through this API. Hashtags are parsed from content (`#[A-Za-z0-9_]{1,50}`, max 30). `mentionIds` (max 20, existing active users) are notified (`MENTION`). → 201 `PostView`. |
| PATCH | `/posts/:id` | author (content) / admin (`isPinned` only) | As v1, plus `visibility`, `mentionIds`; sets `editedAt`, re-parses hashtags, notifies only newly mentioned people. |
| DELETE | `/posts/:id` | author or admin | As v1. Plain reposts of it disappear from feeds; quote posts keep their text and show `repostOf: { id, unavailable: true }`. |
| POST | `/posts/media` | member | v1 image upload (field `media`, up to 5) → `{ urls: string[] }`. |
| POST | `/posts/video` | member | Multipart field `video`: MP4, WebM or MOV, ≤ 100 MB, content sniffed (not just the extension). → 201 `{ url, mimeType, size }`. 400 `INVALID_FILE_TYPE`, 413 `FILE_TOO_LARGE`. |
| POST | `/posts/:id/view` | optional | Counts one view per signed-in member per post (anonymous calls are accepted and ignored). → `{ views }`. |

### Reactions

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/posts/:id/react` | member | Body `{ type: ReactionType }`. Sets or changes the viewer's reaction; sending the current type again removes it. → `{ reaction: ReactionType \| null, counts: { reactions }, reactionSummary, topReactions }`. Notifies the author (`POST_REACTED`) on a new reaction, not on changes/removals or self-reactions. |
| POST | `/posts/:id/like` | member | v1 toggle, kept: equivalent to `react` with `LIKE`. Response `{ liked, likeCount, reaction }`. |
| GET | `/posts/:id/reactions?type=&cursor=&limit=` | member | `items: [{ user: AuthorLite, type, createdAt }]`, newest first. |
| POST | `/comments/:id/react` | member | Body `{ type }`, same toggle rules. → `{ reaction, likeCount }`. Notifies the comment author (`COMMENT_REACTED`). |

### Comments

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/posts/:id/comments?sort=top\|newest&cursor=&limit=` | optional | Top-level `CommentView`s. `top` = most reactions + replies first, then newest. Each item also carries `previewReplies: CommentView[]` (first 2, oldest first). |
| GET | `/comments/:id/replies?cursor=&limit=` | optional | Replies oldest first. |
| POST | `/posts/:postId/comments` | member | Body `{ content, parentId?, mentionIds? }` → 201 `CommentView`. Notifies: post author (`POST_COMMENTED`), parent comment author on a reply (`COMMENT_REPLIED`), mentioned people (`MENTION`); nobody is notified twice for one comment, nobody for their own action. |
| PATCH | `/comments/:id` | author | v1, plus `mentionIds`; sets `editedAt`. |
| DELETE | `/comments/:id` | author, post author, or admin | v1 rule plus: the post's author may remove comments on their own post. |

### Reposts

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/posts/:id/repost` | member | Body `{ content?, visibility? }`. No content → plain repost (409 `ALREADY_REPOSTED` if the viewer already has one of that original). With content → quote post. Only PUBLIC posts can be reposted (403 `NOT_REPOSTABLE`), and not your own plain repost of your own post. Notifies the original author (`POST_REPOSTED`). → 201 `PostView`. |
| DELETE | `/posts/:id/repost` | member | Removes the viewer's plain repost of that original. → `{ reposted: false, counts: { reposts } }`. |

### Saved posts

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/posts/:id/save` | member | Toggle → `{ saved }`. |
| GET | `/saved?cursor=&limit=` | member | `PostView`s, most recently saved first. |

### Follows

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/users/:id/follow` | member | Idempotent; 400 on self. Notifies (`NEW_FOLLOWER`). → `{ following: true, followerCount }`. |
| DELETE | `/users/:id/follow` | member | → `{ following: false, followerCount }`. |
| GET | `/users/:id/followers?cursor=` / `/users/:id/following?cursor=` | member | `items: [AuthorLite & { viewerFollows: boolean }]`. |
| GET | `/users/:id` | optional | v1 profile, plus `followerCount`, `followingCount`, `isFollowing`, `postCount`. |
| GET | `/users/:id/posts?cursor=&reels=` | optional | That member's `PostView`s (visibility rules apply). |
| GET | `/users/mention-search?q=&limit=` | member | ≥ 1 character; active, verified members by name, connections and followed people first. → `AuthorLite[]` (max 10). |

### Hashtags and reels

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/hashtags/trending?days=7&limit=10` | optional | `[{ tag, postCount }]` over posts in the window (days 1–30). |
| GET | `/hashtags/:tag/posts?cursor=` | optional | Visible `PostView`s with that tag, newest first. |
| GET | `/reels?cursor=&limit=` | optional | Visible reels, ranked like `for-you` for members, newest first for anonymous visitors. |

### Reporting and moderation

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/posts/:id/report`, `/comments/:id/report` | member | Body `{ reason: ReportReason, details? (≤ 500) }`. One OPEN report per member per item (409 `ALREADY_REPORTED`); can't report your own content. Notifies admins (`CONTENT_REPORTED`). → 201 `{ id, status }`. |
| GET | `/admin/reports?status=OPEN&cursor=` | admin | `items: [{ id, reason, details, status, createdAt, reporter: AuthorLite, post?: PostView, comment?: CommentView, resolvedBy?, resolvedAt?, resolution? }]`; open reports on the same item are grouped server-side into one item with `reportCount`. |
| PATCH | `/admin/reports/:id` | admin | Body `{ action: DISMISS \| REMOVE_CONTENT, note? }`. `REMOVE_CONTENT` deletes the post/comment and resolves every open report on it; both write an audit entry (`CONTENT_REMOVED` / `REPORT_DISMISSED`). |

## Ranking (`for-you`, reels for members)

Candidates: visible posts from the last 14 days (cap 500). Score:

```
engagement = reactions + 2·comments + 3·reposts + 0.05·views
affinity   = 1.0 (+0.6 if the viewer follows the author, +0.6 if connected, +0.3 same batch)
score      = (1 + engagement) · affinity / (hours_since_posted + 2) ^ 1.3
```

Pinned posts come first on page 1. The cursor encodes the ranking snapshot (time + offset), so
paging is stable while new posts arrive.
