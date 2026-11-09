import { assertApproved, isApproved } from '../../utils/approval';

describe('alumni approval gate', () => {
  it('lets approved members through', () => {
    expect(isApproved({ approvalStatus: 'APPROVED' })).toBe(true);
    expect(() => assertApproved({ approvalStatus: 'APPROVED' })).not.toThrow();
  });

  it('tells a pending applicant that the registration is waiting for an administrator', () => {
    expect(() => assertApproved({ approvalStatus: 'PENDING' })).toThrow(
      expect.objectContaining({ statusCode: 403, code: 'ACCOUNT_PENDING_APPROVAL', message: expect.stringMatching(/waiting for approval/i) })
    );
  });

  it('tells a rejected applicant, without repeating the administrator\'s reason', () => {
    expect(() => assertApproved({ approvalStatus: 'REJECTED' })).toThrow(
      expect.objectContaining({ statusCode: 403, code: 'ACCOUNT_REJECTED', message: expect.stringMatching(/not approved/i) })
    );
  });

  it('fails closed: a missing or unknown status is treated as not approved', () => {
    expect(isApproved({})).toBe(false);
    expect(isApproved({ approvalStatus: null })).toBe(false);
    expect(isApproved(null)).toBe(false);
    expect(isApproved({ approvalStatus: 'SOMETHING_ELSE' as never })).toBe(false);
    expect(() => assertApproved({})).toThrow(expect.objectContaining({ code: 'ACCOUNT_PENDING_APPROVAL' }));
  });
});
