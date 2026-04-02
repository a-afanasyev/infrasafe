# InfraSafe — Архитектурный дебат: оптимизация сервисного стека

**Дата:** 2026-04-02
**Задание:** `docs/superpowers/plans/Infrasafe architecture debate.md`

---

## Важное уточнение: фактическое состояние vs описание

Прежде чем начать дебат, зафиксируем разрыв между описанием pipeline и кодом:

| Компонент | В документе | В коде |
|-----------|-------------|--------|
| WireGuard | "Входная точка" | **Закомментирован** (`docker-compose.unified.yml:130-157`) |
| Mosquitto | "MQTT Broker" | **Закомментирован** (`docker-compose.unified.yml:67-81`) |
| InfluxDB | "Time-series хранение" | **Закомментирован** (`docker-compose.unified.yml:83-96`) |
| Node-RED | "Rule Engine" | **Закомментирован** (`docker-compose.unified.yml:116-128`) |
| Grafana | "Дашборды?" | **Закомментирован** (`docker-compose.unified.yml:98-114`) |
| PostgreSQL | "Основная БД" | **Активен**, единственная БД |

**Фактический data pipeline (working code):**
```
Генератор (cron каждые 2 мин)
       │
       │ HTTP POST /api/metrics/telemetry
       ▼
┌─────────────────┐
│   Express.js    │  receiveTelemetry() → processTelemetry()
│   (port 3000)   │  валидация, anomaly detection, кэш
└────────┬────────┘
         │ INSERT INTO metrics
         ▼
┌─────────────────┐         ┌─────────────────┐
│   PostgreSQL    │────────▶│   Frontend      │  Leaflet.js + Chart.js
│   PostGIS 15    │         │   (vanilla JS)  │  polling /api/buildings-metrics
└─────────────────┘         └─────────────────┘
```

Документ описывает **целевую архитектуру**, к которой предлагается двигаться. Дебат оценивает целесообразность этого перехода.

---

## Раунд 1 — Защита целевой архитектуры

### Агент: `@industrial-automation-engineer`

---

### WireGuard — Reverse VPN Gateway

**Что это даёт:**
WireGuard в reverse connection pattern — это **единственный production-grade способ** получить доступ к контроллерам за NAT/LTE/файрволами. Контроллер физически устанавливается в подвале здания, подключается через мобильную сеть провайдера, за 2-3 уровнями NAT. Мы НЕ можем подключиться к нему — он сам поднимает туннель к нашему серверу.

**Почему именно WireGuard, а не альтернативы:**

| Критерий | WireGuard | Tailscale/Headscale | OpenVPN | ZeroTier |
|----------|-----------|---------------------|---------|----------|
| CPU overhead на ARM | ~2% | ~5-8% (userspace) | ~15-20% | ~8-12% |
| RAM | 0 (kernel module) | 30-50 MB | 15-25 MB | 20-30 MB |
| Latency добавка | <1ms | 2-5ms | 5-15ms | 3-8ms |
| NAT traversal | ✅ persistent keepalive | ✅ DERP relay | Нужен порт-форвардинг | ✅ relay |
| Provisioning | Ручной (пара ключей) | Автоматический | Ручной (сертификаты) | Автоматический |
| Зависимости | 0 (kernel) | Daemon + control plane | Daemon + OpenSSL | Daemon |
| Зрелость в IoT | Промышленный стандарт | Enterprise | Устаревает | Нишевый |

**Ограничения:**
1. **Ручной key provisioning**: для каждого контроллера нужна пара ключей. При 100+ устройствах — потребуется скрипт автоматизации или Headscale поверх WireGuard
2. **Мониторинг туннелей**: `wg show` даёт только last handshake — нет granular health metrics. Нужен wrapper-скрипт с Prometheus exporter
3. **Один endpoint**: при падении VPN-сервера — все контроллеры офлайн. Нет встроенной HA

**Что потеряем без WireGuard:**
Двусторонняя связь с контроллерами: firmware updates, remote reboot, config push, reverse SSH debug. Без VPN контроллер может только слать данные (push), но мы не можем ничего отправить ему (pull).

**Вердикт защитника:** WireGuard — **обязателен**. Это не опция, а фундамент edge-IoT. Но нужен не внутри Docker Compose (privileged контейнер = risk), а как **системный сервис на хосте** (`wg-quick@wg0`).

---

### Mosquitto — MQTT Broker

**Что это даёт:**
MQTT — **индустриальный стандарт** для IoT telemetry (ISO/IEC 20922). Mosquitto — эталонная реализация Eclipse Foundation, работает на ARM с 2 MB RAM.

