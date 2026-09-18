'use strict';

/**
 * [A-18] Единый разбор булевых переменных окружения.
 *
 * Дефект: валидатор принимает `true|false|1|0`, а потребители сравнивали
 * значение со строкой `'true'`. Поэтому `=1` проходил проверку на старте и НЕ
 * ДЕЛАЛ НИЧЕГО — при полной тишине:
 *
 *   - `AUTH_BLACKLIST_FAIL_OPEN=1` — оператор считает аварийный клапан
 *     открытым, а в production отказ базы чёрного списка продолжает закрывать
 *     вход всем подряд;
 *   - `UK_USE_NEXT_SECRET=1` — подпись остаётся на СТАРОМ ключе посреди
 *     ротации;
 *   - `SECURE_COOKIES=1` — вне production не включает ничего.
 *
 * Здесь проверяется и сам парсер, и то, что потребители ходят через него.
 */

const { parseBoolean, isEnabled } = require('../../../src/utils/envFlags');

describe('[A-18] parseBoolean', () => {
    test('все формы «включено», принимаемые валидатором', () => {
        for (const raw of ['true', 'TRUE', 'True', '1', ' 1 ', 'yes', 'on']) {
            expect(parseBoolean(raw)).toBe(true);
        }
    });

    test('все формы «выключено»', () => {
        for (const raw of ['false', 'FALSE', '0', ' 0 ', 'no', 'off']) {
            expect(parseBoolean(raw)).toBe(false);
        }
    });

    test('не задано или пусто → значение по умолчанию', () => {
        expect(parseBoolean(undefined)).toBe(false);
        expect(parseBoolean(null)).toBe(false);
        expect(parseBoolean('   ')).toBe(false);
        expect(parseBoolean(undefined, true)).toBe(true);
    });

    test('опечатка НЕ включает флаг', () => {
        // Иначе `AUTH_BLACKLIST_FAIL_OPN=ture` открывал бы аварийный клапан.
        expect(parseBoolean('ture')).toBe(false);
        expect(parseBoolean('да')).toBe(false);
        expect(parseBoolean('2')).toBe(false);
    });

    test('опечатка не переключает флаг, у которого умолчание true', () => {
        expect(parseBoolean('ture', true)).toBe(true);
    });
});

describe('[A-18] isEnabled читает окружение', () => {
    const NAME = 'A18_PROBE_FLAG';
    const original = process.env[NAME];

    afterEach(() => {
        if (original === undefined) delete process.env[NAME];
        else process.env[NAME] = original;
    });

    test('=1 включает флаг — то самое, что раньше молчало', () => {
        process.env[NAME] = '1';
        expect(isEnabled(NAME)).toBe(true);
    });

    test('=0 выключает', () => {
        process.env[NAME] = '0';
        expect(isEnabled(NAME)).toBe(false);
    });
});

describe('[A-18] потребители ходят через общий парсер', () => {
    // Рубеж на то, что разбор не расползётся обратно: четыре места читали одну
    // и ту же по смыслу настройку ЧЕТЫРЬМЯ разными способами.
    const fs = require('fs');
    const path = require('path');
    const read = (rel) => fs.readFileSync(path.resolve(__dirname, '../../../', rel), 'utf8');

    test.each([
        ['src/services/authService.js', 'AUTH_BLACKLIST_FAIL_OPEN'],
        ['src/clients/ukWebhookClient.js', 'UK_USE_NEXT_SECRET'],
        ['src/utils/authCookies.js', 'SECURE_COOKIES'],
        ['src/services/alertService.js', 'ALERT_VERIFICATION_ENABLED'],
    ])('%s читает %s через envFlags', (file, flag) => {
        const source = read(file);
        expect(source).toMatch(new RegExp(`envFlags\\.isEnabled\\('${flag}'\\)`));
        // И не осталось прежнего сравнения со строкой.
        expect(source).not.toMatch(new RegExp(`env\\.${flag}[^\\n]*===\\s*'true'`));
    });
});
