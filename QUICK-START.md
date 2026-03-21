# QUICK START - InfraSafe

## Быстрый запуск

### Основное приложение
```bash
docker compose -f docker-compose.dev.yml up --build -d
open http://localhost:8080
```

### Генератор метрик (опционально)
```bash
docker compose -f docker-compose.generator.yml up -d
open http://localhost:8081
```

---

## URLs

| Сервис | URL | Логин/Пароль |
|--------|-----|--------------|
| Карта | http://localhost:8080/ | - |
| Админка | http://localhost:8080/admin.html | admin / admin123 |
| Swagger UI | http://localhost:8080/api-docs | - |
| API | http://localhost:3000/api | - |
| Health Check | http://localhost:3000/health | - |
| Генератор | http://localhost:8081 | - |
| PostgreSQL | localhost:5435 | postgres / postgres |

---

## Тестирование

```bash
npm test                  # Все 175 тестов
npm run test:unit         # Unit-тесты
npm run test:security     # Тесты безопасности
npm run test:coverage     # С отчётом покрытия
```

---

## Полезные команды

```bash
# Логи
docker compose -f docker-compose.dev.yml logs -f app
docker compose -f docker-compose.dev.yml logs -f postgres

# Health check
curl http://localhost:3000/health

# БД
psql postgresql://postgres:postgres@localhost:5435/infrasafe

# Остановка
docker compose -f docker-compose.dev.yml down

# Остановка с удалением данных
docker compose -f docker-compose.dev.yml down -v
```

---

## Документация

| Документ | Описание |
|----------|----------|
| [README.md](README.md) | Основная документация |
| [docs/API_AUTH_MATRIX.md](docs/API_AUTH_MATRIX.md) | Матрица авторизации API |
| [docs/POWER-ANALYTICS-API.md](docs/POWER-ANALYTICS-API.md) | API аналитики электросетей |
| [docs/GENERATOR.md](docs/GENERATOR.md) | Руководство генератора метрик |
| [docs/DEVELOPMENT_DOCKER_GUIDE.md](docs/DEVELOPMENT_DOCKER_GUIDE.md) | Docker для разработки |
| Swagger UI | http://localhost:8080/api-docs |
