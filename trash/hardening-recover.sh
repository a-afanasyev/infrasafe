#!/usr/bin/env bash
# Recovery from `nft flush ruleset` clobbering Docker's iptables-nft chains.
# Run as root: sudo bash hardening-recover.sh
set -uo pipefail

if [ "$EUID" -ne 0 ]; then
    echo "ERROR: must run as root: sudo bash hardening-recover.sh"
    exit 1
fi

LOG=/var/log/infrasafe-hardening.log
exec > >(tee -a "$LOG") 2>&1

echo ""
echo "============================================================"
echo "RECOVERY — $(date)"
echo "============================================================"

# ============================================================
# 1) Cancel any pending 'at' jobs (so killswitch can't re-flush)
# ============================================================
echo ""
echo "=== 1. Cancel pending atq jobs ==="
atq || true
for j in $(atq 2>/dev/null | awk '{print $1}'); do
    echo "  atrm $j"
    atrm "$j" 2>/dev/null || true
done
atq || true

# ============================================================
# 2) Restart docker — re-installs DOCKER, DOCKER-USER, DOCKER-ISOLATION-* chains
# ============================================================
echo ""
echo "=== 2. systemctl restart docker (rebuilds iptables-nft chains) ==="
systemctl restart docker
sleep 8
docker ps --format "table {{.Names}}\t{{.Status}}" 2>&1 | head -15

# ============================================================
# 3) Replace /etc/nftables.conf with a safer config that only
#    touches our 'inet filter' table — leaves Docker's NAT chains alone.
# ============================================================
echo ""
echo "=== 3. Write safer /etc/nftables.conf ==="
cat > /etc/nftables.conf <<'NFTEOF'
#!/usr/sbin/nft -f

# Atomically replace ONLY our 'inet filter' table.
# Do NOT use 'flush ruleset' — it wipes Docker's iptables-nft chains
# (DOCKER, DOCKER-USER, DOCKER-ISOLATION-*) and breaks new container DNAT.
table inet filter
delete table inet filter

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
echo "  syntax OK"

# ============================================================
# 4) Restart nftables — applies safer config; Docker chains preserved
# ============================================================
echo ""
echo "=== 4. systemctl restart nftables (with safer config) ==="
systemctl restart nftables
sleep 1
nft list ruleset | head -40

# ============================================================
# 5) Bring up all compose stacks
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
# 6) Verification
# ============================================================
echo ""
echo "=== 6. Verification ==="
echo ""
echo "Public TCP listeners (should ONLY be 32323, 80, 443):"
ss -tln 2>/dev/null | awk 'NR==1 || ($4 !~ /^127\./ && $4 !~ /^\[::1\]/)' | sed 's/^/    /'
echo ""
echo "Public UDP listeners (should ONLY be 51820):"
ss -uln 2>/dev/null | awk 'NR==1 || ($4 !~ /^127\./ && $4 !~ /^\[::1\]/)' | sed 's/^/    /'
echo ""
echo "Container status:"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | sed 's/^/    /'
echo ""
echo "fail2ban (sshd):"
fail2ban-client status sshd 2>&1 | head -8 | sed 's/^/    /'

echo ""
echo "============================================================"
echo "DONE — $(date)"
echo "============================================================"
echo ""
echo "Reminders (still pending from original script):"
echo "  1. Change sudo password (was leaked in bash_history):"
echo "       sudo passwd infrasafe"
echo "  2. Admin services on 127.0.0.1 — access via SSH tunnel:"
echo "       ssh -p 32323 -N -L 3001:127.0.0.1:3001 infrasafe@95.46.96.105"
echo ""
