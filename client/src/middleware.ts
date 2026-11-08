import { NextResponse, type NextRequest } from 'next/server';
import { decideAccess } from '@/lib/route-access';
import { hasSessionHint } from '@/lib/session-hint';

/**
 * Members-only gate at the edge. Without a session hint cookie, requests for member pages are
 * redirected (307) to `/login?next=...` instead of being served the member app shell.
 *
 * This is a UX/hardening layer, NOT authorization: the cookie is a non-secret hint (see
 * `src/lib/session-hint.ts`). The API enforces real access control, and the (main) layout
 * re-checks the session via `/auth/me` before rendering anything.
 *
 * Which paths are member-only is decided by `isMemberOnlyPath` in `src/lib/public-paths.ts`
 * (everything except the landing page, auth/legal pages and PUBLIC_PATH_PREFIXES), so this file
 * cannot drift from the client layout's `isPublicPath` check.
 */
export function middleware(request: NextRequest) {
  const decision = decideAccess({
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    hasSessionHint: hasSessionHint(request.headers.get('cookie')),
  });
  if (decision.action === 'next') return NextResponse.next();

  const url = request.nextUrl.clone();
  const [pathname, query = ''] = decision.location.split('?');
  url.pathname = pathname;
  url.search = query ? `?${query}` : '';
  return NextResponse.redirect(url, 307);
}

export const config = {
  // Matchers must be static literals. Skip the API proxy, Next internals, /.well-known and static asset files that sit
  // directly in the site root (favicon.ico, robots.txt, icons ...). NOT "anything ending in .png/.js/...": the dynamic
  // pages /profile/[id], /jobs/[id] and /hashtags/[tag] accept any last segment, so /profile/x.png used to skip the
  // gate and be served the members-only shell. `decideAccess` makes the real decision.
  matcher: [
    '/((?!api/|_next/|\\.well-known/|[^/]+\\.(?:png|jpe?g|gif|svg|webp|avif|ico|css|js|map|txt|xml|json|woff2?|ttf|webmanifest)$).*)',
  ],
};
