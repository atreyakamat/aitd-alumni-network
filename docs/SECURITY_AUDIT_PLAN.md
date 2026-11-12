# Security audit, round 3: plan and runbook

Status: ready to run. Written 2026-11-11 for AIEM Connect (the alumni network: `server/` Express + Prisma + PostgreSQL, `client/`
Next.js, nginx, Redis, Kafka). It continues [SECURITY_AUDIT.md](SECURITY_AUDIT.md) (rounds 1 and 2, the merge review and the
private-platform review) and assumes nothing else: an engineer or an AI agent who has never seen the repository can execute it
top to bottom and ends with an evidence bundle.

Contents: [1 Purpose and scope](#1-purpose-and-scope) · [2 Rules of engagement](#2-rules-of-engagement) ·
[3 Threat model refresh](#3-threat-model-refresh) · [4 Tooling](#4-tooling-what-exists-and-what-it-does) ·
[5 Phases A to I](#5-phases) · [6 Severity scale](#6-severity-scale) · [7 Method and finding template](#7-method-and-finding-template) ·
[8 Carry-over from round 2](#8-carry-over-from-round-2) · [9 First round-3 findings](#9-first-round-3-findings-already-known) ·
[10 Sign-off](#10-sign-off-checklist) · [11 Evidence bundle](#11-evidence-bundle)

## 1. Purpose and scope

**Purpose.** Find what rounds 1 and 2 could not see: problems in the stack as it is *deployed* (nginx, Kafka, Redis, Docker, the
tailnet), problems in the code added since round 2, and problems in the supply chain, and leave behind evidence and regression tests
rather than opinions. Round 3 is also the first round with tooling that runs on the Docker host and in GitHub CI, so the checks can
be repeated every week instead of once.

**In scope** (all of it the owner's own application, on the audit test stack only):

* the HTTP API (`/api/**`, 235 documented endpoints in [API_REFERENCE.md](API_REFERENCE.md)), the Socket.IO endpoint, `/health`, `/uploads/**`
* the web application (Next.js pages, middleware gate, CSP and headers)
* the compose stack: nginx, web, API, PostgreSQL, Redis, Kafka, the mail catcher
* the Docker host `atreya-2` and its Tailscale exposure
* the repository: dependencies, lockfile, Dockerfiles, CI workflows, history (secrets)
* data protection: what personal data exists where, for how long, and whether export and deletion are complete

**Out of scope:** production; third-party systems (Razorpay, OpenStreetMap/Nominatim, the mail provider) beyond how *we* call them;
social engineering; physical access; anything on a host that is not named in section 2.

## 2. Rules of engagement

These are binding for humans and agents. If a step conflicts with a rule, the rule wins and the step is skipped and reported.

1. **Authorised, owner-run testing of the owner's own application only.** The target is the **`atreya-2` test stack**
   (`http://atreya-2` over Tailscale, brought up by `node scripts/docker-verify/run.mjs --host atreya-2 --keep`) or a local/CI
   stack that `docker-verify` created. **Never production**, never a host you were not given. The live tools refuse hosts that do not
   look like a test stack (`rbac-live.mjs` and `zap-baseline.sh` demand an override for a public-looking name; do not use it).
2. **Test data only.** The stack is created by the run with generated, throwaway accounts and the seeded super admin. No real
   personal data, no real members, no real payment instruments. Razorpay stays in **test mode** (`rzp_test_` keys, no live money).
3. **No denial of service beyond an agreed ceiling of 20 requests per second** from the tester, in total, against any target.
   The shipped tools pace themselves far below that (4 per second). Load phases (I) use an explicit rate cap and a stop condition.
4. **No real secrets in tests, none in chat, none in the repository.** Test credentials live in `verify-report/private/credentials.json`,
   which is never uploaded (see section 11). Never paste a key, token, password or `.env` content into a chat, an issue, a PR or
   a report: describe it ("the 64-character JWT secret in `.env.verify`") and quote only its length or its first four characters.
5. **Stop and report on anything unexpected** and do not continue the phase: a production-looking hostname answering, real-looking
   personal data in the test database, a secret in a log or image, a destructive side effect you did not intend, the limiter or API
   returning 5xx under your load, a service that does not come back after a probe. Write down what you did, with times, and wait
   for the owner.
6. **Docker runs only on `atreya-2` and in GitHub CI,** never on the Windows development machine (the owner forbids it there).
   Every command below that needs Docker says so.
7. **Read-only first.** Mutating requests go only to routes that must refuse them (the RBAC probe) or to throwaway accounts you
   created for the test. The probe's denylist (logout, password change, 2FA, account deletion/export, payments, donations, audit
   cleanup) is never called with a real identity.
8. **Findings are handled, not hoarded:** write the failing test, fix test-first, record it ([section 7](#7-method-and-finding-template)).
   Do not fix application code during the discovery run itself except where a step says so; collect, then fix in a separate change.

## 3. Threat model refresh

Actors: an anonymous visitor; a registered-but-unapproved applicant; an approved member; a chapter admin, admin and super admin; a
guest donor; a compromised member account; a malicious insider with tailnet access; an attacker on the same tailnet; the internet
(if Funnel or a port forward is ever enabled by mistake); a malicious dependency.

Assets: members' personal data (names, e-mail, profile, home/work locations, enrolment numbers, applicant notes), credentials and
sessions, the approval decision itself, payment records and receipts, admin authority, availability of the platform, the host.

**What is new since round 2** (each row is a new attack surface and has a home in the phases below):

| New since round 2 | Why it matters | Phase |
|---|---|---|
| **Alumni approval** (`approvalStatus`): a registration waits for an administrator; `utils/approval.ts` gates sessions, refresh, `authenticate`, `optionalAuth`, the socket handshake | A hole is an unapproved person inside a private community. Check every path that mints or uses a token, including old tokens, refresh tokens and open sockets | C |
| **Private platform:** 42 formerly public routes now need a member; open on purpose: sign-in routes, `GET /landing`, `GET /users/stats`, invitation check, payment webhook, guest donation order/verify | The surface that remains anonymous is the real attack surface; the RBAC probe replays the documented level of every endpoint | C |
| **Guest donations** (`POST /donations/order`, `/donations/verify` without a session) | The one anonymous way into the payment code: order spam, PENDING rows, donor name/message rendering, receipts | E |
| **Kafka notification bus** (`<prefix>.notifications` and its dead-letter topic; in-app notifications, broadcasts, admin mail) | A new network service with its own trust boundary: broker exposure, event spoofing, replay, personal data at rest in topics, DLQ | F, G |
| **System status endpoint** (`GET /admin/system-status`) | Aggregates versions, broker/Redis/DB state: must be admin-only and must not leak hostnames, credentials or stack traces | C, F |
| **Proactive token renewal** (client refreshes before expiry; sockets reconnect with the new token) | Refresh-token rotation and reuse detection under a busy client; races between tabs; a stolen refresh token | C |
| **Removed OAuth** (Google and LinkedIn sign-in gone) | Less surface, but leftovers: routes, env vars, CSP origins, `passport` config, old accounts with a cleared password hash | B, C |
| **Single-origin nginx** (`/` web, `/api` API, `/uploads`, `/socket.io` on one origin) | Uploaded files are served from the same origin as the app; nginx merges slashes and forwards `Upgrade` on `/` | D, G |
| **Tailscale exposure** of the Docker host | Anyone on the tailnet reaches the stack; every client shares or does not share a rate-limit bucket depending on proxying | C, G, I |

## 4. Tooling: what exists and what it does

All scripts are Node 20+ ESM with **zero npm dependencies**, in `scripts/security/`. Their own tests run with
`node --test scripts/security/__tests__/` (Node 20, which CI uses) or, on any Node version including 22+ where a directory argument
is no longer accepted, `node scripts/security/run-tests.mjs`.

| Tool | Command | Where it runs | Output |
|---|---|---|---|
| Static and supply-chain scan | `node scripts/security/static-scan.mjs [--out security-report] [--docker-tools]` | anywhere (Docker only with `--docker-tools`, never on the Windows machine) | `security-report/static-scan.json`, `static-scan.md`, `npm-audit.json`, `gitleaks.json`, `hadolint.json`, `trivy.json` |
| Allowlist for dependency advisories | `scripts/security/audit-allowlist.json` | read by the scan and CI | every entry: reason, owner, expiry (at most 90 days), status |
| Live authorization probe | `node scripts/security/rbac-live.mjs --api <http://host/api> --credentials-file <file> [--plain-admin-email E --plain-admin-password P] --out rbac-report.json` | any host that can reach the stack | `rbac-report.json` plus a PASS/FAIL table; exit 1 on any failure |
| ZAP baseline (passive) | `bash scripts/security/zap-baseline.sh --target http://atreya-2 --out zap-report` | **Docker host or CI only** | `zap-report/zap.html`, `zap.json`, `zap.md`; rules in `scripts/security/zap-rules.tsv` |
| Functional and Kafka gates, brings the stack up | `node scripts/docker-verify/run.mjs --host atreya-2 --keep --skip-drills --out verify-report` | **Docker host** | `verify-report/`, the test credentials in `verify-report/private/credentials.json` |
| CI | `.github/workflows/security.yml` | GitHub | jobs `dependencies`, `secrets`, `dockerfiles`, `codeql`, `images`, `dynamic` (weekly and on demand) |

Pinned tool versions (a failed pull is a one-line bump):

| Tool | Version | Pinned in |
|---|---|---|
| gitleaks | 8.21.2 | `.github/workflows/security.yml` (`GITLEAKS_VERSION`) and `scripts/security/lib/scanners.mjs` (`zricethezav/gitleaks:v8.21.2`) |
| hadolint | 2.12.0 | `hadolint/hadolint-action@v3.1.0` and `scanners.mjs` (`hadolint/hadolint:v2.12.0-alpine`) |
| Trivy | 0.57.1 | workflow `TRIVY_VERSION` (action `aquasecurity/trivy-action@0.28.0`) and `scanners.mjs` (`aquasec/trivy:0.57.1`) |
| OWASP ZAP | 2.15.0 | workflow `ZAP_IMAGE` and the default in `zap-baseline.sh` (`ghcr.io/zaproxy/zaproxy:2.15.0`) |
| CodeQL | action `github/codeql-action@v3` (`javascript-typescript`, `security-extended`) | workflow; runs on public repositories only |

**About the live probe.** It reads `docs/API_REFERENCE.md`, replaces every `:param` with the syntactically valid, nonexistent id
`00000000-0000-4000-8000-000000000000`, and checks: **A** a visitor gets 401 on every non-public route; **B** a member gets 403 on
chapter-admin/admin/super-admin routes; **C** a plain ADMIN gets 403 on super-admin routes; **D** nothing, for anyone, answers 5xx;
**E** signed-in identities are not refused where they are entitled (GET only). It signs in once per identity, renews tokens with the
refresh token, honours the API's rate-limit headers (global budget 300 requests per 15 minutes per address, 10 on each sign-in
route, 30 per minute on `/geo`) and never counts a 429: it waits and retries. A full run is about 450 requests, so **expect 15 to 25
minutes** on a fresh budget; do not run two probes (or the probe and a load test) from one address at the same time. `--unsafe` adds
member-level writes with an empty body; the denylist stays denied. The mass-mail routes (`POST /admin/digest/send`, `/test`) are sent to
a member only with `--unsafe`.

## 5. Phases

Work the phases in order; A feeds everything, B and C can overlap. For every item: run the command (or follow the procedure), save
the output under `manual/<phase>-<item>.md` in the evidence bundle, and write a verdict **PASS / FINDING R3-NN / N/A (reason)**.
"Test stack" means the `atreya-2` stack from `docker-verify --keep`; `$H` below stands for `atreya-2`.

### A. Threat model

- [ ] A1 Redraw the data-flow: browser, nginx (80), web (3000), API (5000), PostgreSQL, Redis, Kafka (broker and topics `<prefix>.notifications`, `.dlq`), mail catcher, Razorpay, Nominatim, SMTP; mark every trust boundary and every port. Source: `docker-compose.yml`, `nginx/nginx.conf`, [ARCHITECTURE.md](ARCHITECTURE.md), [KAFKA.md](KAFKA.md).
- [ ] A2 List every anonymous route (the API reference rows with access `Public` or `Public (personalised when signed in)`: 15 today) and every route that accepts a file; these are the entry points for D and E.
- [ ] A3 Walk the table in section 3 and add anything that changed since this document was written (`git log --since=2026-11-11 --stat`).
- [ ] A4 Record assumptions that tests will check (for example "TRUST_PROXY is 1 behind nginx", "the broker is unreachable from outside the compose network").

Evidence: `manual/A-threat-model.md`.

### B. Static analysis and supply chain

- [ ] B1 Dependency gate: `node scripts/security/static-scan.mjs --out security-report` (add `--docker-tools` on `atreya-2`). Any non-allowlisted critical/high production advisory, expired allowlist entry or invalid allowlist fails. Read the `needs-fix` list in `static-scan.md`; those are real findings whose failure is only deferred ([section 9](#9-first-round-3-findings-already-known)).
- [ ] B2 Secrets in the whole history: `gitleaks detect --source . --redact --report-format json --report-path security-report/gitleaks.json` (Docker form on the host: `docker run --rm -v "$PWD":/repo zricethezav/gitleaks:v8.21.2 detect --source /repo --redact`). **Expect a finding for the database password that round 1 (OP-01) found committed in the deployment documents.** It stays in git history forever: confirm it was rotated on every real server, then record its fingerprint in a `.gitleaksignore` with a comment. Any other hit is a finding.
- [ ] B3 Dockerfiles: `hadolint server/Dockerfile client/Dockerfile` (only `error` fails; read the warnings).
- [ ] B4 Filesystem and misconfiguration: `trivy fs --scanners vuln,secret,misconfig .`; images (Docker host or CI): `docker buildx build --load -f server/Dockerfile -t aiem-api:audit .`, `docker buildx build --load -f client/Dockerfile --build-arg NEXT_PUBLIC_API_URL=/api -t aiem-web:audit .`, then `trivy image --severity CRITICAL,HIGH --ignore-unfixed aiem-api:audit` and the same for `aiem-web:audit`. **Prediction to confirm:** the API image fails, because it ships development tooling (finding R3-05).
- [ ] B5 CodeQL: the `codeql` job of `security.yml` (public repositories). Otherwise review by hand with the greps below.
- [ ] B6 Greps that must be explained line by line (save the output): `rg -n "\$queryRaw|\$executeRaw|Unsafe|Prisma\.raw" server/src`, `rg -n "dangerouslySetInnerHTML|innerHTML|eval\(|new Function|document\.write" client/src`, `rg -n "child_process|exec\(|spawn\(" server/src`, `rg -n "new RegExp\(" server/src client/src`, `rg -n "res\.redirect|Location" server/src`, `rg -n "fetch\(|axios|http\.request|https\.request" server/src`, `rg -n "passport|google|linkedin|oauth" -i server/src client/src package.json` (leftovers of the removed OAuth).
- [ ] B7 Install-time and registry integrity: `npm audit signatures`, `npm ls --omit=dev --all | head -200`, check `package-lock.json` for `git+` or `http://` resolutions: `rg -n '"resolved": "(git|http:)' package-lock.json`.
- [ ] B8 CI itself: `.github/workflows/*.yml` have read-only `permissions`, pinned action tags, no `pull_request_target`, no secrets echoed (`scripts/security/__tests__/workflow.test.mjs` checks `security.yml`; review `ci.yml` by hand).

Evidence: `security-report/`, `manual/B-*.md`.

### C. Authentication and authorization

- [ ] C1 **RBAC probe** on the test stack (needs a member and, ideally, a plain ADMIN). Create the plain admin once, as the super admin, from a throwaway member: `PATCH /api/admin/users/<id>/role` with `{"role":"ADMIN"}`. Then
  `node scripts/security/rbac-live.mjs --api http://$H/api --credentials-file verify-report/private/credentials.json --plain-admin-email <e> --plain-admin-password <p> --out rbac-report.json`.
  Every failure is a finding; a 5xx is a finding (cause: missing input guard). A run reported "not run" is incomplete: rerun with `--max-minutes`.
- [ ] C2 **Approval bypass.** For a registration in each state (`PENDING`, `REJECTED`): login (expect `403`), `POST /auth/refresh-token` with a token obtained earlier, the verify-email link, password reset, `verify-2fa`, `GET /auth/me` with a token issued *before* the rejection, the Socket.IO handshake (`io(url, { auth: { token } })`), a socket that was already open when the admin rejected the person (it must be disconnected or at least receive nothing), `POST /invites/:token/accept`, `GET /users/:id` and message/follow/connection calls aimed at the pending person's id (must look like a missing record). Approve and reject concurrently from two admin sessions (one winner, 409 for the other).
- [ ] C3 **Verify-email pre-hijack** (open item from round 2, believed closed by decision 2 of PRODUCTION_CHECKLIST section 6). Attacker registers the victim's address with the attacker's password; the victim opens the verification link. Expected: the link needs the registration password, an unverified never-used registration is replaced by the next one, no session exists before verification. Repeat with the victim registering second, and with the victim having used the account before.
- [ ] C4 **2FA and reset brute force.** 40 parallel guesses of the 2FA code (only 5 may ever be evaluated), 6 sequential wrong guesses then the right one (still refused), reset token reuse, reset token after password change, 20 parallel redemptions of one reset token (one winner), OTP and token entropy (256-bit tokens, `crypto.randomInt` OTP), the e-mail enumeration answers of `forgot-password` and `resend-verification` (identical body, status and, within noise, timing).
- [ ] C5 **Enumeration.** `register` with an existing address (documented to say so), login timing for unknown vs known address (dummy hash: compare medians of 30 each), rejected vs pending applicants must not be distinguishable to a third party, `GET /users/:id` for a missing vs unapproved id.
- [ ] C6 **Rate limits behind nginx and Tailscale.** From two different tailnet hosts, 12 failed logins each: expect separate buckets (429 after 10, per address) and no shared lockout. Spoof `X-Forwarded-For: 1.2.3.4` on every request: the bucket must not change (`TRUST_PROXY=1`, nginx appends the real address). Repeat through `tailscale serve` if it is ever used (the API may then see only the proxy and share one bucket for everyone: a one-request denial of sign-in for all). Also try `//api//auth//login`, absolute-form request targets and a trailing slash (rounds 1 and 2 found bypasses). Record the nginx limit (5 requests per second per address on `/api/auth/*`, burst 20) as seen from outside.
- [ ] C7 **JWT handling.** Forge and replay: `alg: none`; `alg: HS256` signed with an empty string; signed with the published defaults (`default-secret-change-me` and the strings in `.env.example` / `.env.docker.example`); header `kid`/`jku`/`jwk` injection; a refresh token used as an access token and vice versa; `tv` (token version) behind the user's; a deleted/deactivated user; `exp` in the past and far future; a 10 KB token. Check `config/productionChecks.ts` refuses weak or equal access/refresh secrets (the API must refuse to start). A forged token must always be 401 and never fall back to the visitor view.
- [ ] C8 **Session hint cookie and CSRF.** Tokens live in `localStorage` (gate item CL-05). Verify the `aiem_session` cookie carries no secret, the API ignores cookies entirely (a cross-site POST with the cookie but no bearer is 401), and CORS rejects `Origin: https://evil.example` with `403 FORBIDDEN_ORIGIN` and never answers `Access-Control-Allow-Origin: *` or a reflected origin with credentials.
- [ ] C9 **Password policy** (open from round 2): NFKC variants, 72-byte boundary, deny-list, `password == e-mail`.

Evidence: `rbac-report.json`, `manual/C-*.md`.

### D. Injection and input handling

- [ ] D1 **Stored XSS in every renderer.** Payload corpus: `<img src=x onerror=alert(1)>`, `"><svg/onload=alert(1)>`, `javascript:alert(1)` with tabs/newlines/entities/fullwidth forms, `data:text/html,...`, markdown-style `[x](javascript:...)`, unbalanced tags, `</script>`, template syntax `{{7*7}}`, Unicode bidi and zero-width characters. Submit each through every field that is stored and rendered: post and comment text and links, profile (headline, bio, skills, work experience, education, links), events (title, description, venue, links), jobs, news, gallery captions, chapters, messages, notifications, marketplace, college videos, magazine, requirements and referrals, and the **admin landing page blocks** (`POST /admin/landing`: titles, text, link and image URLs; rendered to every visitor by `LandingBlockView`, so a compromised admin or a hole in validation reaches the anonymous page). Open each result as another member in a real browser (the built-in browser or Playwright on the host) with the console open: any script execution, CSP violation report or unexpected network request is a finding. Also check the e-mail templates (Mailpit at `http://127.0.0.1:8025` on the host) and the receipt PDF.
- [ ] D2 **SSRF.** The only outbound fetches in `server/src` are the geocoder (`geocodingService.ts`: `GET /geo/search`, `/geo/reverse`, upstream Nominatim) and the Razorpay SDK. Confirm: the host is fixed or allowlisted, user input only reaches query parameters, redirects are not followed or are re-validated, there is a timeout and a response-size cap, error bodies from upstream are not reflected. Try `q=http://169.254.169.254/`, `q=@evil.example`, `\r\n` and `%0d%0a` in parameters, lat/lng as strings and `NaN`/`1e999`. For Next.js: the `rewrites()` destination is fixed; test `Upgrade: websocket` requests to `/` and `/_next/` (finding R3-03) and `/_next/image?url=...` (must be 404).
- [ ] D3 **Uploads.** Polyglots (GIF header + HTML/JS, PNG + script, JPEG with a PHP tail), an SVG renamed `.png`/`.jpg`/`.gif`, a real SVG with `<script>`, an HTML file with an image content type, a decompression bomb (a 40,000 x 40,000 PNG; the cap is 40 megapixels), EXIF with GPS (must be stripped), file names with `../`, NUL bytes, very long or Unicode names, wrong magic bytes for video (`.mp4` that is a ZIP), a PDF with JavaScript/launch actions for the magazine routes (admin), zero-byte and truncated files, and 11 parts in a multipart body (cap 10 text fields). Because `/uploads` is served from the **same origin as the app**, anything stored must be served with a safe `Content-Type` and `nosniff`: fetch each stored file and check the response headers, and check that a stored PDF or SVG can never execute script in the app origin.
- [ ] D4 **CSV formula injection in admin exports** (`GET /admin/export/:entity`, `utils/csv.ts`). Create throwaway members whose name/headline/company start with `=`, `+`, `-`, `@`, tab and CR (`=HYPERLINK("http://evil.example","x")`, `=1+1`, `@SUM(A1)`), export as an admin, and confirm each cell is neutralised (leading apostrophe) or quoted so a spreadsheet will not evaluate it. Check `X-Export-Truncated` and the row cap.
- [ ] D5 **Raw SQL.** `rg -n "\$queryRaw|\$executeRaw" server/src` lists 13 sites today (event RSVP counter, advisory locks, `FOR UPDATE` row locks, message listing, the nearby-members query in `userService.ts`, health probes). Each must be a tagged template or `Prisma.sql` with bound values; none may concatenate request data. For the nearby query send latitude/longitude/radius as strings, arrays, `NaN`, huge numbers and `1;SELECT pg_sleep(10)`. Add every new `$queryRaw` to the list.
- [ ] D6 **ReDoS and algorithmic cost.** Re-run the round-2 adversarial inputs against `sanitizeInput` (`'<script '` x 60,000, `'<img <b>' + '='.repeat(32000)`, a megabyte of `javascript:`) and every regex found by B6, keeping to the 1 MB body cap, while watching `/health` latency from a second terminal (it must stay under about 200 ms). Any request that holds the event loop more than a second is a finding.
- [ ] D7 **Open redirects and link building.** Client: `?next=` values (`//evil.example`, `/.//evil.example`, `/%2e//evil.example`, `\\evil.example`, `javascript:`), post-login and post-registration targets. API and e-mail: send `Host: evil.example` and `X-Forwarded-Host` on `forgot-password`, `resend-verification` and the invite endpoints, then read the mail in Mailpit: every link must use the configured origin. Payment return URLs.
- [ ] D8 **Validation holes** (the class found by the 38 MB response in R3-01): every `z.array(...)`/`z.record(...)` on a request body needs `.max()`; send 1 MB arrays, 100,000-key objects, JSON nested 10,000 deep, numbers as `1e999`, `-0`, strings where numbers are expected, `__proto__` and `constructor` keys, 5,000-character names, emoji and NUL bytes in every text field of every *validated* route (the API reference marks them). Anything but a fast, small 400 is a finding.
- [ ] D9 **Client id interpolation** (open from round 2): `rg -n "api\.[a-zA-Z]+\(.*\$\{" client/src/lib/api.ts` and decide per call whether an unencoded id can change the path.

Evidence: `manual/D-*.md`; screenshots only for confirmed script execution.

### E. Payments and business logic

Test mode only (`rzp_test_` keys; never a live key on `atreya-2`).

- [ ] E1 **Order tampering.** Amounts from the client are ignored or bounded server-side: send negative, zero, `0.001`, `1e3`, `"100"`, `Infinity`, an array, a huge value, a different currency, another tier id, a deactivated tier. The price of a membership order comes from the tier row, never the request.
- [ ] E2 **Verify tampering.** A wrong signature, a valid signature from a *different* order, someone else's order id, a missing field, replaying a valid signature (idempotent, no second membership/donation record), a refunded payment completed by replay (round 1 AU-03), an amount-mismatch webhook.
- [ ] E3 **Webhook** (`POST /api/payments/webhook/razorpay`, public until the HMAC is checked): no signature, wrong signature, valid signature over a modified body, the same valid event delivered twice and ten times in parallel, event order inverted (refund before capture), unknown event types, a body of 256 KB + 1 byte (must be refused), non-JSON, `Content-Type` variants, a missing webhook secret in configuration (must refuse, not accept everything), and the dedicated rate budget (1,500 per 15 minutes).
- [ ] E4 **Guest donation abuse.** 25 orders in 15 minutes from one address (the budget is 20: expect 429 after the 20th), PENDING rows growing without bound (retention?), donor name/message/e-mail with XSS, CSV and header-injection payloads and how they render in the donor wall, receipts, the PDF and the e-mails; whether a guest can learn another donor's data through `verify` or the wall; e-mail address injection (`a@b.c\r\nBcc: x@y.z`).
- [ ] E5 **Receipts and access.** `GET /transactions/:id/receipt` as owner, other member, visitor, admin; `/uploads/receipts/<file>` in all spellings (`..`, `%2e%2e`, backslash, case, trailing dot, `:stream`) must be 404; `/api/transactions/my` and `/api/donations/my` show only the caller's rows.
- [ ] E6 **Races.** Parallel `verify` + webhook for one payment, parallel membership orders, parallel donation verify, tier price changed between order and verify, two admins approving the same job/registration. One winner, consistent counters, no duplicate records.
- [ ] E7 **Business rules.** Event capacity and mentor seats under parallel load (round 1 AZ-01/02), invite quota (100/day), message-request quota (20/day), counters (likes, comments, reposts) after 8 parallel reactors, job approval flow (a rejected job is never visible to members), chapter-admin scope (a chapter admin cannot touch another chapter), role changes by an ADMIN to SUPER_ADMIN (must be refused), an ADMIN demoting the super admin.

Evidence: `manual/E-*.md` with request/response pairs (no keys).

### F. Realtime and Kafka

- [ ] F1 **Socket authorization.** Handshake with no token, a malformed, expired, revoked (`tv` bumped), deactivated, pending and rejected user's token (all refused). `join_chat` for a chat id that does not name the caller (must not join; compare the id format in `utils/socket.ts`), more than 50 rooms, `user:<other id>` rooms, typing events to a non-connection or blocked user, more than 20 events per 10 seconds, oversized payloads (Socket.IO default 1 MB), binary frames, a cross-site WebSocket handshake with a foreign `Origin` (the token is in the handshake, not a cookie, so there should be no cross-site hijack: prove it).
- [ ] F2 **Broker exposure.** From a *different* tailnet host and from the host itself: `nmap -Pn -sT -p 9092,9093,29092,2181,6379,5432,8025,1025 $H` (use `--max-rate 20`) and compare with `docker ps --format '{{.Names}}\t{{.Ports}}'` on the host. Kafka, Redis, PostgreSQL, the mail catcher UI and SMTP must **not** answer from outside the compose network (only nginx on 80; the API and web ports bound to `127.0.0.1`). Also check the advertised listener: a client connecting through the published port must not be told an internal hostname it cannot reach, which hides a misconfiguration but also hints at one.
- [ ] F3 **Event spoofing** (inside the compose network only, on the host: `docker compose exec kafka ...`). Produce to `<prefix>.notifications` events with an unknown `userId`, a `link` of `javascript:alert(1)` or an external URL, HTML in `title`/`body`, a 5 MB `metadata`, a wrong schema version, a missing field, a field of the wrong type: the consumer must validate (`services/notificationEvents.ts`), refuse bad events to the dead-letter topic after the bounded retries and never crash the API. Confirm a member cannot cause an arbitrary event to be produced (only the server produces).
- [ ] F4 **Broadcast path.** Who can trigger an announcement to all members or the admin e-mail for a waiting registration; the rate and size limits of that trigger; that recipients are only approved, active users; that the admin e-mail contains no applicant note or enrolment number beyond what the admin UI shows.
- [ ] F5 **Replay and idempotency.** Deliver the same event twice (and reset the consumer group offset): the member must get one notification (or the duplicates are documented); a poison message must not block the partition forever; a restart in the middle of a batch.
- [ ] F6 **Personal data in topics and logs.** Read the topic from the beginning (`kafka-console-consumer`) and `docker logs` of every container; search for e-mail addresses, names, tokens, OTP codes, `Bearer`, reset links, passwords, enrolment numbers (`docker logs <c> 2>&1 | rg -i "password|token|secret|bearer|otp|@"`). Record topic retention (`kafka-configs --describe`) against the data-retention decision (phase H).
- [ ] F7 **Dead-letter access.** Who can read or replay the DLQ (operators only), what is in it (full payloads: personal data), how an operator clears it, and that `GET /admin/system-status` shows counts only, not payloads, hostnames or credentials, and is 403 for a member (the RBAC probe covers the 403).

Evidence: `manual/F-*.md`, `verify-report/` (gates already prove the happy path).

### G. Infrastructure on the Docker host

Run from a *different* tailnet device unless the step says "on the host".

- [ ] G1 **Port scan.** `nmap -Pn -sT -p- --max-rate 20 $H` (and `-sU --top-ports 20` if you have the time). Expected open: 80 (nginx) and 22 (SSH) only. Everything else is a finding or an explained exception. On the host: `ss -tlnp` and `docker ps --format '{{.Names}}\t{{.Ports}}'`; every published port bound to `127.0.0.1` unless it must be public.
- [ ] G2 **Tailscale.** On the host: `tailscale status`, `tailscale serve status`, `tailscale funnel status` (Funnel must be **off**; Serve only if intended), `tailscale ip`. In the admin console: the ACL allows only the owner's devices to `atreya-2:80,22`; no `autogroup:member` wildcard; tags on the host; key expiry on; no subnet routes or exit node by accident. From a network outside the tailnet (a phone on mobile data) `curl -m 10 https://atreya-2.<tailnet>.ts.net/` and the public IP of the host must **fail**.
- [ ] G3 **Containers.** On the host: `docker inspect $(docker ps -q) --format '{{.Name}} privileged={{.HostConfig.Privileged}} user={{.Config.User}} caps={{.HostConfig.CapAdd}} net={{.HostConfig.NetworkMode}} readonly={{.HostConfig.ReadonlyRootfs}} mounts={{range .Mounts}}{{.Source}}->{{.Destination}} {{end}}'`. No privileged container, no `docker.sock` mount, no host path mounts beyond uploads/backup volumes, API and web run as a non-root user (they do: `expressjs`, `nextjs`), `no-new-privileges` and `cap_drop: [ALL]` where possible, memory limits set. Run `trivy config .` for compose findings. Optional: `docker-bench-security` (needs the Docker socket; run it deliberately and only on the host).
- [ ] G4 **nginx.** `curl -sI http://$H/` and `/api/users/stats`: security headers present, no `Server` version, no `X-Powered-By`. Body limits: 10 MB + 1 byte to `/api/posts/media` must be 413; the video route allows 110 MB. Slow clients: open 20 sockets that send one header byte per second: they must be cut after about 10 s (`client_header_timeout`), without hurting a normal request (stay under the 20 requests-per-second ceiling). `curl http://$H/.env`, `/.git/config`, `/uploads/.env`: 404. `//api//auth//login` is merged by nginx (still limited). `TRACE`, `OPTIONS` with a foreign `Origin`, `Host: evil.example`, HTTP/1.0, `Transfer-Encoding: chunked` + `Content-Length` (request smuggling probes with `printf ... | nc $H 80`, one request at a time). An `Upgrade: websocket` to `/` (forwarded to Next today; see R3-03). What a client sees while the API is down (the JSON 503 with `Retry-After`).
- [ ] G5 **Environment and log leakage.** On the host: `docker history --no-trunc aiem-api:audit | rg -i "secret|password|key"`, `trivy image --scanners secret aiem-api:audit`, `docker inspect <api> --format '{{json .Config.Env}}'` (secrets in the environment are normal; they must be test values, long, random and different from each other and from `.env.example`), `docker logs <api> 2>&1 | rg -i "password|secret|token|bearer"`. `GET /health` shows no versions or hostnames beyond status words. A malformed request (`/api/%`, a 5 MB header, invalid JSON) must not return a stack trace, file path or SQL text (`NODE_ENV=production`).
- [ ] G6 **Backups.** `ls -l` the backup directory and `backup-db.sh` output (mode 0600 or tighter, owner is the backup user, not world-readable), where dumps go, whether they are encrypted, whether a restore into a scratch database works (`pg_restore`/`psql` on a throwaway instance on the host), and that dumps are not inside a web-served path. Dumps hold every member's personal data: treat as such.
- [ ] G7 **Host basics** (only what is cheap): SSH key-only (`sshd -T | rg -i "passwordauthentication|permitrootlogin"`), the Docker daemon not on TCP (`ss -tlnp | rg 2375`), automatic security updates, disk encryption noted, firewall (`ufw status` / `nft list ruleset`) as a second layer beside Tailscale.

Evidence: `manual/G-*.md` (command, trimmed output, verdict), `zap-report/`.

### H. Privacy

- [ ] H1 **Data inventory.** `rg -n "^model " server/prisma/schema.prisma` and for each model write: personal data fields, sensitivity (identity, contact, location, financial, education/enrolment, applicant note, credentials), who can read it (role), where else a copy lives (Redis cache, Kafka topic, uploads, logs, backups, mail catcher, Razorpay), and the legal basis/purpose. Include: precise home/work coordinates, enrolment number, applicant and reviewer notes, audit-log IP/user agent, donation records, receipts, messages.
- [ ] H2 **Retention.** For each store, the retention period, who enforces it and the evidence that it runs: refresh tokens (expired rows deleted at login), notifications, PENDING and REJECTED registrations (enrolment number, note), audit log (`POST /admin/audit/cleanup`), Kafka topic and DLQ retention, API/nginx logs, backups, the mail catcher. Anything with no end date is a finding or a documented decision.
- [ ] H3 **Export and deletion, end to end** on a throwaway member: create data in every feature (profile, locations, education, posts, comments, reactions, messages, connections, jobs, events, marketplace, videos, referrals, donations as a member, a rejected-then-reapplied registration), `GET /users/me/export` (complete against the schema scan), `DELETE /users/me`, then query PostgreSQL on the host for the user id and e-mail in every table (`psql -c "select ..."` per model) and search the topics, logs and uploads folder. Residue must be exactly what [SECURITY_AUDIT.md](SECURITY_AUDIT.md) lists as kept on purpose (messages sent, reactions, anonymised audit entries, uploaded files not purged) and be disclosed in the privacy page.
- [ ] H4 **Third parties and leaks to them.** The geocoder sends place text (and, for reverse geocoding, **coordinates**) plus the server's address to OpenStreetMap Nominatim; map tiles reveal the viewed area and the member's address to the tile server (CSP `img-src` allows it); Razorpay receives donor data; the mail provider receives every message. Check what exactly is sent (D2), that precise home/work coordinates are never sent upstream, and that the privacy page says all of this.
- [ ] H5 **Notices and consent.** `client/src/app/(legal)/privacy`, `terms`, `cookies` match the real flows (cookies actually set: `aiem_session` hint, local storage keys), the registration form tells applicants what the approval step does with their enrolment number and note.

Evidence: `manual/H-inventory.md` (table), `manual/H-*.md`.

### I. Availability

Respect the 20 requests-per-second ceiling in every step and stop at the first sign of distress (5xx, `/health` over one second).

- [ ] I1 **Limiter effectiveness from outside nginx.** Confirm 429 with `Retry-After` at: 300 requests per 15 minutes (global), 10 (each sign-in route), 20 donation orders, 100 searches, 30 invites, 30 uploads, 30 `/geo` per minute, 1,500 webhooks. Confirm the budgets are shared across API processes (Redis) and what happens to them when Redis is stopped (per-process counting, not "off"). Confirm 429s do not carry personal data.
- [ ] I2 **Oversized payloads.** JSON body of 1 MB (accepted) and 1 MB + 1 (413), a 256 KB + 1 webhook body, a 10 MB + 1 upload at nginx (413), multipart with 11 text fields and a 17 KB field (refused), a 200 KB header (431 or 400), 10,000 query parameters and `a[0][0][0]...` nested 5,000 deep, JSON nested 10,000 deep, a gzip bomb request body (the API must not decompress request bodies).
- [ ] I3 **Expensive queries.** `limit=1000000`, `page=999999999`, deep cursors, `q` of `%%` and 1,000 characters, `GET /users/nearby` with a radius covering the planet, `/search` with many short terms, hashtags with 10,000 posts, the admin export on a large table (`X-Export-Truncated`), conversation list for a member with 50,000 messages (known: `getConversations` loads all messages; measure it), comment threads 50 levels deep. For each: response time and `/health` latency during the call; anything over 2 seconds or unbounded is a finding.
- [ ] I4 **WebSocket caps.** Open 200 sockets with one valid token and with 200 different tokens: memory of the API container (`docker stats`), connection limits per user/IP, behaviour at the file-descriptor limit; idle connections and ping timeouts; a client that never reads (back-pressure).
- [ ] I5 **Controlled load.** One endpoint at a time, capped: `npx autocannon -c 10 -d 30 -R 20 http://$H/api/users/stats` (20 requests per second is the ceiling), then `/` (web) and an authenticated read. Record p50/p95/p99, errors and container CPU/memory. Compare with a run through `--network` directly to the API to see what nginx adds.
- [ ] I6 **Containment and recovery.** Memory and CPU limits exist (G3); the API restarts on crash (`restart: unless-stopped`); during a Kafka outage notifications fall back to in-process delivery and the API stays up; during a Redis outage limits fall back per process and the API stays up; a PostgreSQL restart is survived by the API without a restart. Use `docker compose stop kafka` style drills only through `docker-verify` (without `--skip-drills`) on the test stack.
- [ ] I7 **Re-test R3-01** after its fix with the 1 MB array body: expect a fast, small 400.

Evidence: `manual/I-*.md` with timings.

## 6. Severity scale

The scale of [SECURITY_AUDIT.md](SECURITY_AUDIT.md), unchanged: **Critical** = takeover or data theft by anyone; **High** = serious
abuse by a signed-in member or a latent takeover; **Medium** = integrity or availability issues; **Low** = hardening. Scanner
ratings (CVSS, GitHub "high") are inputs, not the answer: rate by what an attacker can do *in this deployment*, and say why when you
differ from the scanner.

## 7. Method and finding template

**Method (the same as rounds 1 and 2): audit, attack with a failing test, fix test-first, regression test, document.**

1. Reproduce with the smallest request or script. Save the exact request and the response (no secrets).
2. Write the attack as a test that asserts the **secure** behaviour and watch it **fail for the right reason**. Server findings go in
   `server/tests/security/round3/<id>-<slug>.sec.test.ts` (picked up by `npm run test:security -w server`, real PostgreSQL); client findings in
   `client/src/__security__/round3/`; deployment findings that code cannot test become a check in `scripts/security/` or a line in
   `scripts/verify-deployment.mjs` / `server/scripts/verify-deployment.mjs`.
3. Fix with the smallest change that removes the root cause (not just the payload). Prefer a rule that cannot be forgotten (a schema
   limit, a helper, a lint rule, a test that scans the code) over a per-route patch.
4. Run the test green, then the surrounding suites (`npm test -w server`, `npm run test:security -w server`, `npm run test:integration -w server`, `npm run test:contract -w server`, `npm test -w client`, typecheck and lint).
5. Re-run the tool that found it (`rbac-live.mjs`, `static-scan.mjs`, ZAP, the manual step) and attach the green output.
6. Update [SECURITY_AUDIT.md](SECURITY_AUDIT.md) (a "Round 3" table in the same format as round 2), and [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md)
   if the fix changes a setting, a decision (section 6), a gate (section 7) or an operational step. A fix that adds a regex, a limiter or a matcher
   needs its own attack test: those were the three places round 2 found bypasses *in the round 1 fixes*.
7. If a finding is not fixed now, add a dated, owned, expiring entry to `scripts/security/audit-allowlist.json` (dependencies) or an explicit
   line in the open-items table, never silence the tool.

**Finding template** (copy to `findings/R3-NN.md` in the evidence bundle, and a one-line row into SECURITY_AUDIT.md when fixed):

```
ID:              R3-NN
Title:           <what is wrong, in one line>
Severity:        Critical | High | Medium | Low   (why; scanner rating if different)
Phase / where:   <phase letter, file or endpoint, host>
Evidence / PoC:  <exact request(s) and response(s), command, version/commit; no secrets>
Root cause:      <why it happens, in the code or configuration>
Impact:          <who can do what to whom, in this deployment>
Fix:             <the change; link to the commit when done>
Regression test: <path of the test that fails without the fix>
Status:          Open | Fixed (commit) | Mitigated (how, until when) | Accepted (owner, date, expiry) | Not an issue (why)
```

## 8. Carry-over from round 2

The items of "Open items round 2 did not change" in [SECURITY_AUDIT.md](SECURITY_AUDIT.md), with where each is re-checked:

| Item | State now | Re-check |
|---|---|---|
| Pre-hijack via the verify-email link | **Closed 2026-11-12 (R3-06; tested with verification on and off).** Believed closed: verification required in production, link needs the registration password, an unused unverified registration is replaced (PRODUCTION_CHECKLIST decision 2) | C3 |
| Notification spam (follow/unfollow, react/unreact loops) | **Closed 2026-11-12 (R3-07).** Was: open, product decision; the Kafka bus now carries every notification | E7, F5 |
| Tag stripping removes `List<String>` and similar text | Open by design (strip, not encode); encoding on output would fix it | D1 |
| 56 `api.*` calls interpolate ids without `encodeURIComponent` | **Closed 2026-11-12 (R3-10, client test).** Was: open (no escalation found); wants a lint rule | D9 |
| Password policy (about 50 deny-listed entries, no NFKC) | **Closed 2026-11-12 (R3-08).** Was: open, policy decision | C9 |
| `userAddPhoto` stores the file before validating the caption (orphan files) | **Closed 2026-11-12 (R3-09).** Was: open; `npm run uploads:cleanup -w server` removes orphans | D3 |
| CSP `script-src 'unsafe-inline'`, `img-src https:`, `media-src` blocks external video | Open until Next nonce support (the Next upgrade); ZAP rule 10055 kept visible as INFO | B1, G4 |
| LinkedIn OAuth scopes | **Closed: the feature was removed (2026-11-09)** | B6 (leftovers) |
| `sharp` listed in both `client/package.json` and `server/package.json` | Open, hygiene; the client sets `images.unoptimized` | B1, R3-04 |

And the launch gates of PRODUCTION_CHECKLIST section 7 that this round measures but does not close: Next.js 14 to 15.5.x/16 (R3-02),
tokens out of `localStorage` (C8), CAPTCHA/WAF in front of sign-up and sign-in (C6), an independent penetration test.

## 9. First round-3 findings (already known)

Produced by `node scripts/security/static-scan.mjs` on 2026-11-11 and investigated by reading `client/next.config.js`,
`client/package.json`, `server/package.json`, both Dockerfiles, `server/src/utils/validators.ts` and by measurement.
Baseline of `npm audit --omit=dev`: **1 critical, 11 high, 2 moderate, 1 low** (package level), which are **3 critical + 16 high
advisories** at advisory level. The 19 are in `scripts/security/audit-allowlist.json` with a reason and an expiry of 30 to 60 days; five
of them were marked `needs-fix` because they are real; all five are fixed or mitigated (below) and the allowlist now carries no `needs-fix` entry.

| ID | Sev | Finding | Evidence and analysis | Fix | Status |
|---|---|---|---|---|---|
| **R3-01** | Medium | **Unbounded arrays let one member force a ~280 MB allocation and a 38 MB response.** `createJobSchema.skills` (`POST /jobs`, any approved member) and `createEventSchema.tags` (`POST /events`, chapter admin and above) are `z.array(z.string())` without `.max()`. zod records an issue for every failing element and `middleware/validate.ts` returns all of them | Measured offline on the installed zod 3.25.76: a 1 MB body `{"skills":[1,1,...]}` (500,000 elements) gives 500,000 issues, about 280 MB of heap, about 0.6 s of CPU and a 37.9 MB error body. The 1 MB body limit bounds one request, not ten in parallel. The GitHub advisory GHSA-mrhx-c7xc-m3w5 is written for zod 4's `$ZodArray`; the repo uses the zod 3 API, so the named code is not run, but the same behaviour reproduces on zod 3 | `.max()` on both arrays (and on every other `z.array`/`z.record` that reaches a request body, D8); cap the issues `validate.ts` returns (first 20); regression test in `server/tests/security/round3/` | **Fixed 2026-11-11.** `boundedList` (limit checked before the elements) on job `skills` (50 x 100 chars), event `tags` (20 x 50) and post media on update (10); `validate` returns at most 20 truncated details. Test: `server/src/__tests__/utils/boundedLists.test.ts` (a 200,000-element body yields at most 5 issues). |
| **R3-02** | Medium (GitHub: high) | **Next.js 14.2.35 has unfixed denial-of-service advisories reachable by anyone who can reach the web port** (GHSA-h25m-26qc-wcjf, GHSA-q4gf-8mx6-v5v3, GHSA-8h8q-6873-q5fj: React Server Components request handling). Fixed only in 15.5.x/16 | The app is an App Router app (`client/src/app`) and nginx forwards `/` to Next, so the code is on the request path. Availability of the web tier only (the API is a separate process and every API route is authorised by the API). The 3 critical advisories (Image Optimization RCE for SVG and AVIF, GHSA-2464-fhr4-w9xw and GHSA-2xp9-vwfh-vxw4) are **not reachable**: `images.unoptimized: true`, no `remotePatterns`, pinned by `client/src/__tests__/next-config-headers.test.ts`, `/_next/image` answers 404 (checked on the local web server 2026-11-11; confirm on the built stack in D2). The Windows RCE (GHSA-p293-qw3h-jr36) needs a Windows host; production is `node:20-alpine`. No `'use server'` exists in `client/src`, so the Server Action advisories are unconfirmed (treated as reachable until the upgrade) | The Next.js major upgrade (gate item 1 of PRODUCTION_CHECKLIST section 7); interim: container restart policy, nginx timeouts, a WAF/rate limit on `/` | **Fixed 2026-11-11** by upgrading Next 14.2.35 to 15.5.29 (`params` awaited in `events/[id]/layout.tsx` and `profile/[id]/page.tsx`; 1,507 client tests, typecheck and the production build pass). Production audit: 0 critical. Two advisories that affect every 15.5 release remain and are not reachable here: the image-optimizer RCE (`images.unoptimized`, pinned by a test) and Server Actions DoS (no `use server`). Next 16 is the only release that removes them. |
| **R3-03** | Medium, unconfirmed (High if internal reach is shown) | **WebSocket-upgrade SSRF advisory of Next.js (GHSA-c4j6-fc7j-m34r) may be reachable through nginx.** `nginx/nginx.conf` sets `Upgrade`/`Connection` for `location /` (the web container), not just `/socket.io/` | Reading the config only; not yet tested. D2/G4 send `Upgrade: websocket` requests to `/` and `/_next/` from a tailnet host and observe whether Next connects anywhere | Stop forwarding `Upgrade` on `/` (only `/socket.io/` needs it); the Next upgrade | **Fixed 2026-11-11.** `location /` no longer forwards `Upgrade`/`Connection`: only `/socket.io/` (to the API) is upgraded. Test: `server/tests/ops/infrastructure.test.ts`. |
| **R3-04** | Low | **Build and lint tools sit in `client/package.json` `dependencies`** (`eslint`, `eslint-config-next`, `typescript`, `@types/*`, plus `autoprefixer`, `postcss`, `tailwindcss`), so a production audit reports them: **9 of the 11 high-severity packages** (`@next/eslint-plugin-next`, `eslint-config-next`, the `@typescript-eslint/*` chain, `glob`, `minimatch`) are this one hygiene problem. Also `sharp` is declared in both client and server | They never ship (the web image copies only Next's standalone output) and the advisories (`glob -c` command injection, minimatch ReDoS) need attacker-chosen patterns or the CLI, so none is exploitable; but the noise hides real findings and any install without `--omit=dev` gets the tools | **Moving them to `devDependencies` is the real fix** (`npm ci` in `client/Dockerfile` still installs dev dependencies for the build); then the allowlist entries for `glob`, `minimatch` can be removed | **Fixed 2026-11-11.** Eleven build-only packages moved to `devDependencies`; production audit 15 findings to 5 (with the Next upgrade, 0 critical). |
| **R3-05** | Medium (predicted, confirm with the `images` job) | **The API image ships the whole development tree.** `server/Dockerfile` copies the builder's complete `node_modules` into the runtime image because `prisma` and `tsx`, needed at start (`docker-entrypoint.sh` runs `prisma migrate deploy` and optionally `tsx prisma/seed.ts`), are `devDependencies`. The image therefore also holds `jest`, `ts-jest`, `supertest`, `eslint`, `typescript` and their transitive advisories | Read from the Dockerfile and `server/package.json`; Trivy on the image (B4, CI job `images`) is expected to report HIGH findings in those packages. Not yet run: there is no Docker on the development machine | Move `prisma` and `tsx` to `dependencies`, install production dependencies in their own stage (`npm ci --omit=dev`) and copy only that; re-run the `images` job | **Fixed 2026-11-11** (not yet proven on real Docker): `prisma` and `tsx` are runtime dependencies and the Dockerfile runs `npm prune --omit=dev` after the build. The npm behaviour was simulated (jest, eslint, typescript removed; prisma, tsx, @prisma/client kept; 457 to 266 packages). Confirm with the `images` job and the docker-verify run. |
| **R3-06** | Medium | **The verification link verified an attacker's registration of somebody else's address when `REQUIRE_EMAIL_VERIFICATION` is off** (C3) | Attacker registers the victim's address; the victim clicks the mailed link: 200, the account is verified and keeps the attacker's password, name and note; approval then does not check the mailbox in this mode. With verification required the attack was already stopped (tested) | The link needs the registration password in every mode (`authService.verifyEmail`); the owner takes the address back with "Forgot password". **Open, `memberApprovalService`:** refuse approval without `emailVerifiedAt` in every mode | **Fixed 2026-11-12.** Tests: `server/tests/security/round3/prehijack-verify-link.sec.test.ts` |
| **R3-07** | Low | **Notification spam loops** (carry-over, E7/F5) | RSVP/cancel, comment/delete, mention removed and re-added by editing, message floods, mentorship request after each decline and a parallel burst of comments each notified every time | `notifyOnce` extended with a per-notice window and an in-process claim in front of the database lookup (`utils/cooldownStore.ts`); one notice per actor and subject per day (30 min comments, 10 min messages) | **Fixed 2026-11-12.** Tests: `notification-cooldown.sec.test.ts`, `socialNotifications.test.ts` |
| **R3-08** | Low | **Password deny-list was not Unicode-normalised** (C9) | Full-width, accented, combining-mark and zero-width variants of `Password1` were accepted | `policyForm()` (NFKC, marks and format characters removed, case folded) for the policy checks only; hashing and login untouched | **Fixed 2026-11-12.** Test: `src/__tests__/utils/password.test.ts` |
| **R3-09** | Low | **`userAddPhoto` stored files before validating the caption** (D3) | A repeated multipart `caption` answered 400 after the files were written | Caption validated first; a file whose record fails is removed | **Fixed 2026-11-12.** Test: `gallery-caption-orphan.sec.test.ts` |
| **R3-10** | Low | **38 `api.ts` calls interpolated ids without encoding** (D9) | `/posts/${id}` with `x/../../admin/...` changes the endpoint the member's token is sent to | `seg()` everywhere; a client test fails on any new un-encoded API path segment | **Fixed 2026-11-12.** Test: `client/src/__security__/round3/api-path-encoding.test.ts` |
| **R3-11** | Medium | **Kafka notification and dead-letter topics had no retention** (F6, H2) | Topics carry addresses, applicant names and rejection reasons; `createTopics` leaves an existing topic alone | `retention.ms` = 7 days (`KAFKA_RETENTION_MS`) on create and enforced on existing topics (`describeConfigs`/`alterConfigs`); a refusing broker is logged, not fatal | **Fixed 2026-11-12** (fake kafkajs; not yet run against a real broker: confirm with `kafka-configs --describe` on `atreya-2`). Test: `src/__tests__/config/kafka.test.ts` |
| **R3-12** | Low | **The notification consumer accepted any link and any size** (F3) | `javascript:`, external and `//host` links, 1 MB titles and 5 MB metadata were stored. Only server code produces events (pinned by a scan) | Link must be a site path; title, message and metadata bounded; checked at build and at consume | **Fixed 2026-11-12.** Test: `notification-events.sec.test.ts` |
| **R3-13** | Medium | **Broadcasts went to applicants waiting for approval and to rejected ones** (F4) | `fanOutNotification` selected every `isActive` account | `approvalStatus: APPROVED` in the fan-out | **Fixed 2026-11-12.** Test: `notification-events.sec.test.ts` |
| **R3-14** | Low | **Two upload inputs answered HTTP 500** (D3, D8) | A NUL byte in a file name (`Malformed part header`) and a zero-byte file | Multipart parser errors map to 400 `INVALID_MULTIPART`; an empty upload is 400 | **Fixed 2026-11-12.** Tests: `errorHandler.test.ts`, `storage.test.ts`, `uploads.sec.test.ts` |
| **R3-15** | Low | **The magazine uploader accepted any bytes with a `.pdf` name** (D3) | HTML, SVG or ZIP stored under `application/pdf` (served with `nosniff`, so not runnable; administrators only) | `assertPdfFile`: `%PDF-` within the first 1,024 bytes | **Fixed 2026-11-12.** Tests: `storage.test.ts`, `uploads.sec.test.ts` |
| **R3-16** | Low | **The data export omitted post views and `isNotable`** (H3) | `PostImpression` rows are deleted with the account but were not exported | Added; a scan forces a decision for every user-referencing model and `User` column | **Fixed 2026-11-12.** Test: `privacy-coverage.sec.test.ts` |

Not gated (moderate or low), listed so that they are not forgotten: `qs` (4 advisories; Express's parser, DoS-class, bounded by the 1 MB body limit
and `express` upgrades), `uuid` < 11.1.1 (GHSA-w5hq-g745-h8pq: only when a buffer is passed to `v3/v5/v6`; the API uses `v4`),
`esbuild` (GHSA-g7r4-m6w7-qqqr: Windows dev server only, via `tsx`), and the moderate Next.js advisories that fall away with the upgrade.

**Hand-off note on the tooling:** `node --test scripts/security/__tests__/` works on Node 20 (what CI runs) and fails on Node 22+, where a
directory is read as a file; use `node scripts/security/run-tests.mjs` there.

## 10. Sign-off checklist

The round is closed when **every** box is ticked and the evidence bundle exists. Date and initial each line.

- [ ] Phases A to I executed on the `atreya-2` stack (or CI); every checklist item has a verdict file under `manual/`.
- [ ] `static-scan.mjs` green: no non-allowlisted critical/high, no expired entry; every `needs-fix` entry has a fix merged or a dated decision to extend it **with a reason that changed**.
- [ ] gitleaks over the full history: zero findings, or only the documented, rotated historical password with its fingerprint recorded.
- [ ] hadolint: no errors. Trivy images: no fixed CRITICAL/HIGH (`security.yml` job `images` green).
- [ ] `rbac-report.json`: all five assertions pass, nothing "not run", plain-admin identity included.
- [ ] ZAP baseline: no FAIL-rule alert; every WARN alert read and either fixed or added to `zap-rules.tsv` with a reason.
- [ ] `docker-verify` green (functional gates and the Kafka drills, run once without `--skip-drills`).
- [ ] Every finding R3-NN has a regression test that fails without its fix, a status, and a row in SECURITY_AUDIT.md (Round 3 table).
- [ ] PRODUCTION_CHECKLIST.md updated for every changed setting, gate or decision.
- [ ] All server, client and tooling suites green: `npm test -w server`, `npm run test:security -w server`, `npm run test:integration -w server`, `npm run test:contract -w server`, `npm test -w client`, `node scripts/security/run-tests.mjs`.
- [ ] No secret in the evidence bundle (search it: `rg -i "password|secret|bearer|BEGIN .* KEY" audit-evidence/`) and `verify-report/private/` was not copied.
- [ ] Test stack removed (`docker compose down -v` on the host) and the test accounts are gone.
- [ ] The owner has read the findings list and the open-items table and signed.

## 11. Evidence bundle

Collect everything into one dated folder (CI uploads the first four as artifacts named `security-report`, `rbac-report`, `zap-report`,
`verify-report`; copy them from the run page):

```
audit-evidence/2026-MM-DD/
  security-report/          static-scan.json, static-scan.md, npm-audit.json, gitleaks.json, hadolint.json, trivy.json
  rbac-report.json          the live probe: summary, every request/verdict, what was deliberately not sent
  zap-report/               zap.html, zap.json, zap.md, zap-rules.tsv (the rules used)
  verify-report/            docker-verify output (the private/ folder with test credentials is NEVER included)
  manual/                   A-threat-model.md, B-*.md ... I-*.md: command, trimmed output, verdict per checklist item
  findings/                 R3-NN.md, one per finding, in the template of section 7
  SIGN-OFF.md               the checklist of section 10, dated, with the commit hash that was audited and the owner's signature
```

Rules for the bundle: record the commit (`git rev-parse HEAD`), the date, the target and the tool versions at the top of `SIGN-OFF.md`; never include
tokens, passwords, keys, `.env` files, or real personal data; keep response bodies out unless needed to show a leak, and then trim them to the
offending field.
