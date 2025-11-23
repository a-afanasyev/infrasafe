# 🔒 Решение проблем SSL/HTTPS

## Ошибка ERR_SSL_PROTOCOL_ERROR

Эта ошибка означает, что браузер не может установить безопасное соединение с сервером.

### Возможные причины:

1. **SSL сертификаты не монтируются в контейнер**
2. **Сертификаты не существуют на хосте**
3. **Неправильные пути к сертификатам в конфигурации**
4. **Сертификат выдан для другого домена**
5. **Nginx не может прочитать файлы сертификатов**

## 🔍 Диагностика

### 1. Проверка существования сертификатов на хосте:

```bash
# Проверка наличия сертификатов
ls -la /etc/letsencrypt/live/infrasafe.aisolutions.uz/

# Должны быть файлы:
# - fullchain.pem
# - privkey.pem
# - chain.pem
```

### 2. Проверка прав доступа:

```bash
# Сертификаты должны быть читаемыми
ls -l /etc/letsencrypt/live/infrasafe.aisolutions.uz/fullchain.pem
ls -l /etc/letsencrypt/live/infrasafe.aisolutions.uz/privkey.pem
ls -l /etc/letsencrypt/live/infrasafe.aisolutions.uz/chain.pem
```

### 3. Проверка логов Nginx контейнера:

```bash
# Просмотр логов Nginx
docker compose -f docker-compose.unified.yml logs nginx

# Поиск ошибок SSL
docker compose -f docker-compose.unified.yml logs nginx | grep -i ssl
docker compose -f docker-compose.unified.yml logs nginx | grep -i certificate
```

### 4. Проверка конфигурации внутри контейнера:

```bash
# Войти в контейнер
docker compose -f docker-compose.unified.yml exec nginx sh

# Проверить наличие файлов
ls -la /etc/nginx/ssl/

# Проверить синтаксис конфигурации
nginx -t
```

## 🛠️ Решения

### Решение 1: Проверить монтирование сертификатов

Убедитесь, что в `docker-compose.unified.yml` правильно указан путь:

```yaml
volumes:
  - /etc/letsencrypt/live/infrasafe.aisolutions.uz:/etc/nginx/ssl:ro
```

### Решение 2: Создать сертификаты, если их нет

Если сертификаты не существуют, создайте их через certbot:

```bash
# Установка certbot (если не установлен)
sudo apt-get update
sudo apt-get install certbot

# Создание сертификата для домена
sudo certbot certonly --standalone -d infrasafe.aisolutions.uz -d www.infrasafe.uz

# Или если домен www.infrasafe.uz отличается
sudo certbot certonly --standalone -d www.infrasafe.uz
```

### Решение 3: Исправить пути в конфигурации

Если сертификаты находятся в другом месте, обновите `nginx.production.conf`:

```nginx
ssl_certificate /etc/nginx/ssl/fullchain.pem;
ssl_certificate_key /etc/nginx/ssl/privkey.pem;
ssl_trusted_certificate /etc/nginx/ssl/chain.pem;
```

### Решение 4: Временно отключить SSL для тестирования

Если нужно быстро проверить работу без SSL, можно временно изменить конфигурацию:

```nginx
# Временно закомментируйте SSL блоки
# listen 443 ssl http2;
listen 80;
# ssl_certificate ...
```

**⚠️ ВНИМАНИЕ:** Это только для тестирования! Не используйте в production!

### Решение 5: Проверить домен в сертификате

Убедитесь, что сертификат выдан для правильного домена:

```bash
# Проверка домена в сертификате
openssl x509 -in /etc/letsencrypt/live/infrasafe.aisolutions.uz/fullchain.pem -text -noout | grep -A 2 "Subject Alternative Name"
```

Если сертификат для `infrasafe.aisolutions.uz`, а сайт открывается через `www.infrasafe.uz`, нужно:
- Либо получить сертификат для `www.infrasafe.uz`
- Либо добавить оба домена в один сертификат
- Либо настроить редирект с www на основной домен

## 🔧 Быстрая проверка

```bash
# 1. Проверить статус контейнера
docker compose -f docker-compose.unified.yml ps nginx

# 2. Проверить логи
docker compose -f docker-compose.unified.yml logs --tail=50 nginx

# 3. Проверить конфигурацию
docker compose -f docker-compose.unified.yml exec nginx nginx -t

# 4. Проверить доступность портов
netstat -tlnp | grep -E ':(80|443)'

# 5. Проверить SSL соединение
openssl s_client -connect www.infrasafe.uz:443 -servername www.infrasafe.uz
```

## 📝 Важные замечания

1. **Домен в сертификате должен совпадать с доменом сайта**
   - Если сайт: `www.infrasafe.uz` → сертификат должен быть для `www.infrasafe.uz`
   - Если сайт: `infrasafe.aisolutions.uz` → сертификат должен быть для `infrasafe.aisolutions.uz`

2. **Права доступа к сертификатам:**
   - Файлы должны быть читаемыми для пользователя, под которым работает Nginx
   - Обычно это `root` или `nginx`

3. **Обновление сертификатов:**
   - Let's Encrypt сертификаты действительны 90 дней
   - Настройте автоматическое обновление через cron

## 🚨 Критические проверки

- [ ] Сертификаты существуют на хосте
- [ ] Пути к сертификатам правильные в docker-compose
- [ ] Домен в сертификате совпадает с доменом сайта
- [ ] Nginx может прочитать файлы сертификатов
- [ ] Порт 443 открыт в firewall
- [ ] Конфигурация Nginx синтаксически правильная

