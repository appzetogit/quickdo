#!/usr/bin/env bash
# Install one backend release on the quickdoo server and switch to it.
#
#   quickdoo-release.sh <release.tgz> <sha>
#
# Run as root. The archive is `git archive HEAD Backend deploy` from a clean,
# committed tree. Layout (see the deploy-server notes):
#   /home/quickdoo-api/app/releases/<sha>   unpacked code
#   /home/quickdoo-api/app/current          symlink to the live release
#   /home/quickdoo-api/app/shared/.env      the only copy of the secrets
#
# The switch happens only after `npm ci` succeeds, and if /health does not come
# back UP within 60s the symlink goes back to the previous release and pm2 is
# reloaded again -- a broken build never stays live.
set -euo pipefail

ARCHIVE="${1:?usage: $0 <release.tgz> <sha>}"
SHA="${2:?usage: $0 <release.tgz> <sha>}"
APP=/home/quickdoo-api/app
REL="$APP/releases/$SHA"
SITE_USER=quickdoo-api
KEEP=5

log() { echo "[release $SHA] $*"; }
as_site() { su - "$SITE_USER" -c "source ~/.nvm/nvm.sh >/dev/null; $*"; }

PREV="$(readlink -f "$APP/current" 2>/dev/null || true)"

if [ ! -d "$REL/Backend/node_modules" ]; then
  install -d -o "$SITE_USER" -g "$SITE_USER" "$REL"
  tar -xzf "$ARCHIVE" -C "$REL"
  find "$REL" -name '*.sh' -exec sed -i 's/\r$//' {} +
  chown -R "$SITE_USER:$SITE_USER" "$REL"
  log "installing dependencies"
  as_site "cd $REL/Backend && npm ci --omit=dev --no-audit --no-fund --loglevel=error"
fi
ln -sfn "$APP/shared/.env" "$REL/Backend/.env"

log "switching current -> $SHA (was ${PREV##*/})"
ln -sfn "$REL" "$APP/current.new" && mv -Tf "$APP/current.new" "$APP/current"
chown -h "$SITE_USER:$SITE_USER" "$APP/current"
as_site "pm2 reload $APP/shared/ecosystem.config.cjs --update-env >/dev/null && pm2 save >/dev/null"

for _ in $(seq 1 30); do
  sleep 2
  if curl -fs -m 5 http://127.0.0.1:5007/health | grep -q '"status":"UP"'; then
    log "healthy"
    ls -1dt "$APP"/releases/*/ | tail -n +"$((KEEP + 1))" | xargs -r rm -rf
    exit 0
  fi
done

log "UNHEALTHY after 60s -- rolling back to ${PREV##*/}"
if [ -n "$PREV" ] && [ "$PREV" != "$REL" ]; then
  ln -sfn "$PREV" "$APP/current.new" && mv -Tf "$APP/current.new" "$APP/current"
  as_site "pm2 reload $APP/shared/ecosystem.config.cjs --update-env >/dev/null"
fi
exit 1
