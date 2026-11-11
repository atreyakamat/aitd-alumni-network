# Going to production: what must change

Everything in this repository defaults to **development**: localhost URLs, demo accounts, a relaxed e-mail policy.
This page lists what has to be different on the real server, the security decisions that were already taken for you,
and what is still open. Work through it top to bottom before the first real user signs in.

> **The API enforces the important parts itself.** With `NODE_ENV=production` it refuses to start on an unsafe
> configuration and prints what to fix (weak or leaked secrets, plain-http origins, no mail server while e-mail
> verification is required, rate limiting switched off, ...). `npm run preflight` runs the same rules plus a look inside
> the database. Neither replaces reading this page.

## 1. The short path

```bash
# 1. Generate secrets (printed, never saved). Copy them into .env or your secret manager.
npm run secrets -w server

# 2. Create the environment file and fill it in (section 2 explains every line)
cp .env.docker.example .env

# 3. Check the configuration, and the production database once it exists
npm run preflight -w server -- --env-file ../.env
DATABASE_URL='postgresql://aiem:<password>@127.0.0.1:5432/aiem_connect' \
  npm run preflight -w server -- --env-file ../.env          # also inspects the database

# 4. Start
docker compose --profile proxy up -d --build

# 5. Verify the live site (read-only: it never signs in and never writes)
npm run verify:deploy -w server -- --web https://alumni.example.edu
```

`preflight` exits 1 while any error remains. Warnings are things to decide about, not blockers.

## 2. Settings that must change

| Setting | Development value | Production value | Why |
|---|---|---|---|
| `NODE_ENV` | `development` | `production` (docker-compose sets it) | Turns on the start-up guard, 15-minute access tokens, e-mail verification, HSTS |
| `POSTGRES_PASSWORD` / `DATABASE_URL` | `postgres:postgres`, `change-me-...` | random 24+ characters | The guard rejects empty, short, placeholder, common and **the password that was committed to this repository** |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | random per process | two different random 48+ character values | Anyone with them can forge sessions. The API will not start with weak ones. Changing them signs everybody out |
| `JWT_EXPIRES_IN` | `24h` | leave unset (defaults to `15m` in production) | A stolen access token expires quickly; the refresh token keeps people signed in |
| `FRONTEND_URL` | `http://localhost:3000` | `https://<your domain>` | Used in e-mail links |
| `CORS_ORIGINS` | localhost list | exactly the `https://` origin(s) of the web app | The guard rejects localhost, wildcards and plain http |
| `NEXT_PUBLIC_API_URL` | `http://localhost:5000/api` | `https://<your domain>/api` (single origin via the `proxy` profile) | Baked into the web image **at build time**: rebuild after changing it |
| `TRUST_PROXY` | `1` | number of proxies in front of the API (`1` for the bundled nginx, `2` behind Cloudflare + nginx) | Rate limits key on the client address. Too high: clients can spoof it. Too low: everyone shares one bucket |
| `API_BIND` | `127.0.0.1` | leave it | The API port stays on loopback; only the proxy is public |
| `REQUIRE_EMAIL_VERIFICATION` | off | leave unset (**on** in production) | No session before the address is verified; see decision 2 below |
| `SENDGRID_API_KEY` or `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`, `EMAIL_FROM` | unset (mails are logged) | a working mail server (SendGrid is used through its SMTP relay; transient failures are retried) | Required once verification is on, or nobody can finish registering. Send a real test registration |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | `Admin@123` default | your address; 12+ random characters | The first super admin. Change the password after the first sign-in |
| `SEED_SAMPLE_DATA` | `true` for demos | unset / `false` | Demo users (`user1..6@example.com`) have passwords that are in the repository |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | test keys | **live** keys | `rzp_test_` keys move no money (preflight warns) |
| `RAZORPAY_WEBHOOK_SECRET` | any | the secret set on the Razorpay dashboard webhook for `https://<domain>/api/payments/webhook/razorpay` | Without it the webhook is refused and payments never complete |
| `GOOGLE_*`, `LINKEDIN_*` + `*_CALLBACK_URL` | localhost callbacks | `https://<domain>/api/auth/google/callback` (and `/linkedin/`), registered with the provider | Callbacks that point at localhost break sign-in. See "LinkedIn" in section 6 |
| `REDIS_URL` | unset | set (compose does it) | Rate limits are shared by every API process only with Redis, and the background jobs (notification broadcasts, the weekly digest) run only with it. Required before running more than one instance |
| `AWS_*`, `AWS_S3_BUCKET` | unset (local disk) | an S3 bucket, **or** a backed-up volume for `uploads_data` | Container disks are not durable storage |
| `GEOCODER_URL`, `GEOCODER_EMAIL`, `NEXT_PUBLIC_MAP_TILE_URL` | public OpenStreetMap | your own/paid provider, or at least `GEOCODER_EMAIL` | The public OSM servers have usage policies that real traffic will break |
| `DISABLE_RATE_LIMIT` | used by tests | **never set** | The guard refuses to start |
| `ALLOW_INSECURE_PRODUCTION_CONFIG` | unset | **never set** | A waiver for trying the production build on one machine; turns the public-internet checks into warnings |

