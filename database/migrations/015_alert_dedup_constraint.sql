-- Migration 015 — partial UNIQUE index for active alert deduplication
-- Phase 4.1 (ARCH-106).
--
-- Problem: alertService.createAlert checks an in-memory activeAlerts Map
-- before inserting. Two concurrent requests can both pass that check and
-- insert duplicate active alerts for the same (infrastructure_type,
-- infrastructure_id, type). Under horizontal scale-out the Map isn't even
-- shared between instances, so the dedup is effectively absent.
--
-- Fix: a PARTIAL UNIQUE INDEX scoped to WHERE status = 'active'. Only one
-- active alert per (type, infra_type, infra_id) can exist at a time;
-- resolved/acknowledged history is unaffected (and unbounded, as intended).
--
-- The service layer catches the PostgreSQL error 23505 and returns null
-- so the callers treat it as a suppressed duplicate rather than an error.
--
-- Existing duplicate active rows must be resolved manually before applying
-- this migration (see commit note for the one-shot cleanup query).

CREATE UNIQUE INDEX IF NOT EXISTS idx_active_alert_dedup
    ON infrastructure_alerts (infrastructure_type, infrastructure_id, type)
    WHERE status = 'active';

COMMENT ON INDEX idx_active_alert_dedup IS
    'Phase 4.1 / ARCH-106: DB-level dedup for active alerts (partial UNIQUE).';
