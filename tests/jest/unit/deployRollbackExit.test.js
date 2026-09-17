'use strict';

/**
 * [A-09] Код возврата после отката — ПОВЕДЕНЧЕСКАЯ проверка.
 *
 * Найдено репетицией отката на .105 17.09.2026, и найдено только ею: все
 * структурные рубежи в `deployWiring.test.js` были зелёными, а скрипт после
 * отката возвращал НОЛЬ. Человек видит «rollback complete» и всё понимает; любой
 * автоматический вызывающий — `&&`-цепочка, cron, будущий CI-деплой — читает
 * успех и едет дальше.
 *
 * Механика: `on_exit` перед вызовом `rollback` выполняет
 * `if [ "$rc" = 0 ]; then exit 0; fi`. У составного `if` с ЛОЖНЫМ условием и без
 * `else` статус равен НУЛЮ — и этот ноль попадал в `local rc=$?` внутри
 * `rollback`, затирая настоящую причину отказа. По прежнему пути
 * (`trap rollback ERR`) статус был верен, сломала его именно обёртка на EXIT.
 *
 * Поэтому тест здесь не текстовый: он берёт НАСТОЯЩИЙ блок ловушек из
 * `update-production.sh`, подставляет заглушки вместо docker/git/compose и
 * запускает bash. Текстовая проверка «в скрипте есть exit $rc» этот дефект не
 * поймала бы — строка-то на месте, неверна величина.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = fs.readFileSync(
    path.resolve(__dirname, '../../../update-production.sh'),
    'utf8'
);

/** Настоящий блок ловушек: от команд nginx до последнего `trap`. */
function trapBlock() {
    const start = SCRIPT.indexOf('nginx_test=(nginx -t)');
    const endMarker = 'trap on_exit EXIT';
    const end = SCRIPT.indexOf(endMarker);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return SCRIPT.slice(start, end + endMarker.length);
}

// Заглушки ровно того, что откат делает с миром. Ничего не подменяем в логике
// самого отката — только внешние команды, иначе тест полез бы в docker.
const PREAMBLE = `set -Eeuo pipefail
RED=''; GREEN=''; YELLOW=''; BLUE=''; NC=''
say() { echo "say: $*"; }
ok() { echo "ok: $*"; }
warn() { echo "warn: $*"; }
err() { echo "err: $*"; }
git() { echo "git $*"; }
docker() { echo "docker $*"; }
bash() { echo "bash $*"; }
app_health_wait() { return 0; }
COMPOSE_ARGS=(-f docker-compose.unified.yml)
APP_SWITCHED=0
DIST_PUBLISHED=0
PREV_COMMIT=""
OLD_IMG=""
NGINX_RELOADED=0
WORKTREE_CLEAN=1
`;

function runHarness(tail) {
    const file = path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-trap-')),
        'harness.sh'
    );
    fs.writeFileSync(file, `${PREAMBLE}${trapBlock()}\n${tail}\n`);
    const res = spawnSync('bash', [file], { encoding: 'utf8' });
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
    return res;
}

describe('[A-09] откат возвращает НЕнулевой код', () => {
    test('поздний отказ через явный exit 1 → скрипт завершается с 1', () => {
        // Шаг 8 (edge smoke) выходит именно так — это тот самый путь, который
        // прежняя ловушка на ERR не ловила вовсе.
        const res = runHarness('echo "edge health failed"\nexit 1');

        expect(res.stdout).toMatch(/rolling back/);
        expect(res.stdout).toMatch(/rollback complete/);
        expect(res.status).toBe(1);
    });

    test('отказ ПРОСТОЙ команды под set -e → её код сохраняется', () => {
        // Именно простая команда, а не `( exit 7 )`: у составной ловушка на ERR
        // не поднимается вовсе, и такой случай не отличал бы наличие второй
        // ловушки от её отсутствия. С обеими ловушками здесь выходит 1 вместо
        // 7 — ERR зовёт откат БЕЗ аргумента, и настоящая причина теряется.
        const res = runHarness('fail7() { return 7; }\nfail7');

        expect(res.stdout).toMatch(/rolling back/);
        expect(res.status).toBe(7);
    });

    test('успешный путь не откатывает и возвращает 0', () => {
        const res = runHarness('DEPLOY_OK=1\ntrap - EXIT\necho "deploy complete"');

        expect(res.stdout).not.toMatch(/rolling back/);
        expect(res.status).toBe(0);
    });

    test('выход с нулём до точки успеха ничего не откатывает', () => {
        // Ранние проверки (нет .env, плохой DEPLOY_ENV) выходят с ошибкой, но
        // штатный `exit 0` до выкатки откатывать нечего — и не должен.
        const res = runHarness('exit 0');

        expect(res.stdout).not.toMatch(/rolling back/);
        expect(res.status).toBe(0);
    });
});
