#!/usr/bin/env bash
#
# Восстановление серверной части доступа к панели фонтана (идемпотентно).
#
# ЗАЧЕМ ЭТОТ ФАЙЛ СУЩЕСТВУЕТ. Контейнер `infrasafe-wireguard-1` собран на образе
# linuxserver/wireguard, у которого `PEERS=10`. Его init-скрипт перегенерирует
# `/config/wg_confs/wg0.conf` ЦЕЛИКОМ, если изменится любая из серверных
# переменных окружения: PEERS, SERVERURL, SERVERPORT, PEERDNS, ALLOWEDIPS,
# INTERFACE, PERSISTENTKEEPALIVE_PEERS. Peer фонтана добавлен РУКАМИ (у нас
# только публичный ключ контроллера — генерировать пару на сервере нельзя),
# поэтому при такой перегенерации он исчезнет МОЛЧА: туннель поднимется,
# контейнер будет healthy, панель просто перестанет открываться.
#
# Скрипт возвращает состояние целиком и его можно запускать сколько угодно раз.
#
# Что он НЕ делает: не трогает DNS, сертификаты и конфиг nginx — они живут
# своим порядком (см. docs/BACKLOG.md, пункт FOUNTAIN).
#
# Запуск на .105 под учётной записью infrasafe:
#   scripts/wireguard-fountain-peer.sh
#
# Проверка без изменений:
#   scripts/wireguard-fountain-peer.sh --check

set -Eeuo pipefail

readonly CONTAINER="infrasafe-wireguard-1"
readonly CONF="/home/infrasafe/wireguard/config/wg_confs/wg0.conf"
readonly PSK_FILE="/home/infrasafe/secure/fountain_wg_preshared_key"
readonly APP_NETWORK="infrasafe_leaflet-network"

# Публичный ключ контроллера KinCony KC868-A6 (получен 20.09.2026).
# Публичный — не секрет, поэтому живёт в репозитории. PSK — НЕТ, он только в
# PSK_FILE с правами 0600.
readonly PEER_PUBKEY="S74S4LYw0Ij9ESfcmkpsalGUcxtRQ/Jf3vioniJ4ORI="
readonly PEER_IP="10.13.13.12"
readonly SERVER_VPN_IP="10.13.13.1"
# Подсеть приложения — источник разрешённых запросов к панели. Матчим по ней, а
# НЕ по имени интерфейса: при пересоздании контейнера docker может отдать
# leaflet-network другой номер eth, и правило с `-i eth1` молча перестанет
# совпадать (проверено: путь при этом уходит в eth0 и MASQUERADE — то есть в
# интернет, а не в туннель).
readonly APP_SUBNET="172.19.0.0/16"
readonly GATEWAY_PORT="8080"

CHECK_ONLY=0
if [ "${1:-}" = "--check" ]; then CHECK_ONLY=1; fi

wg_exec() { docker exec "$CONTAINER" "$@"; }

fail() { echo "❌ $*" >&2; exit 1; }
ok()   { echo "✅ $*"; }
note() { echo "   $*"; }

docker inspect "$CONTAINER" >/dev/null 2>&1 || fail "контейнер $CONTAINER не найден"
[ -s "$PSK_FILE" ] || fail "нет PSK: $PSK_FILE (создать: docker exec $CONTAINER wg genpsk > $PSK_FILE && chmod 600 $PSK_FILE)"

problems=0
report() {
    local what="$1" good="$2"
    if [ "$good" = 1 ]; then
        ok "$what"
    else
        # В режиме --check писать «ВОССТАНАВЛИВАЮ» — врать: ничего не
        # восстанавливается. Читающий лог должен видеть, что произошло, а не что
        # могло бы произойти.
        if [ "$CHECK_ONLY" = 1 ]; then echo "⚠️  $what"; else echo "⚠️  $what — ВОССТАНАВЛИВАЮ"; fi
        problems=$((problems + 1))
    fi
}

# Восстановительное действие выполняется только вне --check. Отдельная функция,
# а не `[ "$CHECK_ONLY" = 0 ] && …`: такой список возвращает 1, когда условие
# ложно, и под `set -e` это мина — достаточно оказаться последней командой в
# ветке, чтобы скрипт молча оборвался на середине восстановления.
repair() {
    if [ "$CHECK_ONLY" = 0 ]; then "$@"; fi
}

# 1. Peer в постоянном конфиге -------------------------------------------------
if grep -qF "$PEER_PUBKEY" "$CONF"; then
    report "peer фонтана есть в wg0.conf" 1
