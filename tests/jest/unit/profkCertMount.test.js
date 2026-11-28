/**
 * [Q-12] Сертификат profk монтируется каталогами certbot, а не файлами.
 *
 * Файловый bind-mount симлинка live/profk.uz/*.pem закрепляет inode файла
 * archive/…N.pem на момент старта контейнера: после продления certbot кладёт
 * N+1 и переставляет ссылку, а `nginx -s reload` продолжает отдавать старый
 * сертификат до пересоздания контейнера. Каталог разрешается при каждом чтении.
 * Проверено настоящим nginx (см. PR fix/profk-cert-mount).
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const root = path.join(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const nginxVolumes = yaml.load(read('docker-compose.profk.yml')).services.nginx.volumes;
const CONFIG = read('nginx-config/nginx.profk.conf');

describe('[Q-12] сертификат profk переживает продление без пересоздания nginx', () => {
    test('оверлей не монтирует отдельные файлы сертификата', () => {
        for (const v of nginxVolumes) {
            const [src, target] = v.split(':');
            expect(src).not.toMatch(/\.pem$/);
            expect(target).not.toMatch(/^\/etc\/nginx\/ssl/);
        }
    });

    test('live/ и archive/ смонтированы каталогами по тем же путям (ссылки относительные)', () => {
        expect(nginxVolumes).toEqual(expect.arrayContaining([
            '/etc/letsencrypt/live:/etc/letsencrypt/live:ro',
            '/etc/letsencrypt/archive:/etc/letsencrypt/archive:ro',
        ]));
    });

    test('конфиг profk не ссылается на /etc/nginx/ssl', () => {
        expect(CONFIG).not.toContain('/etc/nginx/ssl');
    });

    test('оба vhost (profk.uz и assets.profk.uz) берут сертификат из live/profk.uz', () => {
        const certs = CONFIG.match(/^\s*ssl_certificate(_key)?\s+\S+;/gm) || [];
        expect(certs).toHaveLength(4);
        for (const line of certs) {
            expect(line).toMatch(/\/etc\/letsencrypt\/live\/profk\.uz\/(fullchain|privkey)\.pem;/);
        }
    });
});
