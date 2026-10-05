#!/usr/bin/env bash
# Read-only reconnaissance of a shared VPS before deploying anything.
#
# Runs NOTHING that changes state: no installs, no restarts, no writes outside
# /tmp, no config edits. Every command here is a query.
#
# Purpose: this box runs other people's live projects. Before adding one more we
# need to know what is already there, which ports are taken, which domains nginx
# already answers for, and whether there is headroom.
#
#   scp deploy/survey.sh user@host:/tmp/ && ssh user@host 'bash /tmp/survey.sh'
#
set -u  # NOT -e: a missing tool must not abort the survey

hr() { printf '\n=== %s %s\n' "$1" "$(printf '=%.0s' $(seq 1 $((60 - ${#1}))))"; }
have() { command -v "$1" >/dev/null 2>&1; }

hr "IDENTITY"
echo "host   : $(hostname -f 2>/dev/null || hostname)"
echo "user   : $(whoami)   (uid $(id -u))"
echo "sudo   : $(sudo -n true 2>/dev/null && echo 'passwordless' || echo 'not passwordless / unavailable')"
echo "os     : $(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME" || uname -a)"
echo "uptime : $(uptime -p 2>/dev/null || uptime)"

hr "RESOURCES (is there room for one more app?)"
free -h 2>/dev/null | head -3
echo
df -h / /var /home 2>/dev/null | sort -u
echo
echo "cpu cores: $(nproc 2>/dev/null || echo '?')"
echo "load     :$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null)"

hr "RUNTIMES"
for c in node npm pnpm yarn pm2 nginx mongod redis-server docker git certbot; do
  if have "$c"; then printf '  %-10s %s\n' "$c" "$($c --version 2>&1 | head -1)"; else printf '  %-10s -\n' "$c"; fi
done
echo
echo "node binaries on PATH:"; command -v -a node 2>/dev/null | sed 's/^/  /'
[ -d "$HOME/.nvm" ] && echo "  (nvm present: $HOME/.nvm)"

hr "PM2 PROCESSES — DO NOT TOUCH ANY OF THESE"
if have pm2; then
  pm2 list 2>/dev/null
  echo
  echo "pm2 app names (these names are taken):"
  pm2 jlist 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{JSON.parse(d).forEach(p=>console.log('  '+p.name+'  cwd='+(p.pm2_env&&p.pm2_env.pm_cwd)+'  port='+((p.pm2_env&&p.pm2_env.env&&p.pm2_env.env.PORT)||'?')))}catch(e){console.log('  (could not parse)')}})" 2>/dev/null
else
  echo "  pm2 not installed"
fi

hr "SYSTEMD SERVICES (non-vendor)"
systemctl list-units --type=service --state=running --no-pager --no-legend 2>/dev/null | grep -vE "systemd-|dbus|cron|ssh|networkd|resolved|logind|udev|rsyslog|polkit|snapd|unattended" | head -25

hr "LISTENING PORTS — pick one that is NOT here"
if have ss; then ss -tlnp 2>/dev/null | awk 'NR==1 || /LISTEN/' | head -40
elif have netstat; then netstat -tlnp 2>/dev/null | head -40
else echo "  no ss/netstat"; fi

hr "NGINX — which domains are already served"
if have nginx; then
  echo "config test: $(sudo nginx -t 2>&1 | tail -1)"
  for d in /etc/nginx/sites-enabled /etc/nginx/conf.d; do
    [ -d "$d" ] || continue
    echo; echo "$d:"
    ls -la "$d" 2>/dev/null | tail -n +4 | sed 's/^/  /'
  done
  echo
  echo "server_name / listen / root across all enabled sites:"
  grep -rhE "^\s*(server_name|listen|root|proxy_pass)" /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null | sed 's/^\s*/  /' | sort -u | head -60
else
  echo "  nginx not installed"
fi

hr "TLS CERTIFICATES"
have certbot && sudo certbot certificates 2>/dev/null | grep -E "Certificate Name|Domains|Expiry" | sed 's/^/  /' || echo "  certbot unavailable"

hr "WEB ROOTS / APP DIRECTORIES"
for d in /var/www /home /opt /srv /usr/share/nginx; do
  [ -d "$d" ] || continue
  echo "$d:"; ls -la "$d" 2>/dev/null | tail -n +4 | awk '{print "  "$1" "$3" "$9}' | head -15
done

hr "ANY EXISTING COPY OF THIS PROJECT"
find /var/www /home /opt /srv -maxdepth 4 -name "package.json" -not -path "*/node_modules/*" 2>/dev/null | head -25 | while read -r p; do
  name=$(node -e "try{console.log(require('$p').name||'?')}catch(e){console.log('?')}" 2>/dev/null)
  printf '  %-58s %s\n' "$p" "$name"
done
echo
echo "deploy.sh referenced by server.js (~/deploy.sh):"
[ -f "$HOME/deploy.sh" ] && sed 's/^/    /' "$HOME/deploy.sh" || echo "    (not present for $(whoami))"

hr "DATABASES ON THIS BOX"
have mongod && echo "  mongod present — local mongo may be in use by another project"
have redis-cli && echo "  redis: $(redis-cli ping 2>&1 | head -1)"

hr "FIREWALL"
have ufw && sudo ufw status 2>/dev/null | head -15
have firewall-cmd && sudo firewall-cmd --list-all 2>/dev/null | head -15

hr "SURVEY COMPLETE — nothing was modified"
