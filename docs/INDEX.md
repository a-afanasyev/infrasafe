# ИНДЕКС ДОКУМЕНТАЦИИ InfraSafe

> Последнее обновление: 2026-04-17

---

## Быстрый старт

Основные документы (в корне проекта):

- **[README.md](../README.md)** — основная документация проекта
- **[QUICK-START.md](../QUICK-START.md)** — быстрый запуск
- **[LICENSE-GUIDE.md](../LICENSE-GUIDE.md)** — руководство по лицензированию
- **[CLAUDE.md](../CLAUDE.md)** — контекст для Claude Code (актуален, обновлён 2026-04-17)

---

## СТРУКТУРА ДОКУМЕНТАЦИИ

### Источник правды и обзорные документы

- **[SOT.md](SOT.md)** — Single Source of Truth (896 строк): архитектура, API-матрица, деплой, тех-стек
- **[audit-implementation-plan.md](audit-implementation-plan.md)** — Phase-based план рефакторинга/аудита (12 фаз, P0-P3)
- **[audit-report-2026-04-17.md](audit-report-2026-04-17.md)** — последний quality-аудит (62 findings)
- **[universal-code-audit.md](universal-code-audit.md)** — методология code-аудита
- **[ARCHITECTURE_ANALYSIS.md](ARCHITECTURE_ANALYSIS.md)** — анализ архитектуры
- **[systemPatterns.md](systemPatterns.md)** — архитектурные паттерны (Service Layer, Circuit Breaker, JWT, Caching, EventBus, CRUD Factory, AccountLockout, Bundler)
- **[COMBINED_PROJECT_CONTEXT.md](COMBINED_PROJECT_CONTEXT.md)** — сводный контекст InfraSafe + UK Management

### API и Backend

- **[API_AUTH_MATRIX.md](API_AUTH_MATRIX.md)** — матрица авторизации API (default-deny, PUBLIC_ROUTES allowlist)
- **[API_TESTING.md](API_TESTING.md)** — руководство по тестированию API
- **[POWER-ANALYTICS-API.md](POWER-ANALYTICS-API.md)** — API аналитики электросетей
- **[POWER_ANALYTICS_IMPLEMENTATION.md](POWER_ANALYTICS_IMPLEMENTATION.md)** — реализация power-аналитики
- **[SWAGGER_TEST_COMMANDS.md](SWAGGER_TEST_COMMANDS.md)** — команды для тестирования через Swagger
- **[analytics.md](analytics.md)** — система аналитики
- Swagger UI (только dev): http://localhost:8088/api-docs

### База данных

- **[../database/migrations/README.md](../database/migrations/README.md)** — индекс всех миграций (003-015) с назначением и статусом
- **[MAP_LAYERS_GUIDE.md](MAP_LAYERS_GUIDE.md)** — руководство по слоям карты (entity-релевантно)

### Docker и развертывание

- **[DEVELOPMENT_DOCKER_GUIDE.md](DEVELOPMENT_DOCKER_GUIDE.md)** — Docker для разработки
- **[PRODUCTION-DEPLOYMENT.md](PRODUCTION-DEPLOYMENT.md)** — production-развертывание
- **[PRODUCTION_SETUP.md](PRODUCTION_SETUP.md)** — настройка production
- **[NGINX-DOCKER-SETUP.md](NGINX-DOCKER-SETUP.md)** — настройка Nginx в Docker
- **[NGINX-PRODUCTION-REVIEW.md](NGINX-PRODUCTION-REVIEW.md)** — ревью production-конфигурации Nginx
- **[SSL-TROUBLESHOOTING.md](SSL-TROUBLESHOOTING.md)** — устранение проблем SSL/TLS

### Операционные рунбуки

- **[runbook-12A-jwt-rotation-and-history-scrub.md](runbook-12A-jwt-rotation-and-history-scrub.md)** — ротация JWT секретов + scrubbing git history (требует действий владельца)

### Генератор данных

- **[GENERATOR.md](GENERATOR.md)** — руководство по генератору тестовых метрик

### Бизнес

- **[COMMERCIAL-PROPOSAL-TEMPLATE.md](COMMERCIAL-PROPOSAL-TEMPLATE.md)** — шаблон коммерческого предложения

### Production (docs/production/)

- **[PRODUCTION-READINESS.md](production/PRODUCTION-READINESS.md)** — чеклист готовности к production
- **[PRODUCTION-STATUS.md](production/PRODUCTION-STATUS.md)** — краткий статус готовности
- **[PUBLICATION-AUDIT-2025-11-22.md](production/PUBLICATION-AUDIT-2025-11-22.md)** — аудит публикации
- **[SECURITY-STATUS.md](production/SECURITY-STATUS.md)** — статус безопасности
- **[SECURITY-FIXES-REPORT.md](production/SECURITY-FIXES-REPORT.md)** — отчёт по исправлениям безопасности
- **[SECURITY-FIXES-PLAN.md](production/SECURITY-FIXES-PLAN.md)** — план исправлений безопасности
- **[SECURITY-AUDIT-FRONTEND.md](production/SECURITY-AUDIT-FRONTEND.md)** — аудит безопасности фронтенда

