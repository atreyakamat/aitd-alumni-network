# Changelog

All notable changes to AIEM Connect. The newest release is first. Dates are when the work landed on the
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
| **The platform is private and every registration needs an administrator's approval.** New registrations are `PENDING` until an administrator checks that the person is an alumnus of the college; nobody gets a session before that. Every API route except sign-in, the landing page's two feeds and the payment webhook now needs an approved member (events, news, gallery, chapters, jobs, search, profiles, posts, videos, magazine, requirements, marketplace and the donor wall used to be readable by visitors). `isVerified` now means "approved member" (the e-mail is `emailVerifiedAt`) | Run the migrations (`20261108020000_alumni_approval`): every existing account stays a member, except one that never verified and never signed in, which goes to the queue. **Work the queue** (*Admin > Approvals*) and make sure the mail server works: applicants are told by e-mail. Guest donations stay open (alumni donate without an account): `/donations` is the one page a visitor may open, and it shows the donation form only. See [AUTHENTICATION.md](docs/AUTHENTICATION.md#alumni-approval) |
| **Notifications are delivered through Kafka** (in-app notifications, announcement broadcasts, the e-mail to the college administrator when a registration is waiting, the e-mails to applicants). New `kafka` service in `docker-compose.yml`, `KAFKA_*` settings, `APPROVAL_NOTIFY_EMAIL`, migration `20261109000000_registration_pending_notification` | `docker compose up` starts the broker; set `KAFKA_BROKERS` (compose does) and make sure SMTP works. Without `KAFKA_BROKERS` the same events are delivered in-process. See [docs/KAFKA.md](docs/KAFKA.md) |
| **Google and LinkedIn sign-in are removed.** The registration form is the only way to get an account; an administrator verifies and approves it | Remove `GOOGLE_*` / `LINKEDIN_*` from your `.env`. A member who signed up through Google or LinkedIn sets a password with "Forgot password" |
| **The product is called "AIEM Connect"** everywhere (screens, e-mails, PDF receipts, seed data, documentation); the old college name is gone. Identifiers that carried it were renamed | **Receipt numbers** start `AIEM-` (they were `AITD-`; receipt numbers are derived, so an old receipt downloaded again shows the new number). The **session-hint cookie** is `aiem_session` (was `aitd_session`; at worst a member signs in once more). **Kafka defaults** are topic prefix `aiem`, group `aiem-notifications`, client `aiem-api`: set `KAFKA_TOPIC_PREFIX`, `KAFKA_GROUP_ID`, `KAFKA_CLIENT_ID` to keep earlier names. npm package names are `aiem-connect` / `aiem-connect-client` (run `npm ci` again). Migration `20261109010000_rebrand_content` renames the old product name in demo news and the seeded administrator's bio. The seed creates `admin@aiemconnect.edu` (existing databases keep the address they have) |
| **Reels are removed** (the Reels page, the `/reels` feed, the "reel" flag on posts and its database column) | Nothing: migration `20261108000000_remove_reels` drops the flag. Posts that were reels stay as ordinary video posts; the old `isReel` and `?reels=` inputs are ignored |
| **Every administrator now signs in with an e-mailed one-time code in production** (`REQUIRE_ADMIN_2FA`, on by default in production; chapter admin and above, even if they never turned 2FA on) | Working outbound e-mail is required (the start-up guard refuses to start without it). A one-machine trial sets `REQUIRE_ADMIN_2FA=false` next to the other two trial lines ([PRODUCTION_CHECKLIST.md](docs/PRODUCTION_CHECKLIST.md)) |
| `GET /metrics` (Prometheus text) exists only when `METRICS_TOKEN` is set and then needs `Authorization: Bearer <token>` | Optional: set a token and point your scraper at it ([PRODUCTION_CHECKLIST.md](docs/PRODUCTION_CHECKLIST.md), Monitoring) |

### Notification settings (2026-11-12)

* **Members choose what they hear about.** *Settings > Notifications* has a table of categories (connections and followers, messages, posts and comments, events,
  jobs and mentorship, college announcements) with an *In-app* (bell) and an *E-mail* switch each. Everything is on until a member changes it. New
  `GET` / `PUT /api/notifications/preferences` (own data only), table `NotificationPreference` (migration `20261113000000_notification_preferences`, applied by
  `prisma migrate deploy`; the Docker entrypoint already runs it). The settings are in the data export and erased with the account.
* **Some notices can never be switched off:** registration approval and rejection, password and sign-in security, verification and receipts e-mails, a member's
  membership notice and the administrator work items (`REGISTRATION_PENDING`, `CONTENT_REPORTED`). They have no category, and a payment that needs
  reconciliation is sent to administrators as `essential` whatever their settings say. `ADMIN_ANNOUNCEMENT` is switchable (it also carries some administrator
  reminders, such as a video submitted for review; an administrator who switches announcements off stops those too).
* A suppressed notification is a successful no-op (not an error): nothing is retried or dead-lettered. The weekly digest is the announcements e-mail: a member who
  switched it off is skipped (as is one who opted out of the digest). E-mail choices for the other categories are stored and apply when those e-mails exist.

### Operations, testing and monitoring added after the round-3 audit (2026-11-11)

* **Browser tests:** `e2e/` (Playwright) covers the public pages, the private-platform redirects, guest donations, the register -> approve -> sign-in journey
  and an axe accessibility scan; `.github/workflows/e2e.yml` runs it in CI; `npm run e2e` locally ([TESTING.md](docs/TESTING.md)). The first scan found real contrast
  failures on the landing page (footer text, "Members" labels, and an invisible white-on-white "Sign In" button): fixed.
* **Monitoring:** `GET /metrics` (token-protected, counts only), and a notification-backlog probe in the admin system status.
* **Dead letters:** `npm run dlq -w server -- list|replay|purge` (dry run by default; replay re-queues only valid events) ([KAFKA.md](docs/KAFKA.md)).
* **Backups:** the verification suite restores a dump into a scratch database and compares the data (gate D08); 32 gates.
* **Load test:** `npm run load:test` (read-only, rate-capped, refuses non-local targets unless told otherwise) ([TESTING.md](docs/TESTING.md)).
* **GitHub:** Dependabot (patch and minor updates, majors ignored on purpose), a pull-request template, CODEOWNERS, and a setup guide for required checks, secret scanning
  and the leaked database password clean-up ([GITHUB_SETUP.md](docs/GITHUB_SETUP.md)). A staging and release-rehearsal guide ([STAGING.md](docs/STAGING.md)).
* **Tidy:** the eight old MySQL-era deployment documents moved to `docs/archive/`; the root `.env.example` now shows PostgreSQL; client lint is at zero warnings.
* **Not done on purpose:** Next 16 / React 19 and zod 4 stay out of this round (Next 15.5.29 is the patched line; a major upgrade needs its own branch and a full
  browser pass). Dependabot ignores majors until then.

### Fixed in the walk-through of every admin and member screen (2026-11-09)

**Admin**

* **One admin shell:** a section navigation bar (with the pending-approvals count) and the same page header on every admin page; the
  mix of "Admin dashboard" / "Admin" / "Back to Admin" links and page widths is gone.
* **Numbers that were wrong after approval was introduced:** dashboard and analytics counted pending and rejected applicants as members.
  Totals, growth, roles, batches, locations and the growth chart now count approved members only; `GET /api/admin/stats` adds
  `users.pendingApproval` and `users.rejected`, and each recent registration carries its `approvalStatus`. The "Verified users" tile
  (meaningless once verified = approved) became "Awaiting approval", linked to the queue.
* **Invented data removed:** the analytics page showed a hard-coded "234 Active Sessions" and a monthly figure labelled "New Registrations Today".
* **Charts and wording:** the revenue axis printed `₹0.004k`; it now reads `₹0`, `₹1.5K`, `₹2.5L`. Dates read `9 Nov 2026` (they were `11/9/2026`, which an Indian
  reader takes for 11 September). Roles read "Member / Super Admin" instead of `SUPER_ADMIN`; "1 upcoming events" and similar plurals fixed.
* **Members page:** one clear status (Pending approval / Rejected / Deactivated / Active) instead of "Active" plus "Not approved"; applicants link to the
  review queue; your own row cannot be demoted or deactivated (the server always refused, now the screen says so). `GET /api/admin/users` returns `approvalStatus`.
* **Audit log** names the person an action was about (`Jane Doe (jane@x.edu)`) instead of a bare id (`entityLabel` on `GET /api/admin/audit`).
* **System status replaces the Control Center.** The old page was a developer checklist ("Owner: Platform Team", file paths). `/admin/status`
  (`GET /api/admin/system-status`) shows live health in plain words: database, cache, notifications, e-mail, registration alerts, payments, storage.
  `/admin/control` redirects to it; `GET /api/platform/readiness` is removed.
* **A decision settles its notices:** approving or rejecting an applicant marks the administrators' "New registration to review" notices read; the bell used to
  go on asking for decisions that were already made.
* Pages that failed to load showed a toast and then an empty page or a spinner that never ended; they now show the error with a Retry button.

**Everywhere**

* **False "Cannot reach the server" messages:** a request the page cancelled itself (switching a tab, typing in search, leaving a page) was reported as a lost
  connection. Cancelled requests are now silent.
* **No failed request after a break:** when the 15-minute access token has run out, the app renews it first instead of sending a request that fails with a red 401.
* **Events:** the page was titled "Upcoming Events" but listed past events too. It now has Upcoming / Past tabs (`GET /api/events?past=true` is new);
  an online event says "Online" instead of "Location TBD".
* **One department list** for registration, directory, yearbook and nearby alumni (they disagreed, so "Computer Engineering" members could not be found by filter).
  The directory no longer prints "No headline" and words the batch like the rest of the site; the yearbook opens on your own batch instead of an empty "Class of 2026".
* **Every page has its own title** in the browser tab (a guard test fails a build when a page lacks one); the "show password" buttons have names for screen readers;
  the registration page no longer promises "thousands of alumni".
* **Demo data:** the seed's events are dated relative to the day it runs (they were fixed to April-June 2026, so a fresh database had no upcoming events).
* **Operations:** `preflight` and the Docker/production documents named a different default database than `docker-compose.yml` (`aiem_connect`); the uploads backup command named a volume that does not exist.

### College alumni list and a faster review queue (2026-11-12)

* **College alumni list** (`AlumniRecord`, migration `20261112000000_alumni_records`): an administrator imports the list the college keeps on
  `/admin/alumni-list` (the browser parses the CSV and sends JSON, at most 1000 rows per request; no file upload). Administrators only; imports and removals
  are audit-logged (counts only); decision 15 in [PRODUCTION_CHECKLIST.md](docs/PRODUCTION_CHECKLIST.md).
* **Match per registration:** each item of `GET /admin/approvals` has `match` (exact / probable / none, with the reason) and `waitingDays`; the queue filters by
  batch, department, match and waiting time; the summary counts applications waiting 7 days or more.
* **Bulk decisions:** `POST /admin/approvals/bulk-approve` and `bulk-reject` (up to 50 ids) go through the same rules as the single decision and answer per id.
  The page offers "Approve all exact matches on this page" only for exact matches with a verified e-mail, after a confirmation that lists the names.

### Docker and Kafka verification, and round-3 security tooling (2026-11-11)

* **One command proves the Docker stack works:** `npm run docker:verify` (`scripts/docker-verify`, guide: [docs/DOCKER_TEST_GUIDE.md](docs/DOCKER_TEST_GUIDE.md)).
  It brings the compose stack up in its own project with a mail catcher (`docker-compose.test.yml`), then checks 32 gates: images build and are
  healthy, no root, only the intended ports, a real registration with the e-mails read from the catcher (applicant, administrator, the shared office
  mailbox), approval and rejection, the consumer lag, and drills that break things on purpose (broker outage and recovery, poison messages to the
  dead-letter topic, duplicate events, the API down, Kafka/PostgreSQL/Redis restarts, a backup that restores, `down` and `up`). It writes an evidence bundle (`REPORT.md`,
  `report.json`, logs, a SHA-256 manifest) with secrets redacted.
* **GitHub CI runs it** on pull requests and weekly (`.github/workflows/docker-verify.yml`), after the suite's own tests, which run every gate against an
  in-memory stand-in of the stack and plant defects to prove each gate can fail (`npm run test:scripts`, no Docker needed).
* **Round-3 security tooling** (`scripts/security`, plan: [docs/SECURITY_AUDIT_PLAN.md](docs/SECURITY_AUDIT_PLAN.md), workflow `.github/workflows/security.yml`):
  a live authorization probe that replays the documented access level of every endpoint against a running stack (`rbac-live.mjs`), an `npm audit` gate with an
  expiring, justified allowlist, gitleaks, hadolint, Trivy, CodeQL and a ZAP baseline. First results are listed in the plan (R3-01 to R3-05).
* **First round-3 findings, fixed the same day** (details in the plan): request lists are bounded (one 1 MB body used to make the server allocate ~280 MB; R3-01);
  **Next.js 14.2.35 to 15.5.29** (R3-02: the production audit goes from 1 critical and 11 high to none critical; run `npm ci` after pulling); nginx no longer forwards
  WebSocket upgrades to the web app (R3-03); build tooling moved to `devDependencies` (R3-04); the API image no longer ships jest, eslint and typescript (R3-05, to be
  confirmed by the docker-verify run).

### Reliability (see [docs/ROBUSTNESS.md](docs/ROBUSTNESS.md))

* **Mail:** SendGrid-only configurations now actually send (they passed the production checks but the sender ignored the key); connection
  timeouts; transient failures retried; sign-up no longer waits for the mail server.
* **Conversation list** (`GET /api/messages`) no longer loads a member's whole message history: the database returns one page.
* **14 foreign keys got indexes** (migration `20261108010000_foreign_key_indexes`).
* **Logging and tracing:** structured logger, `X-Request-Id` on every response, one access-log line per request, only real failures logged as errors.
* **Process:** crash handling that restarts clean, HTTP timeouts above the proxy's, `redisStatus` on `/health`.
* **Browser:** 30 s request timeout (uploads exempt), plain-language network messages, sensible query retries, error boundaries in the signed-in
  area and at the root, and messages for offline, server error and ended session (three events that had no listener).
* **`./start.sh` on a machine without a working Node** (a Docker-only server): the fallback secret generator aborted the script under
  `set -o pipefail`; it now reads a fixed chunk of `/dev/urandom` and also covers a `node` that exists but cannot run.
* **Development logs:** Prisma prints SQL only with `PRISMA_LOG_QUERIES=true` (it hid the request log); production stays errors-only.
* **Containers and proxy:** log rotation, a JSON 503 from nginx while the API restarts, upstream timeouts; `./start.sh` produces an `.env` the
  production guard accepts and reports a crashed API at once.
* **Tooling:** removed the wrong `packageManager: yarn`; `node >= 20` to match CI and Docker.

### Merged from `main`

The branch includes everything `main` gained since the first merge (2026-10-22 to 2026-10-28): college videos, a magazine,
requirements, job referrals, a weekly digest, a landing page builder, home and work locations, marketplace logo and images,
background jobs (BullMQ), and the AIEM Connect rebrand. Three migrations came with it (`20261028*`); `20261108000000_remove_reels`
follows them. Reviewing that code found and fixed a file-deletion hole, privacy gaps in account deletion, several HTTP 500s and
empty list pages: see [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md) ("Review of the code merged from main").

| Change | What you must do |
|---|---|
| `bullmq` runs background jobs (notification broadcasts, the weekly digest) | They need `REDIS_URL`; without it the work is done inline and the digest is sent from the admin panel |
| Video and magazine records accept only files the upload endpoints stored | Nothing for normal use (the pages upload first); an API client posting an external video URL is refused |

### Added

* **Alumni social layer:** six reactions, threaded comments, reposts and quote posts, posts with images or video,
  public/connections visibility, hashtags and mentions, follows, saved posts, reports with admin moderation, a ranked feed
  with cursor pagination ([docs/SOCIAL_API.md](docs/SOCIAL_API.md)).
* **GPS alumni map:** "near me" radius search, filters, place search through OpenStreetMap Nominatim, locations rounded to ~1 km.
* **One search** for visitors and members; visitors see public results with a "sign in for more" note.
* **Members-only gate at the edge** (`client/src/middleware.ts`).
* **`/verify-email` page** (the verification e-mail linked to a page that did not exist), resend flow, sign-in notice.
* **Docker Compose** (PostgreSQL 17, Redis, API, web, optional nginx) with health checks, idempotent migrate-and-seed on start.
* **Production tooling:** start-up guard, `npm run preflight`, `npm run secrets`, `npm run verify:deploy`, a PostgreSQL
  `backup-db.sh`, request limits in `nginx/nginx.conf`.
* **Test suites:** security regressions (394 tests, real PostgreSQL), client/server contract (931), plus unit (4,375),
  integration (50) and client (1,274). CI runs all of them.
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

* **Reels.** The college Videos page replaces them; short videos can still be attached to ordinary posts.
* The Google Maps dependency and `GOOGLE_MAPS_API_KEY` (OpenStreetMap/Leaflet replaces it).
* The MySQL migrations (archived in `server/prisma/mysql-legacy/`).
* The Next.js image optimizer (disabled; images are served as they are).
