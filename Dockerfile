FROM node:18-alpine

WORKDIR /app

# Копируем package files
COPY package*.json ./

# Устанавливаем зависимости (включая dev для development)
RUN npm install

# Копируем исходный код
COPY . .

# Создаем директорию для логов
RUN mkdir -p logs

# Создаем пользователя для безопасности
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Меняем владельца файлов
RUN chown -R nodejs:nodejs /app
USER nodejs

# Открываем порт
EXPOSE 3000

# Запускаем приложение в dev режиме для тестирования
CMD ["npm", "run", "dev"]