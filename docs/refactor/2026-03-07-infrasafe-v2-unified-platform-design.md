# InfraSafe v2 — Единая платформа мониторинга и управления

**Дата:** 2026-03-07
**Статус:** Утверждён
**Цель:** Объединить InfraSafe (IoT мониторинг) и UK Management Bot (управление заявками УК) в единый продукт на Node.js стеке с Vue 3 фронтендом.

---

## Решения

| Вопрос | Решение |
|---|---|
| Цель | Единый продукт — InfraSafe v2 |
| Telegram | Дополнительный канал (уведомления + быстрые действия) |
| Стек бэкенда | Всё на Node.js (портирование Python-логики) |
| База данных | Единая БД, модульные PostgreSQL schemas |
| Фронтенд | Vue 3 SPA (полная замена vanilla JS) |
| Фреймворк Vue | Vue 3 + Vite + Pinia + vue-leaflet |
| Функции UK Bot | Все — заявки, смены, ML-назначения, верификация, адреса, Telegram |

---

## 1. Общая архитектура

```
                         Nginx (порт 8080)
                              |
                 +------------+------------+
                 |                         |
          /api/* |                  /* SPA |
                 v                         v
          Express.js (3000)         Vue 3 SPA
          +-- /api/auth             (Vite build)
          +-- /api/buildings        +-- MapView
          +-- /api/metrics          +-- RequestsView
          +-- /api/alerts           +-- ShiftsView
          +-- /api/requests  [NEW]  +-- ProfileView
          +-- /api/shifts    [NEW]  +-- AdminView
          +-- /api/assignments[NEW] +-- VerificationView
          +-- /api/apartments[NEW]
          +-- /api/telegram  [NEW] <- webhook
                 |
          PostgreSQL 15+ (PostGIS)
          +-- public.*        (shared: users, buildings)
          +-- infrasafe.*     (controllers, metrics, alerts, transformers...)
          +-- uk.*            (requests, shifts, apartments, yards, ratings...)
                 |
          Redis (cache + pub/sub + rate limiting)
                 |
          Telegram Bot (grammY on Node.js)
          +-- webhook -> Express /api/telegram
```

**Ключевые решения:**
- Express.js остаётся бэкендом, расширяется новыми модулями
- Vue 3 + Vite заменяет весь vanilla JS фронтенд
- grammY (Node.js Telegram framework) заменяет Aiogram — один стек
- PostgreSQL schemas разделяют домены: `public`, `infrasafe`, `uk`
- Redis добавляется для кэширования, rate limiting, pub/sub уведомлений
- Telegram webhook через Express endpoint — не отдельный процесс

---

## 2. Модульная структура бэкенда

```
src/
+-- modules/
|   +-- auth/                    # Расширенный auth (роли, верификация)
|   |   +-- auth.controller.js
|   |   +-- auth.service.js
|   |   +-- auth.model.js
|   |   +-- auth.routes.js
|   |
|   +-- buildings/               # Объединённые здания (InfraSafe + UK адреса)
|   |   +-- buildings.controller.js
|   |   +-- buildings.service.js
|   |   +-- buildings.model.js
|   |
|   +-- monitoring/              # Всё из InfraSafe (контроллеры, метрики, алерты)
|   |   +-- controllers/
|   |   +-- metrics/
|   |   +-- alerts/
|   |   +-- transformers/
|   |   +-- power-lines/
|   |   +-- water/
|   |   +-- heat/
|   |
|   +-- requests/          [NEW] # Заявки из UK Bot
|   |   +-- requests.controller.js
|   |   +-- requests.service.js
|   |   +-- requests.model.js
|   |   +-- comments.model.js
|   |   +-- requests.routes.js
|   |
|   +-- shifts/            [NEW] # Смены из UK Bot
|   |   +-- shifts.controller.js
|   |   +-- shifts.service.js
|   |   +-- shifts.model.js
|   |   +-- assignment.service.js  # ML-скоринг назначений
|   |   +-- shifts.routes.js
|   |
|   +-- addresses/         [NEW] # Справочник дворы->здания->квартиры
|   |   +-- yards.model.js
|   |   +-- apartments.model.js
|   |   +-- addresses.service.js
|   |
|   +-- verification/      [NEW] # Верификация жителей
|   |   +-- verification.controller.js
|   |   +-- verification.service.js
|   |   +-- documents.model.js
|   |
|   +-- telegram/          [NEW] # Telegram-бот (grammY)
|       +-- bot.js                # grammY instance + webhook
|       +-- handlers/
|       |   +-- notifications.js  # Уведомления исполнителям
|       |   +-- quick-actions.js  # Принять/отклонить заявку
|       |   +-- media.js          # Фото выполненных работ
|       +-- telegram.routes.js    # POST /api/telegram (webhook)
|
+-- middleware/
|   +-- auth.js                  # JWT + роли (расширенный)
|   +-- roleGuard.js       [NEW] # Проверка ролей (resident/executor/manager)
|   +-- rateLimiter.js     [NEW] # Redis-based rate limiting
|
+-- utils/
|   +-- circuitBreaker.js        # Существующий
|   +-- cacheService.js          # Расширенный (Redis)
|   +-- scheduler.js       [NEW] # Планировщик (смены, уведомления)
|
+-- routes/
    +-- index.js                 # Единый роутер, подключает все модули
```

