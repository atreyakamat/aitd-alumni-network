/**
 * Valid-input smoke through the real app (Express + Prisma + PostgreSQL) for EVERY route.
 *
 * For each route the table below sends a realistic, valid request as the right role and asserts it does
 * not 5xx, answers with the documented envelope ({ success, data | pagination }) and leaks no stack
 * trace; it then sends a minimal invalid request (bad body, or an unknown / malformed id) and asserts a
 * clean 4xx with a user-facing message (the client reads error.message, error or message).
 *
 * A coverage test fails when a route is added to the router without a row here, mirroring the RBAC matrix.
 */
import crypto from 'crypto';
import request from 'supertest';

// Plain functions (not jest.fn) so restoreAllMocks cannot strip them
jest.mock('razorpay', () => {
  let orderSeq = 0;
  return class FakeRazorpay {
    orders = {
      create: async (params: { amount: number; currency: string; notes: Record<string, string> }) => ({
        id: `order_contract_${Date.now()}_${++orderSeq}`,
        amount: params.amount,
        currency: params.currency,
        notes: params.notes,
        status: 'created',
      }),
    };
  };
});
// Receipts and videos would otherwise be written to server/uploads
jest.mock('../../src/utils/storage', () => ({
  ...jest.requireActual('../../src/utils/storage'),
  uploadBufferToStorage: async () => 'https://cdn.test/receipts/contract.pdf',
}));

import config from '../../src/config';
import router from '../../src/routes';
import * as email from '../../src/utils/email';
import { hashToken } from '../../src/utils/jwt';
import { resetRazorpayClient } from '../../src/utils/razorpay';
import { geocodingService } from '../../src/services/geocodingService';
import { app, PASSWORD } from '../integration/helpers';
import { registeredRoutes, routeKey } from './support';
import * as fx from './fixtures';
import type { Actor, Users } from './fixtures';

const KEY_SECRET = 'contract_key_secret';
const WEBHOOK_SECRET = 'contract_webhook_secret';
const originalRazorpay = { ...config.razorpay };

type ActorKey = 'member' | 'other' | 'third' | 'admin' | 'superAdmin' | 'chapterAdmin';

interface Req {
  path: string;
  /** Who calls; null = anonymous. Defaults to `member`. */
  as?: ActorKey | null;
  query?: Record<string, unknown>;
  /** Pre-encoded query string appended after `query` (bracket syntax such as `q[]=a`). */
  rawQuery?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Raw body (webhook signature is computed over the exact bytes). */
  raw?: string;
  attach?: { field: string; buffer: Buffer; filename: string; contentType: string };
}

type Shape = 'list' | 'obj' | 'arr' | 'any' | 'file';

interface Case {
  ok: (f: F) => Req | Promise<Req>;
  /** Accepted statuses for the valid request (default 200 or 201). */
  status?: number | number[];
  shape?: Shape;
  check?: (body: any, f: F) => void;
  /** Minimal invalid request. Default: the same call with every :param replaced by a malformed id. */
  bad?: ((f: F) => Req | Promise<Req>) | null;
  badStatus?: number | number[];
}

interface F extends Users {
  post: { id: string };
  comment: { id: string };
  otherComment: { id: string };
  job: { id: string };
  pendingJob: { id: string };
  chapter: { id: string };
  event: { id: string };
  album: { id: string };
  photo: { id: string };
  article: { id: string; slug: string };
  draft: { id: string; slug: string };
  listing: { id: string };
  tier: { id: string };
  notification: { id: string };
  work: { id: string };
  education: { id: string };
  connection: { id: string };
  mentorRequest: { id: string };
  session: { id: string };
  transaction: { id: string };
  video: { id: string; title: string };
  magazine: { id: string };
  requirement: { id: string };
}

let f: F;
const actors = (): Record<ActorKey, Actor> => f as unknown as Record<ActorKey, Actor>;

const sendMail = () => {
  jest.spyOn(email, 'sendEmail').mockResolvedValue(undefined as never);
  jest.spyOn(email, 'sendVerificationEmail').mockResolvedValue(undefined as never);
  jest.spyOn(email, 'sendPasswordResetEmail').mockResolvedValue(undefined as never);
};

const signCheckout = (orderId: string, paymentId: string) =>
  crypto.createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');

const tokenOfLink = (link: string) => new URL(link).searchParams.get('ref') as string;
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

/** Minimal bytes the upload endpoints sniff as an MP4 and a PDF. */
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(64)]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
/**
 * The college-content lists answer `{ success, data: { data: [...], pagination } }`, the paginated result nested one level
 * deeper than /jobs or /events (the mentorship list does the same), so `shape: 'list'` does not fit them.
 */
const nestedPage = (b: any) => {
  expect(Array.isArray(b.data.data)).toBe(true);
  expect(b.data.pagination).toEqual(expect.objectContaining({ total: expect.any(Number), page: expect.any(Number), limit: expect.any(Number), totalPages: expect.any(Number) }));
};
/** A fresh reference to a stored file: a file may belong to one record only. */
const ref = (folder: string, ext: string) => `/uploads/${folder}/${fx.uniq(folder)}.${ext}`;

beforeAll(async () => {
  config.razorpay.keyId = 'rzp_test_contract';
  config.razorpay.keySecret = KEY_SECRET;
  config.razorpay.webhookSecret = WEBHOOK_SECRET;
  resetRazorpayClient();

  const users = await fx.makeUsers();
  const post = await fx.newPost(users.member.user.id);
  const comment = await fx.newComment(users.member.user.id, post.id);
  const otherComment = await fx.newComment(users.other.user.id, post.id);
  const chapter = await fx.newChapter(users.chapterAdmin.user.id);
  const album = await fx.newAlbum();
  const article = await fx.newArticle(users.admin.user.id, 'PUBLISHED');
  const draft = await fx.newArticle(users.admin.user.id, 'DRAFT');
  const transaction = await fx.prisma.transaction.create({
    data: { userId: users.member.user.id, type: 'DONATION', amount: 100, status: 'SUCCESS' },
  });
  await fx.prisma.donation.create({ data: { userId: users.member.user.id, amount: 100, transactionId: transaction.id } });
  const request = await fx.newMentorshipRequest(users.third.user.id, users.other.user.id, 'ACCEPTED');
  f = {
    ...users,
    post,
    comment,
    otherComment,
    job: await fx.newJob(users.member.user.id, 'PUBLISHED'),
    pendingJob: await fx.newJob(users.other.user.id, 'PENDING_REVIEW'),
    chapter,
    event: await fx.newEvent(users.admin.user.id, chapter.id),
    album,
    photo: await fx.newPhoto(album.id, users.admin.user.id),
    article,
    draft,
    listing: await fx.newListing(users.member.user.id),
    tier: await fx.newTier(),
    notification: await fx.newNotification(users.member.user.id),
    work: await fx.newWork(users.member.user.id),
    education: await fx.newEducation(users.member.user.id),
    connection: await fx.newConnection(users.third.user.id, users.member.user.id, 'PENDING'),
    mentorRequest: request,
    session: await fx.newSession(request.id),
    transaction,
    video: await fx.newVideo(users.member.user.id, 'APPROVED'),
    magazine: await fx.newMagazine(users.admin.user.id),
    requirement: await fx.newRequirement(users.admin.user.id),
  };
}, 120000);

afterAll(async () => {
  Object.assign(config.razorpay, originalRazorpay);
  resetRazorpayClient();
  await fx.prisma.$disconnect();
});

beforeEach(() => {
  sendMail();
  // The place search proxies OpenStreetMap; the suite must not need the network
  jest.spyOn(geocodingService, 'search').mockResolvedValue([{ label: 'Pune, Maharashtra, India', lat: 18.52, lng: 73.86, city: 'Pune' }]);
  jest.spyOn(geocodingService, 'reverse').mockResolvedValue({ label: 'Pune, Maharashtra, India', lat: 18.52, lng: 73.86, city: 'Pune' });
});

afterEach(() => jest.restoreAllMocks());

// ---------------------------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------------------------

const ISO_FUTURE = (days: number) => new Date(Date.now() + days * 86400000).toISOString();

