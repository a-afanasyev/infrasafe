# FIX-007 — Вопросы к UK по полному контракту взаимодействия

> **Контекст.** На UK-стороне реализована Фаза 1 нового inbound endpoint
> `POST /api/v2/webhooks/infrasafe/alert` (HMAC-signed alerts). Handoff-документ —
> `~/Code/UK/docs/audit/2026-05-22-FIX-007-infrasafe-operator-handoff.md`.
>
> Этот документ — список вопросов от InfraSafe-стороны для полной сверки контракта
> перед началом имплементации sender'а. Структурирован по блокам — UK сможет
> отвечать инкрементально.
>
> **Адресат.** Команда UK (репозиторий `~/Code/UK/`).
> **Источник.** Архитектурный ревью FIX-007 на стороне InfraSafe, 2026-05-22.
> **Status.** 🟢 Контракт FIX-007 согласован 2026-05-22. Раунды: вопросы InfraSafe
> (A-M) → ответы UK → ответы/вопросы InfraSafe (N) → ответы/вопросы UK (O) →
> ответы InfraSafe (P) → финальные подтверждения UK (Q). InfraSafe открывает Sprint 9.
> Развёрнутая версия: `~/Code/UK/docs/audit/2026-05-22-FIX-007-uk-integration-answers.md`.
>
> **Легенда ответов:** ✅ зафиксировано кодом Фазы 1 · 🔶 дизайн Фазы 2 (требует
> финальной фиксации) · ⚠️ нужна координация / операторское решение.
>
> **Статус Фазы 1 на UK:** реализована, закоммичена (`1ea71dc`, ветка
> `fix/fix-007-inbound-webhook-hmac`), `uk-management-api` пересобран, live-smoke
> пройден (401 без подписи, 202 валидно подписанный, 409 replay). 10/10 тестов.

---

## A. Схема `alert` (БЛОКЕР Phase 2)

**A1. Полный список обязательных полей `alert` в Phase 2.** В handoff-документе
указаны только `severity` и `message`. У нас есть кандидаты — отметьте нужные
или укажите дополнительные:

- `alert_id` (InfraSafe internal int) — нужен для трассировки/debug?
- `type` (`voltage_low`, `voltage_high`, `current_overload`, ...) — нужен для
  маппинга в `uk_category` / `uk_urgency`?
- `infrastructure_type` (`building` / `transformer` / `controller` /
  `cold_water_source` / `heat_source`) — нужен?
- `infrastructure_id` (int) — нужен?
- `external_id` (UUID здания на UK-стороне) — мы резолвим building → external_id
  у себя, передавать?
- `building_ids[]` (массив, если алерт по трансформатору затронул несколько
  зданий) — UK создаёт **одну** заявку на массив или **N** заявок?
- `metric_id`, `metric_value`, `metric_unit` — нужны для отображения у UK?
- `created_at` (когда алерт возник в InfraSafe) — отдельно от `timestamp`
  события?
- `correlation_id` — мы прокидываем UUID для трассировки, UK его сохранит?

> **Ответ UK:** Фаза 1 принимает `alert` как произвольный объект (`alert: dict`),
> поля не валидирует. Набор для Фазы 2 (🔶 принят UK как рабочее предложение):
> - ✅ **Обязательно:** `external_id` (UUID здания — UK резолвит здание по нему;
>   UK индексирует здания по детерминированному `external_id = SHA-256("uk-building-{id}")`),
>   `type`, `severity`, `message`.
> - 🔶 **Желательно:** `alert_id`, `created_at`, `correlation_id` — UK сохранит.
> - 🔶 **Опционально:** `infrastructure_type` / `infrastructure_id` /
>   `metric_id` / `metric_value` / `metric_unit` — сохраним в raw для отображения,
>   не для логики.
> - ❌ **`building_ids[]` не нужен.** Правило: **1 алерт = 1 здание = 1 заявка.**
>   Авария ТП на 5 зданий → шлите **5 отдельных `alert.created`**, каждый со своим
>   `event_id` и одним `external_id`. UK не разворачивает массив в N заявок.

**A2. Severity values.** Какой словарь принимает UK? У нас `low` / `medium` /
`high` / `critical` — соответствуют?

> **Ответ UK:** ✅ Да, `low` / `medium` / `high` / `critical` принимаются.
> Маппинг `severity` → `urgency` — на стороне UK.

**A3. Категория / urgency.** UK сам выводит из `severity` + `type`, или мы
должны передавать `uk_category` / `uk_urgency` в payload (как сейчас делает
наша таблица `alert_rules`)? Если последнее — `alert_rules` нужно
синхронизировать с UK-стороной.

> **Ответ UK:** 🔶 **UK выводит сам** из `type` + `severity`. Не передавайте
> `uk_category` / `uk_urgency` — таксономия категорий UK (`Электрика`,
> `Сантехника`, ...) принадлежит UK, дублировать её в `alert_rules` не нужно.
> **Нужно от InfraSafe:** полный словарь возможных значений `type` — UK составит
> маппинг `type → category`.

**A4. Locale / язык.** `message` шлём на русском как сейчас?

> **Ответ UK:** ✅ Да, `message` — на русском.

---

## B. События за пределами `alert.created`

**B1. Поддерживает ли UK другие события** в этом endpoint, или Phase 1
ограничивается только `alert.created`?

- `alert.acknowledged` (оператор InfraSafe подтвердил)
- `alert.resolved` (метрика вернулась в норму до того, как UK отработал)
- `alert.escalated` (повышение severity)
- `alert.deleted`

> **Ответ UK:** ✅ Фаза 1 принимает **любое** значение `event` в конверте
> (валидируется только подпись + наличие поля). 🔶 Фаза 2 обрабатывает **только
> `alert.created`**. `alert.acknowledged/resolved/escalated/deleted` Фаза 2
> примет (202), но проигнорирует, пока их обработка не реализована отдельно.

**B2.** Если только `alert.created` — как UK хочет получать обновления статуса
(наш acknowledge / resolve)?

- Через тот же endpoint с другим `event`?
- Через отдельный endpoint?
- Никак — UK живёт по своему циклу заявки и InfraSafe-status не интересует?

> **Ответ UK:** 🔶 Рекомендация — **через тот же endpoint с другим `event`**,
> отдельный endpoint не нужен. Важно: `alert.resolved` **не** будет авто-закрывать
> заявку UK — заявка живёт по своему циклу (исполнитель → менеджер). UK может
> сохранить `alert.resolved` как пометку в заявке, не более. Финал — при дизайне
> Фазы 2.

---

## C. Обратная связь (UK → InfraSafe)

**C1. После принятия `alert.created` (202) — что UK шлёт обратно?** У нас уже
есть `/webhooks/uk/request` принимающий `request.created` и
`request.status_changed`. Поток остаётся такой:

- InfraSafe → UK: `alert.created`
- UK → InfraSafe: `request.created` (с `request_number`)
- UK → InfraSafe: `request.status_changed` (терминальный → alert resolve)

Это всё ещё актуально или меняется?

> **Ответ UK:** ✅ Актуально, не меняется. Исходящий канал уже в проде:
> `request.created` / `request.status_changed` уходят в `POST /api/webhooks/uk/request`
> (транзакционный outbox). ⚠️ Нюанс: см. **ARCH-113** в UK-бэклоге — сейчас
> `request.*` эмитятся только при создании заявки через REST API (дашборд),
> бот-путь пока не эмитит. Для Фазы 2 (заявка из вашего алерта создаётся на
> бэкенде) emit будет настроен явно.

