/**
 * Session HINT cookie (`aitd_session=1`).
 *
 * SECURITY NOTE - read before changing:
 * - This cookie is NOT a credential and carries NO secret. Anyone can set it by hand.
 * - It exists only so `src/middleware.ts` can avoid serving the members-only app shell
 *   (HTML + route JS chunks) to anonymous visitors who have never signed in.
 * - REAL authorization is enforced (1) by the API on every request (Bearer access token,
 *   role checks) and (2) by the client layout, which renders nothing for members-only
 *   routes until `/auth/me` succeeds (`src/app/(main)/layout.tsx`, `RequireRole`).
 *   Forging this cookie therefore gains an attacker nothing but the empty shell.
 * - The tokens themselves stay in localStorage; the cookie is never read for auth.
 *
 * Lifecycle (kept in sync by `auth-context.tsx` and `api.ts`): set on login / OAuth login /
 * token refresh / successful `/auth/me` on load; cleared on logout, failed refresh, a 401/403
 * from `/auth/me`, and cross-tab logout.
 */

export const SESSION_COOKIE = 'aitd_session';

/** Matches the API refresh-token lifetime (JWT_REFRESH_EXPIRES_IN default: 7d). */
export const SESSION_HINT_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/** `Set-Cookie`-style string for `document.cookie` that marks the browser as signed in. */
export function buildSessionHintCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=1; Path=/; Max-Age=${SESSION_HINT_MAX_AGE_SECONDS}; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/** String for `document.cookie` that expires the hint immediately. */
export function buildClearSessionHintCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax${secure ? '; Secure' : ''}`;
}

const isSecureContext = () => typeof window !== 'undefined' && window.location.protocol === 'https:';

/** Mark this browser as having a session (call after tokens are stored). No-op on the server. */
export function setSessionHint(): void {
  if (typeof document === 'undefined') return;
  try {
    document.cookie = buildSessionHintCookie(isSecureContext());
  } catch {
    // Cookies disabled: the member app still works client-side; a hard reload just redirects to login.
  }
}

/** Remove the hint (call whenever tokens are removed). No-op on the server. */
export function clearSessionHint(): void {
  if (typeof document === 'undefined') return;
  try {
    document.cookie = buildClearSessionHintCookie(isSecureContext());
  } catch {
    // ignore
  }
}

/** True when the hint cookie is present in a `Cookie` header / `document.cookie` string. */
export function hasSessionHint(cookieHeader: string | null | undefined): boolean {
  if (!cookieHeader) return false;
  return cookieHeader.split(';').some((part) => part.trim() === `${SESSION_COOKIE}=1`);
}
