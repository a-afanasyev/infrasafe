# ИНДЕКС ДОКУМЕНТАЦИИ InfraSafe

> Последнее обновление: март 2026

---

## Быстрый старт

Основные документы (в корне проекта):

- **[README.md](../README.md)** — основная документация проекта
- **[QUICK-START.md](../QUICK-START.md)** — быстрый запуск
- **[LICENSE-GUIDE.md](../LICENSE-GUIDE.md)** — руководство по лицензированию
- **[CLAUDE.md](../CLAUDE.md)** — контекст для Claude Code

---

## СТРУКТУРА ДОКУМЕНТАЦИИ

### Технические документы (docs/)

#### API и Backend
- **[API_AUTH_MATRIX.md](API_AUTH_MATRIX.md)** — матрица авторизации API (default-deny, PUBLIC_ROUTES allowlist)
- **[API_TESTING.md](API_TESTING.md)** — руководство по тестированию API
- **[POWER-ANALYTICS-API.md](POWER-ANALYTICS-API.md)** — API аналитики электросетей (5 эндпоинтов)
- **[POWER_ANALYTICS_IMPLEMENTATION.md](POWER_ANALYTICS_IMPLEMENTATION.md)** — реализация аналитики энергопотребления
- **[SWAGGER_TEST_COMMANDS.md](SWAGGER_TEST_COMMANDS.md)** — команды для тестирования через Swagger
- **[analytics.md](analytics.md)** — система аналитики
- **[ARCHITECTURE_ANALYSIS.md](ARCHITECTURE_ANALYSIS.md)** — анализ архитектуры

#### Docker и развертывание
- **[DEVELOPMENT_DOCKER_GUIDE.md](DEVELOPMENT_DOCKER_GUIDE.md)** — Docker для разработки
- **[PRODUCTION-DEPLOYMENT.md](PRODUCTION-DEPLOYMENT.md)** — production-развертывание
- **[PRODUCTION_SETUP.md](PRODUCTION_SETUP.md)** — настройка production
- **[NGINX-DOCKER-SETUP.md](NGINX-DOCKER-SETUP.md)** — настройка Nginx в Docker
- **[NGINX-PRODUCTION-REVIEW.md](NGINX-PRODUCTION-REVIEW.md)** — ревью production-конфигурации Nginx
- **[SSL-TROUBLESHOOTING.md](SSL-TROUBLESHOOTING.md)** — устранение проблем SSL/TLS

#### Генератор
- **[GENERATOR.md](GENERATOR.md)** — руководство по генератору метрик

#### Паттерны
- **[systemPatterns.md](systemPatterns.md)** — архитектурные паттерны (Service Layer, Circuit Breaker, JWT, Caching)

#### Бизнес
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

- **[TECHNICAL_SPECIFICATION.md](refactor/TECHNICAL_SPECIFICATION.md)** — техническая спецификация (наиболее полный и актуальный документ)
- **[2026-03-09-ARCHITECTURAL-ANALYSIS.md](refactor/2026-03-09-ARCHITECTURAL-ANALYSIS.md)** — архитектурный анализ (март 2026)
- **[2026-03-09-IMPLEMENTATION-PLAN.md](refactor/2026-03-09-IMPLEMENTATION-PLAN.md)** — план реализации рефакторинга
- **[AUDIT-REPORT-2026-03-06.md](refactor/AUDIT-REPORT-2026-03-06.md)** — аудит-отчёт (P0-P3 issues)
- **[ARCHITECTURE_REVIEW.md](refactor/ARCHITECTURE_REVIEW.md)** — ревью архитектуры
- **[REFACTORING_PLAN.md](refactor/REFACTORING_PLAN.md)** — план рефакторинга (8 спринтов)

### Внутренние документы (docs/internal/)

- **[progress.md](internal/progress.md)** — прогресс разработки
- **[tasks.md](internal/tasks.md)** — список задач

### Архив (docs/archive/)

~118 файлов: старые отчёты, завершённые задачи, устаревшие планы и анализы.

---

## БЫСТРЫЙ ПОИСК

**Безопасность:**
[API_AUTH_MATRIX.md](API_AUTH_MATRIX.md) | [SECURITY-STATUS.md](production/SECURITY-STATUS.md) | [SECURITY-FIXES-REPORT.md](production/SECURITY-FIXES-REPORT.md)

**Production:**
[PRODUCTION-READINESS.md](production/PRODUCTION-READINESS.md) | [PRODUCTION-DEPLOYMENT.md](PRODUCTION-DEPLOYMENT.md)

**Docker:**
[DEVELOPMENT_DOCKER_GUIDE.md](DEVELOPMENT_DOCKER_GUIDE.md) | [NGINX-DOCKER-SETUP.md](NGINX-DOCKER-SETUP.md)

**API:**
[API_AUTH_MATRIX.md](API_AUTH_MATRIX.md) | [POWER-ANALYTICS-API.md](POWER-ANALYTICS-API.md) | Swagger UI: http://localhost:8080/api-docs

**Архитектура:**
[TECHNICAL_SPECIFICATION.md](refactor/TECHNICAL_SPECIFICATION.md) | [ARCHITECTURE_ANALYSIS.md](ARCHITECTURE_ANALYSIS.md) | [systemPatterns.md](systemPatterns.md)

---

## КАК ИСПОЛЬЗОВАТЬ

1. **Новичкам:** [README.md](../README.md) -> [QUICK-START.md](../QUICK-START.md)
2. **Разработчикам:** [TECHNICAL_SPECIFICATION.md](refactor/TECHNICAL_SPECIFICATION.md) -> [API_AUTH_MATRIX.md](API_AUTH_MATRIX.md)
3. **DevOps:** [DEVELOPMENT_DOCKER_GUIDE.md](DEVELOPMENT_DOCKER_GUIDE.md) -> [PRODUCTION-DEPLOYMENT.md](PRODUCTION-DEPLOYMENT.md)
4. **Security:** [SECURITY-STATUS.md](production/SECURITY-STATUS.md) -> [SECURITY-FIXES-REPORT.md](production/SECURITY-FIXES-REPORT.md)