const cases: Record<string, Case> = {
  // ---- Auth ----
  'post /auth/register': {
    ok: () => ({
      as: null,
      path: '/auth/register',
      body: { email: fx.uniqueEmail('smoke'), password: PASSWORD, fullName: 'Smoke Test', batchYear: 2019, department: 'Mechanical', degree: 'B.E.', roleType: 'ALUMNI' },
    }),
    status: 201,
    bad: () => ({ as: null, path: '/auth/register', body: {} }),
  },
  'post /auth/login': {
    ok: (x) => ({ as: null, path: '/auth/login', body: { email: x.member.user.email, password: PASSWORD } }),
    check: (b) => expect(b.data.accessToken).toEqual(expect.any(String)),
    bad: (x) => ({ as: null, path: '/auth/login', body: { email: x.member.user.email, password: 'Wrong#Pass9' } }),
    badStatus: 401,
  },
  'post /auth/verify-email': {
    ok: async () => {
      const { user } = await fx.newUser();
      await fx.prisma.user.update({ where: { id: user.id }, data: { isVerified: false, emailVerifiedAt: null } });
      const raw = `verify-${fx.uniq()}`;
      await fx.prisma.verificationToken.create({
        data: { userId: user.id, token: hashToken(raw), type: 'EMAIL_VERIFY', expiresAt: fx.futureDate(1) },
      });
      return { as: null, path: '/auth/verify-email', body: { token: raw } };
    },
    bad: () => ({ as: null, path: '/auth/verify-email', body: { token: 'not-a-real-token' } }),
  },
  'post /auth/resend-verification': {
    ok: (x) => ({ as: null, path: '/auth/resend-verification', body: { email: x.member.user.email } }),
    bad: () => ({ as: null, path: '/auth/resend-verification', body: { email: 'not-an-email' } }),
  },
  'post /auth/forgot-password': {
    ok: (x) => ({ as: null, path: '/auth/forgot-password', body: { email: x.member.user.email } }),
    bad: () => ({ as: null, path: '/auth/forgot-password', body: { email: 'not-an-email' } }),
  },
  'post /auth/reset-password': {
    ok: async () => {
      const { user } = await fx.newUser();
      const raw = `reset-${fx.uniq()}`;
      await fx.prisma.verificationToken.create({
        data: { userId: user.id, token: hashToken(raw), type: 'PASSWORD_RESET', expiresAt: fx.futureDate(1) },
      });
      return { as: null, path: '/auth/reset-password', body: { token: raw, password: 'Another#Pass7' } };
    },
    bad: () => ({ as: null, path: '/auth/reset-password', body: { token: 'nope', password: 'Another#Pass7' } }),
  },
  'post /auth/change-password': {
    ok: async () => {
      const actor = await fx.newUser();
      (f as any).changePasswordUser = actor;
      return { as: null, path: '/auth/change-password', headers: { Authorization: actor.auth }, body: { currentPassword: PASSWORD, newPassword: 'Another#Pass7' } };
    },
    bad: () => ({ path: '/auth/change-password', body: { currentPassword: 'wrong', newPassword: 'short' }, as: 'member' }),
  },
  'post /auth/refresh-token': {
    ok: async (x) => {
      const login = await request(app).post('/api/auth/login').send({ email: x.other.user.email, password: PASSWORD });
      return { as: null, path: '/auth/refresh-token', body: { refreshToken: login.body.data.refreshToken } };
    },
    check: (b) => expect(b.data.accessToken).toEqual(expect.any(String)),
    bad: () => ({ as: null, path: '/auth/refresh-token', body: { refreshToken: 'garbage' } }),
    badStatus: 401,
  },
  'post /auth/logout': { ok: async () => ({ as: null, path: '/auth/logout', headers: { Authorization: (await fx.newUser()).auth }, body: {} }), bad: () => ({ as: null, path: '/auth/logout', body: {} }), badStatus: 401 },
  'get /auth/me': { ok: () => ({ path: '/auth/me' }), shape: 'obj', bad: () => ({ as: null, path: '/auth/me' }), badStatus: 401 },
  'get /auth/oauth/providers': { ok: () => ({ as: null, path: '/auth/oauth/providers' }), bad: null },
  'post /auth/verify-2fa': {
    ok: () => ({ as: null, path: '/auth/verify-2fa', body: { twoFactorToken: 'not-a-real-session', otp: '123456' } }),
    status: [400, 401],
    bad: () => ({ as: null, path: '/auth/verify-2fa', body: {} }),
  },
  'post /auth/resend-2fa': {
    ok: () => ({ as: null, path: '/auth/resend-2fa', body: { twoFactorToken: 'not-a-real-session' } }),
    status: [400, 401],
    bad: () => ({ as: null, path: '/auth/resend-2fa', body: {} }),
  },
  'post /auth/2fa/enable': { ok: async () => ({ path: '/auth/2fa/enable', body: {}, as: 'third' }), bad: () => ({ as: null, path: '/auth/2fa/enable', body: {} }), badStatus: 401 },
  'post /auth/2fa/disable': { ok: () => ({ path: '/auth/2fa/disable', body: { password: PASSWORD }, as: 'third' }), status: [200, 400], bad: () => ({ as: null, path: '/auth/2fa/disable', body: {} }), badStatus: 401 },
  'post /auth/oauth/exchange': {
    ok: () => ({ as: null, path: '/auth/oauth/exchange', body: { code: 'not-a-real-code' } }),
    status: [400, 401],
    bad: () => ({ as: null, path: '/auth/oauth/exchange', body: {} }),
  },
  // OAuth providers are not configured in tests: the redirect routes answer 503 by design
  'get /auth/google': { ok: () => ({ as: null, path: '/auth/google' }), status: 503, bad: null },
  'get /auth/google/callback': { ok: () => ({ as: null, path: '/auth/google/callback' }), status: 503, bad: null },
  'get /auth/linkedin': { ok: () => ({ as: null, path: '/auth/linkedin' }), status: 503, bad: null },
  'get /auth/linkedin/callback': { ok: () => ({ as: null, path: '/auth/linkedin/callback' }), status: 503, bad: null },

  // ---- Search ----
  'get /search': {
    ok: () => ({ path: '/search', query: { q: 'Contract' } }),
    shape: 'obj',
    check: (b) => expect(b.data).toEqual(expect.objectContaining({ users: expect.any(Array), jobs: expect.any(Array), events: expect.any(Array), posts: expect.any(Array) })),
    bad: null,
  },

  // ---- Users ----
  'get /users/stats': { ok: () => ({ as: null, path: '/users/stats' }), shape: 'obj', bad: null },
  'get /users/notable': { ok: () => ({ path: '/users/notable', query: { limit: 3 } }), shape: 'arr', bad: null },
  'get /users/directory': {
    ok: () => ({ path: '/users/directory', query: { page: 1, limit: 12, search: 'Integration', batchYear: 2018, department: 'Computer Engineering' } }),
    shape: 'list',
    check: (b) => expect(b.data.length).toBeGreaterThan(0),
    bad: () => ({ path: '/users/directory', query: { roleType: 'NOPE' } }),
  },
  'get /users/yearbook/:year': {
    ok: () => ({ path: '/users/yearbook/2018', query: { department: 'Computer Engineering' } }),
    shape: 'any',
    bad: () => ({ path: '/users/yearbook/abc' }),
  },
  'get /users/locations': {
    ok: () => ({ path: '/users/locations', query: { north: 30, south: 10, east: 80, west: 60, limit: 50 } }),
    shape: 'obj',
    bad: () => ({ path: '/users/locations', query: { north: 30 } }),
  },
  'get /users/nearby': {
    ok: () => ({ path: '/users/nearby', query: { lat: 18.52, lng: 73.86, radius: 100, limit: 20 } }),
    shape: 'obj',
    bad: () => ({ path: '/users/nearby', query: {} }),
  },
  'get /geo/search': { ok: () => ({ path: '/geo/search', query: { q: 'Pune', limit: 5 } }), shape: 'arr', bad: () => ({ path: '/geo/search', query: {} }) },
  'get /geo/reverse': { ok: () => ({ path: '/geo/reverse', query: { lat: 18.52, lng: 73.86 } }), shape: 'obj', bad: () => ({ path: '/geo/reverse', query: { lat: 'x' } }) },
  'get /users/me/export': {
    ok: () => ({ path: '/users/me/export', as: 'other' }),
    shape: 'obj',
    check: (b) => expect(b.data.exportedAt).toEqual(expect.any(String)),
    bad: () => ({ as: null, path: '/users/me/export' }),
    badStatus: 401,
  },
  'delete /users/me': {
    ok: async () => {
      const actor = await fx.newUser();
      return { as: null, path: '/users/me', headers: { Authorization: actor.auth }, body: { password: PASSWORD } };
    },
    bad: () => ({ path: '/users/me', body: {} }),
    badStatus: [400, 401],
  },
  'get /users/mention-search': { ok: () => ({ path: '/users/mention-search', query: { q: 'Int', limit: 8 } }), shape: 'any', bad: () => ({ as: null, path: '/users/mention-search', query: { q: 'x' } }), badStatus: 401 },
  'get /users/:id': {
    ok: (x) => ({ path: `/users/${x.other.user.id}` }),
    shape: 'obj',
    check: (b, x) => {
      expect(b.data.id).toBe(x.other.user.id);
      expect(b.data).not.toHaveProperty('passwordHash');
    },
    bad: () => ({ path: `/users/${MISSING_ID}` }),
    badStatus: 404,
  },
  'post /users/:id/follow': { ok: (x) => ({ path: `/users/${x.third.user.id}/follow`, body: {} }), shape: 'obj' },
  'delete /users/:id/follow': { ok: (x) => ({ path: `/users/${x.third.user.id}/follow` }), shape: 'obj', bad: null },
  'get /users/:id/followers': { ok: (x) => ({ path: `/users/${x.other.user.id}/followers`, query: { limit: 10 } }), shape: 'obj' },
  'get /users/:id/following': { ok: (x) => ({ path: `/users/${x.other.user.id}/following`, query: { limit: 10 } }), shape: 'obj' },
  'get /users/:id/posts': { ok: (x) => ({ path: `/users/${x.member.user.id}/posts`, query: { limit: 10 } }), shape: 'obj' },
  'patch /users/profile': {
    ok: () => ({
      as: 'third',
      path: '/users/profile',
      body: {
        fullName: 'Third Smoke',
        currentDesignation: 'Engineer',
        shortBio: 'Smoke bio',
        city: 'Pune',
        hometown: 'Nashik',
        locationLat: 18.52,
        locationLng: 73.86,
        isLocationPublic: true,
        phoneNumber: '+91 98765 43210',
        phoneVisibility: 'CONNECTIONS',
        linkedinUrl: 'https://linkedin.com/in/smoke',
        twitterUrl: '',
        githubUrl: 'https://github.com/smoke',
        websiteUrl: 'https://example.com',
        secondaryEmail: 'smoke@example.com',
      },
    }),
    shape: 'obj',
    check: (b) => expect(b.data).toMatchObject({ currentDesignation: 'Engineer', city: 'Pune', hometown: 'Nashik', phoneVisibility: 'CONNECTIONS' }),
    bad: () => ({ path: '/users/profile', body: { fullName: 'x' } }),
  },
  'patch /users/profile-photo': {
    ok: () => ({ as: 'third', path: '/users/profile-photo', attach: { field: 'photo', buffer: fx.PNG_1X1, filename: 'me.png', contentType: 'image/png' } }),
    shape: 'obj',
    bad: () => ({ path: '/users/profile-photo' }),
  },
  'patch /users/cover-photo': {
    ok: () => ({ as: 'third', path: '/users/cover-photo', attach: { field: 'photo', buffer: fx.PNG_1X1, filename: 'cover.png', contentType: 'image/png' } }),
    shape: 'obj',
    bad: () => ({ path: '/users/cover-photo' }),
  },
  'post /users/work-experience': {
    ok: () => ({ path: '/users/work-experience', body: { company: 'Acme', role: 'Engineer', location: 'Pune', startDate: '2020-01-01', endDate: '2022-06-01', isCurrent: false, description: 'Built things' } }),
    status: 201,
    shape: 'obj',
    bad: () => ({ path: '/users/work-experience', body: { company: 'Acme' } }),
  },
  'patch /users/work-experience/:id': {
    ok: (x) => ({ path: `/users/work-experience/${x.work.id}`, body: { role: 'Senior Engineer', endDate: null, isCurrent: true } }),
    shape: 'obj',
    bad: () => ({ path: `/users/work-experience/${MISSING_ID}`, body: { role: 'x' } }),
    badStatus: 404,
  },
  'delete /users/work-experience/:id': {
    ok: async (x) => ({ path: `/users/work-experience/${(await fx.newWork(x.member.user.id)).id}` }),
    bad: () => ({ path: '/users/work-experience/not-a-uuid' }),
  },
  'post /users/education': {
    ok: () => ({ path: '/users/education', body: { institution: 'AITD', degree: 'B.E.', fieldOfStudy: 'Computer', startYear: 2014, endYear: 2018, grade: 'A', description: 'Studied', isPrimary: true } }),
    status: 201,
    shape: 'obj',
    bad: () => ({ path: '/users/education', body: {} }),
  },
  'patch /users/education/:id': {
    ok: (x) => ({ path: `/users/education/${x.education.id}`, body: { grade: 'A+', endYear: 2019 } }),
    shape: 'obj',
    bad: () => ({ path: `/users/education/${MISSING_ID}`, body: { grade: 'x' } }),
    badStatus: 404,
  },
  'delete /users/education/:id': {
    ok: async (x) => ({ path: `/users/education/${(await fx.newEducation(x.member.user.id)).id}` }),
    bad: () => ({ path: '/users/education/not-a-uuid' }),
  },
  'put /users/skills': {
    ok: () => ({ path: '/users/skills', body: { skills: ['TypeScript', 'SQL', 'typescript'] } }),
    shape: 'any',
    bad: () => ({ path: '/users/skills', body: {} }),
  },

  // ---- Posts ----
  'get /posts': { ok: () => ({ path: '/posts', query: { page: 1, limit: 10 } }), shape: 'list', bad: null },
  'get /posts/:id': {
    ok: (x) => ({ path: `/posts/${x.post.id}` }),
    shape: 'obj',
    bad: () => ({ path: `/posts/${MISSING_ID}` }),
    badStatus: 404,
  },
  'post /posts': {
    ok: () => ({ path: '/posts', body: { type: 'GENERAL', content: 'Smoke #contract post with @mention', visibility: 'PUBLIC', mediaUrls: [], linkUrl: 'https://example.com/a' } }),
    status: 201,
    shape: 'obj',
    bad: () => ({ path: '/posts', body: { visibility: 'NOPE' } }),
  },
  'post /posts/media': {
    ok: () => ({ path: '/posts/media', attach: { field: 'media', buffer: fx.PNG_1X1, filename: 'p.png', contentType: 'image/png' } }),
    shape: 'obj',
    check: (b) => expect(b.data.urls).toEqual(expect.any(Array)),
    bad: () => ({ path: '/posts/media' }),
  },
  'patch /posts/:id': {
    ok: async (x) => ({ path: `/posts/${(await fx.newPost(x.member.user.id)).id}`, body: { content: 'Edited smoke post', visibility: 'CONNECTIONS', isPinned: true } }),
    shape: 'obj',
    check: (b) => expect(b.data).toMatchObject({ content: 'Edited smoke post', visibility: 'CONNECTIONS' }),
    bad: () => ({ path: `/posts/${MISSING_ID}`, body: { content: 'x' } }),
    badStatus: 404,
  },
  'delete /posts/:id': {
    ok: async (x) => ({ path: `/posts/${(await fx.newPost(x.member.user.id)).id}` }),
    bad: () => ({ path: `/posts/${MISSING_ID}` }),
    badStatus: 404,
  },
  'post /posts/:id/like': { ok: (x) => ({ as: 'other', path: `/posts/${x.post.id}/like`, body: {} }), shape: 'obj' },
  'post /posts/:postId/comments': {
    ok: (x) => ({ path: `/posts/${x.post.id}/comments`, body: { content: 'Smoke comment', mentionIds: [x.other.user.id] } }),
    status: 201,
    shape: 'obj',
    bad: (x) => ({ path: `/posts/${x.post.id}/comments`, body: {} }),
  },
  'patch /comments/:id': {
    ok: (x) => ({ path: `/comments/${x.comment.id}`, body: { content: 'Edited smoke comment', mentionIds: [x.other.user.id] } }),
    shape: 'obj',
    bad: (x) => ({ path: `/comments/${x.comment.id}`, body: { content: '' } }),
  },
  'delete /comments/:id': {
    ok: async (x) => ({ path: `/comments/${(await fx.newComment(x.member.user.id, x.post.id)).id}` }),
    bad: () => ({ path: `/comments/${MISSING_ID}` }),
    badStatus: 404,
  },

  // ---- Social ----
  'get /feed': { ok: () => ({ path: '/feed', query: { tab: 'latest', limit: 10 } }), shape: 'obj', bad: () => ({ as: null, path: '/feed' }), badStatus: 401 },
  'get /saved': { ok: () => ({ path: '/saved', query: { limit: 5 } }), shape: 'obj', bad: () => ({ as: null, path: '/saved' }), badStatus: 401 },
  'get /hashtags/trending': { ok: () => ({ path: '/hashtags/trending', query: { days: 7, limit: 10 } }), shape: 'any', bad: null },
  'get /hashtags/:tag/posts': { ok: () => ({ path: '/hashtags/contract/posts', query: { limit: 5 } }), shape: 'obj', bad: null },
  'post /posts/video': { ok: () => ({ path: '/posts/video' }), status: 400, bad: () => ({ as: null, path: '/posts/video' }), badStatus: 401 },
  'post /posts/:id/react': {
    ok: (x) => ({ as: 'other', path: `/posts/${x.post.id}/react`, body: { type: 'CELEBRATE' } }),
    shape: 'obj',
    bad: (x) => ({ path: `/posts/${x.post.id}/react`, body: { type: 'NOPE' } }),
  },
  'get /posts/:id/reactions': { ok: (x) => ({ path: `/posts/${x.post.id}/reactions`, query: { limit: 10 } }), shape: 'obj' },
  'get /posts/:id/comments': { ok: (x) => ({ path: `/posts/${x.post.id}/comments`, query: { sort: 'top', limit: 10 } }), shape: 'obj' },
  'post /posts/:id/repost': {
    ok: async (x) => ({ as: 'other', path: `/posts/${(await fx.newPost(x.member.user.id)).id}/repost`, body: { content: 'Reposting', visibility: 'PUBLIC' } }),
    status: 201,
    shape: 'obj',
  },
  'delete /posts/:id/repost': {
    ok: async (x) => {
      const p = await fx.newPost(x.member.user.id);
      const res = await request(app).post(`/api/posts/${p.id}/repost`).set('Authorization', x.other.auth).send({});
      expect(res.status).toBe(201);
      return { as: 'other', path: `/posts/${p.id}/repost` };
    },
    shape: 'any',
  },
  'post /posts/:id/save': { ok: (x) => ({ as: 'other', path: `/posts/${x.post.id}/save`, body: {} }), shape: 'obj' },
  'post /posts/:id/view': { ok: (x) => ({ path: `/posts/${x.post.id}/view`, body: {} }), shape: 'any' },
  'post /posts/:id/report': {
    ok: async (x) => ({ as: 'other', path: `/posts/${(await fx.newPost(x.member.user.id)).id}/report`, body: { reason: 'SPAM', details: 'Looks like spam' } }),
    status: 201,
    shape: 'any',
    bad: (x) => ({ as: 'other', path: `/posts/${x.post.id}/report`, body: { reason: 'NOPE' } }),
  },
  'get /comments/:id/replies': { ok: (x) => ({ path: `/comments/${x.comment.id}/replies`, query: { limit: 10 } }), shape: 'obj' },
  'post /comments/:id/react': {
    ok: (x) => ({ as: 'other', path: `/comments/${x.comment.id}/react`, body: { type: 'LIKE' } }),
    shape: 'obj',
    bad: (x) => ({ path: `/comments/${x.comment.id}/react`, body: { type: 'NOPE' } }),
  },
  'post /comments/:id/report': {
    ok: (x) => ({ as: 'third', path: `/comments/${x.otherComment.id}/report`, body: { reason: 'HARASSMENT' } }),
    status: 201,
    shape: 'any',
    bad: (x) => ({ as: 'third', path: `/comments/${x.otherComment.id}/report`, body: {} }),
  },

  // ---- Jobs ----
  'get /jobs': {
    ok: () => ({ path: '/jobs', query: { page: 1, limit: 12, type: 'FULL_TIME', workplaceType: 'ONSITE', location: 'Pune', search: 'Contract' } }),
    shape: 'list',
    bad: null,
  },
  'get /jobs/my': { ok: () => ({ path: '/jobs/my', query: { page: 1, limit: 10 } }), shape: 'list', bad: () => ({ as: null, path: '/jobs/my' }), badStatus: 401 },
  'get /jobs/:id': {
    ok: (x) => ({ path: `/jobs/${x.job.id}` }),
    shape: 'obj',
    bad: () => ({ path: `/jobs/${MISSING_ID}` }),
    badStatus: 404,
  },
  'post /jobs': {
    ok: () => ({
      path: '/jobs',
      body: {
        title: 'Smoke Engineer',
        company: 'Smoke Co',
        description: 'Build and ship',
        location: 'Pune',
        workplaceType: 'HYBRID',
        jobType: 'CONTRACT',
        industry: 'Software',
        salaryMin: 1000,
        salaryMax: 2000,
        experienceMin: 1,
        experienceMax: 5,
        skills: ['TypeScript'],
        applicationLink: 'https://example.com/apply',
        deadline: ISO_FUTURE(30),
      },
    }),
    status: 201,
    shape: 'obj',
    check: (b) => expect(b.data).toMatchObject({ status: 'PENDING_REVIEW', industry: 'Software', jobType: 'CONTRACT', experienceMax: 5 }),
    bad: () => ({ path: '/jobs', body: { title: 'No company' } }),
  },
  'patch /jobs/:id': {
    ok: async (x) => ({ path: `/jobs/${(await fx.newJob(x.member.user.id, 'PUBLISHED')).id}`, body: { title: 'Edited job', salaryMin: 10, salaryMax: 20, deadline: ISO_FUTURE(10), applicationLink: 'https://example.com/x' } }),
    shape: 'obj',
    bad: (x) => ({ path: `/jobs/${x.job.id}`, body: { salaryMin: 50, salaryMax: 10 } }),
  },
  'delete /jobs/:id': {
    ok: async (x) => ({ path: `/jobs/${(await fx.newJob(x.member.user.id)).id}` }),
    bad: () => ({ path: `/jobs/${MISSING_ID}` }),
    badStatus: 404,
  },
  'post /jobs/:id/approve': {
    ok: async (x) => ({ as: 'admin', path: `/jobs/${(await fx.newJob(x.other.user.id, 'PENDING_REVIEW')).id}/approve`, body: {} }),
    shape: 'obj',
    bad: () => ({ as: 'admin', path: `/jobs/${MISSING_ID}/approve`, body: {} }),
    badStatus: 404,
  },
  'post /jobs/:id/reject': {
    ok: async (x) => ({ as: 'admin', path: `/jobs/${(await fx.newJob(x.other.user.id, 'PENDING_REVIEW')).id}/reject`, body: { reason: 'Not a fit' } }),
    shape: 'obj',
    bad: () => ({ as: 'admin', path: `/jobs/${MISSING_ID}/reject`, body: { reason: 'x' } }),
    badStatus: 404,
  },

  // ---- Events ----
  'get /events': {
    ok: () => ({ path: '/events', query: { page: 1, limit: 12, type: 'OFFLINE', upcoming: 'true', search: 'Contract' } }),
    shape: 'list',
    bad: null,
  },
  'get /events/upcoming': { ok: () => ({ path: '/events/upcoming', query: { limit: 3 } }), shape: 'arr', bad: null },
  'get /events/:id': {
    ok: (x) => ({ path: `/events/${x.event.id}` }),
    shape: 'obj',
    bad: () => ({ path: `/events/${MISSING_ID}` }),
    badStatus: 404,
  },
  'get /events/:id/attendees': { ok: (x) => ({ path: `/events/${x.event.id}/attendees` }), shape: 'any' },
  'post /events': {
    ok: (x) => ({
      as: 'admin',
      path: '/events',
      body: {
        title: 'Smoke Meetup',
        description: 'Come along',
        eventType: 'HYBRID',
        venue: 'Hall 1',
        address: '1 Main Rd',
        city: 'Pune',
        joinLink: 'https://meet.example.com/smoke',
        bannerUrl: '/uploads/events/banner.png',
        startDate: ISO_FUTURE(10),
        endDate: ISO_FUTURE(11),
        capacity: 50,
        tags: ['networking'],
        isPublic: true,
        chapterId: x.chapter.id,
      },
    }),
    status: 201,
    shape: 'obj',
    check: (b) => expect(b.data).toMatchObject({ city: 'Pune', capacity: 50, eventType: 'HYBRID', venue: 'Hall 1' }),
    bad: () => ({ as: 'admin', path: '/events', body: { title: 'No dates' } }),
  },
  'patch /events/:id': {
    ok: async (x) => ({ as: 'admin', path: `/events/${(await fx.newEvent(x.admin.user.id)).id}`, body: { title: 'Edited event', city: 'Mumbai', capacity: 80, venue: 'Hall 2' } }),
    shape: 'obj',
    bad: () => ({ as: 'admin', path: `/events/${MISSING_ID}`, body: { title: 'x' } }),
    badStatus: 404,
  },
  'delete /events/:id': {
    ok: async (x) => ({ as: 'admin', path: `/events/${(await fx.newEvent(x.admin.user.id)).id}` }),
    bad: () => ({ as: 'admin', path: `/events/${MISSING_ID}` }),
    badStatus: 404,
  },
  'post /events/:id/rsvp': {
    ok: (x) => ({ as: 'other', path: `/events/${x.event.id}/rsvp`, body: {} }),
    shape: 'obj',
    bad: () => ({ as: 'other', path: `/events/${MISSING_ID}/rsvp`, body: {} }),
    badStatus: 404,
  },

  // ---- Network ----
  'get /network/connections': { ok: () => ({ path: '/network/connections', query: { page: 1, limit: 20 } }), shape: 'list', bad: () => ({ as: null, path: '/network/connections' }), badStatus: 401 },
  'get /network/requests': { ok: () => ({ path: '/network/requests' }), shape: 'obj', bad: null },
  'get /network/suggestions': { ok: () => ({ path: '/network/suggestions', query: { limit: 5 } }), shape: 'any', bad: null },
  'post /network/request/:userId': {
    ok: async () => ({ as: 'other', path: `/network/request/${(await fx.newUser()).user.id}`, body: {} }),
    status: 201,
    shape: 'obj',
    bad: () => ({ path: `/network/request/${MISSING_ID}`, body: {} }),
    badStatus: 404,
  },
  'post /network/respond/:id': {
    ok: async (x) => {
      const c = await fx.newConnection((await fx.newUser()).user.id, x.member.user.id);
      return { path: `/network/respond/${c.id}`, body: { accept: true } };
    },
    shape: 'obj',
    bad: (x) => ({ path: `/network/respond/${x.connection.id}`, body: {} }),
  },
  'delete /network/connection/:id': {
    ok: async (x) => {
      const c = await fx.newConnection((await fx.newUser()).user.id, x.member.user.id, 'ACCEPTED');
      return { path: `/network/connection/${c.id}` };
    },
    shape: 'obj',
    bad: () => ({ path: `/network/connection/${MISSING_ID}` }),
    badStatus: 404,
  },

  // ---- Messages ----
  'get /messages': { ok: () => ({ path: '/messages', query: { page: 1, limit: 20 } }), shape: 'any', bad: () => ({ as: null, path: '/messages' }), badStatus: 401 },
  'get /messages/unread': { ok: () => ({ path: '/messages/unread' }), shape: 'obj', bad: null },
  'get /messages/:partnerId': { ok: (x) => ({ path: `/messages/${x.other.user.id}`, query: { page: 1, limit: 50 } }), shape: 'any', bad: null },
  'post /messages/:receiverId': {
    ok: (x) => ({ path: `/messages/${x.other.user.id}`, body: { content: 'Hello from the contract suite', mediaUrl: '/uploads/messages/pic.png' } }),
    status: 201,
    shape: 'obj',
    bad: (x) => ({ path: `/messages/${x.other.user.id}`, body: { content: '' } }),
  },
  'post /messages/request/:id/respond': {
    ok: async (x) => {
      const stranger = await fx.newUser();
      const sent = await request(app).post(`/api/messages/${x.third.user.id}`).set('Authorization', stranger.auth).send({ content: 'Hi, can we talk?' });
      expect(sent.status).toBe(201);
      return { as: 'third', path: `/messages/request/${sent.body.data.id}/respond`, body: { accept: true } };
    },
    shape: 'any',
    bad: () => ({ path: `/messages/request/${MISSING_ID}/respond`, body: { accept: true } }),
    badStatus: 404,
  },
  'post /messages/:partnerId/read': { ok: (x) => ({ path: `/messages/${x.other.user.id}/read`, body: {} }), shape: 'any', bad: null },

  // ---- Notifications ----
  'get /notifications': {
    ok: () => ({ path: '/notifications', query: { page: 1, limit: 20, unread: 'true' } }),
    shape: 'list',
    bad: () => ({ as: null, path: '/notifications' }),
    badStatus: 401,
  },
  'get /notifications/unread': { ok: () => ({ path: '/notifications/unread' }), shape: 'obj', check: (b) => expect(b.data.unreadCount).toEqual(expect.any(Number)), bad: null },
  'post /notifications/read-all': { ok: () => ({ as: 'other', path: '/notifications/read-all', body: {} }), shape: 'any', bad: null },
  'post /notifications/:id/read': {
    ok: (x) => ({ path: `/notifications/${x.notification.id}/read`, body: {} }),
    shape: 'any',
    bad: () => ({ path: `/notifications/${MISSING_ID}/read`, body: {} }),
    badStatus: 404,
  },
  'delete /notifications/:id': {
    ok: async (x) => ({ path: `/notifications/${(await fx.newNotification(x.member.user.id)).id}` }),
    shape: 'any',
    bad: () => ({ path: `/notifications/${MISSING_ID}` }),
    badStatus: 404,
  },

  // ---- Gallery ----
  'get /gallery/albums': { ok: () => ({ path: '/gallery/albums', query: { page: 1, limit: 12, type: 'INSTITUTIONAL', search: 'Contract' } }), shape: 'list', bad: null },
  'get /gallery/albums/:id': {
    ok: (x) => ({ path: `/gallery/albums/${x.album.id}` }),
    shape: 'obj',
    bad: () => ({ path: `/gallery/albums/${MISSING_ID}` }),
    badStatus: 404,
  },
  'get /gallery/recent': { ok: () => ({ path: '/gallery/recent', query: { limit: 8 } }), shape: 'any', bad: null },
  'post /gallery/albums': {
    ok: (x) => ({
      as: 'admin',
      path: '/gallery/albums',
      body: { title: 'Smoke Album', description: 'Photos', albumType: 'EVENT', eventId: x.event.id, isPublic: true },
    }),
    status: 201,
    shape: 'obj',
    bad: () => ({ as: 'admin', path: '/gallery/albums', body: { albumType: 'BATCH', title: 'No year' } }),
  },
  'patch /gallery/albums/:id': {
    ok: async () => ({ as: 'admin', path: `/gallery/albums/${(await fx.newAlbum()).id}`, body: { title: 'Renamed', description: 'Updated', isPublic: false } }),
    shape: 'obj',
    bad: () => ({ as: 'admin', path: `/gallery/albums/${MISSING_ID}`, body: { title: 'x' } }),
    badStatus: 404,
  },
  'delete /gallery/albums/:id': {
    ok: async () => ({ as: 'admin', path: `/gallery/albums/${(await fx.newAlbum()).id}` }),
    shape: 'any',
    bad: () => ({ as: 'admin', path: `/gallery/albums/${MISSING_ID}` }),
    badStatus: 404,
  },
  'post /gallery/albums/:albumId/photos': {
    ok: async (x) => ({ as: 'admin', path: `/gallery/albums/${x.album.id}/photos`, attach: { field: 'photos', buffer: fx.PNG_1X1, filename: 'g.png', contentType: 'image/png' } }),
    status: 201,
    shape: 'any',
    bad: (x) => ({ as: 'admin', path: `/gallery/albums/${x.album.id}/photos` }),
  },
  'delete /gallery/photos/:id': {
    ok: async (x) => ({ as: 'admin', path: `/gallery/photos/${(await fx.newPhoto(x.album.id, x.admin.user.id)).id}` }),
    shape: 'any',
    bad: () => ({ as: 'admin', path: `/gallery/photos/${MISSING_ID}` }),
    badStatus: 404,
  },
  'post /gallery/photos/admin': {
    ok: (x) => ({ as: 'admin', path: '/gallery/photos/admin', body: { albumId: x.album.id, url: '/uploads/gallery/a.png', thumbnailUrl: '/uploads/gallery/a-t.png', caption: 'Smoke' } }),
    status: 201,
    shape: 'obj',
    bad: () => ({ as: 'admin', path: '/gallery/photos/admin', body: {} }),
  },
  'delete /gallery/photos/admin/:id': {
    ok: async (x) => ({ as: 'admin', path: `/gallery/photos/admin/${(await fx.newPhoto(x.album.id, x.admin.user.id)).id}` }),
    shape: 'any',
    bad: () => ({ as: 'admin', path: `/gallery/photos/admin/${MISSING_ID}` }),
    badStatus: 404,
  },

  // ---- News ----
  'get /news': { ok: () => ({ path: '/news', query: { page: 1, limit: 12, category: 'INSTITUTE_UPDATE', search: 'Contract' } }), shape: 'list', bad: null },
  'get /news/latest': { ok: () => ({ path: '/news/latest', query: { limit: 3 } }), shape: 'arr', bad: null },
  'get /news/:slug': {
    ok: (x) => ({ path: `/news/${x.article.slug}` }),
    shape: 'obj',
    bad: () => ({ path: '/news/no-such-article' }),
    badStatus: 404,
  },
  'post /news': {
    ok: () => ({ as: 'admin', path: '/news', body: { title: 'Smoke Story', content: 'A story body. '.repeat(20), excerpt: 'Short', category: 'ALUMNI_STORY', featuredImage: '/uploads/news/f.png' } }),
    status: 201,
    shape: 'obj',
    bad: () => ({ as: 'admin', path: '/news', body: { title: 'No content' } }),
  },
  'patch /news/:id': {
    ok: async (x) => ({ as: 'admin', path: `/news/${(await fx.newArticle(x.admin.user.id, 'DRAFT')).id}`, body: { title: 'Edited story', excerpt: 'New', category: 'NEWSLETTER' } }),
    shape: 'obj',
    bad: () => ({ as: 'admin', path: `/news/${MISSING_ID}`, body: { title: 'x' } }),
    badStatus: 404,
  },
  'post /news/:id/publish': {
    ok: async (x) => ({ as: 'admin', path: `/news/${(await fx.newArticle(x.admin.user.id, 'DRAFT')).id}/publish`, body: {} }),
    shape: 'obj',
    bad: () => ({ as: 'admin', path: `/news/${MISSING_ID}/publish`, body: {} }),
    badStatus: 404,
  },
  'post /news/:id/unpublish': {
    ok: async (x) => ({ as: 'admin', path: `/news/${(await fx.newArticle(x.admin.user.id, 'PUBLISHED')).id}/unpublish`, body: {} }),
    shape: 'obj',
    bad: () => ({ as: 'admin', path: `/news/${MISSING_ID}/unpublish`, body: {} }),
    badStatus: 404,
  },
  'delete /news/:id': {
    ok: async (x) => ({ as: 'admin', path: `/news/${(await fx.newArticle(x.admin.user.id, 'DRAFT')).id}` }),
    shape: 'any',
    bad: () => ({ as: 'admin', path: `/news/${MISSING_ID}` }),
    badStatus: 404,
  },

  // ---- College videos ----
  'get /videos': {
    ok: (x) => ({ path: '/videos', query: { page: 1, limit: 12, category: 'Campus', search: x.video.title } }),
    shape: 'obj',
    check: (b, x) => {
      nestedPage(b);
      expect(b.data.data.map((v: any) => v.id)).toContain(x.video.id);
    },
    bad: () => ({ as: 'admin', path: '/videos', query: { status: 'NOPE' } }),
  },
  'get /videos/mine': {
    ok: () => ({ path: '/videos/mine', query: { page: 1, limit: 50 } }),
    shape: 'obj',
    check: (b, x) => {
      nestedPage(b);
      expect(b.data.data.map((v: any) => v.id)).toContain(x.video.id);
    },
    bad: () => ({ as: null, path: '/videos/mine' }),
    badStatus: 401,
  },
  'get /videos/:id': {
    ok: (x) => ({ path: `/videos/${x.video.id}` }),
    shape: 'obj',
    check: (b, x) => expect(b.data).toMatchObject({ id: x.video.id, status: 'APPROVED' }),
    bad: () => ({ path: `/videos/${MISSING_ID}` }),
    badStatus: 404,
  },
  'post /videos/upload': {
    ok: () => ({ path: '/videos/upload', attach: { field: 'video', buffer: MP4, filename: 'a.mp4', contentType: 'video/mp4' } }),
    status: 201,
    shape: 'obj',
    check: (b) => expect(b.data).toMatchObject({ videoUrl: expect.stringMatching(/^\/uploads\/college-videos\/[\w.-]+\.mp4$/), mimeType: 'video/mp4' }),
    bad: () => ({ path: '/videos/upload' }),
  },
  'post /videos/upload-thumbnail': {
    ok: () => ({ path: '/videos/upload-thumbnail', attach: { field: 'image', buffer: fx.PNG_1X1, filename: 't.png', contentType: 'image/png' } }),
    status: 201,
    shape: 'obj',
    check: (b) => expect(b.data.url).toMatch(/^\/uploads\/video-thumbnails\/[\w.-]+\.png$/),
    bad: () => ({ path: '/videos/upload-thumbnail' }),
  },
  'post /videos': {
    ok: () => ({ path: '/videos', body: { title: 'Smoke Video', description: 'Campus tour', category: 'Campus', videoUrl: ref('college-videos', 'mp4'), thumbnailUrl: ref('video-thumbnails', 'png') } }),
    status: 201,
    shape: 'obj',
    check: (b, x) => expect(b.data).toMatchObject({ title: 'Smoke Video', status: 'PENDING', submittedById: x.member.user.id }),
    // somebody else's upload cannot be claimed as a video
    bad: () => ({ path: '/videos', body: { title: 'Foreign file', videoUrl: '/uploads/gallery/contract.png' } }),
  },
  'patch /videos/:id': {
    ok: async (x) => ({
      as: 'admin',
      path: `/videos/${(await fx.newVideo(x.member.user.id, 'PENDING')).id}`,
      body: { title: 'Edited video', description: 'Updated', category: 'Lectures', thumbnailUrl: ref('video-thumbnails', 'png') },
    }),
    shape: 'obj',
    check: (b) => expect(b.data).toMatchObject({ title: 'Edited video', category: 'Lectures' }),
    bad: (x) => ({ as: 'admin', path: `/videos/${x.video.id}`, body: { title: '  ' } }),
  },
  'post /videos/:id/approve': {
    ok: async (x) => ({ as: 'admin', path: `/videos/${(await fx.newVideo(x.member.user.id, 'PENDING')).id}/approve`, body: {} }),
    shape: 'obj',
    check: (b) => expect(b.data.status).toBe('APPROVED'),
    bad: () => ({ as: 'admin', path: `/videos/${MISSING_ID}/approve`, body: {} }),
    badStatus: 404,
  },
  'post /videos/:id/reject': {
    ok: async (x) => ({ as: 'admin', path: `/videos/${(await fx.newVideo(x.member.user.id, 'PENDING')).id}/reject`, body: { reason: 'Off topic' } }),
    shape: 'obj',
    check: (b) => expect(b.data).toMatchObject({ status: 'REJECTED', rejectionReason: 'Off topic' }),
    bad: () => ({ as: 'admin', path: `/videos/${MISSING_ID}/reject`, body: { reason: 'x' } }),
    badStatus: 404,
  },
  'delete /videos/:id': {
    ok: async (x) => ({ path: `/videos/${(await fx.newVideo(x.member.user.id, 'PENDING')).id}` }),
    shape: 'any',
    bad: () => ({ path: `/videos/${MISSING_ID}` }),
    badStatus: 404,
  },

  // ---- College magazine ----
  'get /magazine': {
    ok: () => ({ path: '/magazine', query: { page: 1, limit: 12 } }),
    shape: 'obj',
    check: (b) => {
      nestedPage(b);
      expect(b.data.data.every((m: any) => m.isPublished)).toBe(true);
    },
    bad: null,
  },
  'get /magazine/:id': {
    ok: (x) => ({ path: `/magazine/${x.magazine.id}` }),
    shape: 'obj',
    check: (b, x) => expect(b.data.id).toBe(x.magazine.id),
    bad: () => ({ path: `/magazine/${MISSING_ID}` }),
    badStatus: 404,
  },
  'post /magazine/upload-file': {
    ok: () => ({ as: 'admin', path: '/magazine/upload-file', attach: { field: 'file', buffer: PDF, filename: 'm.pdf', contentType: 'application/pdf' } }),
    status: 201,
    shape: 'obj',
    check: (b) => expect(b.data.fileUrl).toMatch(/^\/uploads\/magazines\/[\w.-]+\.pdf$/),
    bad: () => ({ as: 'admin', path: '/magazine/upload-file' }),
  },
  'post /magazine/upload-cover': {
    ok: () => ({ as: 'admin', path: '/magazine/upload-cover', attach: { field: 'image', buffer: fx.PNG_1X1, filename: 'c.png', contentType: 'image/png' } }),
    status: 201,
    shape: 'obj',
    check: (b) => expect(b.data.url).toMatch(/^\/uploads\/magazine-covers\/[\w.-]+\.png$/),
    bad: () => ({ as: 'admin', path: '/magazine/upload-cover' }),
  },
  'post /magazine': {
    ok: () => ({ as: 'admin', path: '/magazine', body: { title: 'Smoke Issue', edition: 'Vol 9', description: 'Annual edition', coverImageUrl: ref('magazine-covers', 'png'), fileUrl: ref('magazines', 'pdf') } }),
    status: 201,
    shape: 'obj',
    check: (b) => expect(b.data).toMatchObject({ title: 'Smoke Issue', edition: 'Vol 9', isPublished: true }),
    bad: () => ({ as: 'admin', path: '/magazine', body: { title: 'No PDF' } }),
  },
  'patch /magazine/:id': {
    ok: async (x) => ({
      as: 'admin',
      path: `/magazine/${(await fx.newMagazine(x.admin.user.id)).id}`,
      body: { title: 'Edited issue', edition: 'Vol 2', description: 'Updated', coverImageUrl: ref('magazine-covers', 'png'), isPublished: false },
    }),
    shape: 'obj',
    check: (b) => expect(b.data).toMatchObject({ title: 'Edited issue', edition: 'Vol 2', isPublished: false }),
    bad: (x) => ({ as: 'admin', path: `/magazine/${x.magazine.id}`, body: { title: '' } }),
  },
  'delete /magazine/:id': {
    ok: async (x) => ({ as: 'admin', path: `/magazine/${(await fx.newMagazine(x.admin.user.id)).id}` }),
    shape: 'any',
    bad: () => ({ as: 'admin', path: `/magazine/${MISSING_ID}` }),
    badStatus: 404,
  },

  // ---- College requirements ----
  'get /requirements': {
    ok: () => ({ path: '/requirements', query: { page: 1, limit: 12, category: 'SOFTWARE', search: 'Contract' } }),
    shape: 'obj',
    check: (b) => {
      nestedPage(b);
      expect(b.data.data.every((r: any) => r.status === 'OPEN')).toBe(true);
    },
    bad: () => ({ as: 'admin', path: '/requirements', query: { status: 'NOPE' } }),
  },
  'post /requirements/responses/:responseId/review': {
    ok: async (x) => {
      const offer = await fx.newRequirementResponse((await fx.newRequirement(x.admin.user.id)).id, x.other.user.id);
      return { as: 'admin', path: `/requirements/responses/${offer.id}/review`, body: { accept: true } };
    },
    shape: 'obj',
    check: (b) => expect(b.data.status).toBe('ACCEPTED'),
    bad: () => ({ as: 'admin', path: `/requirements/responses/${MISSING_ID}/review`, body: { accept: true } }),
    badStatus: 404,
  },
  'get /requirements/:id': {
    ok: (x) => ({ path: `/requirements/${x.requirement.id}` }),
    shape: 'obj',
    check: (b, x) => expect(b.data.id).toBe(x.requirement.id),
    bad: () => ({ path: `/requirements/${MISSING_ID}` }),
    badStatus: 404,
  },
  'post /requirements': {
    ok: () => ({ as: 'admin', path: '/requirements', body: { title: 'Smoke Requirement', description: 'We need a projector', category: 'HARDWARE' } }),
    status: 201,
    shape: 'obj',
    check: (b) => expect(b.data).toMatchObject({ title: 'Smoke Requirement', category: 'HARDWARE', status: 'OPEN' }),
    bad: () => ({ as: 'admin', path: '/requirements', body: { title: 'No description' } }),
  },
  'patch /requirements/:id': {
    ok: async (x) => ({
      as: 'admin',
      path: `/requirements/${(await fx.newRequirement(x.admin.user.id)).id}`,
      body: { title: 'Edited requirement', description: 'Updated need', category: 'EXPERTISE', status: 'FULFILLED' },
    }),
    shape: 'obj',
    check: (b) => expect(b.data).toMatchObject({ title: 'Edited requirement', category: 'EXPERTISE', status: 'FULFILLED' }),
    bad: (x) => ({ as: 'admin', path: `/requirements/${x.requirement.id}`, body: { status: 'NOPE' } }),
  },
  'delete /requirements/:id': {
    ok: async (x) => ({ as: 'admin', path: `/requirements/${(await fx.newRequirement(x.admin.user.id)).id}` }),
    shape: 'any',
    bad: () => ({ as: 'admin', path: `/requirements/${MISSING_ID}` }),
    badStatus: 404,
  },
  'post /requirements/:id/respond': {
    // one offer per alum per requirement, so each call targets a fresh requirement
    ok: async (x) => ({ as: 'other', path: `/requirements/${(await fx.newRequirement(x.admin.user.id)).id}/respond`, body: { message: 'I can help with this' } }),
    status: 201,
    shape: 'obj',
    check: (b, x) => expect(b.data).toMatchObject({ userId: x.other.user.id, status: 'OFFERED' }),
    bad: (x) => ({ as: 'other', path: `/requirements/${x.requirement.id}/respond`, body: { message: '  ' } }),
  },

  // ---- Job referrals ----
  'get /referrals/referrers': {
    ok: () => ({ as: 'other', path: '/referrals/referrers', query: { company: 'Contract Co' } }),
    shape: 'arr',
    check: (b, x) => expect(b.data.map((p: any) => p.user.id)).toContain(x.member.user.id),
    bad: () => ({ as: 'other', path: '/referrals/referrers', query: { company: 'x' } }),
  },
  'get /referrals/received': { ok: () => ({ path: '/referrals/received', query: { page: 1, limit: 20 } }), shape: 'obj', check: nestedPage, bad: () => ({ as: null, path: '/referrals/received' }), badStatus: 401 },
  'get /referrals/sent': { ok: () => ({ path: '/referrals/sent', query: { page: 1, limit: 20 } }), shape: 'obj', check: nestedPage, bad: () => ({ as: null, path: '/referrals/sent' }), badStatus: 401 },
  'post /referrals': {
    // a member may hold only 10 pending requests, so every call comes from a fresh requester
    ok: async (x) => {
      const requester = await fx.newUser();
      return { as: null, path: '/referrals', headers: { Authorization: requester.auth }, body: { targetId: x.other.user.id, company: 'Contract Co', message: 'Could you refer me?', jobId: x.job.id } };
    },
    status: 201,
    shape: 'obj',
    check: (b, x) => expect(b.data).toMatchObject({ targetId: x.other.user.id, company: 'Contract Co', status: 'PENDING', jobId: x.job.id }),
    bad: () => ({ path: '/referrals', body: { company: 'Contract Co' } }),
  },
  'post /referrals/:id/respond': {
    ok: async (x) => ({ as: 'member', path: `/referrals/${(await fx.newReferral((await fx.newUser()).user.id, x.member.user.id)).id}/respond`, body: { accept: true } }),
    shape: 'obj',
    check: (b) => expect(b.data.status).toBe('ACCEPTED'),
    bad: () => ({ path: `/referrals/${MISSING_ID}/respond`, body: { accept: true } }),
    badStatus: 404,
  },

  // ---- Chapters ----
  'get /chapters': {
    ok: () => ({ path: '/chapters', query: { page: 1, limit: 20, search: 'Chapter', region: 'Pune' } }),
    shape: 'list',
    check: (b) => expect(b.regions).toEqual(expect.any(Array)),
    bad: null,
  },
  'get /chapters/my': { ok: () => ({ path: '/chapters/my' }), shape: 'arr', bad: () => ({ as: null, path: '/chapters/my' }), badStatus: 401 },
  'get /chapters/:id': {
    ok: (x) => ({ path: `/chapters/${x.chapter.id}` }),
    shape: 'obj',
    bad: () => ({ path: `/chapters/${MISSING_ID}` }),
    badStatus: 404,
  },
  'get /chapters/:id/members': { ok: (x) => ({ path: `/chapters/${x.chapter.id}/members`, query: { page: 1, limit: 20 } }), shape: 'list' },
  'post /chapters': {
    ok: (x) => ({ as: 'admin', path: '/chapters', body: { name: fx.uniq('Smoke Chapter'), region: 'Delhi', description: 'New chapter', logoUrl: '/uploads/chapters/l.png', adminUserId: x.chapterAdmin.user.id } }),
    status: 201,
    shape: 'obj',
    bad: () => ({ as: 'admin', path: '/chapters', body: { name: 'No region' } }),
  },
  'patch /chapters/:id': {
    ok: (x) => ({ as: 'chapterAdmin', path: `/chapters/${x.chapter.id}`, body: { description: 'Edited chapter', region: 'Pune', logoUrl: '/uploads/chapters/l2.png' } }),
    shape: 'obj',
    bad: (x) => ({ as: 'chapterAdmin', path: `/chapters/${x.chapter.id}`, body: { name: '' } }),
  },
  'put /chapters/:id/admin': {
    ok: async (x) => ({ as: 'admin', path: `/chapters/${(await fx.newChapter()).id}/admin`, body: { userId: x.chapterAdmin.user.id } }),
    shape: 'any',
    bad: (x) => ({ as: 'admin', path: `/chapters/${x.chapter.id}/admin`, body: {} }),
  },
  'delete /chapters/:id': {
    ok: async () => ({ as: 'superAdmin', path: `/chapters/${(await fx.newChapter()).id}` }),
    shape: 'any',
    bad: () => ({ as: 'superAdmin', path: `/chapters/${MISSING_ID}` }),
    badStatus: 404,
  },
  'post /chapters/:id/join': {
    ok: async () => ({ as: 'other', path: `/chapters/${(await fx.newChapter()).id}/join`, body: {} }),
    shape: 'any',
    bad: () => ({ as: 'other', path: `/chapters/${MISSING_ID}/join`, body: {} }),
    badStatus: 404,
  },
  'post /chapters/:id/leave': {
    ok: async (x) => {
      const chapter = await fx.newChapter();
      const joined = await request(app).post(`/api/chapters/${chapter.id}/join`).set('Authorization', x.other.auth).send({});
      expect(joined.status).toBeLessThan(300);
      return { as: 'other', path: `/chapters/${chapter.id}/leave`, body: {} };
    },
    shape: 'any',
    bad: () => ({ as: 'other', path: `/chapters/${MISSING_ID}/leave`, body: {} }),
    badStatus: [400, 404],
  },

  // ---- Marketplace ----
  'get /marketplace': { ok: () => ({ path: '/marketplace', query: { page: 1, limit: 12, type: 'SERVICE', category: 'Consulting', location: 'Pune', search: 'Contract' } }), shape: 'list', bad: null },
  'get /marketplace/categories': { ok: () => ({ path: '/marketplace/categories' }), shape: 'arr', bad: null },
  'get /marketplace/my': { ok: () => ({ path: '/marketplace/my' }), shape: 'arr', bad: () => ({ as: null, path: '/marketplace/my' }), badStatus: 401 },
  'get /marketplace/:id': {
    ok: (x) => ({ path: `/marketplace/${x.listing.id}` }),
    shape: 'obj',
    bad: () => ({ path: `/marketplace/${MISSING_ID}` }),
    badStatus: 404,
  },
  'post /marketplace/upload-image': {
    ok: () => ({ path: '/marketplace/upload-image', attach: { field: 'image', buffer: fx.PNG_1X1, filename: 'l.png', contentType: 'image/png' } }),
    status: 201,
    shape: 'obj',
    check: (b) => expect(b.data.url).toMatch(/^\/uploads\/marketplace\/[\w.-]+\.png$/),
    bad: () => ({ path: '/marketplace/upload-image' }),
  },
  'post /marketplace': {
    ok: () => ({
      path: '/marketplace',
      body: { type: 'BUSINESS', title: 'Smoke Listing', category: 'Consulting', description: 'A description that is long enough', location: 'Pune', website: 'https://example.com', contactInfo: 'hi@example.com', priceRange: 'INR 500-2,000' },
    }),
    status: 201,
    shape: 'obj',
    bad: () => ({ path: '/marketplace', body: { title: 'x' } }),
  },
  'patch /marketplace/:id': {
    ok: async (x) => ({ path: `/marketplace/${(await fx.newListing(x.member.user.id)).id}`, body: { title: 'Edited listing', website: '', isActive: false } }),
    shape: 'obj',
    bad: (x) => ({ path: `/marketplace/${x.listing.id}`, body: { website: 'javascript:alert(1)' } }),
  },
  'delete /marketplace/:id': {
    ok: async (x) => ({ path: `/marketplace/${(await fx.newListing(x.member.user.id)).id}` }),
    shape: 'any',
    bad: () => ({ path: `/marketplace/${MISSING_ID}` }),
    badStatus: 404,
  },

  // ---- Memberships ----
  'get /memberships/tiers': { ok: () => ({ path: '/memberships/tiers' }), shape: 'arr', bad: null },
  'get /memberships/tiers/:id': {
    ok: (x) => ({ path: `/memberships/tiers/${x.tier.id}` }),
    shape: 'obj',
    bad: () => ({ path: `/memberships/tiers/${MISSING_ID}` }),
    badStatus: 404,
  },
  'get /memberships/my': { ok: () => ({ path: '/memberships/my' }), shape: 'any', bad: () => ({ as: null, path: '/memberships/my' }), badStatus: 401 },
  'get /memberships/history': { ok: () => ({ path: '/memberships/history', query: { page: 1, limit: 10 } }), shape: 'list', bad: null },
  'post /memberships/order': {
    ok: (x) => ({ path: '/memberships/order', body: { tierId: x.tier.id } }),
    status: [200, 201],
    shape: 'obj',
    check: (b) => expect(b.data).toEqual(expect.objectContaining({ orderId: expect.any(String), keyId: expect.any(String) })),
    bad: () => ({ path: '/memberships/order', body: {} }),
  },
  'post /memberships/verify': {
    ok: async (x) => {
      const order = await request(app).post('/api/memberships/order').set('Authorization', x.third.auth).send({ tierId: x.tier.id });
      expect(order.status).toBeLessThan(300);
      const orderId = order.body.data.orderId;
      return { as: 'third', path: '/memberships/verify', body: { razorpay_order_id: orderId, razorpay_payment_id: 'pay_contract', razorpay_signature: signCheckout(orderId, 'pay_contract') } };
    },
    shape: 'any',
    bad: () => ({ path: '/memberships/verify', body: { razorpay_order_id: 'o', razorpay_payment_id: 'p', razorpay_signature: 'bad' } }),
  },
  'post /memberships/tiers': {
    ok: () => ({ as: 'admin', path: '/memberships/tiers', body: { name: fx.uniq('Smoke Tier'), description: 'Smoke', priceInr: 999, durationMonths: 12, benefits: ['Badge', 'Events'], badgeColor: '#ff0000' } }),
    status: 201,
    shape: 'obj',
    bad: () => ({ as: 'admin', path: '/memberships/tiers', body: { name: 'No price' } }),
  },
  'patch /memberships/tiers/:id': {
    ok: async () => ({ as: 'admin', path: `/memberships/tiers/${(await fx.newTier()).id}`, body: { description: 'Edited', priceInr: 750, isActive: true } }),
    shape: 'obj',
    bad: () => ({ as: 'admin', path: `/memberships/tiers/${MISSING_ID}`, body: { description: 'x' } }),
    badStatus: 404,
  },
  'get /memberships/members': { ok: () => ({ as: 'admin', path: '/memberships/members', query: { page: 1, limit: 20 } }), shape: 'list', bad: null },

  // ---- Donations ----
  'get /donations/wall': { ok: () => ({ path: '/donations/wall', query: { page: 1, limit: 20 } }), shape: 'list', bad: null },
  'get /donations/featured': { ok: () => ({ path: '/donations/featured' }), shape: 'arr', bad: null },
  'get /donations/chapters': { ok: () => ({ path: '/donations/chapters' }), shape: 'arr', bad: null },
  'get /donations/stats': { ok: () => ({ path: '/donations/stats' }), shape: 'obj', bad: null },
  'get /donations/leaderboard': { ok: () => ({ path: '/donations/leaderboard' }), shape: 'arr', bad: null },
  'get /donations/my': { ok: () => ({ path: '/donations/my' }), shape: 'arr', bad: () => ({ as: null, path: '/donations/my' }), badStatus: 401 },
  'post /donations/order': {
    ok: (x) => ({ path: '/donations/order', body: { amount: 500, chapterId: x.chapter.id, isAnonymous: false, dedicatedTo: 'Batch 2018', message: 'Thanks' } }),
    status: [200, 201],
    shape: 'obj',
    check: (b) => expect(b.data).toEqual(expect.objectContaining({ orderId: expect.any(String), amount: 50000 })),
    bad: () => ({ path: '/donations/order', body: { amount: -5 } }),
  },
  'post /donations/verify': {
    ok: async (x) => {
      const order = await request(app).post('/api/donations/order').set('Authorization', x.member.auth).send({ amount: 100 });
      expect(order.status).toBeLessThan(300);
      const orderId = order.body.data.orderId;
      return { path: '/donations/verify', body: { razorpay_order_id: orderId, razorpay_payment_id: 'pay_contract_d', razorpay_signature: signCheckout(orderId, 'pay_contract_d') } };
    },
    shape: 'any',
    bad: () => ({ path: '/donations/verify', body: { razorpay_order_id: 'o', razorpay_payment_id: 'p', razorpay_signature: 'bad' } }),
  },

  // ---- Transactions ----
  'get /transactions/my': { ok: () => ({ path: '/transactions/my', query: { page: 1, limit: 10, type: 'DONATION', status: 'SUCCESS' } }), shape: 'list', bad: null },
  'get /transactions/:id/receipt': {
    ok: (x) => ({ path: `/transactions/${x.transaction.id}/receipt` }),
    shape: 'file',
    bad: () => ({ path: `/transactions/${MISSING_ID}/receipt` }),
    badStatus: 404,
  },

  // ---- Payment webhook ----
  'post /payments/webhook/razorpay': {
    ok: () => {
      const raw = JSON.stringify({ event: 'contract.ping', payload: {} });
      const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
      return { as: null, path: '/payments/webhook/razorpay', raw, headers: { 'x-razorpay-signature': signature, 'content-type': 'application/json' } };
    },
    shape: 'any',
    bad: () => ({ as: null, path: '/payments/webhook/razorpay', raw: '{}', headers: { 'x-razorpay-signature': 'bad', 'content-type': 'application/json' } }),
    badStatus: [400, 401],
  },

  // ---- Invites ----
  'get /invites/verify/:token': {
    ok: async (x) => {
      const generated = await request(app).post('/api/invites/generate-link').set('Authorization', x.member.auth).send({ batchYear: 2018 });
      expect(generated.status).toBeLessThan(300);
      return { as: null, path: `/invites/verify/${tokenOfLink(generated.body.data.link)}` };
    },
    shape: 'any',
    bad: () => ({ as: null, path: '/invites/verify/not-a-token' }),
    badStatus: [400, 404],
  },
  'get /invites/sent': { ok: () => ({ path: '/invites/sent', query: { page: 1, limit: 20 } }), shape: 'list', bad: null },
  'get /invites/stats': { ok: () => ({ path: '/invites/stats' }), shape: 'obj', bad: null },
  'post /invites/send': {
    ok: () => ({ path: '/invites/send', body: { email: fx.uniqueEmail('invitee'), name: 'Invitee', batchYear: 2017, message: 'Join us' } }),
    status: 201,
    shape: 'obj',
    bad: () => ({ path: '/invites/send', body: {} }),
  },
  'post /invites/bulk': {
    ok: () => ({ path: '/invites/bulk', body: { invites: [{ email: fx.uniqueEmail('bulk1'), name: 'One', batchYear: 2016 }, { email: fx.uniqueEmail('bulk2') }], message: 'Welcome' } }),
    status: [200, 201],
    shape: 'any',
    bad: () => ({ path: '/invites/bulk', body: { invites: [] } }),
  },
  'post /invites/generate-link': { ok: () => ({ path: '/invites/generate-link', body: { batchYear: 2018 } }), status: [200, 201], shape: 'obj', bad: () => ({ as: null, path: '/invites/generate-link', body: {} }), badStatus: 401 },
  'post /invites/:token/accept': {
    ok: async (x) => {
      const generated = await request(app).post('/api/invites/generate-link').set('Authorization', x.other.auth).send({});
      return { as: 'third', path: `/invites/${tokenOfLink(generated.body.data.link)}/accept`, body: {} };
    },
    status: [200, 400, 409],
    shape: 'any',
    bad: () => ({ path: '/invites/not-a-token/accept', body: {} }),
    badStatus: [400, 404],
  },

  // ---- Mentorship ----
  'get /mentorship/mentors': { ok: () => ({ path: '/mentorship/mentors', query: { page: 1, limit: 20, focusArea: 'Careers', search: 'Integration', available: 'true' } }), shape: 'obj', check: (b) => expect(b.data.data).toEqual(expect.any(Array)), bad: () => ({ as: null, path: '/mentorship/mentors' }), badStatus: 401 },
  'get /mentorship/profile': { ok: () => ({ path: '/mentorship/profile' }), shape: 'any', status: [200, 404] },
  'get /mentorship/profile/:userId': {
    ok: async (x) => {
      await fx.prisma.mentorProfile.upsert({ where: { userId: x.other.user.id }, update: {}, create: { userId: x.other.user.id, focusAreas: ['Careers'], maxMentees: 5 } });
      return { path: `/mentorship/profile/${x.other.user.id}` };
    },
    shape: 'obj',
    bad: () => ({ path: `/mentorship/profile/${MISSING_ID}` }),
    badStatus: 404,
  },
  'post /mentorship/profile': {
    ok: async () => ({ as: null, path: '/mentorship/profile', headers: { Authorization: (await fx.newUser()).auth }, body: { focusAreas: ['Careers', 'Startups'], availability: 'Weekends', bio: 'I help', maxMentees: 3 } }),
    status: 201,
    shape: 'obj',
    bad: () => ({ path: '/mentorship/profile', body: {} }),
  },
  'patch /mentorship/profile': {
    ok: async () => {
      const actor = await fx.newUser();
      await fx.newMentor(actor.user.id);
      return { as: null, path: '/mentorship/profile', headers: { Authorization: actor.auth }, body: { focusAreas: ['Design'], availability: 'Evenings', bio: 'Updated', maxMentees: 4, isActive: true } };
    },
    shape: 'obj',
    bad: () => ({ path: '/mentorship/profile', body: { maxMentees: -1 } }),
  },
  'delete /mentorship/profile': {
    ok: async () => {
      const actor = await fx.newUser();
      await fx.newMentor(actor.user.id);
      return { as: null, path: '/mentorship/profile', headers: { Authorization: actor.auth } };
    },
    shape: 'any',
    // a member without a mentor profile
    bad: async () => ({ as: null, path: '/mentorship/profile', headers: { Authorization: (await fx.newUser()).auth } }),
    badStatus: 404,
  },
  'get /mentorship/requests/mentor': { ok: () => ({ as: 'other', path: '/mentorship/requests/mentor', query: { status: 'ACCEPTED' } }), shape: 'any', bad: null },
  'get /mentorship/requests/mentee': { ok: () => ({ as: 'third', path: '/mentorship/requests/mentee', query: { status: 'ACCEPTED' } }), shape: 'any', bad: null },
  'post /mentorship/request/:mentorId': {
    ok: async () => {
      const mentor = await fx.newUser();
      await fx.newMentor(mentor.user.id);
      return { as: 'member', path: `/mentorship/request/${mentor.user.id}`, body: { message: 'Please mentor me' } };
    },
    status: 201,
    shape: 'obj',
    bad: () => ({ path: `/mentorship/request/${MISSING_ID}`, body: { message: 'hi' } }),
    badStatus: 404,
  },
  'post /mentorship/request/:requestId/respond': {
    ok: async (x) => {
      const mentor = await fx.newUser();
      const req = await fx.newMentorshipRequest(x.member.user.id, mentor.user.id, 'PENDING');
      return { as: null, path: `/mentorship/request/${req.id}/respond`, headers: { Authorization: mentor.auth }, body: { accept: true } };
    },
    shape: 'obj',
    bad: () => ({ path: `/mentorship/request/${MISSING_ID}/respond`, body: { accept: true } }),
    badStatus: 404,
  },
  'post /mentorship/request/:requestId/end': {
    ok: async (x) => {
      const mentor = await fx.newUser();
      const req = await fx.newMentorshipRequest(x.member.user.id, mentor.user.id, 'ACCEPTED');
      return { as: null, path: `/mentorship/request/${req.id}/end`, headers: { Authorization: mentor.auth }, body: {} };
    },
    shape: 'any',
    bad: () => ({ path: `/mentorship/request/${MISSING_ID}/end`, body: {} }),
    badStatus: 404,
  },
  'get /mentorship/request/:requestId/sessions': {
    ok: (x) => ({ as: 'other', path: `/mentorship/request/${x.mentorRequest.id}/sessions` }),
    shape: 'arr',
    bad: () => ({ path: `/mentorship/request/${MISSING_ID}/sessions` }),
    badStatus: 404,
  },
  'post /mentorship/request/:requestId/sessions': {
    ok: (x) => ({ as: 'other', path: `/mentorship/request/${x.mentorRequest.id}/sessions`, body: { scheduledAt: ISO_FUTURE(5), notes: 'Agenda' } }),
    status: 201,
    shape: 'obj',
    bad: (x) => ({ as: 'other', path: `/mentorship/request/${x.mentorRequest.id}/sessions`, body: {} }),
  },
  'post /mentorship/sessions/:sessionId/complete': {
    ok: async (x) => ({ as: 'other', path: `/mentorship/sessions/${(await fx.newSession(x.mentorRequest.id)).id}/complete`, body: { outcomes: 'Went well' } }),
    shape: 'obj',
    bad: () => ({ path: `/mentorship/sessions/${MISSING_ID}/complete`, body: {} }),
    badStatus: 404,
  },

  // ---- Admin ----
  'get /admin/stats': { ok: () => ({ as: 'admin', path: '/admin/stats' }), shape: 'obj', bad: () => ({ as: 'member', path: '/admin/stats' }), badStatus: 403 },
  'get /platform/readiness': { ok: () => ({ as: 'admin', path: '/platform/readiness' }), shape: 'any', bad: () => ({ as: 'member', path: '/platform/readiness' }), badStatus: 403 },
  // ---- Alumni approval (the administrator's review queue) ----
  'get /admin/approvals': {
    ok: async () => {
      await fx.newPendingUser();
      return { as: 'admin', path: '/admin/approvals', query: { status: 'PENDING', search: '12CE045', page: 1, limit: 20 } };
    },
    shape: 'list',
    check: (b) => {
      expect(b.data.length).toBeGreaterThan(0);
      expect(b.data[0]).toMatchObject({ approvalStatus: 'PENDING', enrollmentNumber: '12CE045' });
      expect(b.data[0]).not.toHaveProperty('passwordHash');
    },
    bad: () => ({ as: 'member', path: '/admin/approvals' }),
    badStatus: 403,
  },
  'get /admin/approvals/summary': {
    ok: () => ({ as: 'admin', path: '/admin/approvals/summary' }),
    shape: 'obj',
    check: (b) => expect(b.data).toEqual({ pending: expect.any(Number), approved: expect.any(Number), rejected: expect.any(Number) }),
    bad: () => ({ as: 'member', path: '/admin/approvals/summary' }),
    badStatus: 403,
  },
  'post /admin/approvals/:id/approve': {
    ok: async () => ({ as: 'admin', path: `/admin/approvals/${(await fx.newPendingUser()).user.id}/approve`, body: { note: 'Found in the 2018 batch list' } }),
    shape: 'obj',
    check: (b) => expect(b.data).toMatchObject({ approvalStatus: 'APPROVED', approvalNote: 'Found in the 2018 batch list' }),
    bad: () => ({ as: 'admin', path: `/admin/approvals/${MISSING_ID}/approve`, body: {} }),
    badStatus: 404,
  },
  'post /admin/approvals/:id/reject': {
    ok: async () => ({ as: 'admin', path: `/admin/approvals/${(await fx.newPendingUser()).user.id}/reject`, body: { reason: 'We could not find you in the 2018 batch.' } }),
    shape: 'obj',
    check: (b) => expect(b.data).toMatchObject({ approvalStatus: 'REJECTED', approvalNote: 'We could not find you in the 2018 batch.' }),
    bad: async () => ({ as: 'admin', path: `/admin/approvals/${(await fx.newPendingUser()).user.id}/reject`, body: {} }),
    badStatus: 400,
  },
  'get /admin/users': { ok: () => ({ as: 'admin', path: '/admin/users', query: { page: 1, limit: 20, search: 'Integration', role: 'MEMBER', isActive: 'true', batchYear: 2018 } }), shape: 'list', bad: () => ({ as: 'member', path: '/admin/users' }), badStatus: 403 },
  'patch /admin/users/:id/role': {
    ok: async () => ({ as: 'superAdmin', path: `/admin/users/${(await fx.newUser()).user.id}/role`, body: { role: 'CHAPTER_ADMIN' } }),
    shape: 'obj',
    bad: (x) => ({ as: 'admin', path: `/admin/users/${x.member.user.id}/role`, body: { role: 'NOPE' } }),
  },
  'patch /admin/users/:id/status': {
    ok: async () => ({ as: 'admin', path: `/admin/users/${(await fx.newUser()).user.id}/status`, body: { isActive: false, reason: 'Contract test' } }),
    shape: 'obj',
    bad: (x) => ({ as: 'admin', path: `/admin/users/${x.member.user.id}/status`, body: {} }),
  },
  'get /admin/jobs/pending': { ok: () => ({ as: 'admin', path: '/admin/jobs/pending', query: { page: 1, limit: 20 } }), shape: 'list', bad: () => ({ as: 'member', path: '/admin/jobs/pending' }), badStatus: 403 },
  'get /admin/mentorship/overview': { ok: () => ({ as: 'admin', path: '/admin/mentorship/overview' }), shape: 'obj', bad: () => ({ as: 'member', path: '/admin/mentorship/overview' }), badStatus: 403 },
  'get /admin/export/:entity': { ok: () => ({ as: 'admin', path: '/admin/export/users' }), shape: 'file', bad: () => ({ as: 'admin', path: '/admin/export/nothing' }) },
  'get /admin/audit': { ok: () => ({ as: 'admin', path: '/admin/audit', query: { page: 1, limit: 20, action: 'CREATE', entityType: 'USER' } }), shape: 'any', check: (b) => expect(b.logs).toEqual(expect.any(Array)), bad: () => ({ as: 'member', path: '/admin/audit' }), badStatus: 403 },
  'get /admin/reports': { ok: () => ({ as: 'admin', path: '/admin/reports', query: { status: 'OPEN', limit: 10 } }), shape: 'obj', bad: () => ({ as: 'member', path: '/admin/reports' }), badStatus: 403 },
  'patch /admin/reports/:id': {
    ok: async (x) => {
      const p = await fx.newPost(x.member.user.id);
      const report = await request(app).post(`/api/posts/${p.id}/report`).set('Authorization', x.other.auth).send({ reason: 'SPAM' });
      expect(report.status).toBe(201);
      return { as: 'admin', path: `/admin/reports/${report.body.data.id}`, body: { action: 'DISMISS', note: 'Fine' } };
    },
    shape: 'any',
    bad: () => ({ as: 'admin', path: `/admin/reports/${MISSING_ID}`, body: { action: 'DISMISS' } }),
    badStatus: 404,
  },
  'get /admin/audit/activity': { ok: () => ({ as: 'admin', path: '/admin/audit/activity', query: { limit: 10 } }), shape: 'any', check: (b) => expect(b.logs).toEqual(expect.any(Array)), bad: () => ({ as: 'member', path: '/admin/audit/activity' }), badStatus: 403 },
  'get /admin/audit/:entityType/:entityId': { ok: (x) => ({ as: 'admin', path: `/admin/audit/USER/${x.member.user.id}` }), shape: 'any', bad: () => ({ as: 'member', path: `/admin/audit/USER/${MISSING_ID}` }), badStatus: 403 },
  'post /admin/audit/cleanup': { ok: () => ({ as: 'superAdmin', path: '/admin/audit/cleanup', body: { daysToKeep: 3650 } }), shape: 'any', bad: () => ({ as: 'superAdmin', path: '/admin/audit/cleanup', body: { daysToKeep: 'abc' } }) },
  // ---- Weekly digest (e-mail is stubbed in beforeEach) ----
  'get /admin/digest': {
    ok: () => ({ as: 'admin', path: '/admin/digest' }),
    shape: 'obj',
    check: (b) => expect(b.data).toMatchObject({ id: 'default', enabled: expect.any(Boolean), sections: expect.any(Object) }),
    bad: () => ({ as: 'member', path: '/admin/digest' }),
    badStatus: 403,
  },
  'patch /admin/digest': {
    ok: () => ({ as: 'admin', path: '/admin/digest', body: { enabled: false, dayOfWeek: 2, hour: 8, sections: { jobs: true, events: true, videos: true, requirements: true, nearbyAlumni: true } } }),
    shape: 'obj',
    check: (b) => expect(b.data).toMatchObject({ enabled: false, dayOfWeek: 2, hour: 8 }),
    bad: () => ({ as: 'member', path: '/admin/digest', body: { enabled: true } }),
    badStatus: 403,
  },
  'post /admin/digest/send': {
    ok: () => ({ as: 'admin', path: '/admin/digest/send', body: {} }),
    shape: 'obj',
    // every counted send went through the stub
    check: (b) => expect(email.sendEmail).toHaveBeenCalledTimes(b.data.sent),
    bad: () => ({ as: 'member', path: '/admin/digest/send', body: {} }),
    badStatus: 403,
  },
  'post /admin/digest/test': {
    ok: () => ({ as: 'admin', path: '/admin/digest/test', body: {} }),
    shape: 'obj',
    // the test digest goes to the calling admin only
    check: (b, x) => {
      expect(b.data.sent).toBe(1);
      expect(email.sendEmail).toHaveBeenCalledTimes(1);
      expect(email.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: x.admin.user.email }));
    },
    bad: () => ({ as: 'member', path: '/admin/digest/test', body: {} }),
    badStatus: 403,
  },

  // ---- Landing page builder ----
  'get /landing': {
    ok: () => ({ as: null, path: '/landing' }),
    shape: 'arr',
    check: (b) => expect(b.data.every((block: any) => block.isPublished)).toBe(true),
    bad: null,
  },
  'get /admin/landing': { ok: () => ({ as: 'admin', path: '/admin/landing' }), shape: 'arr', bad: () => ({ as: 'member', path: '/admin/landing' }), badStatus: 403 },
  'post /admin/landing': {
    ok: () => ({ as: 'admin', path: '/admin/landing', body: { type: 'TEXT', config: { title: 'Welcome', body: 'Hello alumni' }, isPublished: true } }),
    status: 201,
    shape: 'obj',
    check: (b) => expect(b.data).toMatchObject({ type: 'TEXT', config: { title: 'Welcome' }, isPublished: true }),
    bad: () => ({ as: 'admin', path: '/admin/landing', body: { type: 'NOPE' } }),
  },
  'patch /admin/landing/reorder': {
    ok: async () => {
      const [first, second] = [await fx.newLandingBlock(), await fx.newLandingBlock()];
      (f as any).reordered = [second.id, first.id];
      return { as: 'admin', path: '/admin/landing/reorder', body: { ids: [second.id, first.id] } };
    },
    shape: 'arr',
    check: (b) => {
      const ids: string[] = (f as any).reordered;
      const order = b.data.map((block: any) => block.id);
      expect(order).toEqual(expect.arrayContaining(ids));
      expect(order.indexOf(ids[0])).toBeLessThan(order.indexOf(ids[1]));
    },
    bad: () => ({ as: 'admin', path: '/admin/landing/reorder', body: { ids: [MISSING_ID] } }),
    badStatus: 404,
  },
  'patch /admin/landing/:id': {
    ok: async () => ({ as: 'admin', path: `/admin/landing/${(await fx.newLandingBlock()).id}`, body: { type: 'CTA', config: { title: 'Edited', buttonLabel: 'Join' }, isPublished: false } }),
    shape: 'obj',
    check: (b) => expect(b.data).toMatchObject({ type: 'CTA', config: { title: 'Edited' }, isPublished: false }),
    bad: () => ({ as: 'admin', path: `/admin/landing/${MISSING_ID}`, body: { isPublished: true } }),
    badStatus: 404,
  },
  'delete /admin/landing/:id': {
    ok: async () => ({ as: 'admin', path: `/admin/landing/${(await fx.newLandingBlock()).id}` }),
    shape: 'any',
    bad: () => ({ as: 'admin', path: `/admin/landing/${MISSING_ID}` }),
    badStatus: 404,
  },
};

