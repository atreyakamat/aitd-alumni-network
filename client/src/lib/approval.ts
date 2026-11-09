import type { ApprovalState } from '@/lib/api';

/**
 * What the person is told when the platform will not let them in because an administrator has not approved the
 * registration (yet), or has rejected it. One source for the login notice, the toast that follows a revoked session and
 * the registration / e-mail confirmation screens, so the wording cannot drift apart.
 */
export interface ApprovalCopy {
  title: string;
  /** One sentence, for a toast. */
  summary: string;
  /** What to expect, for the notice on the sign-in page. */
  body: string;
}

export const APPROVAL_COPY: Record<ApprovalState, ApprovalCopy> = {
  pending: {
    title: 'Your registration is waiting for approval',
    summary: 'An administrator is checking it. You will get an e-mail as soon as it is done.',
    body: 'An administrator checks that every member is an alumnus of the college. You will get an e-mail as soon as your registration is approved, and you can sign in then. There is nothing more you need to do.',
  },
  rejected: {
    title: 'Your registration was not approved',
    summary: 'Check your e-mail for the reason, or contact the alumni office.',
    body: 'Check your e-mail for the reason. If you think this is a mistake, contact the alumni office.',
  },
};

/** The `?approval=` value on /login that says why the person was sent there. Anything else is ignored. */
export function parseApprovalParam(value: string | null | undefined): ApprovalState | null {
  return value === 'pending' || value === 'rejected' ? value : null;
}
