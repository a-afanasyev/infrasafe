'use strict';

/**
 * [A-21] Ручной бэкап не выбирает контейнер угадыванием.
 *
 * Прежде `backup-database.sh` искал контейнер сам:
 *
 *     docker ps --filter "ancestor=postgis/postgis:15-3.3" | head -n 1
 *     docker ps --filter "name=postgres"                   | head -n 1
 *
 * На машине с несколькими проектами второй фильтр матчит чужие базы. Проверено
 * на profk 17.09.2026: там ЧЕТЫРЕ контейнера с `postgres` в имени, и первым
 * идёт `uk-payment-postgres` — платёжная база другого проекта. Сегодня спасает
 * лишь то, что фильтр по образу пока однозначен; это везение, а не устройство.
 *
 * Инструмент аварийного восстановления не должен выбирать цель везением.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../../');
const SCRIPT = fs.readFileSync(path.join(ROOT, 'backup-database.sh'), 'utf8');

/** Код без строк-комментариев: «строка есть» иначе проходит и на пояснении. */
const CODE = SCRIPT.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

describe('[A-21] контейнер определяется детерминированно', () => {
    test('нет поиска по всем контейнерам хоста', () => {
        expect(CODE).not.toMatch(/docker ps --filter/);
        expect(CODE).not.toMatch(/ancestor=postgis/);
    });

    test('контейнер спрашивается у своего compose', () => {
        expect(CODE).toMatch(/docker compose -f "\$COMPOSE_FILE" ps -q postgres/);
    });

    test('оператор может задать контейнер явно', () => {
        // Единственный законный способ обойти определение — и он осознанный.
        expect(CODE).toMatch(/POSTGRES_CONTAINER/);
    });

    test('ненайденный контейнер — отказ, а не выбор наугад', () => {
        expect(CODE).toMatch(/exit 1/);
        expect(SCRIPT).toMatch(/не запущен|POSTGRES_CONTAINER явно/);
    });

    test('дамп делает общий скрипт, а не вторая копия логики', () => {
        // Дубль уже разошёлся: у cron-варианта есть --clean/--if-exists,
        // retention и выгрузка за пределы хоста, у ручного не было ничего.
        expect(CODE).toMatch(/database\/backup-cron\.sh/);
        expect(CODE).not.toMatch(/pg_dump/);
    });
});