**Преимущества над текущим HTTP POST:**

| Критерий | HTTP POST (текущее) | MQTT QoS 1 |
|----------|-------------------|------------|
| Гарантия доставки | Нет. Если сервер 503 — данные потеряны | ✅ Retry до ACK |
| Bandwidth | ~500 bytes header + payload | ~4 bytes header + payload |
| Persistent session | Нет. Reconnect = потеря контекста | ✅ Clean session = false |
| LWT (Last Will) | Нет | ✅ Автоматический оффлайн-статус |
| Pub/Sub fanout | Нет. 1 HTTP → 1 endpoint | ✅ N subscribers на 1 topic |
| Bidirectional | Только inbound (POST) | ✅ Publish + Subscribe |
| Connection overhead | TCP handshake + TLS на каждый запрос | 1 persistent connection |
| Работа на слабом канале (LTE) | Плохо — TCP retransmit, timeout | Хорошо — minimal packets |

**Зачем нам fanout (pub/sub):**
Одно MQTT-сообщение от контроллера может одновременно обрабатываться:
- Rule Engine (алерты, пороговые значения)
- Time-series storage (raw data)
- Real-time dashboard (WebSocket bridge)
- Аналитика (агрегация)

Без MQTT каждый новый consumer требует изменения кода контроллера или добавления промежуточного HTTP-прокси.

**Почему Mosquitto, а не EMQX/NanoMQ/HiveMQ:**

| Критерий | Mosquitto | EMQX | NanoMQ | HiveMQ |
|----------|-----------|------|--------|--------|
| RAM (idle) | 2-5 MB | 200+ MB | 5-10 MB | 300+ MB |
| Max connections | ~100K | Millions | ~100K | Millions |
| Rule engine | ❌ | ✅ SQL-like | ❌ | ❌ |
| Кластеризация | ❌ (bridge only) | ✅ native | ❌ | ✅ |
| Complexity | Minimal | High | Low | High |
| Community | Зрелый, стабильный | Растёт | Молодой | Enterprise |

Для 10-500 устройств Mosquitto — **более чем достаточно**. EMQX оправдан при 10K+ устройств ИЛИ при необходимости встроенного rule engine (замена Node-RED).

**Ограничения Mosquitto:**
1. Нет встроенного persistence в SQL — нужен bridge (Node-RED, Telegraf, custom subscriber)
2. Нет кластеризации — один broker = SPOF. Для HA нужен MQTT bridge (active-passive)
3. Auth ограничен файлами/плагинами — нет интеграции с JWT из коробки

**Что потеряем без Mosquitto:**
Останемся на HTTP POST telemetry. Это работает на 17 зданиях с генератором каждые 2 мин, но:
- Не масштабируется на real-time (1 sample/sec × 500 устройств = 500 req/sec через Express)
- Нет гарантии доставки при нестабильном LTE
- Нет двустороннего канала к контроллерам через IoT-стандарт
- Нет fanout для будущих consumers

**Вердикт защитника:** Mosquitto — **рекомендован к добавлению**, но только когда появятся реальные контроллеры (не генератор). Для генератора HTTP POST достаточен.

---

### InfluxDB — Time-Series Storage

**Что это даёт:**
Специализированная БД для высокочастотных time-series данных. Оптимизирована для:
- Write-heavy workload (append-only)
- Downsampling (continuous queries / tasks)
- Retention policies (автоудаление старых данных)
- Flux-запросы для аналитики временных рядов

**Текущее состояние в InfraSafe:**
PostgreSQL УЖЕ справляется с time-series:
- Таблица `metrics` **партиционирована помесячно** (видно в schema export: `metrics_2025_11`, `metrics_current_month`, `metrics_prev_month`)
- Есть `archive_daily_analytics()` функция
- Есть `analytics_history` — партиционированная таблица истории
- Есть materialized view `mv_transformer_load_realtime`

**Сравнение для текущего масштаба:**

| Критерий | PostgreSQL (текущее) | InfluxDB | TimescaleDB |
|----------|---------------------|----------|-------------|
| Write throughput (17 зданий, 1/2мин) | ~0.15 writes/sec — тривиально | Overkill | Overkill |
| Write throughput (500 устройств, 1/sec) | 500 writes/sec — OK с batching | Нативно | Нативно |
| Downsampling | Cron + SQL | Flux tasks | Continuous aggregates |
| Retention | Партиции + DROP | Retention policy | Retention policy |
| Запросы аналитики | SQL (знакомый) | Flux (новый язык) | SQL (знакомый) |
| Дополнительный сервис | ❌ Не нужен | ✅ Нужен backup, мониторинг | ❌ Extension к PostgreSQL |
| RAM overhead | 0 (уже работает) | 200-500 MB | 50-100 MB (extension) |

