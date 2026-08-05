# SE-1 — вынос asset-web на assets.profk.uz

**Дата:** 2026-08-04 · **Площадка:** только profk (на infrasafe.uz `/assets/` нет) · **Тип:** конфигурация эджа, без пересборки образа

## Зачем

Карта имущества (`asset-web`) отдавалась как `profk.uz/assets/`, то есть делила
origin с InfraSafe. Куки авторизации выставлены с `path: '/'`
(`src/utils/authCookies.js:51-54`), поэтому браузер слал их на **любой**
same-origin запрос — включая инициированный скриптом со страницы `/assets/`.

Ни один из существующих рубежей это не ловит: CSRF Origin-guard пропускает
запрос, потому что `Origin` совпадает с allowlist, а `SameSite=strict` для
same-origin не ограничение. CSP на той локации вдобавок разрешала
`script-src 'unsafe-inline'` (`nginx.profk.conf:475`). Итог: XSS в стороннем
приложении, которого нет в этом репозитории и которое мы не проверяли, давал
authenticated fetch к `/api/*` от имени администратора.

Разные origin закрывают вектор **по определению** — это устранение, а не
смягчение.

## Порядок выкатки

Шаги 1–2 обязаны предшествовать деплою конфига. Основной домен не страдает ни
на одном шаге: новый `server`-блок обслуживает только `assets.profk.uz`.

1. **DNS.** A-запись `assets.profk.uz` → тот же адрес, что `profk.uz`
   (95.46.96.224). Дождаться распространения:
   `dig +short assets.profk.uz`.

2. **Сертификат.** Сертификат один файл с SAN, отдельный путь не нужен:

   ```bash
   certbot certonly --webroot -w ~/infrasafe/certbot-webroot \
       --expand -d profk.uz -d assets.profk.uz
   ```

   HTTP-блок уже обслуживает оба имени (`server_name profk.uz assets.profk.uz`),
   поэтому `http-01` пройдёт. Проверить SAN:
   `openssl x509 -in /etc/letsencrypt/live/profk.uz/fullchain.pem -noout -text | grep -A1 "Subject Alternative Name"`

3. **Деплой конфига.** Это изменение только эджа — `update-production.sh`
   не нужен:

   ```bash
   cd /opt/infrasafe && git pull
   docker exec infrasafe-nginx-1 nginx -t -c /etc/nginx/custom/nginx.profk.conf
   docker exec infrasafe-nginx-1 nginx -s reload
   ```

4. **Проверка.**

   ```bash
   curl -sI https://assets.profk.uz/ | head -3          # 200, карта открывается
   curl -sI https://profk.uz/assets/ | head -3          # 301 → assets.profk.uz
   curl -sI https://profk.uz/health | head -3           # 200 (основной домен цел)
   ```

   В браузере: открыть `https://assets.profk.uz/`, убедиться, что карта
   работает и в DevTools → Application → Cookies **нет** `access_token` /
   `refresh_token`. Это и есть проверка сути фикса.

## Откат

Обратно в один шаг: `git revert` конфигурационного коммита + `nginx -s reload`.
Ни DNS-запись, ни расширенный сертификат откатывать не нужно — они безвредны
сами по себе.

## Что осталось за рамками

- **CSP `'unsafe-inline'` у asset-web не трогали.** Это чужой код; ломать его
  мы не подписывались, а после выноса на отдельный origin инъекция там больше
  не дотягивается до кук InfraSafe. Если владелец захочет ужесточить — это
  отдельная задача на стороне asset-web.
- **`path` кук остался `/`.** После выноса он перестал быть проблемой для
  этого вектора. Сужение до `/api` — независимое усиление, требующее прогона
  логина/refresh/logout/2FA на обеих площадках; заводить отдельно, если
  появится ещё один сосед по origin.
- **Rate-limit на поддомене не заводили** — паритет с прежним поведением
  локации `/assets/`, чтобы вынос не менял ничего, кроме origin.
