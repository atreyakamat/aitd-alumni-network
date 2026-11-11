# Docker and Kafka test guide (hand-over)

This guide is for whoever runs the AIEM Connect stack on a Docker machine (the Linux box `atreya-2`, or a GitHub runner) and has to
**prove that it works**, and **fix it if it does not**. It can be followed by a person or handed to an AI agent as it is.

The proof is a folder (`verify-report/`) produced by one command. Nothing in this guide asks you to trust anybody's word: every claim
is a gate that either passed or failed, with the evidence next to it and a checksum list so the evidence cannot be altered afterwards.

* The same suite runs in GitHub CI on every pull request ([workflow](../.github/workflows/docker-verify.yml)), so the result can be
  compared with a run on another machine.
* The security audit that follows this guide is [SECURITY_AUDIT_PLAN.md](SECURITY_AUDIT_PLAN.md).

## 1. Rules for whoever runs this

1. **Test machine and test data only.** The suite creates its own compose project (`aiem-verify`) with its own volumes, random
   secrets and fake `@aiem.test` addresses. It never touches a real stack on the same machine (a different project name), and it must
   never be pointed at production.
2. **Never paste secrets into a chat, a ticket or a commit.** The suite redacts its own secrets from the evidence; keep it that way.
   Credentials of the test stack live only in `verify-report/private/` (never uploaded, never in the checksum list).
3. **Do not weaken a test to make it pass.** A failed gate is information. Fix the cause (section 7) and rerun. Editing a gate, the
   expectations, or the compose files so that a check stops failing is only acceptable when you can say why the check was wrong, and
   that reason goes into the commit message and the report to the owner.
4. **Stop and report** instead of improvising when: a command would delete or change something outside the `aiem-verify` project; a
   fix needs a decision from the owner (a change of behaviour, not a bug); you cannot tell whether a failure is the machine or the code.
5. **Test-first.** When a failure is a code defect, write the failing test first (the repository convention, see
   [TESTING.md](TESTING.md)), then the fix, then rerun the gate that failed, then the whole suite.

## 2. What the machine needs

| Need | Check with | Minimum |
|---|---|---|
| Docker Engine | `docker version` | 24 |
| Docker Compose v2 (a plugin: `docker compose`, not `docker-compose`) | `docker compose version` | 2.20 |
| Node.js (runs the suite itself; the application runs in containers) | `node -v` | 20 |
| git | `git --version` | any |
| Memory | `free -h` | 3 GB (Kafka 512 MB heap, API, web, PostgreSQL, Redis, nginx) |
| Free disk | `df -h .` | 8 GB (images and volumes) |
| Your user may use Docker | `docker ps` works without `sudo` | member of the `docker` group |
| Internet to pull images on the first run | `docker pull hello-world` | |
| Free ports | `ss -tlnp` | 80, 3000, 5000, 5432, 8025 (or choose others, section 5) |

The suite checks all of this itself in its first gates and says what is missing. If Node is missing on a Debian/Ubuntu box:
install Node 20 from NodeSource or with `nvm install 20`.

**Reaching it over Tailscale.** From another device on the tailnet the app is `http://atreya-2` (MagicDNS name; use the Tailscale IP if
MagicDNS is off). Port 80 (nginx) and 3000 (web) are published on every interface by design; everything else is bound to `127.0.0.1` or
not published at all (a gate checks this). Do **not** enable Tailscale Funnel for these ports. Use an SSH tunnel for the mail catcher:
`ssh -L 8025:127.0.0.1:8025 atreya-2`, then open `http://127.0.0.1:8025`.

## 3. Get the exact code

```bash
git clone https://github.com/atreyakamat/aitd-alumni-network.git && cd aitd-alumni-network   # first time
git fetch origin && git checkout <branch or commit the owner named>
git status --short            # must print nothing: the report records a dirty tree as such
git rev-parse HEAD            # write this down: the report must show the same commit
```

Run the suite on a **clean checkout of a commit that exists on GitHub**, so the owner can compare it with the CI run of the same commit.

