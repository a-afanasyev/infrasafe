# Что где опубликовано и как

> Актуально на 2026-10-11. Обновлять при любом изменении маршрутов nginx,
> состава `frontend-html/` или хост-локальных файлов на серверах.

Документ отвечает на три вопроса: какой адрес что показывает, откуда берутся
файлы и как выкатить правку. Подробности рантайма (контейнеры, роли БД,
неизменяемый образ) — в скилле `infrasafe-runtime`, история решений — в PR,
перечисленных в конце.

## Две площадки

| | infrasafe.uz | profk.uz |
|---|---|---|
| Хост | 95.46.96.105 | 95.46.96.224 |
| ssh | `ssh infrasafe105` (ключ `~/.ssh/uk105`) | `ssh profk` |
| Каталог репозитория | `/home/infrasafe/infrasafe` | `/opt/infrasafe` |
| Профиль выкатки (`.deploy-env`) | `infrasafe` | `prod` |
| Конфиг nginx | `nginx-config/nginx.production.conf` | `nginx-config/nginx.profk.conf` |
| Бренд (`/brand/`) | `public/brand-default/` | `public/brand-profk/` |
| Развёрнутая версия main (11.10) | `67b4836` (PR #308) | `c81014f` (PR #307) |

Код и разметка у площадок **общие**. Различаются только конфиг nginx и
каталог бренда. Любое различие поведения делается одним из этих двух способов,
а не правкой общего HTML под одну площадку.

## infrasafe.uz: адреса

| Адрес | Что показывает | Откуда |
|---|---|---|
| `/` | Коммерческий лендинг | `frontend-html/solutions/index.html` (`location = /`) |
| `/solutions/uk.html`, `monitoring.html`, `fountains.html` | Подстраницы лендинга | `frontend-html/solutions/` (`location ^~ /solutions/`) |
| `/solutions/styles.css`, `*.js`, `assets/*` | Файлы лендинга | там же |
| `/solutions`, `/solutions/`, `/solutions/index.html` | 301 → `/` | у главной один адрес |
| `/map` | Карта мониторинга | `frontend-html/index.html` (`location = /map`) |
| `/map/` | 301 → `/map` | |
| `/index.html` | 301 → `/` | на него ссылаются логотипы «На главную» |
| неизвестный путь | 301 → `/` | fallback `location /` уходит в `/index.html` |
| `/about.html`, `/documentation.html`, `/contacts.html` | Страницы проекта | `frontend-html/` |
| `/login.html`, `/admin.html` | Вход и админка | `frontend-html/` |
| `/uk/…` | Панель УК (внешний сервис) | прокси, см. скилл `uk-integration` |
| `/api/…`, `/health` | Бэкенд | прокси в контейнер `app` |
| `https://monitor.infrasafe.uz/` | Заглушка «Идёт разработка» (503, noindex) | хост-локальный `extra/extmon.conf`, см. ниже |

Ссылки на лендинг из шапки карты **нет**: пункт «Решения» снят 11.10.2026 по
решению владельца (PR #308). Разметка осталась — `<li class="nav-landing">` в
`frontend-html/index.html`, скрыт переменной `--nav-landing-display: none`
(`css/tokens.css`). Вернуть только на .105 — добавить в
`public/brand-default/brand.css` строку `:root { --nav-landing-display: list-item; }`.
На телефоне меню карты скрыто целиком, так что пункт был бы виден только на ПК.

## profk.uz: адреса

| Адрес | Что показывает |
|---|---|
| `/` | 302 → `/uk/resident-board` (панель УК) |
| `/index.html`, `/map` | Карта (`/map` — через fallback) |
| `/solutions/…` | 404 (проверено после выкатки `c81014f`) |
| `/uk/…`, `/health`, `/login.html` | как на infrasafe.uz |

Лендинг на profk **не раздаётся**. Каталог `frontend-html/` общий, поэтому в
`nginx.profk.conf` стоит `location ^~ /solutions/ { return 404; }`. Пункта
«Решения» в шапке карты на profk нет и не будет: `brand-profk` переменную не
включает.

## Лендинг: устройство

```
frontend-html/solutions/
├── index.html, uk.html, monitoring.html, fountains.html
├── styles.css            один файл стилей на все страницы
├── app.js, demo-model.js демо «Объект в деталях» (только на главной)
├── commercial.js         меню, форма письма, карусель экранов
└── assets/               иллюстрации, логотипы, снимки панели УК (uk-*.webp)
                          и карты (map.webp)
```

Правила, которые легко сломать:

- **Все пути абсолютные** (`/solutions/…`). Главная отдаётся с `/`, и
  относительный `styles.css` искался бы в корне сайта. Новые ссылки и картинки
  писать так же, включая шаблоны в `app.js`.
- **CSP .105** (`nginx-config/security-headers.infrasafe.conf`): только внешние
  скрипты со своего домена, никаких `<script>` внутри страницы и `onclick=`.
  Шрифт Inter грузится с Google Fonts — это разрешено.
- **Метка версии** `?v=20261011-v7` у CSS и JS, одинаковая на всех четырёх страницах. CSS и JS отдаются с
  `no-cache`, но метку стоит менять при правке, чтобы не путаться.
- **Демо не управляет оборудованием.** Кнопки показывают события (протечка,
  просадка фазы, остановка насоса). Лифта, дверей и освещения в продукте нет —
  на лендинге их тоже быть не должно.
- **Логотипы** вырезаны из `public/images/infrasafe-logo.svg` (это PNG 1024×1024
  в SVG-обёртке, 1,3 МБ): `logo-mark-96/192.webp` — только эмблема,
  `logo-full-320.webp` — с подписью. Фавикон совпадает с `brand-default`.
- **Скриншоты панели УК** (`assets/uk-*.webp`, карусель «Как выглядит рабочая
  панель») сняты 11.10.2026 с живой панели ProFK — публикация согласована с
  ProFK. Перед съёмкой на странице в браузере заменены ФИО исполнителей (на
  должности), тексты заявок с номерами домов и квартир, адреса и телефон;
  база не менялась. Переснимать — так же: маскировать в DOM, снимать в
  светлой теме при окне 1440 px, курсор уводить из кадра. Панель на .105
  для этого не годится — там почти нет данных, а тексты тестовые.
  На слайде «Лифты» дополнительно скрыто всё об освидетельствовании: флаги
  `[title="Просрочено освидетельствование"]` удалены, значение плитки
  «Просрочено освид.» заменено прочерком. Паспорт лифта не публикуем: там
  серийные номера и «публичный код».
- **Снимок карты** (`assets/map.webp`, раздел «Карта объектов») снят 11.10.2026
  с infrasafe.uz/map под входом владельца: панель слоёв, включены «Здания» и
  «Трансформаторы», открыта карточка дома с последними показаниями. Перед
  съёмкой скрыты (не подменены) пункт «Решения», счётчики слоёв и служебные
  строки карточки — УК, ГВС, номер и статус контроллера. Без входа карта
  показывает только серые маркеры без слоёв, для снимка не годится. Пароль и
  2FA вводит владелец сам.
- **ESLint** проверяет `frontend-html/**/*.js` отдельным браузерным блоком в
  `eslint.config.js`.

## Как это раздаётся

Каталоги смонтированы в контейнер `infrasafe-nginx-1` с хоста
(`docker-compose.unified.yml`):

| Хост | Внутри контейнера |
|---|---|
| `./frontend-html` | `/srv/frontend-html` |
| `./css` | `/usr/share/nginx/html/css` |
| `./public` | `/usr/share/nginx/html/public` |
| `./nginx-config` | `/etc/nginx/custom` |

Поэтому правка страниц, стилей, лендинга и конфига nginx **не требует
пересборки образа**. Достаточно `git pull`, а при изменении конфига ещё
`nginx -t` и reload. `update-production.sh` нужен только для изменений
бэкенда и `public/dist`.

## Выкатка на .105

```bash
ssh infrasafe105
cd /home/infrasafe/infrasafe
git status --short nginx-config/ frontend-html/ css/ public/   # должно быть пусто (кроме ?? бэкапов)
git pull --ff-only
# только если менялся nginx-config:
docker exec infrasafe-nginx-1 nginx -t -c /etc/nginx/custom/nginx.production.conf
docker exec infrasafe-nginx-1 nginx -s reload -c /etc/nginx/custom/nginx.production.conf
```

Предупреждение `"ssl_stapling" ignored` нормально: у Let's Encrypt больше нет
OCSP. Перед reload проверка `nginx -t` обязательна: `server_names_hash` и
другие лимиты на .105 отличаются от рабочей машины.

Проверка после выкатки:

```bash
for u in / /map /index.html /solutions/uk.html /health; do
  printf '%-22s ' "$u"; curl -s -o /dev/null -m 15 -w '%{http_code} %{redirect_url}\n' "https://infrasafe.uz$u"
done
# ожидается: / 200, /map 200, /index.html 301 → /, /solutions/uk.html 200, /health 200
```

## Выкатка на profk

Пока бэкенд не менялся (проверить: `git diff --stat <версия на profk> origin/main -- src package.json Dockerfile database`),
выкатка такая же — без пересборки образа:

```bash
ssh profk
cd /opt/infrasafe
git status --short | grep -v '^??'   # должно быть пусто
git pull --ff-only
docker exec infrasafe-nginx-1 nginx -t -c /etc/nginx/custom/nginx.profk.conf
docker exec infrasafe-nginx-1 nginx -s reload -c /etc/nginx/custom/nginx.profk.conf
```

Проверка: `https://profk.uz/` — 302 на `/uk/resident-board`, `/solutions/` — 404,
`/map`, `/uk/`, `/health` — 200. Если бэкенд менялся — `update-production.sh`
с `DEPLOY_ENV=prod` (см. скилл `infrasafe-runtime`).

## Проверка конфига до выкатки

Проверить конфиг до выкатки можно одноразовым nginx того же образа (digest в
`docker-compose.unified.yml`) с самоподписанным сертификатом и смонтированными
`nginx-config`, `frontend-html`, `css`, `public` — так проверялись все
изменения 11.10.

## Хост-локальное на .105 (не в репозитории)

| Что | Где | Зачем |
|---|---|---|
| `include /etc/nginx/custom/extra/*.conf;` | в конце `nginx.production.conf` — **в репозитории** с PR #300 | подключает server-блоки хоста |
| `nginx-config/extra/extmon.conf` | только на .105 | `monitor.infrasafe.uz`, сейчас заглушка |
| `nginx-config/extra/extmon.conf.grafana-20261011.bak` | только на .105 | рабочий вариант с Grafana + Authelia |
| `nginx-config/extra/le/` | только на .105 | сертификат LE для monitor, **закрытые ключи** |

`nginx-config/extra/` внесён в `.gitignore`. Бэкапы внутри `extra/` называть
**не** `*.conf`, иначе маска `include` подхватит их как рабочий конфиг.

Вернуть Grafana на `monitor.infrasafe.uz` (когда стек extmon-central поднят —
сейчас его контейнеров на .105 нет, только сети `extmon-central_default` и
`extmon-edge`):

```bash
cd /home/infrasafe/infrasafe/nginx-config/extra
cp extmon.conf.grafana-20261011.bak extmon.conf
docker exec infrasafe-nginx-1 nginx -t -c /etc/nginx/custom/nginx.production.conf
docker exec infrasafe-nginx-1 nginx -s reload -c /etc/nginx/custom/nginx.production.conf
```

Повторный `nginx-publish.sh` стека extmon перезапишет заглушку сам.

Бэкапы конфигов в `/home/infrasafe/` от 11.10: `nginx.production.conf.pre-landing-20261011`,
`…pre-root-20261011`, `…pre-include-commit-20261011`, `extmon.conf.grafana-20261011`,
`extmon-stub-20261011.conf`, патчи `nginx-host-edit-20261011{,b,c}.patch`.
После PR #300 патчи не нужны.

## Превью вне сайта

- **Артефакт** https://claude.ai/artifact/PqLfQWmtXtjDj5KK7NiKMx — приватный,
  открывается только владельцу и тем, кому он выдал доступ. Застыл на версии
  с относительными путями (до PR #298) и из репозитория больше не обновляется.
- **Черновик ChatGPT** https://infrasafe-live.fuzzy-crown-0722.chatgpt.site —
  исходная версия до правок, не наша площадка. Не ссылаться на неё.

## История

| PR | Коммит | Что |
|---|---|---|
| #297 | `bc0b68e` | лендинг в `frontend-html/solutions/`, адрес `/solutions/` |
| #298 | `f0220ac` | лендинг — главная, карта на `/map`; 404 на profk |
| #299 | `b8c09ae` | пункт «Решения» в шапке карты (только бренд .105) |
| #300 | `1d35218` | `include extra/*.conf` в репозитории, `extra/` в `.gitignore` |
| #301 | `ef7a2c8` | `/index.html` → `/`, «Открыть карту» → `/map` |
| #303 | `1e7055a` | карусель панели УК — 5 снимков живой панели ProFK (`assets/uk-*.webp`) |
| #302, #304, #306 | `3f76c63`, `cfa2266`, `3b25899` | этот документ и его дополнения |
| #305 | `7dff1f0` | 6-й слайд «Лифты» — реестр лифтов ProFK без данных об освидетельствовании |
| #307 | `c81014f` | контекст и документация после выкатки; метки версий подстраниц |
| #308 | `67b4836` | снимок карты на лендинге; пункт «Решения» снят; итоги открытых вопросов |

Выкатки 11.10: .105 — после каждого PR; profk — `c81014f` (без пересборки).

## Решения и открытое

Решено 11.10.2026 (подробности — `docs/BACKLOG.md`, «Лендинг и публикация»):

- **Внешние ссылки** на корень `infrasafe.uz`, рассчитанные на карту, искали в
  соседних проектах (UK, fontain, uk-resource-accounting, Monitoring,
  profk-observability и др.) — таких нет. Пробы мониторинга на
  `https://infrasafe.uz/` теперь проверяют лендинг; как проверка периметра
  этого хватает, пробу именно карты при желании перевести на `/map`.
- **Пункт «Решения»** снят, **monitor.infrasafe.uz** остаётся заглушкой
  «Идёт разработка» до запуска внешнего мониторинга.

Открыто:

- Тёмной темы у лендинга нет — отложено владельцем; в `styles.css` больше
  сотни литеральных цветов, сначала перевести их на переменные.
- Снимки панели УК и карты переснимать по правилам выше при заметных
  изменениях интерфейса.
