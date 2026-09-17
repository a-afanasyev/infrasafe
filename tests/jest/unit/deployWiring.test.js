// PR-1a (AUD-002): structural guard for the migration-runner deploy wiring in
// update-production.sh. The runner's runtime behavior is e2e-tested in
// tests/migrate/run-migrate-tests.sh; this test pins the WIRING contract:
//   * миграции идут БЕЗУСЛОВНО и BEFORE the app switch (Step 4);
//   * fast-forward строго `git merge --ff-only "$TARGET"` (R2-15: shared
//     `git fetch` + target resolution живут выше, image pull — один раз);
//   * the divergence guard and runner-change guard precede `up`.
//
// [Новое №5, решение 2026-08-11, снято 13.08] Ветки MIGRATE_WIRING_ENABLED
// больше НЕТ. До prod-baseline флаг был фазой раскатки (PR-1a выкатил выключенным,
// PR-1b включил); после baseline он превратился в foot-gun: экспорт переменной
// молча пропускал схему перед подменой образа — код новый, база старая, и
// узнаёшь об этом по 500-кам. Легитимного применения не осталось — откат кода
// без схемы идёт своим путём (rollback-trap восстанавливает ОБРАЗ, миграции
// roll-forward-only). Прежний тест здесь закреплял наличие ветки — теперь
// закрепляем её отсутствие.
//
// R2-15 additions (image source): APP_IMAGE_SOURCE is validated up front; the
// registry image is pulled as a PREFLIGHT before `migrate up`; the app switch
// runs with `--no-build`.

const fs = require('fs');
const path = require('path');

const SCRIPT = fs.readFileSync(
    path.resolve(__dirname, '../../../update-production.sh'),
    'utf8'
);

const YAML = require('js-yaml');

const CI_WORKFLOW = YAML.load(fs.readFileSync(
    path.resolve(__dirname, '../../../.github/workflows/ci.yml'),
    'utf8'
));

// Код скрипта без строк-комментариев: проверка «строка присутствует» иначе
// проходит и на ЗАКОММЕНТИРОВАННОЙ строке. Поймано мутацией: `# trap on_exit
// EXIT` удовлетворял наивной регулярке, то есть рубеж не заметил бы снятия
// ловушки — ровно та слабость текстовых проверок, о которой говорит A-16.
const SCRIPT_CODE = SCRIPT
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

// [A-09/A-13/A-14] Рубежи на гарантии выкатки. Аудит 08.09.2026 показал, что
// все три обещания были декларациями: откат не выполнялся на двух поздних
// отказах, `nginx -t` проверял не тот файл, а образ публиковался мимо проверок.
//
// Проверки здесь СТРУКТУРНЫЕ — они ловят откат правки, но не доказывают
// поведение. Поведение `nginx -t -c` проверено на живом контейнере (битый
// конфиг → exit 1, прежняя проверка на том же контейнере → exit 0), а
// репетиция отката на площадке остаётся отдельным шагом: staging'а нет.
describe('[A-09] откат срабатывает на ЛЮБОМ выходе, а не только на ERR', () => {
    test('ловушка стоит на EXIT и она ОДНА', () => {
        // `trap ... ERR` не срабатывает ни на явный `exit 1`, ни на команду в
        // `||`-списке — а оба поздних отказа выходят именно так.
        expect(SCRIPT_CODE).toMatch(/trap\s+on_exit\s+EXIT/);
        // Вторая ловушка на ERR была не подстраховкой, а дефектом: на отказе
        // под `set -e` откат исполнялся ДВАЖДЫ, и второй проход терял код
        // возврата (найдено репетицией 17.09.2026, см. deployRollbackExit).
        // `set -e` и так доводит неперехваченный отказ до выхода, поэтому EXIT
        // покрывает всё, что покрывал ERR.
        expect(SCRIPT_CODE).not.toMatch(/trap\s+rollback\s+ERR/);
    });

    test('код возврата передаётся откату параметром, а не через $?', () => {
        // Поведение проверяется отдельно (deployRollbackExit.test.js); здесь —
        // рубеж на способ передачи, потому что именно `local rc=$?` молча
        // подменял причину отказа нулём.
        expect(SCRIPT_CODE).toMatch(/rollback\s+"\$rc"/);
        expect(SCRIPT_CODE).toMatch(/local rc="\$\{1:-1\}"/);
    });

    test('точка успеха снимает обе ловушки и помечает выкатку состоявшейся', () => {
        const okIdx = SCRIPT_CODE.indexOf('DEPLOY_OK=1');
        expect(okIdx).toBeGreaterThan(-1);
        expect(SCRIPT_CODE.slice(okIdx)).toMatch(/trap\s+-\s+EXIT/);
        // Уборка образов идёт ПОСЛЕ снятия ловушек: падение ретеншена не
        // должно откатывать успешный релиз.
        expect(SCRIPT_CODE.indexOf('image retention')).toBeGreaterThan(okIdx);
    });

    test('поздние отказы (nginx -t, edge smoke) остаются в зоне действия ловушки', () => {
        const switchIdx = SCRIPT_CODE.indexOf('Step 4: switch app to new image');
        const okIdx = SCRIPT_CODE.indexOf('DEPLOY_OK=1');
        for (const marker of ['NOT reloading (edge keeps old config)', 'edge health failed']) {
            const idx = SCRIPT_CODE.indexOf(marker);
            expect(idx).toBeGreaterThan(switchIdx);
            expect(idx).toBeLessThan(okIdx);
        }
    });
});