## 4. Check the suite itself (no Docker needed, about 10 seconds)

```bash
node --test scripts/docker-verify/__tests__/libs.test.mjs scripts/docker-verify/__tests__/gates.test.mjs
```

These run every gate against an in-memory stand-in of the whole stack and plant defects to prove each gate can fail. If this fails the
scripts are broken, not the application: stop and report.

## 5. Run it

```bash
node scripts/docker-verify/run.mjs --host atreya-2
```

A first run builds the images (6 to 10 minutes) and takes 15 to 25 minutes in total. For a long run use `nohup` or `tmux`:

```bash
nohup node scripts/docker-verify/run.mjs --host atreya-2 > run.log 2>&1 &
tail -f run.log
```

| Option | Meaning |
|---|---|
| `--host <name>` | The name browsers use to reach the stack (used for the web address baked into the web image and for CORS). Use `atreya-2`. |
| `--skip-drills` | Skip the break-it-on-purpose gates (about 8 minutes shorter). Do not use this for the proof run. |
| `--keep` | Leave the stack running afterwards (for the security scans and for manual checks). Writes `verify-report/private/credentials.json`. |
| `--no-build` | Reuse images that are already built (a rerun after a config-only fix). |
| `--proxy-port/--web-port/--api-port/--postgres-port/--mailpit-port N` | Move the stack to other host ports when the defaults are taken. |
| `--down` | Remove the verification stack and its data, then exit. |
| `--attach <api url> ...` | Run only the HTTP gates against a stack that is already running (no Docker). |

The exit code is 0 only when no gate failed. Each line shows `PASS`, `FAIL` or `SKIP` and why.

## 6. What the gates prove

| Gates | What they prove | If one fails, look at |
|---|---|---|
| **P01 to P03** | Docker and Compose are recent enough, the machine has memory and disk, the ports are free | the message names the missing thing |
| **S01, S02** | `docker compose config` is valid; every image builds and every health check turns healthy | `evidence/compose-up.log`, `evidence/compose-up-failure-logs.txt` |
| **S03** | Every service runs, is healthy and has not restarted (no crash loop) | `evidence/containers.tsv`, `evidence/logs-<service>.txt` |
| **S04** | The API and web containers do not run as root | the Dockerfiles |
| **S05** | PostgreSQL, the API and the mail catcher are bound to `127.0.0.1`; Redis and Kafka are not published at all | `evidence/published-ports.tsv`, `docker-compose.yml` |
| **A01 to A05** | `/health` reports database, Redis and Kafka up; the web app serves its pages branded AIEM Connect; the read-only deployment checks (`server/scripts/verify-deployment.mjs`: headers, CORS, private community, receipts) pass; the seeded administrator signs in; System status is green | `evidence/verify-deployment.txt`, `evidence/system-status.json` |
| **K01, K02** | Both topics exist with the configured partitions; the consumer group has joined | `evidence/consumer-group.txt`, `docker compose -p aiem-verify logs api` |
| **F01 to F04** | A real registration, as an applicant would do it: verification e-mail read from the mail catcher and used; the applicant, the administrator **and the shared office mailbox** are told (through Kafka); a pending applicant cannot sign in; approval and rejection e-mails arrive (the rejection with its reason); the administrator's "new registration" notice is cleared by the decision | `evidence/mail-subjects-applicant-a.txt`, the mail catcher |
| **K03** | The consumer has caught up (no backlog) | `evidence/consumer-group-after-flows.txt` |
| **D01, D02** | **Broker outage:** with Kafka stopped, registration still answers quickly, everyone is still told (in-process fallback) and `/health` admits Kafka is down; after Kafka returns, the next registration travels through it and the backlog is zero | `logs-api.txt`, `logs-kafka.txt` |
| **D03** | **Poison messages:** an unparseable message and a well-formed but invalid event both land in the dead-letter topic, and the consumer keeps working | `evidence/dead-letter-topic.txt` |
| **D04** | **Duplicates:** the same event delivered twice produces one notification | |
| **D05** | **API down:** an event produced while the API is stopped is delivered once when it comes back (committed offsets) | |
| **D06** | Restarting Kafka and PostgreSQL loses nothing (topics, accounts) and the API reconnects by itself | |
| **D07** | **Redis down:** the API keeps serving; Redis comes back | |
| **D08** | `docker compose down` then `up` (without `-v`) keeps accounts, sessions, topics and the consumer group | |
| **X01** | No generated secret appears in any container log | `evidence/all-container-logs.txt` (redacted) |
| **X02** | The password-reset limiter engages after repeated requests from one address | |
| **X03** | The Kafka log has no unexplained errors | `evidence/kafka-errors.txt` |

