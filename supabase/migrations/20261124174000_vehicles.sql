-- =====================================================
-- EXPEDIENTE DE VEHÍCULOS
--
-- Por vehículo: datos generales, fotos, documentos con vigencia (seguro /
-- póliza, tarjeta de circulación, verificación, tenencia, factura…),
-- servicios de mantenimiento (aceite, filtros, frenos, llantas…) y gastos.
--
-- Pólizas y tarjetas de circulación traen datos de la empresa: los archivos
-- van al bucket PRIVADO vehicle_files y las tablas sólo se leen y escriben
-- desde el servidor (service_role) después de validar permisos del módulo
-- `vehicles`. Todo cambio queda en la bitácora (audit_log, raíz vehicles).
-- =====================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.vehicles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    alias text NOT NULL CHECK (length(btrim(alias)) > 0),
    brand text,
    model text,
    year integer CHECK (year IS NULL OR year BETWEEN 1950 AND 2100),
    plates text,
    vin text,
    engine_number text,
    color text,
    fuel_type text,
    odometer_km integer CHECK (odometer_km IS NULL OR odometer_km >= 0),
    odometer_updated_at timestamptz,
    responsible_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
    cover_file_id uuid,
    oil_interval_km integer NOT NULL DEFAULT 5000 CHECK (oil_interval_km > 0),
    oil_interval_months integer NOT NULL DEFAULT 6 CHECK (oil_interval_months > 0),
    notes text,
    is_active boolean NOT NULL DEFAULT true,
    created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS vehicles_plates_unique ON public.vehicles (upper(btrim(plates)))
    WHERE plates IS NOT NULL AND btrim(plates) <> '' AND is_active;

CREATE TABLE IF NOT EXISTS public.vehicle_files (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('photo', 'document', 'receipt')),
    storage_path text NOT NULL UNIQUE,
    file_name text NOT NULL,
    content_type text,
    file_size bigint,
    caption text,
    uploaded_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
    uploaded_by_name text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vehicle_files_vehicle_idx ON public.vehicle_files (vehicle_id, created_at DESC);
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicles_cover_file_fkey') THEN
        ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_cover_file_fkey
            FOREIGN KEY (cover_file_id) REFERENCES public.vehicle_files(id) ON DELETE SET NULL;
    END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.vehicle_documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
    doc_type text NOT NULL CHECK (doc_type IN ('seguro', 'tarjeta_circulacion', 'verificacion', 'tenencia', 'factura', 'permiso', 'otro')),
    title text,
    provider text,
    document_number text,
    coverage text,
    issued_at date,
    expires_at date,
    cost numeric(14,2) CHECK (cost IS NULL OR cost >= 0),
    file_id uuid REFERENCES public.vehicle_files(id) ON DELETE SET NULL,
    notes text,
    created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
    created_by_name text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (expires_at IS NULL OR issued_at IS NULL OR expires_at >= issued_at)
);
CREATE INDEX IF NOT EXISTS vehicle_documents_vehicle_idx ON public.vehicle_documents (vehicle_id, doc_type, expires_at DESC);

