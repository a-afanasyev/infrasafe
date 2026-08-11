#!/usr/bin/env bash
# InfraSafe demo server hardening
# Run as root: sudo bash hardening.sh
#
# What it does:
#   - installs nftables, fail2ban, at
#   - rewrites compose port mappings -> bind to 127.0.0.1 (admin services)
#   - applies nftables ruleset (allow only 32323/tcp, 80/tcp, 443/tcp, 51820/udp)
#   - schedules a 10-minute killswitch via 'at' that flushes nft if things break
#   - configures fail2ban for sshd on port 32323
#   - fixes ownership/permissions in ~/infrasafe (chown to infrasafe, chmod env files)
#   - moves stray secrets from ~ to ~/.private
#   - removes macOS junk and duplicate files
#   - disables host-installed mosquitto if active
#   - scrubs password leak from ~/.bash_history
#   - restarts docker stacks to apply new port bindings
#   - prints verification + reminders

set -euo pipefail

# ============================================================
# Configuration
# ============================================================
USER_HOME=/home/infrasafe
INFRA_PROJ=/home/infrasafe/infrasafe
KUMA_DIR=/home/infrasafe/uptime-kuma
TS=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="${USER_HOME}/hardening-backups/${TS}"
LOG=/var/log/infrasafe-hardening.log

# ============================================================
# Setup
# ============================================================
if [ "$EUID" -ne 0 ]; then
    echo "ERROR: must run as root: sudo bash hardening.sh"
    exit 1
fi

mkdir -p "$BACKUP_DIR"
exec > >(tee -a "$LOG") 2>&1

echo ""
echo "============================================================"
echo "InfraSafe demo hardening — start at $(date)"
echo "Backup dir: $BACKUP_DIR"
echo "Log:        $LOG"
echo "============================================================"

trap 'echo "[FAIL] error at line $LINENO (exit $?). Backups in $BACKUP_DIR"; exit 1' ERR

# ============================================================
# Phase A: backups of files we will modify
# ============================================================
echo ""
echo "=== Phase A: backup config files ==="
cp -p "$USER_HOME/docker-compose.yml"                    "$BACKUP_DIR/home_docker-compose.yml"
cp -p "$INFRA_PROJ/docker-compose.unified.yml"           "$BACKUP_DIR/unified-compose.yml"
cp -p "$KUMA_DIR/docker-compose.yml"                     "$BACKUP_DIR/kuma-compose.yml"
[ -f /etc/nftables.conf ]      && cp -p /etc/nftables.conf      "$BACKUP_DIR/nftables.conf.bak"      || true
[ -f /etc/fail2ban/jail.local ] && cp -p /etc/fail2ban/jail.local "$BACKUP_DIR/jail.local.bak"        || true
[ -f "$USER_HOME/.bash_history" ] && cp -p "$USER_HOME/.bash_history" "$BACKUP_DIR/bash_history.bak" || true
echo "  backups complete."

# ============================================================
# Phase B: install nftables, fail2ban, at
# ============================================================
echo ""
echo "=== Phase B: install packages (nftables, fail2ban, at) ==="
DEBIAN_FRONTEND=noninteractive apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nftables fail2ban at
systemctl enable atd >/dev/null 2>&1
systemctl start  atd

# ============================================================
# Phase C: rewrite compose port mappings to 127.0.0.1
# ============================================================
echo ""
echo "=== Phase C: bind container ports to 127.0.0.1 (only WG stays public) ==="

# ~/docker-compose.yml — admin services
sed -i \
    -e 's|- "1884:1883"|- "127.0.0.1:1884:1883"|' \
    -e 's|- "8086:8086"|- "127.0.0.1:8086:8086"|' \
    -e 's|- "3001:3000"|- "127.0.0.1:3001:3000"|' \
    -e 's|- "1880:1880"|- "127.0.0.1:1880:1880"|' \
    -e '/- "51820:51820\/tcp"/d' \
    "$USER_HOME/docker-compose.yml"
echo "  ~/docker-compose.yml: mosquitto/influx/grafana/nodered -> 127.0.0.1; WG TCP removed."

# ~/infrasafe/docker-compose.unified.yml — app/frontend internal
sed -i \
    -e 's|- "8080:8080"|- "127.0.0.1:8080:8080"|' \
    -e 's|- "3000:3000"|- "127.0.0.1:3000:3000"|' \
    "$INFRA_PROJ/docker-compose.unified.yml"
echo "  unified compose: app/frontend -> 127.0.0.1."

# ~/uptime-kuma/docker-compose.yml
sed -i 's|- "3003:3001"|- "127.0.0.1:3003:3001"|' "$KUMA_DIR/docker-compose.yml"
echo "  uptime-kuma: 127.0.0.1."

