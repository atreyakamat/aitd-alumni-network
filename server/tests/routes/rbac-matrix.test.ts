/**
 * Route-level RBAC matrix.
 *
 * Every API route must be classified here. The suite fails if a route is
 * added to the router without being classified, so access rules are always
 * an explicit, reviewed decision (TDD guard for authorization).
 *
 * Levels:
 *   public       – no authentication required
 *   optional     – works anonymously, personalised when authenticated
 *   auth         – any authenticated, active user
 *   chapterAdmin – CHAPTER_ADMIN and above (resource ownership checked in services)
 *   admin        – ADMIN and SUPER_ADMIN
 *   superAdmin   – SUPER_ADMIN only
 */
import type { UserRole } from '@prisma/client';
import router from '../../src/routes';
import { api, authAs, makeUser, prismaMock, tokenFor } from '../helpers';

type Level = 'public' | 'optional' | 'auth' | 'chapterAdmin' | 'admin' | 'superAdmin';
type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

const MATRIX: Record<string, Level> = {
  // Auth
  'post /auth/register': 'public',
  'post /auth/login': 'public',
  'post /auth/verify-email': 'public',
  'post /auth/forgot-password': 'public',
  'post /auth/reset-password': 'public',
  'post /auth/refresh-token': 'public',
  'post /auth/logout': 'auth',
  'get /auth/me': 'auth',
  'get /auth/oauth/providers': 'public',
  'post /auth/verify-2fa': 'public',
  'post /auth/resend-2fa': 'public',
  'post /auth/2fa/enable': 'auth',
  'post /auth/2fa/disable': 'auth',
  'post /auth/change-password': 'auth',
  'post /auth/oauth/exchange': 'public',
  'get /auth/google': 'public',
  'get /auth/google/callback': 'public',
  'get /auth/linkedin': 'public',
  'get /auth/linkedin/callback': 'public',

  // Search
  'get /search': 'auth',

  // Users
  'get /users/stats': 'public',
  'get /users/notable': 'public',
  'get /users/directory': 'auth',
  'get /users/yearbook/:year': 'auth',
  'get /users/locations': 'auth',
  'get /users/nearby': 'auth',
  'get /geo/search': 'auth',
  'get /geo/reverse': 'auth',
  'get /users/me/export': 'auth',
  'delete /users/me': 'auth',
  'get /users/mention-search': 'auth',
  'get /users/:id': 'optional',
  'post /users/:id/follow': 'auth',
  'delete /users/:id/follow': 'auth',
  'get /users/:id/followers': 'auth',
  'get /users/:id/following': 'auth',
  'get /users/:id/posts': 'optional',
  'patch /users/profile': 'auth',
  'patch /users/profile-photo': 'auth',
  'patch /users/cover-photo': 'auth',
  'post /users/work-experience': 'auth',
  'patch /users/work-experience/:id': 'auth',
  'delete /users/work-experience/:id': 'auth',
  'post /users/education': 'auth',
  'patch /users/education/:id': 'auth',
  'delete /users/education/:id': 'auth',
  'put /users/skills': 'auth',

  // Posts
  'get /posts': 'optional',
  'get /posts/:id': 'optional',
  'post /posts': 'auth',
  'post /posts/media': 'auth',
  'patch /posts/:id': 'auth',
  'delete /posts/:id': 'auth',
  'post /posts/:id/like': 'auth',
  'post /posts/:postId/comments': 'auth',
  'patch /comments/:id': 'auth',
  'delete /comments/:id': 'auth',

  // Social (docs/SOCIAL_API.md)
  'get /feed': 'auth',
  'get /reels': 'optional',
  'get /saved': 'auth',
  'get /hashtags/trending': 'optional',
  'get /hashtags/:tag/posts': 'optional',
  'post /posts/video': 'auth',
  'post /posts/:id/react': 'auth',
  'get /posts/:id/reactions': 'auth',
  'get /posts/:id/comments': 'optional',
  'post /posts/:id/repost': 'auth',
  'delete /posts/:id/repost': 'auth',
  'post /posts/:id/save': 'auth',
  'post /posts/:id/view': 'optional',
  'post /posts/:id/report': 'auth',
  'get /comments/:id/replies': 'optional',
  'post /comments/:id/react': 'auth',
  'post /comments/:id/report': 'auth',

  // Jobs
  'get /jobs': 'optional',
  'get /jobs/my': 'auth',
  'get /jobs/:id': 'optional',
  'post /jobs': 'auth',
  'patch /jobs/:id': 'auth',
  'delete /jobs/:id': 'auth',
  'post /jobs/:id/approve': 'admin',
  'post /jobs/:id/reject': 'admin',

  // Events
  'get /events': 'optional',
  'get /events/upcoming': 'public',
  'get /events/:id': 'optional',
  'get /events/:id/attendees': 'auth',
  'post /events': 'chapterAdmin',
  'patch /events/:id': 'auth',
  'delete /events/:id': 'auth',
  'post /events/:id/rsvp': 'auth',

  // Network
  'get /network/connections': 'auth',
  'get /network/requests': 'auth',
  'get /network/suggestions': 'auth',
  'post /network/request/:userId': 'auth',
  'post /network/respond/:id': 'auth',
  'delete /network/connection/:id': 'auth',

  // Messages
  'get /messages': 'auth',
  'get /messages/unread': 'auth',
  'get /messages/:partnerId': 'auth',
  'post /messages/:receiverId': 'auth',
  'post /messages/request/:id/respond': 'auth',
  'post /messages/:partnerId/read': 'auth',

  // Notifications
  'get /notifications': 'auth',
  'get /notifications/unread': 'auth',
  'post /notifications/read-all': 'auth',
  'post /notifications/:id/read': 'auth',
  'delete /notifications/:id': 'auth',

  // Gallery
  'get /gallery/albums': 'public',
  'get /gallery/albums/:id': 'optional',
  'get /gallery/recent': 'public',
  'post /gallery/albums': 'admin',
  'patch /gallery/albums/:id': 'admin',
  'delete /gallery/albums/:id': 'admin',
  'post /gallery/albums/:albumId/photos': 'auth',
  'delete /gallery/photos/:id': 'auth',
  'post /gallery/photos/admin': 'admin',
  'delete /gallery/photos/admin/:id': 'admin',

  // News
  'get /news': 'optional',
  'get /news/latest': 'public',
  'get /news/:slug': 'optional',
  'post /news': 'admin',
  'patch /news/:id': 'admin',
  'post /news/:id/publish': 'admin',
  'post /news/:id/unpublish': 'admin',
  'delete /news/:id': 'admin',

  // Chapters
  'get /chapters': 'public',
  'get /chapters/my': 'auth',
  'get /chapters/:id': 'public',
  'get /chapters/:id/members': 'auth',
  'post /chapters': 'admin',
  'patch /chapters/:id': 'chapterAdmin',
  'put /chapters/:id/admin': 'admin',
  'delete /chapters/:id': 'superAdmin',
  'post /chapters/:id/join': 'auth',
  'post /chapters/:id/leave': 'auth',

  // Marketplace
  'get /marketplace': 'optional',
  'get /marketplace/categories': 'public',
  'get /marketplace/my': 'auth',
  'get /marketplace/:id': 'optional',
  'post /marketplace': 'auth',
  'patch /marketplace/:id': 'auth',
  'delete /marketplace/:id': 'auth',

  // Memberships
  'get /memberships/tiers': 'public',
  'get /memberships/tiers/:id': 'public',
  'get /memberships/my': 'auth',
  'get /memberships/history': 'auth',
  'post /memberships/order': 'auth',
  'post /memberships/verify': 'auth',
  'post /memberships/tiers': 'admin',
  'patch /memberships/tiers/:id': 'admin',
  'get /memberships/members': 'admin',

  // Donations
  'get /donations/wall': 'public',
  'get /donations/featured': 'public',
  'get /donations/chapters': 'public',
  'get /donations/stats': 'public',
  'get /donations/leaderboard': 'public',
  'get /donations/my': 'auth',
  'post /donations/order': 'optional',
  'post /donations/verify': 'optional',

  // Transactions
  'get /transactions/my': 'auth',
  'get /transactions/:id/receipt': 'auth',

  // Payment gateway webhooks (authenticated by HMAC signature, not by user session)
  'post /payments/webhook/razorpay': 'public',

  // Invites
  'get /invites/verify/:token': 'public',
  'get /invites/sent': 'auth',
  'get /invites/stats': 'auth',
  'post /invites/send': 'auth',
  'post /invites/bulk': 'auth',
  'post /invites/generate-link': 'auth',
  'post /invites/:token/accept': 'auth',

  // Mentorship
  'get /mentorship/mentors': 'auth',
  'get /mentorship/profile': 'auth',
  'get /mentorship/profile/:userId': 'auth',
  'post /mentorship/profile': 'auth',
  'patch /mentorship/profile': 'auth',
  'delete /mentorship/profile': 'auth',
  'get /mentorship/requests/mentor': 'auth',
  'get /mentorship/requests/mentee': 'auth',
  'post /mentorship/request/:mentorId': 'auth',
  'post /mentorship/request/:requestId/respond': 'auth',
  'post /mentorship/request/:requestId/end': 'auth',
  'get /mentorship/request/:requestId/sessions': 'auth',
  'post /mentorship/request/:requestId/sessions': 'auth',
  'post /mentorship/sessions/:sessionId/complete': 'auth',

  // Admin
  'get /admin/stats': 'admin',
  'get /platform/readiness': 'admin',
  'get /admin/users': 'admin',
  'patch /admin/users/:id/role': 'admin',
  'patch /admin/users/:id/status': 'admin',
  'get /admin/jobs/pending': 'admin',
  'get /admin/mentorship/overview': 'admin',
  'get /admin/export/:entity': 'admin',
  'get /admin/audit': 'admin',
  'get /admin/reports': 'admin',
  'patch /admin/reports/:id': 'admin',
  'get /admin/audit/activity': 'admin',
  'get /admin/audit/:entityType/:entityId': 'admin',
  'post /admin/audit/cleanup': 'superAdmin',
};

