/**
 * [AR-2 / Task 6] Прикладные метрики для Prometheus.
 *
 * Контракт зафиксирован в отдельном репозитории profk-observability ДО того,
 * как появился этот код:
 *   - alloy/config.alloy:240-249 — путь /internal/metrics, bearer-токен,
 *     интервал 30 с, job infrasafe_app;
 *   - prometheus/rules/infrasafe.yml — правила, уже ссылающиеся на конкретные
 *     имена серий.
 * Имена ниже менять нельзя, не поменяв правила на той стороне.
 *
 * Отдельно: `infrasafe_circuit_breaker_*` — это ответ на вопрос, оставшийся
 * открытым после AR-1 («срабатывал ли предохранитель на проде?»). Раньше его
 * можно было выяснить только грепом логов.
 */

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));

jest.mock('../../../src/config/database', () => ({
    query: jest.fn()
}));

const db = require('../../../src/config/database');
const metrics = require('../../../src/observability/metrics');

async function scrape() {
    // Роут делает ровно это: сначала явный сбор из БД, потом сериализация.
    await metrics.refresh();
    return await metrics.registry.metrics();
}

beforeEach(() => {
    jest.clearAllMocks();
    metrics.resetForTests();
});

describe('[AR-2] имена серий, которых ждут правила в profk-observability', () => {
    test('счётчики конвейера алертов присутствуют после первого события', async () => {
        metrics.recordAlertCheck('LEAK_DETECTED', 'created');
        metrics.recordAlertCreated('LEAK_DETECTED', 'CRITICAL');

        const text = await scrape();

        expect(text).toContain('infrasafe_alert_checks_total');
        expect(text).toMatch(/infrasafe_alert_checks_total\{type="LEAK_DETECTED",outcome="created"\}\s+1/);
        expect(text).toMatch(/infrasafe_alerts_created_total\{type="LEAK_DETECTED",severity="CRITICAL"\}\s+1/);
    });

    test('исход проверки различает отказ гейта и ошибку', async () => {
        metrics.recordAlertCheck('VOLTAGE_ANOMALY', 'gate_denied');
        metrics.recordAlertCheck('VOLTAGE_ANOMALY', 'error');

        const text = await scrape();

        expect(text).toMatch(/outcome="gate_denied"\}\s+1/);
        expect(text).toMatch(/outcome="error"\}\s+1/);
    });

    test('состояние предохранителя выражено числом, а открытия считаются', async () => {
        metrics.setCircuitBreakerState('AlertsDB', 'CLOSED');
        metrics.setCircuitBreakerState('AnalyticsDB', 'OPEN');
        metrics.incCircuitBreakerOpened('AnalyticsDB');

        const text = await scrape();

        expect(text).toMatch(/infrasafe_circuit_breaker_state\{breaker="AlertsDB"\}\s+0/);
        expect(text).toMatch(/infrasafe_circuit_breaker_state\{breaker="AnalyticsDB"\}\s+2/);
        expect(text).toMatch(/infrasafe_circuit_breaker_opened_total\{breaker="AnalyticsDB"\}\s+1/);
    });

    test('тик воркера верификации отмечается временной меткой', async () => {
        metrics.markVerificationTick(1754300000);

        const text = await scrape();

        expect(text).toMatch(/infrasafe_verification_worker_last_tick_timestamp_seconds\s+1754300000/);
    });

    test('мёртвые строки outbox считаются счётчиком (правило смотрит increase)', async () => {
        metrics.incOutboxDead();
        metrics.incOutboxDead();

        const text = await scrape();

        expect(text).toMatch(/infrasafe_uk_outbox_dead_total\s+2/);
    });
});

