/**
 * [AR-3(в)] Сторож соглашения: новая ПЛОСКАЯ сущность идёт через
 * `createCrudModel`, а не переписывает те же пять запросов руками.
 *
 * Соглашение уже записано — в шапке самой фабрики ([R2-09]): «use this factory
 * for a new flat-column lookup table; hand-roll anything with filters, jsonb,
 * geometry, or joins». Не хватало не текста, а рубежа: пункт бэклога держался
 * на том, прочитает ли автор следующей модели docblock файла, который он как
 * раз НЕ открывает, когда пишет модель с нуля.
 *
 * Почему сторож узкий. Запретить рукописный SQL во всех моделях нельзя — это
 * прямо противоречило бы области применения фабрики: она покрывает ТОЛЬКО
 * плоский случай, а Transformer с геометрией и аналитикой или AlertVerification
 * с advisory-локами на неё натягивать нельзя, это превратило бы фабрику в
 * ORM-lite против архитектуры проекта («модели выполняют SQL напрямую»).
 * Поэтому тест падает в одном-единственном случае: модель написала все пять
 * методов CRUD руками, и в её SQL НЕТ ни одного признака сложности, ради
 * которого рукописный вариант и разрешён. То есть ровно то, что фабрика и
 * должна была заменить.
 *
 * Список исключений ПУСТ, и это содержательный факт, а не заготовка: на
 * 13.09.2026 ни одна из девятнадцати рукописных моделей не оказалась
 * плоско-CRUD'ной — каждая либо сложная (JOIN / CTE / jsonb / геометрия /
 * ON CONFLICT / оконные функции), либо не CRUD-формы вовсе. Правило не
 * «вводится на будущее», оно описывает сегодняшнее состояние.
 */

const fs = require('fs');
const path = require('path');

const MODELS_DIR = path.join(__dirname, '../../../src/models');

/**
 * Исключения — модель плоская, но фабрику применить нельзя.
 * Пустой набор. Добавление сюда — осознанное решение с причиной в комментарии
 * (составной ключ, таблица вне whitelist `dynamicUpdateBuilder` и т.п.),
 * а не способ погасить упавший тест.
 */
const ALLOWED = new Set([]);

const CRUD_METHODS = ['findAll', 'findById', 'create', 'update', 'delete'];

