// [OPS-002] Структурный контракт migrate.sh: контрольные суммы считаются ОДНИМ
// вызовом discover_js, а не по вызову на файл.
//
// Что было: file_checksum() = `git show … | discover_js checksum` на КАЖДУЮ
// миграцию. На проде node живёт только в образе приложения, значит каждый вызов
// = отдельный `docker run` — 42 последовательных старта контейнера, минуты на
// шаге `migrate up`, который выглядел зависшим (наблюдение с profk 12.08.2026).
//
// Что стало: discovery отдаёт oid каждого блоба (git ls-tree его и так знает),
// blobs текут одним `git cat-file --batch`, discover_js checksum-batch хеширует
// весь поток за один запуск процесса/контейнера.
//
// Рантайм-поведение раннера покрыто e2e (tests/migrate/run-migrate-tests.sh,
// включая image-mode шаг 13); здесь — текстовый контракт, чтобы возврат
// per-file вызова не прошёл ревью молча.

const fs = require('fs');
const path = require('path');

const SCRIPT = fs.readFileSync(
    path.resolve(__dirname, '../../../scripts/migrate.sh'),
    'utf8'
);

describe('migrate.sh batch checksums (OPS-002)', () => {
    test('все блобы текут одним git cat-file --batch в checksum-batch', () => {
        expect(SCRIPT).toMatch(/git cat-file --batch/);
        expect(SCRIPT).toMatch(/discover_js checksum-batch/);
    });

    test('per-file вызова `discover_js checksum` больше нет', () => {
        // `checksum-batch` содержит подстроку `checksum` — отсекаем именно
        // одиночный сабкоманд (за ним не следует дефис).
        expect(SCRIPT).not.toMatch(/discover_js checksum(?!-batch)/);
    });

    test('функция file_checksum удалена, а не оставлена мёртвой рядом', () => {
        expect(SCRIPT).not.toMatch(/file_checksum\(\)/);
    });

    test('discovery отдаёт oid третьим полем (источник ключей batch-запроса)', () => {
        // Комментарий-контракт у discover_lines обязан описывать три поля —
        // читатель bash-цикла должен видеть форму записи, не раскапывая node.
        expect(SCRIPT).toMatch(/<filename>\\t<path>\\t<oid>/);
    });

    test('карта сумм строится ДО цикла применения (up) и до цикла сверки (status)', () => {
        const mapIdx = SCRIPT.indexOf('discover_js checksum-batch');
        const upLoop = SCRIPT.indexOf('process_one');
        const statusLoop = SCRIPT.indexOf('cmd_status');
        expect(mapIdx).toBeGreaterThan(-1);
        // построение карты — функция, объявленная раньше обоих потребителей
        expect(mapIdx).toBeLessThan(upLoop);
        expect(mapIdx).toBeLessThan(statusLoop);
    });

    test('пустой lookup суммы — жёсткий отказ, не пустая строка в schema_migrations', () => {
        // Если oid не нашёлся в карте (рассинхрон discovery ↔ batch), записать
        // пустую сумму значило бы навсегда зафиксировать drift на ровном месте.
        expect(SCRIPT).toMatch(/lookup_checksum/);
        expect(SCRIPT).toMatch(/no checksum for|нет суммы для/);
    });
});