describe('[AR-2] гейджи из БД собираются на скрейпе', () => {
    function mockDb({ lastTelemetry, controllers, outbox }) {
        db.query.mockImplementation((sql) => {
            if (/FROM\s+metrics/i.test(sql)) return Promise.resolve({ rows: [{ last_ts: lastTelemetry }] });
            if (/FROM\s+controllers/i.test(sql)) return Promise.resolve({ rows: [{ count: controllers }] });
            if (/FROM\s+uk_outbox/i.test(sql)) return Promise.resolve({ rows: outbox });
            return Promise.resolve({ rows: [] });
        });
    }

    test('телеметрия, ожидаемые контроллеры и очередь outbox', async () => {
        mockDb({
            lastTelemetry: new Date(1754300000 * 1000),
            controllers: 3,
            outbox: [{ status: 'pending', count: 7 }, { status: 'dead', count: 2 }]
        });

        const text = await scrape();

        expect(text).toMatch(/infrasafe_telemetry_last_received_timestamp_seconds\s+1754300000/);
        expect(text).toMatch(/infrasafe_expected_controllers\s+3/);
        expect(text).toMatch(/infrasafe_uk_outbox_pending\s+7/);
    });

    // Поймано прогоном против ЖИВОЙ БД, моки этого не видели. Домен статусов
    // контроллера противоречив: схема ставит DEFAULT 'active' без CHECK
    // (01_init_database.sql:120), а controllerService при обновлении валидирует
    // ['online','offline','maintenance'] — и в базе лежит и то, и другое
    // (dev: online=21, active=10; прод infrasafe.uz: online=2, active=0).
    //
    // Фильтр `status = 'active'` давал на проде 0, из-за чего гейт
    // `infrasafe_expected_controllers > 0` в правиле InfrasafeTelemetryStale
    // не проходил бы НИКОГДА — правило молчало бы вечно. Именно оно должно было
    // поймать семинедельное молчание телеметрии на infrasafe.uz.
    //
    // Считаем «ожидается телеметрия» = всё, кроме выведенного в обслуживание.
    // offline тоже считается: молчащий контроллер — это и есть авария.
    test('ожидаемые контроллеры считаются по домену статусов, а не по одному "active"', async () => {
        const seen = [];
        db.query.mockImplementation((sql) => {
            seen.push(sql);
            if (/FROM\s+controllers/i.test(sql)) return Promise.resolve({ rows: [{ count: 2 }] });
            return Promise.resolve({ rows: [] });
        });

        const text = await scrape();

        const controllersSql = seen.find(s => /FROM\s+controllers/i.test(s));
        expect(controllersSql).toMatch(/maintenance/);
        expect(controllersSql).not.toMatch(/=\s*'active'/);
        expect(text).toMatch(/infrasafe_expected_controllers\s+2/);
    });

    test('телеметрии не было ни разу → NaN, а не фиктивный ноль', async () => {
        // Незаданный гейдж prom-client отдаёт как 0, и тогда `time() - 0 > 900`
        // истинно всегда: правило InfrasafeTelemetryStale firing'овало бы
        // круглосуточно на площадке без контроллеров (случай profk). Сравнения
        // с NaN ложны — это честное «неизвестно».
        mockDb({ lastTelemetry: null, controllers: 0, outbox: [] });

        const text = await scrape();

        expect(text).toMatch(/infrasafe_telemetry_last_received_timestamp_seconds\s+Nan/i);
        expect(text).not.toMatch(/infrasafe_telemetry_last_received_timestamp_seconds\s+0\b/);
        expect(text).toMatch(/infrasafe_expected_controllers\s+0/);
    });

    test('отказ БД не роняет скрейп целиком — счётчики остаются доступны', async () => {
        metrics.recordAlertCreated('LEAK_DETECTED', 'CRITICAL');
        db.query.mockRejectedValue(new Error('connection terminated'));

        const text = await scrape();

        expect(text).toMatch(/infrasafe_alerts_created_total\{type="LEAK_DETECTED",severity="CRITICAL"\}\s+1/);
        expect(text).toMatch(/infrasafe_metrics_collect_errors_total\{collector="[a-z_]+"\}\s+[1-9]/);
    });
});
