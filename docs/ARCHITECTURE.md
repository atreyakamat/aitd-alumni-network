# Architecture

How AITD Connection is put together, for people who need to change it.

## Big picture

```
 Browser ──HTTPS──► web (Next.js 14, App Router)          OpenStreetMap tiles ◄── Browser (Leaflet)
    │                    │ server-side fetches via API_INTERNAL_URL
    │ REST /api/*        ▼
    │ socket.io  ──► api (Express + Prisma + socket.io) ──► PostgreSQL 17
    └──────────────►     │        │        │
                         │        │        └──► Redis (optional response cache)
                         │        └──► S3/R2 or local uploads volume
                         └──► Razorpay · SMTP/SendGrid · OAuth · Nominatim (place search)
```

npm workspaces monorepo:

| Path | What |
|---|---|
| `client/` | Next.js 14 App Router UI. `src/app/(auth)` (login, register, reset), `src/app/(main)` (member and admin pages), `src/app/(legal)`. API client in `src/lib/api.ts` (axios, token refresh, optional fallback URL); map helpers in `src/lib/geo.ts`; auth and socket context in `src/context/`. |
| `server/` | Express API. `src/routes/index.ts` is the single router. Controllers parse HTTP, services hold business rules, Prisma is the data layer (`src/config/database.ts`). |
| `server/prisma/` | `schema.prisma` (31 models), migrations (PostgreSQL baseline `20261018000000_postgres_baseline`), idempotent `seed.ts`. `mysql-legacy/` is an archive and is never read. |
| `docker-compose.yml`, `*/Dockerfile`, `nginx/` | Container deployment (see [DOCKER.md](DOCKER.md)). |

## Request pipeline (API)

`src/app.ts`, in order:

1. helmet security headers, CORS (`CORS_ORIGINS`), passport (OAuth).
2. Rate limits: 300 requests / 15 min per client on `/api`. Stricter per-endpoint limits apply on login, register,
   reset, 2FA and OAuth exchange (10 / 15 min), refresh (60 / 15 min), and `/api/geo` (30 / min). The signed
   Razorpay webhook is exempt.
3. JSON body (10 MB; webhook requests keep their raw bytes for HMAC checks), then `sanitizeInput`. It strips
   HTML/script from strings, keeps line breaks, and leaves password/token/signature fields untouched.
4. `/uploads` static files, `/health` (runs `SELECT 1`; reports `database: "postgresql"`), then `/api` routes.
5. `notFoundHandler`, then `errorHandler`. Errors are `AppError(message, status, code)` and render as
   `{ success: false, error: { message, code } }`.

Validation uses Zod schemas (`src/utils/validators.ts`) via the `validate` middleware. Services re-check invariants
they depend on.

## Authentication and authorisation

- **Access tokens:** short-lived JWTs (`JWT_EXPIRES_IN`, 15 min in Docker). They carry `tv` (the user's
  `tokenVersion`). Bumping `tokenVersion` revokes every outstanding access token. This happens on password
  change or reset, "sign out everywhere", deactivation and account deletion. `disconnectUser()` also drops live
  sockets.
- **Refresh tokens:** stored hashed and rotated on every use, grouped into a *family* per sign-in. Replaying an
  already-rotated token revokes the whole family (`REFRESH_TOKEN_REUSED`) and writes a `SECURITY_ALERT` audit entry.
  A 15-second grace window absorbs multi-tab races.
- **Other auth:** email verification, password reset, optional 2FA by email OTP, and Google/LinkedIn OAuth when
  configured.
- **RBAC:** the hierarchy is `MEMBER < CHAPTER_ADMIN < ADMIN < SUPER_ADMIN`, defined once in
  `src/config/permissions.ts` (`hasMinRole`, `isOwnerOrAdmin`, `canManageUser`, `canAssignRole`). Route guards
  `authenticate` / `optionalAuth` / `isChapterAdmin` / `isAdmin` / `isSuperAdmin` live in `src/middleware/auth.ts`.
  The role is re-read from the database on every request, so promotions and demotions apply immediately.
  Ownership rules (author-only edits, chapter-admin scope) live in services.
