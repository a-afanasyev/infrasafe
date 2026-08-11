# 📁 Nginx Docker Configuration

Эта директория содержит конфигурацию Nginx для production развертывания InfraSafe.

## 📋 Структура

```
~/nginx-docker/
├── nginx.production.conf  # Основная конфигурация Nginx
└── README.md              # Этот файл
```

## 🔧 Использование

Конфигурация автоматически монтируется в Docker контейнер при запуске:

```bash
docker compose -f docker-compose.unified.yml up -d nginx
```

## 📝 Файлы

### nginx.production.conf

Production конфигурация Nginx с:
- SSL/TLS настройками
- Проксированием к backend (app:3000)
- CORS настройками
- Заголовками безопасности
- Gzip сжатием
- Кэшированием статики

## 🔄 Обновление конфигурации

1. Отредактируйте `nginx.production.conf`
2. Проверьте синтаксис:
   ```bash
   docker compose -f docker-compose.unified.yml exec nginx nginx -t
   ```
3. Перезагрузите Nginx:
   ```bash
   docker compose -f docker-compose.unified.yml exec nginx nginx -s reload
   ```

## ⚠️ Важно

- Конфигурация монтируется как read-only (`:ro`)
- После изменения конфигурации нужно перезагрузить контейнер или выполнить `nginx -s reload`
- SSL сертификаты должны быть в `/etc/letsencrypt/live/infrasafe.aisolutions.uz/`

## 🔍 Проверка конфигурации

```bash
# Проверка синтаксиса
docker compose -f docker-compose.unified.yml exec nginx nginx -t

# Просмотр логов
docker compose -f docker-compose.unified.yml logs -f nginx

# Проверка статуса
docker compose -f docker-compose.unified.yml ps nginx
```