CREATE TABLE IF NOT EXISTS public.vehicle_services (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
    service_date date NOT NULL DEFAULT current_date,
    odometer_km integer CHECK (odometer_km IS NULL OR odometer_km >= 0),
    items text[] NOT NULL DEFAULT '{}',
    description text,
    workshop text,
    cost numeric(14,2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
    next_service_date date,
    next_service_km integer CHECK (next_service_km IS NULL OR next_service_km >= 0),
    file_id uuid REFERENCES public.vehicle_files(id) ON DELETE SET NULL,
    created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
    created_by_name text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (cardinality(items) > 0 OR nullif(btrim(description), '') IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS vehicle_services_vehicle_idx ON public.vehicle_services (vehicle_id, service_date DESC);

CREATE TABLE IF NOT EXISTS public.vehicle_expenses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
    expense_date date NOT NULL DEFAULT current_date,
    category text NOT NULL CHECK (category IN ('combustible', 'casetas', 'estacionamiento', 'lavado', 'reparacion', 'refacciones',
        'llantas', 'multa', 'tenencia', 'verificacion', 'seguro', 'otro')),
    amount numeric(14,2) NOT NULL CHECK (amount > 0),
    odometer_km integer CHECK (odometer_km IS NULL OR odometer_km >= 0),
    liters numeric(10,2) CHECK (liters IS NULL OR liters > 0),
    description text,
    file_id uuid REFERENCES public.vehicle_files(id) ON DELETE SET NULL,
    created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
    created_by_name text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vehicle_expenses_vehicle_idx ON public.vehicle_expenses (vehicle_id, expense_date DESC);

-- El odómetro del vehículo avanza con cada servicio o gasto que lo registre.
CREATE OR REPLACE FUNCTION public.vehicle_bump_odometer() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
    IF NEW.odometer_km IS NOT NULL THEN
        UPDATE public.vehicles SET odometer_km = NEW.odometer_km, odometer_updated_at = now()
         WHERE id = NEW.vehicle_id AND (odometer_km IS NULL OR odometer_km < NEW.odometer_km);
    END IF;
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_vehicle_services_odometer ON public.vehicle_services;
CREATE TRIGGER trg_vehicle_services_odometer AFTER INSERT OR UPDATE OF odometer_km ON public.vehicle_services
FOR EACH ROW EXECUTE FUNCTION public.vehicle_bump_odometer();
DROP TRIGGER IF EXISTS trg_vehicle_expenses_odometer ON public.vehicle_expenses;
CREATE TRIGGER trg_vehicle_expenses_odometer AFTER INSERT OR UPDATE OF odometer_km ON public.vehicle_expenses
FOR EACH ROW EXECUTE FUNCTION public.vehicle_bump_odometer();

DO $$
DECLARE v_table text;
BEGIN
    FOREACH v_table IN ARRAY ARRAY['vehicles', 'vehicle_files', 'vehicle_documents', 'vehicle_services', 'vehicle_expenses'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
        EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', v_table);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', v_table);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table || '_server', v_table);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', v_table || '_server', v_table);
    END LOOP;
    PERFORM public.smaa_attach_audit('vehicles', 'vehicles', 'id');
    PERFORM public.smaa_attach_audit('vehicle_documents', 'vehicles', 'vehicle_id');
    PERFORM public.smaa_attach_audit('vehicle_services', 'vehicles', 'vehicle_id');
    PERFORM public.smaa_attach_audit('vehicle_expenses', 'vehicles', 'vehicle_id');
    PERFORM public.smaa_attach_audit('vehicle_files', 'vehicles', 'vehicle_id');
END;
$$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('vehicle_files', 'vehicle_files', false, 26214400,
        ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
ON CONFLICT (id) DO UPDATE SET public = false;
DROP POLICY IF EXISTS "Public read vehicle_files" ON storage.objects;
DROP POLICY IF EXISTS "Anon insert vehicle_files" ON storage.objects;

-- -----------------------------------------------------
-- Avisos programados (vencimientos y servicios). Se ejecuta a lo más una vez
-- por hora, cuando alguien consulta sus notificaciones.
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_jobs (
    job text PRIMARY KEY,
    last_run_at timestamptz NOT NULL DEFAULT '-infinity'
);
ALTER TABLE public.notification_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.notification_jobs TO service_role;
DROP POLICY IF EXISTS notification_jobs_server ON public.notification_jobs;
CREATE POLICY notification_jobs_server ON public.notification_jobs FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.vehicle_document_label(p_type text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE p_type
        WHEN 'seguro' THEN 'Seguro'
        WHEN 'tarjeta_circulacion' THEN 'Tarjeta de circulación'
        WHEN 'verificacion' THEN 'Verificación'
        WHEN 'tenencia' THEN 'Tenencia / refrendo'
        WHEN 'factura' THEN 'Factura'
        WHEN 'permiso' THEN 'Permiso'
        ELSE 'Documento' END
$$;

CREATE OR REPLACE FUNCTION public.smaa_generate_scheduled_notifications(p_force boolean DEFAULT false) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_last timestamptz; v_count integer := 0; v_rows integer;
BEGIN
    INSERT INTO public.notification_jobs (job) VALUES ('vehicles') ON CONFLICT (job) DO NOTHING;
    SELECT last_run_at INTO v_last FROM public.notification_jobs WHERE job = 'vehicles' FOR UPDATE;
    IF NOT p_force AND v_last > now() - interval '1 hour' THEN RETURN 0; END IF;
    UPDATE public.notification_jobs SET last_run_at = now() WHERE job = 'vehicles';

    -- Documentos vencidos o por vencer en 30 días (si no hay uno más reciente del mismo tipo).
    INSERT INTO public.notifications (module_code, event, title, body, link, entity_table, entity_id, dedupe_key)
    SELECT 'vehicles', 'vehicle.document_expiring',
           CASE WHEN d.expires_at < current_date THEN 'Vencido: ' ELSE 'Por vencer: ' END
               || public.vehicle_document_label(d.doc_type) || ' de ' || v.alias,
           concat_ws(' · ', nullif(v.plates, ''), d.provider, 'vence el ' || to_char(d.expires_at, 'DD/MM/YYYY')),
           '/vehicles/' || v.id, 'vehicle_documents', d.id::text,
           'vehdoc:' || d.id || ':' || CASE WHEN d.expires_at < current_date THEN 'vencido' ELSE 'proximo' END
      FROM public.vehicle_documents d
      JOIN public.vehicles v ON v.id = d.vehicle_id AND v.is_active
     WHERE d.expires_at IS NOT NULL AND d.expires_at <= current_date + 30
       AND NOT EXISTS (SELECT 1 FROM public.vehicle_documents n
                        WHERE n.vehicle_id = d.vehicle_id AND n.doc_type = d.doc_type AND n.id <> d.id
                          AND coalesce(n.expires_at, 'infinity'::date) > d.expires_at)
    ON CONFLICT (dedupe_key) DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT; v_count := v_count + v_rows;

    -- Cambio de aceite: próximo según el último servicio con aceite (o el intervalo del vehículo).
    INSERT INTO public.notifications (module_code, event, title, body, link, entity_table, entity_id, dedupe_key)
    SELECT 'vehicles', 'vehicle.service_due', 'Toca cambio de aceite: ' || v.alias,
           concat_ws(' · ', nullif(v.plates, ''),
               'Último: ' || to_char(s.service_date, 'DD/MM/YYYY') || coalesce(' a ' || to_char(s.odometer_km, 'FM999,999,999') || ' km', ''),
               'Próximo: ' || to_char(coalesce(s.next_service_date, (s.service_date + make_interval(months => v.oil_interval_months))::date), 'DD/MM/YYYY')
                   || coalesce(' o ' || to_char(coalesce(s.next_service_km, s.odometer_km + v.oil_interval_km), 'FM999,999,999') || ' km', '')),
           '/vehicles/' || v.id, 'vehicle_services', s.id::text, 'vehsvc:' || s.id
      FROM public.vehicles v
      JOIN LATERAL (SELECT * FROM public.vehicle_services x WHERE x.vehicle_id = v.id AND 'aceite' = ANY(x.items)
                     ORDER BY x.service_date DESC, x.created_at DESC LIMIT 1) s ON true
     WHERE v.is_active
       AND (coalesce(s.next_service_date, (s.service_date + make_interval(months => v.oil_interval_months))::date) <= current_date + 7
            OR (v.odometer_km IS NOT NULL AND coalesce(s.next_service_km, s.odometer_km + v.oil_interval_km) <= v.odometer_km + 300))
    ON CONFLICT (dedupe_key) DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT; v_count := v_count + v_rows;
    RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.smaa_generate_scheduled_notifications(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.smaa_generate_scheduled_notifications(boolean) TO service_role;

COMMIT;
