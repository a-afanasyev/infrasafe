# 🔧 Настройка Nginx Docker контейнера

## 📁 Расположение конфигурации

Конфигурация Nginx должна находиться в директории `~/nginx-docker/` на хосте.

### Структура:
```
~/nginx-docker/
├── nginx.production.conf  # Основная конфигурация
└── README.md              # Документация
```

## ⚠️ Решение проблемы монтирования

Если возникает ошибка:
```
error mounting "/home/infrasafe/nginx-docker/nginx.production.conf" to rootfs
```

### Причины:
1. Файл не существует по указанному пути
2. Docker не может разрешить путь с `~`
3. Неправильные права доступа

### Решения:

#### Вариант 1: Использовать переменную окружения (рекомендуется)
В `docker-compose.unified.yml` используется `${HOME}/nginx-docker/nginx.production.conf`

#### Вариант 2: Использовать абсолютный путь
Если `${HOME}` не работает, замените в `docker-compose.unified.yml`:
```yaml
volumes:
  - /home/infrasafe/nginx-docker/nginx.production.conf:/etc/nginx/nginx.conf:ro
```

#### Вариант 3: Проверить существование файла
```bash
# Проверка существования файла
ls -la ~/nginx-docker/nginx.production.conf

# Если файл не существует, скопируйте его
cp nginx.production.conf ~/nginx-docker/nginx.production.conf

# Проверка прав доступа
chmod 644 ~/nginx-docker/nginx.production.conf
```

## 🔍 Диагностика

### Проверка перед запуском:
```bash
# 1. Проверить существование файла
test -f ~/nginx-docker/nginx.production.conf && echo "OK" || echo "Файл не найден"

# 2. Проверить права доступа
ls -l ~/nginx-docker/nginx.production.conf

# 3. Проверить синтаксис конфигурации
docker run --rm -v ~/nginx-docker/nginx.production.conf:/etc/nginx/nginx.conf:ro nginx:alpine nginx -t
```

## 🚀 Запуск

После настройки:
```bash
docker compose -f docker-compose.unified.yml up -d nginx
```

## 📝 Примечания

- На сервере путь может отличаться от локального
- Убедитесь, что файл существует на сервере перед запуском
- Используйте абсолютные пути для production окружения

