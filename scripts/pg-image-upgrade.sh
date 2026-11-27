#!/usr/bin/env bash
#
# pg-image-upgrade.sh — смена образа PostgreSQL/PostGIS «на месте» (тот же том данных).
#
# Зачем отдельный скрипт. Новый образ — это не только минорная версия сервера:
# вместе с ней меняются glibc базового Debian и библиотека PostGIS. Сервер на
# старом томе стартует и выглядит здоровым, но:
#   * btree-индексы по текстовым ключам построены под прежние правила
#     сортировки glibc — поиск по ним может молча не находить строки, а
#     UNIQUE пропускать дубли. Лечится только REINDEX;
#   * база помнит версию collation, под которую создана, и пишет предупреждение
#     при каждом подключении, пока версию не обновить;
#   * расширения PostGIS в базе остаются прежней версии при новой библиотеке.
# Все три шага обязательны и делаются ПРИ ОСТАНОВЛЕННОМ приложении.
#
# Порядок (оператор):
#   1. бэкап штатным заданием;
#   2. ./scripts/pg-image-upgrade.sh snapshot  <контейнер> <файл>   # до смены образа
#   3. остановить app; пересоздать postgres на новом образе; дождаться healthy
#   4. ./scripts/pg-image-upgrade.sh finalize  <контейнер>
#   5. ./scripts/pg-image-upgrade.sh verify    <контейнер> <файл>   # сверка со снимком
#   6. запустить app
#
# Откат: остановить postgres, вернуть прежний образ и восстановить базу из
# бэкапа шага 1. Просто вернуть образ нельзя — после REINDEX индексы построены
# под новую glibc, а расширения PostGIS обновлены.
#
# Переменные: PG_SUPERUSER (по умолчанию infrasafe_app).
#
set -Eeuo pipefail

MODE="${1:-}"; CONTAINER="${2:-}"; SNAPSHOT="${3:-}"
PG_SUPERUSER="${PG_SUPERUSER:-infrasafe_app}"

die() { echo "❌ $*" >&2; exit 1; }
say() { echo "[pg-image-upgrade $(date +%H:%M:%S)] $*"; }

[ -n "$MODE" ] && [ -n "$CONTAINER" ] || die "использование: $0 snapshot|finalize|verify <контейнер> [файл-снимок]"
docker inspect "$CONTAINER" >/dev/null 2>&1 || die "контейнер $CONTAINER не найден"

# psql внутри контейнера по локальному сокету; -X — без psqlrc, ON_ERROR_STOP — падать на первой ошибке.
# БЕЗ `-i`: с ним docker exec читает stdin вызывающего и молча съедает список
# таблиц в цикле `while read` — снимок получался из одной таблицы.
# До finalize сервер шлёт предупреждение о версии collation при КАЖДОМ
# подключении (три строки: WARNING/DETAIL/HINT); сотни одинаковых строк прятали
# бы настоящие ошибки, поэтому из stderr вырезаются ровно они. Подавить их
# параметром client_min_messages нельзя — проверено репетицией. Код возврата
# psql сохраняется: фильтр стоит на stderr, а не в конвейере.
COLLATION_NOISE='collation version mismatch|was created using collation version|Rebuild all objects in this database'
q()  { docker exec "$CONTAINER" psql -X -q -v ON_ERROR_STOP=1 -U "$PG_SUPERUSER" -d "$1" -tA -c "$2" \
           2> >(grep -vE "$COLLATION_NOISE" >&2 || true); }
# То же без подавления — чтобы увидеть, шлёт ли сервер предупреждение.
collation_warnings() { docker exec "$CONTAINER" psql -X -q -U "$PG_SUPERUSER" -d "$1" -tA -c 'SELECT 1' 2>&1 | grep -c 'collation version mismatch' || true; }

databases() { q postgres "SELECT datname FROM pg_database WHERE datallowconn AND datname <> 'template0' ORDER BY datname"; }