// Признаки, ради которых рукописный SQL разрешён шапкой фабрики.
const COMPLEXITY_MARKERS = [
    ['JOIN', /\bJOIN\b/i],
    ['CTE', /\bWITH\s+\w+\s+AS\b/i],
    ['GROUP BY', /\bGROUP BY\b/i],
    ['jsonb', /jsonb|::json/i],
    ['геометрия', /\bST_\w+|\bgeometry\b|\bgeom\b/i],
    ['ILIKE / фильтры', /\bILIKE\b/i],
    ['advisory lock', /advisory_lock/i],
    ['ON CONFLICT', /\bON CONFLICT\b/i],
    ['FILTER (…)', /\bFILTER\s*\(/i],
    ['UNION', /\bUNION\b/i],
    ['оконная функция', /\bOVER\s*\(/i],
];

const SQL_RE = /\b(SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i;

/** Убрать комментарии: упоминание фабрики в пояснении — не её использование. */
function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Разбирает исходник модели.
 * @returns {{usesFactory: boolean, hasSql: boolean, crudMethods: string[],
 *            complexity: string[], isHandRolledFlatCrud: boolean}}
 */
function classifyModel(source) {
    const code = stripComments(source);
    const usesFactory = /\bcreateCrudModel\b/.test(code);
    const hasSql = SQL_RE.test(code);
    const crudMethods = CRUD_METHODS.filter(
        (m) => new RegExp(`static\\s+async\\s+${m}\\s*\\(`).test(code)
    );
    const complexity = COMPLEXITY_MARKERS.filter(([, re]) => re.test(code)).map(([name]) => name);

    return {
        usesFactory,
        hasSql,
        crudMethods,
        complexity,
        isHandRolledFlatCrud:
            !usesFactory && hasSql && crudMethods.length === CRUD_METHODS.length && complexity.length === 0,
    };
}

const models = fs.readdirSync(MODELS_DIR)
    .filter((f) => f.endsWith('.js'))
    .map((file) => ({ file, ...classifyModel(fs.readFileSync(path.join(MODELS_DIR, file), 'utf8')) }));

describe('[AR-3(в)] новая плоская сущность идёт через createCrudModel', () => {
    test('модели найдены и разобраны (иначе правило зелено впустую)', () => {
        expect(models.length).toBeGreaterThanOrEqual(15);
        // Фабрику реально кто-то использует — если её потребители исчезнут,
        // соглашение станет мёртвым, и об этом лучше узнать здесь.
        //
        // Проверка на ВХОЖДЕНИЕ, а не на точное равенство: новая модель через
        // фабрику — это ровно то поведение, которого добивается пункт, и
        // зафиксированный списком состав ронял бы тест именно на нём. Сторож не
        // должен наказывать за правильный поступок.
        const factoryUsers = models.filter((m) => m.usesFactory).map((m) => m.file);
        expect(factoryUsers).toEqual(expect.arrayContaining(['ColdWaterSource.js', 'HeatSource.js']));
        // И рукописные модели тоже видны разборщику.
        expect(models.filter((m) => m.hasSql).length).toBeGreaterThan(10);
    });

    test('ни одна модель не переписывает плоский CRUD руками', () => {
        const violations = models
            .filter((m) => m.isHandRolledFlatCrud && !ALLOWED.has(m.file))
            .map((m) => `${m.file}: все пять методов CRUD написаны руками, признаков сложности нет`);

        expect(violations).toEqual([]);
    });

    test('сложные модели правило НЕ трогает — это его область, а не недосмотр', () => {
        // Явная фиксация границы: Transformer (геометрия + аналитика) и
        // AlertVerification (advisory-локи) написаны руками законно.
        const transformer = models.find((m) => m.file === 'Transformer.js');
        const verification = models.find((m) => m.file === 'AlertVerification.js');

        expect(transformer.complexity.length).toBeGreaterThan(0);
        expect(transformer.isHandRolledFlatCrud).toBe(false);
        expect(verification.complexity.length).toBeGreaterThan(0);
        expect(verification.isHandRolledFlatCrud).toBe(false);
    });

    test('разборщик действительно умеет отличать нарушение от нормы', () => {
        // Сторож, сканирующий исходники, умеет протухнуть молча: стоит
        // регулярке перестать совпадать — и он зеленеет на любом коде. Поэтому
        // классификатор проверяется на двух синтетических образцах.
        const flatCrud = `
            const db = require('../config/database');
            class Thing {
                static async findAll() { return db.query('SELECT * FROM things'); }
                static async findById(id) { return db.query('SELECT * FROM things WHERE id = $1', [id]); }
                static async create(d) { return db.query('INSERT INTO things (name) VALUES ($1)', [d.name]); }
                static async update(id, d) { return db.query('UPDATE things SET name = $1 WHERE id = $2', [d.name, id]); }
                static async delete(id) { return db.query('DELETE FROM things WHERE id = $1', [id]); }
            }
        `;
        expect(classifyModel(flatCrud).isHandRolledFlatCrud).toBe(true);

        const withJoin = flatCrud.replace(
            "'SELECT * FROM things'",
            "'SELECT t.* FROM things t JOIN owners o ON o.id = t.owner_id'"
        );
        expect(classifyModel(withJoin).isHandRolledFlatCrud).toBe(false);

        const viaFactory = `
            const { createCrudModel } = require('./factories/createCrudModel');
            module.exports = createCrudModel({ tableName: 'things' });
        `;
        expect(classifyModel(viaFactory).isHandRolledFlatCrud).toBe(false);

        // И комментарий про фабрику не считается её использованием.
        const mentionOnly = `${flatCrud}\n// тот же приём, что в createCrudModel\n`;
        expect(classifyModel(mentionOnly).usesFactory).toBe(false);
        expect(classifyModel(mentionOnly).isHandRolledFlatCrud).toBe(true);
    });
});
