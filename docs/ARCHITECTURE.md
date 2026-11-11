# Architecture

How AIEM Connect is put together, for people who need to change it.

## Big picture

```
 Browser ──HTTPS──► web (Next.js 14, App Router)          OpenStreetMap tiles ◄── Browser (Leaflet)
    │                    │ server-side fetches via API_INTERNAL_URL
    │ REST /api/*        ▼
    │ socket.io  ──► api (Express + Prisma + socket.io) ──► PostgreSQL 17
    └──────────────►     │        │        │
                         │        │        └──► Redis (optional: response cache, shared rate-limit counters)
                         │        └──► S3/R2 or local uploads volume
                         └──► Razorpay · SMTP/SendGrid · Kafka (notification events) · Nominatim (place search)
```

npm workspaces monorepo:

| Path | What |
|---|---|
| `client/` | Next.js 14 App Router UI. `src/app/(auth)` (login, register, verify-email, reset), `src/app/(main)` (member and admin pages), `src/app/(legal)`. API client in `src/lib/api.ts` (axios, token refresh, optional fallback URL); map helpers in `src/lib/geo.ts`; auth and socket context in `src/context/`. `src/middleware.ts` is the members-only gate at the edge (see below); `src/lib/safe-url.ts` is the one place links and media URLs are validated. |
| `server/` | Express API. `src/routes/index.ts` is the single router. Controllers parse HTTP, services hold business rules, Prisma is the data layer (`src/config/database.ts`). |
| `server/prisma/` | `schema.prisma` (40 models), migrations (PostgreSQL baseline `20261018000000_postgres_baseline`), idempotent `seed.ts`. `mysql-legacy/` is an archive and is never read. |
| `docker-compose.yml`, `*/Dockerfile`, `nginx/` | Container deployment (see [DOCKER.md](DOCKER.md)); go-live steps in [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md). |
| `server/scripts/` | `preflight.ts` (go-live check), `secrets.ts` (random secrets), `verify-deployment.mjs` (read-only post-deploy checks), `generate-api-docs.ts`, `extract-client-contract.ts`. |

## Request pipeline (API)

`src/app.ts`, in order:

0. **Request id and access log** (`middleware/requestContext.ts`): every request gets an `X-Request-Id` and, when it finishes, one log line
   (route pattern, status, duration; never the query string). Logging is `utils/logger.ts`: JSON in production, `LOG_LEVEL`, secrets redacted.
1. **Path normalisation:** repeated slashes are collapsed (also behind an absolute-form request target), so no spelling of a
   path can dodge a per-endpoint limiter that is mounted on the exact path.
2. helmet security headers; CORS against `CORS_ORIGINS` (a foreign origin gets `403 FORBIDDEN_ORIGIN`).
3. **Rate limits** (counters are shared through Redis when `REDIS_URL` is set, per process otherwise): 300 requests / 15 min per
   client on `/api`; 10 / 15 min on sign-in, register, verification, reset and 2FA; refresh 60; budgets for
   search (100), uploads (30), invites (30), donation orders (20), `/api/geo` (30 / min); the signed Razorpay webhook has its own
   budget and a 256 KB body limit.
4. A guard that answers `400 INVALID_PATH` for NUL bytes in a path, then **body parsing**: JSON and urlencoded bodies are
   capped at **1 MB** (uploads are multipart with their own limits, and the multipart text fields are bounded). Webhook
   requests keep their raw bytes for the HMAC check.
5. `sanitizeInput` walks every string of the body and query in linear time: it strips tags and dangerous schemes, keeps
   line breaks, and leaves password, token and signature fields untouched. It runs again after multer on the upload routes.
6. `/uploads` static files (donation receipts under `/uploads/receipts` are never served; they come from an authenticated
   endpoint), `/health` (runs `SELECT 1`), then the `/api` routes.
7. `notFoundHandler`, then `errorHandler`. Errors are `AppError(message, status, code)` and render as
   `{ success: false, error: { message, code } }`; Prisma errors (`P2002`, `P2003`, `P2000`) map to 4xx, never a bare 500.

Validation uses Zod schemas (`src/utils/validators.ts`) via the `validate` middleware. Zod strips unknown keys, so a schema
must list every field a service reads (a past bug class; the contract suite checks it). Services re-check the invariants they
depend on, and use row locks or conditional updates for anything that is "check, then act" (event capacity, mentorship slots,
counters, quotas), so concurrent requests cannot overshoot.