# Снимок содержимого: число строк и контрольная сумма каждой таблицы public.
# Строки упорядочены COLLATE "C" — иначе порядок (и сумма) зависел бы от той
# самой glibc, которую меняем, и сверка ничего бы не доказывала.
take_snapshot() {
    local db="$1"
    q "$db" "SELECT 'server=' || current_setting('server_version_num')::int / 100" | sed 's/^/# /'
    local tbl
    while IFS= read -r tbl; do
        [ -n "$tbl" ] || continue
        q "$db" "SELECT '$tbl' || E'\t' || count(*) || E'\t' || coalesce(md5(string_agg(t::text, '|' ORDER BY t::text COLLATE \"C\")), '-') FROM public.\"$tbl\" t"
    done < <(q "$db" "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                      WHERE n.nspname = 'public' AND c.relkind IN ('r','m','p')
                        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
                      ORDER BY c.relname COLLATE \"C\"")
    # Отпечаток схемы — по системному каталогу, а не по тексту pg_dump: текст
    # дампа меняется между минорными версиями самого pg_dump (репетиция это
    # показала) и расхождение ничего бы не значило. Объекты расширений
    # исключены: они и должны измениться.
    q "$db" "WITH own AS (
               SELECT c.oid, c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public'
                 AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e'))
             SELECT 'columns' || E'\t' || count(*) || E'\t' || md5(string_agg(o.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':' || coalesce(pg_get_expr(ad.adbin, ad.adrelid), ''), '|' ORDER BY o.relname COLLATE \"C\", a.attnum))
               FROM own o JOIN pg_attribute a ON a.attrelid = o.oid AND a.attnum > 0 AND NOT a.attisdropped
               LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
               WHERE o.relkind IN ('r','p','m','v')
             UNION ALL
             SELECT 'indexes' || E'\t' || count(*) || E'\t' || md5(string_agg(pg_get_indexdef(o.oid), '|' ORDER BY o.relname COLLATE \"C\"))
               FROM own o WHERE o.relkind IN ('i','I')
             UNION ALL
             SELECT 'constraints' || E'\t' || count(*) || E'\t' || md5(string_agg(con.conname || ':' || pg_get_constraintdef(con.oid), '|' ORDER BY con.conname COLLATE \"C\", con.oid))
               FROM pg_constraint con JOIN own o ON o.oid = con.conrelid
             UNION ALL
             SELECT 'views' || E'\t' || count(*) || E'\t' || md5(string_agg(o.relname || ':' || pg_get_viewdef(o.oid), '|' ORDER BY o.relname COLLATE \"C\"))
               FROM own o WHERE o.relkind IN ('v','m')
             UNION ALL
             SELECT 'functions' || E'\t' || count(*) || E'\t' || md5(string_agg(p.proname || ':' || pg_get_function_identity_arguments(p.oid) || ':' || md5(p.prosrc), '|' ORDER BY p.proname COLLATE \"C\", pg_get_function_identity_arguments(p.oid) COLLATE \"C\"))
               FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
             UNION ALL
             SELECT 'triggers' || E'\t' || count(*) || E'\t' || md5(string_agg(pg_get_triggerdef(t.oid), '|' ORDER BY t.tgname COLLATE \"C\", t.oid))
               FROM pg_trigger t JOIN own o ON o.oid = t.tgrelid WHERE NOT t.tgisinternal" | sed 's/^/schema:/'
}

case "$MODE" in
snapshot)
    [ -n "$SNAPSHOT" ] || die "укажите файл для снимка"
    say "снимок базы infrasafe → $SNAPSHOT"
    take_snapshot infrasafe > "$SNAPSHOT"
    say "таблиц в снимке: $(grep -vc '^#\|^schema:' "$SNAPSHOT"), строк всего: $(grep -v '^#\|^schema:' "$SNAPSHOT" | awk -F'\t' '{s+=$2} END {print s}'); объектов схемы: $(grep '^schema:' "$SNAPSHOT" | awk -F'\t' '{printf "%s=%s ", $1, $2}' | sed 's/schema://g')"
    say "сервер: $(q postgres 'SHOW server_version') | glibc-collation базы: $(q postgres "SELECT datcollversion FROM pg_database WHERE datname='infrasafe'")"
    ;;

finalize)
    say "сервер: $(q postgres 'SHOW server_version')"
    clients="$(q postgres "SELECT count(*) FROM pg_stat_activity WHERE datname = 'infrasafe' AND usename NOT IN ('$PG_SUPERUSER') AND pid <> pg_backend_pid()")"
    [ "$clients" = 0 ] || say "⚠ к базе подключены клиенты ($clients) — приложение должно быть остановлено"

    for db in $(databases); do
        if [ "$(q "$db" "SELECT count(*) FROM pg_extension WHERE extname = 'postgis'")" = 1 ]; then
            say "[$db] PostGIS: $(q "$db" "SELECT extversion FROM pg_extension WHERE extname='postgis'") → обновление расширений"
            # Дважды: первый вызов обновляет ядро, второй — зависимые расширения,
            # которые до обновления ядра обновить нельзя.
            q "$db" "SELECT postgis_extensions_upgrade()" >/dev/null
            q "$db" "SELECT postgis_extensions_upgrade()" >/dev/null
            say "[$db] PostGIS теперь $(q "$db" "SELECT extversion FROM pg_extension WHERE extname='postgis'")"
        fi
        say "[$db] REINDEX DATABASE"
        q "$db" "REINDEX DATABASE \"$db\""
        q "$db" "ALTER DATABASE \"$db\" REFRESH COLLATION VERSION"
        # Версии отдельных collation-объектов (в столбцах не используются, но
        # предупреждение о расхождении появилось бы при первом же обращении).
        q "$db" "DO \$\$ DECLARE r record; BEGIN
                   FOR r IN SELECT oid::regcollation AS c FROM pg_collation
                            WHERE collversion IS NOT NULL AND collversion <> pg_collation_actual_version(oid) LOOP
                     EXECUTE format('ALTER COLLATION %s REFRESH VERSION', r.c);
                   END LOOP; END \$\$"
        q "$db" "ANALYZE"
    done
    # template0 не трогаем: initdb намеренно оставляет ему ПУСТУЮ версию
    # collation (в нём нет зависящих от неё объектов), и REFRESH на пустой версии
    # сервер отвергает («invalid collation version change» — выяснено репетицией).
    say "finalize завершён"
    ;;

verify)
    [ -f "$SNAPSHOT" ] || die "файл снимка $SNAPSHOT не найден"
    fail=0
    say "сервер: $(q postgres 'SHOW server_version') | $(q infrasafe "SELECT 'PostGIS ' || postgis_lib_version() || ', расширение ' || extversion FROM pg_extension WHERE extname='postgis'")"

    stale="$(q postgres "SELECT string_agg(datname, ',') FROM pg_database WHERE datcollversion IS NOT NULL AND datcollversion <> pg_database_collation_actual_version(oid)")"
    [ -z "$stale" ] && say "✓ версии collation у всех баз актуальны" || { say "✗ устаревшая версия collation: $stale"; fail=1; }

    ext="$(q infrasafe "SELECT string_agg(name || ' ' || installed_version || '→' || default_version, ', ') FROM pg_available_extensions WHERE installed_version IS NOT NULL AND installed_version <> default_version")"
    [ -z "$ext" ] && say "✓ все расширения на версии библиотеки" || { say "✗ расширения отстают от библиотеки: $ext"; fail=1; }

    # amcheck: каждый btree-индекс сверяется со своей таблицей (heapallindexed).
    q infrasafe "CREATE EXTENSION IF NOT EXISTS amcheck" >/dev/null
    bad="$(q infrasafe "DO \$\$ DECLARE r record; n int := 0; bad text := '';
              BEGIN
                FOR r IN SELECT c.oid, c.relname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                         JOIN pg_am a ON a.oid = c.relam JOIN pg_namespace ns ON ns.oid = c.relnamespace
                         -- relkind 'i': у секционированной таблицы есть ещё «зонтичный»
                         -- индекс ('I') без собственных данных — amcheck его не принимает.
                         WHERE a.amname = 'btree' AND c.relkind = 'i' AND i.indisvalid
                           AND c.relpersistence <> 't' AND ns.nspname NOT IN ('pg_toast') LOOP
                  BEGIN
                    PERFORM bt_index_check(r.oid, true); n := n + 1;
                  EXCEPTION WHEN OTHERS THEN bad := bad || r.relname || ': ' || SQLERRM || E'\n';
                  END;
                END LOOP;
                RAISE NOTICE 'AMCHECK ok=% bad=[%]', n, bad;
              END \$\$" 2>&1 | grep AMCHECK || true)"
    q infrasafe "DROP EXTENSION amcheck" >/dev/null
    case "$bad" in *"bad=[]"*) say "✓ amcheck: ${bad#*AMCHECK }";; *) say "✗ amcheck: $bad"; fail=1;; esac

    now="$(mktemp)"; take_snapshot infrasafe > "$now"
    if diff <(grep -v '^#' "$SNAPSHOT") <(grep -v '^#' "$now") > "$now.diff"; then
        say "✓ содержимое и схема совпадают со снимком ($(grep -vc '^#\|^schema:' "$now") таблиц, $(grep -v '^#\|^schema:' "$now" | awk -F'\t' '{s+=$2} END {print s}') строк)"
    else
        say "✗ расхождение со снимком:"; sed 's/^/    /' "$now.diff" | cut -c1-160 | head -20; fail=1
    fi
    rm -f "$now" "$now.diff"

    # Сервер сам сообщает о расхождении версии collation при подключении —
    # самая прямая проверка того, что finalize сделал своё дело.
    for db in $(databases); do
        [ "$(collation_warnings "$db")" = 0 ] || { say "✗ [$db] сервер всё ещё предупреждает о версии collation"; fail=1; }
    done
    [ "$fail" = 0 ] && say "✓ при подключении ни к одной базе предупреждений о collation нет"

    [ "$fail" = 0 ] && say "ИТОГ: всё сошлось" || { say "ИТОГ: есть расхождения"; exit 1; }
    ;;

*) die "неизвестный режим '$MODE' (snapshot|finalize|verify)" ;;
esac
