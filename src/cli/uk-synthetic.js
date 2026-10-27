#!/usr/bin/env node
/**
 * Синтетические события для совместной проверки с УК.
 *
 * Зачем. Живую эскалацию за полчаса не получить: `alert.engineer_required`
 * рождается только после исчерпания квоты повторных обращений по одной
 * цепочке. Поэтому оба сценария проверки (эскалация и повторный алерт)
 * собираются здесь — ТЕМ ЖЕ кодом, что и боевой путь
 * (`alertForwarder._buildAlertEventBody`), и кладутся в `uk_outbox`. Подпись и
 * отправку делает штатный drain-воркер, так что проверяется настоящий канал,
 * а не его копия.
 *
 * Что НЕ трогается: `infrastructure_alerts`, `alert_request_map`,
 * `alert_verifications`. Ответные `request.created` / `request.status_changed`
 * не найдут маппинга и пройдут штатным no-op («synthetic test or stale») —
 * ни карта, ни счётчики, ни верификация не сдвинутся.
 *
 * Запуск (scripts/ в образ не попадает по SEC-14, поэтому файл в src/):
 *
 *   docker compose -f docker-compose.unified.yml exec app \
 *     node src/cli/uk-synthetic.js <engineer|reopen> [опции]
 *
 *   --building <id>   здание с external_id (по умолчанию 14, «QA Здание 1»)
 *   --type <TYPE>     тип алерта (по умолчанию LEAK_DETECTED)
 *   --severity <S>    WARNING | CRITICAL (по умолчанию CRITICAL)
 *   --chain <uuid>    reopen_chain_id; без него — новый
 *   --sequence <n>    reopen_sequence (reopen: 2, engineer: 3)
 *   --related <num>   related_request_number (номер прошлой заявки УК)
 *   --dry-run         только напечатать payload, в outbox не класть
 *   --wait <сек>      дождаться отправки и ответных вебхуков (по умолчанию 120, 0 — не ждать)
 */

const crypto = require('crypto');
const db = require('../config/database');

const SCENARIOS = Object.freeze({
    engineer: { engineerRequired: true, defaultSequence: 3 },
    reopen: { engineerRequired: false, defaultSequence: 2 }
});
const DEFAULTS = Object.freeze({ building: 14, type: 'LEAK_DETECTED', severity: 'CRITICAL', wait: 120 });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Заведомо вне диапазона боевых alert_id, чтобы УК не склеила синтетику с
// настоящим алертом.
const SYNTHETIC_ALERT_ID_BASE = 900000000;
const POLL_MS = 2000;

const USAGE =
    'Usage: node src/cli/uk-synthetic.js <engineer|reopen> [--building id] [--type T] ' +
    '[--severity S] [--chain uuid] [--sequence n] [--related num] [--dry-run] [--wait sec]\n';

function positiveInt(name, raw) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) throw new Error(`${name}: ожидается целое ≥ 0, получено "${raw}"`);
    return n;
}

/**
 * @param {string[]} argv — process.argv.slice(2)
 * @returns {object} разобранные и проверенные опции
 */
function parseArgs(argv) {
    const [scenario, ...rest] = argv;
    if (!SCENARIOS[scenario]) throw new Error(`неизвестный сценарий "${scenario ?? ''}"`);
    const raw = {};
    for (let i = 0; i < rest.length; i++) {
        const key = rest[i];
        if (key === '--dry-run') { raw.dryRun = true; continue; }
        if (!key.startsWith('--') || rest[i + 1] === undefined) throw new Error(`неверный аргумент "${key}"`);
        raw[key.slice(2)] = rest[++i];
    }
    const known = new Set(['dryRun', 'building', 'type', 'severity', 'chain', 'sequence', 'related', 'wait']);
    const unknown = Object.keys(raw).filter((k) => !known.has(k));
    if (unknown.length) throw new Error(`неизвестные опции: ${unknown.join(', ')}`);

    const severity = (raw.severity ?? DEFAULTS.severity).toUpperCase();
    if (!['WARNING', 'CRITICAL'].includes(severity)) throw new Error(`--severity: WARNING или CRITICAL`);
    if (raw.chain !== undefined && !UUID_RE.test(raw.chain)) throw new Error('--chain: ожидается UUID');
    const sequence = raw.sequence === undefined
        ? SCENARIOS[scenario].defaultSequence
        : positiveInt('--sequence', raw.sequence);
    if (sequence < 1) throw new Error('--sequence: минимум 1');

    return Object.freeze({
        scenario,
        building: raw.building === undefined ? DEFAULTS.building : positiveInt('--building', raw.building),
        type: (raw.type ?? DEFAULTS.type).toUpperCase(),
        severity,
        chain: raw.chain ?? crypto.randomUUID(),
        sequence,
        related: raw.related ?? null,
        dryRun: raw.dryRun === true,
        wait: raw.wait === undefined ? DEFAULTS.wait : positiveInt('--wait', raw.wait)
    });
}

/** alertData в той форме, в какой его видит alertForwarder на боевом пути. */
function buildAlertData(opts, now = new Date()) {
    const label = opts.scenario === 'engineer' ? 'эскалация на инженера' : `повторное обращение №${opts.sequence}`;
    return {
        alert_id: SYNTHETIC_ALERT_ID_BASE + (now.getTime() % 100000000),
        type: opts.type,
        severity: opts.severity,
        message: `[ТЕСТ ИНТЕГРАЦИИ] ${label}`,
        created_at: now.toISOString(),
        infrastructure_type: 'building',
        infrastructure_id: String(opts.building),
        reopen_chain_id: opts.chain,
        reopen_sequence: opts.sequence,
        previous_uk_request_number: opts.related
    };
}

