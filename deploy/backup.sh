#!/usr/bin/env bash
# Nightly MongoDB backup for the super-app.
#
# Until this existed there was no backup of any kind: no mongodump, no cron, no
# script. The only copy of the data was the live cluster.
#
# What it does:
#   1. mongodump the database named in MONGODB_URI, gzipped into one archive.
#   2. Keeps the last $KEEP_DAILY nightly archives, plus one per week (Sunday's)
#      for $KEEP_WEEKLY weeks.
#   3. If BACKUP_REMOTE is set (an rclone remote, e.g. "s3:quickdo-backups"),
#      copies the new archive there and applies the same retention remotely.
#      A backup that lives only on the box it protects is not much of one.
#
# Reads MONGODB_URI (or MONGO_URI) from the environment or from $ENV_FILE.
# Never prints the URI.
#
# Install (once, as the deploy user):
#   chmod +x deploy/backup.sh
#   crontab -e
#   30 2 * * * /opt/master/deploy/backup.sh >> /var/log/quickdo-backup.log 2>&1
#
# Restore: deploy/restore.sh. Test a restore on staging every month -- an
# untested backup is a guess.
set -euo pipefail

ENV_FILE="${ENV_FILE:-/opt/master/Backend/.env}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/quickdo}"
KEEP_DAILY="${KEEP_DAILY:-14}"
KEEP_WEEKLY="${KEEP_WEEKLY:-8}"
BACKUP_REMOTE="${BACKUP_REMOTE:-}"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

if [ -z "${MONGODB_URI:-}${MONGO_URI:-}" ] && [ -f "$ENV_FILE" ]; then
  # Only the two variables we need -- don't source the whole .env into the shell.
  MONGODB_URI="$(grep -E '^MONGODB_URI=' "$ENV_FILE" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')"
  MONGO_URI="$(grep -E '^MONGO_URI=' "$ENV_FILE" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')"
fi
URI="${MONGO_URI:-${MONGODB_URI:-}}"
if [ -z "$URI" ]; then
  log "ERROR: no MONGODB_URI / MONGO_URI (env or $ENV_FILE)"; exit 1
fi
command -v mongodump >/dev/null || { log "ERROR: mongodump not installed (mongodb-database-tools)"; exit 1; }

mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
ARCHIVE="$BACKUP_DIR/daily/quickdo-$STAMP.archive.gz"

log "dumping to $ARCHIVE"
mongodump --uri="$URI" --archive="$ARCHIVE" --gzip --quiet
SIZE="$(du -h "$ARCHIVE" | cut -f1)"
log "dump complete ($SIZE)"

# A zero-byte or truncated archive is worse than none: it looks like a backup.
if [ ! -s "$ARCHIVE" ] || ! gzip -t "$ARCHIVE" 2>/dev/null; then
  log "ERROR: archive is empty or corrupt"; rm -f "$ARCHIVE"; exit 1
fi

if [ "$(date -u +%u)" = "7" ]; then
  cp "$ARCHIVE" "$BACKUP_DIR/weekly/"
  log "kept as weekly"
fi

prune() { # dir keep
  ls -1t "$1"/quickdo-*.archive.gz 2>/dev/null | tail -n +"$(( $2 + 1 ))" | xargs -r rm -f
}
prune "$BACKUP_DIR/daily" "$KEEP_DAILY"
prune "$BACKUP_DIR/weekly" "$KEEP_WEEKLY"

if [ -n "$BACKUP_REMOTE" ]; then
  command -v rclone >/dev/null || { log "ERROR: BACKUP_REMOTE set but rclone not installed"; exit 1; }
  rclone copy "$ARCHIVE" "$BACKUP_REMOTE/daily/"
  [ "$(date -u +%u)" = "7" ] && rclone copy "$ARCHIVE" "$BACKUP_REMOTE/weekly/"
  rclone delete "$BACKUP_REMOTE/daily/" --min-age "${KEEP_DAILY}d"
  rclone delete "$BACKUP_REMOTE/weekly/" --min-age "$(( KEEP_WEEKLY * 7 ))d"
  log "uploaded to $BACKUP_REMOTE"
fi

log "done"
