import { Request, Response, NextFunction } from 'express';
import { collegeVideoService } from '../services/collegeVideoService';
import { collegeMagazineService } from '../services/collegeMagazineService';
import { storeVideo, uploadToStorage } from '../utils/storage';
import { Actor, isAdminRole } from '../config/permissions';

type Handler = (req: Request, res: Response) => Promise<unknown>;

/** Wraps a handler: `{ success, data }` at the given status, errors forwarded to next. */
const handle = (fn: Handler, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await fn(req, res);
      if (!res.headersSent) res.status(status).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  };

const actorOf = (req: Request): Actor => ({ id: req.user!.id, userRole: req.user!.userRole });
const viewerOf = (req: Request): Actor | null => (req.user ? actorOf(req) : null);
const isAdmin = (req: Request) => !!req.user && isAdminRole(req.user.userRole);
const toInt = (v: unknown, fallback: number) => {
  const n = parseInt(v as string, 10);
  return Number.isFinite(n) ? n : fallback;
};
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

const videoFilters = (req: Request) => ({
  page: toInt(req.query.page, 1),
  limit: toInt(req.query.limit, 12),
  status: str(req.query.status),
  category: str(req.query.category),
  search: str(req.query.search),
});

export const collegeVideoController = {
  list: handle((req) => collegeVideoService.getVideos(videoFilters(req), viewerOf(req))),
  mySubmissions: handle((req) =>
    collegeVideoService.getMySubmissions(req.user!.id, { page: toInt(req.query.page, 1), limit: toInt(req.query.limit, 12) })
  ),
  get: handle((req) => collegeVideoService.getVideo(req.params.id, viewerOf(req))),

  // Two-step upload: send the file here, then POST the returned videoUrl to `create`.
  uploadFile: handle(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ success: false, error: { message: 'No video uploaded (field "video")', code: 'NO_FILE' } });
      return undefined;
    }
    const stored = await storeVideo(req.file.path, 'college-videos');
    return { videoUrl: stored.url, mimeType: stored.mimeType, size: stored.size };
  }, 201),

  uploadThumbnail: handle(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ success: false, error: { message: 'No image uploaded (field "image")', code: 'NO_FILE' } });
      return undefined;
    }
    const url = await uploadToStorage(req.file, 'video-thumbnails');
    return { url };
  }, 201),

  create: handle((req) => collegeVideoService.createVideo(actorOf(req), req.body), 201),
  approve: handle((req) => collegeVideoService.approveVideo(req.user!.id, req.params.id)),
  reject: handle((req) => collegeVideoService.rejectVideo(req.user!.id, req.params.id, req.body?.reason)),
  update: handle((req) => collegeVideoService.updateVideo(req.params.id, req.body)),
  remove: handle((req) => collegeVideoService.deleteVideo(actorOf(req), req.params.id)),
};

export const collegeMagazineController = {
  list: handle((req) =>
    collegeMagazineService.getMagazines({
      page: toInt(req.query.page, 1),
      limit: toInt(req.query.limit, 12),
      includeUnpublished: isAdmin(req) && req.query.all === 'true',
    })
  ),
  get: handle((req) => collegeMagazineService.getMagazine(req.params.id, isAdmin(req))),

  uploadFile: handle(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ success: false, error: { message: 'No PDF uploaded (field "file")', code: 'NO_FILE' } });
      return undefined;
    }
    const url = await uploadToStorage(req.file, 'magazines');
    return { fileUrl: url };
  }, 201),

  uploadCover: handle(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ success: false, error: { message: 'No image uploaded (field "image")', code: 'NO_FILE' } });
      return undefined;
    }
    const url = await uploadToStorage(req.file, 'magazine-covers');
    return { url };
  }, 201),

  create: handle((req) => collegeMagazineService.createMagazine(req.user!.id, req.body), 201),
  update: handle((req) => collegeMagazineService.updateMagazine(req.params.id, req.body)),
  remove: handle((req) => collegeMagazineService.deleteMagazine(req.params.id)),
};
