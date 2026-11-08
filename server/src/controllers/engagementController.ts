import { Request, Response, NextFunction } from 'express';
import { collegeRequirementService } from '../services/collegeRequirementService';
import { referralService } from '../services/referralService';
import { digestService } from '../services/digestService';
import { landingService } from '../services/landingService';
import { Actor } from '../config/permissions';

type Handler = (req: Request, res: Response) => Promise<unknown>;

const handle = (fn: Handler, status = 200) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await fn(req, res);
      if (!res.headersSent) res.status(status).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  };

const viewerOf = (req: Request): Actor | null => (req.user ? { id: req.user.id, userRole: req.user.userRole } : null);
const toInt = (v: unknown, fallback: number) => {
  const n = parseInt(v as string, 10);
  return Number.isFinite(n) ? n : fallback;
};
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const isTrue = (v: unknown) => v === true || v === 'true';

// ---------------- College Requirements ----------------
export const requirementController = {
  list: handle((req) =>
    collegeRequirementService.getRequirements(
      { status: str(req.query.status), category: str(req.query.category), search: str(req.query.search), page: toInt(req.query.page, 1), limit: toInt(req.query.limit, 12) },
      viewerOf(req)
    )
  ),
  get: handle((req) => collegeRequirementService.getRequirement(req.params.id, viewerOf(req))),
  create: handle((req) => collegeRequirementService.createRequirement(req.user!.id, req.body), 201),
  update: handle((req) => collegeRequirementService.updateRequirement(req.params.id, req.body)),
  remove: handle((req) => collegeRequirementService.deleteRequirement(req.params.id)),
  respond: handle((req) => collegeRequirementService.respond(req.user!.id, req.params.id, req.body?.message), 201),
  reviewResponse: handle((req) => collegeRequirementService.reviewResponse(req.params.responseId, isTrue(req.body?.accept))),
};

// ---------------- Job Referrals ----------------
export const referralController = {
  findReferrers: handle((req) => referralService.findReferrers(String(req.query.company ?? ''), req.user!.id)),
  create: handle((req) => referralService.createRequest(req.user!.id, req.body), 201),
  received: handle((req) => referralService.listMine(req.user!.id, 'received', { page: toInt(req.query.page, 1), limit: toInt(req.query.limit, 20) })),
  sent: handle((req) => referralService.listMine(req.user!.id, 'sent', { page: toInt(req.query.page, 1), limit: toInt(req.query.limit, 20) })),
  respond: handle((req) => referralService.respond(req.user!.id, req.params.id, isTrue(req.body?.accept))),
};

// ---------------- Weekly Digest (admin) ----------------
export const digestController = {
  getSettings: handle((_req) => digestService.getSettings()),
  updateSettings: handle((req) => digestService.updateSettings(req.body)),
  sendNow: handle(async (_req) => ({ sent: await digestService.sendDigest() })),
  sendTest: handle(async (req) => ({ sent: await digestService.sendDigest({ testUserId: req.user!.id }) })),
};

// ---------------- Landing Page Builder ----------------
export const landingController = {
  publicBlocks: handle((_req) => landingService.getBlocks(true)),
  adminBlocks: handle((_req) => landingService.getBlocks(false)),
  create: handle((req) => landingService.createBlock(req.body), 201),
  update: handle((req) => landingService.updateBlock(req.params.id, req.body)),
  remove: handle((req) => landingService.deleteBlock(req.params.id)),
  reorder: handle((req) => landingService.reorder(req.body?.ids)),
};