// ---------------------------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------------------------

const STACK_TRACE = /\n\s+at .+\(.+:\d+:\d+\)|node_modules[\\/]|\.ts:\d+:\d+/;

const toList = (status: number | number[] | undefined, fallback: number[]) =>
  status === undefined ? fallback : Array.isArray(status) ? status : [status];


const call = async (method: string, req: Req) => {
  const actor = req.as === undefined ? 'member' : req.as;
  let r = (request(app) as any)[method](`/api${req.path}`);
  if (actor) r = r.set('Authorization', actors()[actor].auth);
  for (const [k, v] of Object.entries(req.headers ?? {})) r = r.set(k, v);
  if (req.query) r = r.query(req.query);
  if (req.rawQuery) r = r.query(req.rawQuery);
  if (req.attach) r = r.attach(req.attach.field, req.attach.buffer, { filename: req.attach.filename, contentType: req.attach.contentType });
  else if (req.raw !== undefined) r = r.send(req.raw);
  else if (req.body !== undefined) r = r.send(req.body);
  return r;
};

const messageOf = (body: any): string | null => {
  if (!body || typeof body !== 'object') return null;
  if (typeof body.error === 'string' && body.error.trim()) return body.error;
  if (body.error && typeof body.error.message === 'string' && body.error.message.trim()) return body.error.message;
  if (typeof body.message === 'string' && body.message.trim()) return body.message;
  return null;
};