**Используем ли мы InfluxDB features?**
- Retention policies → PostgreSQL партиции + DROP уже закрывают
- Continuous queries → `archive_daily_analytics()` уже есть
- Downsampling → `mv_transformer_load_realtime` уже есть
- Flux язык → Не нужен, SQL покрывает все текущие запросы

**Ограничения InfluxDB в нашем контексте:**
1. **Дублирование данных**: метрики попадают в InfluxDB И PostgreSQL → двойной объём, двойной backup
2. **Новый язык запросов**: Flux отличается от SQL, команда должна его изучить
3. **Нет JOIN**: InfluxDB не может джойнить с buildings/controllers — аналитика всё равно через PostgreSQL
4. **Дополнительный сервис**: backup, мониторинг, обновления — нагрузка на команду 1-2 человека

**Что потеряем без InfluxDB:**
Ничего, что PostgreSQL не закрывает уже сейчас. При текущем масштабе (17 зданий, 1 замер / 2 мин = 0.15 writes/sec) PostgreSQL работает без какого-либо напряжения.

**Точка перелома:** InfluxDB/TimescaleDB нужен при >1000 writes/sec ИЛИ при хранении raw data с разрешением <1 сек на горизонте >1 года. Текущий сценарий — далеко от этого.

**Вердикт защитника:** InfluxDB — **НЕ обоснован**. PostgreSQL с партиционированием закрывает 100% текущих и ближайших потребностей. Если когда-то понадобится — TimescaleDB (PostgreSQL extension) предпочтительнее, т.к. не добавляет новый сервис.

---

### Node-RED — Visual Rule Engine

**Что это даёт:**
Visual flow programming для IoT. Drag-and-drop создание правил: "если температура > 80°C → алерт → telegram". Нативная интеграция с MQTT, HTTP, PostgreSQL, Telegram, email.

**Преимущества:**
1. **Быстрое прототипирование**: новое правило за 5 минут без кода
2. **Визуальная отладка**: видишь данные в каждом узле в реальном времени
3. **Богатая экосистема**: 4000+ нодов для Modbus, BACnet, OPC UA, Telegram, Slack
4. **MQTT-native**: subscribe/publish — первоклассные граждане
5. **Пороговые правила**: built-in trigger/delay/rate-limit ноды

**Но:**

**Текущее состояние в InfraSafe:**
Вся бизнес-логика УЖЕ реализована в TypeScript/JavaScript:
- `metricService.detectAnomalies()` — обнаружение аномалий по пороговым значениям
- `alertService.js` — полный lifecycle алертов (create → acknowledge → close) + 15-мин cooldown
- `ukIntegrationService.sendAlertToUK()` — правила маршрутизации алертов в UK
- `alert_rules` таблица — конфигурируемые правила alert → UK request
- Circuit Breaker в `analyticsService.js` — fault tolerance

Фактически, **InfraSafe УЖЕ имеет rule engine** — он написан на JavaScript, покрыт 677 тестами, версионируется в git.

**Проблемы Node-RED для InfraSafe:**
1. **Версионирование**: flows.json — один большой JSON, git diff нечитаем. Code review невозможен
2. **Тестирование**: нельзя запустить `npm test` для Node-RED flow. Нет TDD
3. **Дублирование**: придётся переносить логику из metricService/alertService в Node-RED или держать две системы
4. **Debug в production**: нет structured logging, нет correlation ID, нет Sentry
5. **Security**: Node-RED admin UI — ещё один endpoint для защиты
6. **RAM**: 100-200 MB на edge-железе
7. **При усложнении**: визуальные flows > 50 нодов превращаются в нечитаемую паутину

**Единственный сценарий, где Node-RED побеждает:**
Оператор здания (не программист) должен сам создавать правила автоматизации. Если target user — технический инженер, Node-RED UI выигрывает у кода. Но текущие правила конфигурируются через admin UI + `alert_rules` таблицу — это тоже no-code для оператора.

**Вердикт защитника:** Node-RED — **не рекомендован**. InfraSafe уже имеет code-based rule engine, покрытый тестами. Node-RED добавит дублирование логики, усложнит deployment, и сломает существующий TDD workflow.

---

### Grafana — Dashboards & Alerting

