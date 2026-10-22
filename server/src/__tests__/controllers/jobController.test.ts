jest.mock('../../services/jobService', () => ({
  jobService: {
    getJobs: jest.fn(),
    getJob: jest.fn(),
    createJob: jest.fn(),
    updateJob: jest.fn(),
    deleteJob: jest.fn(),
    approveJob: jest.fn(),
    rejectJob: jest.fn(),
    getMyJobs: jest.fn(),
  },
}));
jest.mock('../../services/auditService', () => ({ logAuditAction: jest.fn() }));

import { jobController, parseJobFilters } from '../../controllers/jobController';
import { jobService } from '../../services/jobService';
import { logAuditAction } from '../../services/auditService';
import { mockReqRes } from '../../../tests/helpers';

const svc = jobService as unknown as Record<string, jest.Mock>;
const audit = logAuditAction as jest.Mock;

const member = { id: 'u1', userRole: 'MEMBER' };
const admin = { id: 'adm', userRole: 'ADMIN' };
const boom = Object.assign(new Error('boom'), { statusCode: 418 });

beforeEach(() => {
  Object.values(svc).forEach((fn) => fn.mockReset());
  audit.mockReset().mockResolvedValue(undefined);
});

describe('parseJobFilters', () => {
  it("maps the client's type/search aliases and whitelists params", () => {
    expect(
      parseJobFilters({ type: 'INTERNSHIP', search: ' react ', location: 'Pune', page: '3', limit: '5', status: 'DRAFT' } as any)
    ).toEqual({
      jobType: 'INTERNSHIP',
      workplaceType: undefined,
      location: 'Pune',
      industry: undefined,
      skills: undefined,
      experience: undefined,
      search: 'react',
      page: 3,
      limit: 5,
    });
  });

  it('prefers explicit names, parses experience and falls back on bad numbers', () => {
    const f = parseJobFilters({ jobType: 'CONTRACT', type: 'X', keyword: 'go', experience: '4', page: 'abc', workplaceType: 'REMOTE', industry: 'AI', skills: 'Go' } as any);
    expect(f).toMatchObject({ jobType: 'CONTRACT', search: 'go', experience: 4, page: 1, limit: 12, workplaceType: 'REMOTE', industry: 'AI', skills: 'Go' });
    expect(parseJobFilters({ q: 'rust', experience: ['1'] } as any)).toMatchObject({ search: 'rust', experience: undefined });
  });
});

