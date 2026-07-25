/**
 * [R2-29] Загрузчик админки не должен глушить ошибки.
 *
 * Базовый баг: `loadData()` ловил любую ошибку и возвращал `[]`. Вызывающий
 * получал пустой массив и рисовал «Нет данных» — то есть отказ сети или 500 от
 * сервера был визуально неотличим от честно пустой таблицы, и оператор видел
 * «всё в порядке, просто пусто». Закрыт был только integration-таб.
 *
 * ПОЧЕМУ ТЕСТ ПО ИСХОДНИКУ, А НЕ ПОВЕДЕНЧЕСКИЙ. `loadData` объявлена внутри
 * замыкания в public/admin.js (~3900 строк, монолит — см. B-004 в бэклоге) и
 * наружу не экспортируется; поднять её в jsdom можно только вместе со всем
 * файлом и десятком глобалов. Поэтому здесь проверяется контракт исходника.
 * Ограничение осознанное и названо явно: тест ловит регресс «снова вернули
 * `[]`», но не проверяет рантайм.
 *
 * Второй (и более ценный) инвариант: проброс безопасен ТОЛЬКО пока каждый
 * вызов `loadData` обёрнут в try/catch с показом ошибки. Если кто-то добавит
 * потребителя без обработчика — получит необработанный reject вместо таблицы с
 * ошибкой. Это здесь и проверяется.
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '../../../../public/admin.js'), 'utf8');
const LINES = SRC.split('\n');

describe('[R2-29] loadData пробрасывает ошибку', () => {
    test('catch завершается throw, а не возвратом пустого массива', () => {
        const start = LINES.findIndex((l) => /async function loadData\(/.test(l));
        expect(start).toBeGreaterThan(-1);

        // тело функции — до следующего объявления на том же уровне
        const rest = LINES.slice(start, start + 80).join('\n');
        const catchBlock = rest.slice(rest.indexOf('} catch (error) {'));

        expect(catchBlock).toContain('throw error;');
        expect(catchBlock).not.toMatch(/return\s*\[\s*\]\s*;/);
    });

    test('пользователь всё ещё получает toast (проброс не заменил уведомление, а дополнил)', () => {
        const start = LINES.findIndex((l) => /async function loadData\(/.test(l));
        const rest = LINES.slice(start, start + 80).join('\n');
        const catchBlock = rest.slice(rest.indexOf('} catch (error) {'));
        expect(catchBlock).toContain('showToast');
    });
});

describe('[R2-29] каждый потребитель loadData умеет показать ошибку', () => {
    const callSites = LINES
        .map((line, i) => ({ line, no: i + 1 }))
        .filter(({ line }) => /await loadData\(/.test(line));

    test('потребители найдены (тест не выродился в пустой)', () => {
        expect(callSites.length).toBeGreaterThanOrEqual(8);
    });

    test.each(callSites.map(({ no, line }) => [no, line.trim().slice(0, 60)]))(
        'строка %i (%s) — внутри try/catch с showErrorMessage',
        (no) => {
            // Смотрим вперёд от вызова: ожидаем catch и показ ошибки в нём.
            const window = LINES.slice(no - 1, no + 14).join('\n');
            expect(window).toMatch(/}\s*catch\s*\(/);
            expect(window).toContain('showErrorMessage');
        }
    );
});