**C2. Связь `event_id` ↔ `request_number`.** Сейчас у нас
`AlertRequestMap.idempotency_key`. UK его сохранит, чтобы потом в
`request.created` отдать обратно для матчинга? Или мы должны полагаться на
сопоставление по `alert_id` через payload?

> **Ответ UK:** 🔶 Фаза 2: UK сохранит связь `event_id` (ваш) ↔ `request_number`
> (UK) в служебной таблице маппинга и **вернёт ваш `event_id`** в payload
> `request.created`. Ключ матчинга — `event_id`, на `alert_id` полагаться не нужно.

---

## D. Идемпотентность и retry

**D1. 409 на дубликат `event_id`** — какое тело ответа? Возвращает ли UK
предыдущий `request_number`, чтобы мы могли восстановить маппинг если потеряли
его локально?

> **Ответ UK:** ✅ Фаза 1: тело 409 — `{"detail":"duplicate event"}`, **без**
> `request_number` (в Фазе 1 заявка не создаётся). 🔶 Фаза 2: 409 будет
> возвращать `request_number` ранее созданной заявки — для восстановления маппинга.

**D2. Окно dedup 600s** — после 600s тот же `event_id` примется как новый? То
есть если у нас retry на 11-й минуте — будет создана новая заявка-дубликат?

> **Ответ UK:** ✅ Фаза 1: dedup — Redis TTL **600s**, после 600s тот же
> `event_id` пройдёт как новый. Но: окно подписи 300s — легитимный retry на 11-й
> минуте с **исходным `t`** упадёт на 401 (stale). Дубль-заявка возможна, только
> если sender переподпишет с новым `t`. 🔶 **Фаза 2: UK добавит персистентный
> dedup** (таблица `webhook_inbox`, ключ `event_id`) — окно станет бессрочным.
> Рекомендация: не ретраить один `event_id` дольше ~10 мин.

**D3. Retry-стратегия с нашей стороны.** Какой backoff UK ожидает на 429? 503?
Есть ли `Retry-After` header?

> **Ответ UK:** ✅ `Retry-After` UK сейчас **не отдаёт** (ни 429, ни 503).
> Рекомендуемый backoff — экспоненциальный `2s, 4s, 8s, 16s...`, cap ~5 мин (так
> же работает UK-outbound). 🔶 Добавление `Retry-After` — возьмём в Фазу 2, если
> нужно.

**D4. `event_id` collisions.** UK требует строгий UUID v4, или любую уникальную
строку? Длина?

> **Ответ UK:** ✅ Любая уникальная строка (`event_id: str`), UUID v4 не
> обязателен, ограничения длины нет. Рекомендация — UUID v4. Используется как
> Redis-ключ — избегайте пробелов/спецсимволов.

---

## E. Аутентификация и секреты

**E1. Текущий `UK_WEBHOOK_SECRET`** — он же используется для inbound
(UK → InfraSafe), или для outbound (InfraSafe → UK) будет отдельный секрет? Один
shared secret в обе стороны или два направления — два секрета?

> **Ответ UK:** ✅ **Два направления — два секрета:**
> - InfraSafe → UK (этот endpoint): UK verifier читает `UK_WEBHOOK_SECRET`
>   (+ `UK_WEBHOOK_SECRET_NEXT`). Sender InfraSafe подписывает им же.
> - UK → InfraSafe (`/api/webhooks/uk/request`): UK подписывает
>   `INFRASAFE_WEBHOOK_SECRET` (+ `_NEXT`).
> Это разные значения.

**E2. Ротация после UK FIX-002.** Какое окно даётся sender'у на переключение?
Сколько времени UK будет принимать OLD‖NEW параллельно?

> **Ответ UK:** ⚠️ UK принимает `OLD‖NEW` всё время, пока **оба** заданы в `.env`
> (`UK_WEBHOOK_SECRET` + `UK_WEBHOOK_SECRET_NEXT`). Окно — на ваше усмотрение,
> рекомендуем **≥24 ч**. Конкретное значение `UK_WEBHOOK_SECRET` (ротация после
> FIX-002) согласуем отдельно перед go-live.

**E3. Среда для smoke.** Есть ли отдельный staging UK endpoint и staging
secret, чтобы протестировать не на проде?

> **Ответ UK:** ⚠️ Отдельного staging сейчас нет (проект ведёт один
> разработчик). Вариант — поднять Фазу 1 на dev с тестовым секретом и слать
> события туда (см. L2).

---

## F. Endpoint и сеть

**F1. `UK_API_URL` для нового webhook** — это тот же base URL, что для
текущего `/api/v1/requests` (JWT-путь)? Или отдельный hostname?

> **Ответ UK:** ✅ Новый endpoint — `POST /api/v2/webhooks/infrasafe/alert`,
> базовый URL — тот же UK API. ⚠️ **`/api/v1/requests` на UK не существует** —
> см. раздел G.

**F2. Internal vs external.** Наш sender ходит через `uk-network` docker
network или через публичный `https://infrasafe.uz/uk`? Какой путь UK ожидает в
production?

> **Ответ UK:** ⚠️ Production — предпочтительно **internal через `uk-network`**
> (без выхода в публичный интернет). Внешний путь
> `https://infrasafe.uz/uk/api/v2/webhooks/infrasafe/alert` тоже работает.
> Выберите internal, если контейнеры в одной сети.

**F3. mTLS / IP allowlist.** UK будет фильтровать по source IP? Если да — наш
контейнер выходит из какого внешнего IP (Docker host, или есть NAT)?

> **Ответ UK:** ✅ IP-allowlist UK **не применяет**, mTLS не используется.
> Защита — HMAC-подпись + rate-limit.

**F4. TLS-версия.** Минимум TLS 1.2, или 1.3? Есть ли pinning?

> **Ответ UK:** ✅ TLS терминируется Caddy (prod edge) — TLS 1.2+ (дефолт Caddy),
> pinning нет. Для internal-пути (`uk-network`) — обычный HTTP внутри доверенной
> docker-сети.

---

## G. Существующий JWT-путь (`POST /api/v1/requests`)

**G1. Sunset.** Endpoint `/api/v1/requests` остаётся или его выпиливают после
Phase 2? Если выпиливают — когда?

**G2. Параллельный период.** Нужно ли нам **одновременно** слать и через
JWT-путь, и через новый webhook (для надёжности cutover), или строго один из
двух?

**G3. `UK_SERVICE_USER` / `UK_SERVICE_PASSWORD`** — остаются нужными для
GET-запросов (`/requests/counts-by-building`, `/requests/by-building`), или эти
endpoint'ы тоже переедут на HMAC?

> **Ответ UK (G1-G3):** ⚠️ **Важно: `POST /api/v1/requests` на UK-стороне не
> реализован.** Греп по `uk_management_bot/api/` такого endpoint не находит
> (есть только `/api/v1/media/*` — прокси к media-сервису, не к InfraSafe).
> `UK_SERVICE_USER` / `UK_SERVICE_PASSWORD` и GET `/requests/counts-by-building`
> на UK тоже отсутствуют. Похоже, JWT-путь из старого integration-plan никогда
> не доводился — inbound-канал реализуется впервые как FIX-007 webhook.
> Следствия:
> - **G1** — выпиливать нечего, sunset не нужен.
> - **G2** — параллельный режим не нужен; HMAC-webhook = единственный inbound-канал.
> - **G3** — `UK_SERVICE_USER/PASSWORD` UK не нужны. Если вам нужны GET-данные от
>   UK (counts-by-building и т.п.) — это отдельный запрос, такого API сейчас нет.
>
> ⚠️ Если у вас уже есть рабочая отправка в какой-то UK endpoint — сообщите,
> сверим (возможно, это шло в InfraSafe-собственный `/api/webhooks/uk/*`).

