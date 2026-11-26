/**
 * Аудиты безопасности #12 (2026-11-16) и #13 (2026-11-25) — инфраструктура.
 *
 *   A12-17  приложение и PostgreSQL читали один набор env-файлов: в контейнере
 *           БД лежали JWT-секреты, ключ TOTP и HMAC телеметрии, в контейнере
 *           приложения — пароль суперпользователя БД;
 *   A12-16  dev-сид создавал администратора с известным паролем, а боевые
 *           сценарии (staging-compose, инструкция profk) этот сид подключали;
 *   A12-15  литерал старого пароля БД в рабочем дереве;
 *   #13     frontend, redis, postgres без no-new-privileges и cap_drop;
 *   #15     каталог trash/ и устаревший scripts/deploy-uk.sh.
 *
 * Проверка текста и структуры файлов. Запуск стека с нуля (приложение
 * стартует, в окружении контейнера БД нет секретов приложения, пара из сида не
 * работает) — в описании PR.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const yaml = require('js-yaml');

const root = path.join(__dirname, '../../..');
const exists = (rel) => fs.existsSync(path.join(root, rel));
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const compose = (rel) => yaml.load(read(rel));

/** Ключи KEY=… из env-файла (без комментариев). */
const envKeys = (rel) => read(rel).split('\n')
    .map((line) => /^\s*([A-Z0-9_]+)\s*=/.exec(line))
    .filter(Boolean)
    .map((m) => m[1]);

const envFilePaths = (service) => (service.env_file || []).map((entry) => (typeof entry === 'string' ? entry : entry.path));

describe('A12-17 — у контейнера БД и у приложения разные env-файлы', () => {
    const unified = compose('docker-compose.unified.yml');

    test('postgres читает только .env.db', () => {
        expect(envFilePaths(unified.services.postgres)).toEqual(['.env.db']);
    });

    test('приложение не читает .env.db', () => {
        const paths = envFilePaths(unified.services.app);
        expect(paths).toEqual(['.env', '.env.prod']);
        expect(paths).not.toContain('.env.db');
    });

    test('ни один другой сервис не получает env-файл приложения или БД', () => {
        for (const [name, service] of Object.entries(unified.services)) {
            if (name === 'app' || name === 'postgres') continue;
            expect([name, envFilePaths(service)]).toEqual([name, []]);
        }
    });

    test('пароль БД не подставляется интерполяцией compose (B-023)', () => {
        expect(read('docker-compose.unified.yml')).not.toMatch(/^\s*-?\s*POSTGRES_PASSWORD\s*[=:]/m);
    });

    test('шаблон .env.db.example содержит только пароль суперпользователя', () => {
        expect(exists('.env.db.example')).toBe(true);
        expect(envKeys('.env.db.example')).toEqual(['POSTGRES_PASSWORD']);
        expect(read('.env.db.example')).toMatch(/^POSTGRES_PASSWORD=CHANGE_ME/m);
    });

    test('шаблон приложения не содержит ни пароля суперпользователя БД, ни UK_SERVICE_PASSWORD', () => {
        const keys = envKeys('.env.example');
        expect(keys.filter((k) => /^POSTGRES_/.test(k))).toEqual([]);
        expect(keys).not.toContain('UK_SERVICE_PASSWORD');
        expect(keys).not.toContain('UK_SERVICE_USER');
    });

    test.each(['PROJECT_CONTEXT.md', 'docs/SOT.md'])('%s больше не предлагает задавать UK_SERVICE_PASSWORD', (doc) => {
        // Сервисная учётка УК удалена вместе с исходящим REST-клиентом; на profk
        // переменная осталась в окружении именно потому, что документы её требовали.
        expect(read(doc)).not.toMatch(/UK_SERVICE_PASSWORD/);
    });

    test('.env.db не попадает в git и в образ', () => {
        expect(read('.gitignore')).toMatch(/^\.env\.\*$/m);
        expect(read('.gitignore')).toMatch(/^!\.env\.db\.example$/m);
        expect(read('.dockerignore')).toMatch(/^\.env/m);
    });
});

