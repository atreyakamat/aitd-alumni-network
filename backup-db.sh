#!/usr/bin/env bash
# backup-db.sh - PostgreSQL backup for AIEM Connect (run daily from cron; see docs/PRODUCTION_CHECKLIST.md).
#
# Two ways to reach the database:
#   compose (default when docker-compose.yml is in the current directory and docker is installed):
#       dumps from inside the `postgres` container, so no port or password is needed on the host
#   direct: set DATABASE_URL (postgresql://user:pass@host:5432/db) or the standard PG* variables (PGHOST, PGUSER,
#       PGPASSWORD / ~/.pgpass, PGDATABASE). The password is never passed on a command line.
#
# Settings (environment):
#   BACKUP_DIR        where dumps go                              (default ./backups)
#   BACKUP_KEEP_DAYS  delete dumps older than this many days      (default 30)
#   BACKUP_S3_URI     e.g. s3://my-bucket/aiem/db  (needs the aws CLI; uploaded encrypted)
#   BACKUP_MODE       compose | direct                            (default: auto)
#
# Restore (into an EMPTY database; try it on a scratch server regularly, an untested backup is a hope, not a backup):
#   pg_restore --no-owner --clean --if-exists -d "$DATABASE_URL" backups/aiem_YYYYmmdd_HHMMSS.dump
set -euo pipefail
umask 077   # dumps hold personal data: readable by the owner only

BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
STAMP="$(date +%Y%m%d_%H%M%S)"
FILE="$BACKUP_DIR/aiem_${STAMP}.dump"
TMP="$FILE.partial"
# Whatever happens, never leave a half-written dump next to the good ones
trap 'rm -f "$TMP"' EXIT
MODE="${BACKUP_MODE:-}"

if [ -z "$MODE" ]; then
  if [ -f docker-compose.yml ] && command -v docker >/dev/null 2>&1; then MODE=compose; else MODE=direct; fi
fi

mkdir -p "$BACKUP_DIR"
echo "[$(date)] Starting PostgreSQL backup (mode: $MODE)"

case "$MODE" in
  compose)
    # POSTGRES_USER / POSTGRES_DB are read inside the container, where they are already set
    docker compose exec -T postgres sh -c 'pg_dump --format=custom --no-owner -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$TMP"
    ;;
  direct)
    if [ -n "${DATABASE_URL:-}" ]; then
      # strip Prisma's "?schema=public" - pg_dump does not understand it
      pg_dump --format=custom --no-owner "${DATABASE_URL%%\?*}" > "$TMP"
    else
      pg_dump --format=custom --no-owner > "$TMP"
    fi
    ;;
  *)
    echo "Unknown BACKUP_MODE '$MODE' (use compose or direct)" >&2
    exit 2
    ;;
esac

# A dump that cannot be read back is not a backup. pg_restore --list parses the whole table of contents; hosts without
# the PostgreSQL client tools (compose mode) can only be checked for "not empty".
dump_is_good() {
  [ -s "$TMP" ] || return 1
  if command -v pg_restore >/dev/null 2>&1; then pg_restore --list "$TMP" >/dev/null 2>&1; fi
}
if ! dump_is_good; then
  echo "[$(date)] Backup FAILED: the dump is empty or unreadable" >&2
  exit 1
fi
mv "$TMP" "$FILE"
echo "[$(date)] Backup written: $FILE ($(wc -c < "$FILE") bytes)"

if [ -n "${BACKUP_S3_URI:-}" ]; then
  if command -v aws >/dev/null 2>&1; then
    aws s3 cp "$FILE" "${BACKUP_S3_URI%/}/" --sse AES256
    echo "[$(date)] Uploaded to ${BACKUP_S3_URI%/}/"
  else
    echo "[$(date)] BACKUP_S3_URI is set but the aws CLI is not installed; the dump stays local only" >&2
  fi
fi

find "$BACKUP_DIR" \( -name 'aiem_*.dump' -o -name 'aitd_*.dump' \) -mtime +"$KEEP_DAYS" -delete
echo "[$(date)] Done (dumps older than $KEEP_DAYS days removed)"