---

## H. Rate-limit и backpressure

**H1. 60/мин per IP** — sliding window или fixed? Token bucket?

> **Ответ UK:** ✅ **Fixed-window**, 60/мин, per source-IP (slowapi). Не sliding,
> не token-bucket.

**H2. Burst.** Допустим, в момент аварии у нас 30 алертов за секунду. UK
примет их в один burst или это сразу 429? Какой sustained rate безопасен?

> **Ответ UK:** ⚠️ 30/сек → **упрётся в 429** (лимит 60/мин ≈ 1/сек sustained).
> Безопасный sustained rate сейчас — **≤60/мин**.

**H3. Batch endpoint.** Есть ли (или планируется) endpoint для отправки
массива событий одним запросом? Это упростило бы шторм-сценарии.

> **Ответ UK:** ✅ Batch-endpoint сейчас нет. 🔶 Решение UK — **отложено до
> получения цифр нагрузки от InfraSafe** (H4). Если шторм-сценарий реален —
> `POST /infrasafe/alert/batch` (массив событий, одна подпись) станет кандидатом
> в Фазу 2. Подтвердите ожидаемый пик.

**H4. Соотношение rate-limit ↔ alert generation rate.** Типичная нагрузка
InfraSafe ~N алертов/час, 60/мин с запасом, но при шторме (отказ ТП на 5
зданий) — упрёмся?

> **Ответ UK:** ⚠️ **Нужна ваша оценка** типовой и пиковой нагрузки (алертов/час
> и пик при аварии). Если пик >60/мин — поднимем лимит для вашего IP или сделаем
> batch (H3). Без цифр дефолт — 60/мин.

---

## I. Ответы и формат ошибок

**I1. 422 envelope** — какой формат? Например:

```json
{"error":"validation_failed","fields":[{"field":"alert.severity","reason":"unknown_value"}]}
```

— или произвольный текст?

> **Ответ UK:** ✅ Решение UK — **дефолтный FastAPI-конверт** `{"detail": "<текст>"}`,
> без структурированного `fields[]`. 422 → `{"detail":"invalid payload schema"}`.
> Машиночитаемый формат с `fields[]` пока не планируется; если он критичен для
> sender'а — сообщите, пересмотрим.

**I2. 401 envelope.** UK различает причины (bad signature / expired timestamp /
unknown secret) в ответе, или общий 401 без подсказок?

> **Ответ UK:** ✅ 401 **различает причину** в `detail`: `signature no_header` /
> `signature bad_format` / `signature stale` / `signature no_match` — удобно для
> отладки sender'а.

**I3. 503 envelope.** Будет ли `Retry-After`?

> **Ответ UK:** ✅ 503 → `{"detail":"webhook receiver not configured"}`, **без**
> `Retry-After`. 503 означает, что на UK не задан `UK_WEBHOOK_SECRET` —
> операторская проблема UK, ретрай поможет только после её устранения.

---

## J. Observability

**J1. Correlation ID.** UK ожидает / поддерживает header `x-correlation-id` для
сквозной трассировки? Возвращает обратно в response header?

> **Ответ UK:** ✅ Фаза 1 header `x-correlation-id` **не обрабатывает** и не
> возвращает. 🔶 Рекомендация: кладите `correlation_id` внутрь `alert` (A1) — UK
> сохранит. Поддержку header с эхом в response добавим в Фазе 2, если нужно.

**J2. Логи у UK.** UK хранит входящие webhooks? Если в проде что-то не дошло,
есть ли с UK-стороны journal для разбора?

> **Ответ UK:** ✅ Фаза 1 — аудит только в структурированных логах (`event_id`,
> source_ip, outcome, причина). Персистентного журнала пока нет. 🔶 Фаза 2 —
> таблица `webhook_inbox` (durable audit + idempotency), появится journal для
> разбора инцидентов.

**J3. Алёрты от UK.** UK уведомит нас (как операторов InfraSafe), если sender
начнёт стабильно проваливать подпись или схему?

> **Ответ UK:** ⚠️ Авто-уведомлений вам при стабильных провалах сейчас нет.
> UK видит это в логах. Настройка алертинга — отдельная OPS-задача; канал связи
> для инцидентов согласуем на go-live.

---

## K. Время и NTP

**K1. NTP source.** UK синхронизируется по какому source? Если расхождение
между нашими хостами систематическое — нужно ли подстраивать на нашей стороне?

> **Ответ UK:** ⚠️ UK-хосты — штатный NTP ОС (контейнеры наследуют время
> docker-host). Систематического сдвига быть не должно; окно 300s имеет запас.
> Если увидите дрейф — сообщите.

**K2. Timestamp в payload (`timestamp`) vs timestamp в подписи (`t`).** UK
сверяет оба, или только `t` из header?

> **Ответ UK:** ✅ UK сверяет **только `t` из header-подписи** (окно 300s). Поле
> `timestamp` внутри payload **не проверяется** — информационная метка, хранится
> как есть. `t` и `timestamp` могут отличаться.

---

## L. Тестовые fixture / sanity

**L1. Reference payload + signature.** Может UK предоставить готовый пример:
`body` + `secret` + ожидаемая `signature` + ожидаемый ответ? Тогда мы напишем
pin-test на симметрию (наш sender должен генерить ровно эту подпись).

> **Ответ UK:** ✅ Reference-вектор для pin-теста:
> ```
> secret  : uk_webhook_shared_secret_DEMO
> t       : 1747900800
> body    : {"event_id":"11111111-1111-4111-8111-111111111111","event":"alert.created","timestamp":"2026-05-22T12:00:00Z","alert":{"severity":"high","message":"test"}}
> message : "1747900800." + body
> v1      : 6fe9e4327b7e9c9e22e49442cc376650358ca7894b1102615274e0ba9d47a1dc
> header  : x-webhook-signature: t=1747900800,v1=6fe9e4327b7e9c9e22e49442cc376650358ca7894b1102615274e0ba9d47a1dc
> ```
> `body` подписывается и отправляется байт-в-байт. Этот `t` в проде даст 401
> (stale) — вектор только для проверки симметрии алгоритма.

**L2. Staging smoke.** После нашей готовности sender'а UK поднимет dry-run
endpoint, чтобы мы прогнали ~10 событий и убедились в 202? Phase 1 endpoint
подходит для этого?

> **Ответ UK:** 🔶 Да — после готовности sender'а UK поднимет Фазу 1 на dev с
> тестовым секретом, прогоните ~10 событий, ждём 202. Phase 1 endpoint подходит
> (валидирует весь envelope, просто не создаёт заявку).

**L3. Negative cases.** Какие именно malformed payloads UK хочет, чтобы мы
протестили (для покрытия 401/422)?

> **Ответ UK:** Со стороны sender'а проверьте: (a) нет header → 401; (b) подпись
> чужим секретом → 401; (c) `t` старше 300s → 401; (d) тело без `event_id` → 422;
> (e) тот же `event_id` дважды → 409. UK эти кейсы уже покрывает (10/10 тестов).

---

## M. Phase 2 timeline и зависимости

**M1.** Когда UK планирует выкатить **Phase 1** в staging? Production?