const ROLE_ORDER: UserRole[] = ['MEMBER', 'CHAPTER_ADMIN', 'ADMIN', 'SUPER_ADMIN'];
const MIN_ROLE: Partial<Record<Level, UserRole>> = {
  auth: 'MEMBER',
  chapterAdmin: 'CHAPTER_ADMIN',
  admin: 'ADMIN',
  superAdmin: 'SUPER_ADMIN',
};

const registeredRoutes = (): string[] =>
  (router as any).stack
    .filter((layer: any) => layer.route)
    .flatMap((layer: any) =>
      Object.keys(layer.route.methods).map((m) => `${m} ${layer.route.path}`)
    );

const concrete = (path: string) =>
  path.replace(/:entity\b/, 'users').replace(/:year/, '2020').replace(/:[A-Za-z]+/g, '00000000-0000-4000-8000-00000000abcd');

const send = (method: Method, path: string, header?: string) => {
  let req = (api() as any)[method](`/api${concrete(path)}`);
  if (header) req = req.set('Authorization', header);
  return method === 'get' || method === 'delete' ? req : req.send({});
};

const entries = Object.entries(MATRIX).map(([key, level]) => {
  const [method, path] = key.split(' ') as [Method, string];
  return { key, method, path, level };
});

describe('RBAC route matrix', () => {
  it('classifies every registered route', () => {
    const unclassified = registeredRoutes().filter((r) => !(r in MATRIX));
    expect(unclassified).toEqual([]);
  });

  it('has no stale entries for routes that no longer exist', () => {
    const registered = new Set(registeredRoutes());
    const stale = Object.keys(MATRIX).filter((r) => !registered.has(r));
    expect(stale).toEqual([]);
  });

  const protectedRoutes = entries.filter((e) => MIN_ROLE[e.level]);

  describe.each(protectedRoutes)('$key ($level)', ({ method, path, level }) => {
    it('rejects anonymous requests with 401', async () => {
      const res = await send(method, path);
      expect(res.status).toBe(401);
    });

    it('rejects a malformed token with 401', async () => {
      const res = await send(method, path, 'Bearer not-a-jwt');
      expect(res.status).toBe(401);
    });

    it('rejects a deactivated account with 401', async () => {
      const { header } = authAs('SUPER_ADMIN', { isActive: false });
      const res = await send(method, path, header);
      expect(res.status).toBe(401);
    });

    const min = ROLE_ORDER.indexOf(MIN_ROLE[level]!);
    const denied = ROLE_ORDER.slice(0, min);
    const allowed = ROLE_ORDER.slice(min);

    if (denied.length) {
      it.each(denied)('forbids %s with 403', async (role) => {
        const { header } = authAs(role);
        const res = await send(method, path, header);
        expect(res.status).toBe(403);
      });
    }

    it.each(allowed)('lets %s past the role guard', async (role) => {
      const { header } = authAs(role);
      const res = await send(method, path, header);
      expect(res.body?.error?.code).not.toBe('NO_TOKEN');
      expect(res.body?.error?.code).not.toBe('AUTH_REQUIRED');
      expect(res.body?.error?.message).not.toBe('Insufficient permissions');
    });
  });

  const openRoutes = entries.filter((e) => e.level === 'public' || e.level === 'optional');

  describe.each(openRoutes)('$key ($level)', ({ method, path }) => {
    it('does not demand authentication', async () => {
      const res = await send(method, path);
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });
  });

  it.each(['/api/news', '/api/news/some-slug', '/api/gallery/albums/00000000-0000-4000-8000-00000000abcd'])(
    'personalises %s when a token is present (optionalAuth)',
    async (path) => {
      const { header, user } = authAs('ADMIN');
      await api().get(path).set('Authorization', header);
      expect(prismaMock.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: user.id } }));
    }
  );

  it('uses the role stored in the database, not the one in the token', async () => {
    // Token claims SUPER_ADMIN, but the account was demoted to MEMBER.
    const stale = makeUser('SUPER_ADMIN');
    prismaMock.user.findUnique.mockResolvedValue({ ...stale, userRole: 'MEMBER' });
    const res = await api().get('/api/admin/stats').set('Authorization', `Bearer ${tokenFor(stale)}`);
    expect(res.status).toBe(403);
  });
});
