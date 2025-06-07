#!/bin/bash

API_URL="http://localhost:8080"

echo "🔐 Тестирование JWT через регистрацию..."

# Регистрируем пользователя
echo "📝 Регистрация пользователя..."
REGISTER_RESPONSE=$(curl -s -X POST "${API_URL}/api/auth/register" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "apitest",
        "password": "ApiTest123",
        "email": "apitest@example.com",
        "role": "admin"
    }')

echo "📋 Ответ регистрации:"
echo "$REGISTER_RESPONSE" | jq '.' 2>/dev/null || echo "$REGISTER_RESPONSE"

# Авторизуемся
echo "🔑 Авторизация..."
LOGIN_RESPONSE=$(curl -s -X POST "${API_URL}/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "apitest",
        "password": "ApiTest123"
    }')

echo "📋 Ответ авторизации:"
echo "$LOGIN_RESPONSE" | jq '.' 2>/dev/null || echo "$LOGIN_RESPONSE"

JWT_TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.accessToken' 2>/dev/null)

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