# AITD Connection Feature Status (PRD v1.1 aligned)

Updated 2026-10-18. Live status is served by `GET /api/platform/readiness` (admin control view at `/admin/control`).
Release gate (PRD §10.3): **releasable, no P0/P1 blockers in Must Have domains.**

| Domain | Status | Evidence |
|---|---|---|
| Platform foundations (auth guards, role normalisation, error shape) | IMPLEMENTED | `config/permissions.ts`, route RBAC matrix test, client `lib/roles.ts` |
| Authentication & security (JWT + rotating refresh families with reuse detection, token-version revocation, email verify, reset, change password, 2FA OTP, OAuth) | IMPLEMENTED | auth unit suites, socket auth suite, `tests/integration/auth-lifecycle.int.test.ts` |
| Discovery (directory, yearbook, alumni map: viewport + "Near me" radius search, filters, place search, ~1 km location privacy) | IMPLEMENTED | userService + geocodingService suites, `tests/integration/geo-search.int.test.ts`, alumni-nearby page and `lib/geo` tests |
| Profile & identity (profile editor: basics, photos, links, privacy/location, work, education, skills, completeness) | IMPLEMENTED | profile validator + route suites, `/profile/edit` component tests |
| Social (feed, likes, comments with author-only editing, connections, messaging, notification bell + page) | IMPLEMENTED | post/network/message suites, `clientLinks` contract test, NotificationBell/notifications page tests |
| Careers (jobs + admin review queue) | IMPLEMENTED | jobService suite, `/admin/moderation` |
| Mentorship (profiles, requests, sessions, admin overview) | IMPLEMENTED | mentorshipService suite, `/api/admin/mentorship/overview` |
| Events, gallery, news (public browsing without login, article pages) | IMPLEMENTED | event/gallery/news suites, `(main)` layout public-path tests, news page tests |
| Revenue (memberships, member + guest donations, verified payments, Razorpay webhook, mismatch alerts, receipts, history) | IMPLEMENTED | membership/donation/webhook suites, `tests/integration/payments.int.test.ts` |
| Community (chapters pages with chapter-admin scope and server-side search, marketplace listing lifecycle with admin moderation, invites) | IMPLEMENTED | chapter scope tests, chapters/marketplace page tests, marketplace/invite suites |
| Admin & governance (real-data analytics, audit log page with security/payment alerts, user management, CSV exports, readiness) | IMPLEMENTED | adminController/adminService/audit suites, analytics + audit page tests, audit filter contract test, `tests/integration/admin-rbac.int.test.ts` |
| Privacy (data export, account deletion) | IMPLEMENTED | privacyService suite, integration test |

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
  `DEPLOYMENT_VERIFICATION.md`; it is redacted now but remains in git history.
- The root `DEPLOYMENT*.md` and `EXTENSIVE_DEPLOYMENT_GUIDE.md` files describe the old MySQL shared-host setup and are
  superseded by [DOCKER.md](DOCKER.md).
- Configure `RAZORPAY_WEBHOOK_SECRET` and point the Razorpay dashboard webhook at `https://<api-host>/api/payments/webhook/razorpay`
  (events `payment.captured`, `order.paid`, `payment.failed`). Without the secret the endpoint answers 503.
- The public OpenStreetMap services have usage limits. For heavy traffic, set `GEOCODER_URL` to a self-hosted
  Nominatim and `NEXT_PUBLIC_MAP_TILE_URL` to your own or a commercial tile server. Set `GEOCODER_EMAIL` to a
  contact address.
- `docker compose` sets `API_INTERNAL_URL` for the web container; set it yourself only outside Compose.

## Known follow-ups

- Guest orders created before the 2026-10-14 payment changes and paid only through the webhook (no client verify) cannot be matched; they need manual reconciliation.
- Guest donor name/email is kept in transaction metadata with no retention scrub yet.
- Razorpay webhook events are deduplicated by idempotent state changes, not by event id.
- Place-search results are cached in process memory, so each API replica has its own cache. Move the cache to Redis
  before scaling out horizontally.
- The alumni map has no visual browser check in CI; it is covered by component tests and the API integration suite.
