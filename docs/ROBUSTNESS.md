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
| **Browser errors** | A render error anywhere in the signed-in area replaced the whole screen, navigation included; a failure of the root layout had no fallback; three API events (offline, server error, session ended) had **no listener** | Error boundary inside the signed-in layout, `global-error.tsx`, support reference shown; one throttled message per kind of problem | `error-boundaries`, `ApiStatusToasts` tests |
| **New pages** | The Videos, Magazine, Requirements and Referrals pages had no tests against a real server response: they showed empty lists for weeks | Page tests through the real API client with the exact server shape, including error and retry | `college-pages.test.tsx` |
| **One-command setup** | `./start.sh` generated localhost URLs and no mail server; the production guard then refused to start the API and the script waited five minutes before a vague message | The generated `.env` carries the clearly marked local-trial settings; the script stops at once when the API container dies and prints its log tail | `start-script.test.ts` (runs the real script against a stand-in `docker`) |
| **One-command setup** | On a server with only Docker (no Node) the secret generator's fallback aborted the script: `head` closing the pipe made `set -o pipefail` fail the run | The fallback reads a fixed chunk of `/dev/urandom`; a `node` that is on the PATH but cannot run is handled the same way | same, with a deliberately broken `node` |
| **Containers** | Logs were unbounded (a busy API fills the disk in weeks); nginx returned an HTML error page when the API restarted, which the web app cannot read | `json-file` rotation (3 × 10 MB per service); nginx answers a JSON 503 with `Retry-After`; upstream connect/read timeouts | `infrastructure.test.ts` |
| **Tooling** | `packageManager: yarn` in an npm project (every `npm` command fails under Corepack); `engines` said Node 18 while CI and Docker run 20 | Removed; `node >= 20`; the whole server unit suite was also run on Node 20 | `infrastructure.test.ts` |

## Running it

| Setting | Default | Effect |
|---|---|---|
| `LOG_LEVEL` | `info` (`debug` shows rejected 4xx requests; `warn` keeps only slow requests and errors) | Silent under the test runner |
| `LOG_FORMAT` | JSON when `NODE_ENV=production`, readable otherwise | Set `json` to force |
| `SLOW_REQUEST_MS` | `1000` | Requests at least this slow are logged as warnings (`slow: true`) |
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

## Still open

Found while looking, **not** fixed. Ordered by how likely they are to hurt first.

1. **~56 raw `console.*` calls** in `server/src` bypass the structured logger (mostly services logging a swallowed failure). Move them to `log.*`.
2. **About 60 `findMany` calls have no `take`.** Most are bounded by what they filter on (one member's connections, a fixed list of tiers),
   but the CSV exports in `adminService` load whole tables into memory, and a few admin and analytics lists grow with the user base.
   Cap or stream them before the member count reaches the tens of thousands.
3. **Orphaned uploads.** A file is stored before the record that points at it; if the record is then rejected or deleted by a path that does
   not remove the file, it stays on disk. There is no cleanup job. Account deletion also keeps stored files (documented decision).
4. **No restore test.** `backup-db.sh` verifies the dump can be read, but nothing restores one regularly. Do it by hand before go-live.
5. **No metrics or error-tracking service** (Prometheus/Sentry style). The logs and `/health` are all there is.
6. **No load or soak test.** Capacity is unmeasured: run one against staging before a public launch.
7. **`nginx.conf` and `docker-compose.yml` cannot be run in this repository's CI** (no nginx/Docker): their invariants are unit-tested, the
   behaviour is not. Run `nginx -t` and `docker compose config` on the server.
8. **Follow/react notification loops** can generate repeated notifications (only the global rate limit applies).
9. **Pending connection requests** (`getPendingRequests`) are returned unpaginated; harmless for people, not for a very popular account.
10. The launch gates in [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md) section 7 (Next.js upgrade, tokens out of `localStorage`, CAPTCHA/WAF,
    penetration test) are unchanged.
