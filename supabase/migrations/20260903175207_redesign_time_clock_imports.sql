-- Importacion semanal del archivo del checador.
--
-- time_clock_uploads conserva solamente la bitacora de cada procesamiento.
-- El archivo crudo no se guarda y time_clock_daily_records mantiene una sola
-- jornada canonica por empleado/fecha. Una carga posterior solo puede llenar
-- valores faltantes; los conflictos se reportan y no pisan datos existentes.

ALTER TABLE public.time_clock_uploads
    ALTER COLUMN file_url DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS source_checksum TEXT,
    ADD COLUMN IF NOT EXISTS interpreter TEXT NOT NULL DEFAULT 'deterministic',
    ADD COLUMN IF NOT EXISTS rows_inserted INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS rows_updated INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS rows_unchanged INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS rows_conflicted INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES public.employees(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS time_clock_uploads_source_checksum_key
    ON public.time_clock_uploads (source_checksum)
    WHERE source_checksum IS NOT NULL;

CREATE INDEX IF NOT EXISTS time_clock_uploads_uploaded_by_idx
    ON public.time_clock_uploads (uploaded_by, uploaded_at DESC);

COMMENT ON COLUMN public.time_clock_uploads.file_url IS
    'Compatibilidad historica. Las cargas nuevas no retienen el archivo crudo y dejan este campo en NULL.';
COMMENT ON COLUMN public.time_clock_uploads.source_checksum IS
    'SHA-256 del archivo, usado solamente para hacer idempotente una carga identica.';
COMMENT ON COLUMN public.time_clock_uploads.interpreter IS
    'Interprete que reconocio el formato; la aplicacion valida todos los registros antes de escribir.';

CREATE TABLE IF NOT EXISTS public.time_clock_daily_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
    employee_code TEXT NOT NULL,
    work_date DATE NOT NULL,
    check_in TIME WITHOUT TIME ZONE,
    check_out TIME WITHOUT TIME ZONE,
    worked_minutes INTEGER GENERATED ALWAYS AS (
        CASE
            WHEN check_in IS NULL OR check_out IS NULL THEN 0
            WHEN check_out >= check_in THEN
                FLOOR(EXTRACT(EPOCH FROM (check_out - check_in)) / 60)::INTEGER
            ELSE
                FLOOR(EXTRACT(EPOCH FROM (check_out - check_in)) / 60 + 1440)::INTEGER
        END
    ) STORED,
    first_upload_id UUID NOT NULL REFERENCES public.time_clock_uploads(id) ON DELETE RESTRICT,
    last_upload_id UUID NOT NULL REFERENCES public.time_clock_uploads(id) ON DELETE RESTRICT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT time_clock_daily_records_employee_date_key UNIQUE (employee_id, work_date),
    CONSTRAINT time_clock_daily_records_has_mark_chk CHECK (check_in IS NOT NULL OR check_out IS NOT NULL),
    CONSTRAINT time_clock_daily_records_code_chk CHECK (
        employee_code = BTRIM(employee_code)
        AND employee_code <> ''
        AND LENGTH(employee_code) <= 64
    ),
    CONSTRAINT time_clock_daily_records_duration_chk CHECK (
        check_in IS NULL
        OR check_out IS NULL
        OR CASE
            WHEN check_out >= check_in THEN EXTRACT(EPOCH FROM (check_out - check_in)) / 60 <= 1200
            ELSE EXTRACT(EPOCH FROM (check_out - check_in)) / 60 + 1440 <= 1200
        END
    )
);

CREATE INDEX IF NOT EXISTS time_clock_daily_records_week_idx
    ON public.time_clock_daily_records (work_date, employee_id);
CREATE INDEX IF NOT EXISTS time_clock_daily_records_first_upload_idx
    ON public.time_clock_daily_records (first_upload_id);
CREATE INDEX IF NOT EXISTS time_clock_daily_records_last_upload_idx
    ON public.time_clock_daily_records (last_upload_id);

COMMENT ON TABLE public.time_clock_daily_records IS
    'Jornada diaria canonica proveniente de archivos. Es independiente de attendance_events y puede completarse con cargas posteriores.';
COMMENT ON COLUMN public.time_clock_daily_records.worked_minutes IS
    'Total determinista entre entrada y salida. Es cero mientras falte cualquiera de los dos marcajes.';

