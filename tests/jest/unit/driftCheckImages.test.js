'use strict';

/**
 * [аудит 05.11.2026, H-1] Сторож дрейфа образов.
 *
 * Compose-бамп postgres/redis (PR 11.10) месяц не менял ничего на проде:
 * update-production.sh пересоздаёт только app. Теперь compose-drift-check.sh
 * сравнивает образ запущенного контейнера с объявленным (Check C), а деплой
 * зовёт его после health-wait и предупреждает. Тест — статический: скрипты
 * исполняются только на хосте с docker, здесь проверяем, что конструкции на
 * месте и не выпилены рефакторингом.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../../..');
const drift = fs.readFileSync(path.join(ROOT, 'scripts/compose-drift-check.sh'), 'utf8');
const deploy = fs.readFileSync(path.join(ROOT, 'update-production.sh'), 'utf8');

describe('[H-1] compose-drift-check.sh — Check C', () => {
    test('сравнивает immutable ID запущенного контейнера с ID объявленного образа', () => {
        expect(drift).toMatch(/Check C: image drift/);
        expect(drift).toMatch(/docker inspect "\$cname" --format '\{\{\.Image\}\}'/);
        expect(drift).toMatch(/docker image inspect "\$image" --format '\{\{\.Id\}\}'/);
        expect(drift).toMatch(/IMAGE DRIFT running=/);
    });

    test('отсутствие объявленного образа на хосте — тоже дрейф', () => {
        expect(drift).toMatch(/is not present on this host/);
    });

    test('контейнер → сервис строго по compose-label, не по имени', () => {
        expect(drift).toMatch(/--filter "label=com\.docker\.compose\.service=\$svc"/);
    });

    test('поддерживает несколько compose-файлов (profk = unified + overlay)', () => {
        expect(drift).toMatch(/COMPOSE_FILES=/);
        expect(drift).toMatch(/docker compose "\$\{COMPOSE_F\[@\]\}" config --format json/);
    });
});

describe('[H-1] update-production.sh — Step 5b', () => {
    test('зовёт drift-check после health-wait и только предупреждает', () => {
        const i5 = deploy.indexOf('Step 5: app health-wait');
        const i5b = deploy.indexOf('Step 5b: compose drift check');
        const i6 = deploy.indexOf('Step 6: publish frontend dist');
        expect(i5).toBeGreaterThan(-1);
        expect(i5b).toBeGreaterThan(i5);
        expect(i6).toBeGreaterThan(i5b);
        const block = deploy.slice(i5b, i6);
        expect(block).toMatch(/COMPOSE_FILES="\$\{COMPOSE_FILES\[\*\]\}" bash scripts\/compose-drift-check\.sh/);
        expect(block).toMatch(/warn "⚠ compose drift detected/);
        expect(block).not.toMatch(/exit 1/);
    });
});