---

## 3. Схема базы данных

### Schema: public (общие таблицы)

**public.users** (расширенная):
- id, username, email, password_hash
- phone, full_name [NEW]
- roles JSONB DEFAULT '["resident"]' [NEW]
- active_role VARCHAR [NEW]
- status VARCHAR DEFAULT 'pending' (pending/approved/blocked) [NEW]
- telegram_id BIGINT UNIQUE [NEW]
- language VARCHAR DEFAULT 'ru' [NEW]
- specializations JSONB [NEW] (для исполнителей)
- created_at, updated_at

**public.buildings** (расширенная):
- id, name, address, town, management_company
- latitude, longitude (PostGIS)
- yard_id FK -> uk.yards [NEW]
- created_at, updated_at

### Schema: infrasafe (IoT мониторинг) — без изменений

controllers, metrics, alerts, alert_types, power_transformers, power_lines, cold_water_sources, heat_sources, water_lines, water_suppliers

### Schema: uk (управление заявками) — все NEW

**uk.yards** — территориальные зоны (id, name, address)

**uk.apartments** — квартиры (id, building_id FK, apartment_number, floor; UNIQUE(building_id, apartment_number))

**uk.user_apartments** — привязка жителей (user_id FK, apartment_id FK, status, is_owner)

**uk.user_verification** — документы (id, user_id FK, document_type, file_path, status, reviewed_by FK, reviewed_at)

**uk.requests** — заявки:
- request_number VARCHAR PK (формат YYMMDD-NNN)
- user_id FK (заявитель), executor_id FK (исполнитель)
- apartment_id FK, building_id FK
- alert_id FK -> infrasafe.alerts (связь с IoT-алертом)
- category (electrical/plumbing/heating/elevator/cleaning/security)
- description, urgency (normal/medium/urgent/critical)
- status (new/in_progress/purchasing/clarification/completed/accepted/cancelled)
- media_files JSONB
- created_at, updated_at, completed_at

**uk.request_comments** — комментарии (id, request_number FK, user_id FK, text, created_at)

**uk.ratings** — оценки (id, request_number FK, user_id FK, score 1-5, comment)

**uk.shifts** — смены:
- id, executor_id FK, shift_type, started_at, ended_at
- status (planned/active/completed/cancelled)
- efficiency_score, quality_rating

**uk.shift_assignments** — назначение заявок на смены:
- id, shift_id FK, request_number FK, assigned_by FK
- ai_score, specialization_match, geographic_score, workload_score

**uk.shift_templates** — шаблоны (id, name, shift_type, start_time, end_time, days_of_week JSONB)

**uk.quarterly_plans** — планирование (id, year, quarter, executor_id FK, plan_data JSONB)

**uk.notifications** — лог (id, user_id FK, type, message, channel, sent_at, read_at)

**Ключевая связь:** `uk.requests.alert_id -> infrasafe.alerts.id`

---

## 4. Фронтенд — Vue 3 SPA

### Структура

