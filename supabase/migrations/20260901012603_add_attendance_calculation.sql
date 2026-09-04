-- Cálculo derivado de asistencia para eventos explícitos del checador.
-- Los eventos originales siguen siendo append-only; estas tablas se pueden
-- recalcular sin alterar el historial ni la nómina ya emitida.

ALTER TABLE public.attendance_events
    DROP CONSTRAINT attendance_events_direction_chk;

ALTER TABLE public.attendance_events
    ADD CONSTRAINT attendance_events_direction_chk
    CHECK (direction IN ('entry', 'exit', 'break_start', 'break_end'));

COMMENT ON TABLE public.attendance_events IS
    'Registro inmutable de marcajes autorizados explícitos. Solo contiene identificadores operativos y metadatos allowlist; nunca biometría ni payloads crudos.';
COMMENT ON COLUMN public.attendance_events.direction IS
    'Estado explícito enviado por el dispositivo: entry, exit, break_start o break_end. Nunca se infiere por el orden del evento.';

CREATE TABLE public.attendance_policies (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    timezone TEXT NOT NULL DEFAULT 'America/Chihuahua'
        CHECK (char_length(timezone) BETWEEN 1 AND 64),
    max_shift_minutes INTEGER NOT NULL DEFAULT 960
        CHECK (max_shift_minutes BETWEEN 60 AND 1440),
    calculation_version INTEGER NOT NULL DEFAULT 1
        CHECK (calculation_version > 0),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

INSERT INTO public.attendance_policies (id)
VALUES (TRUE);

COMMENT ON TABLE public.attendance_policies IS
    'Defaults seguros del cálculo. No define horas de turno; cada horario se captura explícitamente.';

CREATE TRIGGER attendance_policies_set_updated_at
    BEFORE UPDATE ON public.attendance_policies
    FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.attendance_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    timezone TEXT NOT NULL DEFAULT 'America/Chihuahua'
        CHECK (char_length(timezone) BETWEEN 1 AND 64),
    start_time TIME WITHOUT TIME ZONE NOT NULL,
    end_time TIME WITHOUT TIME ZONE NOT NULL,
    work_days SMALLINT[] NOT NULL
        CHECK (
            cardinality(work_days) BETWEEN 1 AND 7
            AND work_days <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::SMALLINT[]
        ),
    late_tolerance_minutes INTEGER NOT NULL DEFAULT 5
        CHECK (late_tolerance_minutes BETWEEN 0 AND 240),
    early_departure_tolerance_minutes INTEGER NOT NULL DEFAULT 5
        CHECK (early_departure_tolerance_minutes BETWEEN 0 AND 240),
    overtime_threshold_minutes INTEGER NOT NULL DEFAULT 30
        CHECK (overtime_threshold_minutes BETWEEN 0 AND 480),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.attendance_schedules IS
    'Turnos explícitos para empleados no-horarios. end_time <= start_time representa un turno nocturno.';
COMMENT ON COLUMN public.attendance_schedules.work_days IS
    'Días ISO compatibles con JavaScript: 0=domingo, 1=lunes, ..., 6=sábado.';

CREATE TRIGGER attendance_schedules_set_updated_at
    BEFORE UPDATE ON public.attendance_schedules
    FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.employee_attendance_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
    schedule_id UUID NOT NULL REFERENCES public.attendance_schedules(id) ON DELETE RESTRICT,
    effective_from DATE NOT NULL,
    effective_to DATE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT employee_attendance_schedules_dates_chk
        CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CONSTRAINT employee_attendance_schedules_start_key
        UNIQUE (employee_id, effective_from)
);

CREATE UNIQUE INDEX employee_attendance_schedules_open_idx
    ON public.employee_attendance_schedules (employee_id)
    WHERE effective_to IS NULL;
CREATE INDEX employee_attendance_schedules_lookup_idx
    ON public.employee_attendance_schedules (employee_id, effective_from, effective_to);

COMMENT ON TABLE public.employee_attendance_schedules IS
    'Asignación efectiva de turno. La app trata asignaciones solapadas como incidencia y no inventa un turno.';