**Что это даёт:**
Универсальная платформа визуализации с datasource-плагинами для PostgreSQL, InfluxDB, Prometheus. Alerting, annotations, variables, templating.

**Два возможных use-case:**

**A) Клиентские дашборды (для жителей/УК)**
Фронтенд InfraSafe УЖЕ визуализирует из PostgreSQL:
- Leaflet.js карта со статусами зданий
- Chart.js графики метрик
- Таблицы с фильтрацией
- Admin-панель с интеграцией UK

Grafana дублировала бы этот функционал с другим UI. Жители зданий не будут пользоваться Grafana.

**B) Ops-мониторинг (для команды InfraSafe)**
Здесь Grafana полезна:
- Мониторинг самой платформы: CPU, RAM, disk, DB latency
- MQTT broker статистика
- Контроллеры: online/offline, packet loss
- Бизнес-метрики: alerts/hour, telemetry gaps

**НО**: для ops-мониторинга Grafana нужен Prometheus/Loki/InfluxDB как datasource. Без них Grafana с PostgreSQL — не лучше, чем Chart.js на фронтенде.

**Ограничения:**
1. RAM: 150-250 MB — значимо на edge
2. Ещё один UI для защиты (auth, TLS)
3. Дублирование визуализации фронтенда
4. Без Prometheus/InfluxDB — ограниченная ценность

**Вердикт защитника:** Grafana — **опциональна**, только для ops-мониторинга, только если есть Prometheus. Для клиентской визуализации — фронтенд InfraSafe достаточен.

---

## Раунд 2 — Критика и реорганизация

### Агент: `@senior-architect-refactor`

---

### Главный тезис

Документ описывает pipeline из **6 сервисов + фронтенд**. Текущий working code использует **3 сервиса** (Express, PostgreSQL, Nginx). Предлагается добавить 4 новых сервиса для команды 1-2 человека. Это **операционное самоубийство**.

Правило: **каждый сервис в стеке — это**:
- Backup-стратегия
- Monitoring endpoint
- Security surface (CVE, обновления)
- Documentation
- On-call runbook
- Upgrade path при смене версий
- RAM/CPU на edge-железе

Для команды 1-2 человека каждый дополнительный сервис стоит **~2-4 часа/месяц** на поддержку. 4 новых сервиса = 8-16 часов/месяц чистого ops-overhead.

---

### Атака 1: InfluxDB + PostgreSQL → PostgreSQL (оставить как есть)

**Текущее состояние уже оптимально.** PostgreSQL с партиционированием по месяцам обрабатывает весь time-series workload:

```
Текущая нагрузка: 17 зданий × 1 замер / 2 мин = 0.14 writes/sec
Целевая нагрузка: 500 устройств × 1 замер / 30 сек = 16.7 writes/sec
PostgreSQL capacity: 10,000+ writes/sec (одна нода, SSD)
```

**Запас: 600x от текущего и 600x от целевого.** PostgreSQL НЕ является bottleneck и не будет им при любом реалистичном масштабе InfraSafe.

**TimescaleDB**: если через 2-3 года потребуется — это `CREATE EXTENSION timescaledb` + `SELECT create_hypertable('metrics', 'timestamp')`. Миграция за 2 часа, без добавления нового сервиса.

**Вердикт:** ❌ InfluxDB — **убрать из планов**. PostgreSQL закрывает 100%. TimescaleDB — резерв на будущее.

---

### Атака 2: Node-RED → TypeScript Rule Engine (оставить как есть)

InfraSafe **уже имеет** полноценный rule engine в коде:

```
src/services/alertService.js        — alert lifecycle + 15-min cooldown
src/services/metricService.js       — anomaly detection (thresholds)
src/services/ukIntegrationService.js — alert → UK request routing
src/models/AlertRule.js             — configurable rules from DB
```

Всё это:
- ✅ Версионируется в git
- ✅ Покрыто 677 тестами
- ✅ Поддерживает structured logging + correlation ID
- ✅ Конфигурируется через admin UI + alert_rules таблицу
- ✅ Интегрировано с existing auth (JWT + isAdmin)

Node-RED **заменил бы** весь этот battle-tested код **нетестируемыми visual flows**. Это движение назад.

**Если нужен "no-code rule builder" для операторов:**
Расширить admin UI: добавить form-based конструктор правил, сохранять в `alert_rules`. Это 2-3 дня работы vs. развёртывание + поддержка Node-RED.

