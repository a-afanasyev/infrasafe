/**
 * [N-63] Удаление трансформатора с подтверждением удаления его линий.
 *
 * Линия обязана принадлежать трансформатору, и без него она теряет смысл —
 * поэтому линии удаляются вместе с ним. Но только по явному решению: сервер
 * отвечает 409 TRANSFORMER_HAS_LINES со списком, оператор видит, ЧТО именно
 * уйдёт, и лишь после «да» уходит `?cascade=lines`. Здания удаление блокируют
 * всегда (409 TRANSFORMER_HAS_BUILDINGS) — их надо отвязать в карточках.
 *
 * Чистая функция с внедряемыми fetch/confirm — ради тестов без DOM.
 * Глобал `TransformerDelete` в браузере (esbuild bundle:false), CommonJS в тестах.
 */
(function (root) {
    'use strict';

    const LINES_IN_QUESTION = 10;

    async function readError(response, fallback) {
        const body = await response.json().catch(() => ({}));
        const message = root.ApiError
            ? root.ApiError.extractApiError(body, fallback)
            : (body && body.error && body.error.message) || fallback;
        return { body, message };
    }

    function linesQuestion(meta) {
        const lines = Array.isArray(meta && meta.lines) ? meta.lines : [];
        const total = Number.isFinite(meta && meta.count) ? meta.count : lines.length;
        const shown = lines.slice(0, LINES_IN_QUESTION).map((l) => `• ${l.name}`);
        const rest = total - shown.length;
        return [
            `У трансформатора есть линии (${total}). Они будут удалены вместе с ним:`,
            '',
            ...shown,
            ...(rest > 0 ? [`… и ещё ${rest}`] : []),
            '',
            'Удалить трансформатор и все его линии?',
        ].join('\n');
    }

    /**
     * @param {number|string} id
     * @param {{ fetchFn: Function, confirmFn: (q: string) => boolean }} deps
     * @returns {Promise<{status: 'deleted'|'cancelled', linesDeleted?: number}>}
     */
    async function deleteTransformerFlow(id, { fetchFn, confirmFn }) {
        const url = `/api/transformers/${encodeURIComponent(id)}`;
        const first = await fetchFn(url, { method: 'DELETE' });
        if (first.ok) return { status: 'deleted' };

        const { body, message } = await readError(first, 'Ошибка удаления трансформатора');
        const error = body && body.error;
        if (first.status !== 409 || !error || error.code !== 'TRANSFORMER_HAS_LINES') {
            throw new Error(message);
        }

        if (!confirmFn(linesQuestion(error.meta))) return { status: 'cancelled' };

        const second = await fetchFn(`${url}?cascade=lines`, { method: 'DELETE' });
        if (!second.ok) {
            throw new Error((await readError(second, 'Ошибка удаления трансформатора')).message);
        }
        const count = error.meta && Number.isFinite(error.meta.count) ? error.meta.count : undefined;
        return count === undefined ? { status: 'deleted' } : { status: 'deleted', linesDeleted: count };
    }

    const api = { deleteTransformerFlow };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.TransformerDelete = api;
    }
})(typeof window !== 'undefined' ? window : this);
