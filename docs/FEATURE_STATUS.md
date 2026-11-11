# AIEM Connect Feature Status (PRD v1.1 aligned)

Updated 2026-11-09. The running system's health (database, e-mail, payments, notifications, storage) is served by `GET /api/admin/system-status` (see the 2026-11-09 notes below). The developer-facing `GET /api/platform/readiness` was removed.
Release gate (PRD §10.3): **releasable, no P0/P1 blockers in Must Have domains.**

| Domain | Status | Evidence |
|---|---|---|
| Platform foundations (auth guards, role normalisation, error shape) | IMPLEMENTED | `config/permissions.ts`, route RBAC matrix test, client `lib/roles.ts` |
| Authentication & security (JWT + rotating refresh families with reuse detection, token-version revocation, verified e-mail before a session in production with a password-confirmed link, reset, change password, 2FA OTP; Google/LinkedIn sign-in was removed: the registration form is the only way in) | IMPLEMENTED | auth unit suites, `authService.verification.test.ts`, `tests/security/auth/`, `tests/integration/auth-lifecycle.int.test.ts`; see [AUTHENTICATION.md](AUTHENTICATION.md) |
| Discovery (directory, yearbook, alumni map: viewport + "Near me" radius search, filters, place search, ~1 km location privacy) | IMPLEMENTED | userService + geocodingService suites, `tests/integration/geo-search.int.test.ts`, alumni-nearby page and `lib/geo` tests |
| Profile & identity (profile editor: basics, photos, links, privacy/location, work, education, skills, completeness) | IMPLEMENTED | profile validator + route suites, `/profile/edit` component tests |
| Social (ranked feed, six reactions, threaded comments, reposts and quote posts, posts with images or video, visibility public/connections, hashtags and mentions, follows, saved posts, reports with admin moderation, connections, messaging, notification bell + page) | IMPLEMENTED | post/reaction/repost/network/message suites, `tests/integration/social*.int.test.ts`, `clientLinks` contract test; contract in [SOCIAL_API.md](SOCIAL_API.md) |
| Search (one header search box; members only: people, jobs, events, posts, news and chapters) | IMPLEMENTED | `searchController` suite, `tests/security/authz/search.sec.test.ts`, search page and header tests |
| Private platform (visitors are redirected from **every** page except the landing page, sign-in/registration and the legal pages to `/login?next=...`; every API route except sign-in, the landing page's two feeds and the payment webhook answers 401; the API stays the authority) | IMPLEMENTED | `route-access` and `public-paths` tests, `src/__security__/`, RBAC matrix, `tests/integration/alumni-approval.int.test.ts`, `npm run verify:deploy` |
| Alumni approval (a registration is a claim: PENDING until an administrator checks that the person is an alumnus of the college; enrolment number and note on the form; "What happens next" screen; review queue at `/admin/approvals` with approve / reject-with-reason, e-mails to the applicant, audit entries, pending badge in the admin navigation; no session by any route before approval) | IMPLEMENTED | `authService.approval`, `memberApprovalService`, `approvedOnlyLookups` suites, `tests/integration/alumni-approval.int.test.ts`, approvals page tests; see [AUTHENTICATION.md](AUTHENTICATION.md#alumni-approval) |
| Careers (jobs + admin review queue) | IMPLEMENTED | jobService suite, `/admin/moderation` |
| Mentorship (profiles, requests, sessions, admin overview) | IMPLEMENTED | mentorshipService suite, `/api/admin/mentorship/overview` |
| Events, gallery, news (members only, article pages) | IMPLEMENTED | event/gallery/news suites, `tests/integration/alumni-approval.int.test.ts` (visitors get 401), news page tests |
| Revenue (memberships, member and guest donations (alumni donate without an account; the form is the one public page), verified payments, Razorpay webhook, mismatch alerts, receipts, history) | IMPLEMENTED | membership/donation/webhook suites, `tests/integration/payments.int.test.ts` |
| Community (chapters pages with chapter-admin scope and server-side search, marketplace listing lifecycle with admin moderation, invites) | IMPLEMENTED | chapter scope tests, chapters/marketplace page tests, marketplace/invite suites |
| Admin & governance (real-data analytics, audit log page with security/payment alerts, user management, CSV exports, system status) | IMPLEMENTED | adminController/adminService/audit suites, analytics + audit page tests, audit filter contract test, `tests/integration/admin-rbac.int.test.ts` |
| Privacy (data export covering reactions, reports, uploads and audit entries; account deletion that also clears request metadata from earlier audit entries) | IMPLEMENTED | privacyService suite, `tests/security/auth/account-deletion.sec.test.ts`, integration test |
| Security hardening (two white-box audit rounds, 27 further defects fixed in round 2, every finding a regression test) | IMPLEMENTED | [SECURITY_AUDIT.md](SECURITY_AUDIT.md), `server/tests/security/`, `server/tests/contract/` |
| Production readiness (start-up guard, `preflight`, `secrets`, `verify:deploy`, shared rate limits through Redis, PostgreSQL backups, nginx limits, go-live checklist) | IMPLEMENTED, with launch gates | [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md) |

## 2026-10-18: PostgreSQL, maps, Docker

- **Database moved from MySQL 8 to PostgreSQL 17.**
  - Prisma provider `postgresql`.
  - The migration history restarts at a single baseline, `20261018000000_postgres_baseline`. The old MySQL
    migrations are archived in `server/prisma/mysql-legacy/`.
  - All text searches are case-insensitive through the `ilike()` helper.
  - Skills are matched case-insensitively ("react" reuses "React").
  - The nearby query is now portable SQL: haversine plus a bounding box on a composite `(locationLat, locationLng)`
    index.
- **Local development without Docker:** `npm run db:local -w server` runs an embedded PostgreSQL 17 (`embedded-postgres`).
  The integration suite uses the same package.
- **Maps upgrade:**
  - "Near me" radius mode (5–250 km, nearest first, radius circle).
  - Batch, department and name/city filters.
  - Place search and reverse geocoding (`/api/geo/search`, `/api/geo/reverse`): an OpenStreetMap Nominatim proxy
    with cache, 1 req/s spacing, and a 503 fallback.
  - Clear geolocation error handling, and a "you're not on the map" prompt.
  - Coordinates are stored and served at ~1 km precision.
  - The profile privacy section fills in the city from GPS and can set a location by place name.
  - Sample alumni are seeded at real city coordinates.
  - `@react-google-maps/api` and `GOOGLE_MAPS_API_KEY` were removed.
- **Docker Compose on PostgreSQL** ([DOCKER.md](DOCKER.md)):
  - Services: postgres, redis, api, web, and an optional nginx proxy profile.
  - Health checks.
  - The entrypoint waits for the database, migrates, and seeds idempotently.
  - Template: `.env.docker.example`.
- **Graceful shutdown** on SIGTERM/SIGINT (`src/utils/shutdown.ts`).
- **CI fixes:**
  - Integration tests run on a `postgres:17-alpine` service.
  - Docker images build from the repo root (`-f server/Dockerfile`, `-f client/Dockerfile`; the previous contexts
    could not build).
  - `docker-compose.yml` is validated.

## Merged from `main` (2026-10-22 to 2026-10-28)

The college and engagement features built on `main` while this branch was in review: college **videos** (member submissions with
admin approval), a **magazine** of PDFs, **requirements** (what the college needs, alumni offer help), job **referrals**, a **weekly
digest** with admin settings, a **landing page builder**, separate **home and work locations** on the map, logo and images on marketplace
listings, background jobs (BullMQ, needs Redis) and the **AIEM Connect** rebrand. The Reels page and viewer were replaced by Videos;
the leftover Reels flag was removed in this merge. What was found and fixed while reviewing that code is in
[SECURITY_AUDIT.md](SECURITY_AUDIT.md) ("Review of the code merged from main").

## 2026-11-08: social layer, one search, security audit, production tooling

- **Alumni social layer** (details: [SOCIAL_API.md](SOCIAL_API.md)): reactions, threaded comments, reposts and quote posts,
  posts with images or video, visibility, hashtags and mentions, follows, saved posts, reporting and admin
  moderation, a ranked feed with cursor pagination.
- **One search:** the duplicate search entry points are gone. There is one box in the header (on mobile, one icon, hidden on
  the results page), the results page (members only) shows people, jobs,
  events, posts, news and chapters with filter chips.
- **Members-only gate:** the dashboard and every other member page were reachable by visitors as an app shell. `src/middleware.ts`
  now redirects them to sign-in, and the dashboard's left-hand shortcut card that repeated the header was removed.
- **Security audit, two rounds** ([SECURITY_AUDIT.md](SECURITY_AUDIT.md)): authorization and integrity, input handling (URL
  allowlists, a linear-time sanitizer, image re-encoding), races made atomic, auth and payments hardened, a client/server
  contract sweep that fixed broken endpoints, and Next.js 14.2.35 (closes a middleware bypass).
- **Verified e-mail before a session** in production, with the verification page that was missing and resend.
- **Production tooling:** the API refuses to start on an unsafe production configuration; `npm run preflight`, `npm run secrets`
  and `npm run verify:deploy`; rate limits shared through Redis; 15-minute access tokens; a PostgreSQL `backup-db.sh` (the old
  one was for MySQL); nginx request limits.

## 2026-11-09: admin numbers count members, readable audit targets, system status

- **Admin statistics count members only** (`GET /api/admin/stats`). The platform is private, so `users.total`, `active`,
  `verified`, `newThisMonth`, `growthPercent`, `byRole`, `byBatch`, `byLocation` and `monthlyGrowth` count `APPROVED` users
  only. `users.verified` keeps its name and now means "approved members". New: `users.pendingApproval` (registrations
  waiting for a decision) and `users.rejected`. `recentActivity.users` is the recent registrations feed: it keeps every
  status and each item now carries `approvalStatus`.
- **Audit log targets are readable:** every row of `GET /api/admin/audit` has `entityLabel`: `Full Name (email)` for an
  entry about a `USER`, `null` for a user that no longer exists and for every other entity type. The whole page is
  resolved with one user lookup (the acting user is resolved by the same query).
- **System status replaces the readiness page:** `GET /api/admin/system-status` (admin only) returns `overall`
  (`ok` / `warning` / `error`) and one line per service (`database`, `cache`, `notifications`, `email`, `approvalAlerts`,
  `payments`, `storage`) with a status (`ok`, `warning`, `error`, `off`) and a plain-English `detail`. Only yes/no, modes
  and counts are returned: never hosts, keys, bucket names or addresses. A failing check turns only its own line red.
  `GET /api/platform/readiness` and the module-readiness list behind it were removed.

## Planned (Phase D, out of scope for this release)

1. AI mentorship matching
2. Push notifications
3. Mobile applications
4. Video call integration

## API documentation

`docs/API_REFERENCE.md` is generated from the live router (`npm run docs:api` in `server/`) and lists every endpoint
with its access level; `tests/docs/api-reference.test.ts` fails when it is stale.

## Deploy notes

- **New databases:** follow [DOCKER.md](DOCKER.md). The API container runs `prisma migrate deploy` (and the
  idempotent seed when `SEED_ON_START=true` and `SEED_ADMIN_PASSWORD` is set) on every start.
- **Existing MySQL deployments:** the data has to be copied into PostgreSQL (pgloader, data only). See
  "Migrating existing MySQL data" in [DOCKER.md](DOCKER.md). Every user must sign in again afterwards.
- **Rotate the production database password.** It was committed in `DEPLOYMENT_CHECKLIST.md` and
  `DEPLOYMENT_VERIFICATION.md`; it is redacted now but remains in git history. The API refuses to start with it. Steps:
  [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md) section 4.
- **Before going live, work through [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md)** and run `npm run preflight -w server`.
- The root `DEPLOYMENT*.md` and `EXTENSIVE_DEPLOYMENT_GUIDE.md` files describe the old MySQL shared-host setup and are
  superseded by [DOCKER.md](DOCKER.md).
- Configure `RAZORPAY_WEBHOOK_SECRET` and point the Razorpay dashboard webhook at `https://<api-host>/api/payments/webhook/razorpay`
  (events `payment.captured`, `order.paid`, `payment.failed`). Without the secret the endpoint answers 503.
- The public OpenStreetMap services have usage limits. For heavy traffic, set `GEOCODER_URL` to a self-hosted
  Nominatim and `NEXT_PUBLIC_MAP_TILE_URL` to your own or a commercial tile server. Set `GEOCODER_EMAIL` to a
  contact address.
- `docker compose` sets `API_INTERNAL_URL` for the web container; set it yourself only outside Compose.

## Known follow-ups

- **Launch gates** (engineering, not configuration): upgrade Next.js 14 to 15.5.x/16, move tokens from `localStorage` to httpOnly
  cookies, CAPTCHA/WAF in front of sign-up and sign-in, central logging and alerts, an independent penetration test. Details and
  the smaller open items: [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md) sections 7 and 8.

- Guest orders created before the 2026-10-14 payment changes and paid only through the webhook (no client verify) cannot be matched; they need manual reconciliation.
- Guest donor name/email is kept in transaction metadata with no retention scrub yet.
- Razorpay webhook events are deduplicated by idempotent state changes, not by event id.
- Place-search results are cached in process memory, so each API replica has its own cache. Move the cache to Redis
  before scaling out horizontally.
- The alumni map has no visual browser check in CI; it is covered by component tests and the API integration suite.
