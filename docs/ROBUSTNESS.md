# Robustness: what was hardened, how to run it, what is still open

The audits ([SECURITY_AUDIT.md](SECURITY_AUDIT.md)) looked for ways to **attack** the platform. This page is about how it **behaves
when things go wrong**: a slow mail server, a dropped connection, a crashed process, a database that has grown, a deploy that
leaves a stale file behind. It lists what was found and fixed on 2026-11-08, how to operate the result, and, honestly, what is
still open.

## What was hardened

| Area | The gap | The change | Proof |
|---|---|---|---|
| **Mail** | `SENDGRID_API_KEY` passed the production checks as "mail is configured", but the sender only ever used SMTP credentials: a SendGrid-only deployment would never deliver a verification e-mail | SendGrid is used through its SMTP relay (no new dependency); SMTP otherwise | `emailTransport.test.ts` |
| **Mail** | A stuck mail server held a sign-up open (nodemailer waits 2 minutes to connect, 10 of silence) | 10 s connect / greeting and 20 s socket timeouts; transient failures (network errors, 4xx replies) are retried twice with a growing pause, permanent ones (rejected recipient, bad login) are not | same |
| **Mail** | Registration waited for the verification mail | The mail goes out in the background (like password reset); a failure is logged, the member can use "resend" | `authService.verification.test.ts` |
| **Conversation list** | `GET /api/messages` loaded **every message** a member ever sent or received, with joins, and grouped them in Node: slower with every message | The database picks the latest message per conversation and returns one page; the history never leaves it | `conversations.int.test.ts` (real PostgreSQL, 1,500-message history, same behaviour before and after), unit tests |
| **Database** | 14 foreign keys had no index (PostgreSQL does not create one), so joins and the cascades that run when a user, post, event or transaction is deleted scanned whole tables | Migration `20261108010000_foreign_key_indexes`, declared in the schema | migration-drift test in `admin-rbac.int.test.ts` |
| **Observability** | Every request, error and 401 printed a full stack trace with `console.error`; no way to connect a user's report to a log line | Structured logger (JSON in production, `LOG_LEVEL`); `X-Request-Id` on every response (a caller's id is kept when it is short and plain); one access-log line per request with the **route pattern**, status and duration (never the query string or a token in the path); only real failures are logged as errors | `logger`, `requestContext`, `errorHandler`, `operability` tests |
| **Process** | A crash outside a request left a half-working process; HTTP keep-alive was shorter than the proxy's, which causes occasional 502s | An uncaught exception drains in-flight work and exits non-zero so Docker starts a clean process; keep-alive 65 s, headers 66 s, request timeout 10 min (`REQUEST_TIMEOUT_MS`); a stray unhandled rejection is logged, not fatal | `processHandlers`, `shutdown` tests |
| **Health** | `/health` said nothing about Redis | `redisStatus: up \| down \| disabled`, informational (the API works without Redis) | `operability.test.ts` |
| **Browser requests** | No timeout: a hung server left a spinner forever. "Network Error" / "timeout of 30000ms exceeded" reached members | 30 s limit (file uploads are exempt); plain-language messages | `resilience.test.ts` |
| **Browser retries** | Every failed query was retried once, including 403 and 404 (pointless), and never with a pause | Retry network failures, timeouts, 408/429/5xx up to twice with 1 s, 2 s backoff; never retry other 4xx | same |
| **Browser errors** | A render error anywhere in the signed-in area replaced the whole screen, navigation included; a failure of the root layout had no fallback; three API events (offline, server error, session ended) had **no listener** (a fourth, `api:account_not_approved`, is announced the same way) | Error boundary inside the signed-in layout, `global-error.tsx`, support reference shown; one throttled message per kind of problem | `error-boundaries`, `ApiStatusToasts` tests |
| **New pages** | The Videos, Magazine, Requirements and Referrals pages had no tests against a real server response: they showed empty lists for weeks | Page tests through the real API client with the exact server shape, including error and retry | `college-pages.test.tsx` |
| **One-command setup** | `./start.sh` generated localhost URLs and no mail server; the production guard then refused to start the API and the script waited five minutes before a vague message | The generated `.env` carries the clearly marked local-trial settings; the script stops at once when the API container dies and prints its log tail | `start-script.test.ts` (runs the real script against a stand-in `docker`) |
| **One-command setup** | On a server with only Docker (no Node) the secret generator's fallback aborted the script: `head` closing the pipe made `set -o pipefail` fail the run | The fallback reads a fixed chunk of `/dev/urandom`; a `node` that is on the PATH but cannot run is handled the same way | same, with a deliberately broken `node` |
| **Containers** | Logs were unbounded (a busy API fills the disk in weeks); nginx returned an HTML error page when the API restarted, which the web app cannot read | `json-file` rotation (3 × 10 MB per service); nginx answers a JSON 503 with `Retry-After`; upstream connect/read timeouts | `infrastructure.test.ts` |
| **Tooling** | `packageManager: yarn` in an npm project (every `npm` command fails under Corepack); `engines` said Node 18 while CI and Docker run 20 | Removed; `node >= 20`; the whole server unit suite was also run on Node 20 | `infrastructure.test.ts` |
| **Logging** | About 55 raw `console.*` calls in `server/src` bypassed the structured logger: no level, no `LOG_FORMAT`, stack traces as plain text, nothing to search by | Every one goes through `log.*` with fields (errors as `{ err }`; personal data such as a donor's or invitee's address is left out, an audit entry logs only its action, entity type and id). The shutdown helper reports its problems as errors. A guard test fails on any new raw `console.*`; its short allow-list is the logger itself, the development e-mail preview and the authentication files still being migrated | `noRawConsole.test.ts`, `auditService`, `shutdown`, `paymentWebhookService` tests |
| **Admin exports** | The five CSV exports (`GET /admin/export/:entity`) loaded a whole table into memory | Read in batches of 1,000 by keyset (newest first, id as tie-breaker, so no row is skipped or repeated) and written to the response batch by batch, waiting for the socket to drain. Hard limit of 100,000 rows (`EXPORT_MAX_ROWS`): the file then ends with an `EXPORT TRUNCATED` row and the response carried `X-Export-Truncated: true` (the admin page shows a warning). The header row leaves with the first batch, so a database failure before any data is a clean JSON error; a failure later cuts the connection rather than ending a short file as if it were whole. The audit entry records `rows`, `truncated` and, for an export that stopped early, `aborted` | `adminService.test.ts`, `adminExport.test.ts`, `streamResponse.test.ts`, `ExportPanel.test.tsx` |
| **Unbounded lists** | Roughly 60 `findMany` calls without `take` | Capped the ones that grow with the user base: mentor search with in-memory filters (2,000 newest profiles), "my listings" (200), the connection-suggestion exclusion list (5,000), the comment tree of a post detail (100 newest top-level comments, 50 replies each; older ones come from `GET /posts/:id/comments`). The rest were reviewed and left (see below) | the matching service tests |
| **Orphaned uploads** | A file is stored before the record that points at it; a record rejected, or deleted by a path that does not remove the file, left it on disk for ever | `npm run uploads:cleanup -w server` (see below). Dry run by default | `uploadCleanupService.test.ts`, including a test that fails when a new upload-like column of the schema is not covered |
| **Notification loops** | Follow, unfollow, follow (or taking a reaction back and giving it again, reposting again, a connection request that was declined and sent again) told the other person every single time; only the global rate limit applied | A notice may carry `dedupeBy`: when the recipient already has a notification of the same type, from the same actor, about the same entity, created in the last 24 hours, no new one is made. The action itself always goes through. Applied to new followers, post and comment reactions, reposts, connection requests and acceptances | `socialNotifications.test.ts` and the follow, reaction, repost and network service tests; `social.int.test.ts` (real PostgreSQL) |
| **Pending requests** | `GET /network/requests` returned every pending request: unbounded for a popular account | Paginated like the other lists (`page`, `limit`: default 20, maximum 100; `type=received\|sent` reads one list). The body keeps `data.received` and `data.sent` and adds `pagination: { received, sent }`. The network page asks for the received list only and has a "Load more" button | `networkService.test.ts`, `socialController.test.ts`, `network-page.test.tsx` |

