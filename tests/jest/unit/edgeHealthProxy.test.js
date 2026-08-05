/**
 * [L-5] Эджевый /health обязан спрашивать приложение.
 *
 * Раньше здесь стоял `return 200 "healthy\n"` — nginx отвечал «здоров», ни разу
 * не обратившись к Node. Зелёными при мёртвом приложении были ВСЕ внешние
 * проверки сразу:
 *   - blackbox-пробы `edge:profk.uz/health` и `peer:infrasafe.uz/health`
 *     (profk-observability/alloy/config.alloy:152,163);
 *   - мониторы uptime-kuma по обеим площадкам, причём их README прямо обещает
 *     «приложение, а не только nginx» — обещание не выполнялось;
 *   - шаг 8 «edge smoke» в update-production.sh:319, то есть финальная
 *     проверка деплоя не проверяла ничего.
 *
 * Рестарт-петли это не создаёт: healthcheck контейнера эджа — `nginx -t`
 * (docker-compose.unified.yml:366), а не HTTP-запрос к /health.
 */

const fs = require('fs');
const path = require('path');

// dev включён намеренно: расхождение семантики /health между dev и prod —
// ровно тот класс сюрприза, который этот пункт и породил.
const CONFIGS = [
    ['nginx.production.conf', 'infrasafe.uz'],
    ['nginx.profk.conf', 'profk.uz'],
    ['nginx.dev.conf', 'dev'],
];

/** Вырезает тело `location /health { ... }` (без вложенных блоков — их там нет). */
function healthLocation(config) {
    const start = config.indexOf('location /health {');
    if (start === -1) return null;
    const end = config.indexOf('}', start);
    return config.slice(start, end + 1);
}

describe.each(CONFIGS)('[L-5] %s: /health проксируется в приложение', (file, domain) => {
    const config = fs.readFileSync(
        path.join(__dirname, '../../../nginx-config', file),
        'utf8'
    );
    const block = healthLocation(config);

    test(`${domain}: блок location /health существует`, () => {
        expect(block).not.toBeNull();
    });

    test(`${domain}: не отвечает статической заглушкой`, () => {
        expect(block).not.toMatch(/return\s+200/);
    });

    test(`${domain}: проксирует на апстрим приложения`, () => {
        // Прод использует переменную (отложенный DNS через resolver), dev —
        // статический апстрим, как и его собственный /api/. Принимаем оба.
        expect(block).toMatch(/proxy_pass\s+http:\/\/(\$\w+|app:3000)/);
    });

    test(`${domain}: у пробы короткие таймауты — зависшее приложение падает быстро`, () => {
        expect(block).toMatch(/proxy_connect_timeout\s+[1-5]s/);
        expect(block).toMatch(/proxy_read_timeout\s+[1-9]s/);
    });
});
