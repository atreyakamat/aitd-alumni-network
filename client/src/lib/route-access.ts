import { buildLoginHref, isMemberOnlyPath } from '@/lib/public-paths';

export type AccessDecision = { action: 'next' } | { action: 'redirect'; location: string };

/**
 * Edge-gate decision for `src/middleware.ts` (pure, so it is unit-tested without Next).
 *
 * `hasSessionHint` is the NON-secret `aitd_session` cookie (see `session-hint.ts`). It only keeps the
 * members-only app shell from being served to visitors who never signed in; the API and the client
 * layout (after `/auth/me`) remain the real authorization.
 *
 * Anonymous request to a member-only path -> 307 to `/login?next=<safe path>`. Member-only means every path except the landing page
 * and OPEN_PATH_PREFIXES (auth, legal and contact pages): the platform is private.
 */
export function decideAccess(input: { pathname: string; search?: string; hasSessionHint: boolean }): AccessDecision {
  const { pathname, search = '', hasSessionHint } = input;
  if (hasSessionHint || !isMemberOnlyPath(pathname)) return { action: 'next' };
  return { action: 'redirect', location: buildLoginHref(`${pathname}${search}`) };
}
