import { AppError } from '../middleware/errorHandler';

/**
 * Alumni approval: a person can only use the platform once an administrator has approved the registration.
 * Everything that hands out a session (login, 2FA completion, token refresh) and the authentication
 * middleware go through this one place, so the rule cannot drift between them.
 */
export interface HasApprovalStatus {
  approvalStatus?: string | null;
}

export const isApproved = (user: HasApprovalStatus | null | undefined): boolean => user?.approvalStatus === 'APPROVED';

export const PENDING_MESSAGE =
  'Your registration is waiting for approval. An administrator checks that every member is an alumnus of the college; you will get an e-mail as soon as it is done.';
export const REJECTED_MESSAGE =
  'Your registration was not approved. Check your e-mail for the reason, or contact the alumni office.';

/** Throws 403 unless the account is approved. A missing or unknown status counts as not approved (fail closed). */
export const assertApproved = (user: HasApprovalStatus | null | undefined): void => {
  if (isApproved(user)) return;
  if (user?.approvalStatus === 'REJECTED') {
    throw new AppError(REJECTED_MESSAGE, 403, 'ACCOUNT_REJECTED');
  }
  throw new AppError(PENDING_MESSAGE, 403, 'ACCOUNT_PENDING_APPROVAL');
};
