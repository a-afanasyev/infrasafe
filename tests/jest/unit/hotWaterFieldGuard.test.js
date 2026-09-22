/**
 * [N-08] Хвост A-08: признак ГВС у здания — только `has_hot_water`.
 *
 * В схеме живы обе колонки, `buildings.hot_water` и `buildings.has_hot_water`,
 * но пишет и отдаёт API только вторую (`Building.create` / `update`, DTO
 * `/buildings-metrics`). A-08 перевёл на неё классификацию карты, а три места
 * остались на старом имени:
 *
 *   - форма «Добавить здание» отправляла `hot_water: checked` — модель это поле
 *     не читает, галка терялась, и отказ ГВС нового дома карта не показывала;
 *   - строка деталей в админке и попап слоя зданий читали `building.hot_water`,
 *     которого в ответе нет, — там всегда стояло «Нет».
 *
 * Такая подмена имени поля годами живёт в 4000-строчном `admin.js`, поэтому
 * рубеж — на исходниках: старое имя не должно встречаться ни как чтение
 * свойства, ни как ключ отправляемого объекта. Строковые значения вида
 * `line_type: 'hot_water'` (тип водной линии) и поля `hot_water_*` правилу
 * не подпадают.
 */
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '../../../public');
const SKIP_DIRS = new Set(['dist', 'libs']);

function listSources(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : listSources(full);
        return entry.name.endsWith('.js') ? [full] : [];
    });
}

// `.hot_water` как чтение свойства, но не `.hot_water_line_id` и т.п.
const PROPERTY_READ = /\.hot_water\b(?!_)/;
// Голый идентификатор: ключ `hot_water:`, деструктуризация `{ hot_water }`,
// shorthand-свойство. Не ловит `'hot_water'` как строковое значение и поля
// `hot_water_*`.
const OBJECT_KEY = /(?<![\w'".])hot_water(?![\w'"])/;
// Чтение через скобки `building['hot_water']`.
//
// Ключ в кавычках (`'hot_water': …`) НЕ проверяется сознательно: в той же
// форме живут законные словари типа водной линии — подписи и цвета в
// `infrastructure-line-editor.js` (`'hot_water': '#FF0000'`), — и регулярка не
// отличит их от поля здания. Это известная слепая зона рубежа.
const BRACKET_READ = /\[\s*['"]hot_water['"]\s*\]/;

function offenders(re) {
    return listSources(PUBLIC_DIR).flatMap((file) => fs.readFileSync(file, 'utf8')
        .split('\n')
        .map((line, i) => ({ file: path.relative(PUBLIC_DIR, file), line: i + 1, text: line }))
        .filter(({ text }) => !text.trim().startsWith('//') && !text.trim().startsWith('*'))
        .filter(({ text }) => re.test(text))
        .map(({ file, line }) => `${file}:${line}`));
}

describe('[N-08] ГВС здания — только has_hot_water', () => {
    test('нет чтения legacy-свойства building.hot_water', () => {
        expect(offenders(PROPERTY_READ)).toEqual([]);
    });

    test('нет legacy-ключа hot_water в отправляемых объектах', () => {
        expect(offenders(OBJECT_KEY)).toEqual([]);
    });

    test('нет чтения legacy-имени через скобки', () => {
        expect(offenders(BRACKET_READ)).toEqual([]);
    });

    // Рубеж не должен быть слепым: регулярки обязаны ловить ровно те формы,
    // что были в коде, и пропускать законные соседние имена.
    test('регулярки ловят прежние формы и не трогают законные', () => {
        expect(PROPERTY_READ.test("building.hot_water ? 'Да' : 'Нет'")).toBe(true);
        expect(OBJECT_KEY.test("            hot_water: document.getElementById('x').checked,")).toBe(true);

        expect(PROPERTY_READ.test('building.hot_water_line_id')).toBe(false);
        expect(PROPERTY_READ.test('building.has_hot_water')).toBe(false);
        expect(OBJECT_KEY.test("line_type: 'hot_water',")).toBe(false);
        expect(OBJECT_KEY.test('has_hot_water: true')).toBe(false);
        expect(OBJECT_KEY.test('hot_water_supplier_id: 1')).toBe(false);

        // Формы, найденные ревью: без них рубеж обещал больше, чем проверял.
        expect(OBJECT_KEY.test('const { hot_water } = building;')).toBe(true);
        expect(BRACKET_READ.test("building['hot_water']")).toBe(true);
        expect(BRACKET_READ.test('building["hot_water"]')).toBe(true);
        expect(BRACKET_READ.test("            case 'hot_water':")).toBe(false);
        expect(BRACKET_READ.test("s.type === 'hot_water'")).toBe(false);
    });
});
