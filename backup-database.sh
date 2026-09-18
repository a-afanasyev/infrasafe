#!/bin/bash
#
# Ручной бэкап базы InfraSafe — тонкая обёртка над database/backup-cron.sh.
#
# [A-21] Прежде этот скрипт искал контейнер САМ и делал это угадыванием:
#
#     docker ps --filter "ancestor=postgis/postgis:15-3.3" | head -n 1
#     docker ps --filter "name=postgres"                   | head -n 1
#
# На машине с несколькими проектами второй фильтр матчит чужие базы. Проверено
# на profk 17.09.2026 — там четыре контейнера с `postgres` в имени, и первым
# идёт `uk-payment-postgres`, платёжная база другого проекта. Сегодня спасает
# только то, что первый фильтр (по образу) пока однозначен; это везение, а не
# устройство: достаточно сменить тег образа, и выбор уедет на запасную ветку.
#
# Теперь контейнер определяется ДЕТЕРМИНИРОВАННО — спросом у своего compose,
# а не сканированием хоста. Сам дамп, сжатие, выгрузку и хранение делает
# database/backup-cron.sh: логика была продублирована, и дубль уже разошёлся —
# у cron-варианта есть `--clean --if-exists --no-owner --no-privileges`,
# retention и выгрузка за пределы хоста, у ручного не было ничего из этого.
#
# Использование:
#     ./backup-database.sh
#     BACKUP_LOCAL_DIR=/tmp/backups ./backup-database.sh
#
set -Eeuo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo -e "${YELLOW}🗄️  Бэкап базы данных InfraSafe${NC}"
echo "================================================="

# SEC-16: креды не хардкодим — читаем из окружения или из env-файла рядом.
for ENV_FILE in ".env.prod" ".env"; do
    if [ -f "$ENV_FILE" ]; then
        # shellcheck disable=SC1090
        set -a; . "./$ENV_FILE"; set +a
        echo "  Переменные окружения: $ENV_FILE"
        break
    fi
done

DB_NAME="${DB_NAME:-infrasafe}"
DB_USER="${DB_USER:-infrasafe_app}"
export DB_NAME DB_USER
export PGPASSWORD="${PGPASSWORD:-${DB_PASSWORD:-}}"

# [A-21] Контейнер — у своего compose, а не у всего хоста. Оператор может
# задать POSTGRES_CONTAINER явно; это единственный способ обойти определение.
if [ -z "${POSTGRES_CONTAINER:-}" ]; then
    COMPOSE_FILE="${BACKUP_COMPOSE_FILE:-docker-compose.unified.yml}"
    if [ ! -f "$COMPOSE_FILE" ]; then
        echo -e "${RED}❌ Не найден $COMPOSE_FILE — запускайте из корня репозитория${NC}" >&2
        exit 1
    fi
    container_id="$(docker compose -f "$COMPOSE_FILE" ps -q postgres 2>/dev/null || true)"
    if [ -z "$container_id" ]; then
        echo -e "${RED}❌ Контейнер postgres проекта не запущен ($COMPOSE_FILE).${NC}" >&2
        echo "   Поднимите стек либо задайте POSTGRES_CONTAINER явно." >&2
        exit 1
    fi
    POSTGRES_CONTAINER="$(docker inspect --format '{{.Name}}' "$container_id" | sed 's|^/||')"
fi
export POSTGRES_CONTAINER

echo "  База:      $DB_NAME"
echo "  Контейнер: $POSTGRES_CONTAINER"
echo ""

if bash "$SCRIPT_DIR/database/backup-cron.sh"; then
    echo ""
    echo -e "${GREEN}✅ Бэкап завершён успешно.${NC}"
    BACKUP_DIR="${BACKUP_LOCAL_DIR:-/var/backups/infrasafe}"
    if [ -d "$BACKUP_DIR" ]; then
        echo -e "${YELLOW}📋 Последние бэкапы (${BACKUP_DIR}):${NC}"
        ls -lht "$BACKUP_DIR" 2>/dev/null | head -n 6 | awk 'NR>1 {print "  " $9 " (" $5 ")"}'
    fi
else
    echo -e "${RED}❌ Бэкап не создан — смотрите сообщение выше.${NC}" >&2
    exit 1
fi
