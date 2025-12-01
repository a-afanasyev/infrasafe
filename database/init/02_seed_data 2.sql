-- ===============================================================
-- Seed snapshot from infrasafe-postgres-1 (extracted 2025-11-15 12:08 UTC)
-- Purpose: realistic starter data for tests, based on current container DB.
-- Metrics included: last 3h slice (2025-11-15 09:00..12:08 UTC).
-- ===============================================================
--
-- PostgreSQL database dump
--

-- Dumped from database version 15.4 (Debian 15.4-1.pgdg110+1)
-- Dumped by pg_dump version 15.4 (Debian 15.4-1.pgdg110+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Cleanup target tables before seeding (order matters for FK integrity)
--
TRUNCATE TABLE public.metrics RESTART IDENTITY;
TRUNCATE TABLE public.controllers RESTART IDENTITY;
TRUNCATE TABLE public.buildings RESTART IDENTITY;
TRUNCATE TABLE public.transformers RESTART IDENTITY;
TRUNCATE TABLE public.power_transformers RESTART IDENTITY;
TRUNCATE TABLE public.heat_sources RESTART IDENTITY;
TRUNCATE TABLE public.cold_water_sources RESTART IDENTITY;
TRUNCATE TABLE public.infrastructure_alerts RESTART IDENTITY;
TRUNCATE TABLE public.alert_types RESTART IDENTITY;
TRUNCATE TABLE public.users RESTART IDENTITY;

--
-- Data for Name: alert_types; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.alert_types (alert_type_id, type_name, description) VALUES (1, 'POWER_FAILURE', 'Отключение электроэнергии');
INSERT INTO public.alert_types (alert_type_id, type_name, description) VALUES (2, 'WATER_LEAK', 'Утечка воды');
INSERT INTO public.alert_types (alert_type_id, type_name, description) VALUES (3, 'OVERHEATING', 'Перегрев оборудования');
INSERT INTO public.alert_types (alert_type_id, type_name, description) VALUES (4, 'LOW_PRESSURE', 'Низкое давление в системе');
INSERT INTO public.alert_types (alert_type_id, type_name, description) VALUES (5, 'COMMUNICATION_LOST', 'Потеря связи с контроллером');
INSERT INTO public.alert_types (alert_type_id, type_name, description) VALUES (6, 'VOLTAGE_ANOMALY', 'Аномалия напряжения');
INSERT INTO public.alert_types (alert_type_id, type_name, description) VALUES (7, 'TEMPERATURE_ANOMALY', 'Аномалия температуры');


--
-- Data for Name: cold_water_sources; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.cold_water_sources (id, name, address, latitude, longitude, source_type, capacity_m3_per_hour, operating_pressure_bar, installation_date, status, maintenance_contact, notes, geom, created_at, updated_at) VALUES ('CW-FARABI-01', 'Насосная станция Фараби', 'ул. Фараби, НС-1, Ташкент', 41.347200, 69.202000, 'pumping_station', 120.00, 5.00, NULL, 'active', NULL, NULL, '0101000020E6100000B0726891ED4C5140EA95B20C71AC4440', '2025-07-29 06:53:15.704536+00', '2025-07-29 06:53:15.704536+00');
INSERT INTO public.cold_water_sources (id, name, address, latitude, longitude, source_type, capacity_m3_per_hour, operating_pressure_bar, installation_date, status, maintenance_contact, notes, geom, created_at, updated_at) VALUES ('CW-OLMAZOR-01', 'Водозабор Олмазор', 'Олмазорский район, Ташкент', 41.348000, 69.200000, 'well', 80.00, 4.50, NULL, 'active', NULL, NULL, '0101000020E6100000CDCCCCCCCC4C5140068195438BAC4440', '2025-07-29 06:53:15.704536+00', '2025-07-29 06:53:15.704536+00');
INSERT INTO public.cold_water_sources (id, name, address, latitude, longitude, source_type, capacity_m3_per_hour, operating_pressure_bar, installation_date, status, maintenance_contact, notes, geom, created_at, updated_at) VALUES ('CW-SHIFONUR-01', 'Резервуар Шифонур', 'ул. Шифонур, Ташкент', 41.351000, 69.219000, 'reservoir', 200.00, 3.50, NULL, 'active', NULL, NULL, '0101000020E6100000BC749318044E5140B0726891EDAC4440', '2025-07-29 06:53:15.704536+00', '2025-07-29 06:53:15.704536+00');


--
-- Data for Name: heat_sources; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.heat_sources (id, name, address, latitude, longitude, source_type, capacity_mw, fuel_type, installation_date, status, maintenance_contact, notes, geom, created_at, updated_at) VALUES ('HS-FARABI-01', 'Котельная Фараби', 'ул. Фараби, котельная №1, Ташкент', 41.347500, 69.201500, 'boiler_house', 4.50, 'gas', NULL, 'active', NULL, NULL, '0101000020E610000037894160E54C514014AE47E17AAC4440', '2025-07-29 06:53:15.705482+00', '2025-07-29 06:53:15.705482+00');
INSERT INTO public.heat_sources (id, name, address, latitude, longitude, source_type, capacity_mw, fuel_type, installation_date, status, maintenance_contact, notes, geom, created_at, updated_at) VALUES ('HS-OLMAZOR-01', 'ТЭЦ Олмазор', 'Олмазорский район, ТЭЦ-2, Ташкент', 41.348500, 69.199500, 'chp', 15.00, 'gas', NULL, 'active', NULL, NULL, '0101000020E610000054E3A59BC44C5140F853E3A59BAC4440', '2025-07-29 06:53:15.705482+00', '2025-07-29 06:53:15.705482+00');
INSERT INTO public.heat_sources (id, name, address, latitude, longitude, source_type, capacity_mw, fuel_type, installation_date, status, maintenance_contact, notes, geom, created_at, updated_at) VALUES ('HS-CENTRAL-01', 'Центральная котельная', 'Центральный район, Ташкент', 41.350000, 69.210000, 'boiler_house', 8.00, 'gas', NULL, 'active', NULL, NULL, '0101000020E61000003D0AD7A3704D5140CDCCCCCCCCAC4440', '2025-07-29 06:53:15.705482+00', '2025-07-29 06:53:15.705482+00');


--
-- Data for Name: power_transformers; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.power_transformers (id, name, address, latitude, longitude, capacity_kva, voltage_primary, voltage_secondary, installation_date, manufacturer, model, status, maintenance_contact, notes, geom, created_at, updated_at) VALUES ('TR-FARABI-01', 'Трансформатор Фараби-1', 'ул. Фараби, ТП-1, Ташкент', 41.347052, 69.203200, 630.00, 6000.00, 380.00, NULL, 'Узбекэнерго', NULL, 'active', NULL, NULL, '0101000020E610000005A3923A014D514075012F336CAC4440', '2025-07-29 06:53:15.683406+00', '2025-07-29 06:53:15.683406+00');
INSERT INTO public.power_transformers (id, name, address, latitude, longitude, capacity_kva, voltage_primary, voltage_secondary, installation_date, manufacturer, model, status, maintenance_contact, notes, geom, created_at, updated_at) VALUES ('TR-FARABI-02', 'Трансформатор Фараби-2', 'ул. Фараби, ТП-2, Ташкент', 41.347845, 69.200865, 1000.00, 6000.00, 380.00, NULL, 'Узбекэнерго', NULL, 'active', NULL, NULL, '0101000020E61000004E7ADFF8DA4C5140DF89592F86AC4440', '2025-07-29 06:53:15.683406+00', '2025-07-29 06:53:15.683406+00');
INSERT INTO public.power_transformers (id, name, address, latitude, longitude, capacity_kva, voltage_primary, voltage_secondary, installation_date, manufacturer, model, status, maintenance_contact, notes, geom, created_at, updated_at) VALUES ('TR-OLMAZOR-01', 'Трансформатор Олмазор-1', 'Олмазорский район, ТП-3, Ташкент', 41.348359, 69.198987, 800.00, 10000.00, 380.00, NULL, 'ABB', NULL, 'active', NULL, NULL, '0101000020E61000001155F833BC4C51403622180797AC4440', '2025-07-29 06:53:15.683406+00', '2025-07-29 06:53:15.683406+00');
INSERT INTO public.power_transformers (id, name, address, latitude, longitude, capacity_kva, voltage_primary, voltage_secondary, installation_date, manufacturer, model, status, maintenance_contact, notes, geom, created_at, updated_at) VALUES ('TR-SHIFONUR-01', 'Трансформатор Шифонур-1', 'ул. Шифонур, ТП-4, Ташкент', 41.351134, 69.219774, 500.00, 6000.00, 380.00, NULL, 'Сименс', NULL, 'maintenance', NULL, NULL, '0101000020E6100000B6A0F7C6104E5140C0417BF5F1AC4440', '2025-07-29 06:53:15.683406+00', '2025-07-29 06:53:15.683406+00');


--
-- Data for Name: transformers; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.transformers (transformer_id, name, power_kva, voltage_kv, location, installation_date, manufacturer, model, status, created_at, updated_at, latitude, longitude, geom) VALUES (1, '1111', 1000.00, 10.00, NULL, NULL, NULL, NULL, 'active', '2025-11-01 15:22:07.22101+00', '2025-11-01 15:22:07.22101+00', NULL, NULL, NULL);


--
-- Data for Name: buildings; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.buildings (building_id, name, address, town, latitude, longitude, region, management_company, hot_water, has_hot_water, geom, created_at, updated_at, power_transformer_id, cold_water_source_id, heat_source_id, primary_transformer_id, backup_transformer_id, primary_line_id, backup_line_id, cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id) VALUES (26, 'Olmazor-11V', 'Yangi Olmazor, 11V', 'Olmazor', 41.350342, 69.247379, 'Olmazor', 'PRO FACILITY KOMMUNAL', true, true, '0101000020E6100000E6ADBA0ED54F51402635B401D8AC4440', '2025-11-02 19:41:50.771405+00', '2025-11-02 19:41:50.771405+00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.buildings (building_id, name, address, town, latitude, longitude, region, management_company, hot_water, has_hot_water, geom, created_at, updated_at, power_transformer_id, cold_water_source_id, heat_source_id, primary_transformer_id, backup_transformer_id, primary_line_id, backup_line_id, cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id) VALUES (27, 'Olmazor-12V', 'Yangi Olmazor, 12V', 'Olmazor', 41.349726, 69.247271, 'Olmazor', 'PRO FACILITY KOMMUNAL', true, true, '0101000020E6100000F38FBE49D34F5140CB4752D2C3AC4440', '2025-11-02 19:41:50.771639+00', '2025-11-02 19:41:50.771639+00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.buildings (building_id, name, address, town, latitude, longitude, region, management_company, hot_water, has_hot_water, geom, created_at, updated_at, power_transformer_id, cold_water_source_id, heat_source_id, primary_transformer_id, backup_transformer_id, primary_line_id, backup_line_id, cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id) VALUES (28, 'Olmazor-13V', 'Yangi Olmazor, 13V', 'Olmazor', 41.349049, 69.247218, 'Olmazor', 'PRO FACILITY KOMMUNAL', NULL, NULL, '0101000020E6100000E23E726BD24F5140CBD93BA3ADAC4440', '2025-11-02 19:41:50.771837+00', '2025-11-02 19:41:50.771837+00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.buildings (building_id, name, address, town, latitude, longitude, region, management_company, hot_water, has_hot_water, geom, created_at, updated_at, power_transformer_id, cold_water_source_id, heat_source_id, primary_transformer_id, backup_transformer_id, primary_line_id, backup_line_id, cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id) VALUES (29, 'Olmazor-14V', 'Yangi Olmazor, 14V', 'Olmazor', 41.349151, 69.246436, 'Olmazor', 'PRO FACILITY KOMMUNAL', NULL, NULL, '0101000020E6100000A723809BC54F5140CF2EDFFAB0AC4440', '2025-11-02 19:41:50.772052+00', '2025-11-02 19:41:50.772052+00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.buildings (building_id, name, address, town, latitude, longitude, region, management_company, hot_water, has_hot_water, geom, created_at, updated_at, power_transformer_id, cold_water_source_id, heat_source_id, primary_transformer_id, backup_transformer_id, primary_line_id, backup_line_id, cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id) VALUES (30, 'Olmazor-15V', 'Yangi Olmazor, 15V', 'Olmazor', 41.349794, 69.246535, 'Olmazor', 'PRO FACILITY KOMMUNAL', true, true, '0101000020E61000007094BC3AC74F5140242BBF0CC6AC4440', '2025-11-02 19:41:50.772236+00', '2025-11-02 19:41:50.772236+00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.buildings (building_id, name, address, town, latitude, longitude, region, management_company, hot_water, has_hot_water, geom, created_at, updated_at, power_transformer_id, cold_water_source_id, heat_source_id, primary_transformer_id, backup_transformer_id, primary_line_id, backup_line_id, cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id) VALUES (31, 'Olmazor-16V', 'Yangi Olmazor, 16V', 'Olmazor', 41.350349, 69.246580, 'Olmazor', 'PRO FACILITY KOMMUNAL', true, true, '0101000020E610000040F67AF7C74F5140D9976C3CD8AC4440', '2025-11-02 19:41:50.772425+00', '2025-11-02 19:41:50.772425+00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.buildings (building_id, name, address, town, latitude, longitude, region, management_company, hot_water, has_hot_water, geom, created_at, updated_at, power_transformer_id, cold_water_source_id, heat_source_id, primary_transformer_id, backup_transformer_id, primary_line_id, backup_line_id, cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id) VALUES (32, 'Olmazor-17V', 'Yangi Olmazor, 17V', 'Olmazor', 41.350424, 69.246023, 'Olmazor', 'PRO FACILITY KOMMUNAL', NULL, NULL, '0101000020E610000015C440D7BE4F5140E3DD91B1DAAC4440', '2025-11-02 19:41:50.772617+00', '2025-11-02 19:41:50.772617+00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.buildings (building_id, name, address, town, latitude, longitude, region, management_company, hot_water, has_hot_water, geom, created_at, updated_at, power_transformer_id, cold_water_source_id, heat_source_id, primary_transformer_id, backup_transformer_id, primary_line_id, backup_line_id, cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id) VALUES (33, 'Olmazor-18V', 'Yangi Olmazor, 18V', 'Olmazor', 41.349970, 69.245834, 'Olmazor', 'PRO FACILITY KOMMUNAL', NULL, NULL, '0101000020E6100000AC8F87BEBB4F5140624A24D1CBAC4440', '2025-11-02 19:41:50.773001+00', '2025-11-02 19:41:50.773001+00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.buildings (building_id, name, address, town, latitude, longitude, region, management_company, hot_water, has_hot_water, geom, created_at, updated_at, power_transformer_id, cold_water_source_id, heat_source_id, primary_transformer_id, backup_transformer_id, primary_line_id, backup_line_id, cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id) VALUES (34, 'Olmazor-19V', 'Yangi Olmazor, 19V', 'Olmazor', 41.349638, 69.245780, 'Olmazor', 'PRO FACILITY KOMMUNAL', NULL, NULL, '0101000020E6100000B28009DCBA4F51402CB81FF0C0AC4440', '2025-11-02 19:41:50.773178+00', '2025-11-02 19:41:50.773178+00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.buildings (building_id, name, address, town, latitude, longitude, region, management_company, hot_water, has_hot_water, geom, created_at, updated_at, power_transformer_id, cold_water_source_id, heat_source_id, primary_transformer_id, backup_transformer_id, primary_line_id, backup_line_id, cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id) VALUES (35, 'Olmazor-20V', 'Yangi Olmazor, 20V', 'Olmazor', 41.349165, 69.245825, 'Olmazor', 'PRO FACILITY KOMMUNAL', NULL, NULL, '0101000020E610000082E2C798BB4F514034F44F70B1AC4440', '2025-11-02 19:41:50.773368+00', '2025-11-02 19:41:50.773368+00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.buildings (building_id, name, address, town, latitude, longitude, region, management_company, hot_water, has_hot_water, geom, created_at, updated_at, power_transformer_id, cold_water_source_id, heat_source_id, primary_transformer_id, backup_transformer_id, primary_line_id, backup_line_id, cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id) VALUES (36, 'Olmazor-21V', 'Yangi Olmazor, 21V', 'Olmazor', 41.349225, 69.245071, 'Olmazor', 'PRO FACILITY KOMMUNAL', NULL, NULL, '0101000020E6100000AC8C463EAF4F514009F9A067B3AC4440', '2025-11-02 19:41:50.773561+00', '2025-11-02 19:41:50.773561+00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.buildings (building_id, name, address, town, latitude, longitude, region, management_company, hot_water, has_hot_water, geom, created_at, updated_at, power_transformer_id, cold_water_source_id, heat_source_id, primary_transformer_id, backup_transformer_id, primary_line_id, backup_line_id, cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id) VALUES (37, 'Olmazor-22V', 'Yangi Olmazor, 22V', 'Olmazor', 41.349253, 69.244514, 'Olmazor', 'PRO FACILITY KOMMUNAL', NULL, NULL, '0101000020E6100000815A0C1EA64F5140D3838252B4AC4440', '2025-11-02 19:41:50.77378+00', '2025-11-02 19:41:50.77378+00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.buildings (building_id, name, address, town, latitude, longitude, region, management_company, hot_water, has_hot_water, geom, created_at, updated_at, power_transformer_id, cold_water_source_id, heat_source_id, primary_transformer_id, backup_transformer_id, primary_line_id, backup_line_id, cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id) VALUES (38, 'Olmazor-23V', 'Yangi Olmazor, 23V', 'Olmazor', 41.349361, 69.243804, 'Olmazor', 'PRO FACILITY KOMMUNAL', NULL, NULL, '0101000020E610000093A8177C9A4F5140BABF7ADCB7AC4440', '2025-11-02 19:41:50.77396+00', '2025-11-02 19:41:50.77396+00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.buildings (building_id, name, address, town, latitude, longitude, region, management_company, hot_water, has_hot_water, geom, created_at, updated_at, power_transformer_id, cold_water_source_id, heat_source_id, primary_transformer_id, backup_transformer_id, primary_line_id, backup_line_id, cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id) VALUES (39, 'Olmazor-25V', 'Yangi Olmazor, 25V', 'Olmazor', 41.350715, 69.244020, 'Olmazor', 'PRO FACILITY KOMMUNAL', NULL, NULL, '0101000020E61000007AE40F069E4F5140BB9BA73AE4AC4440', '2025-11-02 19:41:50.774156+00', '2025-11-02 19:41:50.774156+00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.buildings (building_id, name, address, town, latitude, longitude, region, management_company, hot_water, has_hot_water, geom, created_at, updated_at, power_transformer_id, cold_water_source_id, heat_source_id, primary_transformer_id, backup_transformer_id, primary_line_id, backup_line_id, cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id) VALUES (40, 'Olmazor-25V', 'Yangi Olmazor, 25V', 'Olmazor', 41.350559, 69.244729, 'Olmazor', 'PRO FACILITY KOMMUNAL', NULL, NULL, '0101000020E610000080D8D2A3A94F5140C328081EDFAC4440', '2025-11-02 19:41:50.774349+00', '2025-11-02 19:41:50.774349+00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.buildings (building_id, name, address, town, latitude, longitude, region, management_company, hot_water, has_hot_water, geom, created_at, updated_at, power_transformer_id, cold_water_source_id, heat_source_id, primary_transformer_id, backup_transformer_id, primary_line_id, backup_line_id, cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id) VALUES (41, 'Olmazor-27V', 'Yangi Olmazor, 27V', 'Olmazor', 41.350505, 69.245268, 'Olmazor', 'PRO FACILITY KOMMUNAL', NULL, NULL, '0101000020E610000057B08D78B24F5140D00A0C59DDAC4440', '2025-11-02 19:41:50.774725+00', '2025-11-02 19:41:50.774725+00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.buildings (building_id, name, address, town, latitude, longitude, region, management_company, hot_water, has_hot_water, geom, created_at, updated_at, power_transformer_id, cold_water_source_id, heat_source_id, primary_transformer_id, backup_transformer_id, primary_line_id, backup_line_id, cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id) VALUES (42, 'Olmazor-1G', 'Yangi Olmazor, 1G', 'Olmazor', 41.350207, 69.248062, 'Olmazor', 'PRO FACILITY KOMMUNAL', NULL, NULL, '0101000020E61000005858703FE04F514046EA3D95D3AC4440', '2025-11-02 19:41:50.774914+00', '2025-11-02 19:41:50.774914+00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.buildings (building_id, name, address, town, latitude, longitude, region, management_company, hot_water, has_hot_water, geom, created_at, updated_at, power_transformer_id, cold_water_source_id, heat_source_id, primary_transformer_id, backup_transformer_id, primary_line_id, backup_line_id, cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id) VALUES (43, 'Olmazor-9G', 'Yangi Olmazor, 9G', 'Olmazor', 41.349239, 69.247846, 'Olmazor', 'PRO FACILITY KOMMUNAL', NULL, NULL, '0101000020E6100000711C78B5DC4F51406EBE11DDB3AC4440', '2025-11-02 19:41:50.775103+00', '2025-11-02 19:41:50.775103+00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.buildings (building_id, name, address, town, latitude, longitude, region, management_company, hot_water, has_hot_water, geom, created_at, updated_at, power_transformer_id, cold_water_source_id, heat_source_id, primary_transformer_id, backup_transformer_id, primary_line_id, backup_line_id, cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id) VALUES (44, 'Olmazor-8G', 'Yangi Olmazor, 8G', 'Olmazor', 41.349022, 69.248305, 'Olmazor', 'PRO FACILITY KOMMUNAL', NULL, NULL, '0101000020E6100000BB9BA73AE44F5140D1CABDC0ACAC4440', '2025-11-02 19:41:50.77529+00', '2025-11-02 19:41:50.77529+00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.buildings (building_id, name, address, town, latitude, longitude, region, management_company, hot_water, has_hot_water, geom, created_at, updated_at, power_transformer_id, cold_water_source_id, heat_source_id, primary_transformer_id, backup_transformer_id, primary_line_id, backup_line_id, cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id) VALUES (45, 'Olmazor-7G', 'Yangi Olmazor, 7G', 'Olmazor', 41.348975, 69.248870, 'Olmazor', 'PRO FACILITY KOMMUNAL', NULL, NULL, '0101000020E610000027BD6F7CED4F5140910F7A36ABAC4440', '2025-11-02 19:41:50.775533+00', '2025-11-02 19:41:50.775533+00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.buildings (building_id, name, address, town, latitude, longitude, region, management_company, hot_water, has_hot_water, geom, created_at, updated_at, power_transformer_id, cold_water_source_id, heat_source_id, primary_transformer_id, backup_transformer_id, primary_line_id, backup_line_id, cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id) VALUES (46, 'Olmazor-6G', 'Yangi Olmazor, 6G', 'Olmazor', 41.349043, 69.249400, 'Olmazor', 'PRO FACILITY KOMMUNAL', NULL, NULL, '0101000020E6100000D5E76A2BF64F5140E9F2E670ADAC4440', '2025-11-02 19:41:50.775769+00', '2025-11-02 19:41:50.775769+00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.buildings (building_id, name, address, town, latitude, longitude, region, management_company, hot_water, has_hot_water, geom, created_at, updated_at, power_transformer_id, cold_water_source_id, heat_source_id, primary_transformer_id, backup_transformer_id, primary_line_id, backup_line_id, cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id) VALUES (47, 'Olmazor-5G', 'Yangi Olmazor, 5G', 'Olmazor', 41.349496, 69.249481, 'Olmazor', 'PRO FACILITY KOMMUNAL', NULL, NULL, '0101000020E61000004CFE277FF74F51409A0AF148BCAC4440', '2025-11-02 19:41:50.775971+00', '2025-11-02 19:41:50.775971+00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.buildings (building_id, name, address, town, latitude, longitude, region, management_company, hot_water, has_hot_water, geom, created_at, updated_at, power_transformer_id, cold_water_source_id, heat_source_id, primary_transformer_id, backup_transformer_id, primary_line_id, backup_line_id, cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id) VALUES (48, 'Olmazor-4G', 'Yangi Olmazor, 4G', 'Olmazor', 41.349997, 69.249634, 'Olmazor', 'PRO FACILITY KOMMUNAL', NULL, NULL, '0101000020E61000000F7EE200FA4F51405C59A2B3CCAC4440', '2025-11-02 19:41:50.776154+00', '2025-11-02 19:41:50.776154+00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.buildings (building_id, name, address, town, latitude, longitude, region, management_company, hot_water, has_hot_water, geom, created_at, updated_at, power_transformer_id, cold_water_source_id, heat_source_id, primary_transformer_id, backup_transformer_id, primary_line_id, backup_line_id, cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id) VALUES (49, 'Olmazor-3G', 'Yangi Olmazor, 3G', 'Olmazor', 41.350309, 69.249158, 'Olmazor', 'PRO FACILITY KOMMUNAL', NULL, NULL, '0101000020E61000005A626534F24F51404B3FE1ECD6AC4440', '2025-11-02 19:41:50.776487+00', '2025-11-02 19:41:50.776487+00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.buildings (building_id, name, address, town, latitude, longitude, region, management_company, hot_water, has_hot_water, geom, created_at, updated_at, power_transformer_id, cold_water_source_id, heat_source_id, primary_transformer_id, backup_transformer_id, primary_line_id, backup_line_id, cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id) VALUES (50, 'Olmazor-2G', 'Yangi Olmazor, 2G', 'Olmazor', 41.350376, 69.248565, 'Olmazor', 'PRO FACILITY KOMMUNAL', NULL, NULL, '0101000020E6100000897B2C7DE84F5140D2A6EA1ED9AC4440', '2025-11-02 19:41:50.776661+00', '2025-11-02 19:41:50.776661+00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.buildings (building_id, name, address, town, latitude, longitude, region, management_company, hot_water, has_hot_water, geom, created_at, updated_at, power_transformer_id, cold_water_source_id, heat_source_id, primary_transformer_id, backup_transformer_id, primary_line_id, backup_line_id, cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id) VALUES (51, 'Olmazor-10G', 'Yangi Olmazor, 10G', 'Olmazor', 41.349672, 69.247963, 'Olmazor', 'PRO FACILITY KOMMUNAL', NULL, NULL, '0101000020E61000008EE733A0DE4F5140D829560DC2AC4440', '2025-11-02 19:41:50.776843+00', '2025-11-02 19:41:50.776843+00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.buildings (building_id, name, address, town, latitude, longitude, region, management_company, hot_water, has_hot_water, geom, created_at, updated_at, power_transformer_id, cold_water_source_id, heat_source_id, primary_transformer_id, backup_transformer_id, primary_line_id, backup_line_id, cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id) VALUES (52, 'Olmazor-11G', 'Yangi Olmazor, 11G', 'Olmazor', 41.349408, 69.248951, 'Olmazor', 'PRO FACILITY KOMMUNAL', NULL, NULL, '0101000020E61000009ED32CD0EE4F5140FA7ABE66B9AC4440', '2025-11-02 19:41:50.777015+00', '2025-11-02 19:41:50.777015+00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.buildings (building_id, name, address, town, latitude, longitude, region, management_company, hot_water, has_hot_water, geom, created_at, updated_at, power_transformer_id, cold_water_source_id, heat_source_id, primary_transformer_id, backup_transformer_id, primary_line_id, backup_line_id, cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id) VALUES (53, 'Olmazor-12G', 'Yangi Olmazor, 12G', 'Olmazor', 41.349435, 69.248439, 'Olmazor', 'PRO FACILITY KOMMUNAL', NULL, NULL, '0101000020E61000004303B16CE64F5140F4893C49BAAC4440', '2025-11-02 19:41:50.777226+00', '2025-11-02 19:41:50.777226+00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.buildings (building_id, name, address, town, latitude, longitude, region, management_company, hot_water, has_hot_water, geom, created_at, updated_at, power_transformer_id, cold_water_source_id, heat_source_id, primary_transformer_id, backup_transformer_id, primary_line_id, backup_line_id, cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id) VALUES (54, 'Olmazor-13G', 'Yangi Olmazor, 13G', 'Olmazor', 41.348745, 69.250020, 'Olmazor', 'PRO FACILITY KOMMUNAL', NULL, NULL, '0101000020E610000024D6E253005051405FD218ADA3AC4440', '2025-11-02 19:41:50.777396+00', '2025-11-02 19:41:50.777396+00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.buildings (building_id, name, address, town, latitude, longitude, region, management_company, hot_water, has_hot_water, geom, created_at, updated_at, power_transformer_id, cold_water_source_id, heat_source_id, primary_transformer_id, backup_transformer_id, primary_line_id, backup_line_id, cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id) VALUES (55, 'Olmazor-14G', 'Yangi Olmazor, 14G', 'Olmazor', 41.349225, 69.250083, 'Olmazor', 'PRO FACILITY KOMMUNAL', NULL, NULL, '0101000020E61000004792205C0150514009F9A067B3AC4440', '2025-11-02 19:41:50.777589+00', '2025-11-02 19:41:50.777589+00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);


--
-- Data for Name: controllers; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.controllers (controller_id, serial_number, vendor, model, building_id, status, installed_at, last_heartbeat) VALUES (44, 'CRTL_OL_29', 'Infrasafe', 'alfa', 54, 'active', '2025-07-29 10:00:00+00', '2025-07-29 10:00:00+00');
INSERT INTO public.controllers (controller_id, serial_number, vendor, model, building_id, status, installed_at, last_heartbeat) VALUES (45, 'CRTL_OL_30', 'Infrasafe', 'alfa', 55, 'active', '2025-07-30 10:00:00+00', '2025-07-30 10:00:00+00');
INSERT INTO public.controllers (controller_id, serial_number, vendor, model, building_id, status, installed_at, last_heartbeat) VALUES (1, 'CRTL_OL_01', 'Infrasafe', 'alfa', 26, 'online', '2025-11-03 09:28:09.853472+00', '2025-11-15 12:08:00.215+00');
INSERT INTO public.controllers (controller_id, serial_number, vendor, model, building_id, status, installed_at, last_heartbeat) VALUES (7, 'CRTL_OL_08', 'Infrasafe', 'alfa', 32, 'online', '2025-11-03 09:31:57.342427+00', NULL);
INSERT INTO public.controllers (controller_id, serial_number, vendor, model, building_id, status, installed_at, last_heartbeat) VALUES (8, 'CRTL_OL_09', 'Infrasafe', 'alfa', 33, 'online', '2025-11-03 09:31:57.342427+00', NULL);
INSERT INTO public.controllers (controller_id, serial_number, vendor, model, building_id, status, installed_at, last_heartbeat) VALUES (9, 'CRTL_OL_10', 'Infrasafe', 'alfa', 34, 'online', '2025-11-03 09:31:57.342427+00', NULL);
INSERT INTO public.controllers (controller_id, serial_number, vendor, model, building_id, status, installed_at, last_heartbeat) VALUES (10, 'CRTL_OL_11', 'Infrasafe', 'alfa', 35, 'online', '2025-11-03 09:31:57.342427+00', NULL);
INSERT INTO public.controllers (controller_id, serial_number, vendor, model, building_id, status, installed_at, last_heartbeat) VALUES (11, 'CRTL_OL_12', 'Infrasafe', 'alfa', 36, 'online', '2025-11-03 09:31:57.342427+00', NULL);
INSERT INTO public.controllers (controller_id, serial_number, vendor, model, building_id, status, installed_at, last_heartbeat) VALUES (2, 'CRTL_OL_02', 'Infrasafe', 'alfa', 27, 'online', '2025-11-03 09:28:09.853472+00', '2025-11-15 12:08:00.244+00');
INSERT INTO public.controllers (controller_id, serial_number, vendor, model, building_id, status, installed_at, last_heartbeat) VALUES (3, 'CRTL_OL_03', 'Infrasafe', 'alfa', 28, 'online', '2025-11-03 09:28:09.853472+00', '2025-11-15 12:08:00.248+00');
INSERT INTO public.controllers (controller_id, serial_number, vendor, model, building_id, status, installed_at, last_heartbeat) VALUES (4, 'CRTL_OL_04', 'Infrasafe', 'alfa', 29, 'online', '2025-11-03 09:28:09.853472+00', '2025-11-15 12:08:00.251+00');
INSERT INTO public.controllers (controller_id, serial_number, vendor, model, building_id, status, installed_at, last_heartbeat) VALUES (5, 'CRTL_OL_05', 'Infrasafe', 'alfa', 30, 'online', '2025-11-03 09:28:09.853472+00', '2025-11-15 12:08:00.254+00');
INSERT INTO public.controllers (controller_id, serial_number, vendor, model, building_id, status, installed_at, last_heartbeat) VALUES (6, 'CRTL_OL_06', 'Infrasafe', 'alfa', 31, 'online', '2025-11-03 09:28:09.853472+00', '2025-11-15 12:08:00.259+00');
INSERT INTO public.controllers (controller_id, serial_number, vendor, model, building_id, status, installed_at, last_heartbeat) VALUES (21, 'CRTL_OL_21', 'Infrasafe', 'alfa', 46, 'active', '2025-07-29 10:00:00+00', NULL);
INSERT INTO public.controllers (controller_id, serial_number, vendor, model, building_id, status, installed_at, last_heartbeat) VALUES (20, 'CRTL_OL_20', 'Infrasafe', 'alfa', 45, 'active', '2025-07-29 10:00:00+00', NULL);
INSERT INTO public.controllers (controller_id, serial_number, vendor, model, building_id, status, installed_at, last_heartbeat) VALUES (19, 'CRTL_OL_19', 'Infrasafe', 'alfa', 44, 'active', '2025-07-29 10:00:00+00', NULL);
INSERT INTO public.controllers (controller_id, serial_number, vendor, model, building_id, status, installed_at, last_heartbeat) VALUES (22, 'CRTL_OL_22', 'Infrasafe', 'alfa', 47, 'active', '2025-07-29 10:00:00+00', NULL);
INSERT INTO public.controllers (controller_id, serial_number, vendor, model, building_id, status, installed_at, last_heartbeat) VALUES (28, 'CRTL_OL_28', 'Infrasafe', 'alfa', 53, 'active', '2025-11-03 09:37:22.322952+00', NULL);
INSERT INTO public.controllers (controller_id, serial_number, vendor, model, building_id, status, installed_at, last_heartbeat) VALUES (27, 'CRTL_OL_27', 'Infrasafe', 'alfa', 52, 'active', '2025-11-03 09:37:22.322952+00', NULL);
INSERT INTO public.controllers (controller_id, serial_number, vendor, model, building_id, status, installed_at, last_heartbeat) VALUES (26, 'CRTL_OL_26', 'Infrasafe', 'alfa', 51, 'active', '2025-11-03 09:37:22.322952+00', NULL);
INSERT INTO public.controllers (controller_id, serial_number, vendor, model, building_id, status, installed_at, last_heartbeat) VALUES (25, 'CRTL_OL_25', 'Infrasafe', 'alfa', 50, 'active', '2025-11-03 09:37:22.322952+00', NULL);
INSERT INTO public.controllers (controller_id, serial_number, vendor, model, building_id, status, installed_at, last_heartbeat) VALUES (24, 'CRTL_OL_24', 'Infrasafe', 'alfa', 49, 'active', '2025-11-03 09:37:22.322952+00', NULL);
INSERT INTO public.controllers (controller_id, serial_number, vendor, model, building_id, status, installed_at, last_heartbeat) VALUES (23, 'CRTL_OL_23', 'Infrasafe', 'alfa', 48, 'active', '2025-11-03 09:37:22.322952+00', NULL);
INSERT INTO public.controllers (controller_id, serial_number, vendor, model, building_id, status, installed_at, last_heartbeat) VALUES (12, 'CRTL_OL_13', 'Infrasafe', 'alfa', 37, 'online', '2025-11-03 09:31:57.342427+00', NULL);
INSERT INTO public.controllers (controller_id, serial_number, vendor, model, building_id, status, installed_at, last_heartbeat) VALUES (13, 'CRTL_OL_14', 'Infrasafe', 'alfa', 38, 'online', '2025-11-03 09:31:57.342427+00', NULL);
INSERT INTO public.controllers (controller_id, serial_number, vendor, model, building_id, status, installed_at, last_heartbeat) VALUES (14, 'CRTL_OL_15', 'Infrasafe', 'alfa', 39, 'online', '2025-11-03 09:31:57.342427+00', NULL);
INSERT INTO public.controllers (controller_id, serial_number, vendor, model, building_id, status, installed_at, last_heartbeat) VALUES (15, 'CRTL_OL_07', 'Infrasafe', 'alfa', 40, 'online', '2025-11-03 09:31:57.342427+00', NULL);
INSERT INTO public.controllers (controller_id, serial_number, vendor, model, building_id, status, installed_at, last_heartbeat) VALUES (16, 'CRTL_OL_16', 'Infrasafe', 'alfa', 41, 'online', '2025-11-03 09:33:31.78857+00', NULL);
INSERT INTO public.controllers (controller_id, serial_number, vendor, model, building_id, status, installed_at, last_heartbeat) VALUES (17, 'CRTL_OL_17', 'Infrasafe', 'alfa', 42, 'online', '2025-11-03 09:33:31.78857+00', NULL);
INSERT INTO public.controllers (controller_id, serial_number, vendor, model, building_id, status, installed_at, last_heartbeat) VALUES (18, 'CRTL_OL_18', 'Infrasafe', 'alfa', 43, 'online', '2025-07-29 10:00:00+00', NULL);


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.users (user_id, username, email, password_hash, full_name, role, is_active, created_at, updated_at, last_login) VALUES (55, 'admin', 'admin@infrasafe.com', '$2b$12$qTytJ.AoOkeVeV4tDhwMZuYAmAEphccDaudFkVsMBhcfrWvmP5Q1W', NULL, 'admin', true, '2025-10-31 11:16:19.469741+00', '2025-10-31 11:16:35.514444+00', '2025-11-15 10:00:00.303315+00');


--
-- Data for Name: infrastructure_alerts; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.infrastructure_alerts (alert_id, type, infrastructure_id, infrastructure_type, severity, status, message, affected_buildings, data, created_at, acknowledged_at, resolved_at, acknowledged_by, resolved_by) VALUES (1, 'TRANSFORMER_OVERLOAD', 'TR-FARABI-02', 'transformer', 'WARNING', 'active', 'Высокая загрузка трансформатора Фараби-2: 87.3%', 5, '{"capacity_kva": 1000.0, "load_percent": 87.3, "threshold_used": 85, "affected_buildings": ["Farabi-005", "Farabi-006", "Farabi-007", "Farabi-008", "Farabi-009"]}', '2025-07-29 06:53:15.804449+00', NULL, NULL, NULL, NULL);
INSERT INTO public.infrastructure_alerts (alert_id, type, infrastructure_id, infrastructure_type, severity, status, message, affected_buildings, data, created_at, acknowledged_at, resolved_at, acknowledged_by, resolved_by) VALUES (2, 'TRANSFORMER_CRITICAL_OVERLOAD', 'TR-OLMAZOR-01', 'transformer', 'CRITICAL', 'active', 'КРИТИЧЕСКАЯ перегрузка трансформатора Олмазор-1: 96.8%', 5, '{"capacity_kva": 800.0, "load_percent": 96.8, "threshold_used": 95, "affected_buildings": ["Farabi-010", "Farabi-011", "Farabi-012", "Farabi-013", "Farabi-014"]}', '2025-07-29 06:53:15.804449+00', NULL, NULL, NULL, NULL);
INSERT INTO public.infrastructure_alerts (alert_id, type, infrastructure_id, infrastructure_type, severity, status, message, affected_buildings, data, created_at, acknowledged_at, resolved_at, acknowledged_by, resolved_by) VALUES (3, 'WATER_PRESSURE_LOW', 'CW-OLMAZOR-01', 'water_source', 'WARNING', 'acknowledged', 'Низкое давление в водозаборе Олмазор: 2.1 bar', 7, '{"threshold": 2.5, "pressure_bar": 2.1, "normal_pressure": 4.5, "affected_buildings": 7}', '2025-07-29 06:53:15.804449+00', NULL, NULL, NULL, NULL);
INSERT INTO public.infrastructure_alerts (alert_id, type, infrastructure_id, infrastructure_type, severity, status, message, affected_buildings, data, created_at, acknowledged_at, resolved_at, acknowledged_by, resolved_by) VALUES (4, 'MAINTENANCE_SCHEDULED', 'TR-SHIFONUR-01', 'transformer', 'INFO', 'active', 'Плановое обслуживание трансформатора Шифонур-1', 1, '{"maintenance_type": "planned", "affected_buildings": ["Shifonur-3A"], "expected_duration_hours": 4}', '2025-07-29 06:53:15.804449+00', NULL, NULL, NULL, NULL);
INSERT INTO public.infrastructure_alerts (alert_id, type, infrastructure_id, infrastructure_type, severity, status, message, affected_buildings, data, created_at, acknowledged_at, resolved_at, acknowledged_by, resolved_by) VALUES (5, 'COMMUNICATION_LOST', 'CTRL003', 'controller', 'WARNING', 'active', 'Потеря связи с контроллером CTRL003 в здании Farabi-008', 1, '{"building": "Farabi-008", "duration_hours": 3, "last_heartbeat": "2025-06-08T00:58:41.000Z"}', '2025-07-29 06:53:15.804449+00', NULL, NULL, NULL, NULL);
INSERT INTO public.infrastructure_alerts (alert_id, type, infrastructure_id, infrastructure_type, severity, status, message, affected_buildings, data, created_at, acknowledged_at, resolved_at, acknowledged_by, resolved_by) VALUES (6, 'VOLTAGE_ANOMALY', 'TR-FARABI-01', 'transformer', 'WARNING', 'resolved', 'Нестабильное напряжение в трансформаторе Фараби-1: колебания 190-250V', 6, '{"voltage_max": 250, "voltage_min": 190, "normal_range": "215-225", "affected_buildings": 6}', '2025-07-29 06:53:15.804449+00', NULL, NULL, NULL, NULL);
INSERT INTO public.infrastructure_alerts (alert_id, type, infrastructure_id, infrastructure_type, severity, status, message, affected_buildings, data, created_at, acknowledged_at, resolved_at, acknowledged_by, resolved_by) VALUES (7, 'TEMPERATURE_HIGH', 'TEST-INFRA-001', 'controller', 'WARNING', 'active', 'High temperature detected in test controller', 1, '{"threshold": 30, "temperature": 35.5}', '2025-08-02 09:26:50.73726+00', NULL, NULL, NULL, NULL);
INSERT INTO public.infrastructure_alerts (alert_id, type, infrastructure_id, infrastructure_type, severity, status, message, affected_buildings, data, created_at, acknowledged_at, resolved_at, acknowledged_by, resolved_by) VALUES (8, 'TEMPERATURE_HIGH', 'TEST-INFRA-001', 'controller', 'WARNING', 'active', 'High temperature detected in test controller', 1, '{"threshold": 30, "temperature": 35.5}', '2025-08-02 09:28:59.532743+00', NULL, NULL, NULL, NULL);
INSERT INTO public.infrastructure_alerts (alert_id, type, infrastructure_id, infrastructure_type, severity, status, message, affected_buildings, data, created_at, acknowledged_at, resolved_at, acknowledged_by, resolved_by) VALUES (9, 'TEMPERATURE_HIGH', 'TEST-INFRA-001', 'controller', 'WARNING', 'active', 'High temperature detected in test controller', 1, '{"threshold": 30, "temperature": 35.5}', '2025-08-02 09:29:50.468506+00', NULL, NULL, NULL, NULL);
INSERT INTO public.infrastructure_alerts (alert_id, type, infrastructure_id, infrastructure_type, severity, status, message, affected_buildings, data, created_at, acknowledged_at, resolved_at, acknowledged_by, resolved_by) VALUES (10, 'TEMPERATURE_HIGH', 'TEST-INFRA-001', 'controller', 'WARNING', 'active', 'High temperature detected in test controller', 1, '{"threshold": 30, "temperature": 35.5}', '2025-08-02 09:30:18.477759+00', NULL, NULL, NULL, NULL);
INSERT INTO public.infrastructure_alerts (alert_id, type, infrastructure_id, infrastructure_type, severity, status, message, affected_buildings, data, created_at, acknowledged_at, resolved_at, acknowledged_by, resolved_by) VALUES (11, 'TEMPERATURE_HIGH', 'TEST-INFRA-001', 'controller', 'WARNING', 'active', 'High temperature detected in test controller', 1, '{"threshold": 30, "temperature": 35.5}', '2025-08-02 09:30:48.242696+00', NULL, NULL, NULL, NULL);
INSERT INTO public.infrastructure_alerts (alert_id, type, infrastructure_id, infrastructure_type, severity, status, message, affected_buildings, data, created_at, acknowledged_at, resolved_at, acknowledged_by, resolved_by) VALUES (12, 'TEMPERATURE_HIGH', 'TEST-INFRA-001', 'controller', 'WARNING', 'active', 'High temperature detected in test controller', 1, '{"threshold": 30, "temperature": 35.5}', '2025-08-02 09:31:12.338693+00', NULL, NULL, NULL, NULL);
INSERT INTO public.infrastructure_alerts (alert_id, type, infrastructure_id, infrastructure_type, severity, status, message, affected_buildings, data, created_at, acknowledged_at, resolved_at, acknowledged_by, resolved_by) VALUES (13, 'TEMPERATURE_HIGH', 'TEST-INFRA-001', 'controller', 'WARNING', 'active', 'High temperature detected in test controller', 1, '{"threshold": 30, "temperature": 35.5}', '2025-08-02 09:35:30.831126+00', NULL, NULL, NULL, NULL);
INSERT INTO public.infrastructure_alerts (alert_id, type, infrastructure_id, infrastructure_type, severity, status, message, affected_buildings, data, created_at, acknowledged_at, resolved_at, acknowledged_by, resolved_by) VALUES (14, 'TEMPERATURE_HIGH', 'TEST-INFRA-001', 'controller', 'WARNING', 'active', 'High temperature detected in test controller', 1, '{"threshold": 30, "temperature": 35.5}', '2025-08-02 09:37:27.573049+00', NULL, NULL, NULL, NULL);
INSERT INTO public.infrastructure_alerts (alert_id, type, infrastructure_id, infrastructure_type, severity, status, message, affected_buildings, data, created_at, acknowledged_at, resolved_at, acknowledged_by, resolved_by) VALUES (15, 'TEMPERATURE_HIGH', 'TEST-INFRA-001', 'controller', 'WARNING', 'active', 'High temperature detected in test controller', 1, '{"threshold": 30, "temperature": 35.5}', '2025-08-02 09:38:14.55025+00', NULL, NULL, NULL, NULL);
INSERT INTO public.infrastructure_alerts (alert_id, type, infrastructure_id, infrastructure_type, severity, status, message, affected_buildings, data, created_at, acknowledged_at, resolved_at, acknowledged_by, resolved_by) VALUES (16, 'TEMPERATURE_HIGH', 'TEST-INFRA-001', 'controller', 'WARNING', 'active', 'High temperature detected in test controller', 1, '{"threshold": 30, "temperature": 35.5}', '2025-08-02 09:38:57.967046+00', NULL, NULL, NULL, NULL);
INSERT INTO public.infrastructure_alerts (alert_id, type, infrastructure_id, infrastructure_type, severity, status, message, affected_buildings, data, created_at, acknowledged_at, resolved_at, acknowledged_by, resolved_by) VALUES (17, 'TEMPERATURE_HIGH', 'TEST-INFRA-001', 'controller', 'WARNING', 'active', 'High temperature detected in test controller', 1, '{"threshold": 30, "temperature": 35.5}', '2025-08-02 09:40:36.24932+00', NULL, NULL, NULL, NULL);
INSERT INTO public.infrastructure_alerts (alert_id, type, infrastructure_id, infrastructure_type, severity, status, message, affected_buildings, data, created_at, acknowledged_at, resolved_at, acknowledged_by, resolved_by) VALUES (18, 'TEMPERATURE_HIGH', 'TEST-INFRA-001', 'controller', 'WARNING', 'active', 'High temperature detected in test controller', 1, '{"threshold": 30, "temperature": 35.5}', '2025-08-02 09:41:41.120823+00', NULL, NULL, NULL, NULL);


--
-- Name: alert_types_alert_type_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.alert_types_alert_type_id_seq', 7, true);


--
-- Name: buildings_building_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.buildings_building_id_seq', 55, true);


--
-- Name: controllers_controller_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.controllers_controller_id_seq', 45, true);


--
-- Name: infrastructure_alerts_alert_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.infrastructure_alerts_alert_id_seq', 18, true);


--
-- Name: transformers_transformer_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.transformers_transformer_id_seq', 1, true);


--
-- Name: users_user_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.users_user_id_seq', 55, true);


--
-- Data for Name: metrics (subset 2025-11-15 09:00..12:08 UTC); Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.metrics (metric_id, controller_id, "timestamp", electricity_ph1, electricity_ph2, electricity_ph3, amperage_ph1, amperage_ph2, amperage_ph3, cold_water_pressure, cold_water_temp, hot_water_in_pressure, hot_water_out_pressure, hot_water_in_temp, hot_water_out_temp, air_temp, humidity, leak_sensor) FROM STDIN WITH (FORMAT csv);
27445,1,2025-11-15 09:00:01.113+00,223.82,219.87,219.39,5.74,10.11,11.65,6.59,10.73,5.37,4.03,53.69,48.27,23.23,50.65,f
27446,2,2025-11-15 09:00:01.143+00,219.91,218.44,218.79,10.25,9.24,8.03,2.74,13.98,5.67,4.32,50.06,48.85,18.46,46.62,f
27447,3,2025-11-15 09:00:01.148+00,211.41,213.37,208.66,20.01,36.70,27.44,4.12,13.59,0.00,0.00,0.00,0.00,10.00,30.00,f
27448,4,2025-11-15 09:00:01.151+00,220.21,243.44,239.25,19.88,36.13,29.44,3.43,9.48,0.00,0.00,0.00,0.00,10.00,30.00,f
27449,5,2025-11-15 09:00:01.155+00,219.06,219.65,217.79,13.22,11.67,9.00,5.76,18.16,5.98,4.08,50.94,44.21,22.94,42.10,f
27450,6,2025-11-15 09:00:01.159+00,222.90,216.95,220.44,14.61,13.71,10.90,1.50,13.67,5.46,4.71,55.14,46.98,21.43,45.60,f
27451,1,2025-11-15 09:02:00.722+00,221.70,224.86,219.90,6.25,6.27,9.28,3.55,12.68,5.44,4.66,57.96,46.14,22.98,41.28,f
27452,2,2025-11-15 09:02:00.748+00,218.23,219.77,217.88,9.55,9.92,11.73,3.81,14.30,5.63,4.59,52.27,42.94,19.70,56.85,f
27453,3,2025-11-15 09:02:00.751+00,228.14,242.31,244.20,27.14,33.47,17.37,3.57,13.03,0.00,0.00,0.00,0.00,10.00,30.00,f
27454,4,2025-11-15 09:02:00.754+00,200.51,227.85,214.81,10.40,22.89,40.99,5.00,12.49,0.00,0.00,0.00,0.00,10.00,30.00,f
27455,5,2025-11-15 09:02:00.757+00,215.10,215.43,223.08,5.98,11.57,13.08,2.77,14.66,5.47,4.60,56.04,43.70,23.88,54.31,f
27456,6,2025-11-15 09:02:00.76+00,222.37,217.62,223.84,12.32,7.68,9.49,4.80,18.45,5.01,4.16,51.72,45.57,22.37,58.27,f
27457,1,2025-11-15 09:04:00.328+00,223.93,223.93,221.99,10.24,6.78,8.65,6.04,19.96,5.05,4.48,50.55,43.44,18.66,51.01,f
27458,2,2025-11-15 09:04:00.36+00,219.76,223.34,222.52,8.77,11.31,8.64,6.56,19.49,5.98,4.90,58.49,41.14,24.06,41.75,f
27459,3,2025-11-15 09:04:00.364+00,217.24,236.29,225.63,16.92,26.89,39.24,5.32,12.36,0.00,0.00,0.00,0.00,10.00,30.00,f
27460,4,2025-11-15 09:04:00.369+00,217.44,212.78,228.83,10.26,33.86,27.21,6.67,14.38,0.00,0.00,0.00,0.00,10.00,30.00,f
27461,5,2025-11-15 09:04:00.372+00,217.21,223.27,216.71,14.38,10.92,11.65,3.02,19.91,5.84,4.02,57.63,43.75,22.29,47.41,f
27462,6,2025-11-15 09:04:00.376+00,224.16,216.68,215.57,9.47,5.42,7.53,2.95,10.91,5.91,4.87,52.14,44.59,21.44,45.82,f
27463,1,2025-11-15 09:06:00.919+00,217.14,223.98,216.65,11.88,6.02,7.17,4.96,15.91,5.47,4.17,51.70,48.03,22.87,57.10,f
27464,2,2025-11-15 09:06:00.955+00,216.97,220.01,223.55,10.85,12.86,10.42,6.40,12.89,5.54,4.14,50.63,45.17,19.86,57.83,f
27465,3,2025-11-15 09:06:00.96+00,246.02,221.30,234.96,35.69,21.22,35.49,3.64,11.26,0.00,0.00,0.00,0.00,10.00,30.00,f
27466,4,2025-11-15 09:06:00.964+00,210.55,223.77,215.94,24.43,38.04,31.33,4.45,13.88,0.00,0.00,0.00,0.00,10.00,30.00,f
27467,5,2025-11-15 09:06:00.968+00,221.04,223.53,223.46,10.02,7.62,5.93,1.52,15.69,5.62,4.55,53.03,40.82,19.01,44.64,f
27468,6,2025-11-15 09:06:00.971+00,224.75,216.03,215.78,11.77,13.15,12.33,2.26,14.56,5.74,4.12,56.20,49.91,20.57,45.23,f
27469,1,2025-11-15 09:08:00.497+00,217.82,224.39,220.90,9.45,8.77,7.72,6.66,12.62,5.39,4.22,56.01,41.93,24.33,52.86,f
27470,2,2025-11-15 09:08:00.529+00,216.97,223.58,215.47,12.26,9.00,8.47,5.45,14.31,5.25,4.51,53.32,48.59,24.08,43.26,f
27471,3,2025-11-15 09:08:00.535+00,229.32,214.67,204.40,39.61,31.35,15.10,3.86,10.24,0.00,0.00,0.00,0.00,10.00,30.00,f
27472,4,2025-11-15 09:08:00.539+00,212.52,247.69,228.45,19.75,31.80,44.34,6.23,12.63,0.00,0.00,0.00,0.00,10.00,30.00,f
27473,5,2025-11-15 09:08:00.542+00,221.96,215.90,218.36,11.63,14.25,11.98,5.03,16.79,5.79,4.68,54.67,41.73,19.94,45.57,f
27474,6,2025-11-15 09:08:00.547+00,222.28,222.82,216.38,13.81,13.14,12.06,4.63,15.83,5.00,4.88,50.01,49.93,18.07,45.06,f
27475,1,2025-11-15 09:10:01.005+00,222.57,224.10,219.61,7.24,7.99,5.28,4.04,19.16,5.33,4.31,54.84,45.58,21.15,41.15,f
27476,2,2025-11-15 09:10:01.031+00,217.42,220.58,222.53,12.77,9.57,11.04,6.15,16.90,5.85,4.93,58.45,45.53,21.01,49.28,f
27477,3,2025-11-15 09:10:01.035+00,232.28,221.88,216.00,15.53,27.91,35.89,4.95,8.90,0.00,0.00,0.00,0.00,10.00,30.00,f
27478,4,2025-11-15 09:10:01.038+00,222.24,211.89,208.87,23.52,29.04,15.23,4.28,10.18,0.00,0.00,0.00,0.00,10.00,30.00,f
27479,5,2025-11-15 09:10:01.041+00,215.67,215.58,218.89,7.82,9.93,6.34,5.81,16.10,5.35,4.74,54.85,42.26,23.31,58.97,f
27480,6,2025-11-15 09:10:01.044+00,222.71,222.49,220.12,9.84,5.94,13.23,4.89,14.38,5.76,4.27,53.46,44.88,24.09,55.13,f
27481,1,2025-11-15 09:12:00.566+00,221.54,216.31,217.16,9.24,6.32,11.18,1.51,12.97,5.71,4.48,57.42,41.02,18.11,45.81,f
27482,2,2025-11-15 09:12:00.593+00,219.06,219.41,215.63,7.21,14.48,9.21,2.77,16.16,5.80,4.98,53.94,44.87,21.60,44.01,f
27483,3,2025-11-15 09:12:00.597+00,239.83,233.16,247.58,31.60,21.74,39.65,5.53,13.55,0.00,0.00,0.00,0.00,10.00,30.00,f
27484,4,2025-11-15 09:12:00.601+00,218.95,222.76,205.39,23.31,31.47,34.85,3.34,9.45,0.00,0.00,0.00,0.00,10.00,30.00,f
27485,5,2025-11-15 09:12:00.604+00,220.57,223.44,215.57,10.16,5.08,14.67,2.85,14.29,5.57,4.12,54.42,40.58,23.78,55.96,f
27486,6,2025-11-15 09:12:00.607+00,220.79,218.07,217.80,7.64,10.49,6.43,6.20,11.37,5.90,4.94,57.47,42.81,19.18,52.06,f
27487,1,2025-11-15 09:14:01.144+00,220.24,217.59,221.20,13.10,11.79,13.99,4.84,18.63,5.34,4.55,50.98,43.86,23.13,47.49,f
27488,2,2025-11-15 09:14:01.17+00,216.07,217.66,218.58,14.38,6.06,9.06,3.10,14.78,5.39,4.10,51.42,44.71,18.07,53.39,f
27489,3,2025-11-15 09:14:01.175+00,209.64,211.09,234.04,13.02,39.09,16.05,6.12,14.23,0.00,0.00,0.00,0.00,10.00,30.00,f
27490,4,2025-11-15 09:14:01.179+00,226.52,210.96,236.40,35.97,24.90,17.36,5.31,13.36,0.00,0.00,0.00,0.00,10.00,30.00,f
27491,5,2025-11-15 09:14:01.182+00,216.12,220.09,220.38,6.85,10.05,13.79,3.56,12.19,5.38,4.62,54.77,41.08,20.65,42.21,f
27492,6,2025-11-15 09:14:01.185+00,215.91,222.49,221.91,9.67,5.24,7.51,5.92,18.62,5.99,4.02,53.65,47.66,19.11,48.16,f
27493,1,2025-11-15 09:16:00.747+00,218.59,219.28,216.40,10.57,12.55,10.17,5.44,16.96,5.81,4.70,51.83,44.78,20.98,43.38,f
27494,2,2025-11-15 09:16:00.777+00,223.53,221.46,223.88,5.49,12.40,13.71,3.81,12.29,5.42,4.10,55.88,40.10,21.89,51.65,f
27495,3,2025-11-15 09:16:00.78+00,227.82,239.72,200.15,25.34,30.89,44.25,4.15,11.09,0.00,0.00,0.00,0.00,10.00,30.00,f
27496,4,2025-11-15 09:16:00.783+00,205.98,211.34,210.74,28.13,20.63,16.45,4.34,12.57,0.00,0.00,0.00,0.00,10.00,30.00,f
27497,5,2025-11-15 09:16:00.786+00,220.24,223.35,217.86,12.19,6.33,13.97,5.53,15.86,5.40,4.53,58.82,42.45,18.62,46.53,f
27498,6,2025-11-15 09:16:00.789+00,220.48,223.13,220.71,7.29,14.02,14.33,4.52,19.69,5.96,4.20,50.32,48.81,24.90,59.50,f
27499,1,2025-11-15 09:18:00.289+00,216.92,216.62,221.33,11.23,6.25,13.82,4.83,19.10,5.96,4.72,58.69,49.00,18.47,42.35,f
27500,2,2025-11-15 09:18:00.314+00,217.06,223.28,215.13,6.71,9.26,14.40,1.78,14.94,5.95,4.25,58.63,46.58,18.31,53.92,f
27501,3,2025-11-15 09:18:00.317+00,241.92,204.61,221.19,37.94,33.95,41.63,6.46,13.20,0.00,0.00,0.00,0.00,10.00,30.00,f
27502,4,2025-11-15 09:18:00.32+00,213.48,236.47,206.50,30.37,30.91,15.57,6.88,10.41,0.00,0.00,0.00,0.00,10.00,30.00,f
27503,5,2025-11-15 09:18:00.322+00,216.41,222.65,215.23,6.79,6.09,7.01,4.00,10.12,5.18,4.26,56.37,45.46,21.03,43.31,f
27504,6,2025-11-15 09:18:00.325+00,224.50,216.74,219.60,11.16,12.28,5.33,5.47,16.73,5.20,4.82,53.82,49.96,23.71,43.13,f
27505,1,2025-11-15 09:20:00.212+00,216.56,223.56,223.05,14.76,6.06,8.83,6.65,11.49,5.48,4.23,58.61,45.28,22.92,42.26,f
27506,2,2025-11-15 09:20:00.238+00,221.68,220.74,224.73,10.06,8.95,14.97,2.20,17.91,5.66,4.33,53.51,46.66,23.70,54.39,f
27507,3,2025-11-15 09:20:00.242+00,212.60,245.37,242.09,33.36,36.85,22.23,2.51,9.33,0.00,0.00,0.00,0.00,10.00,30.00,f
27508,4,2025-11-15 09:20:00.245+00,228.45,221.96,214.23,29.43,36.48,29.72,6.61,8.80,0.00,0.00,0.00,0.00,10.00,30.00,f
27509,5,2025-11-15 09:20:00.248+00,223.39,221.90,218.85,11.05,14.89,7.01,3.66,17.25,5.45,4.07,50.58,46.69,24.88,51.52,f
27510,6,2025-11-15 09:20:00.25+00,217.18,224.98,216.13,13.04,10.75,12.21,4.05,18.80,5.33,4.15,51.45,43.94,24.23,58.01,f
27511,1,2025-11-15 09:22:00.272+00,224.15,217.82,220.17,10.50,6.97,8.44,2.67,18.65,5.62,4.98,50.73,43.17,22.48,47.16,f
27512,2,2025-11-15 09:22:00.297+00,222.92,222.80,221.73,10.43,10.00,8.68,6.07,13.42,5.97,4.28,58.28,47.21,24.52,54.33,f
27513,3,2025-11-15 09:22:00.3+00,207.35,207.24,213.97,39.24,26.17,35.76,4.54,11.29,0.00,0.00,0.00,0.00,10.00,30.00,f
27514,4,2025-11-15 09:22:00.303+00,247.93,246.21,210.24,38.56,20.12,25.24,5.92,13.91,0.00,0.00,0.00,0.00,10.00,30.00,f
27515,5,2025-11-15 09:22:00.305+00,217.46,215.67,222.10,6.42,13.33,10.34,3.70,15.15,5.15,4.94,51.26,42.89,24.89,56.23,f
27516,6,2025-11-15 09:22:00.308+00,222.03,222.44,221.57,9.34,6.82,7.25,1.88,13.29,5.84,4.58,53.54,44.65,18.98,54.29,f
27517,1,2025-11-15 09:24:00.233+00,219.40,216.88,222.27,12.99,10.46,7.27,5.00,15.32,5.19,4.36,55.78,44.87,24.43,51.59,f
27518,2,2025-11-15 09:24:00.258+00,222.34,218.81,216.83,10.87,14.35,5.91,3.62,13.07,5.12,4.97,53.64,45.11,19.05,53.64,f
27519,3,2025-11-15 09:24:00.263+00,248.80,233.05,213.10,14.49,20.80,41.20,2.37,10.03,0.00,0.00,0.00,0.00,10.00,30.00,f
27520,4,2025-11-15 09:24:00.268+00,230.95,240.67,201.52,32.02,36.81,37.21,6.74,14.01,0.00,0.00,0.00,0.00,10.00,30.00,f
27521,5,2025-11-15 09:24:00.274+00,218.32,224.07,221.26,11.07,5.96,10.77,3.76,13.87,5.29,4.94,58.83,49.69,19.90,48.32,f
27522,6,2025-11-15 09:24:00.278+00,220.48,224.76,218.94,10.69,12.42,10.19,2.92,11.48,5.14,4.23,57.30,43.63,20.07,58.71,f
27523,1,2025-11-15 09:26:00.128+00,220.77,221.55,216.76,9.73,13.13,11.60,1.61,13.67,5.67,4.56,52.13,40.00,22.62,45.01,f
27524,2,2025-11-15 09:26:00.15+00,216.56,222.60,224.97,9.91,13.83,5.26,4.23,12.56,5.92,4.05,59.18,45.57,23.27,46.83,f
27525,3,2025-11-15 09:26:00.153+00,200.16,216.41,236.30,22.66,37.75,17.69,4.45,10.10,0.00,0.00,0.00,0.00,10.00,30.00,f
27526,4,2025-11-15 09:26:00.157+00,211.67,247.67,245.05,27.71,22.12,16.22,5.48,8.64,0.00,0.00,0.00,0.00,10.00,30.00,f
27527,5,2025-11-15 09:26:00.159+00,222.23,215.57,218.96,12.06,6.22,8.80,3.29,10.16,5.02,4.25,58.45,48.42,24.38,40.28,f
27528,6,2025-11-15 09:26:00.162+00,223.65,215.48,219.14,11.31,6.97,6.11,2.98,10.00,5.27,4.67,58.21,47.58,19.66,48.79,f
27529,1,2025-11-15 09:28:01.053+00,222.64,223.46,220.42,13.55,9.96,5.86,5.66,11.58,5.21,4.57,55.19,42.64,18.89,52.51,f
27530,2,2025-11-15 09:28:01.074+00,223.81,219.41,222.61,9.07,11.72,5.95,4.82,18.90,5.66,4.65,55.97,41.94,20.89,57.86,f
27531,3,2025-11-15 09:28:01.076+00,236.08,203.83,246.18,10.24,32.17,15.66,2.26,10.44,0.00,0.00,0.00,0.00,10.00,30.00,f
27532,4,2025-11-15 09:28:01.079+00,243.03,212.11,237.12,12.88,29.79,43.67,5.41,13.30,0.00,0.00,0.00,0.00,10.00,30.00,f
27533,5,2025-11-15 09:28:01.082+00,216.71,220.82,223.71,13.39,10.56,7.62,1.79,10.46,5.49,4.16,51.55,49.42,22.18,47.39,f
27534,6,2025-11-15 09:28:01.084+00,223.86,218.92,217.04,8.12,6.20,8.74,2.69,10.40,5.70,4.86,50.88,48.29,21.61,50.08,f
27535,1,2025-11-15 09:30:00.93+00,217.83,217.14,223.37,7.52,7.82,11.69,2.98,10.01,5.95,4.84,56.32,41.41,21.99,40.94,f
27536,2,2025-11-15 09:30:00.951+00,216.28,221.42,221.58,13.12,11.16,13.53,4.03,15.28,5.82,4.21,56.70,46.32,23.73,49.42,f
27537,3,2025-11-15 09:30:00.954+00,242.48,205.28,226.63,10.87,39.53,42.99,2.00,8.67,0.00,0.00,0.00,0.00,10.00,30.00,f
27538,4,2025-11-15 09:30:00.957+00,238.39,200.06,224.54,31.97,35.46,20.73,3.88,13.99,0.00,0.00,0.00,0.00,10.00,30.00,f
27539,5,2025-11-15 09:30:00.959+00,217.75,223.36,217.10,6.34,11.17,5.49,2.36,17.03,5.82,4.57,55.98,40.04,20.59,40.25,f
27540,6,2025-11-15 09:30:00.962+00,221.11,220.81,215.26,8.58,12.31,6.40,2.13,13.73,5.44,4.83,51.51,42.45,20.70,40.55,f
27541,1,2025-11-15 09:32:00.823+00,224.91,224.50,223.82,11.18,11.95,7.61,3.21,11.40,5.22,4.89,58.93,41.06,19.79,58.38,f
27542,2,2025-11-15 09:32:00.846+00,218.84,222.69,220.09,9.83,9.69,8.43,1.70,12.78,5.09,4.47,50.75,43.75,22.89,49.93,f
27543,3,2025-11-15 09:32:00.848+00,220.33,222.22,248.80,31.46,23.88,44.39,6.37,12.49,0.00,0.00,0.00,0.00,10.00,30.00,f
27544,4,2025-11-15 09:32:00.851+00,244.22,207.90,245.27,10.07,35.78,21.05,2.51,12.11,0.00,0.00,0.00,0.00,10.00,30.00,f
27545,5,2025-11-15 09:32:00.854+00,215.34,223.63,224.35,6.09,7.49,14.01,3.46,11.96,5.24,4.28,55.67,41.21,20.62,57.98,f
27546,6,2025-11-15 09:32:00.856+00,223.16,215.17,220.24,5.05,7.16,13.31,2.38,15.25,5.08,4.25,53.58,49.37,21.02,56.61,f
27547,1,2025-11-15 09:34:00.72+00,217.38,219.61,215.19,13.17,12.56,5.13,5.39,14.95,5.93,4.04,52.60,44.59,23.93,53.13,f
27548,2,2025-11-15 09:34:00.741+00,221.75,224.14,223.94,12.94,13.29,8.39,3.73,17.86,5.90,4.70,57.66,43.05,18.09,45.03,f
27549,3,2025-11-15 09:34:00.744+00,200.09,222.99,224.62,32.05,23.31,35.15,2.47,14.72,0.00,0.00,0.00,0.00,10.00,30.00,f
27550,4,2025-11-15 09:34:00.747+00,247.63,248.10,202.90,20.13,25.93,36.17,2.04,11.21,0.00,0.00,0.00,0.00,10.00,30.00,f
27551,5,2025-11-15 09:34:00.75+00,223.00,218.70,218.41,11.32,13.68,7.02,6.23,14.48,5.40,4.15,54.16,44.39,19.35,40.46,f
27552,6,2025-11-15 09:34:00.752+00,223.85,215.68,220.89,12.37,13.30,9.78,4.36,18.44,5.77,4.57,52.36,41.48,21.05,49.08,f
27553,1,2025-11-15 09:36:00.538+00,220.47,217.43,217.14,8.08,9.39,6.16,2.94,15.41,5.38,4.23,54.85,42.10,22.02,54.64,f
27554,2,2025-11-15 09:36:00.56+00,221.25,218.55,215.68,13.49,14.88,13.83,1.85,12.07,5.53,4.12,50.52,42.03,21.79,51.18,f
27555,3,2025-11-15 09:36:00.564+00,239.62,206.59,210.65,20.67,22.17,15.77,3.31,14.54,0.00,0.00,0.00,0.00,10.00,30.00,f
27556,4,2025-11-15 09:36:00.567+00,221.21,246.77,220.70,27.27,22.94,28.77,6.23,8.07,0.00,0.00,0.00,0.00,10.00,30.00,f
27557,5,2025-11-15 09:36:00.569+00,222.10,220.03,223.80,13.96,12.30,6.76,2.60,18.74,5.32,4.20,54.96,45.75,23.15,55.20,f
27558,6,2025-11-15 09:36:00.572+00,222.44,215.77,222.46,6.07,14.57,8.43,3.60,10.44,5.42,4.13,54.02,46.61,18.99,41.38,f
27559,1,2025-11-15 09:38:00.298+00,220.41,222.40,221.95,13.97,14.50,14.69,3.68,11.49,5.65,4.21,52.26,43.52,23.46,55.46,f
27560,2,2025-11-15 09:38:00.321+00,215.73,217.67,220.41,11.53,6.83,5.20,3.56,11.52,5.90,4.72,56.87,43.00,22.98,57.89,f
27561,3,2025-11-15 09:38:00.324+00,203.24,217.86,206.23,14.46,36.65,19.56,6.77,11.64,0.00,0.00,0.00,0.00,10.00,30.00,f
27562,4,2025-11-15 09:38:00.327+00,203.71,216.89,236.52,36.08,39.54,32.58,3.00,11.10,0.00,0.00,0.00,0.00,10.00,30.00,f
27563,5,2025-11-15 09:38:00.329+00,218.52,220.19,215.76,14.91,10.29,8.78,1.92,16.89,5.21,4.75,53.45,46.65,20.08,52.03,f
27564,6,2025-11-15 09:38:00.332+00,221.87,223.47,217.62,6.40,5.45,7.45,5.93,18.61,5.66,4.91,54.59,46.03,23.20,58.30,f
27565,1,2025-11-15 09:40:00.144+00,217.21,221.17,221.08,13.44,7.47,6.11,5.45,11.83,5.58,4.11,56.17,49.24,22.59,52.79,f
27566,2,2025-11-15 09:40:00.168+00,222.07,216.20,220.47,5.70,7.61,8.79,4.02,16.64,5.81,4.28,55.75,48.55,23.39,53.97,f
27567,3,2025-11-15 09:40:00.171+00,239.93,217.59,220.99,19.02,33.40,19.13,4.58,14.61,0.00,0.00,0.00,0.00,10.00,30.00,f
27568,4,2025-11-15 09:40:00.174+00,218.38,247.87,203.07,10.99,21.75,30.07,6.74,9.73,0.00,0.00,0.00,0.00,10.00,30.00,f
27569,5,2025-11-15 09:40:00.177+00,216.63,218.56,215.25,11.86,13.16,11.16,4.75,14.62,5.78,4.48,58.36,49.06,23.76,59.60,f
27570,6,2025-11-15 09:40:00.179+00,218.57,218.01,221.62,9.87,9.97,10.56,6.34,17.01,5.82,4.32,50.62,42.20,20.19,40.41,f
27571,1,2025-11-15 09:42:01.002+00,216.59,221.22,221.02,5.33,7.75,8.94,3.41,16.83,5.59,4.75,54.89,42.83,21.27,44.56,f
27572,2,2025-11-15 09:42:01.024+00,216.51,221.07,216.66,7.49,7.72,10.46,4.28,13.94,5.71,4.83,54.88,45.73,24.21,53.03,f
27573,3,2025-11-15 09:42:01.027+00,213.25,212.61,221.11,18.08,20.95,24.79,5.17,13.74,0.00,0.00,0.00,0.00,10.00,30.00,f
27574,4,2025-11-15 09:42:01.029+00,228.37,207.41,207.44,16.95,33.06,26.02,4.89,9.84,0.00,0.00,0.00,0.00,10.00,30.00,f
27575,5,2025-11-15 09:42:01.032+00,222.81,224.47,217.71,7.83,11.74,8.25,6.61,14.19,5.13,4.41,51.78,47.58,22.86,59.21,f
27576,6,2025-11-15 09:42:01.035+00,216.83,221.65,218.91,7.94,13.55,6.58,6.25,18.20,5.12,4.84,56.97,46.26,20.28,52.49,f
27577,1,2025-11-15 09:44:00.875+00,216.94,223.15,224.10,7.80,12.32,6.91,5.98,10.76,5.63,4.53,59.55,48.60,18.14,48.13,f
27578,2,2025-11-15 09:44:00.896+00,216.83,220.26,221.69,12.81,12.07,13.37,5.86,18.29,5.85,4.73,57.78,47.83,22.21,58.12,f
27579,3,2025-11-15 09:44:00.899+00,240.78,217.94,240.27,31.12,21.56,35.00,4.18,13.36,0.00,0.00,0.00,0.00,10.00,30.00,f
27580,4,2025-11-15 09:44:00.902+00,227.88,241.48,226.34,20.10,24.28,19.82,2.73,11.93,0.00,0.00,0.00,0.00,10.00,30.00,f
27581,5,2025-11-15 09:44:00.905+00,216.66,224.16,224.07,10.41,8.03,7.23,5.52,11.51,5.33,4.86,54.76,48.71,18.84,59.67,f
27582,6,2025-11-15 09:44:00.908+00,218.53,215.57,222.07,7.74,7.98,13.66,5.55,10.45,5.31,4.43,52.57,47.47,23.87,41.82,f
27583,1,2025-11-15 09:46:00.78+00,222.33,216.06,224.21,8.62,13.97,6.75,3.26,11.30,5.46,4.73,54.10,42.40,19.12,49.16,f
27584,2,2025-11-15 09:46:00.801+00,223.74,219.18,215.76,10.70,6.38,14.24,4.71,18.85,5.55,4.19,54.67,42.69,23.25,55.55,f
27585,3,2025-11-15 09:46:00.803+00,200.88,219.04,215.77,37.27,28.21,18.53,3.32,14.77,0.00,0.00,0.00,0.00,10.00,30.00,f
27586,4,2025-11-15 09:46:00.806+00,224.96,218.52,240.32,24.96,29.88,34.32,4.26,9.93,0.00,0.00,0.00,0.00,10.00,30.00,f
27587,5,2025-11-15 09:46:00.808+00,216.32,219.07,224.40,8.19,14.71,7.26,6.10,19.78,5.96,4.56,50.78,46.98,24.69,44.49,f
27588,6,2025-11-15 09:46:00.81+00,220.48,224.66,215.24,8.53,11.58,13.71,5.41,18.89,5.73,4.93,55.32,45.32,19.61,52.64,f
27589,1,2025-11-15 09:48:00.699+00,224.67,220.50,224.07,9.75,11.15,5.30,6.78,12.02,5.09,4.40,52.61,47.40,24.82,58.32,f
27590,2,2025-11-15 09:48:00.72+00,215.17,215.37,220.28,13.19,6.89,12.93,2.91,18.94,5.96,4.03,55.49,40.92,21.81,59.68,f
27591,3,2025-11-15 09:48:00.723+00,205.86,224.83,239.90,13.36,26.22,19.50,3.57,12.44,0.00,0.00,0.00,0.00,10.00,30.00,f
27592,4,2025-11-15 09:48:00.726+00,200.85,233.27,233.63,24.58,24.95,29.11,3.67,12.75,0.00,0.00,0.00,0.00,10.00,30.00,f
27593,5,2025-11-15 09:48:00.728+00,222.98,222.64,223.75,10.88,7.59,13.37,2.40,15.10,5.73,4.83,53.96,45.87,24.08,45.84,f
27594,6,2025-11-15 09:48:00.731+00,223.18,216.10,222.51,8.72,8.17,8.35,2.96,14.98,5.10,4.32,57.52,45.74,23.38,56.71,f
27595,1,2025-11-15 09:50:00.604+00,221.44,221.11,221.55,13.87,6.80,9.63,5.64,12.80,5.67,4.95,52.29,44.29,20.68,52.89,f
27596,2,2025-11-15 09:50:00.625+00,224.84,223.20,222.39,6.39,5.99,7.15,6.08,17.01,5.08,4.14,58.93,48.55,23.62,41.46,f
27597,3,2025-11-15 09:50:00.628+00,203.28,209.82,201.56,15.48,25.89,31.82,3.35,9.84,0.00,0.00,0.00,0.00,10.00,30.00,f
27598,4,2025-11-15 09:50:00.631+00,235.94,240.88,218.70,38.29,35.90,34.09,2.81,11.32,0.00,0.00,0.00,0.00,10.00,30.00,f
27599,5,2025-11-15 09:50:00.633+00,222.45,220.73,221.76,13.73,5.74,9.59,3.55,11.05,5.90,4.39,50.87,45.85,19.96,46.96,f
27600,6,2025-11-15 09:50:00.636+00,218.49,220.53,217.42,9.99,8.62,8.05,3.47,16.38,5.76,4.15,58.49,43.45,19.43,40.64,f
27601,1,2025-11-15 09:52:00.527+00,217.93,216.19,223.16,8.86,7.24,5.51,5.24,16.43,5.84,4.44,58.99,45.19,20.41,44.28,f
27602,2,2025-11-15 09:52:00.55+00,223.99,223.03,216.68,10.69,8.87,12.84,3.57,19.76,5.45,4.42,50.73,43.65,23.13,53.06,f
27603,3,2025-11-15 09:52:00.554+00,205.79,227.54,241.71,39.35,32.21,22.68,3.88,13.57,0.00,0.00,0.00,0.00,10.00,30.00,f
27604,4,2025-11-15 09:52:00.557+00,212.90,241.50,206.58,15.98,32.02,41.48,2.20,11.69,0.00,0.00,0.00,0.00,10.00,30.00,f
27605,5,2025-11-15 09:52:00.559+00,221.26,215.48,222.30,9.11,5.59,8.77,2.50,11.80,5.59,4.33,52.16,48.84,23.33,55.90,f
27606,6,2025-11-15 09:52:00.562+00,224.58,217.20,224.54,11.93,11.96,12.66,2.05,15.59,5.82,4.44,51.11,46.20,23.05,51.44,f
27607,1,2025-11-15 09:54:00.46+00,215.54,219.69,221.11,5.40,12.35,11.77,5.22,12.47,5.16,4.34,57.89,45.56,24.42,54.86,f
27608,2,2025-11-15 09:54:00.482+00,222.69,215.58,219.28,11.58,11.46,10.50,2.66,15.19,5.14,4.90,51.68,42.90,21.34,42.44,f
27609,3,2025-11-15 09:54:00.485+00,208.12,218.11,238.32,36.54,29.69,18.69,2.06,14.55,0.00,0.00,0.00,0.00,10.00,30.00,f
27610,4,2025-11-15 09:54:00.487+00,226.20,214.22,208.60,28.55,24.38,44.90,2.19,10.59,0.00,0.00,0.00,0.00,10.00,30.00,f
27611,5,2025-11-15 09:54:00.49+00,217.69,223.89,219.99,9.82,6.68,11.63,2.70,10.93,5.39,4.41,55.68,40.63,23.76,42.40,f
27612,6,2025-11-15 09:54:00.492+00,223.20,215.03,220.58,12.42,13.72,9.17,3.01,12.98,5.37,4.76,52.98,48.77,19.30,44.07,f
27613,1,2025-11-15 09:56:00.358+00,219.07,218.80,221.28,10.95,12.88,5.44,2.37,13.67,5.23,4.40,51.98,44.99,18.32,52.07,f
27614,2,2025-11-15 09:56:00.38+00,217.14,221.58,217.65,10.53,6.14,10.85,3.83,18.71,5.38,4.25,54.39,48.37,18.50,58.75,f
27615,3,2025-11-15 09:56:00.383+00,230.19,235.13,229.38,13.65,31.03,23.73,6.12,9.85,0.00,0.00,0.00,0.00,10.00,30.00,f
27616,4,2025-11-15 09:56:00.386+00,225.86,240.90,249.29,25.37,24.39,32.33,4.65,14.57,0.00,0.00,0.00,0.00,10.00,30.00,f
27617,5,2025-11-15 09:56:00.388+00,215.91,216.19,215.97,5.53,11.60,8.04,6.51,14.18,5.06,4.71,54.15,42.49,19.37,45.64,f
27618,6,2025-11-15 09:56:00.391+00,217.87,222.11,223.85,8.26,7.13,11.95,5.50,15.41,5.91,4.21,55.28,47.31,19.94,57.66,f
27619,1,2025-11-15 09:58:00.272+00,224.65,217.86,218.80,7.71,11.68,5.65,4.46,17.08,5.41,4.86,53.81,46.23,23.81,44.35,f
27620,2,2025-11-15 09:58:00.298+00,219.91,222.56,222.04,11.09,14.94,14.31,3.39,18.13,5.00,4.14,57.03,46.95,22.44,51.59,f
27621,3,2025-11-15 09:58:00.301+00,220.07,216.69,202.86,26.58,34.65,23.54,2.96,9.46,0.00,0.00,0.00,0.00,10.00,30.00,f
27622,4,2025-11-15 09:58:00.304+00,217.24,211.81,246.19,31.21,22.43,34.86,5.44,9.62,0.00,0.00,0.00,0.00,10.00,30.00,f
27623,5,2025-11-15 09:58:00.307+00,220.68,220.43,222.17,11.59,7.00,8.15,6.10,18.86,5.34,4.82,51.41,40.65,22.61,40.03,f
27624,6,2025-11-15 09:58:00.309+00,222.73,220.49,217.54,13.07,6.17,10.35,1.97,10.92,5.64,4.92,57.24,43.92,22.58,46.29,f
27625,1,2025-11-15 10:00:00.127+00,219.68,216.51,223.74,5.55,10.92,7.64,3.19,15.70,5.33,4.75,54.33,45.75,21.43,49.74,f
27626,2,2025-11-15 10:00:00.33+00,217.50,222.19,219.69,7.57,12.60,13.19,3.85,10.19,5.04,4.06,52.28,44.40,19.48,59.96,f
27627,3,2025-11-15 10:00:00.333+00,232.05,240.22,231.67,26.43,23.31,33.61,4.96,8.12,0.00,0.00,0.00,0.00,10.00,30.00,f
27628,4,2025-11-15 10:00:00.336+00,200.78,205.83,228.92,36.41,27.68,18.46,2.59,8.47,0.00,0.00,0.00,0.00,10.00,30.00,f
27629,5,2025-11-15 10:00:00.338+00,220.35,221.14,220.57,10.20,9.09,10.41,4.28,13.05,5.57,4.15,58.32,42.12,21.41,58.30,f
27630,6,2025-11-15 10:00:00.341+00,222.67,219.02,219.33,13.78,8.44,13.60,3.64,19.86,5.12,4.81,59.14,44.79,18.74,51.31,f
27631,1,2025-11-15 10:02:01.05+00,221.01,217.59,215.33,6.44,12.54,12.41,4.47,17.45,5.82,4.64,59.39,46.00,23.52,56.12,f
27632,2,2025-11-15 10:02:01.072+00,221.83,220.44,223.88,13.65,10.82,14.47,5.46,13.24,5.89,4.63,53.05,45.52,22.15,48.02,f
27633,3,2025-11-15 10:02:01.076+00,204.19,225.93,243.51,26.78,35.88,17.17,5.64,11.75,0.00,0.00,0.00,0.00,10.00,30.00,f
27634,4,2025-11-15 10:02:01.078+00,215.77,219.48,222.69,18.39,28.35,37.83,4.92,13.95,0.00,0.00,0.00,0.00,10.00,30.00,f
27635,5,2025-11-15 10:02:01.082+00,218.33,222.94,215.86,8.89,12.30,12.59,5.81,12.12,5.85,4.52,54.61,40.77,19.70,56.17,f
27636,6,2025-11-15 10:02:01.085+00,222.75,217.24,220.84,13.11,15.00,5.43,4.76,17.68,5.30,4.38,58.16,42.05,19.31,50.56,f
27637,1,2025-11-15 10:04:00.894+00,224.51,216.72,219.12,12.12,12.04,10.06,3.78,19.20,5.79,4.70,55.66,45.15,24.71,44.80,f
27638,2,2025-11-15 10:04:00.916+00,224.92,223.45,217.28,11.26,5.91,13.40,6.34,13.57,5.82,4.28,53.85,46.58,20.40,40.41,f
27639,3,2025-11-15 10:04:00.919+00,217.43,210.09,217.22,32.60,38.08,18.04,2.17,11.05,0.00,0.00,0.00,0.00,10.00,30.00,f
27640,4,2025-11-15 10:04:00.922+00,247.31,221.02,211.90,27.80,37.44,26.59,5.63,12.83,0.00,0.00,0.00,0.00,10.00,30.00,f
27641,5,2025-11-15 10:04:00.924+00,217.17,216.50,220.59,12.70,12.50,9.67,4.13,11.16,5.06,4.45,51.96,41.02,21.60,46.61,f
27642,6,2025-11-15 10:04:00.927+00,215.22,215.92,224.02,10.93,5.42,12.07,3.50,16.39,5.66,4.53,54.83,47.93,23.53,40.82,f
27643,1,2025-11-15 10:06:00.782+00,223.70,217.49,222.68,14.39,12.52,5.61,4.16,18.80,5.79,4.87,57.52,40.86,23.01,46.88,f
27644,2,2025-11-15 10:06:00.803+00,221.94,224.58,215.64,11.66,6.92,5.04,5.12,12.55,5.39,4.26,57.36,49.44,22.73,53.72,f
27645,3,2025-11-15 10:06:00.806+00,214.58,204.28,218.38,38.34,34.84,29.26,2.82,13.98,0.00,0.00,0.00,0.00,10.00,30.00,f
27646,4,2025-11-15 10:06:00.808+00,220.69,235.10,203.87,18.14,23.03,44.71,6.58,9.00,0.00,0.00,0.00,0.00,10.00,30.00,f
27647,5,2025-11-15 10:06:00.81+00,216.04,222.62,215.46,13.70,14.96,11.64,2.47,15.10,5.61,4.12,53.67,49.23,24.44,42.03,f
27648,6,2025-11-15 10:06:00.813+00,223.80,216.17,220.89,14.31,11.58,10.19,2.20,19.43,5.32,4.29,54.49,45.72,24.93,40.34,f
27649,1,2025-11-15 10:08:00.653+00,218.39,218.95,218.47,5.00,6.03,11.54,1.91,15.96,5.17,4.26,57.64,40.63,19.55,51.23,f
27650,2,2025-11-15 10:08:00.674+00,217.75,218.36,219.68,11.99,9.85,13.96,5.12,15.49,5.18,4.47,54.86,41.93,22.03,46.02,f
27651,3,2025-11-15 10:08:00.677+00,203.50,201.31,232.25,32.63,34.70,43.22,3.17,13.70,0.00,0.00,0.00,0.00,10.00,30.00,f
27652,4,2025-11-15 10:08:00.68+00,239.39,209.20,215.09,21.42,23.55,38.11,2.34,9.92,0.00,0.00,0.00,0.00,10.00,30.00,f
27653,5,2025-11-15 10:08:00.683+00,216.77,219.64,215.83,5.54,7.03,11.15,5.07,11.43,5.75,4.93,52.65,44.42,22.97,49.32,f
27654,6,2025-11-15 10:08:00.687+00,224.09,222.98,216.71,11.80,11.40,12.13,3.37,19.68,5.28,4.42,51.01,46.36,24.93,59.84,f
27655,1,2025-11-15 10:10:00.575+00,224.88,221.32,224.73,12.19,8.76,5.08,4.77,11.44,5.93,4.93,52.19,47.53,22.74,59.87,f
27656,2,2025-11-15 10:10:00.597+00,219.63,220.70,218.44,10.40,10.68,8.76,5.72,14.74,5.66,4.99,54.62,45.33,18.39,49.67,f
27657,3,2025-11-15 10:10:00.6+00,228.01,202.88,203.74,19.44,31.38,27.96,2.05,10.71,0.00,0.00,0.00,0.00,10.00,30.00,f
27658,4,2025-11-15 10:10:00.602+00,220.94,229.83,225.93,38.83,21.54,24.03,4.85,14.88,0.00,0.00,0.00,0.00,10.00,30.00,f
27659,5,2025-11-15 10:10:00.607+00,215.04,222.83,223.71,13.77,11.78,6.60,1.71,11.95,5.76,4.14,50.96,41.22,18.45,51.98,f
27660,6,2025-11-15 10:10:00.61+00,224.03,217.98,222.40,6.61,5.85,6.56,6.98,15.27,5.40,4.74,50.17,43.57,22.40,54.68,f
27661,1,2025-11-15 10:12:00.44+00,216.56,220.08,215.30,5.75,5.25,8.74,4.52,15.56,5.46,4.27,54.60,40.29,21.56,46.49,f
27662,2,2025-11-15 10:12:00.461+00,223.93,217.44,222.24,14.28,14.30,5.36,3.35,10.23,5.11,4.68,57.95,41.73,19.18,46.08,f
27663,3,2025-11-15 10:12:00.464+00,219.05,205.45,232.61,23.32,21.47,21.20,3.85,11.56,0.00,0.00,0.00,0.00,10.00,30.00,f
27664,4,2025-11-15 10:12:00.467+00,218.80,229.75,243.73,17.78,27.41,27.10,3.16,8.28,0.00,0.00,0.00,0.00,10.00,30.00,f
27665,5,2025-11-15 10:12:00.47+00,218.15,221.62,224.13,6.54,7.27,10.07,5.95,10.39,5.72,4.69,53.85,49.63,24.33,43.09,f
27666,6,2025-11-15 10:12:00.472+00,220.31,224.79,216.56,8.76,8.62,8.26,5.85,15.07,5.15,4.73,54.12,40.47,22.94,51.52,f
27667,1,2025-11-15 10:14:00.359+00,219.19,222.82,219.40,10.00,12.66,10.86,2.74,12.02,5.35,4.47,50.06,41.92,23.37,59.38,f
27668,2,2025-11-15 10:14:00.383+00,215.51,221.53,221.76,9.33,5.70,13.78,3.59,11.11,5.62,4.29,56.80,43.87,21.56,49.10,f
27669,3,2025-11-15 10:14:00.386+00,226.22,213.66,200.74,25.18,29.61,20.95,3.04,12.90,0.00,0.00,0.00,0.00,10.00,30.00,f
27670,4,2025-11-15 10:14:00.389+00,202.34,224.79,223.34,23.58,24.36,35.65,2.06,9.53,0.00,0.00,0.00,0.00,10.00,30.00,f
27671,5,2025-11-15 10:14:00.391+00,223.71,220.30,217.21,12.20,8.16,6.62,2.91,13.79,5.17,4.43,50.47,45.06,19.57,55.86,f
27672,6,2025-11-15 10:14:00.394+00,223.57,221.47,221.64,12.52,12.21,8.14,1.71,14.82,5.98,4.90,51.01,45.27,19.47,43.37,f
27673,1,2025-11-15 10:16:00.245+00,216.89,220.16,220.61,8.21,9.39,12.58,5.84,11.65,5.48,4.79,57.01,47.88,19.55,42.28,f
27674,2,2025-11-15 10:16:00.267+00,215.78,218.46,221.64,13.06,14.66,5.26,4.24,14.90,5.89,4.33,51.27,48.08,20.07,42.46,f
27675,3,2025-11-15 10:16:00.27+00,200.97,240.88,226.61,35.42,31.03,39.76,3.39,13.10,0.00,0.00,0.00,0.00,10.00,30.00,f
27676,4,2025-11-15 10:16:00.272+00,207.64,235.16,243.92,34.41,24.25,23.31,3.42,11.88,0.00,0.00,0.00,0.00,10.00,30.00,f
27677,5,2025-11-15 10:16:00.275+00,215.70,220.91,220.68,12.37,13.44,6.21,4.19,17.08,5.07,4.60,51.37,43.04,19.41,56.78,f
27678,6,2025-11-15 10:16:00.277+00,217.87,215.11,221.11,9.65,11.04,7.41,2.70,14.95,5.29,4.62,52.48,41.71,19.02,48.73,f
27679,1,2025-11-15 10:18:00.385+00,223.10,224.60,221.38,6.52,13.56,8.15,6.99,14.39,5.37,4.07,56.98,41.75,19.95,43.84,f
27680,2,2025-11-15 10:18:00.406+00,220.31,219.50,218.83,5.22,14.20,8.90,5.70,11.36,5.77,4.56,54.56,48.33,18.53,45.34,f
27681,3,2025-11-15 10:18:00.409+00,219.29,221.65,229.87,14.55,20.34,15.64,5.50,12.72,0.00,0.00,0.00,0.00,10.00,30.00,f
27682,4,2025-11-15 10:18:00.412+00,226.47,244.86,223.32,25.34,23.05,28.99,4.55,10.55,0.00,0.00,0.00,0.00,10.00,30.00,f
27683,5,2025-11-15 10:18:00.414+00,219.15,217.46,219.91,14.86,11.67,11.86,6.18,13.94,5.88,4.64,57.47,49.06,18.61,46.72,f
27684,6,2025-11-15 10:18:00.417+00,222.55,216.89,218.28,7.17,7.24,11.91,1.62,14.65,5.20,4.07,52.49,40.62,22.46,57.38,f
27685,1,2025-11-15 10:20:00.157+00,219.60,220.16,219.55,10.16,12.67,13.51,2.50,14.79,5.55,4.48,53.76,40.47,19.10,43.13,f
27686,2,2025-11-15 10:20:00.182+00,223.52,219.10,220.49,9.97,9.09,9.18,3.20,17.56,5.52,4.11,50.63,47.46,20.11,56.34,f
27687,3,2025-11-15 10:20:00.186+00,233.67,225.71,203.87,32.54,21.39,16.79,3.09,13.39,0.00,0.00,0.00,0.00,10.00,30.00,f
27688,4,2025-11-15 10:20:00.189+00,203.14,216.11,240.51,26.69,39.08,18.32,4.63,9.94,0.00,0.00,0.00,0.00,10.00,30.00,f
27689,5,2025-11-15 10:20:00.192+00,224.82,216.13,219.32,8.91,9.14,10.62,2.73,19.86,5.70,4.89,59.82,49.33,21.93,52.02,f
27690,6,2025-11-15 10:20:00.195+00,220.05,220.43,218.63,13.70,11.56,8.00,5.26,18.52,5.07,4.35,59.38,47.79,24.12,40.32,f
27691,1,2025-11-15 10:22:00.782+00,217.86,221.12,215.51,8.05,8.48,14.21,5.37,14.91,5.45,4.65,53.21,40.92,20.60,47.10,f
27692,2,2025-11-15 10:22:00.809+00,215.49,218.17,217.56,13.21,12.96,12.07,4.84,14.20,5.83,4.54,57.63,44.17,20.76,45.07,f
27693,3,2025-11-15 10:22:00.812+00,243.28,205.68,231.46,36.94,31.98,15.80,6.22,14.86,0.00,0.00,0.00,0.00,10.00,30.00,f
27694,4,2025-11-15 10:22:00.816+00,218.09,213.49,215.46,38.79,36.30,33.14,6.32,13.65,0.00,0.00,0.00,0.00,10.00,30.00,f
27695,5,2025-11-15 10:22:00.818+00,224.62,218.04,222.63,13.43,6.41,13.59,1.84,11.83,5.17,4.93,52.37,40.70,19.65,57.10,f
27696,6,2025-11-15 10:22:00.821+00,222.23,222.49,217.09,13.99,14.66,5.84,2.54,14.44,5.54,4.15,52.45,45.93,18.63,42.30,f
27697,1,2025-11-15 10:24:00.368+00,215.31,216.30,215.02,14.95,10.29,14.28,6.54,19.38,5.26,4.13,56.64,41.49,23.82,52.29,f
27698,2,2025-11-15 10:24:00.395+00,221.40,221.17,215.39,9.84,9.90,9.93,6.17,15.55,5.33,4.17,56.86,46.22,18.56,58.47,f
27699,3,2025-11-15 10:24:00.399+00,205.49,234.48,240.95,28.47,21.84,43.91,5.28,13.72,0.00,0.00,0.00,0.00,10.00,30.00,f
27700,4,2025-11-15 10:24:00.403+00,236.14,225.07,215.02,18.90,24.52,15.56,5.19,14.17,0.00,0.00,0.00,0.00,10.00,30.00,f
27701,5,2025-11-15 10:24:00.406+00,224.65,218.00,222.68,5.71,10.28,8.66,4.11,17.06,5.75,4.57,50.23,47.15,18.37,59.78,f
27702,6,2025-11-15 10:24:00.409+00,221.73,218.04,219.78,6.08,11.02,12.60,3.87,11.64,5.77,4.37,57.14,48.02,20.97,55.85,f
27703,1,2025-11-15 10:26:00.956+00,221.35,215.99,220.00,8.73,7.41,5.14,2.84,16.26,5.19,4.44,50.06,48.29,20.73,56.48,f
27704,2,2025-11-15 10:26:00.998+00,215.83,221.18,217.25,6.71,13.16,10.03,2.01,10.84,5.24,4.72,54.88,48.64,24.86,46.23,f
27705,3,2025-11-15 10:26:01.003+00,215.65,209.65,223.55,26.77,22.08,23.57,4.70,12.03,0.00,0.00,0.00,0.00,10.00,30.00,f
27706,4,2025-11-15 10:26:01.008+00,245.07,220.08,230.77,23.21,39.88,42.14,5.87,12.49,0.00,0.00,0.00,0.00,10.00,30.00,f
27707,5,2025-11-15 10:26:01.013+00,217.85,222.22,216.30,6.37,10.70,11.71,2.05,12.71,5.57,4.82,59.01,46.40,18.04,45.25,f
27708,6,2025-11-15 10:26:01.017+00,224.71,219.93,215.52,11.81,6.87,11.05,6.50,19.26,5.69,4.83,55.90,41.98,23.09,53.31,f
27709,1,2025-11-15 10:28:00.451+00,223.76,216.67,217.25,7.43,11.11,6.98,6.25,19.84,5.73,4.94,59.06,46.52,22.06,55.78,f
27710,2,2025-11-15 10:28:00.48+00,216.94,224.50,219.40,6.60,14.72,14.74,4.45,12.60,5.86,4.68,57.29,40.14,19.78,43.64,f
27711,3,2025-11-15 10:28:00.485+00,244.72,238.74,202.07,14.18,28.08,26.41,4.47,9.01,0.00,0.00,0.00,0.00,10.00,30.00,f
27712,4,2025-11-15 10:28:00.488+00,248.10,233.51,228.15,16.91,25.80,29.10,2.57,13.61,0.00,0.00,0.00,0.00,10.00,30.00,f
27713,5,2025-11-15 10:28:00.492+00,218.88,224.23,215.27,11.16,14.44,13.38,5.42,13.31,5.48,4.69,58.40,47.71,22.17,47.01,f
27714,6,2025-11-15 10:28:00.496+00,223.28,222.34,218.54,10.90,5.82,14.23,5.84,17.12,5.89,4.15,59.11,48.19,20.34,56.48,f
27715,1,2025-11-15 10:30:01.016+00,217.16,216.49,220.12,9.22,7.45,8.14,6.68,16.12,5.54,4.76,58.75,40.98,18.55,55.69,f
27716,2,2025-11-15 10:30:01.044+00,224.67,223.30,217.46,10.40,5.56,10.80,1.61,15.82,5.04,4.81,57.34,41.63,22.20,55.75,f
27717,3,2025-11-15 10:30:01.048+00,209.65,224.33,217.91,12.50,38.97,23.76,5.31,9.17,0.00,0.00,0.00,0.00,10.00,30.00,f
27718,4,2025-11-15 10:30:01.053+00,244.76,217.50,213.69,23.59,30.13,30.26,4.78,12.22,0.00,0.00,0.00,0.00,10.00,30.00,f
27719,5,2025-11-15 10:30:01.058+00,219.56,223.24,215.29,9.64,11.29,5.87,4.19,19.20,5.20,4.11,56.88,48.32,20.61,52.53,f
27720,6,2025-11-15 10:30:01.062+00,217.07,217.12,219.60,11.88,8.89,6.49,2.41,14.42,5.67,4.99,50.38,40.99,22.35,54.85,f
27721,1,2025-11-15 10:32:00.553+00,223.35,223.61,224.50,11.95,13.59,12.39,5.26,10.23,5.79,4.83,58.14,47.20,22.80,44.44,f
27722,2,2025-11-15 10:32:00.583+00,219.54,217.00,222.96,13.66,8.44,13.92,2.67,16.66,5.75,4.99,54.77,42.12,24.55,44.30,f
27723,3,2025-11-15 10:32:00.587+00,223.06,243.33,221.26,36.96,31.00,29.80,5.98,12.72,0.00,0.00,0.00,0.00,10.00,30.00,f
27724,4,2025-11-15 10:32:00.591+00,236.72,200.33,202.95,26.07,30.85,37.53,6.37,14.08,0.00,0.00,0.00,0.00,10.00,30.00,f
27725,5,2025-11-15 10:32:00.597+00,223.39,223.61,220.59,14.85,13.99,10.89,4.82,12.34,5.61,4.17,56.36,48.46,19.42,57.00,f
27726,6,2025-11-15 10:32:00.6+00,224.97,223.50,221.18,11.45,11.92,7.49,5.73,18.28,5.23,4.63,52.43,44.05,21.60,42.66,f
27727,1,2025-11-15 10:36:00.702+00,222.01,219.71,218.29,11.46,7.40,7.01,6.51,14.62,5.88,4.20,50.87,45.18,22.98,48.57,f
27728,2,2025-11-15 10:36:00.73+00,215.04,222.02,215.66,8.45,12.61,14.04,3.71,13.66,5.73,4.02,57.14,44.72,18.22,51.99,f
27729,3,2025-11-15 10:36:00.733+00,247.36,202.77,247.76,15.67,28.86,31.01,3.35,10.14,0.00,0.00,0.00,0.00,10.00,30.00,f
27730,4,2025-11-15 10:36:00.738+00,222.92,201.26,223.67,10.48,39.01,17.24,3.45,9.62,0.00,0.00,0.00,0.00,10.00,30.00,f
27731,5,2025-11-15 10:36:00.742+00,219.02,221.52,223.52,13.11,10.84,5.56,4.17,11.29,5.77,4.36,56.22,48.53,18.62,46.20,f
27732,6,2025-11-15 10:36:00.746+00,219.36,220.96,215.58,10.54,10.18,10.60,4.28,16.34,5.69,4.12,53.96,41.39,21.63,56.20,f
27733,1,2025-11-15 10:38:00.263+00,221.80,216.54,224.26,13.70,10.43,11.25,1.71,15.09,5.76,4.64,59.02,44.46,18.18,44.52,f
27734,2,2025-11-15 10:38:00.295+00,218.85,216.15,219.78,7.44,12.34,10.77,1.71,11.55,5.79,4.14,58.06,47.48,18.53,57.31,f
27735,3,2025-11-15 10:38:00.298+00,249.16,226.77,207.15,13.37,24.21,24.49,5.83,11.73,0.00,0.00,0.00,0.00,10.00,30.00,f
27736,4,2025-11-15 10:38:00.303+00,239.14,200.83,232.57,12.17,26.07,32.43,6.29,13.97,0.00,0.00,0.00,0.00,10.00,30.00,f
27737,5,2025-11-15 10:38:00.306+00,217.86,222.44,221.67,14.69,14.52,9.83,3.42,13.81,5.99,4.64,51.40,45.24,21.33,40.17,f
27738,6,2025-11-15 10:38:00.311+00,224.62,224.95,221.24,8.00,13.33,12.24,5.22,17.35,5.82,4.99,55.40,48.89,19.94,45.29,f
27739,1,2025-11-15 10:40:00.782+00,215.16,217.10,218.75,8.32,14.43,7.35,6.88,19.05,5.89,4.74,55.85,49.04,23.99,40.36,f
27740,2,2025-11-15 10:40:00.813+00,215.60,222.65,220.03,14.35,11.81,8.72,1.77,13.30,5.72,4.41,56.58,47.82,19.82,51.98,f
27741,3,2025-11-15 10:40:00.818+00,240.91,209.27,207.57,27.30,21.32,32.60,4.84,8.13,0.00,0.00,0.00,0.00,10.00,30.00,f
27742,4,2025-11-15 10:40:00.822+00,209.93,229.97,233.57,10.68,25.12,40.58,4.01,11.09,0.00,0.00,0.00,0.00,10.00,30.00,f
27743,5,2025-11-15 10:40:00.828+00,224.39,216.56,216.15,9.26,11.70,12.40,6.42,15.60,5.26,4.81,54.17,45.64,24.04,57.03,f
27744,6,2025-11-15 10:40:00.832+00,217.00,220.25,224.17,13.88,9.51,14.08,6.40,18.13,5.29,4.22,59.82,47.11,22.73,42.34,f
27745,1,2025-11-15 10:42:00.313+00,219.51,222.10,216.48,8.58,12.61,6.15,3.23,18.22,5.46,4.81,55.93,46.51,24.14,41.60,f
27746,2,2025-11-15 10:42:00.344+00,222.27,224.59,216.10,6.66,11.41,8.09,2.57,12.08,5.95,4.16,52.05,42.13,23.14,59.83,f
27747,3,2025-11-15 10:42:00.348+00,243.62,203.55,211.43,35.38,33.13,36.86,6.13,11.19,0.00,0.00,0.00,0.00,10.00,30.00,f
27748,4,2025-11-15 10:42:00.351+00,237.84,205.58,226.93,34.18,36.43,17.51,4.21,13.03,0.00,0.00,0.00,0.00,10.00,30.00,f
27749,5,2025-11-15 10:42:00.355+00,219.19,217.42,222.81,5.96,6.06,11.75,6.34,10.93,5.73,4.25,58.57,49.53,21.17,48.06,f
27750,6,2025-11-15 10:42:00.358+00,223.34,224.26,218.68,10.79,14.18,8.48,5.79,12.61,5.77,4.88,54.17,40.33,23.29,40.66,f
27751,1,2025-11-15 10:44:00.878+00,220.53,217.96,218.38,9.91,7.35,6.99,5.43,17.22,5.36,4.34,59.17,48.10,19.53,50.13,f
27752,2,2025-11-15 10:44:00.907+00,218.88,218.48,216.70,13.34,6.94,11.08,2.79,15.08,5.10,4.90,56.30,43.33,23.32,56.61,f
27753,3,2025-11-15 10:44:00.911+00,215.19,233.89,207.75,23.43,23.52,27.80,6.63,10.09,0.00,0.00,0.00,0.00,10.00,30.00,f
27754,4,2025-11-15 10:44:00.915+00,213.68,238.83,238.46,29.72,23.55,30.16,3.69,8.98,0.00,0.00,0.00,0.00,10.00,30.00,f
27755,5,2025-11-15 10:44:00.92+00,219.22,223.87,218.17,7.66,14.39,5.36,5.98,13.22,5.75,4.26,50.16,43.47,23.18,52.63,f
27756,6,2025-11-15 10:44:00.923+00,219.09,216.17,223.20,8.59,14.86,14.16,2.14,10.90,5.41,4.40,53.45,40.49,24.63,45.44,f
27757,1,2025-11-15 10:46:00.447+00,217.19,217.84,217.16,11.85,6.55,7.22,5.23,12.85,5.31,4.34,54.64,42.56,21.71,55.16,f
27758,2,2025-11-15 10:46:00.479+00,220.88,216.07,217.92,6.80,7.98,12.33,5.16,13.24,5.75,4.63,59.93,45.49,18.65,47.20,f
27759,3,2025-11-15 10:46:00.482+00,244.18,212.35,237.45,35.03,32.88,18.78,4.55,13.80,0.00,0.00,0.00,0.00,10.00,30.00,f
27760,4,2025-11-15 10:46:00.485+00,200.12,217.44,209.23,34.18,34.79,40.52,2.92,9.59,0.00,0.00,0.00,0.00,10.00,30.00,f
27761,5,2025-11-15 10:46:00.487+00,217.64,224.75,220.08,12.69,7.95,5.02,6.73,14.38,5.70,4.07,57.78,42.45,19.89,46.62,f
27762,6,2025-11-15 10:46:00.49+00,215.13,215.33,215.60,6.15,13.03,13.20,1.69,11.15,5.06,4.72,54.13,40.06,18.99,44.34,f
27763,1,2025-11-15 10:48:01.039+00,220.19,221.46,216.64,8.91,10.03,6.43,5.47,10.71,5.45,4.46,55.37,46.42,24.56,54.87,f
27764,2,2025-11-15 10:48:01.068+00,216.40,220.48,218.10,8.69,6.04,8.93,2.71,14.21,5.81,4.38,54.78,41.32,19.33,57.68,f
27765,3,2025-11-15 10:48:01.072+00,223.37,240.00,212.43,10.25,33.46,26.17,3.45,14.82,0.00,0.00,0.00,0.00,10.00,30.00,f
27766,4,2025-11-15 10:48:01.078+00,218.26,207.39,247.01,25.14,33.44,18.06,4.89,8.77,0.00,0.00,0.00,0.00,10.00,30.00,f
27767,5,2025-11-15 10:48:01.081+00,217.13,224.00,219.20,10.18,6.52,11.36,2.69,12.76,5.89,4.12,55.12,43.99,21.20,42.77,f
27768,6,2025-11-15 10:48:01.084+00,221.80,222.81,222.18,8.77,7.72,12.34,3.93,15.67,5.46,4.77,56.29,46.79,22.35,49.63,f
27769,1,2025-11-15 10:50:00.675+00,217.23,223.16,218.48,6.98,11.80,6.82,2.04,14.90,5.24,4.33,51.39,44.31,24.50,54.10,f
27770,2,2025-11-15 10:50:00.708+00,221.54,216.37,221.67,10.83,14.07,14.09,1.76,18.06,5.82,4.22,57.66,42.84,18.94,43.69,f
27771,3,2025-11-15 10:50:00.718+00,200.67,234.22,202.08,10.29,28.12,26.66,2.46,9.39,0.00,0.00,0.00,0.00,10.00,30.00,f
27772,4,2025-11-15 10:50:00.723+00,232.88,206.42,243.09,13.76,35.96,33.99,5.29,9.06,0.00,0.00,0.00,0.00,10.00,30.00,f
27773,5,2025-11-15 10:50:00.727+00,224.14,224.78,217.48,14.08,13.98,13.09,1.97,17.58,5.91,4.39,50.64,46.57,21.87,43.67,f
27774,6,2025-11-15 10:50:00.731+00,218.29,220.85,223.15,14.43,10.19,8.65,1.60,14.75,5.18,4.73,58.23,48.04,19.95,53.74,f
27775,1,2025-11-15 10:52:00.565+00,216.24,215.50,221.96,12.20,8.49,8.23,6.01,13.28,5.90,4.57,54.73,43.80,18.79,52.52,f
27776,2,2025-11-15 10:52:00.588+00,222.88,215.72,216.83,8.17,11.50,14.62,5.24,18.78,5.58,4.41,50.89,48.92,23.50,41.57,f
27777,3,2025-11-15 10:52:00.591+00,207.29,200.74,227.26,16.13,34.43,38.23,6.17,10.70,0.00,0.00,0.00,0.00,10.00,30.00,f
27778,4,2025-11-15 10:52:00.595+00,244.75,236.37,205.61,19.36,36.42,43.51,5.34,10.86,0.00,0.00,0.00,0.00,10.00,30.00,f
27779,5,2025-11-15 10:52:00.597+00,221.38,224.37,222.44,8.30,11.07,7.52,5.55,13.98,5.42,4.60,54.42,44.51,18.42,55.36,f
27780,6,2025-11-15 10:52:00.6+00,217.85,219.00,218.32,6.32,11.17,9.49,6.65,19.64,5.16,4.47,54.09,48.77,20.18,44.63,f
27781,1,2025-11-15 10:54:00.433+00,217.23,224.83,222.24,14.22,12.56,12.00,6.52,15.59,5.35,4.01,59.70,47.66,24.54,43.99,f
27782,2,2025-11-15 10:54:00.455+00,215.71,224.45,223.61,6.29,9.17,12.71,2.60,19.51,5.97,4.74,57.93,41.44,18.10,55.33,f
27783,3,2025-11-15 10:54:00.458+00,245.60,238.22,247.26,13.36,21.12,42.60,2.69,14.77,0.00,0.00,0.00,0.00,10.00,30.00,f
27784,4,2025-11-15 10:54:00.461+00,219.17,222.79,234.41,35.01,21.28,31.21,4.87,8.71,0.00,0.00,0.00,0.00,10.00,30.00,f
27785,5,2025-11-15 10:54:00.463+00,222.34,219.00,219.67,11.92,8.63,14.43,5.40,13.63,5.65,4.09,50.27,42.72,22.72,50.15,f
27786,6,2025-11-15 10:54:00.466+00,223.78,218.31,221.35,12.52,8.02,9.47,5.21,12.71,5.08,4.74,53.60,40.08,20.54,44.46,f
27787,1,2025-11-15 10:56:00.301+00,224.00,222.94,216.62,9.92,8.99,13.88,4.85,12.94,5.68,4.33,56.51,43.02,24.11,55.81,f
27788,2,2025-11-15 10:56:00.322+00,220.48,216.56,222.90,7.42,10.88,7.17,5.69,16.88,5.55,4.10,59.96,45.83,18.44,43.22,f
27789,3,2025-11-15 10:56:00.325+00,231.01,227.08,220.82,26.73,24.11,32.89,2.77,14.74,0.00,0.00,0.00,0.00,10.00,30.00,f
27790,4,2025-11-15 10:56:00.328+00,239.98,213.43,233.05,36.29,23.59,32.79,6.25,13.54,0.00,0.00,0.00,0.00,10.00,30.00,f
27791,5,2025-11-15 10:56:00.33+00,223.87,220.72,221.45,8.51,5.90,13.39,5.45,11.22,5.16,4.93,53.82,42.49,20.65,45.69,f
27792,6,2025-11-15 10:56:00.333+00,215.53,222.97,216.14,8.50,9.16,11.92,2.75,11.26,5.08,4.06,55.80,43.82,24.97,51.24,f
27793,1,2025-11-15 10:58:01.078+00,224.13,224.02,220.27,11.99,9.06,5.68,3.90,19.25,5.87,4.84,50.35,42.80,24.44,56.51,f
27794,2,2025-11-15 10:58:01.1+00,221.54,216.05,222.26,8.28,6.65,10.52,5.94,14.98,5.64,4.38,58.09,45.60,20.06,55.00,f
27795,3,2025-11-15 10:58:01.103+00,206.54,201.87,223.87,15.50,23.94,23.22,6.88,12.22,0.00,0.00,0.00,0.00,10.00,30.00,f
27796,4,2025-11-15 10:58:01.106+00,201.79,213.05,210.96,39.27,29.12,36.44,5.33,14.33,0.00,0.00,0.00,0.00,10.00,30.00,f
27797,5,2025-11-15 10:58:01.109+00,221.46,221.02,222.71,6.48,10.94,13.29,6.44,14.79,5.08,4.03,58.98,42.50,24.27,40.44,f
27798,6,2025-11-15 10:58:01.111+00,215.55,224.71,216.30,13.90,11.09,9.81,3.55,12.83,5.93,4.76,54.45,45.92,22.34,47.70,f
27799,1,2025-11-15 11:00:00.979+00,216.15,224.28,216.21,12.23,10.29,7.18,6.56,13.77,5.38,4.94,53.23,47.44,23.96,45.22,f
27800,2,2025-11-15 11:00:01.001+00,215.89,222.24,224.27,5.62,7.29,13.12,4.10,16.01,5.16,4.66,59.01,40.37,18.28,47.52,f
27801,3,2025-11-15 11:00:01.005+00,209.65,238.46,205.99,31.30,39.20,41.21,4.50,9.52,0.00,0.00,0.00,0.00,10.00,30.00,f
27802,4,2025-11-15 11:00:01.007+00,224.27,213.75,249.72,16.14,24.33,24.14,2.95,8.84,0.00,0.00,0.00,0.00,10.00,30.00,f
27803,5,2025-11-15 11:00:01.01+00,224.13,221.95,218.75,14.00,10.90,11.41,2.62,19.57,5.97,4.18,54.64,47.66,22.35,49.69,f
27804,6,2025-11-15 11:00:01.012+00,217.28,223.98,224.70,13.83,10.80,13.22,6.06,12.04,5.65,4.28,50.97,49.53,23.70,49.94,f
27805,1,2025-11-15 11:02:00.817+00,219.86,215.50,220.58,10.66,14.20,10.47,5.84,16.77,5.41,4.78,55.47,43.16,19.30,40.82,f
27806,2,2025-11-15 11:02:00.84+00,224.87,220.33,222.15,14.61,7.41,14.84,3.71,16.16,5.67,4.87,53.57,42.44,18.47,49.89,f
27807,3,2025-11-15 11:02:00.843+00,211.23,214.16,216.67,27.19,25.09,41.31,4.55,9.17,0.00,0.00,0.00,0.00,10.00,30.00,f
27808,4,2025-11-15 11:02:00.848+00,237.41,214.36,237.93,25.06,36.87,30.62,2.98,11.14,0.00,0.00,0.00,0.00,10.00,30.00,f
27809,5,2025-11-15 11:02:00.851+00,220.20,215.58,219.61,11.42,10.80,6.67,2.46,18.04,5.91,4.19,58.08,42.91,20.41,58.99,f
27810,6,2025-11-15 11:02:00.854+00,215.12,220.91,223.30,12.72,14.16,5.08,4.49,17.76,5.81,4.23,57.77,41.30,20.16,50.61,f
27811,1,2025-11-15 11:04:00.701+00,221.08,223.97,222.78,5.53,8.83,7.24,3.19,15.95,5.28,4.17,59.84,40.19,21.44,46.17,f
27812,2,2025-11-15 11:04:00.722+00,216.06,221.83,220.56,13.60,12.94,9.49,4.15,12.97,5.24,4.85,57.25,44.28,24.89,59.08,f
27813,3,2025-11-15 11:04:00.725+00,246.61,227.40,206.06,19.31,20.00,15.94,3.85,11.04,0.00,0.00,0.00,0.00,10.00,30.00,f
27814,4,2025-11-15 11:04:00.73+00,242.13,216.88,239.15,15.90,28.38,21.10,6.95,14.06,0.00,0.00,0.00,0.00,10.00,30.00,f
27815,5,2025-11-15 11:04:00.732+00,217.18,223.32,216.97,7.88,14.80,8.73,6.54,12.93,5.82,4.76,55.56,48.64,19.75,52.06,f
27816,6,2025-11-15 11:04:00.735+00,224.46,219.50,223.88,6.03,5.46,7.26,1.58,19.29,5.47,4.10,52.68,45.11,21.71,52.69,f
27817,1,2025-11-15 11:06:00.654+00,218.50,223.83,223.25,11.29,7.70,13.36,2.97,11.43,5.98,4.76,58.72,42.04,23.15,41.09,f
27818,2,2025-11-15 11:06:00.675+00,216.44,215.52,223.85,10.63,13.27,5.36,5.98,12.96,5.50,4.13,59.73,43.22,18.53,52.65,f
27819,3,2025-11-15 11:06:00.68+00,220.90,249.79,244.35,22.85,33.77,43.01,5.84,14.41,0.00,0.00,0.00,0.00,10.00,30.00,f
27820,4,2025-11-15 11:06:00.684+00,237.89,209.70,219.93,10.36,26.68,33.35,5.06,9.27,0.00,0.00,0.00,0.00,10.00,30.00,f
27821,5,2025-11-15 11:06:00.686+00,223.17,222.39,220.12,12.31,13.19,5.58,4.79,17.48,5.51,4.73,51.30,40.74,20.71,45.43,f
27822,6,2025-11-15 11:06:00.688+00,216.55,217.39,221.48,10.35,7.78,14.61,3.23,12.49,5.36,4.98,57.23,42.50,21.17,59.49,f
27823,1,2025-11-15 11:08:00.481+00,222.30,215.64,223.32,11.65,11.90,9.06,4.17,17.32,5.59,4.75,56.95,42.16,20.22,58.22,f
27824,2,2025-11-15 11:08:00.505+00,219.86,221.41,219.36,9.37,8.95,7.27,6.61,16.14,5.77,4.82,53.38,49.40,18.95,41.87,f
27825,3,2025-11-15 11:08:00.508+00,230.63,200.03,234.47,16.97,38.34,27.58,5.26,11.08,0.00,0.00,0.00,0.00,10.00,30.00,f
27826,4,2025-11-15 11:08:00.511+00,205.44,228.64,215.06,18.13,30.26,34.40,3.19,9.54,0.00,0.00,0.00,0.00,10.00,30.00,f
27827,5,2025-11-15 11:08:00.513+00,217.61,215.87,215.82,11.67,7.68,11.83,3.52,13.26,5.96,4.14,57.74,44.35,21.97,51.81,f
27828,6,2025-11-15 11:08:00.516+00,222.75,220.97,222.39,13.45,5.96,9.55,1.98,11.33,5.68,4.97,56.23,42.39,19.17,48.15,f
27829,1,2025-11-15 11:10:00.333+00,218.00,218.92,218.19,11.33,14.30,11.38,5.94,12.27,5.89,4.88,59.35,46.25,23.61,40.22,f
27830,2,2025-11-15 11:10:00.364+00,217.74,220.79,223.70,7.54,6.49,9.83,4.37,17.73,5.88,4.68,51.51,42.74,20.44,54.92,f
27831,3,2025-11-15 11:10:00.368+00,216.01,209.46,244.02,24.40,29.40,24.18,6.19,14.44,0.00,0.00,0.00,0.00,10.00,30.00,f
27832,4,2025-11-15 11:10:00.373+00,230.18,216.37,206.00,37.03,23.77,27.30,5.85,12.32,0.00,0.00,0.00,0.00,10.00,30.00,f
27833,5,2025-11-15 11:10:00.376+00,216.07,217.38,217.68,12.17,8.25,11.58,3.36,13.86,5.14,4.83,56.92,47.88,25.00,54.26,f
27834,6,2025-11-15 11:10:00.379+00,219.17,223.33,218.05,12.31,5.44,13.17,4.76,17.41,5.92,4.60,50.33,41.34,22.69,44.23,f
27835,1,2025-11-15 11:12:00.908+00,219.71,216.46,216.73,11.50,9.36,6.13,6.69,19.97,5.07,4.60,58.01,43.95,18.60,50.48,f
27836,2,2025-11-15 11:12:00.932+00,223.10,219.64,217.07,5.82,8.48,13.98,6.99,16.64,5.65,4.11,51.43,45.01,18.58,46.37,f
27837,3,2025-11-15 11:12:00.936+00,232.36,240.01,204.97,19.62,26.93,34.11,2.28,8.03,0.00,0.00,0.00,0.00,10.00,30.00,f
27838,4,2025-11-15 11:12:00.939+00,240.61,209.54,209.29,14.07,39.31,26.16,4.06,12.64,0.00,0.00,0.00,0.00,10.00,30.00,f
27839,5,2025-11-15 11:12:00.941+00,216.35,217.17,218.78,13.74,14.01,12.15,3.82,19.16,5.26,4.83,55.32,49.79,20.51,47.16,f
27840,6,2025-11-15 11:12:00.945+00,223.73,217.04,222.57,10.82,14.45,11.48,2.11,12.61,5.31,4.84,52.03,41.49,20.72,42.45,f
27841,1,2025-11-15 11:14:00.518+00,221.34,219.36,219.92,10.18,10.39,7.80,3.30,15.59,5.43,4.16,57.04,43.15,24.19,54.12,f
27842,2,2025-11-15 11:14:00.543+00,217.73,217.79,223.10,8.23,14.51,8.90,1.86,14.72,5.00,4.25,54.53,43.84,18.28,44.87,f
27843,3,2025-11-15 11:14:00.547+00,245.70,229.52,235.58,37.32,22.64,27.90,2.98,9.14,0.00,0.00,0.00,0.00,10.00,30.00,f
27844,4,2025-11-15 11:14:00.55+00,227.08,226.97,243.94,38.22,21.26,26.83,3.11,8.32,0.00,0.00,0.00,0.00,10.00,30.00,f
27845,5,2025-11-15 11:14:00.553+00,219.77,223.53,222.82,14.23,6.78,5.96,4.74,18.85,5.79,4.49,50.19,42.27,24.98,59.44,f
27846,6,2025-11-15 11:14:00.556+00,222.72,220.54,223.64,8.48,12.60,11.32,6.67,18.73,5.40,4.44,57.07,48.68,19.26,48.64,f
27847,1,2025-11-15 11:16:01.068+00,219.13,216.38,219.86,7.62,10.88,14.49,6.07,13.41,5.71,4.67,55.31,41.92,21.20,43.67,f
27848,2,2025-11-15 11:16:01.093+00,219.55,215.73,223.78,13.77,8.48,7.81,2.89,18.54,5.11,4.98,56.96,42.01,23.36,52.79,f
27849,3,2025-11-15 11:16:01.097+00,211.83,229.78,214.59,20.49,29.87,39.52,6.46,9.05,0.00,0.00,0.00,0.00,10.00,30.00,f
27850,4,2025-11-15 11:16:01.1+00,213.56,233.14,219.24,33.08,33.36,38.94,6.84,13.68,0.00,0.00,0.00,0.00,10.00,30.00,f
27851,5,2025-11-15 11:16:01.103+00,220.50,220.85,216.06,5.07,13.55,10.36,3.69,12.67,5.16,4.97,53.84,49.80,19.08,56.91,f
27852,6,2025-11-15 11:16:01.106+00,218.48,222.12,221.09,14.28,13.69,9.87,3.20,13.92,5.70,4.41,58.38,44.56,23.95,43.25,f
27853,1,2025-11-15 11:18:00.662+00,223.88,215.34,215.85,11.59,7.51,8.89,2.21,11.72,5.97,4.47,55.37,44.58,23.48,49.48,f
27854,2,2025-11-15 11:18:00.694+00,216.49,221.56,223.14,10.20,8.21,10.60,6.36,19.64,5.78,4.99,59.20,42.23,24.78,53.69,f
27855,3,2025-11-15 11:18:00.698+00,248.31,241.14,248.69,28.24,35.01,42.92,2.51,8.44,0.00,0.00,0.00,0.00,10.00,30.00,f
27856,4,2025-11-15 11:18:00.703+00,236.98,236.49,239.41,38.08,38.47,41.69,4.16,14.94,0.00,0.00,0.00,0.00,10.00,30.00,f
27857,5,2025-11-15 11:18:00.707+00,218.50,216.95,217.84,9.13,5.48,12.66,3.01,10.57,5.63,4.76,53.63,41.87,20.15,58.42,f
27858,6,2025-11-15 11:18:00.711+00,217.53,223.30,221.93,8.84,5.97,7.84,3.07,13.65,5.17,4.10,55.42,41.42,20.87,58.78,f
27859,1,2025-11-15 11:20:00.334+00,220.19,221.60,221.72,7.36,12.41,7.09,2.64,11.85,5.54,4.33,51.51,47.33,19.44,51.33,f
27860,2,2025-11-15 11:20:00.362+00,218.70,219.58,224.19,5.51,5.13,7.39,5.82,14.74,5.49,4.03,57.98,43.26,23.49,40.32,f
27861,3,2025-11-15 11:20:00.365+00,216.80,210.36,200.07,14.12,32.71,33.94,2.18,9.58,0.00,0.00,0.00,0.00,10.00,30.00,f
27862,4,2025-11-15 11:20:00.369+00,249.74,238.10,248.25,24.06,26.97,44.27,6.59,14.69,0.00,0.00,0.00,0.00,10.00,30.00,f
27863,5,2025-11-15 11:20:00.372+00,215.87,221.95,215.05,14.74,12.45,12.44,5.29,18.99,5.17,4.38,53.29,44.82,20.07,43.57,f
27864,6,2025-11-15 11:20:00.375+00,224.18,221.78,218.69,7.83,12.10,7.25,1.81,10.17,5.49,4.32,55.36,45.23,24.06,49.06,f
27865,1,2025-11-15 11:22:00.826+00,220.38,224.87,218.79,13.61,5.76,6.26,2.95,14.98,5.60,4.26,57.12,40.94,19.36,43.86,f
27866,2,2025-11-15 11:22:00.853+00,222.36,224.43,221.45,13.46,7.95,10.84,6.78,15.75,5.92,4.08,58.64,49.74,24.67,56.30,f
27867,3,2025-11-15 11:22:00.858+00,227.38,235.83,204.32,35.65,34.37,26.23,3.62,12.96,0.00,0.00,0.00,0.00,10.00,30.00,f
27868,4,2025-11-15 11:22:00.861+00,230.44,214.28,236.30,30.94,22.07,15.14,5.13,8.43,0.00,0.00,0.00,0.00,10.00,30.00,f
27869,5,2025-11-15 11:22:00.865+00,221.14,219.28,219.53,5.91,8.32,14.19,6.26,16.08,5.79,4.76,58.45,41.80,24.43,52.83,f
27870,6,2025-11-15 11:22:00.868+00,219.72,218.70,220.13,6.48,5.85,14.97,3.68,17.70,5.33,4.74,55.74,42.48,18.84,58.57,f
27871,1,2025-11-15 11:24:00.404+00,217.64,216.85,222.20,10.24,5.72,10.09,5.55,18.98,5.43,4.58,56.43,42.67,19.06,57.31,f
27872,2,2025-11-15 11:24:00.433+00,215.13,222.08,218.00,6.83,11.07,12.93,4.53,14.83,5.23,4.63,58.72,44.54,18.90,53.43,f
27873,3,2025-11-15 11:24:00.437+00,216.70,231.12,224.47,27.71,22.73,27.80,5.18,9.64,0.00,0.00,0.00,0.00,10.00,30.00,f
27874,4,2025-11-15 11:24:00.44+00,248.55,227.97,202.66,36.00,26.00,32.15,2.14,8.14,0.00,0.00,0.00,0.00,10.00,30.00,f
27875,5,2025-11-15 11:24:00.444+00,215.96,219.66,215.72,8.66,14.09,12.70,6.20,14.76,5.90,4.42,56.63,48.72,18.93,51.10,f
27876,6,2025-11-15 11:24:00.447+00,224.36,222.91,224.84,12.79,5.20,14.78,6.45,10.07,5.94,4.14,58.28,49.13,21.85,47.78,f
27877,1,2025-11-15 11:26:00.933+00,216.26,216.41,220.27,13.47,8.59,7.23,3.38,19.18,5.77,4.64,54.75,44.84,22.90,58.76,f
27878,2,2025-11-15 11:26:00.959+00,219.18,216.50,217.83,11.82,13.79,8.65,1.80,19.71,5.92,4.93,54.15,46.09,23.93,40.99,f
27879,3,2025-11-15 11:26:00.962+00,225.91,242.64,234.70,33.12,24.98,18.41,5.60,8.58,0.00,0.00,0.00,0.00,10.00,30.00,f
27880,4,2025-11-15 11:26:00.966+00,206.13,200.48,209.71,24.78,28.37,44.51,5.70,11.54,0.00,0.00,0.00,0.00,10.00,30.00,f
27881,5,2025-11-15 11:26:00.969+00,219.08,217.48,216.17,11.46,14.41,5.16,3.58,16.88,5.57,4.12,53.78,41.00,21.61,52.07,f
27882,6,2025-11-15 11:26:00.972+00,221.17,219.18,215.85,10.45,5.47,6.23,2.79,10.49,5.93,4.66,51.85,49.20,20.36,54.33,f
27883,1,2025-11-15 11:28:00.507+00,216.67,222.37,224.30,13.55,9.47,9.31,4.58,15.52,5.56,4.02,54.51,47.24,19.76,58.24,f
27884,2,2025-11-15 11:28:00.532+00,224.70,224.52,218.66,5.97,10.83,13.58,2.24,14.41,5.00,4.34,58.97,42.05,24.02,54.41,f
27885,3,2025-11-15 11:28:00.535+00,206.33,214.84,230.77,37.72,29.43,41.17,2.09,11.29,0.00,0.00,0.00,0.00,10.00,30.00,f
27886,4,2025-11-15 11:28:00.538+00,208.93,216.36,219.99,26.50,28.30,22.89,4.29,14.97,0.00,0.00,0.00,0.00,10.00,30.00,f
27887,5,2025-11-15 11:28:00.541+00,224.67,216.41,221.81,14.60,14.49,14.23,4.61,11.84,5.60,4.31,52.00,42.12,20.04,44.20,f
27888,6,2025-11-15 11:28:00.544+00,224.81,221.83,222.02,14.94,12.62,6.87,1.59,16.73,5.23,4.08,54.65,49.84,19.02,50.77,f
27889,1,2025-11-15 11:30:01.12+00,222.47,221.29,223.94,10.09,7.71,12.48,5.36,18.32,5.78,4.92,51.43,43.11,24.47,59.03,f
27890,2,2025-11-15 11:30:01.155+00,220.21,224.94,216.25,11.46,6.48,10.75,6.39,18.06,5.16,4.03,56.36,47.71,24.76,42.45,f
27891,3,2025-11-15 11:30:01.159+00,232.41,245.55,243.99,30.88,34.27,37.37,3.59,13.38,0.00,0.00,0.00,0.00,10.00,30.00,f
27892,4,2025-11-15 11:30:01.162+00,209.69,221.76,216.42,11.87,39.77,32.12,4.35,9.67,0.00,0.00,0.00,0.00,10.00,30.00,f
27893,5,2025-11-15 11:30:01.165+00,219.22,224.60,217.82,5.64,14.79,12.51,2.64,14.85,5.11,4.91,54.60,45.05,22.72,47.57,f
27894,6,2025-11-15 11:30:01.167+00,217.45,216.80,219.03,12.91,10.99,11.04,6.67,14.28,5.94,4.44,55.06,42.27,21.18,51.43,f
27895,1,2025-11-15 11:32:00.714+00,215.06,224.02,219.43,10.43,8.72,11.77,4.53,13.63,5.48,4.45,53.79,48.54,18.38,45.42,f
27896,2,2025-11-15 11:32:00.743+00,215.99,223.68,216.57,12.24,12.28,13.93,5.65,19.19,5.95,4.78,54.62,47.29,21.47,43.45,f
27897,3,2025-11-15 11:32:00.747+00,221.99,229.17,231.47,21.94,27.15,32.16,2.81,8.29,0.00,0.00,0.00,0.00,10.00,30.00,f
27898,4,2025-11-15 11:32:00.751+00,221.49,200.18,243.79,32.81,36.96,27.21,5.16,10.24,0.00,0.00,0.00,0.00,10.00,30.00,f
27899,5,2025-11-15 11:32:00.754+00,215.72,221.72,224.16,5.27,13.76,8.54,1.81,17.74,5.26,4.40,59.43,40.07,18.48,52.93,f
27900,6,2025-11-15 11:32:00.757+00,217.30,222.97,217.55,6.46,9.02,5.76,1.52,14.37,5.01,4.38,58.25,41.81,24.33,51.79,f
27901,1,2025-11-15 11:34:00.29+00,215.43,223.37,218.33,9.47,6.36,8.13,5.51,16.45,5.51,4.83,53.52,40.34,21.69,51.53,f
27902,2,2025-11-15 11:34:00.314+00,221.06,216.29,222.22,12.63,7.61,9.96,3.95,15.53,5.67,4.67,56.88,40.24,20.24,56.67,f
27903,3,2025-11-15 11:34:00.317+00,216.39,209.53,205.37,36.38,38.39,25.10,4.61,9.35,0.00,0.00,0.00,0.00,10.00,30.00,f
27904,4,2025-11-15 11:34:00.321+00,220.90,209.21,201.50,13.98,23.27,41.65,5.90,8.83,0.00,0.00,0.00,0.00,10.00,30.00,f
27905,5,2025-11-15 11:34:00.325+00,216.29,218.66,217.16,11.27,14.58,8.27,3.88,13.47,5.90,4.12,57.06,40.10,23.99,45.54,f
27906,6,2025-11-15 11:34:00.329+00,220.30,222.63,221.80,8.31,11.96,10.02,2.72,11.19,5.44,4.76,51.83,48.15,20.74,42.38,f
27907,1,2025-11-15 11:36:00.915+00,220.77,216.38,219.36,5.27,14.54,11.73,5.21,15.68,5.90,4.44,56.55,43.70,23.77,46.71,f
27908,2,2025-11-15 11:36:00.942+00,220.46,223.30,224.06,12.19,6.34,13.46,2.29,14.27,5.06,4.51,50.85,42.81,20.48,44.32,f
27909,3,2025-11-15 11:36:00.947+00,227.47,201.43,237.65,31.73,39.18,24.06,5.64,12.13,0.00,0.00,0.00,0.00,10.00,30.00,f
27910,4,2025-11-15 11:36:00.95+00,210.65,225.28,218.16,39.15,33.31,19.02,2.17,13.88,0.00,0.00,0.00,0.00,10.00,30.00,f
27911,5,2025-11-15 11:36:00.954+00,223.44,217.72,217.34,14.76,10.72,14.10,2.71,13.99,5.94,4.65,57.06,47.97,21.14,41.04,f
27912,6,2025-11-15 11:36:00.957+00,224.83,219.74,222.33,11.49,7.36,11.34,4.96,11.53,5.71,4.57,57.25,43.59,19.78,47.33,f
27913,1,2025-11-15 11:38:00.604+00,217.38,218.65,221.31,13.09,8.73,13.61,5.89,15.60,5.43,4.45,52.75,47.87,21.76,53.46,f
27914,2,2025-11-15 11:38:00.63+00,224.86,218.73,217.33,10.24,14.19,6.80,3.45,11.22,5.58,4.48,58.61,47.16,19.72,53.34,f
27915,3,2025-11-15 11:38:00.634+00,248.03,230.81,200.21,22.12,38.77,23.27,6.34,9.31,0.00,0.00,0.00,0.00,10.00,30.00,f
27916,4,2025-11-15 11:38:00.638+00,247.54,228.70,241.46,17.61,33.20,43.72,6.77,12.78,0.00,0.00,0.00,0.00,10.00,30.00,f
27917,5,2025-11-15 11:38:00.641+00,216.55,216.82,222.09,11.66,13.33,7.10,2.45,11.39,5.74,4.21,56.97,47.15,19.57,41.66,f
27918,6,2025-11-15 11:38:00.644+00,218.83,219.91,220.97,7.27,8.13,11.87,4.32,12.87,5.88,4.59,59.44,49.35,20.55,59.70,f
27919,1,2025-11-15 11:40:00.182+00,224.71,223.74,222.43,14.60,11.70,5.86,4.06,15.97,5.42,4.23,54.23,47.04,19.16,44.91,f
27920,2,2025-11-15 11:40:00.211+00,219.07,217.44,221.72,8.58,11.29,9.69,5.44,19.79,5.99,4.58,50.66,48.32,23.33,50.48,f
27921,3,2025-11-15 11:40:00.216+00,231.12,228.45,205.45,39.01,20.45,35.84,3.12,11.98,0.00,0.00,0.00,0.00,10.00,30.00,f
27922,4,2025-11-15 11:40:00.221+00,226.84,206.31,235.01,16.37,37.01,29.12,2.20,10.59,0.00,0.00,0.00,0.00,10.00,30.00,f
27923,5,2025-11-15 11:40:00.225+00,215.45,223.62,222.87,8.25,12.36,6.36,5.55,19.40,5.48,4.04,57.16,43.91,18.62,43.72,f
27924,6,2025-11-15 11:40:00.23+00,222.24,223.96,222.93,12.97,10.58,13.10,1.79,15.79,5.95,4.92,51.58,45.02,24.46,47.61,f
27925,1,2025-11-15 11:42:00.725+00,221.12,223.14,222.84,10.48,10.18,7.30,2.03,15.17,5.70,4.56,54.79,49.79,22.77,56.45,f
27926,2,2025-11-15 11:42:00.754+00,217.92,215.58,218.89,10.14,14.89,13.34,6.53,10.11,5.21,4.56,59.02,42.33,22.10,43.51,f
27927,3,2025-11-15 11:42:00.761+00,219.98,232.03,234.59,29.40,29.59,16.07,5.48,12.62,0.00,0.00,0.00,0.00,10.00,30.00,f
27928,4,2025-11-15 11:42:00.77+00,207.00,202.07,210.67,36.98,23.70,20.22,2.53,13.94,0.00,0.00,0.00,0.00,10.00,30.00,f
27929,5,2025-11-15 11:42:00.778+00,215.28,220.78,219.15,14.44,6.68,12.72,4.44,16.53,5.03,4.49,55.89,42.27,20.84,42.54,f
27930,6,2025-11-15 11:42:00.784+00,218.29,217.45,219.22,9.28,6.92,6.32,3.54,18.43,5.69,4.20,57.60,49.73,19.90,58.94,f
27931,1,2025-11-15 11:44:00.301+00,216.67,217.58,215.29,7.83,12.27,11.22,3.36,14.02,5.42,4.80,56.94,47.21,20.44,47.55,f
27932,2,2025-11-15 11:44:00.33+00,219.06,215.77,221.46,6.17,12.94,8.16,6.68,11.83,5.06,4.83,55.82,43.46,23.94,55.54,f
27933,3,2025-11-15 11:44:00.334+00,208.77,232.65,226.50,16.19,34.85,40.92,4.34,13.83,0.00,0.00,0.00,0.00,10.00,30.00,f
27934,4,2025-11-15 11:44:00.339+00,211.44,229.97,200.64,37.73,24.89,24.87,6.87,13.54,0.00,0.00,0.00,0.00,10.00,30.00,f
27935,5,2025-11-15 11:44:00.342+00,218.70,215.38,220.11,12.19,13.35,12.01,1.79,16.62,5.04,4.89,57.19,43.72,24.90,47.25,f
27936,6,2025-11-15 11:44:00.346+00,218.47,220.13,223.40,11.50,10.65,14.40,6.52,13.95,5.41,4.74,58.38,41.37,24.92,41.72,f
27937,1,2025-11-15 11:46:00.916+00,215.86,217.68,216.87,11.97,8.03,7.82,4.56,14.46,5.96,4.87,58.89,41.72,20.59,53.02,f
27938,2,2025-11-15 11:46:00.945+00,216.42,220.92,216.21,11.31,12.48,13.85,5.74,10.51,5.10,4.35,52.14,46.33,22.29,50.07,f
27939,3,2025-11-15 11:46:00.948+00,220.32,237.86,213.39,14.52,29.10,20.62,3.01,13.41,0.00,0.00,0.00,0.00,10.00,30.00,f
27940,4,2025-11-15 11:46:00.952+00,207.37,243.36,205.95,10.66,34.06,35.94,4.40,9.56,0.00,0.00,0.00,0.00,10.00,30.00,f
27941,5,2025-11-15 11:46:00.956+00,224.39,216.82,221.00,6.72,8.91,11.67,4.91,17.75,5.83,4.03,53.42,45.54,22.61,59.10,f
27942,6,2025-11-15 11:46:00.959+00,218.01,219.91,216.45,10.33,12.56,12.15,3.90,12.25,5.56,4.25,57.76,41.82,24.51,58.75,f
27943,1,2025-11-15 11:48:00.493+00,224.74,215.58,224.19,10.18,10.73,6.09,6.81,16.64,5.57,4.52,53.06,44.21,19.15,41.97,f
27944,2,2025-11-15 11:48:00.521+00,216.86,223.51,219.67,7.85,8.28,14.56,4.54,16.27,5.02,4.11,54.42,40.02,22.23,40.59,f
27945,3,2025-11-15 11:48:00.525+00,232.99,212.83,233.43,12.85,27.99,22.03,2.46,12.35,0.00,0.00,0.00,0.00,10.00,30.00,f
27946,4,2025-11-15 11:48:00.529+00,206.35,220.04,239.54,29.72,34.38,28.83,6.82,10.54,0.00,0.00,0.00,0.00,10.00,30.00,f
27947,5,2025-11-15 11:48:00.535+00,215.64,217.16,222.25,5.13,10.91,6.29,4.20,11.15,5.03,4.15,55.08,43.20,22.15,48.19,f
27948,6,2025-11-15 11:48:00.538+00,224.43,215.06,217.39,12.77,5.13,9.35,1.64,17.11,5.13,4.13,59.97,49.82,20.23,56.37,f
27949,1,2025-11-15 11:50:01.045+00,220.15,223.72,215.08,5.40,11.36,6.54,5.71,10.70,5.73,4.92,59.43,47.14,20.16,49.68,f
27950,2,2025-11-15 11:50:01.073+00,217.60,217.53,221.38,7.11,7.57,7.67,2.98,16.05,5.85,4.27,53.99,43.17,24.94,44.81,f
27951,3,2025-11-15 11:50:01.078+00,230.98,212.57,243.73,11.47,21.27,19.11,5.19,13.04,0.00,0.00,0.00,0.00,10.00,30.00,f
27952,4,2025-11-15 11:50:01.083+00,243.39,249.76,233.78,16.55,33.39,17.26,6.28,13.46,0.00,0.00,0.00,0.00,10.00,30.00,f
27953,5,2025-11-15 11:50:01.086+00,218.71,219.28,220.62,8.35,9.89,11.61,3.47,18.36,5.91,4.06,51.13,43.06,19.45,47.94,f
27954,6,2025-11-15 11:50:01.09+00,219.30,216.87,222.14,12.70,5.38,12.06,5.37,19.28,5.38,4.03,51.50,40.54,24.81,43.59,f
27955,1,2025-11-15 11:52:00.629+00,217.35,224.94,223.93,13.62,11.12,12.54,2.85,13.07,5.27,4.09,52.93,45.10,20.89,55.78,f
27956,2,2025-11-15 11:52:00.654+00,216.87,219.81,216.04,9.15,12.63,7.49,5.00,14.41,5.23,4.29,57.37,49.16,23.10,48.03,f
27957,3,2025-11-15 11:52:00.659+00,232.59,210.17,249.01,13.48,27.93,28.25,4.83,13.81,0.00,0.00,0.00,0.00,10.00,30.00,f
27958,4,2025-11-15 11:52:00.662+00,222.99,218.15,232.03,22.25,31.75,20.76,4.21,12.23,0.00,0.00,0.00,0.00,10.00,30.00,f
27959,5,2025-11-15 11:52:00.665+00,218.44,224.55,217.94,6.62,5.75,7.76,3.80,18.19,5.66,4.13,56.00,45.13,19.50,57.94,f
27960,6,2025-11-15 11:52:00.669+00,217.59,223.33,223.40,12.10,11.06,5.27,3.72,16.69,5.19,4.19,59.69,42.10,19.34,47.73,f
27961,1,2025-11-15 11:54:00.261+00,221.65,218.76,223.87,5.00,5.50,5.73,5.81,13.68,5.37,4.33,58.01,49.52,23.69,47.60,f
27962,2,2025-11-15 11:54:00.289+00,223.43,219.16,215.21,9.44,10.32,11.08,6.84,10.24,5.43,4.49,56.61,47.35,22.63,47.96,f
27963,3,2025-11-15 11:54:00.293+00,213.37,229.34,202.20,38.23,26.79,32.34,4.70,13.46,0.00,0.00,0.00,0.00,10.00,30.00,f
27964,4,2025-11-15 11:54:00.297+00,204.61,227.78,208.92,33.77,21.19,35.06,6.43,11.35,0.00,0.00,0.00,0.00,10.00,30.00,f
27965,5,2025-11-15 11:54:00.301+00,219.03,217.50,220.79,11.95,10.53,8.04,4.03,15.84,5.06,4.66,57.83,41.76,22.87,58.37,f
27966,6,2025-11-15 11:54:00.305+00,220.67,216.20,215.42,7.91,5.11,11.22,4.30,19.24,5.06,4.96,59.20,48.38,24.26,56.07,f
27967,1,2025-11-15 11:56:00.82+00,218.14,215.28,224.22,14.84,10.18,12.42,1.87,16.81,5.55,4.91,50.36,42.50,24.08,42.98,f
27968,2,2025-11-15 11:56:00.849+00,217.19,224.50,216.35,5.36,6.59,7.86,3.02,11.88,5.05,4.64,57.34,48.79,21.69,52.96,f
27969,3,2025-11-15 11:56:00.853+00,238.25,215.60,208.44,28.29,38.60,28.91,2.57,13.86,0.00,0.00,0.00,0.00,10.00,30.00,f
27970,4,2025-11-15 11:56:00.858+00,203.64,232.82,240.26,12.47,23.46,24.39,3.60,14.48,0.00,0.00,0.00,0.00,10.00,30.00,f
27971,5,2025-11-15 11:56:00.861+00,222.05,223.58,215.13,6.45,10.59,12.22,5.55,14.51,5.84,4.77,55.37,49.26,24.24,54.70,f
27972,6,2025-11-15 11:56:00.864+00,222.33,218.52,223.42,14.17,5.95,6.80,1.75,13.64,5.64,4.88,51.88,47.14,21.25,43.56,f
27973,1,2025-11-15 11:58:00.379+00,217.91,215.75,220.58,6.35,12.62,5.42,3.38,18.44,5.23,4.24,58.78,42.04,20.08,48.20,f
27974,2,2025-11-15 11:58:00.409+00,221.06,223.75,219.57,11.24,7.90,5.14,3.77,14.70,5.21,4.83,53.98,41.10,21.35,57.09,f
27975,3,2025-11-15 11:58:00.414+00,226.62,201.46,208.85,39.36,38.50,31.66,2.01,11.16,0.00,0.00,0.00,0.00,10.00,30.00,f
27976,4,2025-11-15 11:58:00.418+00,203.94,208.86,234.83,25.17,25.23,26.98,3.16,10.08,0.00,0.00,0.00,0.00,10.00,30.00,f
27977,5,2025-11-15 11:58:00.421+00,220.86,221.04,218.26,5.13,13.15,10.28,6.08,15.37,5.68,4.77,51.23,44.43,22.20,47.16,f
27978,6,2025-11-15 11:58:00.424+00,217.23,222.82,223.08,11.54,10.67,5.10,1.82,10.04,5.40,4.54,59.91,43.32,22.65,54.81,f
27979,1,2025-11-15 12:00:00.902+00,217.52,220.89,216.08,9.02,8.81,13.72,4.71,15.61,5.62,4.49,56.16,42.03,20.85,41.96,f
27980,2,2025-11-15 12:00:00.929+00,215.69,217.26,218.33,7.94,12.20,11.22,3.17,14.03,5.17,4.20,51.82,42.29,18.26,53.11,f
27981,3,2025-11-15 12:00:00.933+00,237.93,236.97,222.61,24.19,27.50,31.53,6.90,9.30,0.00,0.00,0.00,0.00,10.00,30.00,f
27982,4,2025-11-15 12:00:00.937+00,243.84,208.57,248.09,23.68,35.60,19.56,5.48,12.98,0.00,0.00,0.00,0.00,10.00,30.00,f
27983,5,2025-11-15 12:00:00.941+00,223.13,217.71,220.52,8.72,9.97,8.71,3.50,16.47,5.16,4.13,51.96,49.86,23.66,53.56,f
27984,6,2025-11-15 12:00:00.944+00,221.73,215.63,218.89,13.38,12.84,8.83,2.04,19.68,5.78,4.21,58.51,40.32,22.75,41.65,f
27985,1,2025-11-15 12:02:00.461+00,224.44,219.86,221.98,11.30,5.27,7.73,4.91,17.65,5.82,4.50,55.40,48.92,22.93,53.47,f
27986,2,2025-11-15 12:02:00.491+00,221.98,217.42,217.08,9.31,8.14,14.81,5.75,15.78,5.96,4.88,59.84,44.28,23.08,41.66,f
27987,3,2025-11-15 12:02:00.495+00,235.70,208.64,205.97,38.89,32.54,29.82,6.62,13.68,0.00,0.00,0.00,0.00,10.00,30.00,f
27988,4,2025-11-15 12:02:00.5+00,212.30,216.71,240.41,38.62,39.63,17.12,6.78,8.91,0.00,0.00,0.00,0.00,10.00,30.00,f
27989,5,2025-11-15 12:02:00.504+00,220.54,218.71,215.35,8.86,14.64,14.40,3.35,10.10,5.60,4.79,50.84,48.42,24.05,49.08,f
27990,6,2025-11-15 12:02:00.508+00,221.52,217.05,224.49,6.40,14.45,14.69,6.02,15.12,5.70,4.53,56.07,49.29,24.12,46.14,f
27991,1,2025-11-15 12:04:01.053+00,219.35,218.73,215.76,12.68,14.26,5.06,3.07,16.90,5.73,4.50,50.77,48.50,24.96,55.27,f
27992,2,2025-11-15 12:04:01.081+00,218.53,222.37,223.34,14.33,5.18,10.33,1.93,18.58,5.26,4.62,52.54,46.30,22.91,52.20,f
27993,3,2025-11-15 12:04:01.087+00,218.46,246.51,240.59,16.62,24.49,19.31,5.06,10.14,0.00,0.00,0.00,0.00,10.00,30.00,f
27994,4,2025-11-15 12:04:01.091+00,237.63,216.12,240.65,27.87,28.16,20.16,3.68,8.52,0.00,0.00,0.00,0.00,10.00,30.00,f
27995,5,2025-11-15 12:04:01.095+00,218.48,220.97,222.09,11.73,13.82,8.89,1.78,16.74,5.65,4.60,57.10,43.70,21.53,54.87,f
27996,6,2025-11-15 12:04:01.099+00,224.63,220.63,223.43,7.86,11.54,8.65,6.06,19.30,5.19,4.57,59.59,40.38,23.54,52.76,f
27997,1,2025-11-15 12:06:00.639+00,223.59,222.17,219.31,10.65,7.22,9.03,5.69,15.35,5.49,4.59,56.67,44.52,21.95,48.04,f
27998,2,2025-11-15 12:06:00.665+00,217.70,219.58,224.20,11.46,5.63,8.14,4.20,17.33,5.56,4.53,55.94,46.34,20.90,55.47,f
27999,3,2025-11-15 12:06:00.669+00,237.51,218.64,210.85,32.74,26.32,22.62,2.65,11.28,0.00,0.00,0.00,0.00,10.00,30.00,f
28000,4,2025-11-15 12:06:00.672+00,241.89,207.85,201.63,22.10,23.19,31.69,6.11,10.47,0.00,0.00,0.00,0.00,10.00,30.00,f
28001,5,2025-11-15 12:06:00.675+00,218.61,219.88,218.17,5.05,12.61,9.30,3.83,19.59,5.78,4.17,52.71,47.16,21.93,48.77,f
28002,6,2025-11-15 12:06:00.678+00,217.03,217.54,221.06,7.84,9.98,7.59,5.28,12.08,5.79,4.78,56.20,49.12,22.79,53.70,f
28003,1,2025-11-15 12:08:00.215+00,217.61,220.00,218.19,9.68,7.74,14.30,5.08,13.22,5.34,4.16,50.86,41.79,18.30,48.96,f
28004,2,2025-11-15 12:08:00.244+00,220.68,220.99,220.70,14.75,10.45,10.57,2.82,13.14,5.09,4.04,57.13,44.80,24.06,57.76,f
28005,3,2025-11-15 12:08:00.248+00,222.42,222.38,204.82,39.57,20.06,19.21,3.43,8.63,0.00,0.00,0.00,0.00,10.00,30.00,f
28006,4,2025-11-15 12:08:00.251+00,234.26,200.63,233.73,37.72,33.58,38.19,2.82,14.10,0.00,0.00,0.00,0.00,10.00,30.00,f
28007,5,2025-11-15 12:08:00.254+00,218.50,218.07,215.44,9.70,14.11,13.40,1.60,12.84,5.58,4.43,59.46,48.86,21.04,54.56,f
28008,6,2025-11-15 12:08:00.259+00,218.04,216.09,216.96,8.72,9.88,10.85,5.23,18.79,5.59,4.73,50.61,42.42,18.87,45.76,f
\.

-- Name: metrics_metric_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
SELECT pg_catalog.setval('public.metrics_metric_id_seq', 28008, true);

-- PostgreSQL database dump complete
--