describe('jobController', () => {
  it('getJobs passes parsed filters and spreads the paginated result', async () => {
    svc.getJobs.mockResolvedValue({ data: [], pagination: { total: 0 } });
    const { req, res, next } = mockReqRes({ query: { type: 'FULL_TIME' } });
    await jobController.getJobs(req, res, next);
    expect(svc.getJobs).toHaveBeenCalledWith(expect.objectContaining({ jobType: 'FULL_TIME', page: 1, limit: 12 }));
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [], pagination: { total: 0 } });
  });

  it('getJob passes the viewer (or null for anonymous)', async () => {
    svc.getJob.mockResolvedValue({ id: 'j1' });
    const anon = mockReqRes({ params: { id: 'j1' } });
    await jobController.getJob(anon.req, anon.res, anon.next);
    expect(svc.getJob).toHaveBeenLastCalledWith('j1', null);

    const signedIn = mockReqRes({ params: { id: 'j1' }, user: { ...member, email: 'x' } });
    await jobController.getJob(signedIn.req, signedIn.res, signedIn.next);
    expect(svc.getJob).toHaveBeenLastCalledWith('j1', member);
    expect(signedIn.res.json).toHaveBeenCalledWith({ success: true, data: { id: 'j1' } });
  });

  it('createJob passes admin-ness and returns 201', async () => {
    svc.createJob.mockResolvedValue({ id: 'j1' });
    const m = mockReqRes({ body: { title: 't' }, user: member });
    await jobController.createJob(m.req, m.res, m.next);
    expect(svc.createJob).toHaveBeenLastCalledWith('u1', { title: 't' }, false);
    expect(m.res.status).toHaveBeenCalledWith(201);

    const a = mockReqRes({ body: { title: 't' }, user: admin });
    await jobController.createJob(a.req, a.res, a.next);
    expect(svc.createJob).toHaveBeenLastCalledWith('adm', { title: 't' }, true);
  });

  it('updateJob / deleteJob pass the admin flag', async () => {
    svc.updateJob.mockResolvedValue({ id: 'j1' });
    svc.deleteJob.mockResolvedValue({ message: 'ok' });
    const u = mockReqRes({ params: { id: 'j1' }, body: { title: 'x' }, user: { id: 'ca', userRole: 'CHAPTER_ADMIN' } });
    await jobController.updateJob(u.req, u.res, u.next);
    expect(svc.updateJob).toHaveBeenCalledWith('ca', 'j1', { title: 'x' }, false);

    const d = mockReqRes({ params: { id: 'j1' }, user: { id: 'sa', userRole: 'SUPER_ADMIN' } });
    await jobController.deleteJob(d.req, d.res, d.next);
    expect(svc.deleteJob).toHaveBeenCalledWith('sa', 'j1', true);
    expect(d.res.json).toHaveBeenCalledWith({ success: true, data: { message: 'ok' } });
  });

  it('approveJob audits PENDING_REVIEW -> PUBLISHED', async () => {
    svc.approveJob.mockResolvedValue({ id: 'j1', status: 'PUBLISHED' });
    const { req, res, next } = mockReqRes({ params: { id: 'j1' }, user: admin, ip: '1.2.3.4', headers: { 'user-agent': 'jest' } });
    await jobController.approveJob(req, res, next);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'adm',
        action: 'APPROVE',
        entityType: 'JOB',
        entityId: 'j1',
        oldValues: { status: 'PENDING_REVIEW' },
        newValues: { status: 'PUBLISHED' },
        ipAddress: '1.2.3.4',
        userAgent: 'jest',
      })
    );
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { id: 'j1', status: 'PUBLISHED' } });
  });

  it('rejectJob passes the reason and audits it', async () => {
    svc.rejectJob.mockResolvedValue({ id: 'j1', status: 'REJECTED', rejectionReason: 'Spam' });
    const { req, res, next } = mockReqRes({ params: { id: 'j1' }, body: { reason: 'Spam' }, user: admin });
    await jobController.rejectJob(req, res, next);
    expect(svc.rejectJob).toHaveBeenCalledWith('j1', 'Spam');
    expect(audit.mock.calls[0][0].newValues).toEqual({ status: 'REJECTED', reason: 'Spam' });
    expect(res.json).toHaveBeenCalled();
  });

  it('rejectJob tolerates a missing body', async () => {
    svc.rejectJob.mockResolvedValue({ id: 'j1', rejectionReason: null });
    const { req, res, next } = mockReqRes({ params: { id: 'j1' }, body: undefined, user: admin });
    await jobController.rejectJob(req, res, next);
    expect(svc.rejectJob).toHaveBeenCalledWith('j1', undefined);
    expect(next).not.toHaveBeenCalled();
  });

  it('a failing audit log never fails moderation', async () => {
    svc.approveJob.mockResolvedValue({ id: 'j1' });
    svc.rejectJob.mockResolvedValue({ id: 'j1' });
    audit.mockRejectedValue(new Error('audit down'));
    const a = mockReqRes({ params: { id: 'j1' }, user: admin });
    await jobController.approveJob(a.req, a.res, a.next);
    const r = mockReqRes({ params: { id: 'j1' }, body: {}, user: admin });
    await jobController.rejectJob(r.req, r.res, r.next);
    await new Promise((resolve) => setImmediate(resolve));
    expect(a.res.json).toHaveBeenCalled();
    expect(r.res.json).toHaveBeenCalled();
    expect(a.next).not.toHaveBeenCalled();
  });

  it('getMyJobs parses paging with defaults', async () => {
    svc.getMyJobs.mockResolvedValue({ data: [], pagination: {} });
    const a = mockReqRes({ query: { page: '2', limit: '20' }, user: member });
    await jobController.getMyJobs(a.req, a.res, a.next);
    expect(svc.getMyJobs).toHaveBeenLastCalledWith('u1', 2, 20);
    const b = mockReqRes({ query: {}, user: member });
    await jobController.getMyJobs(b.req, b.res, b.next);
    expect(svc.getMyJobs).toHaveBeenLastCalledWith('u1', 1, 10);
  });

  it.each([
    ['getJobs', {}],
    ['getJob', { params: { id: 'j1' } }],
    ['createJob', { user: member }],
    ['updateJob', { params: { id: 'j1' }, user: member }],
    ['deleteJob', { params: { id: 'j1' }, user: member }],
    ['approveJob', { params: { id: 'j1' }, user: admin }],
    ['rejectJob', { params: { id: 'j1' }, user: admin }],
    ['getMyJobs', { user: member }],
  ])('%s forwards service errors to next()', async (method, reqInit) => {
    svc[method].mockRejectedValue(boom);
    const { req, res, next } = mockReqRes(reqInit as any);
    await (jobController as any)[method](req, res, next);
    expect(next).toHaveBeenCalledWith(boom);
    expect(res.json).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
});