- **Guard rail:** `tests/routes/rbac-matrix.test.ts` lists every route with its access level. It fails when a route
  is unclassified, and it checks that every protected route rejects anonymous, malformed-token, deactivated and
  under-privileged callers.

## Data model highlights

PostgreSQL via Prisma. The main groups:

- **Identity:** `User` (profile, privacy flags, `tokenVersion`, approximate location), `RefreshToken` (families),
  `VerificationToken`, `WorkExperience`, `Education`, `Skill`/`UserSkill`.
- **Social:** `Post`, `PostLike`, `PostComment`, `Connection`, `Message`, `Notification`.
- **Careers and mentorship:** `JobOpportunity`, `MentorProfile`, `MentorshipRequest`, `MentorshipSession`.
- **Content:** `Event`/`EventRSVP`, `GalleryAlbum`/`GalleryPhoto`, `NewsArticle`, `Chapter`/`ChapterMembership`,
  `MarketplaceListing`.
- **Revenue:** `MembershipTier`/`UserMembership`, `Donation`, `Transaction` (unique `gatewayOrderId`; `userId`
  is nullable for guest donations).
- **Governance:** `AuditLog`, `Invite`.

PostgreSQL compares text case-sensitively, so user-facing searches use the `ilike()` helper (`src/utils/helpers.ts`,
`{ contains, mode: 'insensitive' }`). Skills are matched case-insensitively, so "react" reuses the existing "React".

## Real-time

socket.io shares the HTTP server (`src/utils/socket.ts`). The handshake uses the access token, with the same
`tokenVersion` check as HTTP. Sockets join `user:<id>` for notifications and `chat:<id>` for conversations; services
emit through `emitToUser` / `emitToRoom`. The client socket re-reads the latest token on reconnect and backs off after
server disconnects.

## Payments

Razorpay orders are created server-side as `PENDING` `Transaction`s, guest donations included. They are completed
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
  `FEED_CACHE_TTL_SECONDS`). Without Redis the cache is simply off.
- Uploads go to S3/R2 when `AWS_*` is configured; otherwise to `server/uploads` (a Docker volume). Images are
  type-checked and compressed/resized with sharp (`IMAGE_*` settings). Photos on managed storage can only be set
  through the upload endpoints.

## Lifecycle

- **Startup (`src/index.ts`):**
  - Requires a `postgresql://` `DATABASE_URL`.
  - Refuses weak JWT secrets in production.
  - Starts HTTP and socket.io.
- **Shutdown:** SIGTERM/SIGINT run `createShutdown` (`src/utils/shutdown.ts`): close socket.io and HTTP, disconnect
  Prisma and Redis, and force-exit after `SHUTDOWN_TIMEOUT_MS`.
- **Readiness:** `GET /api/platform/readiness` (admin) reports the PRD release gate; `/admin/control` shows it.

## Testing

| Layer | Where | Runs against |
|---|---|---|
| Unit (services, controllers, middleware, utils) | `server/src/__tests__/` | Deep-mocked Prisma |
| Route RBAC matrix | `server/tests/routes/` | Real Express app, mocked Prisma |
| Contracts | `server/tests/docs/`, `clientLinks` / audit-action tests | `docs/API_REFERENCE.md` freshness, notification links resolve to client pages, audit actions match the client |
| Integration | `server/tests/integration/` | Embedded PostgreSQL 17 (`embedded-postgres`), or `TEST_DATABASE_URL` |
| Frontend | `client/src/**/__tests__` | Vitest + Testing Library |

`docs/API_REFERENCE.md` is generated from the router (`npm run docs:api`). CI (`.github/workflows/ci.yml`) runs
typecheck, lint, unit tests with coverage, and integration tests on a `postgres:17-alpine` service, plus the client
typecheck, tests and build. It also validates `docker-compose.yml` and builds both images. Details: [TESTING.md](TESTING.md).

## Deployment

- **Production:** Docker Compose (PostgreSQL, Redis, API, web, optional nginx). See [DOCKER.md](DOCKER.md). The API
  container applies migrations and optionally seeds on start.
- **Local development without Docker:** `npm run db:local -w server` (embedded PostgreSQL on :5433), then `npm run dev`.