### Рефакторинг (docs/refactor/)

- **[TECHNICAL_SPECIFICATION.md](refactor/TECHNICAL_SPECIFICATION.md)** — техническая спецификация
- **[2026-03-09-ARCHITECTURAL-ANALYSIS.md](refactor/2026-03-09-ARCHITECTURAL-ANALYSIS.md)** — архитектурный анализ (март 2026)
- **[2026-03-09-IMPLEMENTATION-PLAN.md](refactor/2026-03-09-IMPLEMENTATION-PLAN.md)** — план реализации рефакторинга
- **[AUDIT-REPORT-2026-03-06.md](refactor/AUDIT-REPORT-2026-03-06.md)** — аудит-отчёт (P0-P3 issues)
- **[ARCHITECTURE_REVIEW.md](refactor/ARCHITECTURE_REVIEW.md)** — ревью архитектуры
- **[REFACTORING_PLAN.md](refactor/REFACTORING_PLAN.md)** — план рефакторинга (8 спринтов)

### Планы и спецификации (docs/superpowers/)

Каталог `docs/superpowers/plans/` и `docs/superpowers/specs/` содержит детальные планы конкретных фич и архитектурных решений (март–апрель 2026). Обновляется во время сессий Claude Code. Смотреть через `ls docs/superpowers/plans/`.

Ключевые спеки:
- **`specs/2026-03-24-infrasafe-uk-integration-v2-design.md`** — дизайн UK интеграции (5 фаз, все merged)
- **`plans/2026-04-12-uk-integration-connectivity.md`** — план проверки связности

### Внутренние документы (docs/internal/)

- **[progress.md](internal/progress.md)** — прогресс разработки
- **[tasks.md](internal/tasks.md)** — список задач

### Архив (docs/archive/)

~120 файлов: старые отчёты, завершённые задачи, устаревшие планы и анализы. Включает audit-report-2026-04-13 v1/v2 (заменены снимком 2026-04-17).

---

## БЫСТРЫЙ ПОИСК

**Безопасность:**
[API_AUTH_MATRIX.md](API_AUTH_MATRIX.md) | [SECURITY-STATUS.md](production/SECURITY-STATUS.md) | [SECURITY-FIXES-REPORT.md](production/SECURITY-FIXES-REPORT.md) | [runbook-12A-jwt-rotation-and-history-scrub.md](runbook-12A-jwt-rotation-and-history-scrub.md)

**Production:**
[PRODUCTION-READINESS.md](production/PRODUCTION-READINESS.md) | [PRODUCTION-DEPLOYMENT.md](PRODUCTION-DEPLOYMENT.md)

**Docker:**
[DEVELOPMENT_DOCKER_GUIDE.md](DEVELOPMENT_DOCKER_GUIDE.md) | [NGINX-DOCKER-SETUP.md](NGINX-DOCKER-SETUP.md)

**API:**
[API_AUTH_MATRIX.md](API_AUTH_MATRIX.md) | [POWER-ANALYTICS-API.md](POWER-ANALYTICS-API.md) | Swagger UI: http://localhost:8088/api-docs

**Архитектура:**
[SOT.md](SOT.md) | [ARCHITECTURE_ANALYSIS.md](ARCHITECTURE_ANALYSIS.md) | [systemPatterns.md](systemPatterns.md) | [refactor/TECHNICAL_SPECIFICATION.md](refactor/TECHNICAL_SPECIFICATION.md)

**Аудит и планы:**
[audit-report-2026-04-17.md](audit-report-2026-04-17.md) | [audit-implementation-plan.md](audit-implementation-plan.md)

**База данных:**
[../database/migrations/README.md](../database/migrations/README.md) | [SOT.md](SOT.md)

---

## КАК ИСПОЛЬЗОВАТЬ

1. **Новичкам:** [README.md](../README.md) → [QUICK-START.md](../QUICK-START.md) → [CLAUDE.md](../CLAUDE.md)
2. **Разработчикам:** [SOT.md](SOT.md) → [API_AUTH_MATRIX.md](API_AUTH_MATRIX.md) → [systemPatterns.md](systemPatterns.md)
3. **DevOps:** [DEVELOPMENT_DOCKER_GUIDE.md](DEVELOPMENT_DOCKER_GUIDE.md) → [PRODUCTION-DEPLOYMENT.md](PRODUCTION-DEPLOYMENT.md) → [runbook-12A-jwt-rotation-and-history-scrub.md](runbook-12A-jwt-rotation-and-history-scrub.md)
4. **Security:** [SECURITY-STATUS.md](production/SECURITY-STATUS.md) → [audit-report-2026-04-17.md](audit-report-2026-04-17.md)
5. **Рефакторинг:** [audit-implementation-plan.md](audit-implementation-plan.md) → [refactor/REFACTORING_PLAN.md](refactor/REFACTORING_PLAN.md)
