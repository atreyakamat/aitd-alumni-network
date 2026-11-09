import { memberApprovalService } from '../../services/memberApprovalService';
import { config } from '../../config';
import { prismaMock } from '../../../tests/helpers';
import { logAuditAction } from '../../services/auditService';
import { sendWelcomeEmail, sendRejectionEmail } from '../../utils/email';

jest.mock('../../services/auditService', () => ({ logAuditAction: jest.fn().mockResolvedValue(undefined) }));

const ADMIN = { id: 'admin-1', userRole: 'ADMIN' as const };
const META = { ipAddress: '10.0.0.1', userAgent: 'jest' };

const applicant = (overrides: Record<string, unknown> = {}) => ({
  id: 'u1',
  fullName: 'Ada Alum',
  email: 'ada@aitd.edu',
  batchYear: 2015,
  department: 'Computer Engineering',
  degree: 'B.E.',
  roleType: 'ALUMNI',
  enrollmentNumber: '12CE045',
  verificationNote: 'Class of 2015',
  linkedinUrl: null,
  isActive: true,
  createdAt: new Date('2026-11-01T10:00:00Z'),
  emailVerifiedAt: new Date('2026-11-01T11:00:00Z'),
  approvalStatus: 'PENDING',
  approvalReviewedAt: null,
  approvalNote: null,
  approvalReviewedBy: null,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  config.auth.requireEmailVerification = false;
});

describe('review queue', () => {
  beforeEach(() => {
    prismaMock.user.findMany.mockResolvedValue([applicant()]);
    prismaMock.user.count.mockResolvedValue(1);
  });

  it('shows the registrations waiting for approval by default, oldest first', async () => {
    const result = await memberApprovalService.list({});
    const args = prismaMock.user.findMany.mock.calls[0][0];
    expect(args.where.approvalStatus).toBe('PENDING');
    expect(args.orderBy).toEqual({ createdAt: 'asc' });
    expect(result.data).toHaveLength(1);
    expect(result.pagination.total).toBe(1);
  });

  it('shows reviewed registrations most recently reviewed first', async () => {
    await memberApprovalService.list({ status: 'REJECTED' });
    const args = prismaMock.user.findMany.mock.calls[0][0];
    expect(args.where.approvalStatus).toBe('REJECTED');
    expect(args.orderBy).toEqual({ approvalReviewedAt: { sort: 'desc', nulls: 'last' } });
  });

  it('ignores a status it does not know instead of listing everybody', async () => {
    await memberApprovalService.list({ status: 'EVERYONE' });
    expect(prismaMock.user.findMany.mock.calls[0][0].where.approvalStatus).toBe('PENDING');
  });

  it('searches name, e-mail and enrolment number', async () => {
    await memberApprovalService.list({ search: ' 12CE ' });
    const or = prismaMock.user.findMany.mock.calls[0][0].where.OR;
    expect(or).toHaveLength(3);
    expect(JSON.stringify(or)).toContain('fullName');
    expect(JSON.stringify(or)).toContain('email');
    expect(JSON.stringify(or)).toContain('enrollmentNumber');
  });

  it('pages the list and caps the page size', async () => {
    await memberApprovalService.list({ page: 3, limit: 5000 });
    const args = prismaMock.user.findMany.mock.calls[0][0];
    expect(args.take).toBe(100);
    expect(args.skip).toBe(200);
  });

  it('never selects the password hash or any token', async () => {
    await memberApprovalService.list({});
    const select = prismaMock.user.findMany.mock.calls[0][0].select;
    expect(select.passwordHash).toBeUndefined();
    expect(select.tokenVersion).toBeUndefined();
    expect(select.enrollmentNumber).toBe(true);
    expect(select.emailVerifiedAt).toBe(true);
  });

  it('counts registrations per state', async () => {
    prismaMock.user.groupBy.mockResolvedValue([
      { approvalStatus: 'PENDING', _count: { _all: 4 } },
      { approvalStatus: 'APPROVED', _count: { _all: 120 } },
    ]);
    await expect(memberApprovalService.summary()).resolves.toEqual({ pending: 4, approved: 120, rejected: 0 });
  });
});