> **Ответ UK:** ✅ Фаза 1 — реализована, закоммичена (`1ea71dc`), `uk-management-api`
> пересобран, live-smoke пройден на dev-окружении. Прод-выкатка — после push/PR
> и согласования значения секрета.

**M2.** Когда **Phase 2** (request creation из webhook) — есть оценка?

> **Ответ UK:** ⚠️ Фаза 2 — отдельный ticket. Оценка — после фиксации схемы
> `alert` (раздел A) и решения echo-loop с ARCH-113. Конкретные даты сообщим
> после планирования.

**M3. Здания и предварительная индексация.** Какие данные о здании UK уже
имеет к моменту приёма `alert.created`? Нужно ли нам перед первым алертом по
новому зданию убедиться, что `building.created` доехал и UK его проиндексировал?

> **Ответ UK:** ⚠️ Да — к моменту приёма `alert.created` UK должен **уже иметь
> это здание** (Фаза 2 резолвит `external_id` → building). Здания
> синхронизируются UK→InfraSafe (`building.created` webhook + hourly
> reconciliation). Перед первым алертом по новому зданию убедитесь, что
> `building.created` доехал. Если UK не найдёт здание по `external_id` — Фаза 2
> вернёт ошибку (код согласуем — вероятно 422 или 409).

**M4. Backfill.** Если у InfraSafe накопились алерты во время downtime UK
Phase 1, шлём ли мы их все скопом после восстановления, или дропаем?

> **Ответ UK:** 🔶 Не слать накопленное скопом (упрётесь в 60/мин + риск дублей).
> Дренируйте очередь плавно ≤60/мин; идемпотентность по `event_id` (после
> персистентного dedup Фазы 2) защитит от дублей. До Фазы 2 старые алерты лучше
> дропать — Фаза 1 их всё равно не обрабатывает.

---

## Cheatsheet для UK-сессии (приоритеты)

```
A1, A2, A3 — критично, блокирует имплементацию sender'а
B1, C1     — определяет, чем мы шлём (один event или N)
D1, D3     — определяет retry-логику
E1, E2     — операторская задача, нужна до go-live
G1, G2     — определяет нужен ли параллельный режим
L1         — нужно для pin-теста
M1, M2     — для планирования спринтов
```

---

## Следующий шаг

После получения ответов от UK:

1. Свести матрицу "наш sender / факт из UK"
2. Зафиксировать схему `alert` Phase 2
3. Открыть Sprint 9 (`feat/sprint-9-fix-007-sender`) под их конкретные значения
4. Имплементировать sender за feature-flag `UK_USE_WEBHOOK_SENDER=false` (по
   умолчанию выключен до Phase 2)
5. Согласовать окно деплоя + значение секрета с UK-ops

---

## Что UK ждёт от InfraSafe (по итогам ответов)

| # | Нужно от InfraSafe | Статус |
|---|---|---|
| A1/A3 | Полный словарь значений `type` — для маппинга `type → category` на UK | ✅ см. § N1 ниже |
| H2/H4 | Типовой и пиковый rate алертов (алертов/час + пик при аварии ТП) | ✅ см. § N2 ниже |
| H3 | Подтвердить, нужен ли batch-endpoint | ✅ см. § N3 ниже |
| G | Подтвердить, что `/api/v1/requests` у вас нигде не используется | ✅ см. § N4 ниже |
| E2 | Согласовать значение `UK_WEBHOOK_SECRET` и окно ротации перед go-live | ⚠️ см. § N5 ниже |

---

# N. Ответы InfraSafe → UK (2026-05-22, post-discovery)

> **Метод сбора.** Грепы по `src/services/alertService.js`, `src/services/uk/alertForwarder.js`,
> `src/clients/ukApiClient.js`; запросы к локальной БД (`alert_types`, `alert_rules`);
> анализ кода `src/services/uk/buildingSync.js` (направление синхронизации зданий).
> Прод-БД для rate-estimate не доступна из CLI — даём оценку по инфраструктуре.

## N1 — Словарь значений `type` (ответ на A1/A3)

⚠️ **Важное замечание для UK.** У InfraSafe в БД сейчас сосуществуют **два
несогласованных словаря**:

### N1.1 Static seed (`alert_types` table, 7 записей)

Используются как FK-ссылки в `alerts.alert_type_id`, но **в коде Phase 7+ не
эмитятся** (legacy от старой схемы):

| `type_name` | `description` |
|---|---|
| `POWER_FAILURE` | Отключение электроэнергии |
| `WATER_LEAK` | Утечка воды |
| `OVERHEATING` | Перегрев оборудования |
| `LOW_PRESSURE` | Низкое давление в системе |
| `COMMUNICATION_LOST` | Потеря связи с контроллером |
| `VOLTAGE_ANOMALY` | Аномалия напряжения |
| `TEMPERATURE_ANOMALY` | Аномалия температуры |

### N1.2 Реально эмитятся в код-пути → UK (`alert_rules` table, 5 уникальных типов)

Это то, что **фактически уйдёт в `alert.type`** при отправке через webhook —
от этих имён зависит маппинг UK:

| `alert_type` | Допустимые `severity` | Текущий `uk_category` (для справки) |
|---|---|---|
| `TRANSFORMER_OVERLOAD` | `WARNING`, `CRITICAL` | Электрика |
| `TRANSFORMER_CRITICAL_OVERLOAD` | `CRITICAL` | Электрика |
| `VOLTAGE_ANOMALY` | `WARNING` | Электрика |
| `LEAK_DETECTED` | `WARNING`, `CRITICAL` | Сантехника |
| `HEATING_FAILURE` | `CRITICAL` | Отопление |

### N1.3 Severity values

InfraSafe-side использует **`WARNING` / `CRITICAL`** в `alert_rules` (не
`low/medium/high/critical` как в handoff-документе). UK подтвердил A2, что
принимает `low/medium/high/critical` — нужен **общий язык**:

**Предложение для UK:** принять InfraSafe-словарь `WARNING` / `CRITICAL`
напрямую (только два значения), либо мы делаем маппинг на нашей стороне:
- `WARNING` → `medium`
- `CRITICAL` → `critical`

Какой вариант UK предпочитает?

### N1.4 Будущие расширения (на запас)

Если UK уже сейчас зарезервирует маппинг — мы избежим повторного раунда при
включении этих сценариев:

| Возможный `type` | Когда появится | Желаемая `category` |
|---|---|---|
| `COMMUNICATION_LOST` | контроллер вне сети >N мин | Электрика / Связь |
| `POWER_FAILURE` | полное отключение здания | Электрика |
| `TEMPERATURE_ANOMALY` | отопительный сезон | Отопление |
| `OVERHEATING` | перегрев ТП / оборудования | Электрика |
| `LOW_PRESSURE` | давление в водопроводе ниже нормы | Сантехника |
| `WATER_LEAK` | резерв (сейчас используется `LEAK_DETECTED`) | Сантехника |

**Вопрос UK обратно (N1-Q1).** Чтобы избежать второго cycle, какие из этих
типов вы готовы принять в маппинг сразу, и какую `category` каждому
присвоите?

**Вопрос UK обратно (N1-Q2).** Делать ли нам перед Sprint 9 миграцию
unification (выпрямить расхождение N1.1 vs N1.2 в нашей БД), или оставить
текущее состояние и слать UK только то, что в `alert_rules`?

---

## N2 — Rate алертов (ответ на H2/H4)

⚠️ Прод-БД на момент сбора не доступна из CLI; даю **оценку по инфраструктуре**.
Точные цифры пришлю отдельно после прод-запроса.

