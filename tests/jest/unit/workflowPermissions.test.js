/**
 * [N-13] Права токена GITHUB_TOKEN объявлены в самих workflow.
 *
 * Задания `lint`, `test`, `audit`, `e2e`, `migrate-test` делают `npm ci`, а это
 * исполнение стороннего кода (`postinstall` любой зависимости). Какие права
 * получает их токен, решала настройка репозитория: 24.09.2026 это
 * `default_workflow_permissions: read`, и риск закрыт — но настройкой в UI, а
 * не кодом. Переключи её кто-нибудь на «read and write» (или перенеси
 * репозиторий), и все такие задания молча получат запись в код и релизы.
 *
 * Правило: у каждого workflow верхний `permissions` ровно `contents: read`,
 * а запись объявляет конкретное задание, которому она нужна.
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const DIR = path.join(__dirname, '../../../.github/workflows');
const WORKFLOWS = fs.readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));

const load = (file) => yaml.load(fs.readFileSync(path.join(DIR, file), 'utf8'));

// Задания, которым запись нужна по делу. Новое задание с записью должно
// попасть сюда осознанно — рубеж ради этого и заведён.
const WRITE_ALLOWED = {
    'ci.yml': {
        gitleaks: ['pull-requests'],
        'docker-image': ['packages'],
    },
    'codeql.yml': {
        analyze: ['security-events'],
    },
};

describe('[N-13] права токена в workflow', () => {
    test('workflow найдены', () => {
        expect(WORKFLOWS.length).toBeGreaterThanOrEqual(4);
    });

    test.each(WORKFLOWS)('%s: верхний permissions — только contents: read', (file) => {
        expect(load(file).permissions).toEqual({ contents: 'read' });
    });

    test.each(WORKFLOWS)('%s: запись только у заданий из списка', (file) => {
        const jobs = load(file).jobs || {};
        const writes = Object.entries(jobs).flatMap(([name, job]) => {
            const perms = job.permissions;
            if (perms === 'write-all') return [`${name}: write-all`];
            if (!perms || typeof perms !== 'object') return [];
            return Object.entries(perms)
                .filter(([, level]) => level === 'write')
                .filter(([scope]) => !((WRITE_ALLOWED[file] || {})[name] || []).includes(scope))
                .map(([scope]) => `${name}: ${scope}`);
        });
        expect(writes).toEqual([]);
    });
});