# Sanity: show resulting port lines
echo ""
echo "  Resulting port lines:"
grep -nE 'ports:|- "[0-9].*:.*"|- "127' "$USER_HOME/docker-compose.yml" "$INFRA_PROJ/docker-compose.unified.yml" "$KUMA_DIR/docker-compose.yml" || true

# ============================================================
# Phase D: nftables firewall (with killswitch)
# ============================================================
echo ""
echo "=== Phase D: nftables firewall ==="

# Save current state
nft list ruleset > "$BACKUP_DIR/nft-ruleset-before.txt" 2>/dev/null || true

# Write config
cat > /etc/nftables.conf <<'NFTEOF'
#!/usr/sbin/nft -f
flush ruleset

table inet filter {
    chain input {
        type filter hook input priority 0; policy drop;

        ct state invalid drop
        ct state established,related accept
        iif lo accept
        ip protocol icmp accept
        ip6 nexthdr icmpv6 accept

        tcp dport 32323 accept comment "SSH"
        tcp dport { 80, 443 } accept comment "HTTP/HTTPS"
        udp dport 51820 accept comment "WireGuard"
    }

    chain forward { type filter hook forward priority 0; policy accept; }
    chain output  { type filter hook output  priority 0; policy accept; }
}
NFTEOF

# Validate
nft -c -f /etc/nftables.conf
echo "  nftables config syntax OK."

# Schedule killswitch BEFORE applying — fires in 10 min if not removed
KILLSWITCH_SCRIPT="$BACKUP_DIR/killswitch.sh"
cat > "$KILLSWITCH_SCRIPT" <<KSEOF
#!/usr/bin/env bash
# Auto-revert nftables hardening
nft flush ruleset
systemctl stop nftables
echo "Killswitch fired at \$(date) — nftables flushed and stopped." >> $LOG
KSEOF
chmod +x "$KILLSWITCH_SCRIPT"

KILLSWITCH_OUT=$(echo "bash $KILLSWITCH_SCRIPT" | at now + 10 minutes 2>&1)
echo "  $KILLSWITCH_OUT"
KILLSWITCH_JOB=$(echo "$KILLSWITCH_OUT" | awk '/^job/ {print $2}')
echo "  killswitch 'at' job #$KILLSWITCH_JOB scheduled (10 min from now)."
echo "$KILLSWITCH_JOB" > "$BACKUP_DIR/killswitch-jobid.txt"

# Apply
systemctl enable nftables >/dev/null 2>&1
systemctl restart nftables
echo "  nftables active. Ruleset:"
nft list ruleset

# ============================================================
# Phase E: fail2ban for sshd on port 32323
# ============================================================
echo ""
echo "=== Phase E: fail2ban ==="
cat > /etc/fail2ban/jail.local <<'F2BEOF'
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5
backend  = systemd

[sshd]
enabled = true
port    = 32323
F2BEOF
systemctl enable fail2ban >/dev/null 2>&1
systemctl restart fail2ban
sleep 2
echo "  fail2ban sshd jail status:"
fail2ban-client status sshd 2>&1 | sed 's/^/    /' || true

# ============================================================
# Phase F: ownership and permissions in ~/infrasafe
# ============================================================
echo ""
echo "=== Phase F: ownership & permissions ==="
chown -R infrasafe:infrasafe "$INFRA_PROJ"
[ -f "$INFRA_PROJ/.env" ]      && chmod 600 "$INFRA_PROJ/.env"      && echo "  .env: 600"
[ -f "$INFRA_PROJ/.env.prod" ] && chmod 600 "$INFRA_PROJ/.env.prod" && echo "  .env.prod: 600"
[ -d "$INFRA_PROJ/logs" ]      && chmod 750 "$INFRA_PROJ/logs"      && echo "  logs/: 750"

# ============================================================
# Phase G: move stray private artifacts to ~/.private
# ============================================================
echo ""
echo "=== Phase G: relocate stray secrets to ~/.private ==="
mkdir -p "$USER_HOME/.private"
chmod 700 "$USER_HOME/.private"
for f in id_rsa id_rsa.pub cert_key cert_key.pub privkey.pem fullchain.pem token.txt; do
    if [ -e "$USER_HOME/$f" ]; then
        mv "$USER_HOME/$f" "$USER_HOME/.private/"
        echo "  moved: $f"
    fi
done
chown -R infrasafe:infrasafe "$USER_HOME/.private"
find "$USER_HOME/.private" -type f -exec chmod 600 {} \;

# ============================================================
# Phase H: macOS junk and duplicates
# ============================================================
echo ""
echo "=== Phase H: remove macOS junk + duplicate files ==="
for path in \
    "$INFRA_PROJ/.DS_Store" \
    "$INFRA_PROJ/LICENSE-GUIDE 2.md" \
    "$INFRA_PROJ/READY-FOR-PUBLICATION 2.md" \
    "$INFRA_PROJ/prepare-for-publication 2.sh"
