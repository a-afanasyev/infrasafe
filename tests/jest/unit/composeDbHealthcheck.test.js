/**
 * [init-race] Рубеж на healthcheck postgres: первая проба обязана идти по TCP.
 *
 * Базовый баг (12.09.2026, поймано на свежем подъёме dev-стека). Проверка была
 * `pg_isready -U postgres && psql ... 'SELECT 1;'` — обе по unix-сокету. На ЧИСТОМ
 * томе docker-entrypoint postgres поднимает ВРЕМЕННЫЙ сервер с `listen_addresses=''`
 * (только сокет), чтобы прогнать initdb + database/init/*.sql, и обе команды в это
 * окно отвечают успехом. Контейнер объявлялся healthy посреди инициализации,
 * compose по `depends_on: condition: service_healthy` пропускал app вперёд, тот
 * получал ECONNREFUSED на 5432 — а nodemon после краша ждёт правки файла и сам не
 * встаёт. У временного сервера TCP-слушателя нет вообще, поэтому проба с явным
 * хостом (`-h 127.0.0.1`) краснеет детерминированно, а не с какой-то вероятностью.
 *
 * Ровно эта же гонка уже кусала в другом месте и лечилась там эвристикой «два
 * успеха подряд» (tests/migrate/run-migrate-tests.sh:129) — она была нужна, потому
 * что проба шла через `docker compose exec` по сокету и обойти это было нечем.
 *
 * Почему тест: на существующем томе init-фазы нет и разницы не видно — откат
 * `-h` вылез бы только на fresh-bootstrap (staging, DR, ночной E2E) и выглядел бы
 * загадочно. Проверка стоит десять строк, поломка — полпрогона.
 *
 * Тест ПАРСИТ YAML, а не грепает (см. тот же довод в composePortBinding.test.js:
 * в unified есть закомментированные блоки, и текстовый матч давал бы ложь).
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '../../..');

const composeFiles = fs.readdirSync(ROOT)
    .filter((f) => /^docker-compose[.\w-]*\.ya?ml$/.test(f))
    .sort();

/** Сегменты команды healthcheck'а: то, что шелл выполняет по порядку. */
const splitProbes = (cmd) => cmd.split(/&&|\|\||;/).map((s) => s.trim()).filter(Boolean);

/** Явный хост у пробы — то есть TCP, а не unix-сокет. */
const hasExplicitHost = (probe) => /(^|\s)(-h\s*\S+|--host[=\s]\S+)/.test(probe);

/**
 * Собирает healthcheck'и сервисов БД из всех compose-файлов в корне.
 * Сервисы-оверрайды без собственного healthcheck (profk/staging наследуют
 * unified) сюда не попадают — им нечего проверять.
 */
const collectDbHealthchecks = () => {
    const found = [];
    for (const file of composeFiles) {
        const doc = yaml.load(fs.readFileSync(path.join(ROOT, file), 'utf8')) || {};
        for (const [service, def] of Object.entries(doc.services || {})) {
            const hc = def && def.healthcheck;
            if (!hc || !hc.test) continue;
            const cmd = Array.isArray(hc.test) ? hc.test.join(' ') : String(hc.test);
            if (!/\bpg_isready\b|\bpsql\b/.test(cmd)) continue;
            found.push({ file, service, cmd, startPeriod: hc.start_period });
        }
    }
    return found;
};

describe('[init-race] postgres healthcheck probes over TCP, not the unix socket', () => {
    test('обе боевые связки открыты и разобраны (иначе тест зелен впустую)', () => {
        const files = collectDbHealthchecks().map((h) => h.file);
        expect(files).toContain('docker-compose.dev.yml');
        expect(files).toContain('docker-compose.unified.yml');
    });

    test('первая проба — pg_isready с явным хостом', () => {
        const violations = collectDbHealthchecks().filter(({ cmd }) => {
            const first = splitProbes(cmd)[0] || '';
            return !/\bpg_isready\b/.test(first) || !hasExplicitHost(first);
        });

        // Важен именно ПЕРВЫЙ сегмент: он и есть гейт. Дальнейшие запросы по
        // сокету безопасны — они выполняются только после того, как TCP ответил
        // (так в dev: psql 'SELECT 1;' подтверждает, что БД отвечает на запрос,
        // и при этом не требует пароля, в отличие от psql по TCP).
        expect(violations.map((v) => `${v.file} › ${v.service}: ${v.cmd}`)).toEqual([]);
    });

    test('у каждой такой проверки задан start_period', () => {
        // Вторая половина фикса, без неё первая делает хуже: честный TCP-гейт
        // краснеет во время initdb, и без окна прогрева контейнер успевает стать
        // unhealthy — compose роняет весь `up` с «dependency failed to start».
        const missing = collectDbHealthchecks().filter((h) => !h.startPeriod);
        expect(missing.map((v) => `${v.file} › ${v.service}`)).toEqual([]);
    });
});