### N2.1 Параметры системы

- 17 зданий в Ташкенте (`buildings` table)
- ~5-10 контроллеров на здание (по типам инфраструктуры)
- Cooldown 15 мин между идентичными алертами
  (`src/services/alertService.js`, key = `{type}:{entity_id}`)
- Источники алертов: 4 категории — power (transformers), water (leaks/pressure),
  heat (failures), comms (controller offline)

### N2.2 Оценочный нормальный режим

- **Типовая нагрузка:** 1-10 алертов в час, ≈ **0.05-0.2 алертов/мин**
- Среднее далеко ниже 60/мин лимита

### N2.3 Пиковые сценарии

| Сценарий | Кол-во событий | Окно | Эффективный rate |
|---|---|---|---|
| Авария ТП на 5 зданий | 5 `alert.created` | <30s | 10/сек **локально**, но fan-out по 1 алерту/здание → размазывается до ~10/мин |
| Массовая потеря связи (отказ хаба) | до 50-100 `COMMUNICATION_LOST` | 1-2 мин | до **50/мин** на 1.5 мин — **близко к лимиту** |
| Каскад: ТП + потеря связи | 50-100 | 1-2 мин | до **60/мин** — **упрёмся в 429** |

### N2.4 Решение InfraSafe-side

Чтобы не зависеть от поднятия лимита UK:

1. Реализуем **outbox-таблицу** `uk_outbox` (persistent очередь)
2. Drain-worker отправляет ≤ **30/мин** (50% безопасный запас от 60/мин)
3. При получении 429 — exponential backoff (2/4/8/16s cap 5 мин) и не уменьшать темп drain'а
4. Backfill при downtime UK — тоже через outbox, drain ≤30/мин

**Вопрос UK обратно (N2-Q1).** Если темп drain'а 30/мин (т.е. 1 алерт каждые
2 секунды) комфортен для UK, и пик не превысит 60/мин — batch-endpoint **не
нужен**. Подтверждаете?

---

## N3 — Batch endpoint (ответ на H3)

✅ **InfraSafe-side: batch-endpoint не требуется**, при условии:
- Outbox + drain ≤30/мин на нашей стороне (см. N2)
- 429 backoff по экспоненте

Можно отложить batch на Phase 3+ или дропнуть из roadmap.

---

## N4 — Подтверждение dead JWT-пути (ответ на G)

✅ **Подтверждаем выводы UK по G:** в репозитории InfraSafe есть код, который
обращается к несуществующим UK endpoint'ам — это **dead-on-prod** (никогда
не работало end-to-end, хотя код compile/тестируется в моках).

### N4.1 Места, где код вызывает несуществующие UK endpoint'ы

| Файл | Строка | Что вызывает |
|---|---|---|
| `src/clients/ukApiClient.js:90` | `POST {UK_API_URL}/api/requests` | `createRequest()` |
| `src/services/uk/configProxy.js:121` | `GET /requests/counts-by-building` | `getRequestCounts()` |
| `src/services/uk/configProxy.js:148` | `GET /requests/by-building?external_id=...` | `getBuildingRequests()` |
| `src/services/uk/alertForwarder.js:143` | вызов `ukApiClient.createRequest(...)` | `sendAlertToUK()` |

### N4.2 ENV-переменные, которые ставятся, но не используются на UK

- `UK_SERVICE_USER`
- `UK_SERVICE_PASSWORD`
- `UK_API_URL` (используется и для нового webhook — здесь живой)

`UK_SERVICE_USER` / `UK_SERVICE_PASSWORD` в `src/config/env.js:45` помечены
required — после удаления dead-кода это надо убрать.

### N4.3 План удаления (внутри Sprint 9)

- Удалить `src/clients/ukApiClient.js`
- Убрать `ukApiClient` requires в `configProxy.js` и `alertForwarder.js`
- Заглушить `getRequestCounts()` / `getBuildingRequests()` (возвращают
  `{buildings:{}}` / `{requests:[]}` — стиль graceful degradation; frontend
  на этих данных рисует overlay поверх карты)
- Убрать `UK_SERVICE_USER` / `UK_SERVICE_PASSWORD` из `env.js` required-set
- Дропнуть тесты `tests/jest/unit/ukApiClient.test.js`
- Подправить `tests/jest/unit/ukIntegrationServiceTest.test.js` где тестируется
  cache-логика на `ukApiClient.get` mock

### N4.4 Что это даёт UK

- Sender InfraSafe → UK перейдёт **полностью на HMAC-webhook**
- Параллельный JWT-режим не нужен (его не было)
- Counter / list endpoints (`/requests/counts-by-building`, `/requests/by-building`)
  — будут как-то нужны для дашборда InfraSafe (там показываются counts заявок
  по зданию). UK подтвердил, что таких endpoint'ов **нет**.

**Вопрос UK обратно (N4-Q1).** Будут ли реализованы GET-endpoint'ы
`/requests/counts-by-building` и `/requests/by-building` в Phase 2+? Это
нужно для UI-overlay карты InfraSafe (показ количества активных заявок
на здании). Если нет — мы дропаем эту фичу или поднимаем её на нашей стороне
по событиям `request.created` / `request.status_changed`, которые UK уже шлёт.

---

## N5 — Секреты и ротация (ответ на E2)

⚠️ **Операторская задача — нужна координация перед go-live.**

### N5.1 Текущее состояние секретов на InfraSafe

| Секрет | Назначение | Существует в `.env`? |
|---|---|---|
| `UK_WEBHOOK_SECRET` | inbound от UK (verifier) | ✅ да |
| `INFRASAFE_WEBHOOK_SECRET` | sender от UK (verifier) — это **на стороне UK**, не у нас | n/a |
| `UK_WEBHOOK_SECRET_NEXT` | dual-secret поддержка | ❌ нет |
| `UK_USE_NEXT_SECRET` | флаг переключения | ❌ нет |

### N5.2 Уточнение по E1

В handoff UK сказал "Два направления — два секрета":
- IS→UK: подписываем `UK_WEBHOOK_SECRET`, UK его проверяет.
- UK→IS: UK подписывает `INFRASAFE_WEBHOOK_SECRET`, мы его проверяем.

Сейчас на InfraSafe **один секрет** `UK_WEBHOOK_SECRET`, и он используется
для **верификации входящих**. То есть в текущем naming он играет роль
`INFRASAFE_WEBHOOK_SECRET` из терминологии UK.

**Вопрос UK обратно (N5-Q1).** Уточнить naming перед ротацией, чтобы не
перепутать:
- Будет ли UK добавлять и `INFRASAFE_WEBHOOK_SECRET`, и `UK_WEBHOOK_SECRET`
  в свой `.env`?
- На стороне InfraSafe текущий `UK_WEBHOOK_SECRET` оставить как inbound
  verifier secret (переименовать в `INFRASAFE_WEBHOOK_SECRET` для
  симметрии?), и добавить отдельный новый `UK_WEBHOOK_SECRET` для outbound?

### N5.3 Согласование значения и окна ротации

- ✅ Согласны на окно ≥24 часа параллельного приёма OLD‖NEW
- ⚠️ Перед go-live согласуем конкретное значение `UK_WEBHOOK_SECRET` (UK
  FIX-002 — ротация после exposure) — отдельным каналом, не в git
- Готовы поддержать `UK_USE_NEXT_SECRET=true` флаг на нашей стороне

**Вопрос UK обратно (N5-Q2).** Когда UK будет готов раскрыть финальное
значение секрета — через какой канал передаёте? (Vault, password manager,
encrypted email?)