## Authentication and authorisation

The flows, token lifetimes, error codes and settings are in [AUTHENTICATION.md](AUTHENTICATION.md). In short:

- **Access tokens** are short-lived JWTs (15 minutes in production) carrying `tv`, the user's `tokenVersion`; bumping it
  revokes every outstanding access token (password change or reset, "sign out everywhere", deactivation, deletion), and
  `disconnectUser()` drops live sockets.
- **Refresh tokens** are stored hashed and rotated on every use, in a *family* per sign-in; replaying a rotated token revokes the
  family and writes a `SECURITY_ALERT` audit entry.
- **Verified e-mail before a session** in production, confirmed with the registration password (account pre-hijacking defence);
  optional 2FA by e-mailed code.
- **RBAC:** `MEMBER < CHAPTER_ADMIN < ADMIN < SUPER_ADMIN`, defined once in `src/config/permissions.ts`. Route guards
  `authenticate` / `isChapterAdmin` / `isAdmin` / `isSuperAdmin` live in `src/middleware/auth.ts`. `authenticate` re-reads the
  role **and the approval status** from the database on every request and answers 403 `ACCOUNT_PENDING_APPROVAL` /
  `ACCOUNT_REJECTED` for anybody an administrator has not approved (see [AUTHENTICATION.md](AUTHENTICATION.md#alumni-approval)).
  The platform is private: only the sign-in routes, `GET /landing`, `GET /users/stats`, the invitation check and the payment
  webhook are reachable without a token (`optionalAuth` is used by `/landing` alone).
- **Guard rail:** `tests/routes/rbac-matrix.test.ts` lists every route with its access level; it fails when a route is
  unclassified and checks that protected routes reject anonymous, malformed-token, deactivated and under-privileged callers.
- **Client gate:** `src/middleware.ts` redirects visitors without the `aiem_session` hint cookie from member pages to
  `/login?next=…`. It is a UX and hardening layer; the API stays the authority.

## Data model highlights

PostgreSQL via Prisma. The main groups:

- **Identity:** `User` (profile, privacy flags, `tokenVersion`, approximate location), `RefreshToken` (families),
  `VerificationToken`, `WorkExperience`, `Education`, `Skill`/`UserSkill`.
- **Social:** `Post` (types, visibility `PUBLIC`/`CONNECTIONS`, optional video, repost and quote-post links), `PostLike` (reactions, six
  types), `PostComment` (one level of replies) and `CommentReaction`, `SavedPost`, `Follow`, `Hashtag`/`PostHashtag`,
  `PostMention`/`CommentMention`, `PostImpression` (views), `ContentReport` (moderation), plus `Connection`, `Message`,
  `Notification`. Contract: [SOCIAL_API.md](SOCIAL_API.md).
- **Careers and mentorship:** `JobOpportunity`, `MentorProfile`, `MentorshipRequest`, `MentorshipSession`.
- **Content:** `Event`/`EventRSVP`, `GalleryAlbum`/`GalleryPhoto`, `NewsArticle`, `Chapter`/`ChapterMembership`,
  `MarketplaceListing`.
- **Revenue:** `MembershipTier`/`UserMembership`, `Donation`, `Transaction` (unique `gatewayOrderId`; `userId`
  is nullable for guest donations).
- **Governance:** `AuditLog`, `Invite`.

PostgreSQL compares text case-sensitively, so user-facing searches use the `ilike()` helper (`src/utils/helpers.ts`,
`{ contains, mode: 'insensitive' }`). Skills are matched case-insensitively, so "react" reuses the existing "React".

## College content and engagement

Added alongside the social layer; the routes are in `src/routes/index.ts` (sections "COLLEGE VIDEO", "COLLEGE MAGAZINE",
"COLLEGE REQUIREMENTS", "JOB REFERRALS", "WEEKLY DIGEST", "LANDING PAGE BUILDER").

| Feature | Who | Notes |
|---|---|---|
| Videos | members submit, admins approve | Two-step: upload the file, then submit its URL. Only the approved list is public |
| Magazine | admins publish PDFs | PDF and cover are uploaded first, then referenced |
| Requirements | admins post what the college needs, members offer help | One offer per member per requirement |
| Referrals | members ask alumni for a job referral | At most 10 pending asks; no repeat ask for the same member and role |
| Weekly digest | admins configure and send | Settings are validated; the hourly tick needs Redis |
| Landing page | admins edit blocks (hero, text, image, stats, call to action, sandboxed HTML) | Link and image URLs are validated when stored and again when rendered |

A URL that points at a stored file (video, thumbnail, magazine, cover) must be a file the matching upload endpoint wrote, in exactly that
folder (`utils/uploadRefs.ts`). Otherwise a member could submit somebody else's photo as their video and then delete the record, which
deletes the file.

## Search

`GET /api/search` is for approved members (visitors get 401). It returns people, jobs, events, news, chapters and posts, filtered by
the same visibility rules as the feed (no unapproved or deactivated people, no hidden or connections-only posts they may not see).
The client has one search box in the header (`HeaderSearch`) and one results page (`/search`). All `contains` filters go through
`ilike()`, which escapes LIKE wildcards.

## Notifications (Kafka)

Every notification is an event on the **notification bus** (`services/notificationBus.ts`): in-app notifications
(`notificationService.createNotification`), announcement broadcasts, and the registration flow (the e-mail to the college
administrator when a registration is waiting, the e-mails to the applicant). With `KAFKA_BROKERS` the bus publishes to the
`<prefix>.notifications` topic and `workers/notificationConsumer.ts` (in the API process, group `aiem-notifications`) delivers: it stores
the notification, pushes it over the socket and sends the e-mail through SMTP. Failed events are retried with a doubling pause and then
moved to the `<prefix>.notifications.dlq` topic; invalid messages go there at once. Without a broker, and whenever publishing fails,
the same handlers (`notificationEventHandlers.ts`) run in-process, so a Kafka outage loses nothing. Events are validated with zod when
published and consumed, keyed by member so one person's events stay in order, and delivery is at-least-once with idempotent handlers.
See [KAFKA.md](KAFKA.md).

## Real-time

socket.io shares the HTTP server (`src/utils/socket.ts`). The handshake uses the access token, with the same
`tokenVersion` check as HTTP. Sockets join `user:<id>` for notifications and `chat:<id>` for conversations; services
emit through `emitToUser` / `emitToRoom`. The client socket re-reads the latest token on reconnect and backs off after
server disconnects.

## Payments

Razorpay orders are created server-side as `PENDING` `Transaction`s, guest donations included (alumni donate without an account; the
`/donations` form is the one public page). They are completed
either by the client verify call (signature check) or by the webhook `POST /api/payments/webhook/razorpay` (HMAC over
the raw body with `RAZORPAY_WEBHOOK_SECRET`; 503 when unset). Both paths go through an idempotent
`completeTransaction`. Amount or currency mismatches are recorded as `PAYMENT_MISMATCH` audit entries and notify
admins. Receipts are emailed.

## Maps and geolocation

- **Client:** `/alumni-nearby` uses Leaflet with clustering and OSM tiles (`NEXT_PUBLIC_MAP_TILE_URL` overrides the
  tile server).
  - *Explore* mode loads pins for the visible viewport (debounced; stale requests aborted).
  - *Near me* mode runs a radius search (5–250 km) around the browser's GPS fix, the member's saved location, or a
    searched place.
  - Filters: batch year, department, and name/city.
- **`GET /users/locations`:** viewport query (north/south/east/west; `west > east` wraps the antimeridian), using
  Prisma range filters on the composite `(locationLat, locationLng)` index.
- **`GET /users/nearby`:** a raw SQL query. A bounding box that always contains the search circle prunes rows via the
  same index. Haversine great-circle distance then trims the box to the exact radius. Results are ordered by distance,
  and the radius (max 500 km) and limit (max 200) are capped. Filters are bound parameters, with LIKE wildcards escaped.
- **Privacy:**
  - Only active, verified members with `isLocationPublic` appear on the map.
  - Coordinates are rounded to 2 decimals (~1 km) when saved and again when served (`LOCATION_PRECISION_DECIMALS`),
    so the map shows a neighbourhood, never an address.
- **Place search:** `GET /geo/search` and `GET /geo/reverse` proxy OpenStreetMap Nominatim
  (`src/services/geocodingService.ts`):
  - Identifying User-Agent.
  - In-memory LRU cache (24 h; reverse lookups keyed per ~1 km cell).
  - Upstream calls serialised at ≥1.1 s apart (Nominatim's 1 request/second policy).
  - 5 s timeout.
  - Failures return 503 `GEOCODER_UNAVAILABLE`; the UI then hides place search and the map keeps working.
  - Disable with `GEOCODER_URL=off`, or point it at a self-hosted Nominatim.

## Caching and storage

- Redis is optional (`REDIS_URL`). It caches anonymous GET responses (`cacheMiddleware`, e.g. the public feed for
  `FEED_CACHE_TTL_SECONDS`) and holds the rate-limit counters so the limits are shared by every API process
  (`utils/redisRateLimitStore.ts`; if Redis is unreachable each process counts for itself, so limits never switch off).
  Without Redis the cache is off and limits are per process.
- **Background jobs** (BullMQ, `config/queue.ts`, `workers/`) also need Redis: large notification broadcasts, and an hourly tick
  that sends the weekly digest when the admin-configured day and hour match. Without Redis the work is done inline and the digest
  can still be sent from the admin panel.
- Uploads go to S3/R2 when `AWS_*` is configured; otherwise to `server/uploads` (a Docker volume). Images are
  decoded and re-encoded with sharp (real format from the bytes, EXIF stripped, pixel and size caps; `IMAGE_*` settings);
  videos are sniffed by magic bytes (100 MB). Photos on managed storage can only be set
  through the upload endpoints.

## Lifecycle

- **Startup (`src/index.ts`):**
  - Requires a `postgresql://` `DATABASE_URL`.
  - With `NODE_ENV=production`, `assertProductionConfig` (`src/config/productionChecks.ts`) refuses to start on an unsafe
    configuration (weak or leaked secrets, rate limiting off, plain-http origins, no mail server while verification is required, ...)
    and says what to change. `npm run preflight -w server` runs the same rules plus checks of the database.
  - Starts HTTP and socket.io.
- **Crashes:** `utils/processHandlers.ts`. An uncaught exception drains in-flight work and exits non-zero so the orchestrator starts a clean process; an
  unhandled rejection is logged and the server keeps running. Keep-alive and header timeouts sit above nginx's so the proxy never reuses a closed connection.
- **Shutdown:** SIGTERM/SIGINT run `createShutdown` (`src/utils/shutdown.ts`): close socket.io and HTTP, disconnect
  Prisma and Redis, and force-exit after `SHUTDOWN_TIMEOUT_MS`.
- **System status:** `GET /api/admin/system-status` (admin) reports, in plain words, whether the database, cache, notification queue,
  e-mail, new-registration alerts, payments and file storage are working (`services/systemStatusService.ts`; the
  dependencies are injected, so it is unit-tested without any of them). It returns modes and counts only, never a secret,
  and a failing check only marks its own line. `/health` stays the machine-readable probe for the orchestrator.

## Testing

| Layer | Where | Runs against |
|---|---|---|
| Unit (services, controllers, middleware, utils, config) | `server/src/__tests__/` | Deep-mocked Prisma |
| Route RBAC matrix | `server/tests/routes/` | Real Express app, mocked Prisma |
| Contracts | `server/tests/docs/`, `clientLinks` / audit-action tests | `docs/API_REFERENCE.md` freshness, notification links resolve to client pages, audit actions match the client |
| Client/server contract | `server/tests/contract/` | Every client call checked against the router and Zod schemas; every route driven with valid, invalid and fuzzed input (embedded PostgreSQL) |
| Integration | `server/tests/integration/` | Embedded PostgreSQL 17 (`embedded-postgres`), or `TEST_DATABASE_URL` |
| Security regressions | `server/tests/security/` | Every audit finding as a test that fails without its fix (embedded PostgreSQL) |
| Frontend | `client/src/**/__tests__`, `client/src/__security__/` | Vitest + Testing Library |

`docs/API_REFERENCE.md` is generated from the router (`npm run docs:api`). CI (`.github/workflows/ci.yml`) runs typecheck, lint,
unit tests with coverage, integration, security and contract tests on a `postgres:17-alpine` service, plus the client typecheck,
tests and build, validates `docker-compose.yml` and builds both images. Details: [TESTING.md](TESTING.md).

## Deployment

- **Production:** Docker Compose (PostgreSQL, Redis, API, web, optional nginx). See [DOCKER.md](DOCKER.md); what must change from
  the development defaults, the security decisions taken and what is still open are in [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md).
  The API container applies migrations and optionally seeds on start.
- **Local development without Docker:** `npm run db:local -w server` (embedded PostgreSQL on :5433), then `npm run dev`.