## Running it

| Setting | Default | Effect |
|---|---|---|
| `LOG_LEVEL` | `info` (`debug` shows rejected 4xx requests; `warn` keeps only slow requests and errors) | Silent under the test runner |
| `LOG_FORMAT` | JSON when `NODE_ENV=production`, readable otherwise | Set `json` to force |
| `SLOW_REQUEST_MS` | `1000` | Requests at least this slow are logged as warnings (`slow: true`) |
| `EXPORT_MAX_ROWS` | `100000` | Most rows one admin CSV export writes; past it the file ends with an `EXPORT TRUNCATED` row |
| `REQUEST_TIMEOUT_MS` | `600000` | Upper bound for one request (uploads of up to 100 MB) |
| `PRISMA_LOG_QUERIES` | unset | Development only: `true` prints every SQL statement (hidden by default so the request log stays readable; never printed in production) |

**Following one request:** every API response carries `X-Request-Id` (visible in the browser's network tab; a proxy may supply its own).
Search the API log for it: the access-log line gives route, status and duration, and an error line with the same id carries the stack.

```bash
docker compose logs api | grep 'the-request-id'
```

The **Reference** shown on a web error page is a different thing: Next.js's own error digest. Search the **web** container's log for it
(`docker compose logs web | grep 'the-reference'`).

Alert on: `/health` returning 503, a sustained rate of `"level":"error"`, and a spike of 401/429 on `/api/auth/*`.

### Cleaning up orphaned uploads

```bash
cd server
npm run uploads:cleanup -w server                       # dry run (the default): reports, deletes nothing
npm run uploads:cleanup -w server -- --list             # name every candidate instead of the first 20
npm run uploads:cleanup -w server -- --delete           # remove what the dry run listed
npm run uploads:cleanup -w server -- --min-age-hours 72 # only files untouched for 72 hours (default 24, deleting needs at least 1)
```

From the built image (it has no `scripts/` folder, but the compiled service is there):
`docker compose exec api node -e "require('./dist/services/uploadCleanupService').runCleanupCli(process.argv.slice(1)).then(process.exit)" -- --min-age-hours 48`.

* **What counts as an orphan:** a file in the local uploads directory that no database record refers to (the columns are listed in
  `UPLOAD_REFERENCE_FIELDS`: profile and cover photos, post media and videos, gallery, marketplace, college videos and magazines, receipts,
  message media, event banners, chapter logos, news images, landing-page blocks; paths are matched wherever they appear in a value,
  including inside JSON) **and** that has not changed for the minimum age, so an upload still being attached is never touched.
* **Safe by construction:** nothing outside the uploads directory is read or removed; symbolic links are not followed; hidden files are left
  alone; each deletion re-checks the path and that the file did not change since the scan; the database is read after the directory walk.
  If the database has no upload reference at all while files exist (the wrong database, an empty one) it refuses to delete. It prints counts,
  sizes and names relative to the uploads directory, never file contents. Exit code 1 means a deletion was refused or failed.
* **Limits:** local storage only (with S3 use a bucket lifecycle rule). A file that is referenced only from free text (a post body, an
  article's HTML) is not recognised as referenced: review the dry-run list before the first `--delete`. Account deletion keeps stored files on
  purpose (documented decision); this command keeps them too while an anonymised record still points at them.
* **Adding a column that stores an uploaded file's path:** add it to `UPLOAD_REFERENCE_FIELDS`. The test fails until you do (or until you
  declare it "not an upload" in the test), because forgetting it would make the cleanup delete files in use.
* **When:** a dry run once a month (see the production checklist); delete after reading the list.

### Why these lists have no `take`

Reviewed on 2026-11-08 and left on purpose: the fixed sets (membership tiers, landing blocks, active chapters and their regions, the
admins who are notified of a submission), one record's own children (the sessions of one mentorship, the mentions of one post, the skills of
one member), lookups by the ids of a page that was already bounded (feed presenters, report targets, message previews, actor names,
map pins), and `privacyService`, which exports **everything** about one member on purpose (a legal right: capping it would make the export
incomplete). Two of them deserve a second look if a single member can ever hold tens of thousands of rows: `loadViewerContext`
(`socialShared.ts`) reads all of a viewer's connections and follows on each feed request because visibility decisions need the full set,
and a member's own donations list. News slug generation reads every slug that starts the same way, which only grows with same-titled articles.

## Still open

Found while looking, **not** fixed. Ordered by how likely they are to hurt first.

1. **No restore test.** `backup-db.sh` verifies the dump can be read, but nothing restores one regularly. Do it by hand before go-live.
2. **No metrics or error-tracking service** (Prometheus/Sentry style). The logs and `/health` are all there is.
3. **No load or soak test.** Capacity is unmeasured: run one against staging before a public launch.
4. **`nginx.conf` and `docker-compose.yml` cannot be run in this repository's CI** (no nginx/Docker): their invariants are unit-tested, the
   behaviour is not. Run `nginx -t` and `docker compose config` on the server.
5. The launch gates in [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md) section 7 (Next.js upgrade, tokens out of `localStorage`, CAPTCHA/WAF,
   penetration test) are unchanged.