-- Conserva datos legados sin modificarlos. Solo migra jornadas que tienen al
-- menos un marcaje; los registros que contenian exclusivamente horas quedan en
-- time_clock_entries para revision historica.
WITH legacy AS (
    SELECT
        t.employee_id,
        t.work_date,
        (ARRAY_AGG(NULLIF(BTRIM(t.employee_code_raw), '') ORDER BY t.created_at DESC)
            FILTER (WHERE NULLIF(BTRIM(t.employee_code_raw), '') IS NOT NULL))[1] AS employee_code,
        MIN(t.check_in::TIME) FILTER (WHERE t.check_in IS NOT NULL) AS check_in,
        MAX(t.check_out::TIME) FILTER (WHERE t.check_out IS NOT NULL) AS check_out,
        (ARRAY_AGG(t.upload_id ORDER BY t.created_at ASC))[1] AS first_upload_id,
        (ARRAY_AGG(t.upload_id ORDER BY t.created_at DESC))[1] AS last_upload_id,
        MIN(t.created_at) AS created_at,
        MAX(t.created_at) AS updated_at
    FROM public.time_clock_entries t
    WHERE t.employee_id IS NOT NULL
      AND (t.check_in IS NOT NULL OR t.check_out IS NOT NULL)
    GROUP BY t.employee_id, t.work_date
)
INSERT INTO public.time_clock_daily_records (
    employee_id,
    employee_code,
    work_date,
    check_in,
    check_out,
    first_upload_id,
    last_upload_id,
    created_at,
    updated_at
)
SELECT
    l.employee_id,
    COALESCE(l.employee_code, pe.code),
    l.work_date,
    l.check_in,
    CASE
        WHEN l.check_in IS NOT NULL AND l.check_out IS NOT NULL
             AND CASE
                WHEN l.check_out >= l.check_in THEN EXTRACT(EPOCH FROM (l.check_out - l.check_in)) / 60
                ELSE EXTRACT(EPOCH FROM (l.check_out - l.check_in)) / 60 + 1440
             END > 1200
        THEN NULL
        ELSE l.check_out
    END,
    l.first_upload_id,
    l.last_upload_id,
    l.created_at,
    l.updated_at
FROM legacy l
JOIN public.payroll_employees pe ON pe.employee_id = l.employee_id
ON CONFLICT (employee_id, work_date) DO NOTHING;

ALTER TABLE public.time_clock_daily_records ENABLE ROW LEVEL SECURITY;

-- Estas tablas contienen informacion laboral. El navegador no lee ni escribe
-- directamente; las rutas del ERP autorizan la sesion y usan la clave secreta.
DROP POLICY IF EXISTS "Allow all on time_clock_uploads" ON public.time_clock_uploads;
DROP POLICY IF EXISTS "Allow all on time_clock_entries" ON public.time_clock_entries;
REVOKE ALL ON TABLE public.time_clock_uploads FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.time_clock_entries FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.time_clock_daily_records FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.time_clock_uploads TO service_role;
GRANT SELECT ON TABLE public.time_clock_entries TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.time_clock_daily_records TO service_role;
GRANT SELECT ON TABLE public.payroll_employees TO service_role;