**Вердикт:** ❌ Node-RED — **убрать из планов**. Existing code-based engine лучше во всём, кроме визуального drag-and-drop для non-developers (а наши users — не non-developers).

---

### Атака 3: Grafana → Prometheus + /metrics endpoint

Grafana без datasource — это пустая оболочка. Для ops-мониторинга нужна вся цепочка:

```
Node.js → prom-client → /metrics → Prometheus (scrape) → Grafana (viz) → Alertmanager (alerts)
```

Это ещё **3 сервиса** (Prometheus, Grafana, Alertmanager). Для edge-деплоя 1-2 человеками — неоправданно.

**Simpler alternatives:**

| Вариант | Сервисов | RAM | Стоимость |
|---------|----------|-----|-----------|
| Prometheus + Grafana + Alertmanager | +3 | +500 MB | $0 |
| Uptime Kuma (self-hosted) | +1 | +50 MB | $0 |
| Better Stack (SaaS) | 0 | 0 | $0 (free tier) |
| Расширенный /health + cron alerting | 0 | 0 | $0 |

**Рекомендация:** На текущем этапе:
1. Расширенный `/health` endpoint (уже в production readiness плане)
2. Uptime Kuma ИЛИ Better Stack для uptime мониторинга
3. Sentry для error tracking (уже рекомендован)

Когда будет 50+ зданий → пересмотреть в пользу Prometheus stack.

**Вердикт:** ❌ Grafana — **убрать из планов**. Uptime Kuma + Sentry + расширенный /health покрывают 95% потребностей с минимальным overhead.

---

### Атака 4: Mosquitto — единственное обоснованное добавление

Mosquitto — **единственный сервис из предложенных, который добавляет реальную capability**, отсутствующую в текущем стеке:

1. **Гарантия доставки**: QoS 1/2 — критично для IoT на нестабильных каналах (LTE/3G)
2. **Pub/Sub fanout**: один message → N consumers без изменений на контроллере
3. **LWT (Last Will and Testament)**: автоматическое обнаружение оффлайн-контроллеров
4. **Bidirectional**: команды к контроллерам через subscribe
5. **Bandwidth efficiency**: минимальный overhead на мобильных сетях

**НО: только когда появятся реальные контроллеры.** Сейчас генератор шлёт HTTP POST — MQTT не даст преимуществ для симулятора.

**Минимальная интеграция (без Node-RED):**

```
Контроллер → MQTT publish → Mosquitto
                               │
                    ┌──────────┼──────────┐
                    ▼          ▼          ▼
              MQTT subscriber (Node.js microservice)
              │  - parse message
              │  - validate payload
              │  - INSERT INTO PostgreSQL
              │  - detectAnomalies()
              │  - sendAlertToUK() if needed
              └──────────────────────────────
```

Один TypeScript/JavaScript subscriber-сервис заменяет InfluxDB + Node-RED + Grafana. Он:
- Подписывается на MQTT topics
- Парсит payload
- Пишет в PostgreSQL (existing schema)
- Вызывает existing alertService/metricService
- Полностью тестируемый

**Оценка footprint:**
- Mosquitto: 2-5 MB RAM
- MQTT subscriber service: 30-50 MB RAM (Node.js)
- **Total: ~50 MB** vs. 500+ MB для полного стека (InfluxDB + Node-RED + Grafana)

**Вердикт:** 🟢 Mosquitto — **рекомендован**, но **только при появлении реальных контроллеров**. С MQTT subscriber на Node.js (не Node-RED).

---

### Атака 5: WireGuard — вынести из Docker Compose

WireGuard в Docker — **антипаттерн**:
1. `privileged: true` — контейнер с root-правами на хосте. Security nightmare
2. `NET_ADMIN + SYS_MODULE` capabilities — фактически root
3. При рестарте docker compose — все VPN-туннели рвутся
4. Тяжело дебажить: `wg show` не работает внутри контейнера без privileges
5. Docker networking interference: iptables rules конфликтуют

**Правильный подход:**
WireGuard — **системный сервис на хосте** (`systemctl enable wg-quick@wg0`):
- Kernel module, zero overhead
- Переживает рестарты Docker
- Стандартная конфигурация в `/etc/wireguard/wg0.conf`
- Мониторинг через `wg show` на хосте

**Provisioning at scale (100+ устройств):**
```bash
# Генерация конфига для нового контроллера
./scripts/provision-controller.sh <controller_serial>
# Output: контроллер получает wg config + MQTT credentials
```

Простой bash-скрипт: `wg genkey | tee privatekey | wg pubkey > publickey`, добавить peer в `wg0.conf`, `wg syncconf wg0 /etc/wireguard/wg0.conf` (hot reload без рестарта).