describe('[A-13] nginx -t проверяет тот конфиг, с которым запущен мастер', () => {
    test('путь берётся из запущенного процесса, а не угадывается', () => {
        expect(SCRIPT_CODE).toMatch(/proc\/1\/cmdline/);
        expect(SCRIPT_CODE).toMatch(/nginx_test=\(nginx -t -c "\$conf"\)/);
    });

    test('reload идёт с тем же конфигом, что и проверка', () => {
        // Одна и та же переменная в обеих командах — не косметика: разойдясь,
        // они дали бы «проверил один файл, перезагрузил другой».
        expect(SCRIPT_CODE).toMatch(/nginx_reload=\(nginx -c "\$conf" -s reload\)/);
    });

    test('мастер без -c не ломает выкатку — проверяется стоковый конфиг', () => {
        // Отказ здесь был бы хуже дефекта: запуск без -c это корректная
        // конфигурация, просто не наша.
        expect(SCRIPT_CODE).toMatch(/nginx_test=\(nginx -t\)/);
    });
});

// [A-10] Откат возвращал СТАТИКУ, но не HEAD.
//
// `git restore --worktree` меняет файлы, оставляя указатель на новом коммите.
// Отсюда два следствия, и второе хуже первого: рабочее дерево остаётся
// «грязным» (это уже было записано в памяти как особенность), а ПОВТОРНАЯ
// выкатка того же SHA видит `Already up to date` и не восстанавливает ничего —
// новый образ поверх старых HTML/CSS, причём byte-verify это пропускает, потому
// что сверяет только JS-бандлы. Плюс `nginx-config/` в список четырёх каталогов
// не входил вовсе: конфиг периметра, перезагруженный на шаге 6b, оставался
// новым при откаченном приложении.
describe('[A-10] откат возвращает площадку целиком, а не четыре каталога', () => {
    const ROLLBACK = SCRIPT_CODE.slice(
        SCRIPT_CODE.indexOf('rollback() {'),
        SCRIPT_CODE.indexOf('on_exit() {')
    );

    test('вырезанный кусок — действительно тело rollback', () => {
        // Сторож сторожа: если функцию переименуют, срез станет пустым и все
        // проверки ниже начнут проходить на пустой строке.
        expect(ROLLBACK.length).toBeGreaterThan(200);
        expect(ROLLBACK).toMatch(/rolling back/);
    });

    test('HEAD возвращается вместе с файлами', () => {
        expect(ROLLBACK).toMatch(/git reset --hard "\$PREV_COMMIT"/);
    });

    test('узкий restore остался только запасным путём — при грязном дереве', () => {
        // Он допустим лишь там, где `reset --hard` затёр бы правки оператора;
        // в этом случае скрипт ОБЯЗАН сказать, что HEAD остался впереди.
        const narrow = /git restore --source="\$PREV_COMMIT"/;
        if (narrow.test(ROLLBACK)) {
            expect(ROLLBACK).toMatch(/WORKTREE_CLEAN/);
            expect(ROLLBACK).toMatch(/HEAD/);
        }
        expect(SCRIPT_CODE).toMatch(/WORKTREE_CLEAN=/);
    });

    test('конфиг периметра возвращается, если шаг 6b его перезагружал', () => {
        expect(SCRIPT_CODE).toMatch(/NGINX_RELOADED=1/);
        expect(ROLLBACK).toMatch(/NGINX_RELOADED/);
    });

    test('nginx-команды разрешаются ОДНОЙ функцией — и на шаге 6b, и в откате', () => {
        // Иначе разрешение пути расходится между прямым и обратным путём, а
        // расхождение здесь означает reload не того конфига (см. A-13).
        expect(SCRIPT_CODE).toMatch(/resolve_nginx_cmds\(\)\s*\{/);
        const calls = SCRIPT_CODE.match(/^\s*resolve_nginx_cmds$/gm) || [];
        expect(calls.length).toBeGreaterThanOrEqual(2);
    });

    test('чистота дерева снимается ДО слияния, иначе она уже не о том', () => {
        const cleanIdx = SCRIPT_CODE.indexOf('WORKTREE_CLEAN=');
        const mergeIdx = SCRIPT_CODE.indexOf('git merge --ff-only');
        expect(cleanIdx).toBeGreaterThan(-1);
        expect(cleanIdx).toBeLessThan(mergeIdx);
    });
});

describe('[A-14] образ публикуется только после обязательных проверок', () => {
    test('job docker-image зависит от lint/test/audit/gitleaks', () => {
        const needs = CI_WORKFLOW.jobs['docker-image'].needs;
        expect(needs).toEqual(expect.arrayContaining(['lint', 'test', 'audit', 'gitleaks']));
    });

    test('имя job\'а не менялось — на него ссылается защита ветки', () => {
        // Required-check матчится по строке; переименование заблокировало бы
        // мерж всех открытых PR.
        expect(CI_WORKFLOW.jobs['docker-image'].name).toBe('Docker image (SEC-14/15 immutable app)');
    });

    test('публикация по-прежнему ограничена push в main', () => {
        const steps = CI_WORKFLOW.jobs['docker-image'].steps;
        const push = steps.find((st) => /Tag \+ push/i.test(st.name || ''));
        expect(push.if).toMatch(/refs\/heads\/main/);
    });
});

describe('update-production.sh migration wiring', () => {
    test('ветки MIGRATE_WIRING_ENABLED не существует — ни переменной, ни if', () => {
        expect(SCRIPT).not.toMatch(/MIGRATE_WIRING_ENABLED/);
    });

    test('migrate status и up выполняются безусловно, up — до ff-merge', () => {
        const statusIdx = SCRIPT.indexOf('bash scripts/migrate.sh status');
        const upIdx = SCRIPT.indexOf('bash scripts/migrate.sh up');
        const mergeIdx = SCRIPT.indexOf('git merge --ff-only "$TARGET"');
        expect(statusIdx).toBeGreaterThan(-1);
        expect(upIdx).toBeGreaterThan(statusIdx);
        // схема ДО кода: сначала up, затем ff-merge рабочей копии
        expect(mergeIdx).toBeGreaterThan(upIdx);
        // и никакого ИСПОЛНЯЕМОГО git pull в обход закреплённого target
        // (в комментариях скрипт легитимно упоминает git pull — про бинд-маунты)
        const executable = SCRIPT.split('\n').filter((l) => !/^\s*#/.test(l));
        expect(executable.filter((l) => /\bgit pull\b/.test(l))).toEqual([]);
    });

    test('schema is applied before the app switch (Step 4)', () => {
        const upIdx = SCRIPT.indexOf('scripts/migrate.sh up');
        const switchIdx = SCRIPT.indexOf('Step 4: switch app');
        expect(upIdx).toBeGreaterThan(-1);
        expect(switchIdx).toBeGreaterThan(upIdx);
    });

    test('divergence guard and runner-change guard precede up', () => {
        const ancestorIdx = SCRIPT.indexOf('merge-base --is-ancestor HEAD');
        const guardIdx = SCRIPT.indexOf('runner change +');
        const upIdx = SCRIPT.indexOf('scripts/migrate.sh up');
        expect(ancestorIdx).toBeGreaterThan(-1);
        expect(guardIdx).toBeGreaterThan(-1);
        expect(ancestorIdx).toBeLessThan(upIdx);
        expect(guardIdx).toBeLessThan(upIdx);
    });
});

// R2-15: image comes from GHCR (deploy-by-pull) instead of a host build.
describe('update-production.sh image-source wiring (R2-15)', () => {
    test('APP_IMAGE_SOURCE defaults to registry and is validated up front', () => {
        expect(SCRIPT).toMatch(/APP_IMAGE_SOURCE="\$\{APP_IMAGE_SOURCE:-registry\}"/);
        // a case-guard rejects any value other than registry|build (no bare else
        // falling through to a host build)
        expect(SCRIPT).toMatch(/case "\$APP_IMAGE_SOURCE" in\s*\n\s*registry\|build\)/);
    });

    test('registry image is pulled as a PREFLIGHT before migrate up (schema-safe)', () => {
        const pullIdx = SCRIPT.indexOf('docker pull "$PULL_REF"');
        const upIdx = SCRIPT.indexOf('scripts/migrate.sh up');
        const switchIdx = SCRIPT.indexOf('Step 4: switch app');
        expect(pullIdx).toBeGreaterThan(-1);
        // pull must precede both the schema change and the app switch, so a
        // missing image aborts with the DB + container untouched
        expect(pullIdx).toBeLessThan(upIdx);
        expect(pullIdx).toBeLessThan(switchIdx);
    });

    test('build escape hatch host-builds only AFTER the merge (not pre-migrate-safe)', () => {
        const buildIdx = SCRIPT.indexOf('docker compose "${COMPOSE_ARGS[@]}" build app');
        const mergeIdx = SCRIPT.indexOf('git merge --ff-only "$TARGET"');
        expect(buildIdx).toBeGreaterThan(-1);
        expect(mergeIdx).toBeGreaterThan(-1);
        expect(buildIdx).toBeGreaterThan(mergeIdx);
    });

    test('DEPLOY_TARGET_COMMIT is normalized to a full SHA and Guard B keeps it on-branch', () => {
        expect(SCRIPT).toMatch(/git rev-parse --verify "\$TARGET\^\{commit\}"/);
        expect(SCRIPT).toMatch(/merge-base --is-ancestor "\$TARGET" "origin\/\$BRANCH"/);
    });

    test('app switch runs with --no-build (never a host build on recreate)', () => {
        expect(SCRIPT).toMatch(/up -d --no-deps --force-recreate --no-build app/);
    });

    test('image retention prunes on the success path, never prune --all', () => {
        expect(SCRIPT).toMatch(/docker image prune -f/);
        expect(SCRIPT).not.toMatch(/image prune[^\n]*--all/);
    });
});

// R2-15 Phase A: DEPLOY_ENV parameterization (prod=profk | staging | infrasafe).
// `prod` selects the profk compose override + profk.uz URLs. `staging` selects
// the future staging override + staging.infrasafe.uz. `infrasafe` is the SECOND
// live prod host (.105, the original infrasafe.uz) — plain docker-compose.unified.yml,
// no overlay, exactly the pre-R2-15-Phase-A behavior for that host.
describe('update-production.sh DEPLOY_ENV parameterization (R2-15 Phase A)', () => {
    // [OPS-003] Здесь проверялось обратное: «вызов без переменной == prod».
    // Это умолчание и было дефектом. На .105 оно давало не ошибку, а худшее:
    // деплой доходил до конца, byte-verify сверял выдачу с чужим доменом,
    // не совпадал — и откатывался, оставляя расползшееся состояние (git
    // смержен, образ откачен). Ошибиться так можно было только молча.
    test('умолчания по площадке НЕТ — ни явного, ни через :-', () => {
        expect(SCRIPT).not.toMatch(/DEPLOY_ENV="\$\{DEPLOY_ENV:-\w+\}"/);
    });

    test('профиль берётся из .deploy-env, когда переменная не задана', () => {
        // Файл описывает КОНКРЕТНУЮ машину, поэтому он на хосте и вне git.
        expect(SCRIPT).toMatch(/-f \.deploy-env/);
        expect(SCRIPT).toMatch(/DEPLOY_ENV="\$\(tr -d '\[:space:\]' < \.deploy-env\)"/);
    });

    test('без профиля деплой отказывается стартовать', () => {
        // Отказ обязан быть ДО первого изменения: половинчатый деплой дороже
        // несостоявшегося.
        const guardIdx = SCRIPT.indexOf('Площадка не задана');
        expect(guardIdx).toBeGreaterThan(-1);
        expect(SCRIPT.slice(guardIdx, guardIdx + 400)).toMatch(/exit 1/);
        // И раньше, чем скрипт вообще доберётся до git/docker.
        expect(guardIdx).toBeLessThan(SCRIPT.indexOf('git fetch'));
    });

    test('prod selects the profk compose set + profk.uz edge/verify URLs', () => {
        const prodIdx = SCRIPT.indexOf('    prod)');
        const stagingIdx = SCRIPT.indexOf('    staging)');
        expect(prodIdx).toBeGreaterThan(-1);
        expect(stagingIdx).toBeGreaterThan(prodIdx);
        const prodBranch = SCRIPT.slice(prodIdx, stagingIdx);
        expect(prodBranch).toMatch(/COMPOSE_FILES=\(docker-compose\.unified\.yml docker-compose\.profk\.yml\)/);
        expect(prodBranch).toMatch(/ENV_FILE="\.env\.prod"/);
        expect(prodBranch).toMatch(/https:\/\/profk\.uz\/health/);
        expect(prodBranch).toMatch(/VERIFY_URL_BASE:-https:\/\/profk\.uz/);
    });

    test('staging selects the staging compose set + staging.infrasafe.uz URLs', () => {
        const stagingIdx = SCRIPT.indexOf('    staging)');
        const infrasafeIdx = SCRIPT.indexOf('    infrasafe)');
        expect(infrasafeIdx).toBeGreaterThan(stagingIdx);
        const stagingBranch = SCRIPT.slice(stagingIdx, infrasafeIdx);
        expect(stagingBranch).toMatch(/COMPOSE_FILES=\(docker-compose\.unified\.yml docker-compose\.staging\.yml\)/);
        expect(stagingBranch).toMatch(/ENV_FILE="\.env\.staging"/);
        expect(stagingBranch).toMatch(/staging\.infrasafe\.uz/);
    });

    test('infrasafe selects the plain unified compose set (no overlay) + infrasafe.uz URLs', () => {
        const infrasafeIdx = SCRIPT.indexOf('    infrasafe)');
        const escIdx = SCRIPT.indexOf('bad DEPLOY_ENV', infrasafeIdx);
        expect(infrasafeIdx).toBeGreaterThan(-1);
        const infrasafeBranch = SCRIPT.slice(infrasafeIdx, escIdx);
        expect(infrasafeBranch).toMatch(/COMPOSE_FILES=\(docker-compose\.unified\.yml\)/);
        expect(infrasafeBranch).toMatch(/ENV_FILE="\.env\.prod"/);
        expect(infrasafeBranch).toMatch(/https:\/\/infrasafe\.uz\/health/);
        expect(infrasafeBranch).toMatch(/VERIFY_URL_BASE:-https:\/\/infrasafe\.uz/);
    });

    test('an unknown DEPLOY_ENV fails closed (no default host/compose fallthrough)', () => {
        expect(SCRIPT).toMatch(/\*\)\s*echo "❌ bad DEPLOY_ENV=\$DEPLOY_ENV \(want prod\|staging\|infrasafe\)"[^\n]*exit 1/);
    });

    test('every docker compose call uses the ${COMPOSE_ARGS[@]} set — incl. rollback + switch', () => {
        // COMPOSE_ARGS is derived from COMPOSE_FILES with a -f per file
        expect(SCRIPT).toMatch(/COMPOSE_ARGS=\(\); for _cf in "\$\{COMPOSE_FILES\[@\]\}"; do COMPOSE_ARGS\+=\(-f "\$_cf"\); done/);
        // no `docker compose -f "$COMPOSE_FILE" …` (scalar) survivors anywhere
        expect(SCRIPT).not.toMatch(/docker compose -f "\$COMPOSE_FILE"/);
        // rollback trap recreates app with the array (network model must match deploy)
        const rollbackIdx = SCRIPT.indexOf('rollback() {');
        const trapEnd = SCRIPT.indexOf('trap rollback ERR');
        const rollbackFn = SCRIPT.slice(rollbackIdx, trapEnd);
        expect(rollbackFn).toMatch(/docker compose "\$\{COMPOSE_ARGS\[@\]\}" up -d --no-deps --force-recreate --no-build app/);
    });

    test('migrate runner gets the SAME compose set as the deploy (filenames joined)', () => {
        expect(SCRIPT).toMatch(/export MIGRATE_COMPOSE_FILE="\$\{COMPOSE_FILES\[\*\]\}"/);
    });

    test('BRANCH honors DEPLOY_BRANCH for cron/detached-HEAD auto-deploy', () => {
        expect(SCRIPT).toMatch(/BRANCH="\$\{DEPLOY_BRANCH:-\$\(git branch --show-current\)\}"/);
    });

    test('SEC-15 env check is per-env, and staging fails closed on a stray .env.prod', () => {
        expect(SCRIPT).toMatch(/test -f "\$ENV_FILE"/);
        expect(SCRIPT).toMatch(/readlink -f "\$ENV_FILE"/);
        expect(SCRIPT).toMatch(/DEPLOY_ENV" = "staging" \] && \[ -e \.env\.prod \]/);
    });

    test('VERIFY_URL_BASE is exported so rebuild-frontend.sh verifies the right domain', () => {
        expect(SCRIPT).toMatch(/export VERIFY_URL_BASE/);
    });

    test('edge nginx is reloaded only when nginx-config changed this release', () => {
        const stepIdx = SCRIPT.indexOf('Step 6b');
        expect(stepIdx).toBeGreaterThan(-1);
        const step = SCRIPT.slice(stepIdx, stepIdx + 600);
        expect(step).toMatch(/git diff --name-only "\$PREV_COMMIT" HEAD -- nginx-config\//);
        expect(step).toMatch(/nginx -t/);
        expect(step).toMatch(/nginx -s reload/);
    });
});

// [PR-6 / security audit 2026-07-11] Production-required env preflight — runs
// the TARGET image's own validateEnv() against $ENV_FILE before schema/switch.
describe('update-production.sh env preflight (PR-6)', () => {
    function registryBranch() {
        const startIdx = SCRIPT.indexOf('if [ "$APP_IMAGE_SOURCE" = "registry" ]');
        expect(startIdx).toBeGreaterThan(-1);
        const fiIdx = SCRIPT.indexOf('\nfi', startIdx);
        return SCRIPT.slice(startIdx, fiIdx);
    }

    test('preflight runs inside the registry-pull branch, after the image pull', () => {
        const branch = registryBranch();
        const pullIdx = branch.indexOf('docker pull "$PULL_REF"');
        const preflightIdx = branch.indexOf('env preflight');
        expect(pullIdx).toBeGreaterThan(-1);
        expect(preflightIdx).toBeGreaterThan(pullIdx);
    });

    test('preflight does NOT source the env file and does NOT use a naive grep parser', () => {
        // The [Hardening]-documented failure mode this guards against: neither
        // `source "$ENV_FILE"` (shell-special chars in secret values) nor a bare
        // `grep -E '^NAME=.+'` (which wrongly treats NAME='' / NAME="" as set).
        expect(SCRIPT).not.toMatch(/source\s+"\$ENV_FILE"/);
        expect(SCRIPT).not.toMatch(/grep\s+-E\s+'\^NAME=/);
    });

    test('preflight uses --env-file (the same env-loading mechanism Compose uses) and calls the real validateEnv()', () => {
        const branch = registryBranch();
        expect(branch).toMatch(/docker run --rm --env-file "\$ENV_FILE"/);
        expect(branch).toMatch(/require\('\.\/src\/config\/env'\)\.validateEnv\(\)/);
        // Runs against the just-pulled target image, not some other/stale image.
        expect(branch).toMatch(/--entrypoint node "\$PULL_REF"/);
    });

    test('preflight is fail-closed: a non-zero exit from the check aborts the deploy', () => {
        const branch = registryBranch();
        const dockerRunIdx = branch.indexOf('docker run --rm --env-file "$ENV_FILE"');
        expect(dockerRunIdx).toBeGreaterThan(-1);
        const nearby = branch.slice(dockerRunIdx, dockerRunIdx + 400);
        expect(nearby).toMatch(/exit 1/);
    });
});