else
    report "peer фонтана ОТСУТСТВУЕТ в wg0.conf (перегенерация образа?)" 0
    if [ "$CHECK_ONLY" = 0 ]; then
        cp "$CONF" "$CONF.bak-$(date +%Y%m%d%H%M%S)"
        {
            echo ""
            echo "[Peer]"
            echo "# fountain — KinCony KC868-A6. ДОБАВЛЕН ВРУЧНУЮ, восстанавливается"
            echo "# скриптом scripts/wireguard-fountain-peer.sh (см. шапку про PEERS)."
            echo "PublicKey = $PEER_PUBKEY"
            echo "PresharedKey = $(cat "$PSK_FILE")"
            echo "AllowedIPs = $PEER_IP/32"
        } >> "$CONF"
    fi
fi

# 2. Peer применён вживую ------------------------------------------------------
if wg_exec wg show wg0 allowed-ips 2>/dev/null | grep -qF "$PEER_PUBKEY"; then
    report "peer активен в wg0" 1
else
    report "peer НЕ активен в wg0" 0
    if [ "$CHECK_ONLY" = 0 ]; then
        docker exec -i "$CONTAINER" sh -c 'cat > /tmp/psk && chmod 600 /tmp/psk' < "$PSK_FILE"
        wg_exec wg set wg0 peer "$PEER_PUBKEY" preshared-key /tmp/psk allowed-ips "$PEER_IP/32"
        wg_exec rm -f /tmp/psk
    fi
fi

# 3. Маршрут к контроллеру -----------------------------------------------------
# `wg set` маршрутов НЕ создаёт — их делает только `wg-quick up` из AllowedIPs.
# Без маршрута пакет уходит в default route и наружу через MASQUERADE: выглядит
# как таймаут, то есть неотличимо от «контроллер офлайн». Счётчики правил это
# показывают, время отклика — нет.
if wg_exec ip route get "$PEER_IP" 2>/dev/null | head -1 | grep -q "dev wg0"; then
    report "маршрут $PEER_IP через wg0" 1
else
    report "маршрут $PEER_IP идёт МИМО туннеля" 0
    repair wg_exec ip route replace "$PEER_IP/32" dev wg0
fi

# 4. Контейнер в сети приложения ----------------------------------------------
if docker inspect "$CONTAINER" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' | grep -q "$APP_NETWORK"; then
    report "подключён к $APP_NETWORK" 1
else
    report "НЕ подключён к $APP_NETWORK — nginx не достанет" 0
    repair docker network connect "$APP_NETWORK" "$CONTAINER"
fi

# 5. Правила фильтра и трансляции ---------------------------------------------
# Постоянное место — PostUp/PostDown в wg0.conf (исполняются на каждом подъёме
# интерфейса). Здесь — применение вживую, без рестарта туннеля.
ensure_rule() {
    local table="$1"; shift
    local chain="$1"; shift
    local desc="$1"; shift
    if wg_exec iptables ${table:+-t "$table"} -C "$chain" "$@" 2>/dev/null; then
        report "$desc" 1
    else
        report "$desc" 0
        repair wg_exec iptables ${table:+-t "$table"} -I "$chain" 1 "$@"
    fi
}

ensure_rule "" FORWARD "контроллер не инициирует соединений" \
    -i wg0 -s "$PEER_IP/32" -m conntrack --ctstate NEW -j DROP
ensure_rule nat PREROUTING "проброс :$GATEWAY_PORT на панель" \
    -p tcp -s "$APP_SUBNET" --dport "$GATEWAY_PORT" -j DNAT --to-destination "$PEER_IP:80"
ensure_rule nat POSTROUTING "подмена источника на $SERVER_VPN_IP" \
    -o wg0 -d "$PEER_IP/32" -j SNAT --to-source "$SERVER_VPN_IP"

# 6. PostUp несёт те же правила ------------------------------------------------
if grep -q "$PEER_IP:80" "$CONF"; then
    report "PostUp переживёт рестарт интерфейса" 1
else
    report "PostUp БЕЗ правил фонтана — после рестарта путь отвалится" 0
    note "дописать вручную: см. шапку файла и docs/BACKLOG.md"
fi

echo
if [ "$problems" = 0 ]; then
    ok "состояние целое, менять нечего"
elif [ "$CHECK_ONLY" = 1 ]; then
    fail "расхождений: $problems (запуск без --check восстановит)"
else
    ok "восстановлено расхождений: $problems"
fi
