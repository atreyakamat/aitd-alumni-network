# Security audit and hardening log

> Round 3 (running stack, Docker and Kafka, supply chain) has its own plan and runbook: [SECURITY_AUDIT_PLAN.md](SECURITY_AUDIT_PLAN.md).

White-box audit of the AIEM Alumni Network (server, client, Docker/CI), run as: **audit → attack with tests →
root-cause → fix (test-first) → re-test**. Every confirmed finding is a regression test that asserts the *secure*
behaviour, so the suites below are the proof that a fix holds and the guard against it coming back.

| Suite | Where | Run |
|---|---|---|
| Authorization (IDOR, privilege, races, visibility, mass assignment, JWT) | `server/tests/security/authz/` | `npm run test:security -w server` |
| Input handling (sanitizer, URL schemes, email HTML, uploads, secrets) | `server/tests/security/input/` | same |
| Auth, 2FA, passwords, payments, realtime, invites, GDPR | `server/tests/security/auth/` | same |
| Round 2: variants and incomplete fixes (sanitizer ReDoS, counter and quota races, limiter and path bypasses, upload limits, mail addresses, account lifecycle) | `server/tests/security/round2/`, `client/src/__security__/round2/` | same |
| Client (safe links, headers, route gating, token hygiene) | `client/src/__security__/`, `client/src/**/__tests__` | `npm test -w client` |

Severity is the practical impact in this app: **Critical** = takeover or data theft by anyone, **High** = serious
abuse by a signed-in member or a latent takeover, **Medium** = integrity/availability issues, **Low** = hardening.

## Round 1 findings

> **Note (2026-11-09):** Google and LinkedIn sign-in were removed from the platform. Findings below that concern OAuth
> (the state cookie, account linking, the OAuth second factor, LinkedIn scopes, the callback URLs) describe a feature that no longer exists;
> they stay as the record of what was found and fixed.

### Authorization and integrity

| ID | Sev | Finding | Root cause | Fix | Status |
|---|---|---|---|---|---|
| AZ-03 | High | Posts created with `visibility: "CONNECTIONS"` were stored as **PUBLIC**; reels (`videoUrl`, `isReel`), thumbnails and `mentionIds` were silently dropped on create | `createPostSchema` listed 4 fields and zod strips unknown keys, so the safer request was discarded without an error | Schema lists every field the service supports; media/link fields validated; regression tests for the whole class | Fixed |
| AZ-01 | Medium | Event capacity could be exceeded (6 concurrent RSVPs on a 1-seat event all succeeded) | Capacity read, then RSVP written in a later transaction (check-then-act) | One row-locked conditional `UPDATE ... WHERE rsvpCount < capacity` inside the RSVP transaction; duplicate/double-cancel safe | Fixed |
| AZ-02 | Medium | Mentor `maxMentees` exceeded by concurrent accepts (6 accepts for 1 seat) | Same check-then-act on a stale snapshot | Request claimed by conditional update, seat taken by guarded `UPDATE`; rolls back if full | Fixed |
| AZ-04 | Low | One connection request could be accepted several times concurrently, repeating notifications | Status read before an unconditional update | Conditional `updateMany(status: PENDING)`; only the winner notifies | Fixed |

Verified correct (attacks that were blocked and are now regression tests): role escalation and hierarchy,
cross-user IDOR on posts/comments/messages/notifications/connections/mentorship/marketplace/transactions/receipts,
JWT `alg:none`/wrong secret/expired/refresh-as-access, token revocation on password change and deactivation,
role read from the database (not the token), mass assignment on register/profile/events/jobs/chapters, `__proto__`
keys, CONNECTIONS-post visibility on every secondary path, chapter-admin scope.

### Input handling

