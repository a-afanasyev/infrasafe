#!/usr/bin/env bash
# ВКЛЮЧИТЬ сайт profk.uz обратно — снимает режим обслуживания.
#
#     ./scripts/profk-maintenance-off.sh
#
# Ни reload, ни деплоя: nginx проверяет наличие флага на каждом запросе.
#
# Выключить сайт: ./scripts/profk-maintenance-on.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FLAG="$REPO_ROOT/frontend-html/.maintenance"
SITE_URL="${PROFK_URL:-https://profk.uz/}"

rm -f "$FLAG"
echo "флаг снят: $FLAG"

code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$SITE_URL" || echo "нет ответа")"
if [ "$code" = "503" ]; then
    # Одного повтора достаточно: на проде bind-mount нативный, задержки нет.
    sleep 1
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$SITE_URL" || echo "нет ответа")"
fi

if [ "$code" = "503" ]; then
    echo "⚠️  сайт всё ещё отдаёт 503."
    echo "    Проверьте, не стоит ли флаг ещё где-то: ls -a $REPO_ROOT/frontend-html"
    echo "    и что приложение вообще живо: curl -s ${SITE_URL%/}/health"
    exit 1
fi
echo "✅ сайт включён ($SITE_URL → $code)"