---

## N6 — Outbound building sync (ответ на M3)

⚠️ Замечание по M3: на стороне InfraSafe **outbound building sync (IS→UK)
не реализован**. Направление синхронизации зданий — **только UK → InfraSafe**
(`src/services/uk/buildingSync.js` обрабатывает входящие webhooks). Это
значит:

- **UK = source of truth для зданий**
- InfraSafe принимает `building.created` / `.updated` / `.deleted` webhooks
  от UK
- Когда InfraSafe эмитит `alert.created`, в payload идёт `external_id` из
  своей таблицы `buildings` (поле уже заполнено через UK-sync)
- Если у здания `external_id IS NULL` (создано вручную в InfraSafe без
  UK-инициации) — `alertForwarder.resolveBuildingIds()` его **отфильтрует**
  и алерт по такому зданию в UK не уйдёт

### N6.1 Вопросы UK по M3

**Вопрос UK обратно (N6-Q1).** Допустимо ли, чтобы InfraSafe **никогда** не
создавал здания самостоятельно, кроме как через UK-инициируемый
`building.created` webhook? Если допустимо — текущая архитектура корректна.
Если нет — нам нужен outbound `building.created` (IS → UK), но это
большая отдельная задача.

**Вопрос UK обратно (N6-Q2).** Hourly reconciliation, упомянутая в M3 — это
UK→IS reconciliation (UK обходит список и шлёт нам updates), или
двунаправленная? Если UK→IS — это уже работает; если двунаправленная —
нужны эндпоинты с нашей стороны (тоже не было реализовано).

---

## N7 — Cheatsheet: что нужно сделать UK / InfraSafe перед go-live

### Со стороны UK

| Шаг | Блокер для | Готовность |
|---|---|---|
| N1-Q1: маппинг типов из § N1.2 + ответ по расширениям § N1.4 | имплементация sender'а | ⏳ ждём |
| N1-Q2: решение по unification словаря | миграция InfraSafe-БД | ⏳ ждём |
| N2-Q1: подтверждение 30/мин drain rate | архитектура outbox | ⏳ ждём |
| N4-Q1: судьба GET `/requests/counts-by-building` | UI-карта InfraSafe | ⏳ ждём |
| N5-Q1: финал naming секретов | конфигурация .env | ⏳ ждём |
| N5-Q2: канал передачи секрета | go-live | ⏳ ждём |
| N6-Q1: разрешено ли InfraSafe-only здания | архитектурное решение | ⏳ ждём |
| N6-Q2: природа hourly reconciliation | возможный новый scope | ⏳ ждём |
| **Phase 2 deploy** | go-live алертов | ⏳ ждём |

### Со стороны InfraSafe (после ответов UK)

| Шаг | Зависит от | Готовность |
|---|---|---|
| Sprint 9: sender + outbox + fan-out + тесты | N1-Q1, N2-Q1, N5-Q1 | планируется |
| Удаление dead JWT-пути (см. § N4.3) | подтверждение UK получено ✅ | готово к работе |
| Прод-замер rate (`SELECT ... FROM alerts GROUP BY hour`) | — | нужно отдельное окно с прод-доступом |
| Унификация словаря `alert_types` / `alert_rules` | N1-Q2 | ждём ответа |
| `UK_USE_WEBHOOK_SENDER=false` feature-flag | — | внутри Sprint 9 |
| Smoke на dev-UK с reference vector (§ L1) | UK Phase 1 deploy | ждём UK |
| Согласование секрета и ротация | N5-Q1, N5-Q2 | ждём UK |

---

# O. Ответы UK на встречные вопросы InfraSafe (раздел N), 2026-05-22

> Ответ UK на все N-Q вопросы. Легенда: ✅ зафиксировано · 🔶 дизайн Фазы 2 ·
> ⚠️ требует координации/операторского решения.

## O0 — 🔴 Критично: рассогласование `severity` (по N1.3)

InfraSafe эмитит `WARNING` / `CRITICAL` (таблица `alert_rules`), а handoff-документ
UK ошибочно указывал `low/medium/high/critical`.

✅ **Решение UK: принимаем фактические значения InfraSafe — `WARNING` / `CRITICAL`
напрямую.** Маппинг `severity → urgency` — полностью на стороне UK. InfraSafe
**ничего не маппит** — шлите `severity` ровно как в `alert_rules`. UK поправит
handoff-документ (там значения были указаны неверно). Схема `alert` Фазы 2:
`severity ∈ {WARNING, CRITICAL}`.

## O1 — Маппинг `type → category` (ответ на N1-Q1)

✅ **Активные 5 типов — приняты:**

| `alert_type` | UK `category` |
|---|---|
| `TRANSFORMER_OVERLOAD` | Электрика |
| `TRANSFORMER_CRITICAL_OVERLOAD` | Электрика |
| `VOLTAGE_ANOMALY` | Электрика |
| `LEAK_DETECTED` | Сантехника |
| `HEATING_FAILURE` | Отопление |

🔶 **Будущие типы (N1.4) — маппинг зарезервирован:**

| `alert_type` | UK `category` |
|---|---|
| `POWER_FAILURE` | Электрика |
| `OVERHEATING` | Электрика |
| `TEMPERATURE_ANOMALY` | Отопление |
| `LOW_PRESSURE` | Сантехника |
| `WATER_LEAK` | Сантехника |
| `COMMUNICATION_LOST` | **Безопасность** ⚠️ |

⚠️ У UK **нет категории «Связь»**. Полный список категорий UK: `Электрика`,
`Сантехника`, `Отопление`, `Вентиляция`, `Лифт`, `Уборка`, `Благоустройство`,
`Безопасность`, `Интернет/ТВ`, `Другое`. Для `COMMUNICATION_LOST` UK предлагает
`Безопасность` (потеря связи с контроллером — вопрос безопасности инфраструктуры);
альтернатива — `Другое`. **Вопрос InfraSafe (O1-Q1):** устраивает `Безопасность`?

✅ **Fallback:** неизвестный `type` (нет в маппинге) → `category = "Другое"`.
UK не упадёт на незнакомом типе — заявка создастся в «Другое».

## O2 — Unification словаря InfraSafe (ответ на N1-Q2)

✅ UK **не требует** от InfraSafe миграцию БД. Шлите только то, что реально в
`alert_rules` (5 типов). Расхождение `alert_types` (legacy seed) vs `alert_rules` —
внутреннее дело InfraSafe, UK на него не завязан: маппинг идёт по фактически
пришедшему значению `type` + fallback «Другое». Unification на вашей стороне —
по желанию, не блокер для UK.

## O3 — Drain rate / batch (ответ на N2-Q1, N3)

✅ **Подтверждаем: drain 30/мин комфортен для UK.** Это вдвое ниже лимита 60/мин
(fixed-window). При пике ≤60/мин 429 не будет. **Batch-endpoint не нужен** — UK
убирает его из roadmap. Решение InfraSafe (свой `uk_outbox` + drain ≤30/мин +
exp-backoff на 429) UK полностью устраивает — зеркалит собственный outbox-паттерн UK.

## O4 — GET `/requests/counts-by-building` (ответ на N4-Q1)

✅ UK **не будет** реализовывать `/requests/counts-by-building` и
`/requests/by-building` — это новая аутентифицированная API-поверхность без
достаточного обоснования. InfraSafe строит счётчик заявок по зданию **из событий**
`request.created` / `request.status_changed`, которые UK уже шлёт в
`/api/webhooks/uk/request`.

