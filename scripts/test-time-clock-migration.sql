\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
ALTER ROLE service_role BYPASSRLS;

CREATE TABLE public.employees (
    id UUID PRIMARY KEY,
    full_name TEXT NOT NULL
);

CREATE TABLE public.payroll_employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID UNIQUE REFERENCES public.employees(id),
    code TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE public.time_clock_uploads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_name TEXT NOT NULL,
    file_url TEXT NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    format TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    rows_total INTEGER DEFAULT 0,
    rows_parsed INTEGER DEFAULT 0,
    rows_unmatched INTEGER DEFAULT 0,
    error_message TEXT,
    uploaded_at TIMESTAMPTZ DEFAULT NOW(),
    parsed_at TIMESTAMPTZ
);

CREATE TABLE public.time_clock_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    upload_id UUID NOT NULL REFERENCES public.time_clock_uploads(id) ON DELETE CASCADE,
    employee_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    employee_code_raw TEXT,
    work_date DATE NOT NULL,
    check_in TIMESTAMPTZ,
    check_out TIMESTAMPTZ,
    hours_worked NUMERIC(6,2) DEFAULT 0,
    overtime_hours NUMERIC(6,2) DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.time_clock_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_clock_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on time_clock_uploads" ON public.time_clock_uploads FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on time_clock_entries" ON public.time_clock_entries FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON public.time_clock_uploads, public.time_clock_entries TO anon, authenticated, service_role;

\ir ../supabase/migrations/20260903175207_redesign_time_clock_imports.sql

INSERT INTO public.employees (id, full_name)
VALUES ('00000000-0000-0000-0000-000000000001', 'Empleado de prueba');
INSERT INTO public.payroll_employees (employee_id, code, status)
VALUES ('00000000-0000-0000-0000-000000000001', 'EMP001', 'active');

SET ROLE service_role;

SELECT public.apply_time_clock_import(
    'primera.xlsx', 'xlsx', repeat('a', 64), 'deterministic', 1, 0,
    '00000000-0000-0000-0000-000000000001',
    '[{"employee_id":"00000000-0000-0000-0000-000000000001","employee_code":"EMP001","work_date":"2026-09-01","check_in":"08:00:00","check_out":""}]'::jsonb
);

SELECT public.apply_time_clock_import(
    'segunda.xlsx', 'xlsx', repeat('b', 64), 'deterministic', 1, 0,
    '00000000-0000-0000-0000-000000000001',
    '[{"employee_id":"00000000-0000-0000-0000-000000000001","employee_code":"EMP001","work_date":"2026-09-01","check_in":"","check_out":"17:00:00"}]'::jsonb
);

DO $$
DECLARE
    v_record public.time_clock_daily_records%ROWTYPE;
BEGIN
    SELECT * INTO v_record FROM public.time_clock_daily_records;
    IF v_record.check_in <> '08:00:00'::TIME OR v_record.check_out <> '17:00:00'::TIME THEN
        RAISE EXCEPTION 'La segunda carga no completo la jornada.';
    END IF;
    IF v_record.worked_minutes <> 540 THEN
        RAISE EXCEPTION 'El total generado no coincide: %', v_record.worked_minutes;
    END IF;
END $$;

-- Un checksum repetido no crea otra carga ni otra jornada.
SELECT public.apply_time_clock_import(
    'segunda.xlsx', 'xlsx', repeat('b', 64), 'deterministic', 1, 0,
    '00000000-0000-0000-0000-000000000001',
    '[{"employee_id":"00000000-0000-0000-0000-000000000001","employee_code":"EMP001","work_date":"2026-09-01","check_in":"","check_out":"17:00:00"}]'::jsonb
);

-- Una hora distinta se reporta, pero no pisa el valor existente.
SELECT public.apply_time_clock_import(
    'conflicto.xlsx', 'xlsx', repeat('c', 64), 'deterministic', 1, 0,
    '00000000-0000-0000-0000-000000000001',
    '[{"employee_id":"00000000-0000-0000-0000-000000000001","employee_code":"EMP001","work_date":"2026-09-01","check_in":"08:15:00","check_out":"17:00:00"}]'::jsonb
);

RESET ROLE;

DO $$
BEGIN
    IF (SELECT COUNT(*) FROM public.time_clock_daily_records) <> 1 THEN
        RAISE EXCEPTION 'La idempotencia por empleado/fecha fallo.';
    END IF;
    IF (SELECT check_in FROM public.time_clock_daily_records) <> '08:00:00'::TIME THEN
        RAISE EXCEPTION 'Un conflicto sobrescribio la entrada.';
    END IF;
    IF (SELECT rows_conflicted FROM public.time_clock_uploads WHERE source_checksum = repeat('c', 64)) <> 1 THEN
        RAISE EXCEPTION 'El conflicto no quedo contabilizado.';
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.time_clock_daily_records'::regclass) THEN
        RAISE EXCEPTION 'RLS no esta habilitado.';
    END IF;
    IF has_table_privilege('anon', 'public.time_clock_daily_records', 'SELECT')
       OR has_table_privilege('authenticated', 'public.time_clock_daily_records', 'INSERT') THEN
        RAISE EXCEPTION 'Los roles de navegador conservan privilegios.';
    END IF;
    IF NOT has_table_privilege('service_role', 'public.time_clock_daily_records', 'SELECT')
       OR NOT has_function_privilege(
            'service_role',
            'public.apply_time_clock_import(text,text,text,text,integer,integer,uuid,jsonb)',
            'EXECUTE'
       ) THEN
        RAISE EXCEPTION 'Faltan privilegios server-only.';
    END IF;
END $$;

SELECT 'Time clock migration tests: OK' AS result;
