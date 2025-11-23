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
-- Name: postgis; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;


--
-- Name: EXTENSION postgis; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgis IS 'PostGIS geometry and geography spatial types and functions';


--
-- Name: archive_daily_analytics(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.archive_daily_analytics() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Архивируем загрузку трансформаторов
    INSERT INTO analytics_history (analysis_type, infrastructure_id, infrastructure_type, analysis_date, analysis_data)
    SELECT
        'daily_transformer_load',
        id,
        'transformer',
        CURRENT_DATE,
        jsonb_build_object(
            'load_percent', load_percent,
            'buildings_count', buildings_count,
            'active_controllers_count', active_controllers_count,
            'avg_total_voltage', avg_total_voltage,
            'avg_total_amperage', avg_total_amperage
        )
    FROM mv_transformer_load_realtime
    WHERE last_metric_time > CURRENT_DATE - INTERVAL '1 day';

    INSERT INTO logs (timestamp, log_level, message)
    VALUES (NOW(), 'INFO', 'Ежедневная аналитика заархивирована');

EXCEPTION WHEN OTHERS THEN
    INSERT INTO logs (timestamp, log_level, message)
    VALUES (NOW(), 'ERROR', 'Ошибка архивирования аналитики: ' || SQLERRM);
    RAISE;
END;
$$;


--
-- Name: convert_line_endpoints_to_path(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.convert_line_endpoints_to_path() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Если main_path пуст, но есть start/end координаты - конвертируем
    IF (NEW.main_path IS NULL OR NEW.main_path = '[]'::jsonb OR jsonb_array_length(NEW.main_path) = 0)
       AND NEW.latitude_start IS NOT NULL 
       AND NEW.longitude_start IS NOT NULL 
       AND NEW.latitude_end IS NOT NULL 
       AND NEW.longitude_end IS NOT NULL THEN
        
        -- Создаём простой путь из 2 точек (начало → конец)
        NEW.main_path = jsonb_build_array(
            jsonb_build_object(
                'lat', NEW.latitude_start,
                'lng', NEW.longitude_start,
                'order', 0,
                'description', 'Начальная точка'
            ),
            jsonb_build_object(
                'lat', NEW.latitude_end,
                'lng', NEW.longitude_end,
                'order', 1,
                'description', 'Конечная точка'
            )
        );
    END IF;
    
    -- Если branches NULL, устанавливаем пустой массив
    IF NEW.branches IS NULL THEN
        NEW.branches = '[]'::jsonb;
    END IF;
    
    RETURN NEW;
END;
$$;


--
-- Name: find_nearest_buildings_to_transformer(character varying, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_nearest_buildings_to_transformer(transformer_id_param character varying, radius_meters integer DEFAULT 1000) RETURNS TABLE(building_id integer, building_name character varying, distance_meters double precision)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        b.building_id,
        b.name,
        ST_Distance(
            ST_Transform(pt.geom, 3857),
            ST_Transform(b.geom, 3857)
        ) as distance_meters
    FROM buildings b
    CROSS JOIN power_transformers pt
    WHERE pt.id = transformer_id_param
    AND ST_DWithin(
        ST_Transform(pt.geom, 3857),
        ST_Transform(b.geom, 3857),
        radius_meters
    )
    ORDER BY distance_meters;
END;
$$;


--
-- Name: refresh_transformer_analytics(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_transformer_analytics() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_transformer_load_realtime;

    INSERT INTO logs (timestamp, log_level, message)
    VALUES (NOW(), 'INFO', 'Материализованное представление трансформаторов обновлено');

EXCEPTION WHEN OTHERS THEN
    INSERT INTO logs (timestamp, log_level, message)
    VALUES (NOW(), 'ERROR', 'Ошибка обновления материализованного представления: ' || SQLERRM);
    RAISE;
END;
$$;


--
-- Name: update_controller_heartbeat(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_controller_heartbeat() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    UPDATE controllers
    SET last_heartbeat = NEW.timestamp
    WHERE controller_id = NEW.controller_id;
    RETURN NEW;
END;
$$;


--
-- Name: update_geom_on_coordinates_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_geom_on_coordinates_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.geom = ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326);
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: update_line_geom_from_path(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_line_geom_from_path() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Если есть main_path, строим LINESTRING из него
    IF NEW.main_path IS NOT NULL AND jsonb_array_length(NEW.main_path) >= 2 THEN
        -- Извлекаем координаты из JSONB и строим LINESTRING
        NEW.geom = ST_GeomFromText(
            'LINESTRING(' || (
                SELECT string_agg(
                    (point->>'lng')::text || ' ' || (point->>'lat')::text, 
                    ', ' 
                    ORDER BY (point->>'order')::int
                )
                FROM jsonb_array_elements(NEW.main_path) AS point
            ) || ')',
            4326
        );
    -- Иначе если есть start/end координаты, используем их
    ELSIF NEW.latitude_start IS NOT NULL 
          AND NEW.longitude_start IS NOT NULL
          AND NEW.latitude_end IS NOT NULL
          AND NEW.longitude_end IS NOT NULL THEN
        NEW.geom = ST_GeomFromText(
            'LINESTRING(' || 
            NEW.longitude_start || ' ' || NEW.latitude_start || ', ' ||
            NEW.longitude_end || ' ' || NEW.latitude_end || 
            ')',
            4326
        );
    END IF;
    
    RETURN NEW;
END;
$$;


--
-- Name: update_lines_geom_from_coordinates(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_lines_geom_from_coordinates() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Проверяем наличие всех 4 координат
    IF NEW.latitude_start IS NOT NULL AND NEW.longitude_start IS NOT NULL AND
       NEW.latitude_end IS NOT NULL AND NEW.longitude_end IS NOT NULL THEN
        
        -- Создаем LINESTRING из двух точек
        NEW.geom = ST_SetSRID(
            ST_MakeLine(
                ST_MakePoint(NEW.longitude_start, NEW.latitude_start),
                ST_MakePoint(NEW.longitude_end, NEW.latitude_end)
            ),
            4326
        );
        
        -- Вычисляем длину линии в километрах
        NEW.length_km = ROUND(
            (ST_Length(ST_Transform(NEW.geom, 3857)) / 1000.0)::NUMERIC,
            3
        );
    END IF;
    
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


--
-- Name: update_transformers_geom(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_transformers_geom() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
        NEW.geom = ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326);
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


--
-- Name: update_water_lines_geom_from_coordinates(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_water_lines_geom_from_coordinates() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.latitude_start IS NOT NULL AND NEW.longitude_start IS NOT NULL AND
       NEW.latitude_end IS NOT NULL AND NEW.longitude_end IS NOT NULL THEN
        
        NEW.geom = ST_SetSRID(
            ST_MakeLine(
                ST_MakePoint(NEW.longitude_start, NEW.latitude_start),
                ST_MakePoint(NEW.longitude_end, NEW.latitude_end)
            ),
            4326
        );
    END IF;
    
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: alert_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alert_types (
    alert_type_id integer NOT NULL,
    type_name character varying(50) NOT NULL,
    description text
);


--
-- Name: alert_types_alert_type_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.alert_types_alert_type_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: alert_types_alert_type_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.alert_types_alert_type_id_seq OWNED BY public.alert_types.alert_type_id;


--
-- Name: alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alerts (
    alert_id integer NOT NULL,
    metric_id bigint,
    alert_type_id integer,
    severity character varying(20) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    resolved_at timestamp with time zone
);


--
-- Name: alerts_alert_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.alerts_alert_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: alerts_alert_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.alerts_alert_id_seq OWNED BY public.alerts.alert_id;


--
-- Name: analytics_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_history (
    id bigint NOT NULL,
    analysis_type character varying(50) NOT NULL,
    infrastructure_id character varying(50),
    infrastructure_type character varying(50),
    analysis_date date NOT NULL,
    analysis_data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now()
)
PARTITION BY RANGE (analysis_date);


--
-- Name: analytics_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.analytics_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: analytics_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.analytics_history_id_seq OWNED BY public.analytics_history.id;


--
-- Name: analytics_history_current; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_history_current (
    id bigint DEFAULT nextval('public.analytics_history_id_seq'::regclass) NOT NULL,
    analysis_type character varying(50) NOT NULL,
    infrastructure_id character varying(50),
    infrastructure_type character varying(50),
    analysis_date date NOT NULL,
    analysis_data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: analytics_history_prev; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_history_prev (
    id bigint DEFAULT nextval('public.analytics_history_id_seq'::regclass) NOT NULL,
    analysis_type character varying(50) NOT NULL,
    infrastructure_id character varying(50),
    infrastructure_type character varying(50),
    analysis_date date NOT NULL,
    analysis_data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: buildings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.buildings (
    building_id integer NOT NULL,
    name character varying(100) NOT NULL,
    address text NOT NULL,
    town character varying(100) NOT NULL,
    latitude numeric(9,6) NOT NULL,
    longitude numeric(9,6) NOT NULL,
    region character varying(50),
    management_company character varying(100),
    hot_water boolean,
    has_hot_water boolean DEFAULT false,
    geom public.geometry(Point,4326),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    power_transformer_id character varying(50),
    cold_water_source_id character varying(50),
    heat_source_id character varying(50),
    primary_transformer_id integer,
    backup_transformer_id integer,
    primary_line_id integer,
    backup_line_id integer,
    cold_water_line_id integer,
    hot_water_line_id integer,
    cold_water_supplier_id integer,
    hot_water_supplier_id integer
);


--
-- Name: buildings_building_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.buildings_building_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: buildings_building_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.buildings_building_id_seq OWNED BY public.buildings.building_id;


--
-- Name: cold_water_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cold_water_sources (
    id character varying(50) NOT NULL,
    name character varying(100) NOT NULL,
    address text NOT NULL,
    latitude numeric(9,6) NOT NULL,
    longitude numeric(9,6) NOT NULL,
    source_type character varying(50) NOT NULL,
    capacity_m3_per_hour numeric(8,2),
    operating_pressure_bar numeric(5,2),
    installation_date date,
    status character varying(20) DEFAULT 'active'::character varying,
    maintenance_contact character varying(100),
    notes text,
    geom public.geometry(Point,4326),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: controllers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.controllers (
    controller_id integer NOT NULL,
    serial_number character varying(50) NOT NULL,
    vendor character varying(50),
    model character varying(50),
    building_id integer,
    status character varying(20) NOT NULL,
    installed_at timestamp with time zone DEFAULT now(),
    last_heartbeat timestamp with time zone
);


--
-- Name: controllers_controller_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.controllers_controller_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: controllers_controller_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.controllers_controller_id_seq OWNED BY public.controllers.controller_id;


--
-- Name: heat_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.heat_sources (
    id character varying(50) NOT NULL,
    name character varying(100) NOT NULL,
    address text NOT NULL,
    latitude numeric(9,6) NOT NULL,
    longitude numeric(9,6) NOT NULL,
    source_type character varying(50) NOT NULL,
    capacity_mw numeric(8,2),
    fuel_type character varying(50),
    installation_date date,
    status character varying(20) DEFAULT 'active'::character varying,
    maintenance_contact character varying(100),
    notes text,
    geom public.geometry(Point,4326),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: infrastructure_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.infrastructure_alerts (
    alert_id bigint NOT NULL,
    type character varying(50) NOT NULL,
    infrastructure_id character varying(50) NOT NULL,
    infrastructure_type character varying(50) NOT NULL,
    severity character varying(20) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying,
    message text NOT NULL,
    affected_buildings integer DEFAULT 0,
    data jsonb,
    created_at timestamp with time zone DEFAULT now(),
    acknowledged_at timestamp with time zone,
    resolved_at timestamp with time zone,
    acknowledged_by integer,
    resolved_by integer
);


--
-- Name: infrastructure_alerts_alert_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.infrastructure_alerts_alert_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: infrastructure_alerts_alert_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.infrastructure_alerts_alert_id_seq OWNED BY public.infrastructure_alerts.alert_id;


--
-- Name: lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lines (
    line_id integer NOT NULL,
    name character varying(255) NOT NULL,
    voltage_kv numeric(10,2) NOT NULL,
    length_km numeric(10,3) NOT NULL,
    transformer_id integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    latitude_start numeric(9,6),
    longitude_start numeric(9,6),
    latitude_end numeric(9,6),
    longitude_end numeric(9,6),
    geom public.geometry(LineString,4326),
    cable_type character varying(100),
    commissioning_year integer,
    main_path jsonb,
    branches jsonb DEFAULT '[]'::jsonb,
    CONSTRAINT lines_commissioning_year_check CHECK (((commissioning_year >= 1900) AND (commissioning_year <= 2100))),
    CONSTRAINT lines_length_km_check CHECK ((length_km > (0)::numeric)),
    CONSTRAINT lines_voltage_kv_check CHECK ((voltage_kv > (0)::numeric))
);


--
-- Name: TABLE lines; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.lines IS 'Линии электропередач от трансформаторов (админка)';


--
-- Name: COLUMN lines.latitude_start; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.lines.latitude_start IS 'Широта начальной точки линии';


--
-- Name: COLUMN lines.longitude_start; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.lines.longitude_start IS 'Долгота начальной точки линии';


--
-- Name: COLUMN lines.latitude_end; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.lines.latitude_end IS 'Широта конечной точки линии';


--
-- Name: COLUMN lines.longitude_end; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.lines.longitude_end IS 'Долгота конечной точки линии';


--
-- Name: COLUMN lines.geom; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.lines.geom IS 'PostGIS геометрия линии (LINESTRING)';


--
-- Name: COLUMN lines.cable_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.lines.cable_type IS 'Тип кабеля (copper, aluminum, steel_aluminum, fiber)';


--
-- Name: COLUMN lines.commissioning_year; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.lines.commissioning_year IS 'Год ввода в эксплуатацию';


--
-- Name: COLUMN lines.main_path; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.lines.main_path IS 'JSONB массив точек основного пути линии [{lat, lng, order, description}, ...]';


--
-- Name: COLUMN lines.branches; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.lines.branches IS 'JSONB массив ответвлений от основной линии [{name, branch_id, parent_point_index, points: [{lat, lng, order}]}, ...]';


--
-- Name: lines_line_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.lines_line_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: lines_line_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.lines_line_id_seq OWNED BY public.lines.line_id;


--
-- Name: logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.logs (
    log_id bigint NOT NULL,
    "timestamp" timestamp with time zone DEFAULT now(),
    log_level character varying(10) NOT NULL,
    message text NOT NULL,
    details jsonb
);


--
-- Name: logs_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.logs_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: logs_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.logs_log_id_seq OWNED BY public.logs.log_id;


--
-- Name: metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.metrics (
    metric_id bigint NOT NULL,
    controller_id integer,
    "timestamp" timestamp with time zone NOT NULL,
    electricity_ph1 numeric(6,2),
    electricity_ph2 numeric(6,2),
    electricity_ph3 numeric(6,2),
    amperage_ph1 numeric(6,2),
    amperage_ph2 numeric(6,2),
    amperage_ph3 numeric(6,2),
    cold_water_pressure numeric(5,2),
    cold_water_temp numeric(5,2),
    hot_water_in_pressure numeric(5,2),
    hot_water_out_pressure numeric(5,2),
    hot_water_in_temp numeric(5,2),
    hot_water_out_temp numeric(5,2),
    air_temp numeric(5,2),
    humidity numeric(5,2),
    leak_sensor boolean
)
PARTITION BY RANGE ("timestamp");


--
-- Name: metrics_metric_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.metrics_metric_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: metrics_metric_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.metrics_metric_id_seq OWNED BY public.metrics.metric_id;


--
-- Name: metrics_2025_11; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.metrics_2025_11 (
    metric_id bigint DEFAULT nextval('public.metrics_metric_id_seq'::regclass) NOT NULL,
    controller_id integer,
    "timestamp" timestamp with time zone NOT NULL,
    electricity_ph1 numeric(6,2),
    electricity_ph2 numeric(6,2),
    electricity_ph3 numeric(6,2),
    amperage_ph1 numeric(6,2),
    amperage_ph2 numeric(6,2),
    amperage_ph3 numeric(6,2),
    cold_water_pressure numeric(5,2),
    cold_water_temp numeric(5,2),
    hot_water_in_pressure numeric(5,2),
    hot_water_out_pressure numeric(5,2),
    hot_water_in_temp numeric(5,2),
    hot_water_out_temp numeric(5,2),
    air_temp numeric(5,2),
    humidity numeric(5,2),
    leak_sensor boolean
);


--
-- Name: metrics_current_month; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.metrics_current_month (
    metric_id bigint DEFAULT nextval('public.metrics_metric_id_seq'::regclass) NOT NULL,
    controller_id integer,
    "timestamp" timestamp with time zone NOT NULL,
    electricity_ph1 numeric(6,2),
    electricity_ph2 numeric(6,2),
    electricity_ph3 numeric(6,2),
    amperage_ph1 numeric(6,2),
    amperage_ph2 numeric(6,2),
    amperage_ph3 numeric(6,2),
    cold_water_pressure numeric(5,2),
    cold_water_temp numeric(5,2),
    hot_water_in_pressure numeric(5,2),
    hot_water_out_pressure numeric(5,2),
    hot_water_in_temp numeric(5,2),
    hot_water_out_temp numeric(5,2),
    air_temp numeric(5,2),
    humidity numeric(5,2),
    leak_sensor boolean
);


--
-- Name: metrics_prev_month; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.metrics_prev_month (
    metric_id bigint DEFAULT nextval('public.metrics_metric_id_seq'::regclass) NOT NULL,
    controller_id integer,
    "timestamp" timestamp with time zone NOT NULL,
    electricity_ph1 numeric(6,2),
    electricity_ph2 numeric(6,2),
    electricity_ph3 numeric(6,2),
    amperage_ph1 numeric(6,2),
    amperage_ph2 numeric(6,2),
    amperage_ph3 numeric(6,2),
    cold_water_pressure numeric(5,2),
    cold_water_temp numeric(5,2),
    hot_water_in_pressure numeric(5,2),
    hot_water_out_pressure numeric(5,2),
    hot_water_in_temp numeric(5,2),
    hot_water_out_temp numeric(5,2),
    air_temp numeric(5,2),
    humidity numeric(5,2),
    leak_sensor boolean
);


--
-- Name: power_transformers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.power_transformers (
    id character varying(50) NOT NULL,
    name character varying(100) NOT NULL,
    address text NOT NULL,
    latitude numeric(9,6) NOT NULL,
    longitude numeric(9,6) NOT NULL,
    capacity_kva numeric(8,2) NOT NULL,
    voltage_primary numeric(8,2),
    voltage_secondary numeric(8,2),
    installation_date date,
    manufacturer character varying(100),
    model character varying(100),
    status character varying(20) DEFAULT 'active'::character varying,
    maintenance_contact character varying(100),
    notes text,
    geom public.geometry(Point,4326),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: mv_transformer_load_realtime; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.mv_transformer_load_realtime AS
 SELECT pt.id,
    pt.name,
    pt.capacity_kva,
    pt.status,
    pt.latitude,
    pt.longitude,
    count(DISTINCT b.building_id) AS buildings_count,
    count(DISTINCT c.controller_id) AS controllers_count,
    count(DISTINCT
        CASE
            WHEN ((c.status)::text = 'active'::text) THEN c.controller_id
            ELSE NULL::integer
        END) AS active_controllers_count,
    avg(((COALESCE(m.electricity_ph1, (0)::numeric) + COALESCE(m.electricity_ph2, (0)::numeric)) + COALESCE(m.electricity_ph3, (0)::numeric))) AS avg_total_voltage,
    avg(((COALESCE(m.amperage_ph1, (0)::numeric) + COALESCE(m.amperage_ph2, (0)::numeric)) + COALESCE(m.amperage_ph3, (0)::numeric))) AS avg_total_amperage,
        CASE
            WHEN (pt.capacity_kva > (0)::numeric) THEN LEAST((100)::numeric, (((avg(((COALESCE(m.amperage_ph1, (0)::numeric) + COALESCE(m.amperage_ph2, (0)::numeric)) + COALESCE(m.amperage_ph3, (0)::numeric))) * 0.4) / pt.capacity_kva) * (100)::numeric))
            ELSE (0)::numeric
        END AS load_percent,
    max(m."timestamp") AS last_metric_time,
    count(
        CASE
            WHEN (m."timestamp" > (now() - '01:00:00'::interval)) THEN 1
            ELSE NULL::integer
        END) AS recent_metrics_count
   FROM (((public.power_transformers pt
     LEFT JOIN public.buildings b ON (((pt.id)::text = (b.power_transformer_id)::text)))
     LEFT JOIN public.controllers c ON ((b.building_id = c.building_id)))
     LEFT JOIN public.metrics m ON (((c.controller_id = m.controller_id) AND (m."timestamp" > (now() - '24:00:00'::interval)))))
  GROUP BY pt.id, pt.name, pt.capacity_kva, pt.status, pt.latitude, pt.longitude
  WITH NO DATA;


--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refresh_tokens (
    token_id bigint NOT NULL,
    user_id integer,
    token_hash character varying(255) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: refresh_tokens_token_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.refresh_tokens_token_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: refresh_tokens_token_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.refresh_tokens_token_id_seq OWNED BY public.refresh_tokens.token_id;


--
-- Name: token_blacklist; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.token_blacklist (
    id bigint NOT NULL,
    token_hash character varying(255) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    blacklisted_at timestamp with time zone DEFAULT now()
);


--
-- Name: token_blacklist_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.token_blacklist_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: token_blacklist_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.token_blacklist_id_seq OWNED BY public.token_blacklist.id;


--
-- Name: transformers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transformers (
    transformer_id integer NOT NULL,
    name character varying(255) NOT NULL,
    power_kva numeric(10,2) NOT NULL,
    voltage_kv numeric(10,2) NOT NULL,
    location character varying(255),
    installation_date date,
    manufacturer character varying(100),
    model character varying(100),
    status character varying(20) DEFAULT 'active'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    latitude numeric(9,6),
    longitude numeric(9,6),
    geom public.geometry(Point,4326),
    CONSTRAINT transformers_power_kva_check CHECK ((power_kva > (0)::numeric)),
    CONSTRAINT transformers_voltage_kv_check CHECK ((voltage_kv > (0)::numeric))
);


--
-- Name: TABLE transformers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.transformers IS 'Трансформаторы для электроснабжения зданий (админка)';


--
-- Name: COLUMN transformers.latitude; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.transformers.latitude IS 'Широта расположения трансформатора';


--
-- Name: COLUMN transformers.longitude; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.transformers.longitude IS 'Долгота расположения трансформатора';


--
-- Name: COLUMN transformers.geom; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.transformers.geom IS 'PostGIS геометрия точки трансформатора';


--
-- Name: transformers_transformer_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.transformers_transformer_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transformers_transformer_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.transformers_transformer_id_seq OWNED BY public.transformers.transformer_id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    user_id integer NOT NULL,
    username character varying(50) NOT NULL,
    email character varying(100) NOT NULL,
    password_hash character varying(255) NOT NULL,
    full_name character varying(100),
    role character varying(20) DEFAULT 'user'::character varying,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_login timestamp with time zone
);


--
-- Name: users_user_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_user_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_user_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_user_id_seq OWNED BY public.users.user_id;


--
-- Name: water_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.water_lines (
    line_id integer NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    diameter_mm integer,
    material character varying(100),
    pressure_bar numeric(5,2),
    installation_date date,
    status character varying(20) DEFAULT 'active'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    latitude_start numeric(9,6),
    longitude_start numeric(9,6),
    latitude_end numeric(9,6),
    longitude_end numeric(9,6),
    geom public.geometry(LineString,4326),
    main_path jsonb,
    branches jsonb DEFAULT '[]'::jsonb,
    CONSTRAINT water_lines_diameter_mm_check CHECK ((diameter_mm > 0)),
    CONSTRAINT water_lines_pressure_bar_check CHECK ((pressure_bar > (0)::numeric))
);


--
-- Name: TABLE water_lines; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.water_lines IS 'Линии водоснабжения (ХВС и ГВС)';


--
-- Name: COLUMN water_lines.latitude_start; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.water_lines.latitude_start IS 'Широта начальной точки линии водоснабжения';


--
-- Name: COLUMN water_lines.longitude_start; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.water_lines.longitude_start IS 'Долгота начальной точки линии водоснабжения';


--
-- Name: COLUMN water_lines.latitude_end; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.water_lines.latitude_end IS 'Широта конечной точки линии водоснабжения';


--
-- Name: COLUMN water_lines.longitude_end; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.water_lines.longitude_end IS 'Долгота конечной точки линии водоснабжения';


--
-- Name: water_lines_line_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.water_lines_line_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: water_lines_line_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.water_lines_line_id_seq OWNED BY public.water_lines.line_id;


--
-- Name: water_measurement_points; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.water_measurement_points (
    point_id integer NOT NULL,
    building_id integer NOT NULL,
    point_type character varying(50) NOT NULL,
    location character varying(255),
    meter_serial character varying(100),
    installation_date date,
    last_reading numeric(10,3),
    last_reading_date date,
    status character varying(20) DEFAULT 'active'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE water_measurement_points; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.water_measurement_points IS 'Точки измерения расхода воды в зданиях';


--
-- Name: water_measurement_points_point_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.water_measurement_points_point_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: water_measurement_points_point_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.water_measurement_points_point_id_seq OWNED BY public.water_measurement_points.point_id;


--
-- Name: water_suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.water_suppliers (
    supplier_id integer NOT NULL,
    name character varying(255) NOT NULL,
    supplier_type character varying(50) NOT NULL,
    contact_person character varying(255),
    phone character varying(50),
    email character varying(255),
    address text,
    tariff_per_m3 numeric(10,2),
    contract_number character varying(100),
    contract_date date,
    status character varying(20) DEFAULT 'active'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE water_suppliers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.water_suppliers IS 'Поставщики холодной и горячей воды';


--
-- Name: water_suppliers_supplier_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.water_suppliers_supplier_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: water_suppliers_supplier_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.water_suppliers_supplier_id_seq OWNED BY public.water_suppliers.supplier_id;


--
-- Name: analytics_history_current; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_history ATTACH PARTITION public.analytics_history_current FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');


--
-- Name: analytics_history_prev; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_history ATTACH PARTITION public.analytics_history_prev FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');


--
-- Name: metrics_2025_11; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metrics ATTACH PARTITION public.metrics_2025_11 FOR VALUES FROM ('2025-11-01 00:00:00+00') TO ('2025-12-01 00:00:00+00');


--
-- Name: metrics_current_month; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metrics ATTACH PARTITION public.metrics_current_month FOR VALUES FROM ('2025-07-01 00:00:00+00') TO ('2025-08-01 00:00:00+00');


--
-- Name: metrics_prev_month; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metrics ATTACH PARTITION public.metrics_prev_month FOR VALUES FROM ('2025-06-01 00:00:00+00') TO ('2025-07-01 00:00:00+00');


--
-- Name: alert_types alert_type_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_types ALTER COLUMN alert_type_id SET DEFAULT nextval('public.alert_types_alert_type_id_seq'::regclass);


--
-- Name: alerts alert_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts ALTER COLUMN alert_id SET DEFAULT nextval('public.alerts_alert_id_seq'::regclass);


--
-- Name: analytics_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_history ALTER COLUMN id SET DEFAULT nextval('public.analytics_history_id_seq'::regclass);


--
-- Name: buildings building_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buildings ALTER COLUMN building_id SET DEFAULT nextval('public.buildings_building_id_seq'::regclass);


--
-- Name: controllers controller_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controllers ALTER COLUMN controller_id SET DEFAULT nextval('public.controllers_controller_id_seq'::regclass);


--
-- Name: infrastructure_alerts alert_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.infrastructure_alerts ALTER COLUMN alert_id SET DEFAULT nextval('public.infrastructure_alerts_alert_id_seq'::regclass);


--
-- Name: lines line_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lines ALTER COLUMN line_id SET DEFAULT nextval('public.lines_line_id_seq'::regclass);


--
-- Name: logs log_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.logs ALTER COLUMN log_id SET DEFAULT nextval('public.logs_log_id_seq'::regclass);


--
-- Name: metrics metric_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metrics ALTER COLUMN metric_id SET DEFAULT nextval('public.metrics_metric_id_seq'::regclass);


--
-- Name: refresh_tokens token_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens ALTER COLUMN token_id SET DEFAULT nextval('public.refresh_tokens_token_id_seq'::regclass);


--
-- Name: token_blacklist id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.token_blacklist ALTER COLUMN id SET DEFAULT nextval('public.token_blacklist_id_seq'::regclass);


--
-- Name: transformers transformer_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transformers ALTER COLUMN transformer_id SET DEFAULT nextval('public.transformers_transformer_id_seq'::regclass);


--
-- Name: users user_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN user_id SET DEFAULT nextval('public.users_user_id_seq'::regclass);


--
-- Name: water_lines line_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.water_lines ALTER COLUMN line_id SET DEFAULT nextval('public.water_lines_line_id_seq'::regclass);


--
-- Name: water_measurement_points point_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.water_measurement_points ALTER COLUMN point_id SET DEFAULT nextval('public.water_measurement_points_point_id_seq'::regclass);


--
-- Name: water_suppliers supplier_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.water_suppliers ALTER COLUMN supplier_id SET DEFAULT nextval('public.water_suppliers_supplier_id_seq'::regclass);


--
-- Name: alert_types alert_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_types
    ADD CONSTRAINT alert_types_pkey PRIMARY KEY (alert_type_id);


--
-- Name: alert_types alert_types_type_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_types
    ADD CONSTRAINT alert_types_type_name_key UNIQUE (type_name);


--
-- Name: alerts alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_pkey PRIMARY KEY (alert_id);


--
-- Name: analytics_history analytics_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_history
    ADD CONSTRAINT analytics_history_pkey PRIMARY KEY (id, analysis_date);


--
-- Name: analytics_history_current analytics_history_current_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_history_current
    ADD CONSTRAINT analytics_history_current_pkey PRIMARY KEY (id, analysis_date);


--
-- Name: analytics_history_prev analytics_history_prev_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_history_prev
    ADD CONSTRAINT analytics_history_prev_pkey PRIMARY KEY (id, analysis_date);


--
-- Name: buildings buildings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buildings
    ADD CONSTRAINT buildings_pkey PRIMARY KEY (building_id);


--
-- Name: cold_water_sources cold_water_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cold_water_sources
    ADD CONSTRAINT cold_water_sources_pkey PRIMARY KEY (id);


--
-- Name: controllers controllers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controllers
    ADD CONSTRAINT controllers_pkey PRIMARY KEY (controller_id);


--
-- Name: controllers controllers_serial_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controllers
    ADD CONSTRAINT controllers_serial_number_key UNIQUE (serial_number);


--
-- Name: heat_sources heat_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.heat_sources
    ADD CONSTRAINT heat_sources_pkey PRIMARY KEY (id);


--
-- Name: infrastructure_alerts infrastructure_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.infrastructure_alerts
    ADD CONSTRAINT infrastructure_alerts_pkey PRIMARY KEY (alert_id);


--
-- Name: lines lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lines
    ADD CONSTRAINT lines_pkey PRIMARY KEY (line_id);


--
-- Name: logs logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.logs
    ADD CONSTRAINT logs_pkey PRIMARY KEY (log_id);


--
-- Name: metrics metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metrics
    ADD CONSTRAINT metrics_pkey PRIMARY KEY (metric_id, "timestamp");


--
-- Name: metrics_2025_11 metrics_2025_11_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metrics_2025_11
    ADD CONSTRAINT metrics_2025_11_pkey PRIMARY KEY (metric_id, "timestamp");


--
-- Name: metrics_current_month metrics_current_month_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metrics_current_month
    ADD CONSTRAINT metrics_current_month_pkey PRIMARY KEY (metric_id, "timestamp");


--
-- Name: metrics_prev_month metrics_prev_month_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metrics_prev_month
    ADD CONSTRAINT metrics_prev_month_pkey PRIMARY KEY (metric_id, "timestamp");


--
-- Name: power_transformers power_transformers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.power_transformers
    ADD CONSTRAINT power_transformers_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (token_id);


--
-- Name: token_blacklist token_blacklist_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.token_blacklist
    ADD CONSTRAINT token_blacklist_pkey PRIMARY KEY (id);


--
-- Name: token_blacklist token_blacklist_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.token_blacklist
    ADD CONSTRAINT token_blacklist_token_hash_key UNIQUE (token_hash);


--
-- Name: transformers transformers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transformers
    ADD CONSTRAINT transformers_pkey PRIMARY KEY (transformer_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: water_lines water_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.water_lines
    ADD CONSTRAINT water_lines_pkey PRIMARY KEY (line_id);


--
-- Name: water_measurement_points water_measurement_points_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.water_measurement_points
    ADD CONSTRAINT water_measurement_points_pkey PRIMARY KEY (point_id);


--
-- Name: water_suppliers water_suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.water_suppliers
    ADD CONSTRAINT water_suppliers_pkey PRIMARY KEY (supplier_id);


--
-- Name: idx_analytics_history_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_analytics_history_date ON ONLY public.analytics_history USING btree (analysis_date);


--
-- Name: analytics_history_current_analysis_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_history_current_analysis_date_idx ON public.analytics_history_current USING btree (analysis_date);


--
-- Name: idx_analytics_history_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_analytics_history_type ON ONLY public.analytics_history USING btree (analysis_type);


--
-- Name: analytics_history_current_analysis_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_history_current_analysis_type_idx ON public.analytics_history_current USING btree (analysis_type);


--
-- Name: idx_analytics_history_infrastructure; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_analytics_history_infrastructure ON ONLY public.analytics_history USING btree (infrastructure_id, infrastructure_type);


--
-- Name: analytics_history_current_infrastructure_id_infrastructure__idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_history_current_infrastructure_id_infrastructure__idx ON public.analytics_history_current USING btree (infrastructure_id, infrastructure_type);


--
-- Name: analytics_history_prev_analysis_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_history_prev_analysis_date_idx ON public.analytics_history_prev USING btree (analysis_date);


--
-- Name: analytics_history_prev_analysis_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_history_prev_analysis_type_idx ON public.analytics_history_prev USING btree (analysis_type);


--
-- Name: analytics_history_prev_infrastructure_id_infrastructure_typ_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_history_prev_infrastructure_id_infrastructure_typ_idx ON public.analytics_history_prev USING btree (infrastructure_id, infrastructure_type);


--
-- Name: idx_alerts_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alerts_created_at ON public.alerts USING btree (created_at);


--
-- Name: idx_alerts_metric; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alerts_metric ON public.alerts USING btree (metric_id);


--
-- Name: idx_alerts_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alerts_status ON public.alerts USING btree (status);


--
-- Name: idx_buildings_address_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_address_gin ON public.buildings USING gin (to_tsvector('russian'::regconfig, address));


--
-- Name: idx_buildings_address_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_address_lower ON public.buildings USING btree (lower(address));


--
-- Name: idx_buildings_backup_line; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_backup_line ON public.buildings USING btree (backup_line_id);


--
-- Name: idx_buildings_backup_transformer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_backup_transformer ON public.buildings USING btree (backup_transformer_id);


--
-- Name: idx_buildings_cold_water_line; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_cold_water_line ON public.buildings USING btree (cold_water_line_id);


--
-- Name: idx_buildings_cold_water_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_cold_water_source ON public.buildings USING btree (cold_water_source_id);


--
-- Name: idx_buildings_cold_water_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_cold_water_supplier ON public.buildings USING btree (cold_water_supplier_id);


--
-- Name: idx_buildings_geom; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_geom ON public.buildings USING gist (geom);


--
-- Name: idx_buildings_heat_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_heat_source ON public.buildings USING btree (heat_source_id);


--
-- Name: idx_buildings_hot_water_line; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_hot_water_line ON public.buildings USING btree (hot_water_line_id);


--
-- Name: idx_buildings_hot_water_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_hot_water_supplier ON public.buildings USING btree (hot_water_supplier_id);


--
-- Name: idx_buildings_management_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_management_company ON public.buildings USING btree (management_company);


--
-- Name: idx_buildings_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_name ON public.buildings USING btree (name);


--
-- Name: INDEX idx_buildings_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.idx_buildings_name IS 'Ускоряет поиск зданий по названию в админке';


--
-- Name: idx_buildings_name_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_name_id ON public.buildings USING btree (name, building_id);


--
-- Name: idx_buildings_name_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_name_lower ON public.buildings USING btree (lower((name)::text));


--
-- Name: idx_buildings_power_transformer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_power_transformer ON public.buildings USING btree (power_transformer_id);


--
-- Name: idx_buildings_primary_line; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_primary_line ON public.buildings USING btree (primary_line_id);


--
-- Name: idx_buildings_primary_transformer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_primary_transformer ON public.buildings USING btree (primary_transformer_id);


--
-- Name: idx_buildings_region; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_region ON public.buildings USING btree (region);


--
-- Name: idx_buildings_region_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_region_id ON public.buildings USING btree (region, building_id);


--
-- Name: idx_buildings_stats; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_stats ON public.buildings USING btree (town, region, management_company);


--
-- Name: idx_buildings_town; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_town ON public.buildings USING btree (town);


--
-- Name: idx_buildings_town_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_town_id ON public.buildings USING btree (town, building_id);


--
-- Name: idx_cold_water_sources_geom; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cold_water_sources_geom ON public.cold_water_sources USING gist (geom);


--
-- Name: idx_cold_water_sources_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cold_water_sources_name ON public.cold_water_sources USING btree (name);


--
-- Name: idx_cold_water_sources_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cold_water_sources_status ON public.cold_water_sources USING btree (status);


--
-- Name: idx_cold_water_sources_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cold_water_sources_type ON public.cold_water_sources USING btree (source_type);


--
-- Name: idx_controllers_active_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_controllers_active_status ON public.controllers USING btree (controller_id, status) WHERE ((status)::text = ANY ((ARRAY['online'::character varying, 'maintenance'::character varying])::text[]));


--
-- Name: INDEX idx_controllers_active_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.idx_controllers_active_status IS 'Частичный индекс только для активных контроллеров';


--
-- Name: idx_controllers_building; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_controllers_building ON public.controllers USING btree (building_id);


--
-- Name: idx_controllers_building_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_controllers_building_status ON public.controllers USING btree (building_id, status);


--
-- Name: idx_controllers_heartbeat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_controllers_heartbeat ON public.controllers USING btree (last_heartbeat);


--
-- Name: idx_controllers_model; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_controllers_model ON public.controllers USING btree (model);


--
-- Name: idx_controllers_serial; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_controllers_serial ON public.controllers USING btree (serial_number);


--
-- Name: idx_controllers_serial_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_controllers_serial_lower ON public.controllers USING btree (lower((serial_number)::text));


--
-- Name: INDEX idx_controllers_serial_lower; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.idx_controllers_serial_lower IS 'Поиск контроллеров по серийному номеру без учета регистра';


--
-- Name: idx_controllers_stats; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_controllers_stats ON public.controllers USING btree (status, vendor, building_id);


--
-- Name: idx_controllers_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_controllers_status ON public.controllers USING btree (status);


--
-- Name: idx_controllers_status_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_controllers_status_id ON public.controllers USING btree (status, controller_id);


--
-- Name: idx_controllers_vendor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_controllers_vendor ON public.controllers USING btree (vendor);


--
-- Name: idx_controllers_vendor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_controllers_vendor_id ON public.controllers USING btree (vendor, controller_id);


--
-- Name: idx_heat_sources_geom; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_heat_sources_geom ON public.heat_sources USING gist (geom);


--
-- Name: idx_heat_sources_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_heat_sources_name ON public.heat_sources USING btree (name);


--
-- Name: idx_heat_sources_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_heat_sources_status ON public.heat_sources USING btree (status);


--
-- Name: idx_heat_sources_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_heat_sources_type ON public.heat_sources USING btree (source_type);


--
-- Name: idx_infrastructure_alerts_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_infrastructure_alerts_active ON public.infrastructure_alerts USING btree (status, created_at DESC) WHERE ((status)::text = 'active'::text);


--
-- Name: idx_infrastructure_alerts_building_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_infrastructure_alerts_building_ref ON public.infrastructure_alerts USING btree (infrastructure_id, infrastructure_type) WHERE ((infrastructure_type)::text = 'building'::text);


--
-- Name: idx_infrastructure_alerts_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_infrastructure_alerts_created_at ON public.infrastructure_alerts USING btree (created_at);


--
-- Name: idx_infrastructure_alerts_infrastructure; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_infrastructure_alerts_infrastructure ON public.infrastructure_alerts USING btree (infrastructure_id, infrastructure_type);


--
-- Name: idx_infrastructure_alerts_severity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_infrastructure_alerts_severity ON public.infrastructure_alerts USING btree (severity);


--
-- Name: idx_infrastructure_alerts_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_infrastructure_alerts_status ON public.infrastructure_alerts USING btree (status);


--
-- Name: idx_infrastructure_alerts_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_infrastructure_alerts_type ON public.infrastructure_alerts USING btree (type);


--
-- Name: idx_lines_branches; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lines_branches ON public.lines USING gin (branches);


--
-- Name: idx_lines_cable_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lines_cable_type ON public.lines USING btree (cable_type) WHERE (cable_type IS NOT NULL);


--
-- Name: idx_lines_commissioning_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lines_commissioning_year ON public.lines USING btree (commissioning_year) WHERE (commissioning_year IS NOT NULL);


--
-- Name: idx_lines_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lines_created_at ON public.lines USING btree (created_at DESC);


--
-- Name: idx_lines_geom; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lines_geom ON public.lines USING gist (geom);


--
-- Name: idx_lines_length; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lines_length ON public.lines USING btree (length_km);


--
-- Name: idx_lines_main_path; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lines_main_path ON public.lines USING gin (main_path);


--
-- Name: idx_lines_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lines_name ON public.lines USING btree (name);


--
-- Name: idx_lines_name_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lines_name_lower ON public.lines USING btree (lower((name)::text));


--
-- Name: idx_lines_stats; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lines_stats ON public.lines USING btree (transformer_id, voltage_kv, length_km);


--
-- Name: idx_lines_transformer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lines_transformer_id ON public.lines USING btree (transformer_id);


--
-- Name: idx_lines_voltage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lines_voltage ON public.lines USING btree (voltage_kv);


--
-- Name: idx_metrics_controller; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_metrics_controller ON ONLY public.metrics USING btree (controller_id);


--
-- Name: idx_metrics_controller_latest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_metrics_controller_latest ON ONLY public.metrics USING btree (controller_id, "timestamp" DESC, metric_id);


--
-- Name: idx_metrics_controller_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_metrics_controller_timestamp ON ONLY public.metrics USING btree (controller_id, "timestamp" DESC);


--
-- Name: INDEX idx_metrics_controller_timestamp; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.idx_metrics_controller_timestamp IS 'Критический индекс для загрузки последних метрик в админке';


--
-- Name: idx_metrics_leak; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_metrics_leak ON ONLY public.metrics USING btree (leak_sensor) WHERE (leak_sensor = true);


--
-- Name: idx_metrics_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_metrics_timestamp ON ONLY public.metrics USING btree ("timestamp");


--
-- Name: idx_metrics_timestamp_controller; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_metrics_timestamp_controller ON ONLY public.metrics USING btree ("timestamp" DESC, controller_id);


--
-- Name: idx_mv_transformer_load_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_mv_transformer_load_id ON public.mv_transformer_load_realtime USING btree (id);


--
-- Name: idx_mv_transformer_load_percent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mv_transformer_load_percent ON public.mv_transformer_load_realtime USING btree (load_percent DESC);


--
-- Name: idx_mv_transformer_load_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mv_transformer_load_status ON public.mv_transformer_load_realtime USING btree (status);


--
-- Name: idx_power_transformers_capacity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_power_transformers_capacity ON public.power_transformers USING btree (capacity_kva);


--
-- Name: idx_power_transformers_geom; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_power_transformers_geom ON public.power_transformers USING gist (geom);


--
-- Name: idx_power_transformers_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_power_transformers_name ON public.power_transformers USING btree (name);


--
-- Name: idx_power_transformers_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_power_transformers_status ON public.power_transformers USING btree (status);


--
-- Name: idx_transformers_coordinates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transformers_coordinates ON public.transformers USING btree (latitude, longitude) WHERE ((latitude IS NOT NULL) AND (longitude IS NOT NULL));


--
-- Name: idx_transformers_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transformers_created_at ON public.transformers USING btree (created_at DESC);


--
-- Name: idx_transformers_geom; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transformers_geom ON public.transformers USING gist (geom);


--
-- Name: idx_transformers_manufacturer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transformers_manufacturer ON public.transformers USING btree (manufacturer);


--
-- Name: idx_transformers_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transformers_name ON public.transformers USING btree (name);


--
-- Name: idx_transformers_name_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transformers_name_lower ON public.transformers USING btree (lower((name)::text));


--
-- Name: idx_transformers_power; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transformers_power ON public.transformers USING btree (power_kva);


--
-- Name: idx_transformers_stats; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transformers_stats ON public.transformers USING btree (power_kva, voltage_kv, status);


--
-- Name: idx_transformers_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transformers_status ON public.transformers USING btree (status);


--
-- Name: idx_transformers_voltage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transformers_voltage ON public.transformers USING btree (voltage_kv);


--
-- Name: idx_users_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_active ON public.users USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_role ON public.users USING btree (role);


--
-- Name: idx_users_username; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_username ON public.users USING btree (username);


--
-- Name: idx_water_lines_branches; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_water_lines_branches ON public.water_lines USING gin (branches);


--
-- Name: idx_water_lines_geom; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_water_lines_geom ON public.water_lines USING gist (geom);


--
-- Name: idx_water_lines_main_path; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_water_lines_main_path ON public.water_lines USING gin (main_path);


--
-- Name: idx_water_lines_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_water_lines_name ON public.water_lines USING btree (name);


--
-- Name: idx_water_lines_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_water_lines_status ON public.water_lines USING btree (status);


--
-- Name: idx_water_measurement_points_building; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_water_measurement_points_building ON public.water_measurement_points USING btree (building_id);


--
-- Name: idx_water_measurement_points_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_water_measurement_points_type ON public.water_measurement_points USING btree (point_type);


--
-- Name: idx_water_suppliers_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_water_suppliers_name ON public.water_suppliers USING btree (name);


--
-- Name: idx_water_suppliers_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_water_suppliers_status ON public.water_suppliers USING btree (status);


--
-- Name: idx_water_suppliers_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_water_suppliers_type ON public.water_suppliers USING btree (supplier_type);


--
-- Name: metrics_2025_11_controller_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX metrics_2025_11_controller_id_idx ON public.metrics_2025_11 USING btree (controller_id);


--
-- Name: metrics_2025_11_controller_id_timestamp_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX metrics_2025_11_controller_id_timestamp_idx ON public.metrics_2025_11 USING btree (controller_id, "timestamp" DESC);


--
-- Name: metrics_2025_11_controller_id_timestamp_metric_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX metrics_2025_11_controller_id_timestamp_metric_id_idx ON public.metrics_2025_11 USING btree (controller_id, "timestamp" DESC, metric_id);


--
-- Name: metrics_2025_11_leak_sensor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX metrics_2025_11_leak_sensor_idx ON public.metrics_2025_11 USING btree (leak_sensor) WHERE (leak_sensor = true);


--
-- Name: metrics_2025_11_timestamp_controller_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX metrics_2025_11_timestamp_controller_id_idx ON public.metrics_2025_11 USING btree ("timestamp" DESC, controller_id);


--
-- Name: metrics_2025_11_timestamp_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX metrics_2025_11_timestamp_idx ON public.metrics_2025_11 USING btree ("timestamp");


--
-- Name: metrics_current_month_controller_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX metrics_current_month_controller_id_idx ON public.metrics_current_month USING btree (controller_id);


--
-- Name: metrics_current_month_controller_id_timestamp_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX metrics_current_month_controller_id_timestamp_idx ON public.metrics_current_month USING btree (controller_id, "timestamp" DESC);


--
-- Name: metrics_current_month_controller_id_timestamp_metric_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX metrics_current_month_controller_id_timestamp_metric_id_idx ON public.metrics_current_month USING btree (controller_id, "timestamp" DESC, metric_id);


--
-- Name: metrics_current_month_leak_sensor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX metrics_current_month_leak_sensor_idx ON public.metrics_current_month USING btree (leak_sensor) WHERE (leak_sensor = true);


--
-- Name: metrics_current_month_timestamp_controller_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX metrics_current_month_timestamp_controller_id_idx ON public.metrics_current_month USING btree ("timestamp" DESC, controller_id);


--
-- Name: metrics_current_month_timestamp_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX metrics_current_month_timestamp_idx ON public.metrics_current_month USING btree ("timestamp");


--
-- Name: metrics_prev_month_controller_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX metrics_prev_month_controller_id_idx ON public.metrics_prev_month USING btree (controller_id);


--
-- Name: metrics_prev_month_controller_id_timestamp_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX metrics_prev_month_controller_id_timestamp_idx ON public.metrics_prev_month USING btree (controller_id, "timestamp" DESC);


--
-- Name: metrics_prev_month_controller_id_timestamp_metric_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX metrics_prev_month_controller_id_timestamp_metric_id_idx ON public.metrics_prev_month USING btree (controller_id, "timestamp" DESC, metric_id);


--
-- Name: metrics_prev_month_leak_sensor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX metrics_prev_month_leak_sensor_idx ON public.metrics_prev_month USING btree (leak_sensor) WHERE (leak_sensor = true);


--
-- Name: metrics_prev_month_timestamp_controller_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX metrics_prev_month_timestamp_controller_id_idx ON public.metrics_prev_month USING btree ("timestamp" DESC, controller_id);


--
-- Name: metrics_prev_month_timestamp_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX metrics_prev_month_timestamp_idx ON public.metrics_prev_month USING btree ("timestamp");


--
-- Name: analytics_history_current_analysis_date_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_analytics_history_date ATTACH PARTITION public.analytics_history_current_analysis_date_idx;


--
-- Name: analytics_history_current_analysis_type_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_analytics_history_type ATTACH PARTITION public.analytics_history_current_analysis_type_idx;


--
-- Name: analytics_history_current_infrastructure_id_infrastructure__idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_analytics_history_infrastructure ATTACH PARTITION public.analytics_history_current_infrastructure_id_infrastructure__idx;


--
-- Name: analytics_history_current_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.analytics_history_pkey ATTACH PARTITION public.analytics_history_current_pkey;


--
-- Name: analytics_history_prev_analysis_date_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_analytics_history_date ATTACH PARTITION public.analytics_history_prev_analysis_date_idx;


--
-- Name: analytics_history_prev_analysis_type_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_analytics_history_type ATTACH PARTITION public.analytics_history_prev_analysis_type_idx;


--
-- Name: analytics_history_prev_infrastructure_id_infrastructure_typ_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_analytics_history_infrastructure ATTACH PARTITION public.analytics_history_prev_infrastructure_id_infrastructure_typ_idx;


--
-- Name: analytics_history_prev_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.analytics_history_pkey ATTACH PARTITION public.analytics_history_prev_pkey;


--
-- Name: metrics_2025_11_controller_id_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_metrics_controller ATTACH PARTITION public.metrics_2025_11_controller_id_idx;


--
-- Name: metrics_2025_11_controller_id_timestamp_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_metrics_controller_timestamp ATTACH PARTITION public.metrics_2025_11_controller_id_timestamp_idx;


--
-- Name: metrics_2025_11_controller_id_timestamp_metric_id_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_metrics_controller_latest ATTACH PARTITION public.metrics_2025_11_controller_id_timestamp_metric_id_idx;


--
-- Name: metrics_2025_11_leak_sensor_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_metrics_leak ATTACH PARTITION public.metrics_2025_11_leak_sensor_idx;


--
-- Name: metrics_2025_11_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.metrics_pkey ATTACH PARTITION public.metrics_2025_11_pkey;


--
-- Name: metrics_2025_11_timestamp_controller_id_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_metrics_timestamp_controller ATTACH PARTITION public.metrics_2025_11_timestamp_controller_id_idx;


--
-- Name: metrics_2025_11_timestamp_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_metrics_timestamp ATTACH PARTITION public.metrics_2025_11_timestamp_idx;


--
-- Name: metrics_current_month_controller_id_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_metrics_controller ATTACH PARTITION public.metrics_current_month_controller_id_idx;


--
-- Name: metrics_current_month_controller_id_timestamp_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_metrics_controller_timestamp ATTACH PARTITION public.metrics_current_month_controller_id_timestamp_idx;


--
-- Name: metrics_current_month_controller_id_timestamp_metric_id_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_metrics_controller_latest ATTACH PARTITION public.metrics_current_month_controller_id_timestamp_metric_id_idx;


--
-- Name: metrics_current_month_leak_sensor_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_metrics_leak ATTACH PARTITION public.metrics_current_month_leak_sensor_idx;


--
-- Name: metrics_current_month_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.metrics_pkey ATTACH PARTITION public.metrics_current_month_pkey;


--
-- Name: metrics_current_month_timestamp_controller_id_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_metrics_timestamp_controller ATTACH PARTITION public.metrics_current_month_timestamp_controller_id_idx;


--
-- Name: metrics_current_month_timestamp_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_metrics_timestamp ATTACH PARTITION public.metrics_current_month_timestamp_idx;


--
-- Name: metrics_prev_month_controller_id_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_metrics_controller ATTACH PARTITION public.metrics_prev_month_controller_id_idx;


--
-- Name: metrics_prev_month_controller_id_timestamp_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_metrics_controller_timestamp ATTACH PARTITION public.metrics_prev_month_controller_id_timestamp_idx;


--
-- Name: metrics_prev_month_controller_id_timestamp_metric_id_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_metrics_controller_latest ATTACH PARTITION public.metrics_prev_month_controller_id_timestamp_metric_id_idx;


--
-- Name: metrics_prev_month_leak_sensor_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_metrics_leak ATTACH PARTITION public.metrics_prev_month_leak_sensor_idx;


--
-- Name: metrics_prev_month_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.metrics_pkey ATTACH PARTITION public.metrics_prev_month_pkey;


--
-- Name: metrics_prev_month_timestamp_controller_id_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_metrics_timestamp_controller ATTACH PARTITION public.metrics_prev_month_timestamp_controller_id_idx;


--
-- Name: metrics_prev_month_timestamp_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_metrics_timestamp ATTACH PARTITION public.metrics_prev_month_timestamp_idx;


--
-- Name: buildings trig_buildings_geom; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trig_buildings_geom BEFORE INSERT OR UPDATE OF latitude, longitude ON public.buildings FOR EACH ROW EXECUTE FUNCTION public.update_geom_on_coordinates_change();


--
-- Name: cold_water_sources trig_cold_water_sources_geom; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trig_cold_water_sources_geom BEFORE INSERT OR UPDATE OF latitude, longitude ON public.cold_water_sources FOR EACH ROW EXECUTE FUNCTION public.update_geom_on_coordinates_change();


--
-- Name: heat_sources trig_heat_sources_geom; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trig_heat_sources_geom BEFORE INSERT OR UPDATE OF latitude, longitude ON public.heat_sources FOR EACH ROW EXECUTE FUNCTION public.update_geom_on_coordinates_change();


--
-- Name: lines trig_lines_convert_endpoints; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trig_lines_convert_endpoints BEFORE INSERT OR UPDATE ON public.lines FOR EACH ROW EXECUTE FUNCTION public.convert_line_endpoints_to_path();


--
-- Name: lines trig_lines_update_geom; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trig_lines_update_geom BEFORE INSERT OR UPDATE ON public.lines FOR EACH ROW EXECUTE FUNCTION public.update_line_geom_from_path();


--
-- Name: power_transformers trig_power_transformers_geom; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trig_power_transformers_geom BEFORE INSERT OR UPDATE OF latitude, longitude ON public.power_transformers FOR EACH ROW EXECUTE FUNCTION public.update_geom_on_coordinates_change();


--
-- Name: transformers trig_transformers_geom; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trig_transformers_geom BEFORE INSERT OR UPDATE OF latitude, longitude ON public.transformers FOR EACH ROW WHEN (((new.latitude IS NOT NULL) AND (new.longitude IS NOT NULL))) EXECUTE FUNCTION public.update_transformers_geom();


--
-- Name: metrics trig_update_heartbeat; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trig_update_heartbeat AFTER INSERT ON public.metrics FOR EACH ROW EXECUTE FUNCTION public.update_controller_heartbeat();


--
-- Name: water_lines trig_water_lines_geom_from_coordinates; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trig_water_lines_geom_from_coordinates BEFORE INSERT OR UPDATE OF latitude_start, longitude_start, latitude_end, longitude_end ON public.water_lines FOR EACH ROW EXECUTE FUNCTION public.update_water_lines_geom_from_coordinates();


--
-- Name: lines trigger_lines_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_lines_updated_at BEFORE UPDATE ON public.lines FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: transformers trigger_transformers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_transformers_updated_at BEFORE UPDATE ON public.transformers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: water_lines trigger_water_lines_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_water_lines_updated_at BEFORE UPDATE ON public.water_lines FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: water_measurement_points trigger_water_measurement_points_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_water_measurement_points_updated_at BEFORE UPDATE ON public.water_measurement_points FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: water_suppliers trigger_water_suppliers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_water_suppliers_updated_at BEFORE UPDATE ON public.water_suppliers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: alerts alerts_alert_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_alert_type_id_fkey FOREIGN KEY (alert_type_id) REFERENCES public.alert_types(alert_type_id);


--
-- Name: controllers controllers_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controllers
    ADD CONSTRAINT controllers_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(building_id);


--
-- Name: buildings fk_buildings_backup_line; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buildings
    ADD CONSTRAINT fk_buildings_backup_line FOREIGN KEY (backup_line_id) REFERENCES public.lines(line_id);


--
-- Name: buildings fk_buildings_backup_transformer; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buildings
    ADD CONSTRAINT fk_buildings_backup_transformer FOREIGN KEY (backup_transformer_id) REFERENCES public.transformers(transformer_id);


--
-- Name: buildings fk_buildings_cold_water_line; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buildings
    ADD CONSTRAINT fk_buildings_cold_water_line FOREIGN KEY (cold_water_line_id) REFERENCES public.water_lines(line_id);


--
-- Name: buildings fk_buildings_cold_water_source; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buildings
    ADD CONSTRAINT fk_buildings_cold_water_source FOREIGN KEY (cold_water_source_id) REFERENCES public.cold_water_sources(id);


--
-- Name: buildings fk_buildings_cold_water_supplier; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buildings
    ADD CONSTRAINT fk_buildings_cold_water_supplier FOREIGN KEY (cold_water_supplier_id) REFERENCES public.water_suppliers(supplier_id);


--
-- Name: buildings fk_buildings_heat_source; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buildings
    ADD CONSTRAINT fk_buildings_heat_source FOREIGN KEY (heat_source_id) REFERENCES public.heat_sources(id);


--
-- Name: buildings fk_buildings_hot_water_line; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buildings
    ADD CONSTRAINT fk_buildings_hot_water_line FOREIGN KEY (hot_water_line_id) REFERENCES public.water_lines(line_id);


--
-- Name: buildings fk_buildings_hot_water_supplier; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buildings
    ADD CONSTRAINT fk_buildings_hot_water_supplier FOREIGN KEY (hot_water_supplier_id) REFERENCES public.water_suppliers(supplier_id);


--
-- Name: buildings fk_buildings_power_transformer; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buildings
    ADD CONSTRAINT fk_buildings_power_transformer FOREIGN KEY (power_transformer_id) REFERENCES public.power_transformers(id);


--
-- Name: buildings fk_buildings_primary_line; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buildings
    ADD CONSTRAINT fk_buildings_primary_line FOREIGN KEY (primary_line_id) REFERENCES public.lines(line_id);


--
-- Name: buildings fk_buildings_primary_transformer; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buildings
    ADD CONSTRAINT fk_buildings_primary_transformer FOREIGN KEY (primary_transformer_id) REFERENCES public.transformers(transformer_id);


--
-- Name: infrastructure_alerts infrastructure_alerts_acknowledged_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.infrastructure_alerts
    ADD CONSTRAINT infrastructure_alerts_acknowledged_by_fkey FOREIGN KEY (acknowledged_by) REFERENCES public.users(user_id);


--
-- Name: infrastructure_alerts infrastructure_alerts_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.infrastructure_alerts
    ADD CONSTRAINT infrastructure_alerts_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(user_id);


--
-- Name: lines lines_transformer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lines
    ADD CONSTRAINT lines_transformer_id_fkey FOREIGN KEY (transformer_id) REFERENCES public.transformers(transformer_id) ON DELETE CASCADE;


--
-- Name: metrics metrics_controller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.metrics
    ADD CONSTRAINT metrics_controller_id_fkey FOREIGN KEY (controller_id) REFERENCES public.controllers(controller_id);


--
-- Name: refresh_tokens refresh_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: water_measurement_points water_measurement_points_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.water_measurement_points
    ADD CONSTRAINT water_measurement_points_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(building_id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