🔴 **ВАЖНОЕ предупреждение — зависимость от ARCH-113.** Сейчас UK эмитит `request.*`
**только** при создании заявки через REST API (дашборд). Заявки из Telegram-бота
(основной канал подачи жителями) `request.*` **не эмитят** (баг ARCH-113 в
UK-бэклоге). Если InfraSafe построит счётчики только по событиям — **до фикса
ARCH-113 они недосчитают все бот-заявки**, а это бо́льшая часть потока.

UK берёт **ARCH-113 в работу как зависимость этой фичи** — emit `request.*` будет
унифицирован для bot- и API-путей. Точная связка сроков ARCH-113 ↔ построение
счётчиков InfraSafe — согласуем при планировании Фазы 2. **До фикса ARCH-113
счётчики InfraSafe считать неполными.**

## O5 — Naming секретов (ответ на N5-Q1)

✅ **Симметричная схема — обе стороны используют ОДНИ И ТЕ ЖЕ 2 имени для 2
каналов, с одинаковыми значениями:**

| Канал | Подписывает | Верифицирует | Env-имя (обе стороны) |
|---|---|---|---|
| InfraSafe → UK (`alert.*`) | InfraSafe | UK | `UK_WEBHOOK_SECRET` |
| UK → InfraSafe (`request.*`) | UK | InfraSafe | `INFRASAFE_WEBHOOK_SECRET` |

Два **разных значения**. Что делает InfraSafe:
1. Текущий ваш `UK_WEBHOOK_SECRET` сейчас верифицирует входящие UK→IS — это канал
   `INFRASAFE_WEBHOOK_SECRET`. **Переименовать** его в `INFRASAFE_WEBHOOK_SECRET`.
2. **Добавить новый** `UK_WEBHOOK_SECRET` — для подписи исходящих IS→UK; его
   значение = UK-шный `UK_WEBHOOK_SECRET` (согласуем, см. O6).
3. **Добавить** `UK_WEBHOOK_SECRET_NEXT` + `UK_USE_NEXT_SECRET` (флаг) — для
   dual-secret ротации (предусловие R-18). У UK обе переменные уже есть.

После этого naming симметричен, путаницы нет.

## O6 — Канал передачи секрета (ответ на N5-Q2)

⚠️ **Не git, не plaintext-email.** UK сгенерит значение `UK_WEBHOOK_SECRET`
командой `openssl rand -hex 32` (как при FIX-002) и передаст через защищённый
канал: общий password-manager либо зашифрованное сообщение (`age` / `gpg` /
Signal). Конкретный канал — операторское решение, согласуем отдельно перед
go-live. Окно параллельного приёма OLD‖NEW — ≥24 ч (UK подтвердил в E2).

## O7 — InfraSafe не создаёт здания сам (ответ на N6-Q1)

✅ **Да, допустимо и желательно.** UK — единственный source of truth для зданий
(создаются в UK-дашборде/боте). InfraSafe должен только принимать
`building.created/.updated/.deleted` webhooks от UK. Outbound `building.created`
(IS → UK) **не нужен** — текущая архитектура корректна. Здания с
`external_id IS NULL`, созданные вручную в InfraSafe, корректно отфильтровываются
вашим `alertForwarder.resolveBuildingIds()` — это ожидаемое поведение.

## O8 — Природа hourly reconciliation (ответ на N6-Q2)

✅ Reconciliation — **только UK → IS, односторонняя.** `reconcile_buildings`
(UK `services/reconciliation.py`, раз в час, advisory-lock) делает: UK тянет
инвентарь InfraSafe (`GET /api/buildings-metrics`), вычисляет set-diff по
детерминированному `external_id`, до-отправляет пропавшие `building.created`
через свой outbox. **Со стороны InfraSafe новых эндпоинтов не требуется** —
используется только уже существующий `GET /api/buildings-metrics`. Двунаправленной
reconciliation нет. Уже работает в проде.

## O9 — Новый scope Фазы 2 (вытекает из раздела N)

🔶 Зафиксировано для дизайна Фазы 2 на UK-стороне:
- Схема `alert`: `severity ∈ {WARNING, CRITICAL}` (O0).
- Резолв `external_id` → building: InfraSafe шлёт `external_id` =
  `SHA-256("uk-building-{id}")`. UK его не хранит, а вычисляет
  (`reconciliation._expected_external_id`). Фаза 2 — обратный матч (перебор по
  активным зданиям либо persist `external_id` отдельным полем).
- **ARCH-113** — зависимость O4 (emit `request.*` из бота).
- `webhook_inbox` — персистентный dedup + audit (упомянут в D2/J2).

## O10 — Открытые вопросы UK → InfraSafe (требуют ответа)

| # | Вопрос | Блокирует |
|---|---|---|
| **O1-Q1** | Категория `Безопасность` для `COMMUNICATION_LOST` устраивает? (у UK нет «Связь») | маппинг будущих типов |
| **O0-ack** | Подтвердите: InfraSafe шлёт `severity` как `WARNING`/`CRITICAL` без маппинга | схема Фазы 2 |
| **O6-ack** | Согласовать конкретный защищённый канал передачи секрета | go-live |

## O11 — Сводка: статус согласования

| Тема | Статус после раунда N↔O |
|---|---|
| Схема `alert` (поля) | ✅ согласована (A1 + O0 severity) |
| Маппинг `type → category` | ✅ 5 активных + 6 будущих (O1), ждём O1-Q1 по `COMMUNICATION_LOST` |
| Severity vocabulary | ✅ `WARNING`/`CRITICAL`, UK мапит сам (O0) |
| Batch / rate | ✅ закрыто — drain 30/мин, batch не нужен (O3) |
| Dead JWT-путь | ✅ закрыто — InfraSafe удаляет в Sprint 9 (N4) |
| GET counts-by-building | ✅ UK не делает; InfraSafe строит из событий ⚠️ зависит от ARCH-113 (O4) |
| Naming секретов | ✅ схема дана (O5), InfraSafe переименовывает + добавляет |
| Канал передачи секрета | ⚠️ согласовать (O6) |
| Building sync / reconciliation | ✅ закрыто — UK source of truth, UK→IS reconcile (O7, O8) |
| Phase 2 timeline | ⏳ UK сообщит после планирования |

**Готово к открытию InfraSafe Sprint 9** после ответа на O1-Q1 + O0-ack + O6-ack
(все три — лёгкие подтверждения, не блокеры дизайна).

---

# P. Ответы InfraSafe на ack-вопросы UK (раздел O10), 2026-05-22

> Закрываем последний раунд согласований перед открытием Sprint 9.

## P1 — Ответ на O1-Q1 (категория `COMMUNICATION_LOST`)

✅ **Принимаем `Безопасность`** для `COMMUNICATION_LOST`.

Обоснование: потеря связи с контроллером — это не «связь» в смысле «интернет/ТВ
для жителя», а **риск безопасности инфраструктуры** (контроллер вне мониторинга
→ мы не видим аварии в реальном времени). Семантически совпадает с
«Безопасность». «Другое» скрыло бы критичность.

**Финальный маппинг `COMMUNICATION_LOST` → `Безопасность`** — зафиксирован.

## P2 — Ответ на O0-ack (severity vocabulary)

✅ **Подтверждаем:** InfraSafe шлёт `severity` строго в значениях
`WARNING` / `CRITICAL` (как в `alert_rules`), **без какого-либо маппинга на нашей
стороне**. UK сам выполняет `severity → urgency`. Схема `alert` Фазы 2 фиксирует
`severity ∈ {WARNING, CRITICAL}`.

