# 🚀 Production Setup для InfraSafe

## Обзор

Это руководство описывает настройку InfraSafe для Production развертывания с акцентом на безопасность и производительность.

## ⚠️ Критичные требования безопасности

### 1. JWT Секреты (ОБЯЗАТЕЛЬНО)

```bash
# Генерация безопасных 512-битных секретов
openssl rand -base64 64  # JWT_SECRET
openssl rand -base64 64  # JWT_REFRESH_SECRET
```

### 2. Создание .env.prod

```bash
# Создайте .env.prod файл в корне проекта
touch .env.prod
chmod 600 .env.prod  # Ограничить доступ только владельцу
```

**Содержимое .env.prod:**
```env
# ==========================================
# PRODUCTION CONFIGURATION
# ==========================================
NODE_ENV=production
PORT=3000

# DATABASE
DB_HOST=postgres
DB_PORT=5432
DB_NAME=infrasafe
DB_USER=postgres
DB_PASSWORD=СМЕНИТЬ_НА_БЕЗОПАСНЫЙ_ПАРОЛЬ

# JWT SECURITY (КРИТИЧНО!)
JWT_SECRET=ВСТАВИТЬ_СГЕНЕРИРОВАННЫЙ_512БИТ_СЕКРЕТ
JWT_REFRESH_SECRET=ВСТАВИТЬ_ДРУГОЙ_512БИТ_СЕКРЕТ
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# CORS (укажите ваши домены)
CORS_ORIGIN=https://yourdomain.com,https://www.yourdomain.com

# SECURITY
HELMET_CSP_ENABLED=true
SWAGGER_ENABLED=false
SECURE_COOKIES=true
TRUST_PROXY=true

# LOGGING
LOG_LEVEL=info
LOG_FILE=logs/app.log
```

## 🛡️ Checklist безопасности

### До развертывания:

- [ ] ✅ .env.prod создан с безопасными секретами
- [ ] ✅ .env.prod добавлен в .gitignore  
- [ ] ✅ DB_PASSWORD заменен на безопасный
- [ ] ✅ CORS_ORIGIN настроен на ваши домены
- [ ] ✅ SWAGGER_ENABLED=false для Production
- [ ] ✅ JWT секреты имеют 512-bit (64+ символов base64)

### После развертывания:

- [ ] JWT аутентификация работает
- [ ] API endpoints защищены
- [ ] HTTPS настроен
- [ ] Логи записываются
- [ ] Мониторинг работает

## 🚀 Развертывание

### 1. Подготовка

```bash
# Клонирование репозитория
git clone <repository-url>
cd infrasafe

# Создание .env.prod (см. выше)
# ВАЖНО: НЕ коммитьте .env.prod в git!
```

### 2. Запуск Production

```bash
# Запуск с production конфигурацией
docker compose -f docker-compose.prod.yml up -d

# Проверка статуса
docker compose -f docker-compose.prod.yml ps

# Просмотр логов
docker compose -f docker-compose.prod.yml logs -f
```

### 3. Проверка работоспособности

```bash
# Health Check
curl http://localhost:3000/health

# Проверка JWT аутентификации
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Admin123"}'

# Проверка защищенного endpoint
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  http://localhost:3000/api/buildings
```

## 📊 Мониторинг

### Основные метрики для отслеживания:

1. **JWT Security:**
   - Количество неудачных попыток аутентификации
   - Время жизни токенов
   - Частота refresh операций

2. **API Performance:**
   - Время ответа endpoints
   - Количество запросов в секунду
   - Ошибки 4xx/5xx

3. **Database:**
   - Подключения к БД
   - Время выполнения запросов
   - Размер БД и индексов

### Логи для мониторинга:

```bash
# JWT аутентификация
docker compose logs backend | grep "JWT\|auth"

# API ошибки
docker compose logs backend | grep "ERROR\|error"

# Database подключения
docker compose logs postgres | grep "connection"
```

## 🔄 Backup и восстановление

### Database Backup

```bash
# Создание backup
docker compose exec postgres pg_dump -U postgres infrasafe > backup.sql

# Восстановление
docker compose exec -T postgres psql -U postgres infrasafe < backup.sql
```

### .env.prod Backup

```bash
# ВАЖНО: Сделайте secure backup .env.prod файла
# НЕ храните в открытом виде!
cp .env.prod .env.prod.backup.$(date +%Y%m%d)
```

## 🆘 Troubleshooting

### JWT проблемы

**Ошибка:** "Invalid JWT token"
```bash
# Проверьте что JWT_SECRET правильный
docker compose exec backend printenv JWT_SECRET

# Проверьте время жизни токена
# Access token: 15 минут, Refresh: 7 дней
```

**Ошибка:** "JWT secret not found"
```bash
# Убедитесь что .env.prod загружен
docker compose config | grep JWT
```

### Database подключение

**Ошибка:** "Database connection failed"
```bash
# Проверьте статус PostgreSQL
docker compose ps postgres

# Проверьте логи БД
docker compose logs postgres

# Тест подключения
docker compose exec postgres psql -U postgres -d infrasafe -c "SELECT 1;"
```

### CORS проблемы

**Ошибка:** "CORS policy error"
```bash
# Обновите CORS_ORIGIN в .env.prod
CORS_ORIGIN=https://yourdomain.com,https://api.yourdomain.com
```

## 🔒 Дополнительная безопасность

### 1. SSL/TLS

```bash
# Настройте HTTPS через reverse proxy (Nginx/Cloudflare)
# Обновите .env.prod:
SECURE_COOKIES=true
TRUST_PROXY=true
```

### 2. Rate Limiting

```bash
# Настройте в .env.prod:
RATE_LIMIT_WINDOW_MS=900000  # 15 минут
RATE_LIMIT_MAX_REQUESTS=100  # 100 запросов на IP
```

### 3. Firewall

```bash
# Откройте только необходимые порты:
# 80 (HTTP redirect)
# 443 (HTTPS)
# 22 (SSH admin)
```

## 📞 Поддержка

При проблемах с Production развертыванием:

1. Проверьте логи: `docker compose logs`
2. Проверьте health endpoint: `/health`  
3. Убедитесь что .env.prod настроен правильно
4. Обратитесь к команде разработки

---

**Статус документа:** Обновлен для JWT конфигурации ✅  
**Последнее обновление:** Сентябрь 2024  
**Версия:** 2.0














