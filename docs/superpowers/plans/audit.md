Проведи полный аудит проекта. Цель — понять текущее состояние дел и готовность к production deployment. Действуй по секциям, каждую выполняй тщательно.

## 1. Структура и архитектура

- Прочитай README, CLAUDE.md, docker-compose*, Makefile, package.json (или аналог)
- Определи: язык, фреймворк, архитектуру (монолит/микросервисы/модульный), точку входа
- Построй карту сервисов/модулей: что от чего зависит
- Найди все .env*, .env.example — какие переменные нужны для запуска
- Есть ли docker-compose для dev и prod отдельно

## 2. Кодовая база

- Общий объём: файлы, строки кода (cloc или аналог)
- Структура директорий (2 уровня)
- Наличие мёртвого кода: неиспользуемые файлы, закомментированные блоки, TODO/FIXME/HACK
```bash
  grep -rn "TODO\|FIXME\|HACK\|XXX\|DEPRECATED" --include='*.py' --include='*.ts' --include='*.js' --include='*.go' . | grep -v node_modules | grep -v .git
```
- Хардкоженные секреты, ключи, пароли, DSN в коде (НЕ в .env):
```bash
  grep -rn "password\|secret\|api_key\|token\|dsn" --include='*.py' --include='*.ts' --include='*.js' --include='*.go' . | grep -v node_modules | grep -v .git | grep -v .env | grep -v test | head -30
```

## 3. Зависимости

- Список зависимостей и их версии
- Есть ли lock-файл (package-lock, poetry.lock, go.sum, etc.)
- Устаревшие зависимости (npm outdated / pip list --outdated / аналог)
- Известные уязвимости (npm audit / pip-audit / govulncheck / аналог)

## 4. Тесты

- Тестовый фреймворк, количество тестов
- Запусти тесты — сколько pass/fail/skip
- Покрытие по директориям (если настроен coverage)
- Есть ли E2E тесты, интеграционные тесты
- Есть ли CI pipeline (GitHub Actions, GitLab CI, etc.) — что он делает

## 5. База данных

- Какая БД используется
- Есть ли миграции, ORM
- Состояние миграций: все применены? Есть pending?
- Есть ли seed/fixture данные
- Бэкапы: настроены ли, как восстанавливать

## 6. Инфраструктура и деплой

- Docker: есть ли Dockerfile, docker-compose, multi-stage build
- Dockerfile quality: размер образа, кеширование слоёв, non-root user, health checks
- Есть ли оркестрация (k8s manifests, helm charts, terraform)
- CI/CD pipeline: что настроено, что автоматизировано
- Мониторинг: логирование (structured?), health endpoints, метрики, алерты
- Есть ли graceful shutdown, restart policy

## 7. Безопасность

- Аутентификация/авторизация: как реализована
- Секреты: как хранятся и передаются (.env, vault, secrets manager)
- CORS, CSP, rate limiting — настроены ли
- Input validation: есть ли на всех входных точках (API, формы, webhooks)
- SQL injection, XSS, CSRF — есть ли защита
- TLS: настроен ли для production
- Зависимости: результат аудита уязвимостей (из пункта 3)

## 8. Документация

- README: достаточный ли для нового разработчика
- API документация (Swagger, OpenAPI, docstrings)
- Архитектурные решения (ADR)
- Инструкция деплоя
- Runbook для типичных инцидентов

## 9. Конфигурация и окружения

- Как различаются dev/staging/prod
- Feature flags: есть ли
- Логирование: уровни по окружениям
- Переменные: все ли задокументированы в .env.example

## 10. Готовность к production — чеклист

По результатам аудита заполни чеклист (✅ готово / ⚠️ частично / ❌ не готово / ➖ не применимо):

Код
[ ] Нет хардкоженных секретов в коде
[ ] Нет критичных TODO/FIXME
[ ] Нет мёртвого кода
[ ] TypeScript strict / mypy strict / аналог
Тесты
[ ] Тесты проходят (0 failures)
[ ] Покрытие ≥ 80% (или обоснованное исключение)
[ ] E2E тесты на критические сценарии
Зависимости
[ ] Lock-файл актуален
[ ] Нет known vulnerabilities (critical/high)
[ ] Нет сильно устаревших зависимостей
Инфраструктура
[ ] Dockerfile production-ready (multi-stage, non-root, health check)
[ ] docker-compose для prod
[ ] CI/CD pipeline настроен
[ ] Health check endpoint
[ ] Graceful shutdown
[ ] Restart policy
Безопасность
[ ] TLS настроен
[ ] Auth/authz реализованы
[ ] Input validation на всех входах
[ ] Rate limiting
[ ] Секреты через env/vault, не в коде
[ ] CORS настроен корректно
Мониторинг
[ ] Structured logging
[ ] Error tracking (Sentry или аналог)
[ ] Метрики / health dashboard
[ ] Алерты на критичные события
Документация
[ ] README с инструкцией запуска
[ ] .env.example с описанием переменных
[ ] Инструкция деплоя
[ ] API документация
Данные
[ ] Миграции актуальны
[ ] Бэкапы настроены
[ ] Seed данные для staging

## Формат отчёта

Сохрани результат в `project-audit.md` в корне проекта. Структура:

1. **Executive Summary** — 5-7 предложений: что за проект, в каком состоянии, главные риски, можно ли деплоить
2. **Метрики** — таблица: файлы, строки, тесты, покрытие, уязвимости, TODO count
3. **Секции 1-9** — результаты по каждой секции
4. **Production Readiness Checklist** — чеклист с секции 10
5. **Блокеры деплоя** — что НУЖНО исправить перед production (CRITICAL)
6. **Рекомендации** — что ЖЕЛАТЕЛЬНО исправить (HIGH/MEDIUM)
7. **Tech Debt** — что можно отложить но стоит запланировать

ВАЖНО:
- Только анализ, ничего не меняй в коде
- Будь конкретным: не "есть проблемы с безопасностью", а "файл X строка Y содержит хардкоженный API ключ"
- Если что-то не можешь проверить (например нет доступа к prod) — отметь явно