/**
 * HTTP handlers for the social layer (docs/SOCIAL_API.md). Services enforce visibility and
 * ownership; these only shape requests and responses.
 */
import { Request, Response, NextFunction } from 'express';
import { invalidateCache } from '../middleware/cache';
import { feedService } from '../services/feedService';
import { followService } from '../services/followService';
import { hashtagService } from '../services/hashtagService';
import { postService } from '../services/postService';
import { reactionService } from '../services/reactionService';
import { reportService } from '../services/reportService';
import { repostService } from '../services/repostService';
import { storeVideo } from '../utils/storage';

type Handler = (req: Request, res: Response) => Promise<unknown>;

/** Wraps a handler: `{ success, data }` with the given status, errors to `next`. */
const handle = (fn: Handler, status = 200, invalidatesFeed = false) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await fn(req, res);
      if (invalidatesFeed) await invalidateCache('cache:/api/posts*');
      if (!res.headersSent) res.status(status).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  };

const viewer = (req: Request) => req.user!;

export const socialFeedController = {
  // Feeds
  getFeed: handle((req) => feedService.getFeed(viewer(req), req.query)),
  getReels: handle((req) => feedService.getReels(req.user, req.query)),
  getTrendingHashtags: handle((req) => hashtagService.getTrending(req.query.days, req.query.limit)),
  getHashtagPosts: handle((req) => feedService.getHashtagPosts(req.params.tag, req.user, req.query)),
  getUserPosts: handle((req) => feedService.getUserPosts(req.params.id, req.user, req.query)),
  getSaved: handle((req) => feedService.getSaved(viewer(req), req.query)),
  toggleSave: handle((req) => feedService.toggleSave(viewer(req), req.params.id)),

  // Reactions
  reactToPost: handle((req) => reactionService.reactToPost(viewer(req), req.params.id, req.body?.type), 200, true),
  listPostReactions: handle((req) => reactionService.listPostReactions(viewer(req), req.params.id, req.query)),
  reactToComment: handle((req) => reactionService.reactToComment(viewer(req), req.params.id, req.body?.type)),

  // Comments
  listComments: handle((req) => postService.listComments(req.params.id, req.user, req.query)),
  listReplies: handle((req) => postService.listReplies(req.params.id, req.user, req.query)),

  // Reposts and views
  repost: handle((req) => repostService.repost(viewer(req), req.params.id, req.body ?? {}), 201, true),
  undoRepost: handle((req) => repostService.undoRepost(viewer(req), req.params.id), 200, true),
  recordView: handle((req) => postService.recordView(req.params.id, req.user)),

  uploadVideo: handle(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ success: false, error: { message: 'No video uploaded (field "video")', code: 'NO_FILE' } });
      return undefined;
    }
    return storeVideo(req.file.path);
  }, 201),

  // Follows
  follow: handle((req) => followService.follow(viewer(req), req.params.id)),
  unfollow: handle((req) => followService.unfollow(viewer(req), req.params.id)),
  listFollowers: handle((req) => followService.listFollowers(viewer(req), req.params.id, req.query)),
  listFollowing: handle((req) => followService.listFollowing(viewer(req), req.params.id, req.query)),
  mentionSearch: handle((req) => followService.mentionSearch(viewer(req), req.query.q, req.query.limit)),

  // Reports
  reportPost: handle((req) => reportService.report(viewer(req), { kind: 'post', id: req.params.id }, req.body ?? {}), 201),
  reportComment: handle((req) => reportService.report(viewer(req), { kind: 'comment', id: req.params.id }, req.body ?? {}), 201),
  listReports: handle((req) => reportService.list(viewer(req), req.query)),
  resolveReport: handle((req) => reportService.resolve(viewer(req), req.params.id, req.body ?? {}), 200, true),
};