do
    if [ -e "$path" ]; then
        rm -f "$path"
        echo "  removed: $(basename "$path")"
    fi
done

# ============================================================
# Phase I: disable host-installed mosquitto (docker has its own)
# ============================================================
echo ""
echo "=== Phase I: disable host mosquitto (duplicates docker container) ==="
if systemctl is-active --quiet mosquitto 2>/dev/null; then
    systemctl disable --now mosquitto
    echo "  host mosquitto: disabled & stopped"
else
    echo "  host mosquitto: already inactive"
fi

# ============================================================
# Phase J: scrub password from bash history
# ============================================================
echo ""
echo "=== Phase J: scrub password leak from bash_history ==="
if [ -f "$USER_HOME/.bash_history" ] && grep -qF 'Infr@$@fe' "$USER_HOME/.bash_history"; then
    sed -i '/Infr@\$@fe/d' "$USER_HOME/.bash_history"
    chown infrasafe:infrasafe "$USER_HOME/.bash_history"
    echo "  password line removed from history"
else
    echo "  no password line found in history"
fi

# ============================================================
# Phase K: restart docker compose stacks
# ============================================================
echo ""
echo "=== Phase K: recreate containers with new port bindings ==="
echo "  ⚠ WireGuard container will restart — your VPN drops ~10–15s."
echo ""

sudo -u infrasafe -H bash <<'DOCKEREOF'
set -e
cd /home/infrasafe                 && docker compose up -d
cd /home/infrasafe/infrasafe       && docker compose -f docker-compose.unified.yml up -d
cd /home/infrasafe/uptime-kuma     && docker compose up -d
DOCKEREOF

# ============================================================
# Phase L: verification
# ============================================================
echo ""
echo "=== Phase L: verification ==="
echo ""
echo "Public TCP listeners (should ONLY be 32323, 80, 443):"
ss -tln 2>/dev/null | awk 'NR==1 || $4 !~ /^127\./ && $4 !~ /^\[::1\]/' | sed 's/^/    /'
echo ""
echo "Public UDP listeners (should ONLY be 51820):"
ss -uln 2>/dev/null | awk 'NR==1 || $4 !~ /^127\./ && $4 !~ /^\[::1\]/' | sed 's/^/    /'
echo ""
echo "nftables ruleset:"
nft list ruleset | sed 's/^/    /'
echo ""
echo "Container status:"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | sed 's/^/    /'

# ============================================================
# Final summary + reminders
# ============================================================
echo ""
echo "============================================================"
echo "DONE at $(date)"
echo "============================================================"
echo ""
echo "‼ KILLSWITCH ACTIVE — 'at' job #${KILLSWITCH_JOB:-?} fires in ~10 min."
echo ""
echo "  Verify connectivity NOW from a NEW SSH session:"
echo "      ssh -p 32323 infrasafe@95.46.96.105 'echo OK'"
echo ""
echo "  If OK, REMOVE the killswitch immediately:"
echo "      sudo atrm ${KILLSWITCH_JOB:-<jobid>}"
echo ""
echo "  If the killswitch fires, it just runs 'nft flush ruleset' — re-enable manually:"
echo "      sudo systemctl restart nftables"
echo ""
echo "Reminders (not done automatically):"
echo "  1. SUDO PASSWORD WAS IN ~/.bash_history. Change it now:"
echo "       sudo passwd infrasafe"
echo ""
echo "  2. Backups of all changed files: $BACKUP_DIR"
echo ""
echo "  3. Admin services moved to 127.0.0.1. Access via SSH tunnel:"
echo "       ssh -p 32323 -N \\"
echo "         -L 3001:127.0.0.1:3001 \\   # Grafana"
echo "         -L 1880:127.0.0.1:1880 \\   # Node-RED"
echo "         -L 8086:127.0.0.1:8086 \\   # InfluxDB"
echo "         -L 3003:127.0.0.1:3003 \\   # Uptime-Kuma"
echo "         -L 1884:127.0.0.1:1884 \\   # MQTT"
echo "         infrasafe@95.46.96.105"
echo "     Then http://localhost:3001 in browser, etc."
echo ""
echo "  4. Cleanup candidates (verify before rm):"
echo "       ~/pgsql/        (147M, ex-host PG?)"
echo "       ~/site_backup/  (6.8M)"
echo "       ~/node-app/     (11M)"
echo "       24 anonymous Docker volumes (docker volume ls; docker volume prune)"
echo ""
echo "  5. Known issue: nginx security headers exist in server block but are"
echo "     overridden by location blocks (\\.html$, etc.). Fix separately."
echo ""
