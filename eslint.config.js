/**
 * [EN-3] Flat config вместо `.eslintrc.json`.
 *
 * ESLint 8 вышел из поддержки в октябре 2024 — security-фиксов для него нет,
 * а начиная с девятой версии старый формат конфигурации не читается вовсе.
 * Это единственная причина миграции; правила перенесены один в один.
 *
 * Отличия формата, из-за которых файл выглядит иначе, а ведёт себя так же:
 *   - `env` больше нет — вместо него явные наборы `globals`;
 *   - `overrides` стали обычными элементами массива: следующий блок дополняет
 *     предыдущий, если его `files` совпали;
 *   - `ignorePatterns` переехали в отдельный блок `ignores`, и он должен идти
 *     первым, иначе игнор не применится к остальным блокам.
 *
 * Важное про `globals` для браузерных файлов: раньше `env.node:false` СНИМАЛ
 * серверные глобалы с `public/**`. В плоском конфиге снятия нет — блоки только
 * складываются, — поэтому серверные глобалы там просто не объявляются, а нужный
 * `module` (файлы в `public/utils` экспортируются и как CommonJS для тестов)
 * добавлен точечно.
 */

const js = require('@eslint/js');
const globals = require('globals');

// Глобалы страниц: функции, которые вешаются на window одним файлом и
// вызываются из другого или из инлайнового onclick в HTML. Это фактическое
// устройство фронта (bundle:false, общий namespace), а не недосмотр — см. B-004.
const PAGE_GLOBALS = {
    module: 'readonly',
    L: 'readonly',
    Chart: 'readonly',
    DOMPurify: 'readonly',
    AuthFlow: 'readonly',
    ApiError: 'readonly',
    define: 'readonly',
    InfrastructureLineEditor: 'readonly',
    MapLayersControl: 'readonly',
    showToast: 'writable',
    resetMetricsForm: 'writable',
    openCoordinateEditor: 'writable',
    editController: 'writable',
    deleteController: 'writable',
    deleteMetric: 'writable',
    editBuilding: 'writable',
    deleteBuilding: 'writable',
    editTransformer: 'writable',
    deleteTransformer: 'writable',
    editLine: 'writable',
    deleteLine: 'writable',
    editWaterLine: 'writable',
    deleteWaterLine: 'writable',
    editWaterSource: 'writable',
    deleteWaterSource: 'writable',
    editHeatSource: 'writable',
    deleteHeatSource: 'writable',
};

module.exports = [
    {
        ignores: [
            'node_modules/',
            'public/dist/',
            'public/libs/',
            'generator/',
            'frontend-design/',
            'coverage/',
            'tests/reports/',
        ],
    },

    // Серверный код и всё, что не переопределено ниже.
    {
        files: ['**/*.js'],
        ...js.configs.recommended,
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: {
                ...globals.node,
                ...globals.es2022,
                ...globals.jest,
            },
        },
        rules: {
            ...js.configs.recommended.rules,
            // caughtErrorsIgnorePattern: в ESLint 9+ неиспользуемая переменная в
            // `catch` стала ошибкой по умолчанию. Правило полезное — забытая
            // ошибка действительно должна быть видна, — поэтому не отключаем его,
            // а требуем помечать намеренно проигнорированную префиксом `_`.
            'no-unused-vars': ['warn', {
                argsIgnorePattern: '^_|^next$|^req$|^res$',
                caughtErrorsIgnorePattern: '^_',
            }],
            'no-console': 'warn',
            'no-constant-condition': 'warn',
            'no-undef': 'error',
            // Новое правило десятой версии. Оно право по букве, но ловит здесь
            // один приём — защитный инициализатор перед try/catch или перед
            // цепочкой if, где значение всё равно перезаписывается. Переписывать
            // шесть таких мест (в том числе внутри отрисовки карты) внутри
            // миграции линтера — значит смешать смену инструмента с правкой
            // логики и лишить обе части отдельной проверки. Правило выключено
            // осознанно; места перечислены в описании PR, чтобы не потерялись.
            'no-useless-assignment': 'off',
        },
    },

    // Браузерный фронтенд.
    {
        files: ['public/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: {
                ...globals.browser,
                ...globals.es2022,
                ...PAGE_GLOBALS,
            },
        },
        rules: {
            'no-console': 'off',
            'no-redeclare': ['warn', { builtinGlobals: false }],
            'no-unused-vars': ['warn', { caughtErrorsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
            'no-empty': 'warn',
            'no-cond-assign': 'warn',
            'no-useless-escape': 'warn',
            'no-control-regex': 'warn',
            'no-extra-semi': 'warn',
            'getter-return': 'warn',
        },
    },

    // Тесты: и node, и browser — в сьютах есть и то и другое.
    {
        files: ['tests/**/*.js'],
        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.browser,
                ...globals.jest,
            },
        },
        rules: {
            'no-console': 'off',
        },
    },
];
