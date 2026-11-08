# Changelog

All notable changes to AITD Connection. The newest release is first. Dates are when the work landed on the
`feat/postgres-maps-social` branch.

## Unreleased: PostgreSQL, maps, alumni social layer, security hardening, production tooling (2026-10-18 to 2026-11-08)

### Upgrade notes: read before deploying

| Change | What you must do |
|---|---|
| The database is **PostgreSQL 17** (was MySQL 8). Migrations restart at a single baseline | New installs: nothing. Existing MySQL data must be copied across ([DOCKER.md](docs/DOCKER.md) "Migrating existing MySQL data"); everybody signs in again afterwards |
| With `NODE_ENV=production` the API **refuses to start** on an unsafe configuration | Run `npm run preflight -w server`; fix what it lists ([PRODUCTION_CHECKLIST.md](docs/PRODUCTION_CHECKLIST.md)) |
| **E-mail verification is required before a session in production** (`REQUIRE_EMAIL_VERIFICATION`), and the link needs the registration password | A working mail server is required. Members who never verified use "Resend verification email" once |
| Access tokens last **15 minutes** in production (were 24 h) | Nothing: the client refreshes automatically |
| JSON and urlencoded request bodies are capped at **1 MB** (were 10 MB); upload routes accept at most 10 text fields | Uploads are unaffected. A client sending very large JSON must be changed |
| `//` in an API path is collapsed (`/api//x` routes as `/api/x`) | Nothing |
| The committed database password must be rotated | [PRODUCTION_CHECKLIST.md](docs/PRODUCTION_CHECKLIST.md) section 4 |
| `backup-db.sh` is now a PostgreSQL script (it was MySQL) | Reschedule it; keep the dumps off the server |

### Added

* **Alumni social layer:** six reactions, threaded comments, reposts and quote posts, posts with images, video and reels,
  public/connections visibility, hashtags and mentions, follows, saved posts, reports with admin moderation, a ranked feed
  with cursor pagination ([docs/SOCIAL_API.md](docs/SOCIAL_API.md)).
* **GPS alumni map:** "near me" radius search, filters, place search through OpenStreetMap Nominatim, locations rounded to ~1 km.
* **One search** for visitors and members; visitors see public results with a "sign in for more" note.
* **Members-only gate at the edge** (`client/src/middleware.ts`).
* **`/verify-email` page** (the verification e-mail linked to a page that did not exist), resend flow, sign-in notice.
* **Docker Compose** (PostgreSQL 17, Redis, API, web, optional nginx) with health checks, idempotent migrate-and-seed on start.
* **Production tooling:** start-up guard, `npm run preflight`, `npm run secrets`, `npm run verify:deploy`, a PostgreSQL
  `backup-db.sh`, request limits in `nginx/nginx.conf`.
* **Test suites:** security regressions (394 tests, real PostgreSQL), client/server contract (782), plus unit (3,334),
  integration (36) and client (968). CI runs all of them.
* **Documentation:** [docs/README.md](docs/README.md) (index), [AUTHENTICATION.md](docs/AUTHENTICATION.md),
  [PRODUCTION_CHECKLIST.md](docs/PRODUCTION_CHECKLIST.md), [SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md).

### Changed

* Rate limits are **shared through Redis** when `REDIS_URL` is set (per process otherwise or when Redis is down).
* Google/LinkedIn sign-in goes through the **second factor** for members who have 2FA on.
* The dashboard no longer repeats the header navigation as a left-hand shortcut card.
* Next.js 14.2.10 to 14.2.35 (closes a middleware authorization bypass), `sharp` 0.35.5, `nodemailer` 10.4, other
  non-breaking dependency fixes (server advisories 28 to 10, none critical).

### Fixed

* **Authorization and integrity:** visitors could reach member app shells; check-then-act races (event capacity, mentorship
  slots, connection and message quotas, invite quotas, like/comment/repost counters, memberships) are now atomic.
* **Input handling:** link and media URLs are allowlisted everywhere; the sanitizer is linear time (it was a ReDoS reachable by
  anonymous requests) and no longer cuts words such as "JavaScript Developer"; images are re-encoded; multipart text fields
  are bounded; receipts cannot be fetched as static files by any path spelling.
* **Rate limits could be bypassed** with a doubled slash (`/api//auth/login`), or an absolute-form request target.
* **Broken endpoints:** a client/server contract sweep fixed mismatches in the directory, network, yearbook and messages pages
  and made the error handler map database errors to 4xx instead of 500.
* **Account lifecycle:** deletion and data export now cover every model that references a user; audit entries lose request metadata.
* `backup-db.sh` no longer targets MySQL with a hardcoded host.

### Security

Two white-box audit rounds, 27 further defects found in round two, each with a regression test that fails without its fix:
[docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md). Still open and tracked as launch gates in
[docs/PRODUCTION_CHECKLIST.md](docs/PRODUCTION_CHECKLIST.md): the Next.js 14 to 15/16 upgrade, tokens in `localStorage`,
CAPTCHA/WAF, central logging and an independent penetration test.

### Removed

* The Google Maps dependency and `GOOGLE_MAPS_API_KEY` (OpenStreetMap/Leaflet replaces it).
* The MySQL migrations (archived in `server/prisma/mysql-legacy/`).
* The Next.js image optimizer (disabled; images are served as they are).
