-- ТОЛЬКО ДЛЯ РАЗРАБОТКИ И ТЕСТОВ. Не подключать ни в один боевой compose.
--
-- [A12-16, аудит 16.11.2026] Администратор с известным паролем (admin / admin123)
-- нужен набору тестов и E2E globalSetup. Раньше он жил в database/init/ и
-- попадал в боевой bootstrap; теперь это отдельный файл вне init-каталога.
-- Подключает его единственный сервис — `dev-seed` в docker-compose.dev.yml;
-- сторож: tests/jest/security/auditInfra1213.test.js.
--
-- Идемпотентен: сервис `dev-seed` выполняет файл при каждом `up`, а не один раз
-- на пустом томе, как init-скрипты.
INSERT INTO public.users (user_id, username, email, password_hash, full_name, role, is_active, created_at, updated_at, last_login) VALUES (55, 'admin', 'admin@infrasafe.com', '$2b$12$vSY6.Py5CkugrpdOE2Cj.OwUIcqB75gQ2MDMxm/NRGKd3R5LApKKe', NULL, 'admin', true, '2025-10-31 11:16:19.469741+00', '2025-10-31 11:16:35.514444+00', '2025-11-15 10:00:00.303315+00')
ON CONFLICT DO NOTHING;

SELECT pg_catalog.setval('public.users_user_id_seq', GREATEST((SELECT COALESCE(MAX(user_id), 1) FROM public.users), 55), true);
