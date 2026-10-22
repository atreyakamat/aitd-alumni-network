# Running AITD Connection with Docker Compose

`docker-compose.yml` runs the whole platform: **PostgreSQL 17**, **Redis 7**, the **API** (Express + Prisma +
socket.io) and the **web** app (Next.js), plus an optional **nginx** reverse proxy. This is the canonical deployment
guide. The root `DEPLOYMENT_*.md` files describe the old MySQL shared-host setup and are superseded.

## Quick start

```bash
cp .env.docker.example .env
# Generate each secret with:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
# then set POSTGRES_PASSWORD, JWT_SECRET, JWT_REFRESH_SECRET and SEED_ADMIN_PASSWORD (12+ chars) in .env

docker compose up -d --build
docker compose ps            # wait until api and web are "healthy"
docker compose logs -f api
```

| Service | URL / port | Notes |
|---|---|---|
| web | http://localhost:3000 (`WEB_HOST_PORT`) | Next.js standalone server |
| api | http://localhost:5000 (`API_HOST_PORT`) | `/api/*`, `/socket.io`, `/uploads`, `/health` |
| postgres | `127.0.0.1:5432` (`POSTGRES_HOST_PORT`) | bound to localhost only, for psql / Prisma Studio |
| redis | not published | internal cache |
| nginx | http://localhost (`PROXY_HOST_PORT`) | only with `--profile proxy` |

Sign in at http://localhost:3000/login as `SEED_ADMIN_EMAIL` with `SEED_ADMIN_PASSWORD`.

## What happens on start

1. `postgres` and `redis` start; the API waits for both health checks.
2. The API entrypoint (`server/docker-entrypoint.sh`) retries `prisma migrate deploy` until the database answers
   (`DB_WAIT_ATTEMPTS`, default 30 × 2 s), so pending migrations are always applied before the server starts.
3. With `SEED_ON_START=true` **and** `SEED_ADMIN_PASSWORD` set, it runs the seed. The seed is idempotent: it creates the
   super admin, membership tiers, skills and chapters, never resets an existing password, and on re-runs only
   re-asserts the admin's role and active/verified flags. With an empty `SEED_ADMIN_PASSWORD` the seed is skipped and a
   warning is logged. Then no admin account exists.