describe('A12-16 — боевой init не создаёт пользователей', () => {
    const initFiles = fs.readdirSync(path.join(root, 'database/init')).filter((f) => f.endsWith('.sql'));

    test.each([...initFiles.map((f) => `database/init/${f}`), 'database.sql'])('%s: нет INSERT в users и нет хэшей паролей', (rel) => {
        const sql = read(rel);
        expect(sql).not.toMatch(/INSERT\s+INTO\s+(public\.)?users\b/i);
        expect(sql).not.toMatch(/\$2[aby]\$\d{2}\$/);
    });

    test('тестовый администратор живёт отдельным файлом вне database/init', () => {
        const seed = read('database/dev-seed/dev_admin.sql');
        expect(seed).toMatch(/INSERT\s+INTO\s+public\.users\b/i);
        expect(seed).toMatch(/ON CONFLICT[^;]*DO NOTHING/i);
    });

    test('dev-compose подключает тестовый сид, и приложение ждёт его', () => {
        const dev = compose('docker-compose.dev.yml');
        const seed = dev.services['dev-seed'];
        expect(seed).toBeDefined();
        expect(JSON.stringify(seed.volumes)).toContain('./database/dev-seed');
        expect(seed.depends_on.postgres.condition).toBe('service_healthy');
        expect(dev.services.app.depends_on['dev-seed'].condition).toBe('service_completed_successfully');
    });

    test.each(['docker-compose.unified.yml', 'docker-compose.profk.yml'])('%s не упоминает dev-seed', (rel) => {
        expect(read(rel)).not.toMatch(/dev-seed|dev_admin/);
    });

    test('устаревший staging-compose и его заглушка удалены', () => {
        expect(exists('docker-compose.staging.yml')).toBe(false);
        expect(exists('database/staging-initdb-noop.sql')).toBe(false);
    });

    test('update-production.sh не знает профиля staging', () => {
        const script = read('update-production.sh');
        expect(script).not.toMatch(/^\s*staging\)/m);
        expect(script).not.toMatch(/docker-compose\.staging\.yml|\.env\.staging/);
        expect(script).toMatch(/want prod\|infrasafe/);
    });

    test('инструкция profk не предлагает сид с известным паролем', () => {
        const doc = read('docs/profk-deploy.md');
        expect(doc).not.toMatch(/admin123/);
        expect(doc).toMatch(/create-admin\.js/);
    });
});

describe('A12-15 — литерал старого пароля БД только в allowlist gitleaks', () => {
    // Сам литерал в тест не переписывается: он берётся из единственного места,
    // где обязан оставаться, — allowlist .gitleaks.toml (история git не
    // переписывается, и сканер должен узнавать значение в старых коммитах).
    const allow = /bootstrap password in docker-compose[\s\S]*?'''([^'\n]+)'''/.exec(read('.gitleaks.toml'));

    test('allowlist на месте', () => {
        expect(allow).not.toBeNull();
        expect(allow[1].length).toBeGreaterThan(6);
    });

    test('в отслеживаемых файлах значения больше нет', () => {
        let out = '';
        try {
            out = execFileSync('git', ['grep', '-lF', '-e', allow[1], '--', '.', ':!.gitleaks.toml'], { cwd: root, encoding: 'utf8' });
        } catch (error) {
            if (error.status !== 1) throw error; // 1 = совпадений нет
        }
        expect(out.split('\n').filter(Boolean)).toEqual([]);
    });
});

describe('#13 — frontend, redis и postgres под no-new-privileges и cap_drop', () => {
    const unified = compose('docker-compose.unified.yml');

    test.each(['frontend', 'redis', 'postgres'])('%s: cap_drop ALL + no-new-privileges', (name) => {
        const service = unified.services[name];
        expect(service.cap_drop).toEqual(['ALL']);
        expect(service.security_opt).toContain('no-new-privileges:true');
    });

    test('возвращены только привилегии, без которых entrypoint не стартует', () => {
        // frontend работает от непривилегированного пользователя на 8080.
        expect(unified.services.frontend.cap_add).toBeUndefined();
        // Entrypoint'ы redis и postgres стартуют от root, чинят владельца тома и
        // сбрасывают привилегии — ровно на это и возвращён набор. Подобран
        // запуском: без DAC_READ_SEARCH оба стартуют на пустом томе и падают на
        // рестарте, поэтому «убрать лишнее» здесь проверяется рестартом, а не
        // первым запуском. DAC_OVERRIDE (шире) не нужен.
        expect([...unified.services.redis.cap_add].sort()).toEqual(['CHOWN', 'DAC_READ_SEARCH', 'SETGID', 'SETUID']);
        expect([...unified.services.postgres.cap_add].sort()).toEqual(['CHOWN', 'DAC_READ_SEARCH', 'FOWNER', 'SETGID', 'SETUID']);
    });
});

describe('суточный бэкап: пароль не попадает в аргументы процесса', () => {
    // Комментарии вырезаются: в них описана как раз прежняя, небезопасная форма.
    const script = read('database/backup-cron.sh').split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');

    test('docker exec получает имя переменной, а не значение', () => {
        // `-e PGPASSWORD="$PGPASSWORD"` разворачивается в argv docker CLI и виден
        // любому пользователю хоста в `ps`; `-e PGPASSWORD` берёт значение из
        // окружения самого docker CLI.
        expect(script).not.toMatch(/-e\s+PGPASSWORD=/);
        expect(script).toMatch(/docker exec -e PGPASSWORD\s/);
        expect(script).toMatch(/^export PGPASSWORD$/m);
    });
});

describe('#15 — мусор удалён', () => {
    test('trash/ не отслеживается', () => {
        const tracked = execFileSync('git', ['ls-files', 'trash'], { cwd: root, encoding: 'utf8' });
        expect(tracked.trim()).toBe('');
    });

    test('scripts/deploy-uk.sh удалён', () => {
        expect(exists('scripts/deploy-uk.sh')).toBe(false);
    });
});