const assertShape = (shape: Shape, body: any) => {
  if (shape === 'any' || shape === 'file') return;
  if (shape === 'list') {
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.pagination).toEqual(expect.objectContaining({ total: expect.any(Number), page: expect.any(Number), limit: expect.any(Number), totalPages: expect.any(Number) }));
  } else if (shape === 'arr') {
    expect(Array.isArray(body.data)).toBe(true);
  } else {
    expect(body.data).toEqual(expect.anything());
    expect(typeof body.data).toBe('object');
  }
};

const entries = Object.entries(cases);

describe('every route has a smoke case', () => {
  it('covers the whole router (add a row to smoke.contract.test.ts for each new route)', () => {
    const live = registeredRoutes(router).map((r) => routeKey(r.method, r.path));
    expect(live.filter((key) => !(key in cases))).toEqual([]);
    expect(Object.keys(cases).filter((key) => !live.includes(key))).toEqual([]);
  });
});

describe('valid input never 5xx, invalid input is a clean 4xx', () => {
  it.each(entries)('%s: valid request', async (key, spec) => {
    const method = key.split(' ')[0];
    const req = await spec.ok(f);
    // `headers.Authorization` lets a case use a throwaway user without registering an actor key
    const res = await call(method, req);
    const allowed = toList(spec.status, [200, 201]);
    if (!allowed.includes(res.status)) {
      throw new Error(`${key} -> ${res.status} (expected ${allowed.join('/')}): ${JSON.stringify(res.body).slice(0, 600)}`);
    }
    if (!allowed.some((code) => code >= 500)) expect(res.status).toBeLessThan(500);

    const shape = spec.shape ?? 'any';
    if (shape === 'file') {
      expect(res.headers['content-type']).toMatch(/pdf|csv|octet-stream|text/);
      return;
    }
    const text = JSON.stringify(res.body ?? {});
    expect(text).not.toMatch(STACK_TRACE);
    if (res.status < 300 || (res.status >= 300 && res.status < 400)) {
      expect(res.body).toEqual(expect.objectContaining({ success: true }));
      assertShape(shape, res.body);
      spec.check?.(res.body, f);
    } else {
      expect(res.body.success).toBe(false);
      expect(messageOf(res.body)).not.toBeNull();
    }
  });

  it.each(entries.filter(([, spec]) => spec.bad !== null))('%s: invalid request', async (key, spec) => {
    const method = key.split(' ')[0];
    const req = spec.bad ? await spec.bad(f) : defaultBad(key, await spec.ok(f));
    const res = await call(method, req);
    const allowed = toList(spec.badStatus, [400, 404]);
    if (!allowed.includes(res.status)) {
      throw new Error(`${key} (invalid) -> ${res.status} (expected ${allowed.join('/')}): ${JSON.stringify(res.body).slice(0, 600)}`);
    }
    expect(JSON.stringify(res.body ?? {})).not.toMatch(STACK_TRACE);
    expect(res.body.success).toBe(false);
    expect(messageOf(res.body)).not.toBeNull();
  });
});

