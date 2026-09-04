-- Eventos normalizados del checador facial Hikvision.
-- No se almacenan imágenes, plantillas faciales, payloads crudos ni credenciales.
CREATE TABLE public.attendance_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id TEXT NOT NULL,
    employee_external_no TEXT NOT NULL,
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
    direction TEXT NOT NULL DEFAULT 'entry',
    event_serial TEXT NOT NULL,
    event_type TEXT NOT NULL DEFAULT 'AccessControllerEvent',
    major_event_type SMALLINT NOT NULL,
    sub_event_type SMALLINT NOT NULL,
    event_state TEXT,
    verification_mode TEXT,
    attendance_status TEXT,
    status_value INTEGER,
    active_post_count INTEGER,
    received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT attendance_events_device_id_chk
        CHECK (char_length(device_id) BETWEEN 1 AND 128),
    CONSTRAINT attendance_events_employee_external_no_chk
        CHECK (char_length(employee_external_no) BETWEEN 1 AND 64),
    CONSTRAINT attendance_events_direction_chk
        CHECK (direction = 'entry'),
    CONSTRAINT attendance_events_serial_chk
        CHECK (event_serial ~ '^[0-9]{1,32}$'),
    CONSTRAINT attendance_events_type_chk
        CHECK (event_type = 'AccessControllerEvent'),
    CONSTRAINT attendance_events_face_pass_chk
        CHECK (major_event_type = 5 AND sub_event_type = 75),
    CONSTRAINT attendance_events_state_chk
        CHECK (event_state IS NULL OR event_state = 'active'),
    CONSTRAINT attendance_events_verification_mode_chk
        CHECK (verification_mode IS NULL OR char_length(verification_mode) <= 64),
    CONSTRAINT attendance_events_attendance_status_chk
        CHECK (attendance_status IS NULL OR char_length(attendance_status) <= 64),
    CONSTRAINT attendance_events_active_post_count_chk
        CHECK (active_post_count IS NULL OR active_post_count >= 0),
    CONSTRAINT attendance_events_device_serial_key
        UNIQUE (device_id, event_serial)
);

CREATE INDEX attendance_events_employee_occurred_idx
    ON public.attendance_events (employee_id, occurred_at DESC);
CREATE INDEX attendance_events_occurred_idx
    ON public.attendance_events (occurred_at DESC);

COMMENT ON TABLE public.attendance_events IS
    'Registro inmutable de entradas autorizadas. Solo contiene identificadores operativos y metadatos allowlist; nunca biometría ni payloads crudos.';
COMMENT ON COLUMN public.attendance_events.employee_external_no IS
    'Número recibido como employeeNoString y resuelto contra payroll_employees.code.';
COMMENT ON COLUMN public.attendance_events.event_serial IS
    'serialNo del evento; junto con device_id forma la clave de idempotencia.';

-- Defensa adicional de append-only: incluso una sesión con privilegios de
-- escritura no puede alterar ni borrar el historial por accidente.
CREATE FUNCTION public.prevent_attendance_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'attendance_events es append-only'
        USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER attendance_events_prevent_mutation
    BEFORE UPDATE OR DELETE ON public.attendance_events
    FOR EACH ROW EXECUTE FUNCTION public.prevent_attendance_event_mutation();

REVOKE ALL ON FUNCTION public.prevent_attendance_event_mutation()
    FROM PUBLIC, anon, authenticated, service_role;

-- La app usa autenticación propia. Esta tabla solo se alcanza desde rutas
-- server-only previamente autorizadas; el navegador no recibe permisos directos.
ALTER TABLE public.attendance_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.attendance_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.attendance_events TO service_role;