**Headscale (WireGuard control plane):** Оправдан при 200+ устройств. Для 10-50 — ручной provisioning + bash-скрипт достаточен. Для 50-200 — Headscale упрощает жизнь. Решение не критично сейчас.

**Вердикт:** 🟢 WireGuard — **обязателен**, но **вне Docker Compose**. Системный сервис на хосте.

---

### Целевая минимальная архитектура

```
                          ┌──── Host level ────┐
                          │  WireGuard (wg0)   │
                          │  systemd service   │
                          └────────┬───────────┘
                                   │ контроллеры стучатся сюда
                                   ▼
┌───────── Docker Compose ─────────────────────────────────┐
│                                                           │
│  ┌─────────────┐    MQTT    ┌──────────────────────┐     │
│  │  Mosquitto   │──────────▶│  MQTT Subscriber     │     │
│  │  (2-5 MB)    │           │  (Node.js, 30-50 MB) │     │
│  └─────────────┘            │  - parse & validate  │     │
│       ▲                     │  - anomaly detect    │     │
│       │ MQTT publish        │  - alert pipeline    │     │
│       │                     └──────────┬───────────┘     │
│  контроллеры                           │                  │
│  (через WireGuard)                     │ INSERT           │
│                                        ▼                  │
│                    ┌─────────────────────────┐            │
│                    │  PostgreSQL + PostGIS   │            │
│  ┌───────────┐    │  (existing schema)      │            │
│  │  Express  │◀───│  - партиционирование    │            │
│  │  API      │───▶│  - materialized views   │            │
│  └─────┬─────┘    └─────────────────────────┘            │
│        │                                                  │
│  ┌─────┴─────┐                                           │
│  │  Nginx    │  TLS + static files                       │
│  │  (reverse │                                           │
│  │   proxy)  │                                           │
│  └───────────┘                                           │
│                                                           │
│  Total RAM: ~350-400 MB (vs. ~900+ MB с полным стеком)   │
└──────────────────────────────────────────────────────────┘
```

**Сервисы: 5 (вместо 8)**
1. WireGuard (host) — VPN gateway
2. Mosquitto — MQTT broker
3. MQTT Subscriber (Node.js) — ingestion + rules
4. Express API — REST API + фронтенд backend
5. PostgreSQL — единственная БД
6. Nginx — TLS reverse proxy

**Убрано: 3 сервиса** (InfluxDB, Node-RED, Grafana) = -500 MB RAM, -3 точки отказа, -6-12 часов/месяц ops.

---

## Раунд 3 — Финальный вердикт

### Агент: `@chief-architect`

---

Получив оба анализа, делаю прагматичное решение. Скажу прямо: **`@senior-architect-refactor` прав по всем пунктам**, а `@industrial-automation-engineer` корректно защитил только WireGuard и Mosquitto.

### 1. Целевая архитектура

| Сервис | Решение | Обоснование |
|--------|---------|-------------|
| **WireGuard** | 🟢 ОСТАВИТЬ, но **на хосте** | Обязателен для reverse connection pattern. Вне Docker — безопаснее и стабильнее. Privileged container — антипаттерн |
| **Mosquitto** | 🟢 ДОБАВИТЬ, **когда появятся реальные контроллеры** | IoT без MQTT — это HTTP polling. MQTT даёт QoS, LWT, pub/sub. Mosquitto — правильный выбор для масштаба 10-500 устройств |
| **InfluxDB** | 🔴 УБРАТЬ из планов | PostgreSQL с партиционированием уже закрывает 100% потребностей. Запас 600x. TimescaleDB extension — резерв на будущее без нового сервиса |
| **Node-RED** | 🔴 УБРАТЬ из планов | Code-based rule engine (alertService + metricService + alertRules) лучше: тестируемый, версионируемый, с structured logging. Node-RED = шаг назад |
| **PostgreSQL** | 🟢 ОСТАВИТЬ | Единственная БД. PostGIS, партиционирование, materialized views — всё на месте |
| **Grafana** | 🔴 УБРАТЬ из планов | Дублирует фронтенд. Без Prometheus datasource — бесполезна. Uptime Kuma + Sentry + /health — дешевле и проще |

---

### 2. Приоритеты при принятии решений (ранжированные)