CREATE OR REPLACE FUNCTION public.apply_time_clock_import(
    p_file_name TEXT,
    p_file_format TEXT,
    p_source_checksum TEXT,
    p_interpreter TEXT,
    p_rows_total INTEGER,
    p_rows_unmatched INTEGER,
    p_uploaded_by UUID,
    p_records JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_upload public.time_clock_uploads%ROWTYPE;
    v_row RECORD;
    v_existing public.time_clock_daily_records%ROWTYPE;
    v_employee_id UUID;
    v_employee_code TEXT;
    v_work_date DATE;
    v_check_in TIME;
    v_check_out TIME;
    v_inserted INTEGER := 0;
    v_updated INTEGER := 0;
    v_unchanged INTEGER := 0;
    v_conflicted INTEGER := 0;
    v_row_changed BOOLEAN;
    v_row_conflicted BOOLEAN;
    v_period_start DATE;
    v_period_end DATE;
BEGIN
    IF p_file_name IS NULL OR BTRIM(p_file_name) = '' OR LENGTH(p_file_name) > 180 THEN
        RAISE EXCEPTION 'invalid_file_name';
    END IF;
    IF p_file_format NOT IN ('xlsx', 'csv', 'txt') THEN
        RAISE EXCEPTION 'invalid_file_format';
    END IF;
    IF p_source_checksum !~ '^[a-f0-9]{64}$' THEN
        RAISE EXCEPTION 'invalid_checksum';
    END IF;
    IF p_interpreter IS NULL OR BTRIM(p_interpreter) = '' OR LENGTH(p_interpreter) > 80 THEN
        RAISE EXCEPTION 'invalid_interpreter';
    END IF;
    IF p_rows_total < 1 OR p_rows_total > 20000 OR p_rows_unmatched < 0 THEN
        RAISE EXCEPTION 'invalid_row_counts';
    END IF;
    IF JSONB_TYPEOF(p_records) <> 'array' OR JSONB_ARRAY_LENGTH(p_records) > 10000 THEN
        RAISE EXCEPTION 'invalid_records';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('time_clock_upload:' || p_source_checksum, 0));

    SELECT * INTO v_upload
    FROM public.time_clock_uploads
    WHERE source_checksum = p_source_checksum;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'upload_id', v_upload.id,
            'already_imported', TRUE,
            'inserted', v_upload.rows_inserted,
            'updated', v_upload.rows_updated,
            'unchanged', v_upload.rows_unchanged,
            'conflicted', v_upload.rows_conflicted
        );
    END IF;

    SELECT MIN((x->>'work_date')::DATE), MAX((x->>'work_date')::DATE)
      INTO v_period_start, v_period_end
      FROM jsonb_array_elements(p_records) x;

    IF v_period_start IS NULL OR v_period_end IS NULL THEN
        RAISE EXCEPTION 'empty_records';
    END IF;

    INSERT INTO public.time_clock_uploads (
        file_name,
        file_url,
        period_start,
        period_end,
        format,
        status,
        rows_total,
        rows_parsed,
        rows_unmatched,
        parsed_at,
        source_checksum,
        interpreter,
        uploaded_by
    ) VALUES (
        p_file_name,
        NULL,
        v_period_start,
        v_period_end,
        p_file_format,
        'parsed',
        p_rows_total,
        JSONB_ARRAY_LENGTH(p_records),
        p_rows_unmatched,
        NOW(),
        p_source_checksum,
        p_interpreter,
        p_uploaded_by
    ) RETURNING * INTO v_upload;

    FOR v_row IN
        SELECT * FROM jsonb_to_recordset(p_records) AS x(
            employee_id TEXT,
            employee_code TEXT,
            work_date TEXT,
            check_in TEXT,
            check_out TEXT
        )
    LOOP
        BEGIN
            v_employee_id := v_row.employee_id::UUID;
            v_employee_code := BTRIM(v_row.employee_code);
            v_work_date := v_row.work_date::DATE;
            v_check_in := NULLIF(v_row.check_in, '')::TIME;
            v_check_out := NULLIF(v_row.check_out, '')::TIME;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'invalid_record';
        END;

        IF v_employee_code IS NULL OR v_employee_code = '' OR LENGTH(v_employee_code) > 64
           OR (v_check_in IS NULL AND v_check_out IS NULL)
           OR NOT EXISTS (
                SELECT 1
                FROM public.payroll_employees pe
                WHERE pe.employee_id = v_employee_id
                  AND pe.code = v_employee_code
                  AND pe.status = 'active'
           ) THEN
            RAISE EXCEPTION 'invalid_employee_record';
        END IF;

        PERFORM pg_advisory_xact_lock(
            hashtextextended('time_clock_day:' || v_employee_id::TEXT || ':' || v_work_date::TEXT, 0)
        );

        SELECT * INTO v_existing
        FROM public.time_clock_daily_records
        WHERE employee_id = v_employee_id AND work_date = v_work_date
        FOR UPDATE;

        IF NOT FOUND THEN
            INSERT INTO public.time_clock_daily_records (
                employee_id, employee_code, work_date, check_in, check_out,
                first_upload_id, last_upload_id
            ) VALUES (
                v_employee_id, v_employee_code, v_work_date, v_check_in, v_check_out,
                v_upload.id, v_upload.id
            );
            v_inserted := v_inserted + 1;
            CONTINUE;
        END IF;

        v_row_changed := (v_existing.check_in IS NULL AND v_check_in IS NOT NULL)
            OR (v_existing.check_out IS NULL AND v_check_out IS NOT NULL);
        v_row_conflicted := (v_existing.check_in IS NOT NULL AND v_check_in IS NOT NULL AND v_existing.check_in <> v_check_in)
            OR (v_existing.check_out IS NOT NULL AND v_check_out IS NOT NULL AND v_existing.check_out <> v_check_out);

        IF v_row_conflicted THEN
            v_conflicted := v_conflicted + 1;
        END IF;

        IF v_row_changed THEN
            UPDATE public.time_clock_daily_records
               SET check_in = COALESCE(check_in, v_check_in),
                   check_out = COALESCE(check_out, v_check_out),
                   last_upload_id = v_upload.id,
                   updated_at = NOW()
             WHERE id = v_existing.id;
            v_updated := v_updated + 1;
        ELSE
            v_unchanged := v_unchanged + 1;
        END IF;
    END LOOP;

    UPDATE public.time_clock_uploads
       SET rows_inserted = v_inserted,
           rows_updated = v_updated,
           rows_unchanged = v_unchanged,
           rows_conflicted = v_conflicted
     WHERE id = v_upload.id;

    RETURN jsonb_build_object(
        'upload_id', v_upload.id,
        'already_imported', FALSE,
        'inserted', v_inserted,
        'updated', v_updated,
        'unchanged', v_unchanged,
        'conflicted', v_conflicted
    );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_time_clock_import(TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, UUID, JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_time_clock_import(TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, UUID, JSONB)
    TO service_role;

COMMENT ON FUNCTION public.apply_time_clock_import(TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, UUID, JSONB) IS
    'Aplica atomica e idempotentemente un archivo normalizado. Solo completa huecos; no sobrescribe marcajes existentes.';