4. `node dist/index.js` starts. On `docker compose stop` it shuts down gracefully: socket.io and HTTP stop
   accepting connections, in-flight requests finish, Prisma and Redis disconnect, and the exit is forced after
   `SHUTDOWN_TIMEOUT_MS` (default 8 s, inside Docker's 10 s grace period).
5. `web` starts once the API is healthy.

## Configuration (`.env`)

| Variable | Required | Purpose |
|---|---|---|
| `POSTGRES_PASSWORD` | yes | Database password. Use URL-safe characters (the generator above): it is embedded in `DATABASE_URL`. |
| `POSTGRES_DB`, `POSTGRES_USER` | no | Default `alumni_connect` / `aitd`. |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | yes | 32+ random characters each; the API refuses to start in production otherwise. |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | password yes | First super admin. Password 12+ characters. |
| `SEED_ON_START` | no | `true` (default) runs the idempotent seed on every start. |
| `SEED_SAMPLE_DATA` | no | `true` adds demo alumni, events and news. Not for production. |
| `FRONTEND_URL` | yes for real hosts | Public web URL, used in emails and OAuth redirects. |
| `CORS_ORIGINS` | yes for real hosts | Comma-separated origins allowed to call the API. Must include the web URL exactly. |
| `NEXT_PUBLIC_API_URL` | yes for real hosts | API URL **as browsers see it**. Baked into the web image at **build** time, so rebuild (`--build`) after changing it. |
| `GEOCODER_URL`, `GEOCODER_EMAIL` | no | Place search for the map. Defaults to OpenStreetMap Nominatim; `off` disables it. Use a self-hosted Nominatim for heavy traffic. |
| `NEXT_PUBLIC_MAP_TILE_URL`, `NEXT_PUBLIC_MAP_TILE_ATTRIBUTION` | no | Map tile server (default `https://tile.openstreetmap.org/{z}/{x}/{y}.png`). Build-time. |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | for payments | Webhook URL: `https://<api-host>/api/payments/webhook/razorpay` (events `payment.captured`, `order.paid`, `payment.failed`). Without the secret the webhook answers 503. |
| `SENDGRID_API_KEY` or `SMTP_*`, `EMAIL_FROM` | for email | Verification, reset, invites and receipts. |
| `AWS_*` | no | S3/R2 uploads; otherwise files go to the `uploads_data` volume. |
| `GOOGLE_*`, `LINKEDIN_*` | no | OAuth sign-in. |
| `WEB_HOST_PORT`, `API_HOST_PORT`, `POSTGRES_HOST_PORT`, `PROXY_HOST_PORT` | no | Host port mappings. |

The compose file also sets `API_INTERNAL_URL=http://api:5000/api` for the web container (server-side fetches) and
`DATABASE_URL` / `REDIS_URL` for the API. Do not set those yourself.

## Single origin behind nginx

```bash
# .env
FRONTEND_URL=https://alumni.example.edu
CORS_ORIGINS=https://alumni.example.edu
NEXT_PUBLIC_API_URL=https://alumni.example.edu/api

docker compose --profile proxy up -d --build
```

`nginx/nginx.conf` routes `/` to web and `/api`, `/uploads`, `/health` and `/socket.io` (with WebSocket upgrade) to
the API, with a 10 MB body limit. It listens on plain HTTP. Terminate TLS in front of it (host nginx/Caddy,
Cloudflare, a cloud load balancer), or add a 443 server block with your certificates.

## Day-to-day operations

```bash
docker compose ps                         # status + health
docker compose logs -f api web            # logs
docker compose restart api                # restart one service
docker compose exec postgres psql -U aitd alumni_connect
curl http://localhost:5000/health         # {"status":"ok","database":"postgresql","databaseStatus":"up",...}
```

### Backups

```bash
# Backup (plain SQL)
docker compose exec -T postgres pg_dump -U aitd alumni_connect > backup-$(date +%F).sql

# Restore into an empty database
docker compose exec -T postgres psql -U aitd alumni_connect < backup-2026-10-18.sql
```

Also back up the `uploads_data` volume when not using S3:

```bash
docker run --rm -v aitd-alumni-network_uploads_data:/data -v "$PWD":/backup alpine tar czf /backup/uploads.tgz -C /data .
```

### Upgrades

```bash
git pull
docker compose up -d --build   # the API applies new migrations on start
```

Take a backup first. Migrations are forward-only (`prisma migrate deploy`).

### Stopping and data

- `docker compose down` stops containers and keeps the `postgres_data`, `redis_data` and `uploads_data` volumes.
- `docker compose down -v` **deletes all data**.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `JWT_SECRET and JWT_REFRESH_SECRET must be set to strong (32+ char) values` | Secrets missing or short. Generate them with the command above. |
| API keeps logging "Waiting for the database" then exits | Wrong `POSTGRES_*` values, or the password contains `@ : / ? #` and breaks `DATABASE_URL`. Use a base64url password. Changing `POSTGRES_PASSWORD` after the first start does **not** change it inside an existing volume. |
| Browser shows CORS errors | `CORS_ORIGINS` must contain the exact web origin (scheme + host + port); restart the API. |
| Web calls `localhost:5000` from a remote machine | `NEXT_PUBLIC_API_URL` is build-time. Set it and run `docker compose up -d --build web`. |
| No admin account | `SEED_ADMIN_PASSWORD` was empty. Set it and `docker compose restart api`. |
| Map place search shows "unavailable" (HTTP 503 `GEOCODER_UNAVAILABLE`) | Nominatim unreachable or rate-limited, or `GEOCODER_URL=off`. The map itself still works. |
| `/health` returns 503 | Database down: `docker compose logs postgres`. |

## Migrating existing MySQL data

Until 2026-10-18 the project ran on MySQL 8. The schema is unchanged, but the PostgreSQL migration history starts
fresh at `20261018000000_postgres_baseline`. The old MySQL migrations are archived in `server/prisma/mysql-legacy/`.

**Option A: fresh start.** Deploy with Docker as above. Members re-register or are re-invited.

**Option B: copy the data.**

1. Bring the old MySQL database fully up to date with the archived migrations (see
   `server/prisma/mysql-legacy/README.md`), then take a `mysqldump` backup.
2. Start the new stack once so PostgreSQL has the schema (`prisma migrate deploy` runs automatically), then stop the API:
   `docker compose stop api web`.
3. Load the data only (the schema already exists) with [pgloader](https://pgloader.io), for example:

   ```
   LOAD DATABASE
     FROM mysql://user:pass@old-host:3306/alumni_connect
     INTO postgresql://aitd:<password>@127.0.0.1:5432/alumni_connect
   WITH data only, truncate, disable triggers, reset sequences
   EXCLUDING TABLE NAMES MATCHING '_prisma_migrations';
   ```

   Table and column names are identical (Prisma-generated). Booleans, enums, JSON and decimals convert automatically.
4. Check row counts per table on both sides (e.g. `SELECT COUNT(*) FROM "User";`).
5. Optional: round previously shared locations to the ~1 km precision the app now stores. The API already rounds on
   read, so this only tidies stored data:
   `UPDATE "User" SET "locationLat" = ROUND("locationLat", 2), "locationLng" = ROUND("locationLng", 2) WHERE "locationLat" IS NOT NULL;`
6. `docker compose start api web`. Every user must sign in again: refresh-token families are new.