CREATE TABLE public.attendance_daily_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
    work_date DATE NOT NULL,
    attendance_class TEXT NOT NULL
        CHECK (attendance_class IN ('hourly', 'scheduled')),
    payment_type TEXT NOT NULL CHECK (char_length(payment_type) BETWEEN 1 AND 32),
    schedule_id UUID REFERENCES public.attendance_schedules(id) ON DELETE RESTRICT,
    scheduled_start_at TIMESTAMP WITH TIME ZONE,
    scheduled_end_at TIMESTAMP WITH TIME ZONE,
    first_entry_at TIMESTAMP WITH TIME ZONE,
    last_exit_at TIMESTAMP WITH TIME ZONE,
    worked_minutes INTEGER NOT NULL DEFAULT 0 CHECK (worked_minutes >= 0),
    break_minutes INTEGER NOT NULL DEFAULT 0 CHECK (break_minutes >= 0),
    payable_minutes INTEGER NOT NULL DEFAULT 0 CHECK (payable_minutes >= 0),
    hourly_rate NUMERIC(12, 2) CHECK (hourly_rate IS NULL OR hourly_rate >= 0),
    estimated_amount NUMERIC(14, 2) CHECK (estimated_amount IS NULL OR estimated_amount >= 0),
    late_minutes INTEGER NOT NULL DEFAULT 0 CHECK (late_minutes >= 0),
    early_departure_minutes INTEGER NOT NULL DEFAULT 0 CHECK (early_departure_minutes >= 0),
    overtime_minutes INTEGER NOT NULL DEFAULT 0 CHECK (overtime_minutes >= 0),
    status TEXT NOT NULL
        CHECK (status IN ('pending', 'complete', 'incomplete', 'absent', 'review_required')),
    incidents TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    source_event_count INTEGER NOT NULL DEFAULT 0 CHECK (source_event_count >= 0),
    calculation_version INTEGER NOT NULL DEFAULT 1 CHECK (calculation_version > 0),
    calculated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT attendance_daily_summaries_employee_date_key UNIQUE (employee_id, work_date),
    CONSTRAINT attendance_daily_summaries_schedule_times_chk CHECK (
        (scheduled_start_at IS NULL AND scheduled_end_at IS NULL)
        OR (scheduled_start_at IS NOT NULL AND scheduled_end_at IS NOT NULL
            AND scheduled_end_at > scheduled_start_at)
    ),
    CONSTRAINT attendance_daily_summaries_hourly_fields_chk CHECK (
        attendance_class = 'hourly'
        OR (hourly_rate IS NULL AND estimated_amount IS NULL)
    )
);

CREATE INDEX attendance_daily_summaries_date_idx
    ON public.attendance_daily_summaries (work_date DESC, employee_id);
CREATE INDEX attendance_daily_summaries_status_idx
    ON public.attendance_daily_summaries (status, work_date DESC);

COMMENT ON TABLE public.attendance_daily_summaries IS
    'Capa derivada y recalculable. No modifica attendance_events ni descuenta nómina automáticamente.';
COMMENT ON COLUMN public.attendance_daily_summaries.estimated_amount IS
    'Estimación para empleados por hora usando payroll_employees.hourly_rate vigente al recalcular.';
COMMENT ON COLUMN public.attendance_daily_summaries.overtime_minutes IS
    'Tiempo extra detectado; permanece no pagable hasta una aprobación separada.';

CREATE TABLE public.attendance_overtime_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
    work_date DATE NOT NULL,
    attendance_summary_id UUID REFERENCES public.attendance_daily_summaries(id) ON DELETE RESTRICT,
    time_clock_entry_id UUID REFERENCES public.time_clock_entries(id) ON DELETE RESTRICT,
    approved_minutes INTEGER NOT NULL CHECK (approved_minutes > 0),
    approved_by UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
    approved_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    notes TEXT CHECK (notes IS NULL OR char_length(notes) <= 500),
    CONSTRAINT attendance_overtime_approvals_one_source_chk CHECK (
        (attendance_summary_id IS NOT NULL)::INTEGER
        + (time_clock_entry_id IS NOT NULL)::INTEGER = 1
    )
);

CREATE UNIQUE INDEX attendance_overtime_approvals_summary_key
    ON public.attendance_overtime_approvals (attendance_summary_id)
    WHERE attendance_summary_id IS NOT NULL;
CREATE UNIQUE INDEX attendance_overtime_approvals_legacy_key
    ON public.attendance_overtime_approvals (time_clock_entry_id)
    WHERE time_clock_entry_id IS NOT NULL;
CREATE INDEX attendance_overtime_approvals_employee_date_idx
    ON public.attendance_overtime_approvals (employee_id, work_date);

COMMENT ON TABLE public.attendance_overtime_approvals IS
    'Autorización humana explícita de horas extra. Detectar overtime nunca crea pago por sí mismo.';

-- Todas las tablas nuevas se consumen exclusivamente por rutas server-only.
-- La app ya autentica y autoriza esas rutas antes de usar la llave privilegiada.
ALTER TABLE public.attendance_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_attendance_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_daily_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_overtime_approvals ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.attendance_policies FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.attendance_schedules FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.employee_attendance_schedules FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.attendance_daily_summaries FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.attendance_overtime_approvals FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, UPDATE ON TABLE public.attendance_policies TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.attendance_schedules TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.employee_attendance_schedules TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.attendance_daily_summaries TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.attendance_overtime_approvals TO service_role;
