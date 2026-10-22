import { Request, Response, NextFunction } from 'express';
import {
  ModuleReadiness,
  ReadinessStatus,
  getOpenGaps,
  getReleaseBlockers,
  moduleReadiness,
} from '../config/platformReadiness';

type StatusCounts = { implemented: number; partial: number; planned: number };

const emptyCounts = (): StatusCounts => ({ implemented: 0, partial: 0, planned: 0 });

const bump = (acc: StatusCounts, status: ReadinessStatus) => {
  if (status === 'IMPLEMENTED') acc.implemented += 1;
  if (status === 'PARTIAL') acc.partial += 1;
  if (status === 'PLANNED') acc.planned += 1;
  return acc;
};

/** Builds the readiness payload; exported for direct testing with custom module lists. */
export const buildReadinessReport = (modules: ModuleReadiness[], now: Date = new Date()) => {
  const summary = modules.reduce((acc, m) => bump(acc, m.status), emptyCounts());
  const featureSummary = modules
    .flatMap((m) => m.features)
    .reduce((acc, f) => bump(acc, f.status), emptyCounts());
  const totalFeatures = featureSummary.implemented + featureSummary.partial + featureSummary.planned;
  const blockers = getReleaseBlockers(modules);

  return {
    version: '2026.10',
    generatedAt: now.toISOString(),
    summary,
    featureSummary: {
      ...featureSummary,
      total: totalFeatures,
      // Share of features fully implemented (0 when there are no features — never NaN).
      completionPercent: totalFeatures > 0 ? Math.round((featureSummary.implemented / totalFeatures) * 100) : 0,
    },
    releaseGate: {
      releasable: blockers.length === 0,
      rule: 'No production release while any P0/P1 feature in a Must Have domain is not IMPLEMENTED (PRD §10.3).',
      blockers,
    },
    gaps: getOpenGaps(modules),
    modules,
  };
};

export const platformController = {
  async getReadiness(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json({ success: true, data: buildReadinessReport(moduleReadiness) });
    } catch (error) {
      next(error);
    }
  },
};