describe('approving', () => {
  const arrange = (target: Record<string, unknown> | null = applicant(), claimed = 1) => {
    prismaMock.user.findUnique.mockResolvedValueOnce(target);
    prismaMock.user.updateMany.mockResolvedValue({ count: claimed });
    prismaMock.user.findUnique.mockResolvedValueOnce(applicant({ approvalStatus: 'APPROVED' }));
  };

  it('makes the person a verified member, remembers who decided and when', async () => {
    arrange();
    await memberApprovalService.approve(ADMIN, 'u1', '  Seen in the 2015 batch list ', META);
    const call = prismaMock.user.updateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ id: 'u1', approvalStatus: { not: 'APPROVED' } });
    expect(call.data).toMatchObject({
      approvalStatus: 'APPROVED',
      isVerified: true,
      approvalReviewedById: 'admin-1',
      approvalNote: 'Seen in the 2015 batch list',
    });
    expect(call.data.approvalReviewedAt).toBeInstanceOf(Date);
  });

  it('writes the decision to the audit log', async () => {
    arrange();
    await memberApprovalService.approve(ADMIN, 'u1', undefined, META);
    expect(logAuditAction).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-1',
        action: 'APPROVE',
        entityType: 'USER',
        entityId: 'u1',
        oldValues: { approvalStatus: 'PENDING' },
        newValues: expect.objectContaining({ approvalStatus: 'APPROVED' }),
        ipAddress: '10.0.0.1',
      })
    );
  });

  it('tells the person they can sign in', async () => {
    arrange();
    await memberApprovalService.approve(ADMIN, 'u1', undefined, META);
    expect(sendWelcomeEmail).toHaveBeenCalledWith('ada@aitd.edu', 'Ada Alum');
  });

  it('does not fail the approval when the mail server is down', async () => {
    arrange();
    (sendWelcomeEmail as jest.Mock).mockRejectedValueOnce(new Error('smtp down'));
    await expect(memberApprovalService.approve(ADMIN, 'u1', undefined, META)).resolves.toBeDefined();
  });

  it('can approve a registration that was rejected earlier', async () => {
    arrange(applicant({ approvalStatus: 'REJECTED' }));
    await expect(memberApprovalService.approve(ADMIN, 'u1', undefined, META)).resolves.toBeDefined();
  });

  it('answers 404 for a person who does not exist', async () => {
    arrange(null);
    await expect(memberApprovalService.approve(ADMIN, 'nope', undefined, META)).rejects.toMatchObject({ statusCode: 404 });
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it('answers 409 when the person is already approved, and sends nothing', async () => {
    arrange(applicant({ approvalStatus: 'APPROVED' }));
    await expect(memberApprovalService.approve(ADMIN, 'u1', undefined, META)).rejects.toMatchObject({ statusCode: 409, code: 'ALREADY_APPROVED' });
    expect(sendWelcomeEmail).not.toHaveBeenCalled();
    expect(logAuditAction).not.toHaveBeenCalled();
  });

  it('of two administrators who approve at the same moment only one wins and only one mail goes out', async () => {
    arrange(applicant(), 0);
    await expect(memberApprovalService.approve(ADMIN, 'u1', undefined, META)).rejects.toMatchObject({ statusCode: 409, code: 'ALREADY_APPROVED' });
    expect(sendWelcomeEmail).not.toHaveBeenCalled();
    expect(logAuditAction).not.toHaveBeenCalled();
  });

  it('will not approve an address nobody has proven to own while e-mail verification is required', async () => {
    config.auth.requireEmailVerification = true;
    arrange(applicant({ emailVerifiedAt: null }));
    await expect(memberApprovalService.approve(ADMIN, 'u1', undefined, META)).rejects.toMatchObject({ statusCode: 409, code: 'EMAIL_NOT_VERIFIED' });
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it('allows it when verification is not required (local trial)', async () => {
    config.auth.requireEmailVerification = false;
    arrange(applicant({ emailVerifiedAt: null }));
    await expect(memberApprovalService.approve(ADMIN, 'u1', undefined, META)).resolves.toBeDefined();
  });

  it('limits the length of the note', async () => {
    arrange();
    await expect(memberApprovalService.approve(ADMIN, 'u1', 'x'.repeat(501), META)).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('rejecting', () => {
  const arrange = (target: Record<string, unknown> | null = applicant(), claimed = 1) => {
    prismaMock.user.findUnique.mockResolvedValueOnce(target);
    prismaMock.user.updateMany.mockResolvedValue({ count: claimed });
    prismaMock.user.findUnique.mockResolvedValueOnce(applicant({ approvalStatus: 'REJECTED' }));
  };

  it('needs a reason, because the person is told why', async () => {
    arrange();
    await expect(memberApprovalService.reject(ADMIN, 'u1', '   ', META)).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    await expect(memberApprovalService.reject(ADMIN, 'u1', undefined, META)).rejects.toMatchObject({ statusCode: 400 });
    await expect(memberApprovalService.reject(ADMIN, 'u1', 'x'.repeat(501), META)).rejects.toMatchObject({ statusCode: 400 });
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it('marks the registration rejected, keeps the reason and keeps the person invisible', async () => {
    arrange();
    await memberApprovalService.reject(ADMIN, 'u1', ' We could not find you in the 2015 batch ', META);
    const call = prismaMock.user.updateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ id: 'u1', approvalStatus: 'PENDING' });
    expect(call.data).toMatchObject({
      approvalStatus: 'REJECTED',
      isVerified: false,
      approvalReviewedById: 'admin-1',
      approvalNote: 'We could not find you in the 2015 batch',
    });
  });

  it('audits the decision and mails the reason', async () => {
    arrange();
    await memberApprovalService.reject(ADMIN, 'u1', 'Not on our rolls', META);
    expect(logAuditAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'REJECT', entityType: 'USER', entityId: 'u1' }));
    expect(sendRejectionEmail).toHaveBeenCalledWith('ada@aitd.edu', 'Ada Alum', 'Not on our rolls');
  });

  it('only a registration that is waiting can be rejected (a member is deactivated instead)', async () => {
    arrange(applicant({ approvalStatus: 'APPROVED' }));
    await expect(memberApprovalService.reject(ADMIN, 'u1', 'Changed my mind', META)).rejects.toMatchObject({ statusCode: 409, code: 'NOT_PENDING' });
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it('a second rejection answers 409 and sends no second mail', async () => {
    arrange(applicant({ approvalStatus: 'REJECTED' }));
    await expect(memberApprovalService.reject(ADMIN, 'u1', 'Again', META)).rejects.toMatchObject({ statusCode: 409 });
    expect(sendRejectionEmail).not.toHaveBeenCalled();
  });

  it('loses a race cleanly', async () => {
    arrange(applicant(), 0);
    await expect(memberApprovalService.reject(ADMIN, 'u1', 'Not on our rolls', META)).rejects.toMatchObject({ statusCode: 409 });
    expect(sendRejectionEmail).not.toHaveBeenCalled();
  });

  it('answers 404 for a person who does not exist', async () => {
    arrange(null);
    await expect(memberApprovalService.reject(ADMIN, 'nope', 'Reason here', META)).rejects.toMatchObject({ statusCode: 404 });
  });
});
