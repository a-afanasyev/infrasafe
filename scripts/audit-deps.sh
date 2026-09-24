#!/usr/bin/env bash
#
# Аудит боевых зависимостей, устойчивый к недоступности реестра.
#
# ЗАЧЕМ. `npm audit` выходит с кодом 1 в ДВУХ разных случаях: нашлись уязвимости
# и эндпоинт реестра ответил ошибкой. 18.09.2026 на `main` (коммит `ce7727ca`)
# обязательная проверка упала по второй причине — npm получил `400 Bad Request`
# на устаревающем quick-эндпоинте, — и мерж оказался заблокирован находкой,
# которой не было. Следующий прогон прошёл.
#
# Флаки в ОБЯЗАТЕЛЬНОЙ проверке хуже, чем кажется: она перестаёт что-либо
# значить, потому что «красная — перезапусти» становится привычкой.
#
# КАК РАЗЛИЧАЕМ. Только по содержимому отчёта; формы сняты с живого npm:
#   успех → {"auditReportVersion":2, …, "metadata":{"vulnerabilities":{…}}}
#   отказ → {"message":"request to … failed …","error":{…}}   (metadata НЕТ)
# В обоих случаях stdout — чистый JSON, а код возврата 1. Поэтому решение
# принимается по JSON, а не по коду.
#
# Повторяем ТОЛЬКО отказ эндпоинта. Найденную уязвимость повторять бессмысленно
# и вредно: она не изменится, а ожидание научит смотреть на красное сквозь пальцы.
#
# Исчерпав попытки, скрипт всё равно падает — молчаливое «ок» отключило бы аудит
# на время чужой аварии, — но СВОИМ кодом (2), чтобы причина читалась сразу.
#
# Использование:  scripts/audit-deps.sh [каталог]

set -Eeuo pipefail

readonly EXIT_VULNERABLE=1
readonly EXIT_UNAVAILABLE=2

# Порог тот же, что был у прежнего шага `--audit-level=high`: moderate по дереву
# зависимостей шумит и не действует per-PR.
#
# [N-10] Исключение: moderate в боевом дереве роняет проверку, если npm знает
# исправление без смены мажора (см. verdict). Иначе qs 6.15.2 — DoS на разборе
# query-string каждого запроса ещё до аутентификации — стоял в рантайме при
# зелёном CI, а Dependabot alerts в репозитории выключены.
readonly FAIL_ON=("high" "critical")

# Паузы между попытками. Переопределяются окружением — тесты гоняют без ожидания.
read -r -a RETRY_DELAYS <<< "${AUDIT_RETRY_DELAYS:-5 15}"

WORKDIR="${1:-.}"
cd "$WORKDIR"

# Разбирает отчёт. Печатает вердикт одним словом и, для `vulnerable`, сводку.
#   ok | vulnerable | unavailable
verdict() {
    node -e '
        let raw = "";
        process.stdin.on("data", (d) => { raw += d; });
        process.stdin.on("end", () => {
            let report;
            try {
                report = JSON.parse(raw);
            } catch {
                // Неразобранный вывод — НЕ «уязвимостей нет». Тот же класс
                // ошибки, что и чтение кода возврата вместо содержимого.
                console.log("unavailable");
                console.error("аудит: ответ не разобран как JSON");
                return;
            }
            const counts = report && report.metadata && report.metadata.vulnerabilities;
            if (!counts) {
                console.log("unavailable");
                console.error(`аудит: ${(report && report.message) || "отчёт без metadata"}`);
                return;
            }
            const levels = process.argv[1].split(",");
            const hits = levels
                .map((level) => [level, Number(counts[level] || 0)])
                .filter(([, n]) => n > 0)
                .map(([l, n]) => `${l}=${n}`);

            // [N-10] Moderate роняет, только если есть исправление без смены
            // мажора — ровно то, что применяет `npm audit fix`.
            const moderate = Object.values(report.vulnerabilities || {})
                .filter((v) => v && v.severity === "moderate");
            // Объект без явного isSemVerMajor: true — исправимый. Сомнение
            // решается в сторону «уронить», а не «промолчать».
            const fixable = (v) => v.fixAvailable === true
                || (Boolean(v.fixAvailable) && typeof v.fixAvailable === "object"
                    && v.fixAvailable.isSemVerMajor !== true);
            const fixableModerate = moderate.filter(fixable).map((v) => v.name);
            const otherModerate = moderate.filter((v) => !fixable(v)).map((v) => v.name);

            if (fixableModerate.length > 0) {
                hits.push(`moderate с исправлением: ${fixableModerate.join(", ")} — выполните npm audit fix`);
            }
            if (otherModerate.length > 0) {
                console.error(`аудит: moderate без исправления в рамках мажора (не роняет): ${otherModerate.join(", ")}`);
            }
            if (hits.length === 0) {
                console.log("ok");
                return;
            }
            console.log("vulnerable");
            console.error(`аудит: ${hits.join("; ")}`);
        });
    ' "$(IFS=,; echo "${FAIL_ON[*]}")"
}

attempt=0
total=$(( ${#RETRY_DELAYS[@]} + 1 ))

while :; do
    attempt=$(( attempt + 1 ))

    # stderr глушится намеренно: npm пишет туда предупреждения и ссылку на лог,
    # а нам нужен чистый JSON. Код возврата не читаем — он неоднозначен.
    output="$(npm audit --omit=dev --json 2>/dev/null || true)"

    result="$(printf '%s' "$output" | verdict 2>/tmp/audit-deps-detail.$$ || true)"
    detail="$(cat /tmp/audit-deps-detail.$$ 2>/dev/null || true)"
    rm -f /tmp/audit-deps-detail.$$

    case "$result" in
        ok)
            echo "✅ аудит ($WORKDIR): уязвимостей уровня ${FAIL_ON[*]} и исправимых moderate нет"
            [ -n "$detail" ] && echo "   ⚠️  ${detail}"
            exit 0
            ;;
        vulnerable)
            echo "❌ аудит ($WORKDIR): ${detail}"
            echo "   Это НАХОДКА, а не сбой связи — повторять нечего."
            exit "$EXIT_VULNERABLE"
            ;;
        *)
            echo "⚠️  попытка ${attempt}/${total} ($WORKDIR): ${detail:-аудит не выполнен}"
            ;;
    esac

    if [ "$attempt" -ge "$total" ]; then
        echo "❌ аудит ($WORKDIR) НЕ ВЫПОЛНЕН: реестр недоступен после ${total} попыток."
        echo "   Проверка красная намеренно: аудит, молча пропущенный во время чужой"
        echo "   аварии, — это отключённый аудит. Код ${EXIT_UNAVAILABLE} отличает"
        echo "   эту причину от найденных уязвимостей (код ${EXIT_VULNERABLE})."
        exit "$EXIT_UNAVAILABLE"
    fi

    sleep "${RETRY_DELAYS[$(( attempt - 1 ))]}"
done
