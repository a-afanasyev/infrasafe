# Примеры использования API

## Аутентификация

### Получение токена

```javascript
const response = await fetch('/api/auth/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    username: 'user@example.com',
    password: 'password123'
  })
});

const { token, refreshToken } = await response.json();
```

### Использование токена

```javascript
const response = await fetch('/api/buildings', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
```

### Обновление токена

```javascript
const response = await fetch('/api/auth/refresh', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    refreshToken: refreshToken
  })
});
```

## Работа с ресурсами

### Получение списка с фильтрацией

```javascript
const response = await fetch('/api/transformers?status=active&load_min=80', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
```

### Создание ресурса

```javascript
const response = await fetch('/api/buildings', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'Главный офис',
    address: 'ул. Примерная, 1',
    latitude: 55.7558,
    longitude: 37.6173
  })
});
```

### Обновление ресурса

```javascript
const response = await fetch('/api/controllers/123', {
  method: 'PUT',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'Контроллер этаж 1',
    status: 'maintenance'
  })
});
```

## Работа с метриками

### Получение агрегированных данных

```javascript
const response = await fetch('/api/metrics/controller/123/aggregated?timeFrame=day', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
```

### Отправка телеметрии

```javascript
const response = await fetch('/api/metrics/telemetry', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    controller_id: 123,
    temperature: 22.5,
    humidity: 45,
    pressure: 1013,
    timestamp: new Date().toISOString()
  })
});
```

## Обработка ошибок

### Проверка ответа

```javascript
const response = await fetch('/api/buildings/123');
if (!response.ok) {
  const error = await response.json();
  switch (error.code) {
    case 'RESOURCE_NOT_FOUND':
      console.error('Здание не найдено');
      break;
    case 'AUTHORIZATION_ERROR':
      console.error('Нет доступа');
      break;
    default:
      console.error('Неизвестная ошибка:', error.message);
  }
}
```

### Rate Limiting

```javascript
const response = await fetch('/api/metrics');
if (response.status === 429) {
  const retryAfter = response.headers.get('Retry-After');
  console.log(`Превышен лимит запросов. Повторить через ${retryAfter} секунд`);
}
```

## Поиск и фильтрация

### Поиск в радиусе

```javascript
const response = await fetch('/api/buildings/search?latitude=55.7558&longitude=37.6173&radius=1.5', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
```

### Комплексная фильтрация

```javascript
const params = new URLSearchParams({
  status: 'active',
  load_min: '80',
  sort_by: 'name',
  order: 'asc',
  page: '1',
  per_page: '20'
});

const response = await fetch(`/api/transformers?${params}`, {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
``` 