Действие на InfraSafe-side: в Sprint 9 sender'е НЕ добавляем
`severity.toLowerCase()` или подобных трансформаций — поле передаётся as-is.

## P3 — Ответ на O6-ack (канал передачи секрета)

✅ **Предпочтительный канал — `age`-зашифрованный файл.** Причины:
- Не требует общей инфраструктуры (нет shared password manager между командами InfraSafe/UK).
- Получатель генерит keypair заранее (`age-keygen -o is-secret.key`), отправляет
  публичный ключ UK; UK шифрует значение (`age -R is-secret.pub -o secret.age`)
  и шлёт **любым** каналом (email, мессенджер — содержимое уже зашифровано
  под публичный ключ получателя).
- Аудит-trail: зашифрованный артефакт можно сохранить, расшифровать только
  владельцу приватного ключа.

**Fallback варианты** (если `age` неудобен на UK-стороне):
1. **GPG/PGP** — те же гарантии, чуть тяжелее в настройке.
2. **Signal** — шифрование канала + ephemeral messages (auto-delete через час).
3. **1Password / Bitwarden shared vault** — если у UK есть аккаунт, готовы
   присоединиться.

**Действие перед go-live:** InfraSafe сгенерит `age` keypair и пришлёт публичный
ключ UK отдельным сообщением. UK генерит `UK_WEBHOOK_SECRET` через
`openssl rand -hex 32`, шифрует под наш публичный ключ, шлёт. Окно ротации
OLD‖NEW — ≥24 ч (E2/O5).

## P4 — Открытые от InfraSafe → UK (для отслеживания)

| # | Действие | На ком |
|---|---|---|
| P1-fin | Зафиксировать `COMMUNICATION_LOST → Безопасность` в UK type-mapping | UK |
| P2-fin | Зафиксировать `severity ∈ {WARNING, CRITICAL}` в схеме `alert` Фазы 2 | UK |
| P3-fin | UK подтверждает готовность принять `age`-шифрованный секрет | UK |
| Phase 2 ETA | UK сообщит дату планирования Фазы 2 | UK |
| ARCH-113 ETA | UK сообщит ожидаемую дату фикса (блокер для счётчиков заявок из событий, O4) | UK |

## P5 — Итоговый статус согласования контракта FIX-007

| Тема | Финальный статус |
|---|---|
| Endpoint | ✅ `POST /api/v2/webhooks/infrasafe/alert` |
| Auth | ✅ HMAC-SHA256, header `x-webhook-signature: t=…,v1=…` |
| Timestamp window | ✅ 300s |
| Dedup window | ✅ Фаза 1 — Redis TTL 600s; Фаза 2 — персистентный `webhook_inbox` |
| Schema `alert` Фаза 2 | ✅ `external_id`, `type`, `severity ∈ {WARNING, CRITICAL}`, `message` (обязательно); `alert_id`, `created_at`, `correlation_id` (желательно); остальное опционально |
| `type` словарь | ✅ 5 активных + 6 будущих типов намаплены (O1 + P1), fallback «Другое» |
| Fan-out | ✅ 1 alert = 1 здание = 1 событие (на нашей стороне) |
| Rate / drain | ✅ 60/мин лимит, наш drain ≤30/мин через outbox |
| Batch endpoint | ❌ dropped from roadmap |
| 409 = success | ✅ idempotent re-delivery |
| Retry | ✅ exp-backoff 2/4/8/16s cap 5 мин, не ретраить `event_id` дольше ~10 мин |
| Reference vector (pin-test) | ✅ L1 — готов к использованию |
| Naming секретов | ✅ split: `UK_WEBHOOK_SECRET` (IS→UK), `INFRASAFE_WEBHOOK_SECRET` (UK→IS) |
| Канал передачи секрета | ✅ `age` (P3) |
| Окно ротации OLD‖NEW | ✅ ≥24 ч |
| Building sync | ✅ UK → IS only; outbound IS → UK не нужен |
| Reconciliation | ✅ UK → IS hourly через `GET /api/buildings-metrics` |
| GET counts-by-building | ❌ UK не делает; InfraSafe строит из webhook-событий (новый scope Sprint 9) |
| Dead JWT-путь | ✅ InfraSafe удаляет в Sprint 9 |
| Зависимости от UK | ⏳ ARCH-113 (для полноты счётчиков), Phase 2 deploy |

🟢 **Контракт согласован. InfraSafe открывает Sprint 9.**

---

# Q. Финальные подтверждения UK (раздел P4), 2026-05-22

> Закрытие UK-side action items из § P4.

## Q1 — P3-fin: готовность принять `age`-шифрованный секрет

✅ **UK готов.** `age` — приемлемый канал. Порядок:
1. InfraSafe генерит keypair (`age-keygen`), шлёт UK **публичный** ключ.
2. UK генерит `UK_WEBHOOK_SECRET` (`openssl rand -hex 32`), шифрует под ваш
   публичный ключ (`age -R <is-pubkey> -o secret.age`), отправляет артефакт.
3. InfraSafe расшифровывает приватным ключом.
`age` ставится на UK-стороне тривиально (`brew install age`). Fallback GPG не
понадобится. Шаг выполняется перед go-live (после деплоя Фазы 2).

## Q2 — P1-fin: `COMMUNICATION_LOST → Безопасность`

✅ **Зафиксировано.** Маппинг `COMMUNICATION_LOST → Безопасность` внесён в
type-mapping дизайна Фазы 2 UK. Обоснование InfraSafe (P1) принято.

## Q3 — P2-fin: `severity ∈ {WARNING, CRITICAL}`

✅ **Зафиксировано** в схеме `alert` Фазы 2 UK. Дополнительно: UK-handoff-документ
(`~/Code/UK/docs/audit/2026-05-22-FIX-007-infrasafe-operator-handoff.md`)
**исправлен** — ранее ошибочно указывал `low/medium/high/critical`, теперь
`WARNING`/`CRITICAL` + пример payload приведён к финальной схеме.

## Q4 — Phase 2 ETA

⏳ Фаза 2 (handler `alert → request`: резолв `external_id` → building, создание
заявки, маппинг `type/severity`, echo-loop guard с ARCH-113) — отдельный ticket.
Конкретная дата будет сообщена после сессии планирования на UK-стороне.
Имплементация sender'а в InfraSafe Sprint 9 от даты Фазы 2 **не зависит** —
sender тестируется против Фазы 1 (endpoint live, отдаёт 202).

## Q5 — ARCH-113 ETA

⏳ ARCH-113 (emit `request.*` из бот-пути — нужен для полноты счётчиков заявок
InfraSafe, O4) — в UK-бэклоге как P1. Дата фикса будет сообщена при планировании.
Замечание: пока ARCH-113 не закрыт, счётчики заявок InfraSafe из webhook-событий
**неполны** (не учитывают заявки, поданные через Telegram-бот). Рекомендация
InfraSafe — не выкатывать UI-счётчики как «точные» до фикса ARCH-113.

## Q6 — Статус со стороны UK

🟢 **UK подтверждает контракт FIX-007.** Все ack-вопросы P4 закрыты (Q1-Q3) либо
переведены в трекинг-режим (Q4-Q5 — ETA сообщим, не блокеры Sprint 9). Фаза 1
endpoint live; InfraSafe может начинать Sprint 9 и smoke-тестирование sender'а
против Фазы 1 в любой момент.
