# Multi-stage build для оптимизации размера образа
FROM node:20-alpine AS builder

WORKDIR /app

# Копируем package файлы и устанавливаем зависимости
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then \
        npm ci --omit=dev --no-audit --no-fund && npm cache clean --force; \
    else \
        npm install --omit=dev --no-audit --no-fund && npm cache clean --force; \
    fi

# Production stage
FROM node:20-alpine

# Создаем непривилегированного пользователя для безопасности
RUN addgroup -g 1001 -S generator && \
    adduser -S generator -u 1001

WORKDIR /app

# Копируем зависимости из builder stage
COPY --from=builder --chown=generator:generator /app/node_modules ./node_modules

# Копируем исходный код
COPY --chown=generator:generator ./src ./src
COPY --chown=generator:generator ./public ./public
COPY --chown=generator:generator package.json ./

# Переключаемся на непривилегированного пользователя
USER generator

# Переменные окружения
ENV NODE_ENV=production
ENV PORT=8081

# Healthcheck для мониторинга
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8081/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

EXPOSE 8081

# Используем node напрямую для меньшего размера образа
CMD ["node", "src/server.js"]
