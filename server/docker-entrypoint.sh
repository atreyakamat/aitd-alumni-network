#!/bin/sh
# API container entrypoint: wait for PostgreSQL, apply migrations, optionally seed, then start.
set -e

attempt=1
max_attempts="${DB_WAIT_ATTEMPTS:-30}"
until npx prisma migrate deploy; do
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "Database still unreachable after $attempt attempts; giving up." >&2
    exit 1
  fi
  echo "Waiting for the database (attempt $attempt/$max_attempts)..."
  attempt=$((attempt + 1))
  sleep 2
done

# Idempotent: creates the super admin (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD), tiers, skills, chapters.
if [ "$SEED_ON_START" = "true" ]; then
  if [ -z "$SEED_ADMIN_PASSWORD" ]; then
    echo "SEED_ON_START=true but SEED_ADMIN_PASSWORD is empty: skipping the seed (no admin account will be created)." >&2
  else
    npx tsx prisma/seed.ts
  fi
fi

exec node dist/index.js
