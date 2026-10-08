#!/usr/bin/env bash
# Prove the newest backup can actually be restored.
#
# Restores the latest archive from $BACKUP_DIR into a throwaway database,
# compares every collection's document and index counts with the live
# database, then drops the throwaway copy. Exits non-zero on any mismatch.
#
# A backup nobody has restored is a guess: the first run of this check found
# that restore.sh restored 0 documents while reporting success.
#
# Cron (weekly, Sunday 03:30, after the 02:30 backup):
#   30 3 * * 0 /usr/local/bin/quickdoo-verify-backup.sh >> /var/log/quickdoo-backup.log 2>&1
#
# Needs an admin URI (it creates and drops a database): MONGO_ADMIN_URI in the
# environment, or in $SECRETS_FILE.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/quickdoo}"
SECRETS_FILE="${SECRETS_FILE:-/root/quickdoo-secrets/mongo.env}"
LIVE_DB="${LIVE_DB:-quickdoo}"
TEST_DB="${LIVE_DB}_restore_check"
RESTORE="${RESTORE_SCRIPT:-/usr/local/bin/quickdoo-restore.sh}"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] verify-backup: $*"; }

if [ -z "${MONGO_ADMIN_URI:-}" ] && [ -f "$SECRETS_FILE" ]; then
  MONGO_ADMIN_URI="$( (grep -E '^MONGO_ADMIN_URI=' "$SECRETS_FILE" || true) | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')"
fi
[ -n "${MONGO_ADMIN_URI:-}" ] || { log "ERROR: no MONGO_ADMIN_URI"; exit 1; }

LATEST="$(ls -1t "$BACKUP_DIR"/daily/*.archive.gz 2>/dev/null | head -1 || true)"
[ -n "$LATEST" ] || { log "ERROR: no archive in $BACKUP_DIR/daily"; exit 1; }
log "checking $(basename "$LATEST")"

cleanup() { mongosh --quiet "$MONGO_ADMIN_URI" --eval "db.getSiblingDB('$TEST_DB').dropDatabase()" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

echo RESTORE | NS_FROM="$LIVE_DB" NS_TO="$TEST_DB" "$RESTORE" "$LATEST" "$MONGO_ADMIN_URI" 2>&1 \
  | grep -E 'restore complete|ERROR' | sed 's#mongodb://[^ ]*#<uri>#g'

# Documents written between the backup and now make "live" larger than
# "restored"; that is expected. Fewer live than restored, a missing
# collection, or different index counts are failures.
RESULT="$(mongosh --quiet "$MONGO_ADMIN_URI" --eval "
  const a = db.getSiblingDB('$LIVE_DB'), b = db.getSiblingDB('$TEST_DB');
  const restored = new Set(b.getCollectionNames());
  let bad = [], n = 0, docs = 0;
  for (const c of a.getCollectionNames()) {
    n++;
    const x = a[c].countDocuments();
    if (!restored.has(c)) { if (x > 0) bad.push(c + ': missing'); continue; }
    const y = b[c].countDocuments(); docs += y;
    if (y > x) bad.push(c + ': restored ' + y + ' > live ' + x);
    if (a[c].getIndexes().length !== b[c].getIndexes().length) bad.push(c + ': index count differs');
  }
  print(JSON.stringify({ collections: n, restoredDocs: docs, problems: bad }));
")"
log "$RESULT"
echo "$RESULT" | grep -q '"problems":\[\]' || { log "FAILED"; exit 1; }
log "OK"
