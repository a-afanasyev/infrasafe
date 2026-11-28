#!/usr/bin/env bash
#
# nginx-config-test.sh — [Q-37, аудит 28.11.2026] настоящий `nginx -t` обоих
# боевых конфигов периметра в том образе nginx, что закреплён в
# docker-compose.unified.yml. Текстовые jest-наборы не видят ошибок разбора
# (неизвестная директива, дубль, не тот контекст) — их видит только nginx.
#
# Сертификатов в репозитории нет: на каждый путь из ssl_certificate /
# ssl_certificate_key / ssl_trusted_certificate кладётся самоподписанная пара.
# Апстримы во всех proxy_pass — переменные (резолв на запросе), поэтому
# разрешать имена на этапе -t не нужно.
#
# Usage: bash scripts/nginx-config-test.sh [conf ...]   (default: оба edge)
# Exit: 0 — все конфиги прошли, иначе код nginx -t / 2 при ошибке окружения.
#
# Это НЕ замена `nginx -t` на целевом хосте перед reload:
# server_names_hash_bucket_size и прочие лимиты зависят от его CPU.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFS=("$@")
[ "${#CONFS[@]}" -gt 0 ] || CONFS=(nginx.production.conf nginx.profk.conf)

IMAGE="$(sed -n 's/^[[:space:]]*image:[[:space:]]*\(nginx:[^[:space:]]*\).*/\1/p' "$ROOT/docker-compose.unified.yml" | head -1)"
[ -n "$IMAGE" ] || { echo "nginx image not found in docker-compose.unified.yml" >&2; exit 2; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
# Копия, а не сам каталог: сертификат .105 лежит внутри nginx-config/extra/
# (gitignored), а смонтированный ro каталог не даёт создать там файлы.
cp -R "$ROOT/nginx-config" "$WORK/custom"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=nginx-config-test" \
    -keyout "$WORK/key.pem" -out "$WORK/cert.pem" >/dev/null 2>&1

rc=0
for conf in "${CONFS[@]}"; do
    echo "== nginx -t: $conf ($IMAGE)"
    docker run --rm --network none \
        -v "$WORK/custom:/etc/nginx/custom" -v "$WORK:/dummy:ro" \
        "$IMAGE" sh -ec '
            conf="/etc/nginx/custom/$1"
            for p in $(sed -n "s/^[[:space:]]*ssl_\(certificate\|certificate_key\|trusted_certificate\)[[:space:]]\{1,\}\([^;]*\);.*/\2/p" "$conf" | sort -u); do
                mkdir -p "$(dirname "$p")"
                case "$p" in *key*) cp /dummy/key.pem "$p" ;; *) cp /dummy/cert.pem "$p" ;; esac
            done
            nginx -t -c "$conf"
        ' sh "$conf" || rc=$?
done
exit "$rc"
