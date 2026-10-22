import { api, authAs, getApp, mockReqRes } from '../../../tests/helpers';
import { buildReadinessReport, platformController } from '../../controllers/platformController';
import {
  buildModuleReadiness,
  deriveModuleStatus,
  getOpenGaps,
  getReleaseBlockers,
  moduleReadiness,
} from '../../config/platformReadiness';

const feature = (key: string, status: any, priority: any = 'P2') => ({ key, name: key, status, priority, notes: '' });

describe('platformReadiness config', () => {
  const allFeatures = moduleReadiness.flatMap((m) => m.features);
  const byKey = (key: string) => allFeatures.find((f) => f.key === key);

  it('derives module status from features', () => {
    expect(deriveModuleStatus([])).toBe('PLANNED');
    expect(deriveModuleStatus([feature('a', 'IMPLEMENTED')])).toBe('IMPLEMENTED');
    expect(deriveModuleStatus([feature('a', 'PLANNED'), feature('b', 'PLANNED')])).toBe('PLANNED');
    expect(deriveModuleStatus([feature('a', 'IMPLEMENTED'), feature('b', 'PLANNED')])).toBe('PARTIAL');
    for (const m of moduleReadiness) {
      expect(m.status).toBe(deriveModuleStatus(m.features));
    }
  });

  it('has unique module and feature keys', () => {
    const moduleKeys = moduleReadiness.map((m) => m.key);
    expect(new Set(moduleKeys).size).toBe(moduleKeys.length);
    const featureKeys = allFeatures.map((f) => f.key);
    expect(new Set(featureKeys).size).toBe(featureKeys.length);
  });

  it('reflects the delivered RBAC, admin, export, mentorship and privacy work', () => {
    for (const key of [
      'role-normalization',
      'release-readiness',
      'admin-user-management',
      'csv-exports',
      'mentorship-overview',
      'privacy-rights',
      'membership-purchase',
      'donations',
      'receipts',
    ]) {
      expect(byKey(key)?.status).toBe('IMPLEMENTED');
    }
    expect(byKey('role-normalization')?.notes).toMatch(/permissions\.ts/);
  });

  it('keeps Phase D enhancements PLANNED', () => {
    for (const key of ['ai-matching', 'push-notifications', 'mobile-apps', 'video-sessions']) {
      expect(byKey(key)?.status).toBe('PLANNED');
    }
    const phaseD = moduleReadiness.find((m) => m.key === 'strategic-enhancements')!;
    expect(phaseD.status).toBe('PLANNED');
    expect(phaseD.mustHave).toBe(false);
  });

  it('has no open release blockers and no high-risk partial modules', () => {
    expect(getReleaseBlockers()).toEqual([]);
    expect(moduleReadiness.filter((m) => m.status === 'PARTIAL' && m.risk === 'HIGH')).toEqual([]);
  });

  it('flags P0/P1 gaps in Must Have modules as blockers, ignoring P2 and optional modules', () => {
    const modules = buildModuleReadiness([
      {
        key: 'core',
        name: 'Core',
        risk: 'HIGH',
        owner: 'x',
        mustHave: true,
        features: [feature('a', 'PARTIAL', 'P0'), feature('b', 'PLANNED', 'P1'), feature('c', 'PARTIAL', 'P2'), feature('d', 'PARTIAL', undefined)],
      },
      { key: 'nice', name: 'Nice', risk: 'LOW', owner: 'x', mustHave: false, features: [feature('e', 'PLANNED', 'P0')] },
    ]);
    expect(getReleaseBlockers(modules).map((b) => b.feature)).toEqual(['a', 'b']);
    expect(getOpenGaps(modules).map((g) => [g.feature, g.priority])).toEqual([
      ['a', 'P0'],
      ['b', 'P1'],
      ['c', 'P2'],
      ['d', 'P2'],
      ['e', 'P0'],
    ]);
  });
});

describe('buildReadinessReport', () => {
  it('summarises modules and features consistently', () => {
    const now = new Date('2026-10-14T00:00:00Z');
    const report = buildReadinessReport(moduleReadiness, now);
    expect(report.generatedAt).toBe('2026-10-14T00:00:00.000Z');
    expect(report.summary.implemented + report.summary.partial + report.summary.planned).toBe(moduleReadiness.length);
    const features = moduleReadiness.flatMap((m) => m.features);
    expect(report.featureSummary.total).toBe(features.length);
    expect(report.featureSummary.implemented).toBe(features.filter((f) => f.status === 'IMPLEMENTED').length);
    expect(report.featureSummary.completionPercent).toBeGreaterThan(0);
    expect(report.featureSummary.completionPercent).toBeLessThanOrEqual(100);
    expect(report.releaseGate.releasable).toBe(true);
    expect(report.gaps.length).toBe(features.filter((f) => f.status !== 'IMPLEMENTED').length);
    expect(report.modules).toBe(moduleReadiness);
  });

  it('handles an empty module list without NaN', () => {
    const report = buildReadinessReport([]);
    expect(report.summary).toEqual({ implemented: 0, partial: 0, planned: 0 });
    expect(report.featureSummary).toEqual({ implemented: 0, partial: 0, planned: 0, total: 0, completionPercent: 0 });
    expect(report.releaseGate).toMatchObject({ releasable: true, blockers: [] });
  });

  it('is not releasable when a blocker exists', () => {
    const modules = buildModuleReadiness([
      { key: 'core', name: 'Core', risk: 'HIGH', owner: 'x', mustHave: true, features: [feature('a', 'PARTIAL', 'P0')] },
    ]);
    const report = buildReadinessReport(modules);
    expect(report.releaseGate.releasable).toBe(false);
    expect(report.releaseGate.blockers).toHaveLength(1);
    expect(report.summary.partial).toBe(1);
  });
});

describe('platformController.getReadiness', () => {
  it('responds with the readiness payload', async () => {
    const { req, res, next } = mockReqRes();
    await platformController.getReadiness(req, res, next);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data).toEqual(
      expect.objectContaining({
        version: expect.any(String),
        summary: expect.any(Object),
        featureSummary: expect.any(Object),
        releaseGate: expect.any(Object),
        gaps: expect.any(Array),
        modules: moduleReadiness,
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards unexpected errors', async () => {
    const { req, res, next } = mockReqRes();
    res.json.mockImplementationOnce(() => {
      throw new Error('serialise');
    });
    await platformController.getReadiness(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('GET /api/platform/readiness', () => {
  beforeAll(() => {
    getApp();
  }, 120000);

  it('is admin-only', async () => {
    const { header } = authAs('MEMBER');
    await api().get('/api/platform/readiness').set('Authorization', header).expect(403);
  });

  it('returns the report to admins', async () => {
    const { header } = authAs('ADMIN');
    const res = await api().get('/api/platform/readiness').set('Authorization', header).expect(200);
    expect(res.body.data.summary).toBeDefined();
    expect(res.body.data.modules.length).toBe(moduleReadiness.length);
  });
});
