'use strict';

/**
 * [A-15] Quick start обязан упоминать шаг миграций.
 *
 * `database/init/` доводит базу только до миграции 017 — всё, что появилось
 * позже, применяет раннер. Пока README об этом молчал, «поднять стек с нуля»
 * означало получить схему, отставшую от кода: нет `uk_outbox`, нет
 * `alert_verifications`, нет сезонных колонок, а вход ломается на
 * `sessions_revoked_at` из миграции 043 — колонке, которую читает auth-проекция.
 *
 * Подтверждено дважды: аудитом 08.09.2026 и независимо — подъёмом стека с нуля
 * 12.09.2026.
 *
 * Тест сторожит не текст, а ФАКТ наличия шага: инструкция, из которой выпал
 * обязательный шаг, выглядит рабочей ровно до первого чистого тома.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../../');
const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

/** Номер последней миграции в каталоге — верхняя граница схемы. */
function latestMigrationNumber() {
    const files = fs.readdirSync(path.join(ROOT, 'database/migrations'))
        .filter((f) => /^\d{3}_.*\.sql$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    return Math.max(...files.map((f) => parseInt(f.slice(0, 3), 10)));
}

/** До какой миграции доводит init-схема (её baseline-файл). */
function initBaselineNumber() {
    const baseline = fs.readFileSync(
        path.join(ROOT, 'database/init/99_schema_migrations_baseline.sql'),
        'utf8'
    );
    // Строки вида `('017_runtime_role.sql', '<checksum>')` — берём номер файла.
    const nums = [...baseline.matchAll(/\('(\d{3})_[^']*\.sql'/g)].map((m) => parseInt(m[1], 10));
    expect(nums.length).toBeGreaterThan(0);
    return Math.max(...nums);
}

describe('[A-15] инструкция подъёма с нуля не теряет шаг миграций', () => {
    test('quick start называет запуск раннера', () => {
        expect(README).toMatch(/scripts\/migrate\.sh up/);
    });

    test('рядом сказано, что init-схема неполна', () => {
        // Без объяснения шаг выглядит необязательным и выпадает первым.
        expect(README).toMatch(/database\/init\/.*(доводит|только до)|только до миграции 017/s);
    });

    test('init-схема ДЕЙСТВИТЕЛЬНО отстаёт от каталога миграций', () => {
        // Сторож сторожа: если однажды init начнёт доводить схему до конца,
        // предупреждение в README станет ложью, и тест об этом скажет.
        const baseline = initBaselineNumber();
        const latest = latestMigrationNumber();
        expect(latest).toBeGreaterThan(baseline);
    });
});
