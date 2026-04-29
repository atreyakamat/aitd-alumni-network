#!/bin/bash
# backup-db.sh - Daily database backup script

BACKUP_DIR="/backups/mysql"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DB_HOST="${DB_HOST:-119.18.54.49}"
DB_USER="${DB_USER:-aitd_user}"
DB_NAME="${DB_NAME:-aitd_alumni}"
DB_PASSWORD="${DB_PASSWORD}"

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Perform backup
echo "[$(date)] Starting database backup..."
mysqldump -u "$DB_USER" -p"$DB_PASSWORD" -h "$DB_HOST" "$DB_NAME" \
  --single-transaction \
  --quick \
  --lock-tables=false | gzip > "$BACKUP_DIR/backup_$TIMESTAMP.sql.gz"

if [ $? -eq 0 ]; then
  echo "[$(date)] Backup completed successfully: backup_$TIMESTAMP.sql.gz"
  
  # Upload to S3 (if configured)
  if command -v aws &> /dev/null; then
    aws s3 cp "$BACKUP_DIR/backup_$TIMESTAMP.sql.gz" s3://aitd-backups/database/
    echo "[$(date)] Uploaded to S3"
  fi
  
  # Keep only last 30 days of backups
  find "$BACKUP_DIR" -name "backup_*.sql.gz" -mtime +30 -delete
  echo "[$(date)] Cleaned old backups (kept last 30 days)"
else
  echo "[$(date)] Backup FAILED!"
  exit 1
fi
