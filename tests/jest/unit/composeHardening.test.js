'use strict';

/**
 * [S-PERIM-10 / H-11 / S-PERIM-4, аудит 05.11.2026] Hardening контейнеров и
 * bootstrap-файла в compose — и паритет prod ↔ dev, потому что единственная
 * живая проверка «приложение стартует под cap_drop/read_only» — это E2E на
 * docker-compose.dev.yml. Если prod получит ограничение, которого нет в dev,
 * nightly его не увидит.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '../../..');
const load = (f) => yaml.load(fs.readFileSync(path.join(ROOT, f), 'utf8'));

const unified = load('docker-compose.unified.yml');
const dev = load('docker-compose.dev.yml');

const NGINX_CAPS = ['NET_BIND_SERVICE', 'CHOWN', 'SETUID', 'SETGID', 'DAC_OVERRIDE'];

describe.each([
    ['unified', unified, 'nginx'],
    ['dev', dev, 'frontend'],
])('[S-PERIM-10] %s compose', (_label, doc, nginxService) => {
    test('app: cap_drop ALL, no-new-privileges, pids_limit, read_only + tmpfs /tmp', () => {
        const app = doc.services.app;
        expect(app.cap_drop).toEqual(['ALL']);
        expect(app.security_opt).toContain('no-new-privileges:true');
        // compose считает pids_limit и deploy.resources.limits.pids одним полем —
        // принимаем любую форму записи
        const pids = app.pids_limit ?? app.deploy?.resources?.limits?.pids;
        expect(Number(pids)).toBeGreaterThan(0);
        expect(app.read_only).toBe(true);
        expect(app.tmpfs).toContain('/tmp');
    });

    test(`${nginxService}: cap_drop ALL + только нужные capabilities, no-new-privileges`, () => {
        const svc = doc.services[nginxService];
        expect(svc.cap_drop).toEqual(['ALL']);
        expect([...svc.cap_add].sort()).toEqual([...NGINX_CAPS].sort());
        expect(svc.security_opt).toContain('no-new-privileges:true');
    });

    test('[S-PERIM-4] postgres пишет log_connections', () => {
        const cmd = doc.services.postgres.command;
        const text = Array.isArray(cmd) ? cmd.join(' ') : String(cmd);
        expect(text).toMatch(/log_connections=on/);
    });
});

test('[H-11] unified: bootstrap-схема смонтирована в postgres только для чтения', () => {
    const vols = unified.services.postgres.volumes;
    const init = vols.find((v) => String(v).includes('docker-entrypoint-initdb.d'));
    expect(init).toBeDefined();
    expect(init).toMatch(/:ro$/);
});

test('образ app в unified по-прежнему non-root (user из Dockerfile.unified)', () => {
    const df = fs.readFileSync(path.join(ROOT, 'Dockerfile.unified'), 'utf8');
    expect(df).toMatch(/^USER\s+nodejs/m);
});
