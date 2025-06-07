#!/bin/bash

# Простой тест JWT авторизации
API_URL="http://localhost:8080"

echo "🔐 Тестирование JWT авторизации..."

# Создаем пользователя напрямую в базе
echo "📝 Создание тестового пользователя в базе данных..."
docker exec leaflet-postgres-1 psql -U postgres -d infrasafe -c "
INSERT INTO users (username, password_hash, email, role, is_active) 
VALUES ('jwttest', '\$2b\$10\$VF1fN6zDPfgKVRr6./FxMOq4/zBWQJr/LFoXMQnhNVhHH5oK1vITi', 'jwt@test.com', 'admin', true) 
ON CONFLICT (username) DO UPDATE SET 
password_hash = '\$2b\$10\$VF1fN6zDPfgKVRr6./FxMOq4/zBWQJr/LFoXMQnhNVhHH5oK1vITi',
email = 'jwt@test.com',
is_active = true;
"

echo "🔑 Попытка авторизации..."
RESPONSE=$(curl -s -X POST "${API_URL}/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username": "jwttest", "password": "Password123"}')

echo "📋 Ответ сервера:"
echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"

JWT_TOKEN=$(echo "$RESPONSE" | jq -r '.token' 2>/dev/null)

if [ ! -z "$JWT_TOKEN" ] && [ "$JWT_TOKEN" != "null" ]; then
    echo "✅ JWT токен получен: ${JWT_TOKEN:0:30}..."
    
    echo "🧪 Тестирование защищенного endpoint..."
    AUTH_RESPONSE=$(curl -s -X POST "${API_URL}/api/controllers/update-status-by-activity" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $JWT_TOKEN")
    
    echo "📋 Ответ защищенного endpoint:"
    echo "$AUTH_RESPONSE" | jq '.' 2>/dev/null || echo "$AUTH_RESPONSE"
else
    echo "❌ Не удалось получить JWT токен"
fi 