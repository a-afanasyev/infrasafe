# UK contract change — urgency canonical keys (2026-06-05)

## Contract (from UK side)

Канонические значения urgency: `low | medium | high | critical`
(ранее — рус. `Обычная` / `Средняя` / `Срочная` / `Критическая`).

- **(а) Inbound к UK** (наш outbound): поле `uk_urgency_override` присылать ключом из набора
  выше. UK на переходный период принимает и старый русский, но просьба перейти на ключи.
- **(б) Outbound от UK** (`request.created` / `request.status_changed`, наш inbound): поле
  `urgency` будет приходить ключом — обновить парсинг/маппинг на стороне InfraSafe.
- Severity→urgency маппинг (`WARNING`/`CRITICAL`) — внутренний для UK, контракта не касается.

Маппинг рус.→ключ: `Обычная→low`, `Средняя→medium`, `Срочная→high`, `Критическая→critical`.

## Что сделано на стороне InfraSafe

### (а) Outbound — `uk_urgency_override` теперь всегда ключ

`src/services/uk/alertForwarder.js`:
- Добавлены `URGENCY_KEYS`, `RU_URGENCY_TO_KEY`, `toUrgencyKey(value)` — нормализация любого
  хранимого значения в канонический ключ (принимает и ключи case-insensitive, и легаси-русский;
  неизвестное → `null`, чтобы не слать мусор).
- `bumpUrgency()` переписан на key-ladder (нормализует вход → бамп → cap `critical`), так что
  reopen-bump работает и для легаси-русских строк в БД.
- В payload: `uk_urgency_override` = `engineerRequired ? 'critical' : (isReopen ? effectiveUrgency : null)`,
  где `effectiveUrgency` — нормализованный ключ. Раньше слал `'Критическая'` / сырой `rule.uk_urgency`.

Нормализация на границе означает, что провод корректен независимо от того, что лежит в БД, —
backfill (ниже) для wire-корректности не обязателен, только для чистоты данных.

### Нормализация хранимых данных

- `database/migrations/032_uk_urgency_canonical_keys.sql` — backfill существующих
  `alert_rules.uk_urgency` рус.→ключ (идемпотентно; на свежей БД — no-op).
- `database/init/03_uk_integration.sql` — seed для свежих деплоев уже на ключах.
- `database/migrations/011_uk_integration.sql` — исторический, **не трогаем** (уже применён;
  данные переводит 032). `uk_category` остаётся русским — категория к этому контракту не относится
  (UK выводит её из type+severity, FIX-007 O3).
- `public/utils/ukRulesValidation.js` — hint для `uk_urgency` («Канонический ключ: low | medium |
  high | critical») + поправлен текст cap у `reopen_urgency_bump` (требует rebuild фронт-бандла).

### (б) Inbound — НЕТ изменений (намеренно)

InfraSafe **не потребляет** входящее поле `urgency` ни в одном пути: `handleRequestWebhook`
(`src/services/uk/requestProcessor.js`) использует только `status` / `new_status` для определения
терминальности и авто-резолва алерта. Валидатор входящих вебхуков (`src/routes/webhookRoutes.js`)
не отвергает неизвестные поля, поэтому входящий `urgency` (хоть ключ, хоть русский) безопасно
игнорируется. Менять нечего — добавлять парсинг неиспользуемого поля было бы YAGNI.

Если в будущем появится потребитель входящего `urgency` (например, отображать срочность заявки в
admin-UI), нормализатор `toUrgencyKey` уже готов к переиспользованию.

## Тесты

`tests/jest/unit/ukIntegrationServiceTest.test.js` — новый блок «uk_urgency_override → canonical
key»: engineer_required→`critical`; reopen с легаси-рус. без бампа→ключ; reopen+bump→`critical`
(cap); already-key+bump; неизвестное→`null`; non-reopen/non-engineer→`null`. Полный unit-прогон
2215/2215 зелёный.
