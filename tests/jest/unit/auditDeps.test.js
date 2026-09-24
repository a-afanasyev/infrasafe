'use strict';

/**
 * Обязательная проверка `npm audit` не должна падать от чужой недоступности.
 *
 * Найдено 18.09.2026 на живом прогоне `main` (коммит `ce7727ca`): job `npm audit`
 * упал, но НЕ из-за уязвимости. Шаг для `generator/` получил от npm
 * `400 Bad Request` на устаревающем quick-эндпоинте, и `npm audit` вышел с
 * кодом 1 — тем же самым, каким он сообщает о найденных уязвимостях. Следующий
 * прогон прошёл. Локально не воспроизводится.
 *
 * Почему это важнее, чем выглядит: `npm audit` — ОБЯЗАТЕЛЬНАЯ проверка защиты
 * ветки `main`. Флаки в ней означают случайно заблокированный мерж, а привычка
 * «перезапустить и поехали» со временем превращает любую красную проверку в шум.
 *
 * Различить два случая можно только по содержимому отчёта, и формы сняты с
 * живого npm, а не придуманы:
 *
 *   успех  → {"auditReportVersion":2, …, "metadata":{"vulnerabilities":{…}}}
 *   отказ  → {"message":"request to … failed …","error":{…}}   (metadata НЕТ)
 *
 * В обоих случаях stdout — чистый JSON, а код возврата 1. Поэтому решение
 * принимается по JSON, а не по коду.
 *
 * Тест поведенческий: он запускает НАСТОЯЩИЙ скрипт с заглушкой вместо `npm`.
 * Текстовая проверка «в скрипте есть retry» ничего бы не доказала — важно, при
 * каком ответе он повторяет, а при каком обязан упасть сразу.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, '../../../scripts/audit-deps.sh');

/** Коды возврата — часть контракта: «уязвимости» и «аудит не выполнен» разные. */
const EXIT_OK = 0;
const EXIT_VULNERABLE = 1;
const EXIT_UNAVAILABLE = 2;

const report = (counts, vulnerabilities = {}) => JSON.stringify({
    auditReportVersion: 2,
    vulnerabilities,
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0, ...counts } },
});

// Форма записи — как у настоящего `npm audit --json` (снята 24.09 с qs 6.15.2).
const moderateQs = (fixAvailable) => report({ moderate: 1, total: 1 }, {
    qs: { name: 'qs', severity: 'moderate', isDirect: false, range: '2.2.5 - 6.15.3', fixAvailable },
});

const endpointError = JSON.stringify({
    message: 'request to https://registry.npmjs.org/-/npm/v1/security/audits/quick failed, reason: Bad Request',
    error: { summary: '', detail: '' },
});

/**
 * Запускает скрипт с поддельным `npm`, который выдаёт заранее заданные ответы
 * по очереди (последний повторяется). Счётчик вызовов — в файле, чтобы тест
 * видел, сколько попыток было на самом деле.
 */
function run(responses, { env = {} } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-deps-'));
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    const counter = path.join(dir, 'calls');
    fs.writeFileSync(counter, '');

    const cases = responses
        .map((r, i) => `  ${i}) cat <<'JSON_${i}'\n${r}\nJSON_${i}\n     exit ${r.includes('metadata') ? 0 : 1} ;;`)
        .join('\n');

    fs.writeFileSync(path.join(bin, 'npm'), `#!/usr/bin/env bash
echo x >> "${counter}"
n=$(( $(wc -l < "${counter}") - 1 ))
last=${responses.length - 1}
[ "$n" -gt "$last" ] && n="$last"
case "$n" in
${cases}
esac
`, { mode: 0o755 });

    const res = spawnSync('bash', [SCRIPT], {
        encoding: 'utf8',
        env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            AUDIT_RETRY_DELAYS: '0 0',
            ...env,
        },
    });
    const calls = fs.readFileSync(counter, 'utf8').split('\n').filter(Boolean).length;
    fs.rmSync(dir, { recursive: true, force: true });
    return { ...res, calls };
}