### Trying the production build on one machine (no domain, no mail server)

```bash
# in .env, only for that trial
ALLOW_INSECURE_PRODUCTION_CONFIG=true
REQUIRE_EMAIL_VERIFICATION=false
```

Secrets and database-password checks still apply. Remove both lines for any real deployment.

## 3. Development-only things that must not ship

* `npm run db:local` (embedded PostgreSQL), `server/.local-pg`, `server/uploads` from a laptop.
* Demo/test accounts: `user1..6@example.com` (`User@123`), the seed admin default (`Admin@123`), any `@aiem.test`
  address. `preflight` finds them in the database and checks whether privileged accounts still use a published password.
* `server/.env` and any `.env` file in git (they are ignored; keep it that way).
* The old MySQL guides in the repository root (each now has a "superseded" banner) and `prisma/mysql-legacy/`.

## 4. Secrets and rotation

1. **Rotate the database password that was committed.** It was in `DEPLOYMENT_CHECKLIST.md` and
   `DEPLOYMENT_VERIFICATION.md` and is still in git history: treat it as public even though the files are cleaned.
   `POSTGRES_PASSWORD` only applies when the data volume is first created, so changing `.env` later does **not** change
   the database. Change it in the database, then in `.env`, then restart the API:
   ```bash
   docker compose exec postgres psql -U aiem -d aiem_connect -c "ALTER USER aiem WITH PASSWORD '<new password>';"
   # edit POSTGRES_PASSWORD in .env, then:
   docker compose up -d api
   ```
   If the old database host was ever reachable from the internet, also check its logs for unknown connections.
2. Keep secrets in `.env` on the server (mode `600`, not in git) or in a secret manager. Never in chat, tickets or screenshots.
3. Rotate `JWT_SECRET` / `JWT_REFRESH_SECRET` after any suspected leak, or when someone with access leaves (everybody signs in again).
4. Optionally purge the old password from git history (`git filter-repo --replace-text`); rotating is what protects you, purging only tidies up. Forks and clones keep their copy.

## 5. Infrastructure

* **TLS everywhere.** Terminate HTTPS in front of the bundled nginx (Caddy, a cloud load balancer, Cloudflare) or add a 443
  server block. The web app sends `Strict-Transport-Security` in production; make sure the TLS terminator does too.
* **Firewall:** only 80/443 public. PostgreSQL, Redis and the API port are bound to loopback by compose; do not publish them.
* **Proxy limits:** `nginx/nginx.conf` rate-limits `/api/auth/*` per address (5 requests/second, burst 20), merges repeated
  slashes, applies slow-client timeouts and hides dotfiles. Behind a CDN, restore the real client address first
  (`real_ip_header`, `set_real_ip_from`), otherwise every visitor shares one bucket. This file has not been run through
  `nginx -t` in this repository's CI: test it on the server before go-live.
