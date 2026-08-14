/**
 * [EN-8] Контракт CI-конфигурации.
 *
 * 1. Каждый сторонний action пинится на SHA коммита, а не на тег. Тег
 *    подвижен: владелец репозитория (или тот, кто угнал его аккаунт) может
 *    перевесить `v3` на другой коммит, и наш пайплайн выполнит чужой код
 *    с нашими секретами. Это не гипотетика — так работали инциденты
 *    tj-actions/changed-files и codecov-bash. Особенно важно для
 *    `gitleaks-action`: он читает весь репозиторий.
 *
 * 2. Рядом с SHA обязателен комментарий с версией — иначе diff обновления
 *    выглядит как замена одной случайной строки на другую, и ревьюер не
 *    видит, мажор это или патч.
 *
 * 3. У каждого workflow есть `concurrency` — без него пуш в занятую ветку
 *    оставляет два прогона на одном коммите: они дерутся за раннеры и
 *    (для деплойных шагов) за порядок.
 */

const fs = require('fs');
const path = require('path');

const WORKFLOW_DIR = path.resolve(__dirname, '../../../.github/workflows');
const FILES = fs.readdirSync(WORKFLOW_DIR).filter((f) => /\.ya?ml$/.test(f));

const read = (f) => fs.readFileSync(path.join(WORKFLOW_DIR, f), 'utf8');

// `uses:` со ссылкой на репозиторий (локальные `./…` и docker:// не в счёт).
const USES_RE = /^\s*(?:-\s*)?uses:\s*([^\s#]+)(.*)$/gm;

const externalUses = (source) => {
    const out = [];
    let m;
    while ((m = USES_RE.exec(source)) !== null) {
        const ref = m[1];
        if (ref.startsWith('./') || ref.startsWith('docker://')) continue;
        out.push({ ref, rest: m[2] });
    }
    return out;
};

describe('[EN-8] workflows пинятся на SHA', () => {
    test('в каталоге вообще есть workflow-файлы (страховка от пустого прогона)', () => {
        expect(FILES.length).toBeGreaterThan(0);
    });

    test.each(FILES)('%s: каждый action — 40-значный SHA', (file) => {
        const bad = externalUses(read(file))
            .filter(({ ref }) => !/@[0-9a-f]{40}$/.test(ref))
            .map(({ ref }) => ref);
        expect(bad).toEqual([]);
    });

    test.each(FILES)('%s: рядом с SHA стоит комментарий с версией', (file) => {
        const bad = externalUses(read(file))
            .filter(({ rest }) => !/#\s*v?\d/.test(rest))
            .map(({ ref }) => ref);
        expect(bad).toEqual([]);
    });

    test.each(FILES)('%s: объявлен concurrency', (file) => {
        expect(read(file)).toMatch(/^concurrency:/m);
    });
});
