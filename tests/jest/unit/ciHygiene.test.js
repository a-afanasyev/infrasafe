'use strict';

/**
 * [N-50] Всё, что может повиснуть в CI и при выкатке, ограничено по времени.
 *
 * У заданий ci.yml не было `timeout-minutes`: зависший шаг держал раннер до
 * лимита GitHub (6 часов) и блокировал очередь обязательных проверок `main`.
 * `curl` шага 8 в update-production.sh шёл без `--max-time`: повисший периметр
 * держал выкатку, не давая ей ни упасть, ни откатиться.
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '../../..');
const WF_DIR = path.join(ROOT, '.github/workflows');
const WORKFLOWS = fs.readdirSync(WF_DIR).filter((f) => /\.ya?ml$/.test(f));

describe('[N-50] ограничения по времени', () => {
    test.each(WORKFLOWS)('%s: у каждого задания есть timeout-minutes', (file) => {
        const jobs = yaml.load(fs.readFileSync(path.join(WF_DIR, file), 'utf8')).jobs || {};
        const missing = Object.entries(jobs)
            .filter(([, job]) => !Number.isFinite(job['timeout-minutes']))
            .map(([name]) => name);
        expect(missing).toEqual([]);
    });

    test('каждый curl в update-production.sh ограничен --max-time', () => {
        const script = fs.readFileSync(path.join(ROOT, 'update-production.sh'), 'utf8');
        const unbounded = script.split('\n')
            .map((line, i) => ({ line, n: i + 1 }))
            .filter(({ line }) => /^\s*[^#]*\bcurl\s/.test(line) && !/--max-time\b|-m\s+\d/.test(line))
            .map(({ n, line }) => `${n}: ${line.trim()}`);
        expect(unbounded).toEqual([]);
    });

    test('скрипт выкатки не ссылается на несуществующие скрипты', () => {
        const script = fs.readFileSync(path.join(ROOT, 'update-production.sh'), 'utf8');
        const refs = [...script.matchAll(/\bscripts\/[\w.-]+\.sh\b/g)].map((m) => m[0]);
        expect(refs.filter((r) => !fs.existsSync(path.join(ROOT, r)))).toEqual([]);
    });
});
