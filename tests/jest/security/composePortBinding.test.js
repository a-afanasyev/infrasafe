/**
 * [M-22] Регрессия на публикацию портов в compose-файлах.
 *
 * Базовый баг: docker-compose.generator.yml публиковал "8081:8081" — то есть на
 * все интерфейсы хоста. Остальные сервисы давно на 127.0.0.1 (SEC-34f,
 * P-PENTEST-1), генератор тестовых данных остался единственным исключением.
 *
 * Тест намеренно ПАРСИТ YAML, а не грепает строки: в docker-compose.unified.yml
 * есть закомментированные блоки `ports:` (mqtt/influx/node-red/wireguard) —
 * наивный текстовый матч дал бы ложные срабатывания.
 *
 * Единственное исключение — TLS-терминирующий edge nginx: он и обязан слушать
 * 80/443 на всех интерфейсах. Исключение привязано к СЕРВИСУ, а не к номерам
 * портов вообще.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '../../..');

const composeFiles = fs.readdirSync(ROOT)
    .filter((f) => /^docker-compose[.\w-]*\.ya?ml$/.test(f))
    .sort();

// Сервисы, которым разрешено публиковать порт на все интерфейсы, и какие именно.
const PUBLIC_EDGE_ALLOWLIST = { nginx: ['80', '443'] };

/**
 * Нормализует запись из `ports:` к { hostIp, hostPort }.
 * Поддерживает короткий синтаксис ("127.0.0.1:8081:8081", "8081:8081", "8081")
 * и длинный ({ target, published, host_ip }).
 */
function parsePortEntry(entry) {
    if (entry && typeof entry === 'object') {
        return {
            hostIp: entry.host_ip || null,
            hostPort: entry.published === undefined ? null : String(entry.published),
        };
    }

    const raw = String(entry);
    // IPv6 в коротком синтаксисе тут не используется; если появится — тест упадёт
    // явно, а не пропустит публикацию молча.
    const parts = raw.split(':');
    if (parts.length >= 3) {
        return { hostIp: parts.slice(0, parts.length - 2).join(':'), hostPort: parts[parts.length - 2] };
    }
    if (parts.length === 2) {
        return { hostIp: null, hostPort: parts[0] };
    }
    return { hostIp: null, hostPort: null };   // "8081" — случайный порт хоста
}

const collectPublications = () => {
    const found = [];
    for (const file of composeFiles) {
        const doc = yaml.load(fs.readFileSync(path.join(ROOT, file), 'utf8')) || {};
        for (const [service, def] of Object.entries(doc.services || {})) {
            for (const entry of (def && def.ports) || []) {
                found.push({ file, service, entry, ...parsePortEntry(entry) });
            }
        }
    }
    return found;
};

describe('[M-22] compose port publications are loopback-only', () => {
    test('compose files are discovered and parsed', () => {
        expect(composeFiles).toContain('docker-compose.generator.yml');
        expect(composeFiles.length).toBeGreaterThanOrEqual(4);
        expect(collectPublications().length).toBeGreaterThan(0);
    });

    test('no service publishes a port on all interfaces (except the TLS edge)', () => {
        const violations = collectPublications().filter(({ service, hostIp, hostPort }) => {
            if (hostIp === '127.0.0.1' || hostIp === 'localhost') return false;
            const allowed = PUBLIC_EDGE_ALLOWLIST[service];
            if (allowed && hostPort !== null && allowed.includes(hostPort)) return false;
            return true;
        });

        expect(violations.map((v) => `${v.file} › ${v.service}: ${JSON.stringify(v.entry)}`)).toEqual([]);
    });

    test('the generator is bound to loopback (the M-22 finding itself)', () => {
        const generator = collectPublications().filter((p) => p.service === 'generator');
        expect(generator.length).toBeGreaterThan(0);
        for (const p of generator) {
            expect(p.hostIp).toBe('127.0.0.1');
        }
    });

    test('commented-out ports blocks are not counted (parser, not grep)', () => {
        const unified = collectPublications().filter((p) => p.file === 'docker-compose.unified.yml');
        // В файле есть закомментированные ports: у mqtt/influxdb/node-red/wireguard.
        expect([...new Set(unified.map((p) => p.service))].sort()).toEqual(['app', 'frontend', 'nginx']);
    });
});