1. **🥇 Операционная простота** — команда 1-2 человека. Каждый сервис = боль. Минимизируем количество движущихся частей
2. **🥈 Надёжность** — люди живут в этих зданиях. Меньше сервисов = меньше точек отказа = выше uptime
3. **🥉 Edge/on-prem ресурсы** — 350 MB RAM vs 900 MB. На edge-железе это разница между "работает" и "свопит"
4. **4️⃣ Скорость разработки** — один язык (JavaScript/TypeScript), один pipeline, один test suite. Не нужно знать Flux, Node-RED flows, Grafana provisioning
5. **5️⃣ Масштабируемость** — от 10 до 500 устройств. PostgreSQL + Mosquitto достаточно. TimescaleDB/EMQX — резерв

**Почему надёжность на 2-м месте, а не на 1-м?**
Потому что для команды 1-2 человека операционная простота **IS** надёжность. Система из 3 сервисов, которую один человек может полностью понять и починить в 3 часа ночи — надёжнее системы из 8 сервисов, где каждый может сломаться по-своему.

---

### 3. План миграции

#### Фаза 0: Сейчас (0 трудозатрат)
- **Удалить закомментированные сервисы из docker-compose.unified.yml** ← уже в production readiness плане
- Зафиксировать решение: InfluxDB, Node-RED, Grafana — **НЕ добавляем**
- WireGuard — конфигурируется на хосте отдельно, не в Docker Compose

#### Фаза 1: При появлении реальных контроллеров (1-2 недели)
> Можно делать параллельно с feature-разработкой

| Шаг | Что делаем | Откатываемость | Трудозатраты |
|-----|-----------|----------------|--------------|
| 1.1 | WireGuard на хосте: `wg-quick@wg0`, первый peer для тестового контроллера | `systemctl stop wg-quick@wg0` | 2-3 часа |
| 1.2 | Mosquitto в docker-compose: минимальный конфиг, порт 1883 (internal only) | Удалить сервис из compose | 1-2 часа |
| 1.3 | MQTT subscriber service (Node.js): subscribe `infrasafe/+/telemetry`, parse, INSERT | Выключить сервис | 2-3 дня |
| 1.4 | Dual-mode: HTTP POST + MQTT работают параллельно (генератор через HTTP, реальные контроллеры через MQTT) | — | Автоматически |
| 1.5 | Тесты: unit + integration для MQTT subscriber | — | 1-2 дня |

**Важно:** HTTP POST endpoint `/metrics/telemetry` остаётся. MQTT — дополнительный канал, не замена. Это позволяет мигрировать контроллеры по одному.

#### Фаза 2: При масштабировании до 50+ устройств (1 неделя)
> Требует фокуса, не параллельно

| Шаг | Что делаем | Трудозатраты |
|-----|-----------|--------------|
| 2.1 | WireGuard provisioning скрипт: `provision-controller.sh <serial>` | 1 день |
| 2.2 | Мониторинг туннелей: cron + `wg show` → alert при >5 мин without handshake | 0.5 дня |
| 2.3 | MQTT topic structure: `infrasafe/{building_id}/{controller_serial}/telemetry` | 1 день |
| 2.4 | MQTT ACL: per-controller auth (не shared password) | 1 день |

#### Фаза 3: При масштабировании до 200+ устройств (оценить позже)
- Headscale поверх WireGuard (автоматический key management)
- TimescaleDB extension для PostgreSQL (если query latency растёт)
- EMQX вместо Mosquitto (если нужен кластер)

---

### 4. Риски

| Решение | Риск | Вероятность | Митигация |
|---------|------|-------------|-----------|
| Отказ от InfluxDB | PostgreSQL не справится с write load при 500+ устройствах | Низкая (запас 600x) | TimescaleDB extension — миграция за 2 часа |
| Отказ от Node-RED | Потребуется визуальный rule builder для не-разработчиков | Средняя | Расширить admin UI: form-based конструктор правил из alert_rules |
| Отказ от Grafana | Нет ops-дашбордов для диагностики | Средняя | Uptime Kuma (1 контейнер, 50 MB) + расширенный /health |
| MQTT subscriber как отдельный сервис | Ещё один процесс для мониторинга | Низкая | Embedded в Express (mqtt.js subscribe в server.js) ИЛИ separate worker |
| WireGuard на хосте | При переезде на другой сервер — ручная миграция конфигов | Низкая | Ansible playbook для provision хоста |
| Mosquitto SPOF | Broker падает → все контроллеры потеряли канал | Средняя | Docker restart: unless-stopped + health check. Для HA: MQTT bridge (active-passive) |

---

### 5. Итоговый docker-compose сервис-лист

