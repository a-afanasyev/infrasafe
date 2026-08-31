#!/usr/bin/env bash
# ВЫКЛЮЧИТЬ сайт profk.uz — посетители видят страницу «Сайт временно не
# работает», поисковики получают 503 + Retry-After (страницы остаются в индексе).
#
#     ./scripts/profk-maintenance-on.sh
#
# Ни reload, ни деплоя: nginx проверяет наличие флага на каждом запросе.
# Продолжают работать: контроль доступа УК (турникеты и двери), /health для
# мониторинга и обновление сертификата — см. nginx.profk.conf, «режим
# обслуживания».
#
# Вернуть сайт: ./scripts/profk-maintenance-off.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FLAG="$REPO_ROOT/frontend-html/.maintenance"
SITE_URL="${PROFK_URL:-https://profk.uz/}"

touch "$FLAG"
echo "флаг поставлен: $FLAG"

# Проверяем результат, а не рапортуем об успехе по факту touch: если конфиг с
# гейтом ещё не доехал до хоста, флаг молча ничего не сделает.
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$SITE_URL" || echo "нет ответа")"
if [ "$code" = "503" ]; then
    echo "✅ сайт выключен ($SITE_URL → 503)"
else
    echo "⚠️  сайт всё ещё отвечает $code вместо 503."
    echo "    Вероятная причина: правка nginx.profk.conf не доставлена на хост."
    echo "    См. docs/MAINTENANCE-MODE-PROFK.md, раздел «Первое включение»."
    exit 1
fi
