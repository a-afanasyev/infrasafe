FROM node:18-alpine AS build

WORKDIR /app

# Устанавливаем зависимости
COPY package*.json ./
RUN npm install --legacy-peer-deps

# Копируем файлы проекта
COPY . .

# Собираем приложение
RUN npm run build

# Создаем малый рабочий контейнер
FROM node:18-alpine AS production

WORKDIR /app

# Копируем собранные файлы и зависимости
COPY --from=build /app/package.json ./
COPY --from=build /app/.svelte-kit ./.svelte-kit
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/svelte.config.js ./
COPY --from=build /app/vite.config.js ./
COPY --from=build /app/postcss.config.js ./
COPY --from=build /app/tailwind.config.js ./

# Создаем директорию для статики, если её нет
RUN mkdir -p static

# Переменные окружения для работы в режиме production
ENV NODE_ENV=production
ENV PORT=3333
ENV HOST=0.0.0.0

# Экспозим порт
EXPOSE 3333

# Запуск сервера приложения в режиме предварительного просмотра
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "3333"] 