| ID | Sev | Finding | Root cause | Fix | Status |
|---|---|---|---|---|---|
| IN-01 | High | Stored XSS: `java<TAB>script:alert(1)` accepted as a job `applicationLink` / post `linkUrl` and rendered as a link | Blocklist regex needed a contiguous `javascript`; browsers and `new URL` ignore tabs/newlines in URLs; no scheme allowlist on most URL fields; client rendered `href` unchecked | Allowlist helper (`utils/safeUrl.ts`: absolute http(s) only, no control chars, no credentials; media = own `/uploads/...` or http(s)) on **every** URL write path (create *and* PATCH: posts, jobs, events, news, chapters, messages); sanitizer normalises control characters; client `safeHref`/`safeMediaSrc` on every rendered link and image | Fixed |
| IN-02 | High | `Hi <img src=x onerror=alert(1)` (no closing `>`) survived the sanitizer byte for byte | Tag regex required a closing bracket | Unclosed tags carrying attributes are stripped (ordinary text with `<` is untouched) | Fixed |
| IN-03 | High | HTML injection in verification, welcome and invite emails (name interpolated raw; also in the `Subject` header) | `escapeEmailHtml` applied to 1 of 4 templates | Every interpolated value escaped; subject sanitised (no CR/LF/angle brackets); tokens URL-encoded | Fixed |
| IN-04 | High (latent) | Signing secrets fell back to published defaults (`default-secret-change-me`) outside production, so a forged admin token verifies offline on any box missing `.env` | `process.env.X \|\| 'literal'` | No default: random per-process secret outside production (with a warning), hard failure in production | Fixed |
| IN-05 | Medium | A `.gif` containing HTML/script was stored as-is; photos kept EXIF/GPS (members' locations leak) | Image check compared two attacker-controlled strings; GIFs skipped re-encoding | Every image is decoded and re-encoded with the real format taken from the bytes: proves it is an image, strips metadata, kills polyglots, 40-megapixel cap against pixel floods | Fixed |
| IN-06 | Low | Sanitizer skipped any field whose name ended in `code`/`token`/`secret`... | Suffix regex | Explicit allowlist of credential fields | Fixed |
| IN-07 | Low | Disallowed CORS origin returned HTTP 500 | Plain `Error` thrown from the CORS callback | Clean 403 `FORBIDDEN_ORIGIN` | Fixed |

Verified correct: parameterised raw SQL in nearby search, Prisma operator injection via nested query objects, CSV
formula injection, path traversal on `/uploads` (plain, encoded, double-encoded), helmet headers on the API
(CSP, HSTS, nosniff, frame-ancestors), video magic-byte checks, cursor limits, malformed JSON handling.

### Broken endpoints (client/server contract sweep)

A contract suite (`npm run test:contract -w server`, 779 tests) now reads every call the client makes, checks it
against the router (method, path, order, schema field survival) and drives all 197 routes with valid, invalid and
fuzzed input. It found functional breakage, not just security gaps:

| ID | Sev | What members saw | Root cause | Status |
|---|---|---|---|---|
| QA-02 | High | **The directory search box did nothing** (everyone returned) | Controller read `name`; the client sends `search` | Fixed |
| QA-10 | High | **Directory and Yearbook always showed "No alumni found"**; **the Network page's Requests tab was always empty, so connection requests could not be accepted** | Pages read `data.items` / `requester` / `avatarUrl`; the API returns `{data, pagination}`, a flattened user and `profilePhotoUrl` | Fixed (typed adapters in `client/src/lib/people.ts`, tested) |
| QA-01 | Medium | Editing a comment silently dropped its @mentions | `updateCommentSchema` lacked `mentionIds` (same class as AZ-03) | Fixed |
| QA-04 | High (data) | `PATCH /chapters/:id {name: ''}` stored a blank chapter name; wrong types gave 500 | Whitelist loops copied raw values | Fixed |
| QA-03, 05–09 | Medium/Low | NUL bytes in any `:id` (77 routes), foreign-key errors, wrong-typed fields on gallery/news/events, non-string payment fields, array/object query params, malformed `%` escapes all answered **500** | No input guards; no mapping for Prisma `P2003`/`P2000`; Express 4xx statuses ignored | Fixed: clean 400s (`INVALID_PATH`, `INVALID_REFERENCE`, ...) |
| QA-11 | Low | "You:" prefix never showed on sent messages | Client read a field the API does not send | Fixed |

### Authentication, payments, realtime, account lifecycle

| ID | Sev | Finding | Fix | Status |
|---|---|---|---|---|
| AU-01 | High | **Account pre-hijacking:** login does not need a verified e-mail, so an attacker could register a victim's address with their own password; when the victim later signed in with Google/LinkedIn the provider was linked to that row and the attacker's password and sessions survived | Linking to an account whose e-mail was never verified now marks it verified, **clears the password hash, bumps `tokenVersion`, deletes refresh/verification tokens and disconnects sockets** | Fixed |
| AU-05 | Medium | 2FA code attempt limit was count-then-check, so a burst of 40 parallel guesses was all evaluated | The attempt is reserved (a row is written) *before* the code is compared: at most 5 guesses are ever evaluated | Fixed |
| AU-03 | Medium | An invalid checkout signature marked any non-successful donation/membership as FAILED; a refunded payment could be re-completed by replaying its original valid signature | Only a PENDING transaction can be failed; refunded ones answer 400 / 409 | Fixed |
| AU-04 | Medium | `POST /auth/2fa/disable` needed only a bearer token: a stolen access token could remove the second factor | Account password required (400 `PASSWORD_REQUIRED` / 401 `INVALID_PASSWORD`) | Fixed |
| AU-12 | Medium | Re-entering the password (change password, delete account, disable 2FA) was throttled per IP only | Shared per-account budget: 5 wrong guesses per 15 minutes, then 429 even for the right password | Fixed |
| AU-02 | Medium | Google/LinkedIn OAuth sent no `state`: login CSRF (victim's browser signed into the attacker's account) | Random per-flow `state`, pinned in an HttpOnly SameSite cookie, compared in constant time, single-use | Fixed |
| AU-07 | Medium | Blocked users could still message; unlimited message requests to strangers | Block honoured in both directions (403); 20 new message requests per day | Fixed |
| AU-09 | Medium | Invite endpoints were a spam relay from the platform's sender address (no quota, no length caps) | 100 invites/day, name and message length caps, bulk refused up front if over quota | Fixed |
| AU-08 | Low | Typing events went to any user id; unlimited room joins | Relayed only between non-blocked, connected users; 20 events / 10 s per socket; max 50 rooms | Fixed |
| AU-06 | Low | bcrypt silently ignores bytes past 72; no common-password check; unbounded login attempt length | Reject over 72 bytes; breached-password and "password equals e-mail" checks; 1,024-character cap on attempts | Fixed |
| AU-10 / AU-11 | Low | Account deletion left follows, saved posts, sent invites (third-party e-mails); data export lacked them and included a gateway signature | Deleted in the same transaction; export completed, signature stripped | Fixed |
| SR-01 | **High** | **Search ignored post visibility:** CONNECTIONS-only posts were findable by anyone | Post search uses the same visibility rules as the feed; regression test on real Postgres | Fixed |
| SR-02 | Medium | Search required an account but expired tokens silently fell back to anonymous elsewhere | New `authenticateIfPresent`: no header = visitor, but a presented token must be valid (401 so the client refreshes) | Fixed |
| OP-04 | Medium | No limits on guest donation orders, invites, 2FA, uploads, search beyond one global budget | Per-endpoint budgets (20 / 30 / 10 / 30 / 100 per 15 min) | Fixed |
| OP-05 | Medium | Rate limits trusted `X-Forwarded-For` blindly (`trust proxy` hard-coded to 1) and the Docker API port was public: limits dodged by rotating a header | `TRUST_PROXY` setting (0, N hops, or subnets; refuses `true`/`*`); API container bound to `127.0.0.1` by default | Fixed |
| OP-06 | Medium | Donation receipts (donor name and amount) were publicly fetchable under `/uploads/receipts/` (and `public-read` on S3) | Not served statically (404 in any spelling); private ACL in S3; the authenticated endpoint is the only way | Fixed |
| OP-07 | High | The Next.js image optimizer was an **open proxy** (`remotePatterns: **`) and a large share of Next's CVE surface | Optimizer disabled (uploads are already re-encoded and capped by the API) | Fixed |

Verified correct: constant-time login (dummy hash for unknown e-mails), pinned JWT algorithm and separate secrets per
token type, hashed/rotating/family-revoked refresh tokens, 256-bit single-use hashed verification and reset tokens,
OTP via `crypto.randomInt`, server-side payment amounts, HMAC webhook over the raw body with `timingSafeEqual`, order
ownership, receipt access control, socket handshake and room authorization, escaped invite HTML.

### Web app (client)

| ID | Sev | Finding | Fix | Status |
|---|---|---|---|---|
| CL-01 | Medium | **Member pages were served to anyone** (HTTP 200 shell and JS chunks for `/dashboard` etc.); the only guard was a client-side redirect after load | `middleware.ts` redirects anonymous requests for any member-only path (fail-closed: everything not explicitly public, all of `/admin/**`) to `/login?next=`; a test scans the app directory so a new page cannot be forgotten; admin pages additionally render nothing for non-admins. *The API remains the authority; the session cookie is a non-secret hint.* | Fixed |
| CL-02 | Medium | No CSP, `X-Frame-Options`, `Referrer-Policy` or `Permissions-Policy` on the web app (clickjacking, no XSS backstop) | Headers in `next.config.js` (CSP derived from env, frame-ancestors none, nosniff, referrer policy, permissions policy, HSTS in production); OAuth hand-off page gets `no-referrer` and strips its one-time code from the URL immediately | Fixed |
| CL-03 | Low | Landing page linked anonymous visitors straight to members-only pages | Links now go through explicit sign-in with a "Members" label | Fixed |
| CL-04 | Low | Left-side "Shortcuts" duplicated the header navigation | Removed; two-column feed layout | Fixed |
| CL-05 | Medium | Access and refresh tokens live in `localStorage` (readable by any XSS) | Mitigated: strict CSP, URL allowlists, output encoding, token-hygiene guard test. **Open (design change):** move to httpOnly cookies with CSRF protection | Mitigated |

### Supply chain and operations

| ID | Sev | Finding | Status |
|---|---|---|---|
| OP-01 | High | **A production database password was committed** in `DEPLOYMENT_CHECKLIST.md` / `DEPLOYMENT_VERIFICATION.md` (visible in git history) | Removed from files; **you must rotate that password and treat the old one as public** |
| OP-02 | High | 28 known dependency vulnerabilities in each of server and client, including reachable ones: `sharp`/libvips (every image decode), `socket.io`/`engine.io`/`ws` DoS, `body-parser` DoS, `proxy-addr` IP spoofing, `nodemailer`, `axios`, and **Next.js 14.2.10, which had a critical middleware authorization bypass** | **Server 28 → 10, none critical** (what remains is lint tooling that never ships, plus `zod`, mitigated by array/body bounds). Upgraded `next` → 14.2.35 (closes the middleware bypass and the 14.x DoS/SSRF issues), `sharp` → 0.35.5, `nodemailer` → 10.4, plus every non-breaking transitive fix. **Open:** newer Next advisories need the major upgrade to 15.5.x/16 (see below) |
| OP-03 | Info | No secrets matching common key formats in tracked files | Verified |

## Needs a decision or a planned change

> **Update 2026-11-08: decided and, where possible, done.** The product owner delegated these decisions; each was taken in
> favour of the safer option that still behaves like a normal website. The outcome of each item is marked **[DONE]**,
> **[GATE]** (engineering work that must finish before a public launch) or **[KEPT]**. The full reasoning, costs and revisit
> triggers are in [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md#6-security-decisions-taken-and-what-they-cost).

1. **[GATE]** **Upgrade Next.js 14 → 15.5.x or 16** (React 19, App Router changes). The remaining critical/high advisories on the client are fixed only there. Interim mitigations already in place: image optimizer off, no Server Actions in the app, strict CSP, the API (not Next) holds all data and authorization. Plan this as its own change with a staging soak.
2. **[GATE]** **Move tokens out of `localStorage`** into httpOnly cookies with CSRF protection (CL-05). Today any XSS could read them; the CSP, URL allowlists and output encoding are the compensating controls.
3. **[DONE]** **Rate limiter store:** shared through Redis when `REDIS_URL` is set (`utils/redisRateLimitStore.ts`, tested with two app instances; falls back to per-process counting if Redis is down). limits are per process and the PM2 config runs one process per CPU, so effective limits are multiplied by the core count. Use a Redis store (the stack already runs Redis).
4. **[DONE, no lockout]** **Login lockout / enumeration:** decided against an account lockout (it would let anyone lock out any alumnus); layered limits instead: nginx 5 req/s per address on `/api/auth/*`, 10 sign-in attempts per 15 minutes per address (shared through Redis), per-account budgets on every other password check. CAPTCHA/WAF is a go-live item. Original note: no per-account throttle on login (a hard lockout would let anyone lock out any alumnus); registration answers "e-mail exists". Options: CAPTCHA or progressive delay; generic message plus an e-mailed notice. Both change user experience, so this is your call.
5. **[DONE]** **E-mail verification policy:** required in production (`REQUIRE_EMAIL_VERIFICATION`), the link needs the registration password, an unverified registration is replaced by the next one for that address, resend is rate-limited and enumeration-free; also fixes the missing `/verify-email` page. Original note: login works before the e-mail is verified (AU-01 closes the takeover this enabled). Decide whether to require verification for a session.
6. **[DONE]** **OAuth bypassed the app's e-mail OTP** for accounts with 2FA on. Now fixed: the exchange returns the same 2FA challenge as a password sign-in.
7. **[KEPT]** **Account deletion keeps** messages sent, reactions, chapter/event memberships and anonymised audit entries; stored files (photos) are not purged from storage.
8. **[DONE]** **Smaller items:** access tokens now last 15 minutes in production (were 24 h), which bounds the two items that remain true: single-device logout does not revoke the access token, and open sockets outlive token expiry. Also still open: `getConversations` loads all messages into memory; the password schema allows 128 characters while bcrypt uses 72 bytes (the service rejects the excess with a clear code).

### Decisions implemented (after round 1, before round 2)

| Item | Change | Where | Tests |
|---|---|---|---|
| E-mail verification before a session | `login` answers `403 EMAIL_NOT_VERIFIED` once the password is proven; OAuth accounts (`emailVerifiedAt`) pass | `authService.login`, `config.auth.requireEmailVerification` | `authService.verification.test.ts`, `email-verification.sec.test.ts` |
| Pre-hijacking through the verify link | the link needs the registration password (`PASSWORD_REQUIRED`, `VERIFY_PASSWORD_INVALID`, counted by the per-account budget); a registration over an unverified account that was never signed in to replaces it (old password, sessions and links die); an unverified account that has been used is never replaced, so a stranger cannot lock out a member who predates the policy | `authService.verifyEmail`, `register` | same, incl. the legacy-member case against the real database |
| Missing verification page | `/verify-email` (the e-mail linked to a page that did not exist), resend flow, login notice, open in the edge gate | `client/src/app/(auth)/verify-email`, `login/page.tsx`, `public-paths.ts` | `verify-email.test.tsx`, `login-verification.test.tsx`, `route-access.test.ts` |
| Resend verification | `POST /auth/resend-verification`: identical answer for every address, one mail per account per minute, limited per address | `authService.resendVerification`, `app.ts` | unit + security + RBAC matrix + contract |
| OAuth skipped 2FA | exchange returns the 2FA challenge (and the e-mailed code) for members with 2FA on; the login page handles the challenge | `authService.exchangeOAuthCode`, `authController` | unit + security + `login-verification.test.tsx` |
| Shared rate limits | Redis-backed store, one key prefix per limiter, per-process fallback | `utils/redisRateLimitStore.ts`, `app.ts` | `redisRateLimitStore.test.ts`, `tests/app/rateLimitRedis.test.ts` |
| Short access tokens | `15m` default in production | `config/index.ts` | `configDefaults.test.ts` |
| Unsafe production configuration | the API refuses to start (weak/leaked secrets, empty or default DB password, rate limiting off, http/localhost origins, no mail server while verification is required, sample data on) | `config/productionChecks.ts`, `index.ts` | `productionChecks.test.ts` |
| Defaults left in the database | `npm run preflight` finds demo accounts, privileged accounts with published passwords and a missing super admin | `config/databaseChecks.ts`, `scripts/preflight.ts` | `databaseChecks.test.ts` |
| Backups | `backup-db.sh` was still the MySQL script with a hardcoded host address; now PostgreSQL, atomic, verified | `backup-db.sh` | run against PostgreSQL (success and failure paths) |
| Proxy | request-rate limit on `/api/auth/*`, slow-client timeouts, no dotfiles | `nginx/nginx.conf` | not run through `nginx -t` here (no nginx/Docker on the development machine) |
| Post-deploy check | `npm run verify:deploy`: read-only checks of headers, gating, CORS, receipts, rate-limit headers | `scripts/verify-deployment.mjs` | run against the local stack |

Round 2 re-ran every suite above against the fixed code, then looked for *incomplete fixes*: variants of each payload
(other control characters, encodings, other fields and routes that take the same input), other places with the same
root cause (every schema vs. service field mismatch; every check-then-act capacity), and the new surface the fixes
add (middleware gating, public search, proxy settings).

**Verdict:** the round 1 fixes held for every payload class they targeted, but 27 further defects turned up, most of
them *in or next to the round 1 fixes themselves*. Two were High. The pattern is worth remembering: a fix that adds a
new regex, a new limiter or a new matcher adds new attack surface, and each of those three was bypassed or abused.

### What round 2 found and fixed

| ID | Sev | Where | Variant / payload | Impact | Fix |
|---|---|---|---|---|---|
| R2-01 | **High** | `sanitizeInput.ts`, `app.ts` body limit | `'<script '` x 60,000 took 25 s; `'<img <b>' + '='.repeat(32000) + '>'` took 2 s (round 1's new unclosed-tag regex) | `sanitizeInput` runs on every request before auth, so one anonymous request could block the event loop (ReDoS). A 10 MB body: hours | Block elements are stripped by a linear scanner; the unclosed-tag rule matches a run once and decides in a callback; JSON/urlencoded body limit 10 MB to 1 MB. Adversarial 10 MB strings now sanitise in at most 350 ms |
| R2-02 | Medium | `sanitizeInput.ts` | `JavaScript Developer` became `Developer`; `VBScript to Python` became `to Python` (the colon was optional) | Job titles and posts starting with those words were silently cut | The `:` is part of the scheme; stacked schemes are stripped in a capped loop (a repeated regex group overflowed V8's stack on a megabyte of `javascript:`) |
| R2-03 | Low | `sanitizeInput.ts` | `<div onmouseover=alert(1)`, `<x/onclick=`: the unclosed-tag allow-list knew only 36 element names | Event handler survived storage (inert today: React and e-mails escape output) | An `on*=` attribute is stripped on any element; `a<b and c=d` is untouched |
| R2-04 | Low | `sanitizeInput.ts` | `<scr<b></b>ipt>alert(1)</scr<b></b>ipt>` stored as `<script>`; `on<b></b>error=` reassembled | Single-pass stripping rebuilt the tags it had just removed | Stripping repeats until stable (8 passes); if still nested, any `<` before a letter is dropped |
| R2-05 | Medium | `messageService.ts` | 30 parallel message requests to 30 strangers: all 30 stored (cap 20); 6 parallel to one stranger: 6 pending requests | Message-request cap and one-pending rule were check-then-act | Per-sender advisory lock around count, check and insert |
| R2-06 | Medium | `inviteService.ts` | 3 parallel bulk invites of 50: 102 created (cap 100); 8 parallel invites to one address: 8 rows and 8 e-mails | Daily quota and the 7-day "already invited" rule were not atomic; the platform could be made to mail-bomb one address | Per-inviter advisory lock; bulk reports leftover rows as failed if the quota runs out meanwhile |
| R2-07 | Medium | `inviteService.ts` | `a@b.com,c.d`, `Victim<v@x.com>.a`, `a(x)@b.com`, `evil@x.com;bcc.d` passed `EMAIL_RE` | nodemailer read them as two recipients or as `v@x.com`; the "already registered/invited" checks looked at the odd string and were bypassed | WHATWG e-mail grammar (ASCII); `acceptInvite` no longer treats `null === null` as an e-mail match |
| R2-08 | Medium | `socialShared.ts` (`lockPostRow`, `lockCommentRow`), reaction/post/repost services | 8 users react at once: `likeCount` = 1. Same for `commentCount`, `repostCount`, comment `likeCount` | Counters recounted in a READ COMMITTED transaction overwrite each other; visible numbers and feed ranking were wrong | `FOR UPDATE` on the post/comment row as the first statement of each such transaction (taking it after the insert deadlocks) |
| R2-09 | Low | `networkService.ts` | A to B and B to A at the same moment created two PENDING rows (unique index is on the ordered pair) | Duplicate connection requests | Advisory lock on the unordered pair |
| R2-10 | Low | `membershipService.ts` | 3 different paid orders completing at once left 3 ACTIVE memberships | Supersede-then-insert race | `User` row `FOR UPDATE` first in the transaction |
| R2-11 | Low | `utils/helpers.ts` (`ilike`) | `q=%%`, `__`, `%_%` matched every row; `snake_case` matched `snakeXcase` | Prisma `contains` does not escape LIKE wildcards (raw SQL in `userService` already did) | `escapeLikePattern` applied in `ilike` |
| R2-12 | Medium | `marketplaceService.ts`, `validators.ts` | Marketplace `website`: `https://paypal.com@evil.example/login`, control characters, 2 KB URLs | The only URL field not using `safeUrl` | Service and schema use `isSafeHttpUrl` |
| R2-13 | Medium | `routes/index.ts` (5 upload routes) | Gallery caption sent as a multipart field stored raw (`<script>`, `<img onerror>`); a NUL byte gave a 500 and orphaned the photo | Multer parses text fields after the global `sanitizeInput` ran | `sanitizeInput` re-run after multer on all 5 upload routes |
| R2-14 | **High** | `app.ts` | After the login limit (10 per 15 min) was spent, `POST /api//auth/login` still reached the handler | `app.use('/api', router)` also matches `/api//...`, but per-endpoint limiters are mounted on exact paths. Login, register, forgot/reset password, verify-2fa, donations/order, invites, uploads and search budgets were all bypassable (ran at the general 300 per 15 min) | `//` collapsed in `req.url` and `req.originalUrl` before anything else |
| R2-15 | Medium | `app.ts` (`isReceiptsPath`) | `/uploads/x/../receipts/<file>`, `/uploads/x/%2e%2e/receipts/<file>`; on Windows `/uploads/%5Creceipts%5C<file>` | OP-06's block only checked the first segment but the static handler normalises `..` afterwards (file names are unguessable UUIDs, so a known URL was needed) | Normalise like `send` does (decode, `\` to `/`, `posix.normalize`), then deny any segment equal to `receipts` (ignoring case, trailing dots/spaces, `:stream`). 22 spellings tested |
| R2-16 | Medium | `app.ts` | `/api/payments/webhook/` is exempt from every limiter, unauthenticated until the HMAC is checked, and accepted 10 MB bodies that were parsed and sanitised | An unlimited large-body channel | Own budget (1,500 per 15 min per IP) and a 256 KB body limit |
| R2-17 | Medium | `utils/storage.ts` | Multipart bodies with 300 text fields or one 200 KB field were accepted | Any member could pin memory (multer buffers every text field) | `MULTIPART_TEXT_LIMITS = { fields: 10, fieldSize: 16 KB, parts: 30 }` on both uploaders |
| R2-18 | Low | `privacyService.ts` | After "delete my account" the audit log still held the IP and user agent | Round 1 called these entries "anonymised"; they were not | IP and user agent nulled on earlier entries; the DELETE entry carries no request metadata |
| R2-19 | Low | `privacyService.ts` | Data export omitted reactions, comment reactions, reports filed, gallery uploads, events created and the member's audit entries | Incomplete GDPR export | Added as new keys (existing keys unchanged) |
| R2-20 | Low | `config/passport.ts` | Google/LinkedIn `displayName` of `<img src=x onerror=...>Mallory` (or 5,000 chars) stored as `fullName`; provider photo URL unchecked | OAuth data never passes the request sanitiser | `sanitizeValue` plus a 100-character cap; photo must pass `isSafeHttpUrl` |
| R2-21 | Low | `utils/trustProxy.ts` | `TRUST_PROXY=0.0.0.0/00`, `::0/0`, `0.0.0.0/1,128.0.0.0/1` (trust-everything ranges) passed round 1's guard | Operator-config footgun that re-enables `X-Forwarded-For` spoofing of every limit | Prefix must be at least /8 (IPv4) or /7 (IPv6) and within the family maximum |
| R2-22 | Medium | `client/src/middleware.ts` | `/profile/x.png`, `/jobs/42.xml`, `/admin/users/x.png`: the matcher skipped any path ending in a file extension | Dynamic member pages accept any last segment, so the CL-01 gate was bypassed (anonymous visitors got the app shell) | Skip only root-level files plus `/.well-known/`, `/_next/`, `api/`; verified by compiling the matcher with Next's own `path-to-regexp` |
| R2-23 | Low | `client/src/lib/public-paths.ts` (`getSafeNextPath`) | `?next=/.//evil.example/x`, `/a/..//evil.example`, `/%2e//evil.example` accepted | The URL parser collapses dot segments into `//evil.example`, which `router.push` hands to `pushState` as a cross-origin URL (it throws and breaks post-login navigation rather than redirecting off-site) | Resolve against a dummy origin; reject if the origin changes or the path starts with `//` |
| R2-24 | Low | `client/src/lib/safe-url.ts` | `safeMediaSrc('/uploads/%2e%2e/api/auth/me')`, `safeInternalPath('/.//evil.example')` allowed | Encoded dot segments reach arbitrary same-origin GETs via `<img>` | Same URL-resolution check; `%2e`, `%2f`, `%5c` rejected in media paths |
| R2-25 | Low | `client/src/app/(main)/profile/[id]/page.tsx` | Server-side `fetch(`${API}/users/${id}`)` with the decoded segment: `..%2F..%2Fadmin%2Fexport`, `x?role=ADMIN` | Path/query injection on the API origin (anonymous call, so only public endpoints reachable) | `encodeURIComponent(id)` |
| R2-26 | Low | `server/src/utils/safeUrl.ts` | `http://good.com\@evil.com`, `https://good.com/a\b` accepted | WHATWG parsers read `\` as `/`, others do not: a parser-confusion URL | Backslash rejected anywhere in an http(s) URL |
| R2-27 | Medium | `app.ts` (slash collapse, found while re-verifying R2-14) | Absolute-form request target: `POST http://host/api//auth/login HTTP/1.1` after the login budget was spent returned 401 (handler reached) instead of 429 | Node passes an absolute-form target to Express unchanged, so `req.url` does not start with `/` and R2-14's collapse skipped it: the same limiter bypass, one request-line spelling later | The `scheme://authority` prefix is kept as is and only the path behind it is collapsed. (Removing the prefix instead breaks Express: the router measures it once and slices `req.url` by that length, so every mounted path 404s.) Test: `request-target.sec.test.ts`, which talks to a real listener over a raw socket because supertest cannot send this request line |

Every row has a regression test (`server/tests/security/round2/*.sec.test.ts`, `client/src/__security__/round2/`).
The tests for the defect classes (connection race, bulk invites, same-address invites and the other race/limit tests)
were confirmed to **fail without their fix**. The single-invite burst test passes even with the lock removed
(supertest does not make those requests truly concurrent); it stays as regression coverage.

### Round 1 fixes that held up when re-attacked

* **URL writes:** all 17 hostile link values and 23 media values were refused on create and update of events, jobs,
  news, chapters, gallery covers and photos, posts, messages and profile links (fullwidth and percent-encoded schemes,
  HTML entities, BOM, control characters, `https:\\evil`, userinfo, 2,049-character URLs, mixed-case `/UPLOADS/`).
  Notification links are built from `clientLinks` with encoded ids.
* **Sanitizer:** query and params handling, `[x](javascript:...)` text and `&#x6A;` entities (the client never renders
  markdown or raw HTML, so they are inert). The NUL-path guard returns 400; unicode, emoji and encoded slugs still
  get a clean 404. Socket handlers only relay ids.
* **Races:** exactly one winner under a `Promise.all` burst for e-mail verification, password reset, refresh-token
  rotation (the family is not revoked on a lost race), 2FA code, direct invite accept and a shared invite link used by
  several members, the double webhook plus verify path, the refunded-then-replayed webhook, the amount-mismatch
  webhook and a single membership order. Chapter join/leave, follows, post views and the view counters were already atomic.
* **Public search and limits:** visitors only see public events, published news and active chapters (draft,
  cancelled, past, members-only and inactive items are all hidden). Members never see unverified or deactivated
  people, hidden posts or non-approved jobs. Expired, forged, `alg:none`, ghost-user, deactivated and revoked tokens
  all give 401 and never fall back quietly to the visitor view. Limiters cannot be dodged by case, trailing slash,
  query string, `%6f`, `%2f`, `;x=1`, `/./`, `/../`, `%00` or method-override headers (the doubled slash in R2-14 was
  the one gap). Rotating `X-Forwarded-For` does not help when `TRUST_PROXY=0`. Static `/uploads` serves no dotfiles
  or directory indexes.
* **Auth:** the password-attempt budget is per authenticated account and 2FA guesses do not spend it; the 72-byte
  boundary holds; OAuth e-mail matching is case-insensitive but never merges across plus-tags or dots; unverified
  provider e-mails are refused; a deactivated account's exchange code is refused and a code works once. A schema scan
  forces a decision for every model that references a user on account deletion.
* **Client:** hostile search data (`javascript:` slugs, `../`, avatar URLs) creates no script-capable link or image;
  a stale search cannot overwrite a newer one; every other spelling of a member path is redirected (uppercase, `//`,
  `..`, `%2e%2e`, backslash, `;`); a malformed hint cookie does not open the gate. The CSP has no `*` and no extra origins.
* **E-mail:** registration, forgot-password and guest-donation addresses are strict (58 injection cases refused).
  Only the invite validator was loose (R2-07).

### Open items round 2 did not change

| Item | Why it is open |
|---|---|
| **Pre-hijack via the verify-email link:** an attacker registers the victim's address with their own password; if the victim clicks the verification mail, the account becomes verified and the attacker's password and sessions survive | AU-01 only covers OAuth linking. Closing it means requiring verification before a session (decision 5 above) |
| Notification spam: follow/unfollow and react/unreact loops notify each time `isNew` is true | Only the global rate limit applies; a per-pair notification cooldown is a product decision |
| Tag stripping removes content such as `List<String>` or `if (a<b && c>d)` in any text field | Round 1 design (strip rather than encode); encoding on output would fix it but touches every renderer |
| 56 `api.*` calls in `client/src/lib/api.ts` interpolate ids without `encodeURIComponent` | Each mutating call appends a fixed suffix (`/follow`, `/rsvp`), so no escalation found; worth a lint rule |
| Password policy: about 50 deny-listed entries, no NFKC normalisation | Policy decision |
| `userAddPhoto` stores the file before validating the caption | A late validation failure leaves an orphan file |
| CSP: `script-src 'unsafe-inline'` and `img-src https:` remain; `media-src` blocks external video URLs even though the server allows them | Needs nonce support (part of the Next upgrade) |
| LinkedIn OAuth scopes (`openid profile email`) look incompatible with `passport-linkedin-oauth2` v2, which only reads e-mail with `r_emailaddress` | Could not be tested live |
| `sharp` is listed in both `client/package.json` and `server/package.json` | The client sets `images.unoptimized: true`, so it probably does not need it |

### Behaviour changes to be aware of

* JSON and urlencoded request bodies are capped at **1 MB** (was 10 MB). Uploads are unaffected.
* Upload routes accept at most **10 text fields** (16 KB each).
* `/api//...` now routes as `/api/...`.
* The payments webhook accepts at most 256 KB.

## Review of the code merged from `main` (2026-11-08)

`main` gained about 8,000 lines (college videos, magazine, requirements, referrals, digest, landing page builder, home/work
locations, background jobs) while this branch was in review. After the merge conflicts were resolved, the new code was reviewed
against the bug classes found in rounds 1 and 2, and the contract suite was extended to drive all 39 new routes with valid, invalid and
fuzzed input.

| ID | Sev | Where | Finding | Fix |
|---|---|---|---|---|
| M-01 | **High** | `collegeVideoService` | A member could submit **any** file under `/uploads` (another member's profile photo, a public post image) as their video or thumbnail, then delete their own record: the delete also deleted the file from storage. One member could remove another's uploads | A stored-file reference must be a file the matching upload endpoint wrote, in exactly that folder (`utils/uploadRefs.ts`); two videos cannot share a file (409); delete skips files another record still uses. Same rule for magazines |
| M-02 | Medium | `privacyService` | Account deletion cleared the map pin but left the new **precise home and work coordinates** and work city on the "deleted" account | Cleared on deletion; included in the data export |
| M-03 | Medium | `privacyService` | Deletion and export ignored the new user-linked tables (referral asks, offers to help, video submissions); the schema scan flagged all five models | Referral asks (both directions), offers and unpublished video submissions are removed; a video the college published stays, like a post; requirements and magazine issues are admin content and stay; all are exported |
| M-04 | Medium | new upload routes | The five new upload endpoints had no multipart text-field limits (the PDF uploader), no sanitising after multer, and no share of the upload rate budget | Limits, sanitising and budget added to all of them |
| M-05 | Medium | videos, magazine, referrals | A number, boolean, array or object where text was expected reached Prisma and answered **HTTP 500** (`PATCH /videos/:id`, `PATCH /magazine/:id`, `POST /referrals`) | Typed, bounded validation (`optionalBoundedText`, `optionalBoolean`, `idText`); found by the contract suite's wrong-type fuzz |
| M-06 | Low | `referralService` | The unique index cannot stop repeat asks when there is no job (NULLs never collide), and the pending-ask cap was check-then-act | Repeat check by company when no job; both done under a per-member advisory lock |
| M-07 | Low | `digestService` | Digest settings stored `sections` unvalidated (a string was spread into one key per character; the fuzz stored a 12,000-key object) | Only the known sections, each a real boolean |
| M-08 | Low | `landingService`, `LandingBlockView` | Landing block links and image URLs were free-form and rendered for every visitor | Validated when stored (site path or http(s) link; uploaded or http(s) image) and again when rendered |
| M-09 | High (functional) | `client/src/lib/videos.ts`, `engagement.ts` | The server answers lists as `{ data: [...], pagination }`; the client read `.items`, so the **Videos, Magazine, Requirements and Referrals pages (and their admin versions) always showed empty lists** | The six list calls go through `readPaginated`; a test uses the exact server shape |
| M-10 | Info | merge | Main fixed the same event-capacity and mentorship races independently; the merged version keeps main's single transaction and adds the double-submit and double-cancel handling. The sanitised e-mail templates keep main's AIEM branding with the escaping | Covered by the existing race tests plus `concurrency.int.test.ts` from main |

Also removed in this merge, at the product owner's request: **Reels** (the page, viewer and `/reels` feed were already gone on `main`;
the `isReel` flag, its database column and the `?reels=` filter went now). Posts that were reels remain as ordinary video posts.

## Private platform and alumni approval (2026-11-08)

Decision by the product owner: nothing is public, and an administrator verifies that each new member is an alumnus of the college
before they are admitted. The change was built test-first; the findings below are what writing those tests turned up.

| ID | Sev | Where | Finding | Fix |
|---|---|---|---|---|
| P-01 | **High** | API surface | 42 routes answered visitors: events, news, gallery, chapters, jobs, search, profiles by id, posts and comments, hashtags, videos, the magazine, requirements, the marketplace, membership tiers and the donor wall (names of donors). The new college pages were *members only in the UI but open on the API* | All 42 now need an approved member; the RBAC matrix, the contract smoke table, the generated API reference and `verify:deploy` assert it. Left open on purpose: sign-in routes, `GET /landing`, `GET /users/stats` (aggregate counts), the invitation check, the payment webhook |
| P-02 | **High** | `getProfile` | The profile endpoint spreads the whole user row and then deletes a list of owner-only fields, so the new columns (enrolment number, the applicant's note, the reviewer's notes) **would have been shown to every member** viewing a profile (and so would `tokenVersion`) | The new fields are on the owner-only list; `tokenVersion` is never exposed; a test sets all of them on a profile and checks none is returned |
| P-03 | Medium | registration | Nothing separated "has an account" from "is an alumnus": any registration became a member | `approvalStatus` (default `PENDING`). One helper (`utils/approval.ts`) gates `issueSession`, login, the 2FA step, token refresh, `authenticate`, `optionalAuth` and the socket handshake, and **fails closed** (a row without a status is not approved). A rejection of somebody who is signed in takes effect on their next request |
| P-04 | Medium | `verifyEmail` | Verifying the e-mail set `isVerified`, the flag the directory, search and digests use for visibility, so the moment an applicant clicked the link they became visible | Verifying proves the mailbox only (`emailVerifiedAt`); `isVerified` is set together with approval |
| P-05 | Medium | review queue | Two administrators could act on one registration at the same moment (double mail, double audit entry); an unverified address could be approved | Conditional update (`approvalStatus != APPROVED` / `= PENDING`), 409 for the loser and no mail; approval refused with `EMAIL_NOT_VERIFIED` while verification is required |
| P-06 | Low | lookups by id | A member holding the id of an unapproved registration could message it, send a connection request, follow it, ask it for a referral or open its profile | The lookups ask for `approvalStatus: APPROVED` (an unapproved id looks like a missing one) |
| P-07 | Low | data protection | The applicant's enrolment number and note, and the reviewer's notes, are personal data | Included in the member's data export, wiped by account deletion, never in a profile or list |
| P-08 | Low | `start.sh` | On a host without Node the secret generator aborted the script (`pipefail` + `head`) | Fixed; found by running the suites under Node 20 |

Consequences worth knowing: a registration waits for a human, so the queue must be worked (section 6, decision 10 of
[PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md)); guest donations stay open (decision 12), so the donation form is the one anonymous way into the payment code; a rejected person who registers
again is told the address exists, and an administrator can approve the old registration.

## Test results (after round 2 and the production decisions)

| Suite | Command | Result |
|---|---|---|
| Server unit | `npm test -w server` | 123 suites, 4,375 tests (also green on Node 20, which CI and Docker use) |
| Server security (real PostgreSQL) | `npm run test:security -w server` | 31 suites, 394 tests (the OAuth-linking suite went with the feature; the visitor-access tests now assert 401) |
| Server integration (real PostgreSQL) | `npm run test:integration -w server` | 8 suites, 50 tests (new: `alumni-approval.int.test.ts`, including the notification flow to the college administrator) |
| Client/server contract | `npm run test:contract -w server` | 5 suites, 931 tests |
| Client (vitest) | `npm test -w client` | 102 files, 1,274 tests (151 in `src/__security__/`) |
| Type checks | server `tsc -p tsconfig.test.json`, client `tsc --noEmit` | clean |
| Lint | server eslint, client `next lint` | 0 errors |

The suites are the regression guard: every finding above has at least one test that fails without its fix.

## Round 3: code-level findings and fixes (2026-11-12)

Scope: the code-level half of the round-3 plan ([SECURITY_AUDIT_PLAN.md](SECURITY_AUDIT_PLAN.md), phases C to I and the carry-over of section 8),
run by the owner against their own application on a test database. Method as before: attack with a failing test, root-cause, fix
test-first, regression test (`server/tests/security/round3/`, `client/src/__security__/round3/`, and unit tests next to the code).
Everything in the infrastructure phases (nginx, Docker, Tailscale, scanners) still needs the `atreya-2` run.

**Verdict.** The authentication and authorization core held under a much wider attack than rounds 1 and 2 used: no way was found to
obtain a session, an access token or a socket for a PENDING or REJECTED account, no mass-assignment or token-forging variant worked,
and the payment code, the sanitiser and the upload pipeline refused everything thrown at them. What was found sits at the edges:
a verification-link gap when verification is switched off, state that Kafka keeps for ever, a broadcast that ignored approval,
and error handling (two HTTP 500s). 11 findings, none Critical or High.

### Findings

| ID | Sev | Where | Evidence | Root cause and fix | Test |
|---|---|---|---|---|---|
| R3-06 | Medium | `authService.verifyEmail`, `REQUIRE_EMAIL_VERIFICATION=false` | Attacker registers the victim's address with their password; the victim clicks the mailed link: `200`, the address is verified, the attacker's password, name, enrolment number and note stay on the account (an administrator can then approve it, because the approval check for an unverified address exists only while verification is required). With verification **required** the same attack is stopped (link needs the password, no session before verification, approval refused, re-registration replaces it) | Round 2 asked for the registration password only when the policy was on, although the client page always asks. Now `assertRegistrationPassword` runs for every setting; the owner takes the address back with "Forgot password" (kills the attacker's password and sessions). **Open, other engineer's file:** `memberApprovalService.approve` should refuse an address with no `emailVerifiedAt` in every mode, not only while verification is required | `tests/security/round3/prehijack-verify-link.sec.test.ts` (both settings), `authService.verification.test.ts` |
| R3-07 | Low | follow, react, RSVP, comment, mention, message, mentorship | Loops notified every time: RSVP/cancel x6 gave 3 notifications, comment/delete x5 gave 5, a mention removed and re-added by editing a comment or a post gave 6, 8 messages gave 8, 4 mentorship requests after declines gave 4, 8 parallel comments gave 8 (follow, reaction and repost already had a 24 h cooldown from the round-2 follow-up) | `notifyOnce` extended, not duplicated: `windowMs` per notice, a synchronous in-process claim (`utils/cooldownStore.ts`) in front of the database lookup so a burst or a Kafka consumer that has not stored the first row yet cannot all pass. Applied to RSVP and mentorship requests (24 h), comments, replies and comment mentions (30 min), edit-loop mentions (24 h), messages (10 min). The action always goes through | `notification-cooldown.sec.test.ts`, `socialNotifications.test.ts` |
| R3-08 | Low | `utils/password.ts` | `Ｐａｓｓｗｏｒｄ１`, `Pásswörd1`, `Pássword1`, `Pass​word1`, `Paſſword1` were all accepted although `Password1` is on the deny-list | The comparison was on raw characters. `policyForm()` = NFKC, then NFKD with combining marks and format characters removed, then lower case, used by the deny-list and the "password equals e-mail" rule only. What is hashed and compared at login is untouched, so existing hashes keep working | `src/__tests__/utils/password.test.ts` |
| R3-09 | Low | `contentController.userAddPhoto` | Repeated multipart field `caption` (an array) answered 400 after both files were written: orphan files for every attempt | Caption validated (`galleryService.parseCaption`) before the first write; a file whose record cannot be made is deleted again | `gallery-caption-orphan.sec.test.ts` |
| R3-10 | Low | `client/src/lib/api.ts` | 38 more `${id}` path segments without encoding (round 2 counted 56, the rest already used `seg`) | Wrapped in `seg()`; a client test scans every API path template in `src/lib` and fails when a new un-encoded `${...}` appears (the scan itself is checked to find more than 60 templates) | `client/src/__security__/round3/api-path-encoding.test.ts` |
| R3-11 | Medium | `config/kafka.ts` (`ensureNotificationTopics`) | The notification and dead-letter topics were created without `retention.ms`; `createTopics` does not touch an existing topic. They carry e-mail addresses, applicant names and the reason a registration was rejected | Both topics are created with `retention.ms` = 7 days (`KAFKA_RETENTION_MS`, bounded 1 hour to 30 days) and existing topics are brought to it (`describeConfigs`, `alterConfigs` only where it differs); a broker that refuses is logged, not fatal | `src/__tests__/config/kafka.test.ts` (fake kafkajs) |
| R3-12 | Low | `services/notificationEvents.ts` | An envelope with `link: "javascript:alert(1)"`, `https://evil.example`, `//evil.example`, a 1 MB title or 5 MB metadata was accepted by the consumer and stored. Only server code can produce events (pinned by a scan: no controller or route touches the bus), so this is defence in depth against a forged message on the topic or a future bug | `link` must be a path on this site (<= 500 characters, no `//`, backslash, whitespace or control characters); title <= 300, message <= 2,000, metadata <= 8 KB; checked when an event is built and when it is consumed | `notification-events.sec.test.ts` |
| R3-13 | Medium | `broadcastService.fanOutNotification` | A broadcast (new magazine issue, requirement, video) was written for every `isActive` account, so applicants waiting for approval and rejected ones collected the community's announcements | `approvalStatus: 'APPROVED'` added to the fan-out query | `notification-events.sec.test.ts` |
| R3-14 | Low | `errorHandler`, `utils/storage.ts` | A NUL byte in an upload file name answered **500** (`Malformed part header` from the multipart parser); so did a zero-byte file | Parser errors map to 400 `INVALID_MULTIPART` (and are no longer logged as incidents); an empty upload is 400 `INVALID_FILE_TYPE` | `errorHandler.test.ts`, `storage.test.ts`, `uploads.sec.test.ts` |
| R3-15 | Low | `POST /magazine/upload-file` (administrators) | An HTML, SVG or ZIP file with a `.pdf` name and `application/pdf` was stored and served from the app origin (as `application/pdf` with `nosniff`, so not runnable, but arbitrary bytes under the college's name) | `assertPdfFile`: the bytes must contain `%PDF-` in the first 1,024 bytes | `storage.test.ts`, `uploads.sec.test.ts` |
| R3-16 | Low | `privacyService.exportMyData` | The data export left out the member's post views (`PostImpression`, which deletion does remove) and `isNotable` | Added (`postViews`, `profile.isNotable`). A new scan forces a decision for every user-referencing model and every `User` column, as round 2 did for deletion; `AlumniRecord` (the college's list, only the importer id points at a member) is listed as not exported with its reason | `privacy-coverage.sec.test.ts` |

### Carry-over items from round 2

| Item | Outcome |
|---|---|
| Pre-hijack through the verify-email link | **Closed for both settings** (R3-06). With verification required it already held; with it off it did not |
| Notification spam | **Closed** (R3-07): per actor, subject and type, extended in `notifyOnce` |
| Password policy, NFKC | **Closed** (R3-08), hashing and login comparison unchanged |
| `userAddPhoto` orphan file | **Closed** (R3-09) |
| `api.ts` ids without `encodeURIComponent` | **Closed** (R3-10) with a rule that cannot be forgotten |

### Attacks that found nothing (kept as tests because they pin an invariant)

| Area | What was tried | Result | Test |
|---|---|---|---|
| Approval bypass, PENDING and REJECTED | login, 2FA challenge (before and after the status change), an access token and a refresh token issued before the change, 12 routes with the old token, password reset, e-mail verification, invitation acceptance, the socket handshake, other members reaching the unapproved id, optional-token routes | Nothing hands out or keeps a credential; the old refresh token is deleted and stays dead after approval; every answer is a message, never a token | `approval-bypass.sec.test.ts` (27) |
| Mass assignment | 29 forbidden fields (`approvalStatus`, `userRole`, `isVerified`, `isActive`, `tokenVersion`, `passwordHash`, `emailVerifiedAt`, reviewer fields, ownership ids, `__proto__`) on profile, work, education, skills, password change, admin status/role, approve/reject, posts, comments, jobs | The row is byte-identical afterwards; an ADMIN cannot make or touch a SUPER_ADMIN | `mass-assignment.sec.test.ts` |
| JWT | HS384/512 with the real secret, `alg:none` in six spellings, `kid`/`jku`/`jwk`/`x5u`/`crit` headers, the three keys crossed, `nbf`, 10 KB tokens, deleted/deactivated/demoted accounts, refresh reuse after rotation (family and child revoked, alert written, other accounts untouched) | All 401 | `jwt.sec.test.ts` |
| Enumeration | forgot-password and resend-verification for six kinds of address (identical status and body), wrong-password login for six kinds, timing medians (login within 2x, forgot-password within 120 ms), bad tokens, pending versus rejected through profile, search and directory | Indistinguishable; the stage of an account is told only to somebody who proved the password | `enumeration.sec.test.ts` |
| Stored XSS and HTML injection | 14 payloads through about two dozen fields (posts, comments, profile, work, education, skills, messages, events, jobs, news, marketplace, chapters, albums, referrals, reports, invites, registration, notifications) and the admin landing blocks; the client searched for `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `srcDoc`, raw `href` and `window.open` | No tag, handler or script URI stored; no raw-HTML sink exists; the one `srcDoc` is an iframe with an empty `sandbox`; raw links go through `safeHref` | `stored-xss-renderers.sec.test.ts` (32), `client/src/__security__/round3/html-sinks.test.ts` |
| Uploads | SVG in four spellings, HTML, PHP, PDF and ZIP as images, truncated and empty files, double extensions, 8 hostile file names, content-type confusion, a 42-megapixel flood, over 5 MB, EXIF, polyglot tails; how the stored file is served | All refused or re-encoded; the stored name is the server's; `nosniff` and the image type on serving (except R3-14 and R3-15) | `uploads.sec.test.ts` |
| Payments | amounts (12 hostile values), tier tampering, another member's order, a signature of another order or payment, 11 malformed signatures, replay, a body that picks the amount, the webhook (no, wrong, modified, key-secret signature; ten parallel deliveries; amount mismatch; 256 KB limit; no secret configured), receipts | One winner, no change from any forged call, `503`/`400` never `500` | `payments.sec.test.ts` (27) |
| Races | ten simultaneous approvals, six rejections, approve against reject (the audit trail always explains the state), eight parallel registrations of one address, case variants, six parallel replacements of a pending registration | One winner, one audit entry, one live password and link | `approval-races.sec.test.ts` |
| Kafka | who can cause an event (no controller, route or middleware touches the bus; four service modules publish, pinned) | Only server code | `notification-events.sec.test.ts` |

Observation for the approval service (not changed, another engineer's file): approving and rejecting the same applicant at the same
moment can end with both decisions applied in sequence (`REJECTED`, then `APPROVED`, which is allowed by design), so the applicant may be
sent both the rejection and the welcome e-mail. The audit trail and the final status agree (tested); making the two decisions mutually exclusive would
need a version column or a row lock in `memberApprovalService`.

### Test results (after round 3, code-level)

| Suite | Command | Result |
|---|---|---|
| Server unit | `npm test -w server` | 133 suites, 4,670 tests |
| Server security (real PostgreSQL) | `npm run test:security -w server` | 44 suites, 597 tests (13 new suites in `round3/`) |
| Server integration | `npm run test:integration -w server` | 9 suites, 55 tests |
| Client/server contract | `npm run test:contract -w server` | 5 suites, 948 tests |
| Client (vitest) | `npm test -w client` | 131 files, 1,576 tests (two new guards in `src/__security__/round3/`) |
| Type checks | server `npm run typecheck -w server`, client `npm run typecheck -w client` | clean |
| Lint | `npm run lint -w server` | 0 errors |

### Added after round 3 (2026-11-12) and open residues

* **Administrators need a second factor** (`REQUIRE_ADMIN_2FA`, on by default in production): chapter admin and above pass an e-mailed one-time code at every sign-in, whether or not they enabled 2FA themselves (`utils/secondFactor.ts`; tests in `authService.test.ts`, `twoFactorService.test.ts`, `configDefaults.test.ts`, `productionChecks.test.ts`). The start-up guard refuses production without working mail while it is on.
* **`GET /metrics`** exists only with `METRICS_TOKEN`, answers `404` without it and `401` on a wrong bearer token (constant-time compare, nothing computed first), exposes counts and states only.
* **Landing page accessibility** (axe scan, `e2e/public.spec.ts`): footer text and the "Members" labels failed WCAG AA contrast and the "Sign In" call to action was white on white; fixed.
* **Open residue 1, accepted for non-production:** approving an applicant does not require a verified mailbox while `REQUIRE_EMAIL_VERIFICATION` is off. In production verification is required, so the case cannot arise there. Turning the check on in every mode would block the local demo and the test suites for no production gain.
* **Open residue 2, by design:** approving is allowed from `REJECTED` (an administrator may reconsider), rejecting only from `PENDING`. Two administrators deciding the same applicant at the same instant can therefore produce reject-then-approve, and the applicant may receive both e-mails. The audit trail and the final status stay consistent (tested); closing it needs a version column and is not worth the schema change.
* **Still needs the `atreya-2` / CI run:** R3-11 (Kafka topic retention against a real broker, check with `kafka-configs --describe`), nginx, Docker image scans, the real-stack drills.
