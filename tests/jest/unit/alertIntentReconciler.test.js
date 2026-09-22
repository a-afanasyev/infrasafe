'use strict';

/**
 * [A-03, вторая половина] Решения сверяющего прохода.
 *
 * Отбор строк — в `tests/jest/db/alertIntentReconcile.db.test.js` (он в SQL, и
 * мок его показать не может). Здесь проверяется то, что живёт в JS: что проход
 * ОТЛИЧАЕТ починимое от непочинимого.
 *
 * Это и есть риск, который пришлось решать в дизайне. Наивный проход —
 * «нашёл алерт без намерения, позвал форвардер» — на здании без `external_id`
 * (УК их до сих пор не присылает) или на типе алерта без правила эскалации
 * будет звать форвардер вечно: строка намерения не появится НИКОГДА, а условие
 * отбора не изменится. Поэтому оба состояния распознаются ДО вызова и
 * помечаются терминально, а всё остальное считается попыткой с верхней
 * границей.
 *
 * Успех тоже нельзя взять из возвращаемого значения: `sendAlertToUK` гасит
 * любые ошибки внутри себя и возвращает undefined. Единственное честное
 * свидетельство — появилась ли строка намерения; проход перечитывает её после
 * вызова, и тест закрепляет именно это.
 */

const fs = require('fs');
const path = require('path');

jest.mock('../../../src/models/AlertIntentGap');
jest.mock('../../../src/models/AlertRequestMap');
jest.mock('../../../src/models/AlertRule');
jest.mock('../../../src/services/uk/alertForwarder');
jest.mock('../../../src/services/uk/configProxy');

const AlertIntentGap = require('../../../src/models/AlertIntentGap');
const AlertRequestMap = require('../../../src/models/AlertRequestMap');
const AlertRule = require('../../../src/models/AlertRule');
const alertForwarder = require('../../../src/services/uk/alertForwarder');
const configProxy = require('../../../src/services/uk/configProxy');

const reconciler = require('../../../src/services/uk/alertIntentReconciler');

const ORPHAN = Object.freeze({
    alert_id: 77,
    type: 'LEAK_DETECTED',
    infrastructure_id: '7',
    infrastructure_type: 'controller',
    severity: 'CRITICAL',
    message: 'течь',
    created_at: new Date('2026-09-18T10:00:00.000Z'),
    reopen_chain_id: null,
    reopen_sequence: 1,
    previous_uk_request_number: null,
    reconcile_attempts: 0,
});

const withTarget = [{ building_id: 3, external_id: 'ext-3' }];
const withoutTarget = [{ building_id: 3, external_id: null }];

beforeEach(() => {
    jest.clearAllMocks();
    configProxy.isEnabled.mockResolvedValue(true);
    AlertIntentGap.findOrphans.mockResolvedValue([]);
    AlertIntentGap.recordAttempt.mockResolvedValue(true);
    AlertRule.findByTypeAndSeverity.mockResolvedValue({ id: 1, uk_urgency: 'high' });
    alertForwarder.resolveBuildingIds.mockResolvedValue(withTarget);
    alertForwarder.sendAlertToUK.mockResolvedValue(undefined);
    AlertRequestMap.findByAlertId.mockResolvedValue([{ id: 1 }]);
});

describe('[A-03] проход не работает, когда работать не должен', () => {
    test('интеграция с УК выключена — отбора не происходит вовсе', async () => {
        configProxy.isEnabled.mockResolvedValue(false);
        await reconciler.reconcileOnce();
        expect(AlertIntentGap.findOrphans).not.toHaveBeenCalled();
    });

    test('сирот нет — форвардер не зовётся', async () => {
        await reconciler.reconcileOnce();
        expect(alertForwarder.sendAlertToUK).not.toHaveBeenCalled();
    });
});