```
frontend/
+-- src/
    +-- router/index.js
    +-- stores/          (Pinia: auth, buildings, requests, shifts, notifications)
    +-- views/
    |   +-- MapView.vue, LoginView.vue, DashboardView.vue
    |   +-- requests/    (List, Detail, Create, Accept)
    |   +-- shifts/      (List, Current, Planning, Assignment)
    |   +-- admin/       (Users, Verification, Address, Analytics)
    |   +-- profile/     (Profile, ApartmentLink)
    +-- components/
    |   +-- map/         (LeafletMap, BuildingMarker, LayerControl, BuildingPopup, StatsBar)
    |   +-- requests/    (RequestCard, RequestStatus, CommentThread, MediaUpload)
    |   +-- shifts/      (ShiftCard, AssignmentScore, ShiftTimeline)
    |   +-- shared/      (AppHeader, Sidebar, Toast, RoleSwitcher, DataTable)
    +-- composables/     (useApi, useMap, useRealtime, usePermissions)
    +-- assets/styles/   (variables.css из логотипа, main.css)
```

### Роутинг по ролям

| Путь | Вид | Роли |
|---|---|---|
| / | MapView (карта) | все |
| /login | LoginView | гость |
| /dashboard | DashboardView | все авторизованные |
| /requests/new | RequestCreate | resident, manager |
| /requests | RequestsList | все авторизованные |
| /requests/:id | RequestDetail | все авторизованные |
| /shift | ShiftCurrent | executor |
| /shifts | ShiftsList + планирование | manager |
| /assignments | AssignmentView + ML | manager |
| /admin/* | Админ-панели | manager |
| /profile | Профиль + привязка к квартире | все авторизованные |

### BuildingPopup (расширенный)

Показывает:
- Метрики датчиков (из InfraSafe)
- Активные заявки (из UK)
- Текущий исполнитель (из UK shifts)
- Кнопка "Создать заявку" (для менеджера)

---

## 5. Интеграционные потоки

### Поток 1: Alert -> Request

```
Датчик -> Метрика -> Alert Engine -> Правила маппинга -> Заявка
- alert.type = "voltage_low" -> category = "electrical"
- alert.severity = "warning" -> urgency = "medium"
- alert.severity = "critical" -> urgency = "critical"
-> SmartDispatcher назначает исполнителя
-> Telegram уведомление
-> Закрытие заявки = закрытие алерта
```

### Поток 2: Ручная заявка

```
Житель (Vue/Telegram) -> Заявка -> Менеджер (web+telegram)
-> Назначение (авто или ручное) -> Исполнитель (telegram)
-> В работу -> Фото -> Завершение -> Приёмка жителем -> Оценка
```

### Поток 3: Уведомления

```
NotificationService:
- WEB: SSE -> Vue SPA (toast + badge)
- TELEGRAM: grammY bot.api.sendMessage()

Триггеры: новая заявка, назначение, смена статуса, IoT-алерт, начало/конец смены
```

### Поток 4: ML-скоринг

```javascript
function calculateAssignmentScore(executor, request) {
    specialization: matchSpecialization()  // вес 0.35
    geography: calculateDistance()         // вес 0.25
    workload: 1 - (active / max)          // вес 0.25
    rating: avgRating / 5.0               // вес 0.15
    // Автоназначение если score > 70
}
```

### Поток 5: Real-time

```
Express -> Redis Pub/Sub -> SSE /api/events/stream -> Vue SPA
                         -> grammY -> Telegram
```

---

## 6. Этапы реализации

| Фаза | Описание | Срок |
|---|---|---|
| 0 | Подготовка: schemas, миграции, расширение users, Vue init, Redis | 1 неделя |
| 1 | Ядро: Auth + роли + карта на Vue + слои + SSE | 2 недели |
| 2 | Заявки: CRUD + комментарии + рейтинг + интеграция в popup | 2 недели |
| 3 | Смены: управление + ML-назначения + планирование | 2 недели |
| 4 | Адреса + верификация документов | 1 неделя |
| 5 | Telegram-бот: grammY webhook + уведомления + quick actions | 1 неделя |
| 6 | Alert -> Request pipeline + аналитика | 1 неделя |
| **Итого** | | **~10 недель** |
