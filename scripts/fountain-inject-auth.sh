#!/usr/bin/env bash
#
# Готовит подстановку Basic-авторизации к контроллеру фонтана для nginx.
#
# ЗАЧЕМ. Панель на устройстве закрыта Basic, но пользователь не должен её
# видеть: доступ решает НАША авторизация, а заголовок к контроллеру подставляет
# сервер. Учётные данные устройства при этом не должны попасть ни в репозиторий,
# ни в браузер, ни в HTML.
#
# Поэтому конфиг nginx подключает сгенерированный файл по маске:
#
#   include /etc/nginx/custom/fountain-auth.*.conf;
#
# Маска, а не точное имя, намеренно: отсутствующий файл при строгом include
# уронил бы `nginx -t` и перезагрузку ВСЕГО периметра, то есть infrasafe.uz, —
# из-за одной панели. Маска, не найдя ничего, просто ничего не подключит;
# наличие проверяет этот скрипт.
#
# Источник — /home/infrasafe/secure/fountain_panel_credentials, одна строка
# вида `логин:пароль`, права 0600. Кладёт его разработчик через свой SSH.
#
# Запуск на .105 под учётной записью infrasafe:
#   scripts/fountain-inject-auth.sh            — сгенерировать/обновить
#   scripts/fountain-inject-auth.sh --check    — проверить без изменений

set -Eeuo pipefail

readonly CREDS="/home/infrasafe/secure/fountain_panel_credentials"
readonly OUT="/home/infrasafe/infrasafe/nginx-config/fountain-auth.local.conf"

CHECK_ONLY=0
if [ "${1:-}" = "--check" ]; then CHECK_ONLY=1; fi

fail() { echo "❌ $*" >&2; exit 1; }

[ -s "$CREDS" ] || fail "нет файла учётных данных: $CREDS"

# Формат проверяется до генерации: пустой пароль или лишний перевод строки дают
# заголовок, который устройство отвергнет 401-м, а мы этот 401 прячем от
# браузера (иначе всплывёт системный диалог) — то есть пользователь увидит
# пустую панель без единой подсказки о причине.
line="$(head -n1 "$CREDS")"
case "$line" in
    *:*) : ;;
    *) fail "формат должен быть логин:пароль (одна строка)" ;;
esac
[ -n "${line%%:*}" ] || fail "пустой логин"
[ -n "${line#*:}" ]  || fail "пустой пароль"

encoded="$(printf '%s' "$line" | base64 | tr -d '\n')"
generated="proxy_set_header Authorization \"Basic ${encoded}\";"

if [ "$CHECK_ONLY" = 1 ]; then
    [ -s "$OUT" ] || fail "подстановка не сгенерирована: $OUT (запустить без --check)"
    if [ "$(cat "$OUT")" = "$generated" ]; then
        echo "✅ подстановка на месте и соответствует учётным данным"
    else
        fail "подстановка РАСХОДИТСЯ с $CREDS — перегенерировать"
    fi
    # Права: файл содержит учётные данные в обратимом виде, читать его посторонним незачем.
    perms="$(stat -c %a "$OUT" 2>/dev/null || stat -f %Lp "$OUT")"
    [ "$perms" = "600" ] || fail "права на $OUT = $perms, ожидается 600"
    echo "✅ права 600"
    exit 0
fi

umask 077
printf '%s\n' "$generated" > "$OUT"
chmod 600 "$OUT"
echo "✅ подстановка записана: $OUT (права 600)"
echo "   дальше: nginx -t на хосте и reload"