* **Backups:** `backup-db.sh` (PostgreSQL, custom format, verified, 30-day retention, optional encrypted S3 upload). Schedule it
  (`0 2 * * * cd /srv/aiem && ./backup-db.sh`), copy dumps off the server, and **restore one to a scratch database** before go-live
  and after every schema change. Back up the uploads volume or use S3.
* **Monitoring:** alert on `GET /health` (database state; `redisStatus` is informational), on 5xx rate and on a spike of 401/429 on `/api/auth/*`.
  Every API response has an `X-Request-Id` and every request one access-log line (route pattern, status, duration, never the query string); set
  `LOG_LEVEL=warn` to keep only slow requests and errors. See [ROBUSTNESS.md](ROBUSTNESS.md).
  The audit log (`/api/admin/audit`) records security events (refresh-token reuse, role changes, deletions).
* **Orphaned uploads (monthly):** `npm run uploads:cleanup -w server` is a dry run (the default) that lists local upload files nothing refers to
  and that are older than 24 hours. Read the list, then run it again with `--delete`. Details and limits in
  [ROBUSTNESS.md](ROBUSTNESS.md#cleaning-up-orphaned-uploads). Not needed when files live in S3 (use a bucket lifecycle rule instead).
* **Logs** hold e-mail addresses and IPs: restrict access and set a retention period.
* **Updates:** run `npm audit` on every release; patch releases of Next.js, Express and Prisma are routine, not optional.

### Existing members when verification goes on

Accounts created before the switch that never verified their address can no longer sign in. Count them first:

```sql
SELECT count(*) FROM "User"
WHERE "isVerified" = false AND "emailVerifiedAt" IS NULL AND "passwordHash" <> '';
```

They can use **Resend verification email** on the sign-in page; the link in that e-mail then asks for the password they registered with. If
you personally know the accounts are genuine, mark them verified in one statement instead:
`UPDATE "User" SET "isVerified" = true, "emailVerifiedAt" = now() WHERE <your criteria>;`

## 6. Security decisions taken (and what they cost)

These were open questions in [SECURITY_AUDIT.md](SECURITY_AUDIT.md). Each was decided in favour of the safer option
that still behaves like a normal website. Revisit one only with the trigger given.

| # | Question | Decision | Cost / residual risk | Revisit when |
|---|---|---|---|---|
| 1 | Committed database password | Guard refuses it (and weak/placeholder ones); `npm run secrets` generates replacements; rotation steps in section 4 | You must still rotate it on the real server: no code can do that | Never: rotate |
| 2 | Verify e-mail before a session, and the "pre-hijack" hole | **Required in production** (`REQUIRE_EMAIL_VERIFICATION`). Login answers `403 EMAIL_NOT_VERIFIED` (only after the password is proven). The link only completes together with the **registration password**, so a link mailed to you for somebody else's registration can't be completed by you. Registering an address whose account is still unverified **replaces** that pending registration, so you are never locked out of your own address (only for accounts nobody has ever signed in to: a member who was already using an unverified account keeps it and verifies through "resend"). Resend is rate-limited (1 mail/minute/account) and answers identically for every address. Added the missing `/verify-email` page (the e-mail linked to a page that did not exist) | One extra field on the confirmation page. Needs working outbound e-mail. Existing unverified members need one step (section 5) | If sign-up conversion drops and you have bot protection in front |
| 3 | Tokens in `localStorage` | **Not changed yet. Gate for a public launch** (section 7). Compensating controls in place: 15-minute access tokens, refresh-token rotation with reuse detection, strict CSP, URL allowlists, output encoding, token-hygiene tests | Any XSS could read the tokens until the cookie migration is done | Before opening registration to the public |
| 4 | Login lockout / CAPTCHA | **No account lockout** (it would let anybody lock any alumnus out). Layers instead: nginx 5 req/s per address on `/api/auth/*`, 10 login attempts per 15 minutes per address in the API (shared through Redis), a per-account budget on password changes, account deletion, 2FA management and e-mail confirmation (not on sign-in itself, which is exactly what makes a lockout impossible), bcrypt for all passwords. Put Cloudflare Turnstile/hCaptcha or WAF rules in front if you see credential-stuffing | A distributed guessing run is slowed, not stopped. Registration still says "e-mail already registered" | Alerts show a spread of failures against one account |
| 5 | Rate limits per process | **Shared through Redis** when `REDIS_URL` is set (every limiter has its own key prefix). If Redis is down each process counts for itself instead of switching limits off | Needs Redis (compose includes it) | n/a |
| 6 | Google/LinkedIn sign-in | **Removed.** The registration form is the only way to get an account; an administrator approves it (decision 10). It also removed the OAuth second-factor and account-linking questions | Members who had used Google/LinkedIn set a password with "Forgot password" | n/a |
| 7 | Account deletion keeps some data | Unchanged and documented: sent messages, reactions and anonymised audit entries stay; the audit trail no longer keeps IP/user agent for deleted members | Stored files (photos) are not purged from storage | If your privacy policy promises full erasure |
| 8 | Long-lived access tokens | **15 minutes** in production (was 24 h). The client refreshes automatically and sockets reconnect with the new token | none visible | n/a |
| 9 | Next.js 14 advisories | **Gate for a public launch** (section 7) | See below | Before opening registration to the public |
| 10 | Who may use the platform | **An administrator approves every registration** after checking that the person is an alumnus of the college (`approvalStatus`, [AUTHENTICATION.md](AUTHENTICATION.md#alumni-approval)). No session by any route until then; approving is refused for an unverified address while e-mail verification is on | Somebody has to work the queue: an unattended queue means nobody new gets in, and registrations wait indefinitely. Applicants are told by e-mail, so a working mail server is part of the process | If you want members admitted automatically (for example by college e-mail domain), change `approvalStatus` handling in `authService.register` in one place |
| 11 | Anonymous access | **None except sign-in/registration, the landing page, its aggregate counts (`/users/stats`), the admin-built landing blocks, and the donation form (decision 12).** Events, news, gallery, chapters, jobs, search, profiles, posts, videos, magazine, requirements, marketplace, membership tiers and the donor wall all answer 401 to a visitor, and the pages redirect to sign-in | The public cannot see what the community does; shared post/event links open the sign-in page first | Re-open a section only by changing its route guard **and** `src/lib/public-paths.ts`; the RBAC matrix test fails until both agree |
| 12 | Donating without an account | **Open, as before.** Alumni donate as guests: `POST /donations/order` and `/donations/verify` work without a session (a missing, invalid, expired or not-approved token is simply treated as a guest), and `/donations` is the one page a visitor may open (the donation form only). The donor wall, leaderboard, chapter totals and stats stay members only | Anybody can start an order, so the per-endpoint rate limit (20 per 15 minutes) and the strict donor-address validation are what protect it; a donor's name and address are kept in the transaction record | Add CAPTCHA/WAF in front of `/api/donations/*` before a public launch (section 7) |
| 13 | How notifications are delivered | **Through Kafka** ([KAFKA.md](KAFKA.md)): in-app notifications, announcement broadcasts, the e-mail to the college administrator when a registration is waiting, and the e-mails to applicants. Failed events end in a dead-letter topic. Without `KAFKA_BROKERS` the same events are delivered in-process, and a broker outage falls back the same way, so nothing is lost | One more service to run (the compose file includes a single broker; a managed or 3-broker cluster is the production-grade setup). **Not exercised against a real broker in CI** | Before relying on it: register a test applicant on the server and check the administrator's inbox (section 9) |
| 14 | Receipt numbers after the rename | Receipts are numbered `AIEM-<DON\|MEM>-<date>-<id>` and the number is **derived** from the transaction, not stored. The earlier `AITD-` prefix was dropped with the rename of the product | A receipt issued before the rename and downloaded again shows the new number; anybody matching old receipts by number in accounts must map the prefix | If you must keep the old prefix for the old records, add a stored receipt number to `Transaction` and generate it once at payment time |

## 7. Must be finished before a public launch

These are not configuration; they are engineering work. Do not open registration to the general public before them.

1. **Upgrade Next.js 14 to 15.5.x or 16 (React 19).** `npm audit --omit=dev -w client` still reports a critical rollup for
   `next`. The remaining advisories are denial-of-service (server components, image optimizer), request smuggling through
   rewrites, cache poisoning, and XSS in CSP-nonce / `beforeInteractive` setups. None of those features is used here:
   the image optimizer is off, there are no Server Actions, there are no nonce-based scripts, and with the single-origin proxy
   nginx serves `/api` directly so Next's rewrite proxy is not in the request path. That lowers the risk; it does not remove it.
   Plan: branch, `npx @next/codemod@canary upgrade latest`, async `params`/`searchParams`/`cookies()` in every dynamic page,
   React 19-compatible versions of the UI libraries, then the full test suites, the build, and `verify:deploy`. The 950+ client
   tests and the contract suite are the safety net. Budget one to two days.
2. **Move tokens out of `localStorage` into httpOnly cookies with CSRF protection.** Design: access and refresh tokens as
   `Secure; HttpOnly; SameSite=Lax` cookies set by the API, a double-submit CSRF token on state-changing requests, the
   socket handshake reading the cookie, and `aiem_session` (the non-secret hint the edge gate uses) kept as is. Touches
   `auth-context`, `api.ts`, `use-socket` and the CORS/credentials settings; plan it as its own change with a staging soak.
3. **CAPTCHA or WAF in front of sign-up and sign-in** (decision 4), and a bot policy for registration.
4. **Centralised logs and alerts** (section 5), and a dependency/secret scan in CI.
5. **An independent penetration test** against the staging deployment. The two internal audit rounds
   ([SECURITY_AUDIT.md](SECURITY_AUDIT.md)) are not a substitute.

## 8. Still open (smaller)

* Text fields strip HTML tags, so `List<String>` loses its angle-bracket content. Encoding on output would fix it.
* Follow/unfollow and react/unreact loops can generate repeated notifications (only the global limit applies).
* `sharp` is declared in both `client/package.json` and `server/package.json`; the client probably does not need it.
* CSP still needs `'unsafe-inline'` for scripts and styles (Next.js nonce support arrives with the upgrade).

## 9. After deploying

**Check the notification path.** Register a test applicant with a real mailbox: the college administrator (every `ADMIN`/`SUPER_ADMIN` account, plus `APPROVAL_NOTIFY_EMAIL` if you set it) must receive "New registration to review" by SMTP and see the notice in the bell; approving must send the applicant "you can sign in". `GET /health` should say `kafkaStatus: up`; the dead-letter topic ([KAFKA.md](KAFKA.md)) should stay empty.

**Approve the first members.** Sign in as the seeded administrator, open *Admin > Approvals*, and decide who may join. Check
that the approval e-mail reaches a real mailbox before you tell members to register. Decide who works the queue (and how
quickly) before launch; the summary on that page and `GET /api/admin/approvals/summary` show how many are waiting.

```bash
npm run verify:deploy -w server -- --web https://alumni.example.edu
```

Then by hand: register a test member with a real mailbox and confirm the e-mail link works end to end; sign in as the admin
and change the seed password; place a ₹1 live donation and check the receipt and the webhook; sign in as a member with 2FA on; restore last night's backup into a scratch database.