async function loadBuilding(buildingId) {
    const { rows } = await db.query(
        'SELECT building_id, name, external_id FROM buildings WHERE building_id = $1',
        [buildingId]
    );
    if (!rows[0]) throw new Error(`здание ${buildingId} не найдено`);
    if (!rows[0].external_id) throw new Error(`у здания ${buildingId} нет external_id — УК его не знает`);
    return rows[0];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pollUntil(deadline, fn) {
    while (Date.now() < deadline) {
        const v = await fn();
        if (v) return v;
        await sleep(POLL_MS);
    }
    return null;
}

/** Ждёт отправки и ответной пары request.created → request.status_changed. */
async function waitForRoundTrip(eventId, seconds, log) {
    const deadline = Date.now() + seconds * 1000;
    const sent = await pollUntil(deadline, async () => {
        const { rows } = await db.query(
            'SELECT status, attempt_count, last_response_code, last_error FROM uk_outbox WHERE event_id = $1',
            [eventId]
        );
        return rows[0] && rows[0].status !== 'pending' ? rows[0] : null;
    });
    if (!sent) return log(`⏳ outbox: всё ещё pending через ${seconds}с — воркер выключен или УК недоступна`);
    if (sent.status === 'dead') {
        return log(`❌ outbox: dead (HTTP ${sent.last_response_code ?? '—'}): ${sent.last_error ?? ''}`);
    }
    log(`✅ outbox: sent (HTTP ${sent.last_response_code}, попыток ${sent.attempt_count})`);

    const created = await pollUntil(deadline, async () => {
        const { rows } = await db.query(
            `SELECT entity_id, created_at FROM integration_log
              WHERE direction = 'from_uk' AND action = 'request.created'
                AND payload->'request'->>'source_event_id' = $1
              ORDER BY id LIMIT 1`,
            [eventId]
        );
        return rows[0] || null;
    });
    if (!created) return log('⏳ request.created от УК не пришёл в отведённое время');
    log(`✅ request.created: заявка ${created.entity_id}`);

    const changed = await pollUntil(deadline, async () => {
        const { rows } = await db.query(
            `SELECT payload->'request'->>'old_status' AS old_status,
                    COALESCE(payload->'request'->>'new_status', payload->'request'->>'status') AS new_status,
                    created_at
               FROM integration_log
              WHERE direction = 'from_uk' AND action = 'request.status_changed' AND entity_id = $1
                -- УК шлёт «Новая → Новая» сразу за request.created (видно в
                -- истории .105) — это не назначение, ждём настоящую смену.
                AND COALESCE(payload->'request'->>'new_status', payload->'request'->>'status')
                    IS DISTINCT FROM payload->'request'->>'old_status'
              ORDER BY id LIMIT 1`,
            [created.entity_id]
        );
        return rows[0] || null;
    });
    if (!changed) return log('⏳ request.status_changed не пришёл (инженера нет в смене?)');
    const lagMs = new Date(changed.created_at) - new Date(created.created_at);
    return log(`✅ request.status_changed: ${changed.old_status ?? '?'} → ${changed.new_status} (через ${lagMs} мс)`);
}

async function run(opts, log) {
    // Подгружается здесь, а не наверху: модуль вешает слушатели шины событий,
    // а parseArgs/buildAlertData должны тестироваться без них.
    const forwarder = require('../services/uk/alertForwarder');
    const AlertRule = require('../models/AlertRule');

    await db.init();
    try {
        const building = await loadBuilding(opts.building);
        const rule = await AlertRule.findByTypeAndSeverity(opts.type, opts.severity);
        if (!rule) throw new Error(`нет включённого правила ${opts.type}/${opts.severity}`);

        const alertData = buildAlertData(opts);
        const eventId = crypto.randomUUID();
        const body = forwarder._buildAlertEventBody(alertData, building, eventId, rule, {
            engineerRequired: SCENARIOS[opts.scenario].engineerRequired
        });

        log(`здание ${building.building_id} «${building.name}» (external_id ${building.external_id})`);
        log(`event_id ${eventId}, reopen_chain_id ${opts.chain}`);
        log(JSON.stringify(JSON.parse(body), null, 2));
        if (opts.dryRun) return log('--dry-run: в outbox не положено');

        const row = await require('../models/UkOutbox').enqueue({ event_id: eventId, payload_body: body });
        if (!row) throw new Error(`event_id ${eventId} уже в outbox`);
        log(`📤 положено в uk_outbox (id ${row.id})`);
        if (opts.wait > 0) await waitForRoundTrip(eventId, opts.wait, log);
    } finally {
        await db.close();
    }
}

async function main() {
    let opts;
    try {
        opts = parseArgs(process.argv.slice(2));
    } catch (err) {
        process.stderr.write(`uk-synthetic: ${err.message}\n${USAGE}`);
        process.exit(2);
        return;
    }
    try {
        await run(opts, (line) => process.stdout.write(`${line}\n`));
        process.exit(0);
    } catch (err) {
        process.stderr.write(`uk-synthetic failed: ${err.message}\n`);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { parseArgs, buildAlertData };
