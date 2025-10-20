-- Создание тестового пользователя для Jest тестов
INSERT INTO users (username, email, password_hash, role, created_at, is_active)
VALUES (
    'testuser',
    'testuser@test.com',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj/RK.s5mWGi', -- TestPass123
    'user',
    NOW(),
    true
)
ON CONFLICT (username) DO NOTHING;

-- Проверяем что пользователь создан
SELECT user_id, username, email, role, is_active FROM users WHERE username = 'testuser'; 