describe('[A-03] непочинимое помечается терминально, а не крутится', () => {
    test('нет правила эскалации — skipped_reason=no_rule, форвардер не зовётся', async () => {
        AlertIntentGap.findOrphans.mockResolvedValue([ORPHAN]);
        AlertRule.findByTypeAndSeverity.mockResolvedValue(null);

        await reconciler.reconcileOnce();

        expect(alertForwarder.sendAlertToUK).not.toHaveBeenCalled();
        expect(AlertIntentGap.recordAttempt).toHaveBeenCalledWith(
            77, expect.objectContaining({ skippedReason: 'no_rule' })
        );
    });

    test('ни одного здания с external_id — skipped_reason=no_target', async () => {
        AlertIntentGap.findOrphans.mockResolvedValue([ORPHAN]);
        alertForwarder.resolveBuildingIds.mockResolvedValue(withoutTarget);

        await reconciler.reconcileOnce();

        expect(alertForwarder.sendAlertToUK).not.toHaveBeenCalled();
        expect(AlertIntentGap.recordAttempt).toHaveBeenCalledWith(
            77, expect.objectContaining({ skippedReason: 'no_target' })
        );
    });

    test('зданий не нашлось вовсе — тоже no_target', async () => {
        AlertIntentGap.findOrphans.mockResolvedValue([ORPHAN]);
        alertForwarder.resolveBuildingIds.mockResolvedValue([]);

        await reconciler.reconcileOnce();

        expect(alertForwarder.sendAlertToUK).not.toHaveBeenCalled();
        expect(AlertIntentGap.recordAttempt).toHaveBeenCalledWith(
            77, expect.objectContaining({ skippedReason: 'no_target' })
        );
    });
});

// [N-07] Хвост A-03. resolveBuildingIds на ошибке БД возвращал `[]`, и проход
// читал это как «адресата нет» — ставил терминальную пометку no_target, после
// которой findOrphans алерт больше не выбирает НИКОГДА. То есть секундный сбой
// пула навсегда оставлял аварию без заявки — ровно тот сценарий, ради которого
// проход писался. Сбой чтения — это «не знаю», а не «некуда».
describe('[N-07] сбой чтения зданий — не терминальный исход', () => {
    test('проход просит бросать на ошибке, а не молча отдавать пустоту', async () => {
        AlertIntentGap.findOrphans.mockResolvedValue([ORPHAN]);

        await reconciler.reconcileOnce();

        expect(alertForwarder.resolveBuildingIds).toHaveBeenCalledWith(
            '7', 'controller', { throwOnError: true }
        );
    });

    test('ошибка БД — ни пометки no_target, ни засчитанной попытки: алерт вернётся на следующем тике', async () => {
        AlertIntentGap.findOrphans.mockResolvedValue([ORPHAN]);
        alertForwarder.resolveBuildingIds.mockRejectedValue(new Error('timeout exceeded when trying to connect'));

        await reconciler.reconcileOnce();

        expect(alertForwarder.sendAlertToUK).not.toHaveBeenCalled();
        expect(AlertIntentGap.recordAttempt).not.toHaveBeenCalled();
    });

    test('сбой на одной сироте не мешает соседней', async () => {
        const second = { ...ORPHAN, alert_id: 78 };
        AlertIntentGap.findOrphans.mockResolvedValue([ORPHAN, second]);
        alertForwarder.resolveBuildingIds
            .mockRejectedValueOnce(new Error('connection terminated'))
            .mockResolvedValueOnce(withTarget);

        await reconciler.reconcileOnce();

        expect(alertForwarder.sendAlertToUK).toHaveBeenCalledTimes(1);
        expect(alertForwarder.sendAlertToUK).toHaveBeenCalledWith(expect.objectContaining({ alert_id: 78 }));
    });
});

describe('[A-03] починимое чинится', () => {
    test('alertData пересобирается из строки — форвардер получает то же, что получил бы от события', async () => {
        AlertIntentGap.findOrphans.mockResolvedValue([ORPHAN]);

        await reconciler.reconcileOnce();

        expect(alertForwarder.sendAlertToUK).toHaveBeenCalledTimes(1);
        const sent = alertForwarder.sendAlertToUK.mock.calls[0][0];
        expect(sent).toMatchObject({
            alert_id: 77,
            type: 'LEAK_DETECTED',
            infrastructure_id: '7',
            infrastructure_type: 'controller',
            severity: 'CRITICAL',
            message: 'течь',
            reopen_sequence: 1,
        });
        // ISO-строка, а не Date: тело события подписывается побайтово, и
        // сериализация Date драйвером — не то место, где это стоит решать.
        expect(sent.created_at).toBe('2026-09-18T10:00:00.000Z');
    });

    test('строка намерения появилась — попытка отмечается как починка', async () => {
        AlertIntentGap.findOrphans.mockResolvedValue([ORPHAN]);

        await reconciler.reconcileOnce();

        expect(AlertIntentGap.recordAttempt).toHaveBeenCalledWith(
            77, { attempts: 1, repaired: true }
        );
    });

    test('строки намерения не появилось — попытка засчитывается без признака починки', async () => {
        AlertIntentGap.findOrphans.mockResolvedValue([{ ...ORPHAN, reconcile_attempts: 1 }]);
        AlertRequestMap.findByAlertId.mockResolvedValue([]);

        await reconciler.reconcileOnce();

        expect(AlertIntentGap.recordAttempt).toHaveBeenCalledWith(77, { attempts: 2 });
    });
});

