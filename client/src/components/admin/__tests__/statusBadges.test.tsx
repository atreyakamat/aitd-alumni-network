import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AccountStatusBadge, ApprovalStatusBadge, getAccountStatus } from '@/components/admin/StatusBadges';

describe('getAccountStatus', () => {
  const base = { isActive: true, isVerified: true };

  it('is Active for an approved, active member', () => {
    expect(getAccountStatus({ ...base, approvalStatus: 'APPROVED' })).toBe('ACTIVE');
    // older servers do not send approvalStatus: an approved member is isVerified
    expect(getAccountStatus(base)).toBe('ACTIVE');
  });

  it('is Deactivated for an approved member whose access was switched off', () => {
    expect(getAccountStatus({ ...base, isActive: false })).toBe('DEACTIVATED');
  });

  it('is Pending or Rejected before anything else, whatever the active flag says', () => {
    expect(getAccountStatus({ isActive: true, isVerified: false, approvalStatus: 'PENDING' })).toBe('PENDING');
    expect(getAccountStatus({ isActive: true, isVerified: false, approvalStatus: 'REJECTED' })).toBe('REJECTED');
    expect(getAccountStatus({ isActive: false, isVerified: false, approvalStatus: 'REJECTED' })).toBe('REJECTED');
  });

  it('says only that the person is not approved when the server did not tell which', () => {
    expect(getAccountStatus({ isActive: true, isVerified: false })).toBe('NOT_APPROVED');
  });
});

describe('<AccountStatusBadge>', () => {
  it.each([
    ['PENDING', 'Pending approval', /amber/],
    ['REJECTED', 'Rejected', /red/],
    ['DEACTIVATED', 'Deactivated', /slate/],
    ['ACTIVE', 'Active', /green/],
    ['NOT_APPROVED', 'Not approved', /amber/],
  ] as const)('%s reads "%s" in its own colour', (status, label, colour) => {
    render(<AccountStatusBadge status={status} />);
    const badge = screen.getByText(label);
    expect(badge.className).toMatch(colour);
  });

  it('keeps the colour-blind cue: every badge has an icon besides the text', () => {
    const { container } = render(<AccountStatusBadge status="ACTIVE" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('<ApprovalStatusBadge>', () => {
  it.each([
    ['PENDING', 'Pending approval'],
    ['APPROVED', 'Approved'],
    ['REJECTED', 'Rejected'],
  ] as const)('%s reads "%s"', (status, label) => {
    render(<ApprovalStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
