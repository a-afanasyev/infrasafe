-- Migration 011: UK Integration Foundation
-- Adds external_id to buildings, creates integration tables

-- 1. Buildings table changes
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS external_id UUID UNIQUE;
ALTER TABLE buildings ALTER COLUMN latitude DROP NOT NULL;
ALTER TABLE buildings ALTER COLUMN longitude DROP NOT NULL;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS uk_deleted_at TIMESTAMPTZ;

-- 2. Integration config (key-value store for non-sensitive settings)
CREATE TABLE IF NOT EXISTS integration_config (
    key         VARCHAR(50) PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Seed defaults (non-sensitive only; secrets are ENV-ONLY)
INSERT INTO integration_config (key, value) VALUES
    ('uk_integration_enabled', 'false'),
    ('uk_api_url', ''),
    ('uk_frontend_url', '')
ON CONFLICT (key) DO NOTHING;

-- 3. Alert-to-request mapping rules
CREATE TABLE IF NOT EXISTS alert_rules (
    id          SERIAL PRIMARY KEY,
    alert_type  VARCHAR(100) NOT NULL,
    severity    VARCHAR(20) NOT NULL,
    enabled     BOOLEAN DEFAULT true,
    uk_category VARCHAR(50) NOT NULL,
    uk_urgency  VARCHAR(50) NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(alert_type, severity)
);

-- Seed default rules
INSERT INTO alert_rules (alert_type, severity, uk_category, uk_urgency, description) VALUES
    ('TRANSFORMER_OVERLOAD', 'WARNING', 'Электрика', 'Средняя', 'Перегрузка трансформатора (предупреждение)'),
    ('TRANSFORMER_OVERLOAD', 'CRITICAL', 'Электрика', 'Критическая', 'Перегрузка трансформатора (критическая)'),
    ('TRANSFORMER_CRITICAL_OVERLOAD', 'CRITICAL', 'Электрика', 'Критическая', 'Критическая перегрузка трансформатора'),
    ('LEAK_DETECTED', 'WARNING', 'Сантехника', 'Срочная', 'Обнаружена утечка (предупреждение)'),
    ('LEAK_DETECTED', 'CRITICAL', 'Сантехника', 'Критическая', 'Обнаружена утечка (критическая)'),
    ('VOLTAGE_ANOMALY', 'WARNING', 'Электрика', 'Обычная', 'Аномалия напряжения'),
    ('HEATING_FAILURE', 'CRITICAL', 'Отопление', 'Критическая', 'Отказ отопления')
ON CONFLICT (alert_type, severity) DO NOTHING;

-- 4. Alert-request mapping tracker
CREATE TABLE IF NOT EXISTS alert_request_map (
    id                  SERIAL PRIMARY KEY,
    infrasafe_alert_id  INTEGER NOT NULL,
    uk_request_number   VARCHAR(20),
    building_external_id UUID,
    idempotency_key     UUID UNIQUE,
    status              VARCHAR(20) DEFAULT 'active',
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(infrasafe_alert_id, building_external_id)
);

-- 5. Integration log (event log for all sync operations)
CREATE TABLE IF NOT EXISTS integration_log (
    id            SERIAL PRIMARY KEY,
    event_id      UUID UNIQUE,
    direction     VARCHAR(30) NOT NULL,
    entity_type   VARCHAR(20) NOT NULL,
    entity_id     VARCHAR(50),
    action        VARCHAR(30) NOT NULL,
    payload       JSONB,
    status        VARCHAR(20) DEFAULT 'pending',
    error_message TEXT,
    retry_count   INTEGER DEFAULT 0,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integration_log_event_id ON integration_log(event_id);
CREATE INDEX IF NOT EXISTS idx_integration_log_status ON integration_log(status) WHERE status IN ('error', 'failed');
CREATE INDEX IF NOT EXISTS idx_integration_log_created ON integration_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_buildings_external_id ON buildings(external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_buildings_uk_deleted ON buildings(uk_deleted_at) WHERE uk_deleted_at IS NOT NULL;
