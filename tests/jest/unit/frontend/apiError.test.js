/**
 * [AR-4] Единая распаковка сообщения об ошибке на фронте.
 *
 * Бэкенд отдаёт ошибки в ПЯТИ несовместимых формах (см. AR-4), и фронт читает
 * их двадцатью разными способами. Самый частый — `errorData.error ||
 * errorData.message || 'запасной текст'` — на КАНОНИЧЕСКОЙ форме
 * (`{success:false, error:{message,status}}`) выдаёт объект, а `new
 * Error(объект).message` превращается в строку `"[object Object]"`.
 *
 * Это не риск будущей правки, а живой баг: `errorHandler` отдаёт канон, значит
 * на любой неудачной админской операции оператор уже сегодня видит
 * «[object Object]» вместо причины отказа. Проверяется ниже отдельным тестом.
 *
 * Задача хелпера — принимать ЛЮБУЮ из существующих форм и всегда возвращать
 * читаемую строку. Тогда канонизация бэкенда (следующие шаги AR-4) не может
 * сломать фронт: он перестаёт зависеть от конкретной формы.
 */

const { extractApiError } = require('../../../../public/utils/apiError');

describe('[AR-4] extractApiError — все формы конверта', () => {
    test('канон: error — объект с message', () => {
        const body = { success: false, error: { message: 'Здание не найдено', status: 404 } };
        expect(extractApiError(body)).toBe('Здание не найдено');
    });

    test('форма middleware: message на верхнем уровне', () => {
        const body = { success: false, message: 'Access token is missing' };
        expect(extractApiError(body)).toBe('Access token is missing');
    });

    test('форма лимитера: error — строка-код, message — текст', () => {
        const body = {
            success: false,
            message: 'Слишком много запросов к данным карты. Попробуйте позже.',
            error: 'RATE_LIMIT_EXCEEDED'
        };
        // Человеку показываем текст, а не код.
        expect(extractApiError(body)).toBe('Слишком много запросов к данным карты. Попробуйте позже.');
    });

    test('форма express-validator: errors[] без success', () => {
        const body = {
            errors: [
                { msg: 'Название здания обязательно', path: 'name' },
                { msg: 'Широта должна быть числом', path: 'latitude' }
            ]
        };
        const msg = extractApiError(body);
        expect(msg).toContain('Название здания обязательно');
        expect(msg).toContain('Широта должна быть числом');
    });

    test('канон с деталями валидации: перечисляем поля', () => {
        const body = {
            success: false,
            error: {
                message: 'Ошибка валидации',
                status: 400,
                details: [{ field: 'name', message: 'обязательно' }]
            }
        };
        const msg = extractApiError(body);
        expect(msg).toContain('Ошибка валидации');
        expect(msg).toContain('name');
        expect(msg).toContain('обязательно');
    });

    test('error — строка без message: отдаём строку', () => {
        expect(extractApiError({ error: 'Ошибка сохранения линии' })).toBe('Ошибка сохранения линии');
    });

    describe('запасной текст', () => {
        test('пустое тело', () => {
            expect(extractApiError({}, 'Не удалось сохранить')).toBe('Не удалось сохранить');
        });

        test('null / undefined / не объект', () => {
            expect(extractApiError(null, 'Запасной')).toBe('Запасной');
            expect(extractApiError(undefined, 'Запасной')).toBe('Запасной');
            expect(extractApiError('строка', 'Запасной')).toBe('Запасной');
        });

        test('без запасного текста — нейтральная фраза, но НЕ "[object Object]"', () => {
            const msg = extractApiError({});
            expect(typeof msg).toBe('string');
            expect(msg.length).toBeGreaterThan(0);
            expect(msg).not.toContain('object Object');
        });
    });

    // Главный тест файла: ровно тот случай, который сегодня ломается.
    test('НИКОГДА не возвращает "[object Object]"', () => {
        const shapes = [
            { success: false, error: { message: 'Ошибка БД', status: 500 } },
            { success: false, error: {} },
            { success: false, error: { status: 500 } },
            { error: { nested: { deep: true } } },
            { errors: [] },
            { errors: [{}] }
        ];
        for (const body of shapes) {
            const msg = extractApiError(body, 'Операция не выполнена');
            expect(msg).not.toContain('object Object');
            expect(typeof msg).toBe('string');
            expect(msg.length).toBeGreaterThan(0);
        }
    });

    test('не падает на телах с циклическими ссылками', () => {
        const body = { success: false, error: { message: 'Цикл' } };
        body.error.self = body;
        expect(extractApiError(body)).toBe('Цикл');
    });
});