describe('[A-03] проход устойчив', () => {
    test('падение на одной сироте не отменяет остальных', async () => {
        const second = { ...ORPHAN, alert_id: 78 };
        AlertIntentGap.findOrphans.mockResolvedValue([ORPHAN, second]);
        alertForwarder.sendAlertToUK
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce(undefined);

        await reconciler.reconcileOnce();

        expect(alertForwarder.sendAlertToUK).toHaveBeenCalledTimes(2);
        expect(AlertIntentGap.recordAttempt).toHaveBeenCalledWith(
            78, expect.objectContaining({ repaired: true })
        );
    });

    test('отказ отметки не роняет проход', async () => {
        AlertIntentGap.findOrphans.mockResolvedValue([ORPHAN]);
        AlertIntentGap.recordAttempt.mockRejectedValue(new Error('db down'));

        await expect(reconciler.reconcileOnce()).resolves.not.toThrow();
    });
});

describe('[A-03] границы читаются из окружения и зажимаются', () => {
    const ENV = process.env;
    afterEach(() => { process.env = ENV; });

    test('умолчания', () => {
        process.env = { ...ENV };
        delete process.env.UK_INTENT_RECONCILE_INTERVAL_MS;
        delete process.env.UK_INTENT_RECONCILE_MAX_AGE_HOURS;
        expect(reconciler.intervalMs()).toBe(60000);
        expect(reconciler.maxAgeHours()).toBe(24);
    });

    test('мусор в переменной не превращается в NaN-интервал', () => {
        process.env = { ...ENV, UK_INTENT_RECONCILE_INTERVAL_MS: 'сейчас' };
        expect(reconciler.intervalMs()).toBe(60000);
    });

    test('слишком частый тик зажимается снизу — проход не должен становиться нагрузкой', () => {
        process.env = { ...ENV, UK_INTENT_RECONCILE_INTERVAL_MS: '100' };
        expect(reconciler.intervalMs()).toBe(10000);
    });

    test('выключается явным флагом — это аварийный рубильник, а не opt-in', () => {
        process.env = { ...ENV };
        delete process.env.UK_INTENT_RECONCILE_ENABLED;
        expect(reconciler.isEnabled()).toBe(true);
        process.env = { ...ENV, UK_INTENT_RECONCILE_ENABLED: 'false' };
        expect(reconciler.isEnabled()).toBe(false);
    });
});

describe('[A-03] проход подключён к жизненному циклу приложения', () => {
    // Здесь уже однажды завёлся мёртвый код: подсистема повторного открытия
    // алертов существовала, была покрыта тестами и НЕ ВЫЗЫВАЛАСЬ ниоткуда
    // (AUD-001). Рубеж дешёвый, а отличает работающую починку от декоративной.
    const SERVER = fs.readFileSync(
        path.join(__dirname, '../../../src/server.js'), 'utf8'
    );

    test('стартует вместе с приложением', () => {
        expect(SERVER).toMatch(/require\('\.\/services\/uk\/alertIntentReconciler'\)\.start\(\)/);
    });

    test('останавливается при graceful shutdown', () => {
        expect(SERVER).toMatch(/require\('\.\/services\/uk\/alertIntentReconciler'\)\.stop\(\)/);
    });
});

describe('[A-03] повторный старт не плодит таймеры', () => {
    afterEach(async () => { await reconciler.stop(); });

    test('второй start() не заводит второй интервал', () => {
        reconciler.start();
        const first = reconciler._timer;
        reconciler.start();
        expect(reconciler._timer).toBe(first);
    });

    test('stop() снимает и прогрев, и интервал', async () => {
        reconciler.start();
        await reconciler.stop();
        expect(reconciler._timer).toBeNull();
        expect(reconciler._warmupTimer).toBeNull();
    });
});