/** Same call with each `/segment` that looks like an id swapped for a malformed one. */
function defaultBad(key: string, ok: Req): Req {
  return { ...ok, path: ok.path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, 'not-a-real-id') };
}

// ---------------------------------------------------------------------------------------------
// Malformed input: wrong JSON types, array/object query values and hostile path ids must be a
// clean 4xx (or be accepted), never a 5xx. Catches `value.trim is not a function` and Prisma
// validation errors that surface when a handler trusts the type of a field it did not validate.
// ---------------------------------------------------------------------------------------------

const SKIP_FUZZ = new Set([
  'post /auth/logout',
  'post /auth/change-password',
  'post /auth/2fa/enable',
  'post /auth/2fa/disable',
  'post /payments/webhook/razorpay',
]);

const BODY_MUTATIONS: Array<[string, unknown]> = [
  ['number', 12345],
  ['boolean', true],
  ['array', ['a', 1]],
  ['object', { a: 1 }],
  ['null', null],
  ['huge string', 'x'.repeat(12000)],
];

const failure = (key: string, variant: string, res: { status: number; body: any }) =>
  `${key} [${variant}] -> ${res.status}: ${String(messageOf(res.body) ?? JSON.stringify(res.body)).replace(/\s+/g, ' ').slice(0, 160)}`;

