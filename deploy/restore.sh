#!/usr/bin/env bash
# Restore a deploy/backup.sh archive into a database.
#
#   deploy/restore.sh <archive.gz> <target-uri> [--drop]
#
# The target URI is required and is never read from .env, on purpose: restoring
# over production by accident must take deliberate typing. Without --drop,
# documents already in the target are kept and only missing ones are inserted.
#
# Restoring into a different database name than the dump came from:
#   NS_FROM=quickdo NS_TO=quickdo_restore_test deploy/restore.sh ...
set -euo pipefail

ARCHIVE="${1:-}"; TARGET="${2:-}"; DROP="${3:-}"
if [ -z "$ARCHIVE" ] || [ -z "$TARGET" ]; then
  echo "usage: $0 <archive.gz> <target-uri> [--drop]"; exit 1
fi
[ -s "$ARCHIVE" ] || { echo "archive not found or empty: $ARCHIVE"; exit 1; }
gzip -t "$ARCHIVE" || { echo "archive is corrupt: $ARCHIVE"; exit 1; }

ARGS=(--uri="$TARGET" --archive="$ARCHIVE" --gzip)
[ "$DROP" = "--drop" ] && ARGS+=(--drop)
if [ -n "${NS_FROM:-}" ] && [ -n "${NS_TO:-}" ]; then
  ARGS+=(--nsFrom="${NS_FROM}.*" --nsTo="${NS_TO}.*")
fi

echo "Restoring $(basename "$ARCHIVE") into $(echo "$TARGET" | sed -E 's#//[^@]*@#//<redacted>@#')${DROP:+ (dropping existing collections)}"
read -r -p "Type RESTORE to continue: " ok
[ "$ok" = "RESTORE" ] || { echo "aborted"; exit 1; }

mongorestore "${ARGS[@]}"
echo "restore complete"