describe('[CI] аудит отличает уязвимость от недоступности', () => {
    test('чистый отчёт — успех, одна попытка', () => {
        const res = run([report({})]);
        expect([res.status, res.calls]).toEqual([EXIT_OK, 1]);
    });

    // [N-10] Moderate в БОЕВОМ дереве роняет проверку, когда npm знает
    // исправление без смены мажора, то есть то, что делает `npm audit fix`.
    // Так qs 6.15.2 (DoS на разборе query-string каждого запроса) неделями
    // стоял в рантайме при зелёном CI. Неисправимый moderate не роняет: иначе
    // одна находка без фикса блокировала бы все PR и учила жать «перезапуск».
    test('moderate с исправлением без смены мажора — роняет и называет пакет', () => {
        const res = run([moderateQs(true)]);
        expect([res.status, res.calls]).toEqual([EXIT_VULNERABLE, 1]);
        expect(res.stdout + res.stderr).toMatch(/qs/);
        expect(res.stdout + res.stderr).toMatch(/npm audit fix/);
    });

    test('moderate, исправимый только сменой мажора, — не роняет, но виден', () => {
        const res = run([moderateQs({ name: 'express', version: '5.0.0', isSemVerMajor: true })]);
        expect(res.status).toBe(EXIT_OK);
        expect(res.stdout + res.stderr).toMatch(/qs/);
    });

    test('moderate без исправления — не роняет, но виден', () => {
        const res = run([moderateQs(false)]);
        expect(res.status).toBe(EXIT_OK);
        expect(res.stdout + res.stderr).toMatch(/qs/);
    });

    test('moderate без записи о пакете (только счётчик) — не роняет', () => {
        const res = run([report({ moderate: 3, total: 3 })]);
        expect(res.status).toBe(EXIT_OK);
    });

    test.each([['high', { high: 2, total: 2 }], ['critical', { critical: 1, total: 1 }]])(
        '%s роняет СРАЗУ, без повторов',
        (_name, counts) => {
            const res = run([report(counts)]);
            // Повтор здесь был бы вреден: находка не станет другой, а красная
            // проверка превратится в «подожди и перезапусти».
            expect([res.status, res.calls]).toEqual([EXIT_VULNERABLE, 1]);
            expect(res.stdout + res.stderr).toMatch(/high|critical/i);
        }
    );

    test('отказ эндпоинта — повтор, и успех со второй попытки', () => {
        const res = run([endpointError, report({})]);
        expect([res.status, res.calls]).toEqual([EXIT_OK, 2]);
    });

    test('эндпоинт недоступен всегда — отдельный код возврата, а не «уязвимости»', () => {
        const res = run([endpointError]);
        // Проверка всё равно красная: молчаливое «ок» отключило бы аудит на
        // время чужой аварии. Но причина обязана быть различима.
        expect(res.status).toBe(EXIT_UNAVAILABLE);
        expect(res.calls).toBe(3);
        expect(res.stdout + res.stderr).toMatch(/не выполнен|недоступ/i);
    });

    test('мусор вместо JSON считается недоступностью, а не чистым отчётом', () => {
        // Инвариант, который легко потерять: неразобранный вывод НЕ должен
        // читаться как «уязвимостей нет».
        const res = run(['<html>502 Bad Gateway</html>']);
        expect(res.status).toBe(EXIT_UNAVAILABLE);
    });
});

describe('[CI] скрипт подключён к рабочему процессу', () => {
    const CI = fs.readFileSync(path.resolve(__dirname, '../../../.github/workflows/ci.yml'), 'utf8');

    test('оба дерева зависимостей идут через него', () => {
        // Корневое и generator/ — разные деревья и разные рантайм-образы;
        // правило для них должно быть одно.
        const uses = CI.match(/scripts\/audit-deps\.sh/g) || [];
        expect(uses.length).toBeGreaterThanOrEqual(2);
    });

    test('прямых вызовов npm audit в workflow не осталось', () => {
        // Иначе рядом с устойчивым шагом останется прежний хрупкий.
        expect(CI).not.toMatch(/run:\s*npm audit/);
        expect(CI).not.toMatch(/\n\s+npm audit /);
    });
});