const fuzzable = entries.filter(([key]) => !SKIP_FUZZ.has(key));

describe('malformed input never 5xx', () => {
  it.each(fuzzable)('%s: wrong body field types', async (key, spec) => {
    const method = key.split(' ')[0];
    const probe = await spec.ok(f);
    if (!probe.body || typeof probe.body !== 'object' || Array.isArray(probe.body) || probe.attach || probe.raw !== undefined) return;
    const failures: string[] = [];
    for (const field of Object.keys(probe.body as object)) {
      // A fresh target per field: destructive routes consume the record on their first success
      const base = await spec.ok(f);
      for (const [label, value] of BODY_MUTATIONS) {
        const res = await call(method, { ...base, body: { ...(base.body as object), [field]: value } });
        if (res.status >= 500) failures.push(failure(key, `${field}: ${label}`, res));
      }
    }
    expect(failures).toEqual([]);
  });

  it.each(fuzzable.filter(([key]) => key.startsWith('get ')))('%s: array and object query values', async (key, spec) => {
    const probe = await spec.ok(f);
    const keys = Object.keys(probe.query ?? {});
    const failures: string[] = [];
    for (const name of keys) {
      const rest = Object.entries(probe.query ?? {}).filter(([k]) => k !== name);
      for (const [label, raw] of [
        ['array', `${name}[]=a&${name}[]=b`],
        ['repeated', `${name}=a&${name}=b`],
        ['object', `${name}[x]=y`],
      ]) {
        const res = await call('get', { ...probe, query: Object.fromEntries(rest), rawQuery: raw });
        if (res.status >= 500) failures.push(failure(key, `?${name} ${label}`, res));
      }
    }
    expect(failures).toEqual([]);
  });

  it.each(fuzzable.filter(([key]) => key.includes(':')))('%s: hostile path parameter', async (key, spec) => {
    const method = key.split(' ')[0];
    const probe = await spec.ok(f);
    const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    const failures: string[] = [];
    for (const [label, value] of [
      ['NUL byte', '%00'],
      ['quote', "'%20OR%201=1"],
      ['long id', 'a'.repeat(5000)],
      ['unicode', '%F0%9F%98%80'],
      ['bad percent-escape', '%E0%A4%A'],
    ]) {
      const path = probe.path.replace(UUID, value);
      if (path === probe.path) continue; // no uuid segment to replace (slug, year, token ...)
      const res = await call(method, { ...probe, path });
      if (res.status >= 500) failures.push(failure(key, `path: ${label}`, res));
    }
    expect(failures).toEqual([]);
  });
});
