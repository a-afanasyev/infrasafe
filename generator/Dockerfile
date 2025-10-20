FROM ubuntu:22.04

# Установка Node.js и npm
RUN apt-get update && \
    apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production || npm install --production --no-audit --no-fund

COPY ./src ./src
COPY ./public ./public

ENV NODE_ENV=production
EXPOSE 8081

CMD ["node", "src/server.js"]
