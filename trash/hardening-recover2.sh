#!/usr/bin/env bash
# Recovery v2: fix Debian's nftables.service ExecStop=flush which clobbers Docker iptables.
# Run: sudo bash hardening-recover2.sh
set -uo pipefail

if [ "$EUID" -ne 0 ]; then
    echo "ERROR: must run as root"
    exit 1
fi

LOG=/var/log/infrasafe-hardening.log
exec > >(tee -a "$LOG") 2>&1

echo ""
echo "============================================================"
echo "RECOVERY v2 — $(date)"
echo "============================================================"

# ============================================================
# 1. Drop-in override: remove ExecStop=flush from nftables.service
# ============================================================
echo ""
echo "=== 1. Override nftables.service ExecStop ==="
mkdir -p /etc/systemd/system/nftables.service.d
cat > /etc/systemd/system/nftables.service.d/override.conf <<'EOF'
[Service]
# Default Debian unit has ExecStop=/usr/sbin/nft flush ruleset, which on
# 'systemctl restart nftables' wipes Docker's iptables-nft chains
# (DOCKER, DOCKER-USER, DOCKER-ISOLATION-*) and breaks new container DNAT.
# Our /etc/nftables.conf does atomic replacement of only our 'inet filter'
# table, so the global flush is unnecessary and harmful.
ExecStop=
EOF
systemctl daemon-reload
echo "  override installed."
systemctl cat nftables.service | tail -10

# ============================================================
# 2. Cancel any pending atq jobs
# ============================================================
echo ""
echo "=== 2. Cancel pending atq jobs ==="
atq || true
for j in $(atq 2>/dev/null | awk '{print $1}'); do
    echo "  atrm $j"
    atrm "$j" 2>/dev/null || true
done

# ============================================================
# 3. Restart docker to rebuild its iptables-nft chains
# ============================================================
echo ""
echo "=== 3. systemctl restart docker (rebuilds DOCKER chains) ==="
systemctl restart docker
sleep 8

# ============================================================
# 4. Verify Docker chains exist before continuing
# ============================================================
echo ""
echo "=== 4. Verify DOCKER chain exists in nat table ==="
if iptables -t nat -L DOCKER -n >/dev/null 2>&1; then
    echo "  DOCKER chain present."
else
    echo "  ERROR: DOCKER chain missing — Docker did not initialize iptables. Aborting."
    exit 2
fi

# ============================================================
# 5. Bring up all compose stacks
# ============================================================
echo ""
echo "=== 5. docker compose up across all stacks ==="
set +e
sudo -u infrasafe -H bash <<'EOSU'
cd /home/infrasafe                  && docker compose up -d
cd /home/infrasafe/infrasafe        && docker compose -f docker-compose.unified.yml up -d
cd /home/infrasafe/uptime-kuma      && docker compose up -d
EOSU
set -e

# ============================================================
# 6. Verification
# ============================================================
echo ""
echo "=== 6. Verification ==="

echo ""
echo "Public TCP listeners (should be 32323, 80, 443):"
ss -tln 2>/dev/null | awk 'NR==1 || ($4 !~ /^127\./ && $4 !~ /^\[::1\]/)' | sed 's/^/    /'

echo ""
echo "Public UDP listeners (should be 51820):"
ss -uln 2>/dev/null | awk 'NR==1 || ($4 !~ /^127\./ && $4 !~ /^\[::1\]/)' | sed 's/^/    /'

echo ""
echo "127.0.0.1-only listeners (admin services):"
ss -tln 2>/dev/null | awk 'NR==1 || $4 ~ /^127\./' | sed 's/^/    /'

echo ""
echo "Container status:"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | sed 's/^/    /'

echo ""
echo "nftables ruleset (filter table only):"
nft list table inet filter | sed 's/^/    /'

echo ""
echo "fail2ban (sshd):"
fail2ban-client status sshd 2>&1 | head -8 | sed 's/^/    /'

echo ""
echo "============================================================"
echo "RECOVERY v2 DONE — $(date)"
echo "============================================================"
echo ""
echo "Reminders:"
echo "  1. Change sudo password (was in bash_history):  sudo passwd infrasafe"
echo "  2. Admin services on 127.0.0.1 — access via SSH tunnel:"
echo "       ssh -p 32323 -N \\"
echo "         -L 3001:127.0.0.1:3001 \\   # Grafana"
echo "         -L 1880:127.0.0.1:1880 \\   # Node-RED"
echo "         -L 8086:127.0.0.1:8086 \\   # InfluxDB"
echo "         -L 3003:127.0.0.1:3003 \\   # Uptime-Kuma"
echo "         -L 1884:127.0.0.1:1884 \\   # MQTT"
echo "         infrasafe@95.46.96.105"
echo ""
