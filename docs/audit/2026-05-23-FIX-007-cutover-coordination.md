# FIX-007 — Cutover coordination (для UK session)

> **Назначение.** Передать UK наши решения по 3 открытым пунктам + запросить
> финальные артефакты для cutover сейчас.
>
> **⚠️ Update 2026-05-23 (после прод-анализа):** Решение по network mode
> пересмотрено с public на **internal** после обнаружения что
> `infrasafe-app-1` и `uk-management-api` уже в одной shared docker network
> `uk-network` (172.20.0.0/16). UK_API_URL не нужен hostname — используем
> docker DNS.

---

# Промпт для UK

Спасибо за полный статус Phase 2. Все 9 AC закрыты, готовы к cutover.

После анализа прод-инфраструктуры пересмотрели одно из решений (network
mode → internal), остальное держим. Финальный план ниже.

## 1. Network mode = **Internal** (через `uk-network`)

**Решение пересмотрено** после анализа прода. Изначально планировали
public через Caddy edge, но обнаружили что наши контейнеры уже в одной
shared docker network:

```
docker network: uk-network (172.20.0.0/16)
├── infrasafe-app-1     → 172.20.0.4
└── uk-management-api   → 172.20.0.6
```

Internal mode оптимален — это ровно то, что вы рекомендовали в F2 на
этапе контракта.

**Наша конфигурация:**
```
UK_API_URL=http://uk-management-api:8080
```
(bare host, наш sender добавит `/api/v2/webhooks/infrasafe/alert`
самостоятельно)

**От вас (6.1+6.2) больше ничего не нужно** — инфра готова:
- Network shared ✅
- DNS resolution внутри docker (uk-management-api → 172.20.0.6) ✅
- Никаких compose / Caddy / cert изменений ✅
- TLS не нужен (доверенная docker network, защита через HMAC) ✅

**Опциональная проверка перед cutover** (если хотите):
```bash
# Внутри uk-management-api контейнера
nc -z 172.20.0.4 3000  # проверить что наш app виден
# Или просто посмотреть docker network inspect uk-network
```

## 2. Cutover окно — сейчас

@user готов синхронно делать cutover. Запрос к UK on-call:
- [ ] Кто-то на стороне UK мониторит логи + БД 30-60 мин с момента
      получения подтверждения
- [ ] Готовы поднять Phase 2 на прод параллельно (сейчас в DEV)

**Последовательность (на наш runbook):**

```
[UK] выкатывает Phase 2 на прод (deploy + applies migrations)
  → подтверждает в чате "prod ready"
[UK] генерирует UK_WEBHOOK_SECRET + шифрует под наш pubkey + шлёт
  → подтверждает "secret sent"
[InfraSafe] расшифровывает, прописывает в .env, рестарт
  (UK_API_URL=http://uk-management-api:8080 + UK_WEBHOOK_SECRET=<value> + UK_USE_WEBHOOK_SENDER=true)
  → подтверждает "sender enabled"
[InfraSafe] insert тестовой row в uk_outbox
  → drain worker отправляет к http://uk-management-api:8080
[UK] смотрит webhook_inbox: outcome=accepted + request_number
[UK] подтверждает request.created webhook ушёл к нам
[InfraSafe] подтверждает прилёт + AlertRequestMap.uk_request_number filled
[Both] подтверждают boevoy mode
```

Если что-то идёт не так на любом шаге — оба rollback одновременно
(UK: задеплоить Phase 1 обратно или флагнуть; InfraSafe:
`UK_USE_WEBHOOK_SENDER=false` + restart). Готовы синхронно смотреть
`uk_outbox` (мы) ↔ `webhook_inbox` (вы) на проде.

## 3. Ticket 1.9 — Optional fields в UK UI

Запрашиваем тикет в ваш backlog на отображение optional полей из
`alert.created` payload в UK UI заявки. Сейчас они сохраняются в
`webhook_inbox.payload` JSON, но не выводятся для оператора УК.

Поля и зачем:

| Поле | Значение в UI заявки | Приоритет |
|---|---|---|
| `metric_id` + `metric_value` + `metric_unit` | "напряжение 215.3 В (норма 220-240 В)" — оператор УК сразу видит причину | high |
| `infrastructure_type` + `infrastructure_id` | "трансформатор #10" вместо абстрактного "проблема в здании" | medium |
| `alert_id` (InfraSafe internal int) | для debug + cross-ref в наших логах | low |
| `created_at` | время самого алерта (vs `t` подписи) | low |
| `correlation_id` | сквозная трассировка через несколько систем | low |

**Минимальный scope:** `metric_*` и `infrastructure_*` — это то что
сделает UK-операторскую работу осмысленной (они видят "что и насколько").
Остальное — для аудита и debug.

Готовы пройти контракт с обеих сторон когда возьмёте в работу. Не блокер
для cutover.

---

## Summary requests

| # | Что | Когда | Status |
|---|---|---|---|
| ~~A~~ | ~~Финальный production hostname~~ | — | ❌ не нужен (internal) |
| ~~B~~ | ~~curl smoke по public endpoint~~ | — | ❌ не нужен |
| **C** | Deploy Phase 2 на ваш прод + confirm "prod ready" | в начале cutover | ⏳ |
| **D** | `uk-webhook-secret.age` файл (зашифрованный) | в начале cutover | ⏳ |
| **E** | UK on-call присутствие 30-60 мин на cutover | в начале cutover | ⏳ |
| **F** | Ticket 1.9 в ваш backlog (не блокер) | когда удобно | ⏳ |

Готов начинать как только дадите подтверждение готовности on-call (E) +
прод-готовности Phase 2 (C) + зашифрованный секрет (D).

## Reference

- Status response от UK: `docs/audit/2026-05-23-FIX-007-uk-phase2-status-response.md`
- Readiness prompt: `docs/audit/2026-05-23-FIX-007-uk-phase2-readiness-prompt.md`
- Pubkey: `age18rslud30mn29dz54e5kec5wxm049n4v32mpqlavxk2xhrww35g5qjgp2cm`
  (файл с инструкциями: `docs/audit/2026-05-23-FIX-007-uk-secret-exchange-pubkey.md`)
- Deployment plan: `docs/audit/2026-05-22-sprint-9-deployment-plan.md` (Фаза 5 cutover)