**What this does not prove:** a multi-broker cluster (set `KAFKA_REPLICATION_FACTOR=3` and test it separately), a real SMTP server
(section 9), TLS and a public domain, performance under load, or the security of the application (that is the audit).

## 7. When a gate fails: the fix loop

1. **Read `verify-report/REPORT.md`.** The "Failures" section lists each failed gate with its message and evidence files.
2. **Classify it.**
   * *The machine:* not enough memory (Kafka or the web build is killed: look for `OOMKilled`, `exit code 137`), ports taken, no
     internet, a Docker version that is too old, a time-out on a slow disk. Fix the machine, not the code.
   * *The suite:* a gate that is wrong (an e-mail subject was reworded, a route renamed). The guard tests catch most of these; fix the
     gate and its test together, and say so in the report.
   * *The application or its configuration:* a real defect. Continue below.
3. **Reproduce with the stack up and look at it.**
   ```bash
   node scripts/docker-verify/run.mjs --host atreya-2 --keep --skip-drills      # leaves the stack running
   docker compose -p aiem-verify ps
   docker compose -p aiem-verify logs --tail 200 api
   docker compose -p aiem-verify logs --tail 200 kafka
   ```
   The project flag `-p aiem-verify` and the env file `verify-report/private/.env.verify` are what the suite used; add
   `--env-file verify-report/private/.env.verify -f docker-compose.yml -f docker-compose.test.yml --profile proxy` to any compose command
   that needs variables (`up`, `config`).
4. **Write the failing test first**, in the application's own suites when it is a code defect (see [TESTING.md](TESTING.md)); in
   `scripts/docker-verify/__tests__/` when it is a gate. Make it fail for the reason you found.
5. **Fix, then rerun the failed area**, then the whole suite. Use `--no-build` after a change that needs no rebuild.
6. **Report back to the owner** with the template below. Never reply "it works now" without the new `REPORT.md`.

```
Gate:            <id and title>
Commit:          <git rev-parse HEAD>   (clean tree: yes/no)
What failed:     <the message from REPORT.md>
Evidence:        <file names from verify-report/evidence/>
Cause:           <machine | suite | application>, one sentence, with the line of log that shows it
Fix:             <files changed, the test that now guards it>
Re-run:          <command> -> PASS/FAIL, <counts>
Needs a decision: <anything the owner must decide>
```

## 8. The proof the owner receives

A proof run is **complete** when all of this is true and handed over together:

1. `verify-report/REPORT.md` says **PASS** with **0 failed and 0 skipped**. (A full run on the Docker host skips nothing; skips
   only appear with `--skip-drills` or `--attach`, and a run with skips is not a proof run.)
2. The commit in the report equals the commit the owner expects, and the tree was not dirty.
3. The folder is intact: `cd verify-report && sha256sum -c manifest.sha256` prints `OK` for every file.
4. The same commit is green in GitHub CI (Actions, "Docker and Kafka verification"): the owner compares the two reports.
5. The owner has done the manual acceptance from section 9 once with their own eyes.

Send `verify-report/` (it contains no secrets: the private folder is excluded from the checksum list; delete `private/` before sharing).

## 9. Manual acceptance (about 10 minutes, with `--keep`)

Run `node scripts/docker-verify/run.mjs --host atreya-2 --keep` and then, from the owner's own device on the tailnet:

1. Open `http://atreya-2`. Check the sign-in page and the donation page load, branded AIEM Connect.
2. Register a new alumnus with a real-looking name. Open the mail catcher through the SSH tunnel and follow the verification link from the e-mail.
3. Sign in as the administrator (`verify-report/private/credentials.json`): the bell shows "New registration to review"; open
   Admin, Approvals; approve. The applicant's approval e-mail appears in the mail catcher and the applicant can sign in.
4. Open Admin, System status: everything "Working" (payments "Not in use" is expected).
5. `docker compose -p aiem-verify stop kafka`; register another person: it must still work. `docker compose -p aiem-verify start kafka`.
6. Remove everything: `node scripts/docker-verify/run.mjs --down`.

**Real SMTP (not covered by the suite, which uses the mail catcher).** Once, with the production settings: copy `.env.docker.example` to a
private `.env`, set the real `SMTP_*` (or `SENDGRID_API_KEY`), `APPROVAL_NOTIFY_EMAIL` and the real `FRONTEND_URL`, run `docker compose up -d --build`
(without the test overlay), register with an address you own and confirm that the e-mails arrive (verification, then the
"received" e-mail, and the administrator's "new registration" e-mail). Admin, System status shows the e-mail line as "Working" when a mail
server is configured.

## 10. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `already in use on this machine: proxy :80` | Another service uses the port. Stop it or pass `--proxy-port 8080` (and the others). |
| `docker compose up failed` with `exit code 137` or `Killed` during the web build | Out of memory: the Next.js build needs about 2 GB. Add swap (`fallocate -l 4G /swapfile` ...) or close other containers. |
| `compose ps failed` / `unknown shorthand flag: 'p'` | Compose v1 (`docker-compose`). Install the v2 plugin: `apt install docker-compose-plugin`. |
| Kafka never turns healthy | `docker compose -p aiem-verify logs kafka`: usually too little memory (heap 512 MB) or a leftover volume from an older broker version. `--down` removes volumes. |
| The API restarts in a loop | `logs api`: a production configuration check refused the settings (the message says which); the test overlay sets `ALLOW_INSECURE_PRODUCTION_CONFIG=true` for exactly the checks that need https and a domain. Any other check that fires is a real finding. |
| 429 `RATE_LIMITED` in a gate | You reran within 15 minutes against the same stack. The suite starts with `down -v`, which resets the counters; do not reuse a stack. |
| Image pull fails (`manifest unknown`) | A pinned version is gone. The versions are in `docker-compose.yml` and `docker-compose.test.yml` (Mailpit); bump the tag and rerun. |
| `permission denied ... docker.sock` | The user is not in the `docker` group: `sudo usermod -aG docker $USER`, then log in again. |
| Gate F01 times out waiting for a mail | `logs api` (SMTP errors) and the mail catcher; check that `SMTP_HOST=mailpit` is in `docker compose config` output. |

## 11. A prompt to hand to an agent on atreya-2

> You are verifying AIEM Connect on this machine. Read `docs/DOCKER_TEST_GUIDE.md` completely and follow it exactly. The repository is
> already cloned in the current folder. Work on the commit the owner named, with a clean tree. Run section 4, then the full run in section 5
> (`--host atreya-2`), and report the result. If a gate fails, follow section 7: classify, write the failing test first, fix, rerun, and report
> with the template. Never edit a gate or an expectation merely to make it pass, never touch anything outside the `aiem-verify` compose
> project, never print or paste secrets, and stop and ask the owner when a fix needs a decision. When the run is green, produce the proof
> described in section 8 and stop. Do not start the security audit until the owner says so.

## 12. After a green run

* Tell the owner. Update [KAFKA.md](KAFKA.md) ("Honest limits": the stack has now been run against a real broker, with the commit and date of the
  evidence) and the Kafka row of [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md) decision 13.
* Run the security audit against the kept stack: [SECURITY_AUDIT_PLAN.md](SECURITY_AUDIT_PLAN.md).