```yaml
# InfraSafe Production Stack
# Target: 10-500 IoT устройств, 1-2 человека поддержки
# Принцип: минимальное количество сервисов, максимальная надёжность

services:
  # === ОБЯЗАТЕЛЬНЫЕ (сейчас) ===

  nginx:
    # TLS reverse proxy + статические файлы фронтенда
    image: nginx:alpine

  app:
    # Express.js REST API — единственный backend
    build: { dockerfile: Dockerfile.prod }

  postgres:
    # Единственная БД: PostGIS, партиционирование, materialized views
    image: postgis/postgis:15-3.3

  # === ДОБАВИТЬ при появлении реальных контроллеров ===

  # mosquitto:
  #   # MQTT broker для IoT telemetry (QoS 1, LWT, pub/sub)
  #   image: eclipse-mosquitto:latest
  #   # Порт НЕ экспонируется наружу — только через WireGuard network
  #   expose: ["1883"]

  # mqtt-subscriber:
  #   # MQTT → PostgreSQL ingestion + anomaly detection + alert pipeline
  #   build: { dockerfile: Dockerfile.mqtt-subscriber }

# === ВНЕ DOCKER COMPOSE ===
# WireGuard: systemctl enable wg-quick@wg0
# Reverse connection pattern: контроллеры поднимают туннель к серверу
# Конфиг: /etc/wireguard/wg0.conf

# === НЕ ВКЛЮЧАЕМ ===
# InfluxDB — PostgreSQL с партиционированием достаточно (запас 600x)
# Node-RED — code-based rule engine лучше (тестируемый, версионируемый)
# Grafana — дублирует фронтенд, без Prometheus бесполезна
```

---

### 6. Открытые вопросы

| # | Вопрос | Зачем ответить | Когда |
|---|--------|---------------|-------|
| 1 | **Какие реальные контроллеры будут использоваться?** ARM (Raspberry Pi)? x86 (industrial PC)? Это определяет доступные протоколы и формат прошивки | До выбора MQTT library на контроллере | До Фазы 1 |
| 2 | **Какая частота отправки данных с реальных контроллеров?** 1/sec? 1/min? 1/5min? Это определяет нужен ли batching и влияет на оценку нагрузки на PostgreSQL | До проектирования MQTT topic structure | До Фазы 1 |
| 3 | **Нужны ли команды к контроллерам (publish)?** Firmware update, reboot, config change. Если да — MQTT bidirectional обязателен. Если нет — можно обойтись HTTP POST + WireGuard SSH | Определяет архитектуру MQTT topics | До Фазы 1 |
| 4 | **Какое edge-железо?** RAM, CPU, disk. Влияет на бюджет сервисов | Определяет, нужна ли оптимизация RAM | До production deploy |
| 5 | **Один сервер или мульти-сайт?** Все здания к одному серверу, или нужны edge gateways на каждом объекте? | Определяет, нужен ли MQTT bridge | При масштабировании до 100+ зданий |
| 6 | **Нужна ли offline resilience?** Что делает контроллер, если VPN/MQTT недоступен? Буферизирует данные? На какой период? | Определяет QoS level и local storage на контроллере | До firmware design |
| 7 | **Есть ли regulatory требования к хранению данных?** Ташкент, smart building — локальное хранение? Retention period? | Определяет backup strategy и retention policy | До production deploy |

---

### Итого: сравнение вариантов

```
Предложенный полный стек (документ):        Рекомендованный минимальный стек:
─────────────────────────────                ─────────────────────────────────
WireGuard (Docker, privileged)               WireGuard (host, systemd)
Mosquitto                                    Mosquitto (при реальных контроллерах)
InfluxDB                        ───УБРАТЬ──→ (PostgreSQL покрывает)
Node-RED                        ───УБРАТЬ──→ (code-based rule engine)
PostgreSQL                                   PostgreSQL + PostGIS
Grafana                         ───УБРАТЬ──→ (Uptime Kuma + Sentry)
Frontend                                     Frontend (Nginx + vanilla JS)

Сервисов: 8                                  Сервисов: 5 (сейчас 3+host)
RAM: ~900+ MB                                RAM: ~350-400 MB
Ops overhead: HIGH                           Ops overhead: LOW
Точек отказа: 8                              Точек отказа: 4
```

**Финальная рекомендация: минимальный стек.** Экономия 3 сервисов = 500+ MB RAM, 3 точки отказа, 6-12 часов/месяц ops-overhead. При команде 1-2 человека это разница между "можем фичи делать" и "тушим пожары в инфраструктуре".
