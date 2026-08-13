# Тесты — контекст для Claude Code

Загружается только при работе с файлами под `tests/`. Перенесено из корневого
`CLAUDE.md` (2026-08-13).

Счётчики тестов быстро стареют — сверяйтесь прогоном, а не этим файлом.
На 2026-08-13: `npm test` ≈ 203 сьюта / 3288 тестов, `npm run test:db` — 26,
`npm run test:e2e` — 11 сьютов / 65 тестов.

## Раскладка

- **Юниты** — `tests/jest/unit/`: сервисы, контроллеры, модели, middleware,
  интеграция с УК, totpService, AccountLockout, шина событий, фабрики. Sprint 10
  добавил ~300 штук: `AlertVerification.test.js`, `AlertSuppression.test.js`,
  `alertVerificationService.test.js`, `alertService.persistenceGate.test.js`,
  `alertService.resolveAlert.test.js`, `alertService.reopen.test.js`,
  `AlertRule.update.test.js`.
- **Интеграционные** — `tests/jest/integration/` (API, авторизация default-deny).
- **Безопасность** — `tests/jest/security/` (SQL-инъекции, XSS, общие проверки).
- **БД** — `tests/jest/db/`, см. ниже.
- **E2E** — `tests/jest/e2e/`: настоящие docker-контейнеры, без моков,
  `npm run test:e2e`. Исключены из `npm test` через `testPathIgnorePatterns`.

## Тесты на живом Postgres (`tests/jest/db/`)

**Без мока БД.** Запуск `npm run test:db`, отдельный шаг в CI (задача `test`),
исключены из обычного `npm test` через `testPathIgnorePatterns`.

[R2-24] Сюда идёт всё, что живёт ВНУТРИ SQL — арифметика, приведения типов,
CTE, имена колонок, — потому что замоканный `src/config/database` лишь сверяет
подстроки текста запроса и провалиться ни на чём из этого не может.

Набор НЕ пропускает себя, когда база недоступна: пропуск-при-недоступности —
ровно тот ложный зелёный, ради предотвращения которого эта обвязка и заведена.
И он отказывается стартовать, если `DB_NAME` не похоже на тестовую базу.

Новые тесты берут DDL из канонических `database/init/*.sql` и
`database/migrations/*.sql` регулярками, а не переписывают его — тогда тест не
может разъехаться со схемой так, как разъехался запрос.

Обоснование, в порядке появления: AUD-039 (контракт `find_nearest`), R2-24
(арифметика `AccountLockout` при 100% покрытии строк) и
`updateControllersStatusByActivity`, который писал в несуществующую
`controllers.updated_at` и потому НЕ РАБОТАЛ НИКОГДА — вскрылось только когда
планировщик AR-21 впервые позвал его на проде.

Итого моки БД пропустили три прод-дефекта. Правило простое: SQL проверяется
здесь.

## Авторизация в E2E (задача #150, 2026-06-13)

Обвязка знает про **куки и обязательную 2FA**. `globalSetup.js` сбрасывает 2FA
администратора прямо в БД (окружение `E2E_DB_*`, по умолчанию
`postgres:postgres@localhost:5435/infrasafe`), проводит
login → setup-2fa → confirm-2fa с кодом от `otplib` и кэширует получившиеся
**строки заголовка Cookie** (`E2E_ADMIN_COOKIE` / `E2E_USER_COOKIE`);
`e2eHelper.authed()` шлёт `Cookie` и разрешённый `Origin` (SEC-23).

Полный прогон делает >10 входов и >5 регистраций с одного адреса, поэтому
поднимите `RATE_LIMIT_AUTH_MAX` и `RATE_LIMIT_REGISTER_MAX` (переопределяются
окружением в `rateLimiter.js`; на проде по умолчанию 10 и 5) — либо
перезапускайте приложение между прогонами, чтобы очистить ограничитель в памяти.

CI: `.github/workflows/e2e-nightly.yml` — по расписанию, **на каждом PR в main**
(R2-14) и вручную. Поднимает `docker-compose.dev.yml`, ждёт здоровья приложения,
применяет ожидающие миграции (init-схема останавливается на 017, 018+ — работа
раннера) и гоняет `npm run test:e2e` с поднятыми лимитами. Прогон занимает
1,5–3 минуты.
