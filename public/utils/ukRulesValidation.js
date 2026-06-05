// [Sprint 10 PR-5] Client-side bounds for alert_rules fields.
// MIRROR of server-side EDITABLE_FIELDS in src/models/AlertRule.js — keep
// in sync. Bounds intentionally a touch tighter (UI guards user from
// nonsense input; server is the source of truth for rejection).

(function (global) {
    'use strict';

    const RULE_FIELD_SPEC = Object.freeze({
        min_persistence_seconds:     { type: 'int', min: 1,  max: 3600,
            label: 'Persistence (сек)',
            hint: '0 не разрешён; реалистичный диапазон 5–600 сек' },
        min_affected_buildings:      { type: 'int', min: 1,  max: 100,
            label: 'Зданий мин',
            hint: '1 = эскалируем при любом затронутом здании' },
        verification_grace_seconds:  { type: 'int', min: 60, max: 1800,
            label: 'Grace (сек)',
            hint: 'Время до проверки после закрытия УК (5 мин по умолчанию)' },
        verification_window_seconds: { type: 'int', min: 60, max: 3600,
            label: 'Window (сек)',
            hint: 'Окно повторной проверки (10 мин по умолчанию)' },
        max_reopens_per_24h:         { type: 'int', min: 0,  max: 20,
            label: 'Max reopens / 24ч',
            hint: '0 = автоматический reopen отключён; ≥1 → engineer_required при превышении' },
        reopen_cooldown_min:         { type: 'int', min: 1,  max: 1440,
            label: 'Cooldown reopen (мин)',
            hint: 'Не чаще чем раз в N минут на одну цепочку' },
        reopen_urgency_bump:         { type: 'boolean',
            label: 'Bump urgency',
            hint: 'При reopen поднять urgency на одну ступень (cap critical)' },
        enabled:                     { type: 'boolean',
            label: 'Включено',
            hint: 'Если выключено — заявка в УК НЕ создаётся' },
        uk_category:                 { type: 'string', maxLen: 50,
            label: 'Категория УК' },
        uk_urgency:                  { type: 'string', maxLen: 50,
            label: 'Срочность УК',
            hint: 'Канонический ключ: low | medium | high | critical' },
        description:                 { type: 'string', maxLen: 500,
            label: 'Описание' }
    });

    /**
     * Validate one field value. Returns { ok, error?, coerced? }.
     * coerced is the parsed value (e.g. string → int) ready to PATCH.
     */
    function validateRuleField(name, value) {
        const spec = RULE_FIELD_SPEC[name];
        if (!spec) return { ok: false, error: `Поле "${name}" не редактируется` };

        if (spec.type === 'boolean') {
            const b = (typeof value === 'boolean') ? value : (value === 'true' || value === true);
            return { ok: true, coerced: b };
        }
        if (spec.type === 'int') {
            const n = (typeof value === 'number') ? value : parseInt(String(value).trim(), 10);
            if (!Number.isInteger(n)) return { ok: false, error: `${spec.label}: ожидается целое число` };
            if (spec.min !== undefined && n < spec.min) return { ok: false, error: `${spec.label}: минимум ${spec.min}` };
            if (spec.max !== undefined && n > spec.max) return { ok: false, error: `${spec.label}: максимум ${spec.max}` };
            return { ok: true, coerced: n };
        }
        if (spec.type === 'string') {
            const s = String(value);
            if (spec.maxLen && s.length > spec.maxLen) {
                return { ok: false, error: `${spec.label}: максимум ${spec.maxLen} символов` };
            }
            return { ok: true, coerced: s };
        }
        return { ok: false, error: `Неизвестный тип поля: ${spec.type}` };
    }

    global.UkRulesValidation = {
        RULE_FIELD_SPEC,
        validateRuleField
    };
})(window);
