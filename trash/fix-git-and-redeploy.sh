#!/usr/bin/env bash
# Kill uptime-kuma, revert /kuma nginx hack, pull main, then resume deploy.
# Run: sudo bash fix-git-and-redeploy.sh
set -euo pipefail

PROJ=/home/infrasafe/infrasafe
KUMA_DIR=/home/infrasafe/uptime-kuma
TS=$(date +%Y%m%d-%H%M%S)
SAFETY_DIR=/home/infrasafe/git-fix-backup-$TS

if [ "$EUID" -ne 0 ]; then
    echo "ERROR: must run as root"
    exit 1
fi

echo "============================================================"
echo "Fix git + redeploy — $(date)"
echo "============================================================"

# ============================================================
# 1. Belt-and-suspenders: backup current local-modified files
# ============================================================
mkdir -p "$SAFETY_DIR"
cp -p "$PROJ/nginx.production.conf"        "$SAFETY_DIR/nginx.production.conf.local"
cp -p "$PROJ/docker-compose.unified.yml"   "$SAFETY_DIR/docker-compose.unified.yml.local"
chown -R infrasafe:infrasafe "$SAFETY_DIR"
echo "  Safety backup: $SAFETY_DIR"

# ============================================================
# 2. Kill uptime-kuma (no longer needed)
# ============================================================
echo ""
echo "=== Stop and remove uptime-kuma ==="
if [ -d "$KUMA_DIR" ]; then
    sudo -u infrasafe -H bash -c "cd $KUMA_DIR && docker compose down 2>&1" || true
else
    docker stop uptime-kuma 2>&1 || true
    docker rm   uptime-kuma 2>&1 || true
fi
echo "  uptime-kuma container/network gone."

# ============================================================
# 3. Revert nginx.production.conf (drops /kuma/ proxy block)
# ============================================================
echo ""
echo "=== Revert nginx.production.conf to HEAD ==="
sudo -u infrasafe -H bash <<EOSU
set -e
cd $PROJ
git checkout -- nginx.production.conf
echo "  reverted."
EOSU

# ============================================================
# 4. Stash compose changes, pull, pop
# ============================================================
echo ""
echo "=== git stash → pull → pop ==="
sudo -u infrasafe -H bash <<EOSU
set -e
cd $PROJ

echo "--- before:"
git status -sb | head -15

echo "--- stash (preserves hardening bindings in unified.yml + queued deletes)"
git stash push --include-untracked -m "deploy-fix-$TS" || true

echo "--- pull"
git fetch origin
git pull --ff-only origin main

echo "--- after pull:"
git log --oneline -3

echo "--- pop stash"
if git stash pop; then
    echo "STASH_POP_OK"
else
    echo "STASH_POP_CONFLICT"
fi
EOSU

# Check for conflicts
echo ""
echo "=== git status after dance ==="
sudo -u infrasafe -H bash -c "cd $PROJ && git status -sb"

if sudo -u infrasafe -H bash -c "cd $PROJ && git ls-files -u" | grep -q .; then
    echo ""
    echo "[FAIL] unresolved conflicts:"
    sudo -u infrasafe -H bash -c "cd $PROJ && git ls-files -u"
    echo ""
    echo "Local copies in: $SAFETY_DIR"
    exit 2
fi

# ============================================================
# 5. Sanity check
# ============================================================
echo ""
echo "=== Sanity check ==="
if grep -q '127.0.0.1:3000' "$PROJ/docker-compose.unified.yml"; then
    echo "  ✓ Hardening port bindings present in compose"
else
    echo "  WARNING: hardening bindings missing — re-applying via sed"
    sed -i \
        -e 's|- "8080:8080"|- "127.0.0.1:8080:8080"|' \
        -e 's|- "3000:3000"|- "127.0.0.1:3000:3000"|' \
        "$PROJ/docker-compose.unified.yml"
fi

if grep -q '/kuma/' "$PROJ/nginx.production.conf"; then
    echo "  WARNING: /kuma/ block still in nginx.production.conf"
else
    echo "  ✓ nginx.production.conf is upstream-clean (no /kuma/ block)"
fi

# ============================================================
# 6. Resume deploy
# ============================================================
echo ""
echo "============================================================"
echo "Git is clean. Resuming deploy.sh."
echo "============================================================"
exec bash /home/infrasafe/deploy.sh
