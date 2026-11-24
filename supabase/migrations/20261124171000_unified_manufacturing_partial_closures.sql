-- =====================================================
-- FABRICACIÓN UNIFICADA + CIERRES PARCIALES + GARANTÍAS/REPARACIONES
--
-- 1) Una sola lista de OT. Cada OT tiene una o varias ETAPAS ordenadas
--    (maquinado, soldadura, automatización, en cualquier combinación).
--    Los permisos por proceso (manufacturing:<sub>) siguen aplicando a cada
--    etapa: el soldador opera la etapa de soldadura.
-- 2) Cantidad de piezas por OT. Cada etapa se cierra por partes: un cierre
--    (work_order_closures) registra cuántas piezas terminó, con firma. Una
--    etapa sólo puede cerrar las piezas que la anterior ya cerró.
--    El cierre de la ÚLTIMA etapa es un lote que va a Calidad; Calidad libera
--    todo o parte del lote (lo rechazado regresa a la última etapa). Entregas
--    se hacen por cantidad, hasta lo liberado.
-- 3) Garantía / reparación = OT nueva ligada a la original (folio de la
--    original + -G1/-R1), con su propio ciclo de etapas, Calidad y entrega.
-- 4) Numeración nueva: OT-00001 (sin prefijo de módulo), continuando la
--    secuencia compartida work_order_folio_seq. Los folios existentes
--    (OT-MAQ-…, OT-SOLD-…, OT-AUTO-…) no cambian.
--
-- Las operaciones son funciones que sólo ejecuta service_role: las llaman
-- acciones del servidor después de validar sesión y permisos.
-- Los registros anteriores se migran: cada OT recibe la etapa de su módulo y,
-- si ya estaba terminada/en Calidad/liberada, un cierre equivalente.
-- =====================================================

BEGIN;

-- -----------------------------------------------------
-- 1) Columnas nuevas
-- -----------------------------------------------------
ALTER TABLE public.work_orders
    ADD COLUMN IF NOT EXISTS quantity numeric(12,2) NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS unit text NOT NULL DEFAULT 'pza',
    ADD COLUMN IF NOT EXISTS order_kind text NOT NULL DEFAULT 'normal',
    ADD COLUMN IF NOT EXISTS parent_work_order_id uuid REFERENCES public.work_orders(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS created_by_name text,
    ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
    ADD COLUMN IF NOT EXISTS cancel_reason text;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_orders_quantity_check' AND conrelid = 'public.work_orders'::regclass) THEN
        ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_quantity_check CHECK (quantity > 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_orders_order_kind_check' AND conrelid = 'public.work_orders'::regclass) THEN
        ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_order_kind_check CHECK (order_kind IN ('normal', 'garantia', 'reparacion'));
    END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS idx_work_orders_parent ON public.work_orders(parent_work_order_id) WHERE parent_work_order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.work_order_stages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
    module_id uuid NOT NULL REFERENCES public.manufacturing_modules(id),
    sequence integer NOT NULL CHECK (sequence > 0),
    status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'In Progress', 'Paused', 'Done')),
    started_at timestamptz,
    paused_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (work_order_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_wo_stages_module ON public.work_order_stages(module_id);

CREATE TABLE IF NOT EXISTS public.work_order_closures (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE RESTRICT,
    stage_id uuid NOT NULL REFERENCES public.work_order_stages(id) ON DELETE RESTRICT,
    sequence_no integer NOT NULL,
    quantity numeric(12,2) NOT NULL CHECK (quantity > 0),
    is_final boolean NOT NULL DEFAULT false,
    qc_status text NOT NULL DEFAULT 'not_required' CHECK (qc_status IN ('not_required', 'pending', 'released', 'rejected')),
    qc_released_qty numeric(12,2) CHECK (qc_released_qty IS NULL OR qc_released_qty >= 0),
    qc_rejected_qty numeric(12,2) CHECK (qc_rejected_qty IS NULL OR qc_rejected_qty >= 0),
    operator_name text NOT NULL,
    closed_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
    signature_url text,
    notes text,
    closed_at timestamptz NOT NULL DEFAULT now(),
    qc_decided_at timestamptz,
    qc_decided_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
    qc_decided_by_name text,
    qc_signature_url text,
    qc_comments text,
    CONSTRAINT work_order_closures_qc_split CHECK (coalesce(qc_released_qty, 0) + coalesce(qc_rejected_qty, 0) <= quantity)
);
CREATE INDEX IF NOT EXISTS idx_wo_closures_order ON public.work_order_closures(work_order_id, closed_at);
CREATE INDEX IF NOT EXISTS idx_wo_closures_stage ON public.work_order_closures(stage_id);
CREATE INDEX IF NOT EXISTS idx_wo_closures_pending_qc ON public.work_order_closures(closed_at) WHERE qc_status = 'pending';

ALTER TABLE public.deliveries ADD COLUMN IF NOT EXISTS quantity numeric(12,2);
ALTER TABLE public.work_order_pauses ADD COLUMN IF NOT EXISTS stage_id uuid REFERENCES public.work_order_stages(id) ON DELETE SET NULL;
ALTER TABLE public.work_order_completion_photos
    ADD COLUMN IF NOT EXISTS stage_id uuid REFERENCES public.work_order_stages(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS closure_id uuid REFERENCES public.work_order_closures(id) ON DELETE SET NULL;
ALTER TABLE public.work_order_qc_records
    ADD COLUMN IF NOT EXISTS closure_id uuid REFERENCES public.work_order_closures(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS released_qty numeric(12,2),
    ADD COLUMN IF NOT EXISTS rejected_qty numeric(12,2);
ALTER TABLE public.work_order_warranty_events
    ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'garantia',
    ADD COLUMN IF NOT EXISTS quantity numeric(12,2),
    ADD COLUMN IF NOT EXISTS child_work_order_id uuid REFERENCES public.work_orders(id) ON DELETE RESTRICT;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_order_warranty_events_kind_check') THEN
        ALTER TABLE public.work_order_warranty_events ADD CONSTRAINT work_order_warranty_events_kind_check CHECK (kind IN ('garantia', 'reparacion'));
    END IF;
END;
$$;

ALTER TABLE public.work_order_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_closures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read work_order_stages" ON public.work_order_stages;
CREATE POLICY "Allow read work_order_stages" ON public.work_order_stages FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow read work_order_closures" ON public.work_order_closures;
CREATE POLICY "Allow read work_order_closures" ON public.work_order_closures FOR SELECT USING (true);
-- Las escrituras van por las funciones de abajo (service_role).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.work_order_stages, public.work_order_closures FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.work_order_stages, public.work_order_closures TO anon, authenticated;
GRANT ALL ON public.work_order_stages, public.work_order_closures TO service_role;
DROP POLICY IF EXISTS "Server writes work_order_stages" ON public.work_order_stages;
CREATE POLICY "Server writes work_order_stages" ON public.work_order_stages FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Server writes work_order_closures" ON public.work_order_closures;
CREATE POLICY "Server writes work_order_closures" ON public.work_order_closures FOR ALL TO service_role USING (true) WITH CHECK (true);

-- -----------------------------------------------------
-- 3) Folios: OT-00001 para las nuevas; garantía/reparación = folio original + -G#/-R#
-- -----------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.work_order_folio_seq;
DO $$
DECLARE v_max bigint; v_seq record;
BEGIN
    SELECT last_value, is_called INTO v_seq FROM public.work_order_folio_seq;
    SELECT greatest(coalesce(max(substring(order_number from '^OT-(?:MAQ-|SOLD-|AUTO-|OT-)?([0-9]+)$')::bigint), 0),
                    CASE WHEN v_seq.is_called THEN v_seq.last_value ELSE 0 END)
      INTO v_max FROM public.work_orders;
    IF v_max > 0 THEN PERFORM setval('public.work_order_folio_seq', v_max, true); END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_work_order_folio() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_parent text; v_suffix text; n integer; folio text;
BEGIN
    IF NEW.order_number IS NULL OR btrim(NEW.order_number) = '' THEN
        IF NEW.parent_work_order_id IS NOT NULL AND NEW.order_kind IN ('garantia', 'reparacion') THEN
            SELECT order_number INTO v_parent FROM public.work_orders WHERE id = NEW.parent_work_order_id;
            v_suffix := CASE NEW.order_kind WHEN 'garantia' THEN '-G' ELSE '-R' END;
            SELECT count(*) + 1 INTO n FROM public.work_orders
             WHERE parent_work_order_id = NEW.parent_work_order_id AND order_kind = NEW.order_kind;
            LOOP
                NEW.order_number := v_parent || v_suffix || n;
                EXIT WHEN NOT EXISTS (SELECT 1 FROM public.work_orders WHERE order_number = NEW.order_number);
                n := n + 1;
            END LOOP;
        ELSE
            folio := nextval('public.work_order_folio_seq')::text;
            NEW.order_number := 'OT-' || lpad(folio, greatest(5, length(folio)), '0');
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS assign_work_order_folio ON public.work_orders;
CREATE TRIGGER assign_work_order_folio BEFORE INSERT ON public.work_orders FOR EACH ROW EXECUTE FUNCTION public.assign_work_order_folio();

-- -----------------------------------------------------
-- 4) Cálculos de avance
-- -----------------------------------------------------
-- Piezas cerradas en una etapa (lo rechazado por Calidad no cuenta).
CREATE OR REPLACE FUNCTION public.work_order_stage_done(p_stage_id uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
    SELECT coalesce(sum(quantity - coalesce(qc_rejected_qty, 0)), 0)
      FROM public.work_order_closures WHERE stage_id = p_stage_id
$$;

-- Piezas que la etapa todavía puede cerrar: las que cerró la etapa anterior
-- (o la cantidad de la OT si es la primera) menos las que ya cerró.
CREATE OR REPLACE FUNCTION public.work_order_stage_available(p_stage_id uuid) RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE s public.work_order_stages; v_prev uuid; v_limit numeric;
BEGIN
    SELECT * INTO s FROM public.work_order_stages WHERE id = p_stage_id;
    IF NOT FOUND THEN RETURN 0; END IF;
    SELECT id INTO v_prev FROM public.work_order_stages
     WHERE work_order_id = s.work_order_id AND sequence < s.sequence ORDER BY sequence DESC LIMIT 1;
    IF v_prev IS NULL THEN
        SELECT quantity INTO v_limit FROM public.work_orders WHERE id = s.work_order_id;
    ELSE
        v_limit := public.work_order_stage_done(v_prev);
    END IF;
    RETURN greatest(v_limit - public.work_order_stage_done(p_stage_id), 0);
END;
$$;

-- Liberado por Calidad, todavía sin nota de entrega (ciclo actual).
CREATE OR REPLACE FUNCTION public.work_order_deliverable_qty(p_work_order_id uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
    SELECT greatest(
        coalesce((SELECT sum(coalesce(c.qc_released_qty, 0)) FROM public.work_order_closures c
                   WHERE c.work_order_id = w.id AND c.is_final), 0)
      - coalesce((SELECT sum(coalesce(d.quantity, w.quantity)) FROM public.deliveries d
                   WHERE d.work_order_id = w.id AND d.warranty_cycle = w.warranty_count), 0), 0)
      FROM public.work_orders w WHERE w.id = p_work_order_id
$$;

CREATE OR REPLACE VIEW public.v_work_order_stage_progress AS
WITH done AS (
    SELECT s.*, public.work_order_stage_done(s.id) AS qty_done,
           max(s.sequence) OVER (PARTITION BY s.work_order_id) AS last_sequence
      FROM public.work_order_stages s
)
SELECT d.id AS stage_id, d.work_order_id, d.module_id, m.code AS module_code, m.name AS module_name,
       m.color AS module_color, m.icon AS module_icon, d.sequence, d.status, d.started_at, d.paused_at,
       d.completed_at, (d.sequence = d.last_sequence) AS is_final, w.quantity AS qty_target, d.qty_done,
       greatest(coalesce(lag(d.qty_done) OVER (PARTITION BY d.work_order_id ORDER BY d.sequence), w.quantity) - d.qty_done, 0) AS qty_available
  FROM done d
  JOIN public.manufacturing_modules m ON m.id = d.module_id
  JOIN public.work_orders w ON w.id = d.work_order_id;

CREATE OR REPLACE VIEW public.v_work_order_progress AS
SELECT w.id AS work_order_id, w.quantity AS qty_target,
       coalesce(f.fabricated, 0) AS qty_fabricated,
       coalesce(f.pending_qc, 0) AS qty_pending_qc,
       coalesce(f.released, 0) AS qty_released,
       coalesce(f.rejected, 0) AS qty_rejected,
       coalesce(dv.delivered, 0) AS qty_delivered,
       coalesce(dv.in_delivery, 0) AS qty_in_delivery,
       greatest(coalesce(f.released, 0) - coalesce(dv.delivered, 0) - coalesce(dv.in_delivery, 0), 0) AS qty_deliverable,
       coalesce(st.stage_count, 0) AS stage_count,
       coalesce(st.stages, '[]'::jsonb) AS stages
  FROM public.work_orders w
  LEFT JOIN LATERAL (
      SELECT sum(c.quantity - coalesce(c.qc_rejected_qty, 0)) AS fabricated,
             sum(c.quantity) FILTER (WHERE c.qc_status = 'pending') AS pending_qc,
             sum(coalesce(c.qc_released_qty, 0)) AS released,
             sum(coalesce(c.qc_rejected_qty, 0)) AS rejected
        FROM public.work_order_closures c
       WHERE c.work_order_id = w.id AND c.is_final
  ) f ON true
  LEFT JOIN LATERAL (
      SELECT sum(coalesce(d.quantity, w.quantity)) FILTER (WHERE d.stage = 'delivered') AS delivered,
             sum(coalesce(d.quantity, w.quantity)) FILTER (WHERE d.stage <> 'delivered') AS in_delivery
        FROM public.deliveries d
       WHERE d.work_order_id = w.id AND d.warranty_cycle = w.warranty_count
  ) dv ON true
  LEFT JOIN LATERAL (
      SELECT count(*) AS stage_count,
             jsonb_agg(jsonb_build_object(
                 'stage_id', p.stage_id, 'module_code', p.module_code, 'module_name', p.module_name,
                 'sequence', p.sequence, 'status', p.status, 'qty_done', p.qty_done,
                 'qty_available', p.qty_available, 'is_final', p.is_final
             ) ORDER BY p.sequence) AS stages
        FROM public.v_work_order_stage_progress p
       WHERE p.work_order_id = w.id
  ) st ON true;

DO $$
BEGIN
    -- En PostgreSQL 15+ (producción) las vistas respetan los permisos de quien consulta.
    IF current_setting('server_version_num')::int >= 150000 THEN
        EXECUTE 'ALTER VIEW public.v_work_order_stage_progress SET (security_invoker = on)';
        EXECUTE 'ALTER VIEW public.v_work_order_progress SET (security_invoker = on)';
    END IF;
END;
$$;
GRANT SELECT ON public.v_work_order_stage_progress, public.v_work_order_progress TO anon, authenticated, service_role;

-- Estado resumido de la OT a partir de sus etapas y cierres.
CREATE OR REPLACE FUNCTION public.refresh_work_order_status(p_work_order_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
    w public.work_orders;
    v_last integer;
    v_fabricated numeric; v_released numeric; v_pending numeric;
    v_in_progress boolean; v_paused boolean; v_started boolean;
    v_first_start timestamptz; v_last_pause timestamptz;
    v_last_closure public.work_order_closures;
    v_status text;
BEGIN
    SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'OT no encontrada'; END IF;
    IF w.status = 'Cancelled' THEN RETURN w.status; END IF;
    SELECT max(sequence) INTO v_last FROM public.work_order_stages WHERE work_order_id = w.id;
    IF v_last IS NULL THEN RETURN w.status; END IF;

    SELECT coalesce(sum(c.quantity - coalesce(c.qc_rejected_qty, 0)), 0),
           coalesce(sum(coalesce(c.qc_released_qty, 0)), 0),
           coalesce(sum(c.quantity) FILTER (WHERE c.qc_status = 'pending'), 0)
      INTO v_fabricated, v_released, v_pending
      FROM public.work_order_closures c
      JOIN public.work_order_stages s ON s.id = c.stage_id
     WHERE c.work_order_id = w.id AND s.sequence = v_last;

    SELECT coalesce(bool_or(status = 'In Progress'), false), coalesce(bool_or(status = 'Paused'), false),
           coalesce(bool_or(started_at IS NOT NULL), false), min(started_at), max(paused_at) FILTER (WHERE status = 'Paused')
      INTO v_in_progress, v_paused, v_started, v_first_start, v_last_pause
      FROM public.work_order_stages WHERE work_order_id = w.id;

    v_status := CASE
        WHEN v_released >= w.quantity THEN 'QC_Released'
        WHEN v_in_progress THEN 'In Progress'
        WHEN v_fabricated >= w.quantity AND v_pending > 0 THEN 'QC'
        WHEN v_paused THEN 'Paused'
        WHEN v_pending > 0 THEN 'QC'
        WHEN v_started OR v_fabricated > 0 THEN 'In Progress'
        ELSE 'Open'
    END;

    SELECT c.* INTO v_last_closure FROM public.work_order_closures c
      JOIN public.work_order_stages s ON s.id = c.stage_id
     WHERE c.work_order_id = w.id AND s.sequence = v_last
     ORDER BY c.closed_at DESC LIMIT 1;

    UPDATE public.work_orders SET
        status = v_status,
        started_at = coalesce(v_first_start, started_at),
        paused_at = CASE WHEN v_status = 'Paused' THEN v_last_pause ELSE NULL END,
        completed_at = CASE WHEN v_fabricated >= w.quantity THEN coalesce(w.completed_at, now()) ELSE NULL END,
        operator_name = coalesce(v_last_closure.operator_name, w.operator_name),
        operator_signature_url = coalesce(v_last_closure.signature_url, w.operator_signature_url),
        qc_released_at = CASE WHEN v_status = 'QC_Released' THEN coalesce(w.qc_released_at, now()) ELSE NULL END,
        qc_released_by = CASE WHEN v_status = 'QC_Released' THEN coalesce(
            (SELECT c.qc_decided_by_name FROM public.work_order_closures c WHERE c.work_order_id = w.id AND c.qc_status = 'released'
              ORDER BY c.qc_decided_at DESC NULLS LAST LIMIT 1), w.qc_released_by) ELSE NULL END
     WHERE id = w.id AND (
        status IS DISTINCT FROM v_status
        OR started_at IS DISTINCT FROM coalesce(v_first_start, started_at)
        OR paused_at IS DISTINCT FROM (CASE WHEN v_status = 'Paused' THEN v_last_pause ELSE NULL END)
        OR (completed_at IS NULL) = (v_fabricated >= w.quantity)
        OR operator_name IS DISTINCT FROM coalesce(v_last_closure.operator_name, w.operator_name)
        OR (qc_released_at IS NULL) = (v_status = 'QC_Released')
     );
    RETURN v_status;
END;
$$;

-- -----------------------------------------------------
-- 5) Operaciones
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.smaa_valid_quantity(p_value numeric, p_label text DEFAULT 'La cantidad') RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
    IF p_value IS NULL OR p_value::text IN ('NaN', 'Infinity', '-Infinity') OR round(p_value, 2) <= 0 THEN
        RAISE EXCEPTION '% debe ser mayor a cero', p_label;
    END IF;
    RETURN round(p_value, 2);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_work_order_v2(p_order jsonb, p_stage_module_ids uuid[], p_wps_ids uuid[], p_actor_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE result uuid; v_actor text; v_qty numeric; v_quotation uuid;
BEGIN
    v_actor := public.smaa_set_actor(p_actor_id, NULL);
    IF coalesce(cardinality(p_stage_module_ids), 0) = 0 THEN RAISE EXCEPTION 'Selecciona al menos una etapa de fabricación'; END IF;
    IF EXISTS (SELECT 1 FROM unnest(p_stage_module_ids) AS m(id)
                WHERE NOT EXISTS (SELECT 1 FROM public.manufacturing_modules mm WHERE mm.id = m.id AND mm.is_active)) THEN
        RAISE EXCEPTION 'Una de las etapas no es válida';
    END IF;
    IF nullif(btrim(p_order ->> 'work_title'), '') IS NULL THEN RAISE EXCEPTION 'Falta el título'; END IF;
    v_qty := public.smaa_valid_quantity((p_order ->> 'quantity')::numeric, 'La cantidad de piezas');
    IF EXISTS (SELECT 1 FROM public.manufacturing_modules WHERE id = ANY(p_stage_module_ids) AND code = 'soldadura')
       AND coalesce(cardinality(p_wps_ids), 0) = 0 THEN
        RAISE EXCEPTION 'Soldadura requiere WPS';
    END IF;
    v_quotation := nullif(p_order ->> 'quotation_id', '')::uuid;
    IF v_quotation IS NOT NULL THEN
        PERFORM 1 FROM public.quotations WHERE id = v_quotation AND status IN ('Approved', 'Confirmed');
        IF NOT FOUND THEN RAISE EXCEPTION 'La cotización debe estar aprobada'; END IF;
    ELSIF nullif(btrim(p_order ->> 'client_name'), '') IS NULL THEN
        RAISE EXCEPTION 'Falta el cliente';
    END IF;

    INSERT INTO public.work_orders (module_id, quotation_id, client_name, client_rfc, work_title, priority, notes, status,
        quantity, unit, created_by, created_by_name)
    VALUES (p_stage_module_ids[1], v_quotation, nullif(btrim(p_order ->> 'client_name'), ''), nullif(btrim(p_order ->> 'client_rfc'), ''),
        btrim(p_order ->> 'work_title'), coalesce(nullif(p_order ->> 'priority', ''), 'Normal'), nullif(btrim(p_order ->> 'notes'), ''), 'Open',
        v_qty, coalesce(nullif(btrim(p_order ->> 'unit'), ''), 'pza'), p_actor_id, v_actor)
    RETURNING id INTO result;

    INSERT INTO public.work_order_stages (work_order_id, module_id, sequence)
    SELECT result, t.module_id, t.ord FROM unnest(p_stage_module_ids) WITH ORDINALITY AS t(module_id, ord);
    INSERT INTO public.work_order_wps (work_order_id, wps_id) SELECT DISTINCT result, unnest(p_wps_ids);
    IF nullif(btrim(p_order ->> 'notes'), '') IS NOT NULL THEN
        INSERT INTO public.work_order_notes (work_order_id, note, created_by, created_by_name)
        VALUES (result, btrim(p_order ->> 'notes'), p_actor_id, v_actor);
    END IF;
    RETURN result;
END;
$$;

-- Bloquea la OT y la etapa; valida que la OT siga activa.
CREATE OR REPLACE FUNCTION public.smaa_lock_stage(p_stage_id uuid, OUT o_stage public.work_order_stages, OUT o_order public.work_orders)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
    SELECT w.* INTO o_order FROM public.work_orders w
      JOIN public.work_order_stages s ON s.work_order_id = w.id
     WHERE s.id = p_stage_id FOR UPDATE OF w;
    IF NOT FOUND THEN RAISE EXCEPTION 'Etapa no encontrada'; END IF;
    IF o_order.status = 'Cancelled' THEN RAISE EXCEPTION 'La OT está cancelada'; END IF;
    SELECT * INTO o_stage FROM public.work_order_stages WHERE id = p_stage_id FOR UPDATE;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_work_order_stage(p_stage_id uuid, p_actor_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE l record;
BEGIN
    PERFORM public.smaa_set_actor(p_actor_id, NULL);
    SELECT * INTO l FROM public.smaa_lock_stage(p_stage_id);
    IF (l.o_stage).status = 'Done' THEN RAISE EXCEPTION 'Esta etapa ya cerró todas sus piezas'; END IF;
    IF (l.o_stage).status = 'Paused' THEN RAISE EXCEPTION 'La etapa está pausada; usa Reanudar'; END IF;
    IF (l.o_stage).status = 'Pending' THEN
        UPDATE public.work_order_stages SET status = 'In Progress', started_at = coalesce(started_at, now()), paused_at = NULL
         WHERE id = p_stage_id;
    END IF;
    RETURN public.refresh_work_order_status((l.o_order).id);
END;
$$;

CREATE OR REPLACE FUNCTION public.pause_work_order_stage(p_stage_id uuid, p_actor_id uuid, p_reason text, p_custom_reason text, p_notes text) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE l record; v_actor text;
BEGIN
    v_actor := public.smaa_set_actor(p_actor_id, NULL);
    IF nullif(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Indica el motivo de la pausa'; END IF;
    IF p_reason = 'Otro' AND nullif(btrim(p_custom_reason), '') IS NULL THEN RAISE EXCEPTION 'Especifica el motivo de la pausa'; END IF;
    SELECT * INTO l FROM public.smaa_lock_stage(p_stage_id);
    IF (l.o_stage).status <> 'In Progress' THEN RAISE EXCEPTION 'Solo se puede pausar una etapa en curso'; END IF;
    UPDATE public.work_order_stages SET status = 'Paused', paused_at = now() WHERE id = p_stage_id;
    INSERT INTO public.work_order_pauses (work_order_id, stage_id, reason, custom_reason, notes, paused_at, paused_by)
    VALUES ((l.o_order).id, p_stage_id, btrim(p_reason), nullif(btrim(p_custom_reason), ''), nullif(btrim(p_notes), ''), now(), v_actor);
    RETURN public.refresh_work_order_status((l.o_order).id);
END;
$$;

CREATE OR REPLACE FUNCTION public.resume_work_order_stage(p_stage_id uuid, p_actor_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE l record;
BEGIN
    PERFORM public.smaa_set_actor(p_actor_id, NULL);
    SELECT * INTO l FROM public.smaa_lock_stage(p_stage_id);
    IF (l.o_stage).status <> 'Paused' THEN RAISE EXCEPTION 'La etapa no está pausada'; END IF;
    UPDATE public.work_order_pauses SET resumed_at = now()
     WHERE stage_id = p_stage_id AND resumed_at IS NULL;
    UPDATE public.work_order_stages SET status = 'In Progress', paused_at = NULL WHERE id = p_stage_id;
    RETURN public.refresh_work_order_status((l.o_order).id);
END;
$$;

-- Cierre (parcial o total) de piezas en una etapa.
CREATE OR REPLACE FUNCTION public.close_work_order_stage(p_stage_id uuid, p_quantity numeric, p_actor_id uuid,
    p_operator_name text, p_signature_url text, p_notes text) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE l record; v_actor text; v_qty numeric; v_available numeric; v_final boolean; v_id uuid; v_seq integer;
BEGIN
    v_actor := public.smaa_set_actor(p_actor_id, NULL);
    v_qty := public.smaa_valid_quantity(p_quantity, 'La cantidad cerrada');
    IF nullif(btrim(p_signature_url), '') IS NULL THEN RAISE EXCEPTION 'Falta la firma del operador'; END IF;
    SELECT * INTO l FROM public.smaa_lock_stage(p_stage_id);
    IF (l.o_stage).status = 'Done' THEN RAISE EXCEPTION 'Esta etapa ya cerró todas sus piezas'; END IF;
    v_available := public.work_order_stage_available(p_stage_id);
    IF v_qty > v_available THEN
        RAISE EXCEPTION 'Solo hay % pieza(s) disponibles para cerrar en esta etapa', trim_scale(v_available);
    END IF;
    v_final := NOT EXISTS (SELECT 1 FROM public.work_order_stages
                            WHERE work_order_id = (l.o_order).id AND sequence > (l.o_stage).sequence);
    SELECT count(*) + 1 INTO v_seq FROM public.work_order_closures WHERE stage_id = p_stage_id;

    INSERT INTO public.work_order_closures (work_order_id, stage_id, sequence_no, quantity, is_final, qc_status,
        operator_name, closed_by, signature_url, notes)
    VALUES ((l.o_order).id, p_stage_id, v_seq, v_qty, v_final, CASE WHEN v_final THEN 'pending' ELSE 'not_required' END,
        coalesce(nullif(btrim(p_operator_name), ''), v_actor), p_actor_id, btrim(p_signature_url), nullif(btrim(p_notes), ''))
    RETURNING id INTO v_id;

    UPDATE public.work_order_completion_photos SET closure_id = v_id
     WHERE work_order_id = (l.o_order).id AND stage_id = p_stage_id AND closure_id IS NULL;

    UPDATE public.work_order_stages SET
        status = CASE WHEN public.work_order_stage_done(p_stage_id) >= (l.o_order).quantity THEN 'Done'
                      WHEN status = 'Pending' THEN 'In Progress' ELSE status END,
        started_at = coalesce(started_at, now()),
        paused_at = CASE WHEN public.work_order_stage_done(p_stage_id) >= (l.o_order).quantity THEN NULL ELSE paused_at END,
        completed_at = CASE WHEN public.work_order_stage_done(p_stage_id) >= (l.o_order).quantity THEN now() ELSE NULL END
     WHERE id = p_stage_id;
    -- Al terminar sus piezas una etapa ya no está pausada.
    UPDATE public.work_order_pauses SET resumed_at = now()
     WHERE stage_id = p_stage_id AND resumed_at IS NULL
       AND EXISTS (SELECT 1 FROM public.work_order_stages WHERE id = p_stage_id AND status = 'Done');
    PERFORM public.refresh_work_order_status((l.o_order).id);
    RETURN v_id;
END;
$$;

-- Decisión de Calidad sobre un lote (cierre de la última etapa).
CREATE OR REPLACE FUNCTION public.decide_work_order_closure(p_closure_id uuid, p_released_qty numeric, p_actor_id uuid,
    p_inspector_name text, p_signature_url text, p_comments text) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE c public.work_order_closures; w public.work_orders; v_actor text; v_released numeric; v_rejected numeric; v_inspector text;
BEGIN
    v_actor := public.smaa_set_actor(p_actor_id, NULL);
    SELECT * INTO w FROM public.work_orders WHERE id = (SELECT work_order_id FROM public.work_order_closures WHERE id = p_closure_id) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Lote no encontrado'; END IF;
    IF w.status = 'Cancelled' THEN RAISE EXCEPTION 'La OT está cancelada'; END IF;
    SELECT * INTO c FROM public.work_order_closures WHERE id = p_closure_id FOR UPDATE;
    IF NOT c.is_final OR c.qc_status <> 'pending' THEN RAISE EXCEPTION 'Este lote no está pendiente de Calidad'; END IF;
    IF p_released_qty IS NULL OR p_released_qty::text IN ('NaN', 'Infinity', '-Infinity') OR p_released_qty < 0 THEN
        RAISE EXCEPTION 'Indica cuántas piezas se liberan';
    END IF;
    v_released := round(p_released_qty, 2);
    IF v_released > c.quantity THEN RAISE EXCEPTION 'El lote solo tiene % pieza(s)', trim_scale(c.quantity); END IF;
    v_rejected := c.quantity - v_released;
    IF v_rejected > 0 AND nullif(btrim(p_comments), '') IS NULL THEN
        RAISE EXCEPTION 'Escribe el motivo del rechazo';
    END IF;
    IF v_released > 0 AND nullif(btrim(p_signature_url), '') IS NULL THEN RAISE EXCEPTION 'Falta la firma de Calidad'; END IF;
    v_inspector := coalesce(nullif(btrim(p_inspector_name), ''), v_actor);

    UPDATE public.work_order_closures SET
        qc_status = CASE WHEN v_released > 0 THEN 'released' ELSE 'rejected' END,
        qc_released_qty = v_released, qc_rejected_qty = v_rejected,
        qc_decided_at = now(), qc_decided_by = p_actor_id, qc_decided_by_name = v_inspector,
        qc_signature_url = nullif(btrim(p_signature_url), ''), qc_comments = nullif(btrim(p_comments), '')
     WHERE id = c.id;

    IF v_released > 0 THEN
        INSERT INTO public.work_order_qc_records (work_order_id, closure_id, decision, comments, inspector_name, signature_url, released_qty, rejected_qty)
        VALUES (w.id, c.id, 'released', nullif(btrim(p_comments), ''), v_inspector, nullif(btrim(p_signature_url), ''), v_released, v_rejected);
    END IF;
    IF v_rejected > 0 THEN
        IF v_released = 0 THEN
            INSERT INTO public.work_order_qc_records (work_order_id, closure_id, decision, comments, inspector_name, released_qty, rejected_qty)
            VALUES (w.id, c.id, 'rejected', btrim(p_comments), v_inspector, 0, v_rejected);
        END IF;
        -- Las piezas rechazadas regresan a la última etapa.
        UPDATE public.work_order_stages SET status = 'Pending', completed_at = NULL
         WHERE id = c.stage_id AND status = 'Done';
        UPDATE public.work_orders SET qc_rejected_at = now(), qc_reject_reason = btrim(p_comments) WHERE id = w.id;
    END IF;
    RETURN public.refresh_work_order_status(w.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_work_order_v2(p_work_order_id uuid, p_actor_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE w public.work_orders; v_actor text;
BEGIN
    IF nullif(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Escribe el motivo de la cancelación'; END IF;
    v_actor := public.smaa_set_actor(p_actor_id, p_reason);
    SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'OT no encontrada'; END IF;
    IF w.status = 'Cancelled' THEN RETURN; END IF;
    IF EXISTS (SELECT 1 FROM public.deliveries WHERE work_order_id = w.id AND stage <> 'delivered') THEN
        RAISE EXCEPTION 'La OT tiene una entrega pendiente; termínala o cancélala antes';
    END IF;
    UPDATE public.work_orders SET status = 'Cancelled', cancelled_at = now(), cancel_reason = btrim(p_reason) WHERE id = w.id;
    UPDATE public.work_order_pauses SET resumed_at = now() WHERE work_order_id = w.id AND resumed_at IS NULL;
    INSERT INTO public.work_order_notes (work_order_id, note, created_by, created_by_name)
    VALUES (w.id, 'OT cancelada: ' || btrim(p_reason), p_actor_id, v_actor);
END;
$$;

-- Número de nota de entrega: NE-<folio>[-G#][-n] (n a partir de la segunda entrega parcial).
CREATE OR REPLACE FUNCTION public.next_delivery_number(p_work_order_id uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE w public.work_orders; v_base text; n integer; v_candidate text;
BEGIN
    SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id;
    v_base := regexp_replace(w.order_number, '^OT-(MAQ-|SOLD-|AUTO-|OT-)?', 'NE-');
    IF v_base = w.order_number THEN v_base := 'NE-' || w.order_number; END IF;
    IF w.warranty_count > 0 THEN v_base := v_base || '-G' || w.warranty_count; END IF;
    SELECT count(*) + 1 INTO n FROM public.deliveries WHERE work_order_id = w.id AND warranty_cycle = w.warranty_count;
    LOOP
        v_candidate := v_base || CASE WHEN n > 1 THEN '-' || n ELSE '' END;
        EXIT WHEN NOT EXISTS (SELECT 1 FROM public.deliveries WHERE delivery_number = v_candidate);
        n := n + 1;
    END LOOP;
    RETURN v_candidate;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_work_order_delivery(p_work_order_id uuid, p_quantity numeric, p_details jsonb, p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE w public.work_orders; v_qty numeric; v_available numeric; v_number text; v_id uuid;
BEGIN
    PERFORM public.smaa_set_actor(p_actor_id, NULL);
    SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'OT no encontrada'; END IF;
    IF w.status = 'Cancelled' THEN RAISE EXCEPTION 'La OT está cancelada'; END IF;
    v_qty := public.smaa_valid_quantity(p_quantity, 'La cantidad a entregar');
    v_available := public.work_order_deliverable_qty(w.id);
    IF v_qty > v_available THEN
        RAISE EXCEPTION 'Solo hay % pieza(s) liberadas por Calidad pendientes de entregar', trim_scale(v_available);
    END IF;
    v_number := public.next_delivery_number(w.id);
    INSERT INTO public.deliveries (delivery_number, work_order_id, quantity, observations, shipping_method,
        shipping_address, shipping_carrier, tracking_number, stage)
    VALUES (v_number, w.id, v_qty, nullif(btrim(p_details ->> 'observations'), ''), nullif(btrim(p_details ->> 'shipping_method'), ''),
        nullif(btrim(p_details ->> 'shipping_address'), ''), nullif(btrim(p_details ->> 'shipping_carrier'), ''),
        nullif(btrim(p_details ->> 'tracking_number'), ''), 'ready_for_packaging')
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('id', v_id, 'delivery_number', v_number);
END;
$$;

-- Garantía o reparación: OT nueva ligada a la original.
CREATE OR REPLACE FUNCTION public.open_work_order_warranty(p_parent_id uuid, p_kind text, p_reason text, p_quantity numeric,
    p_stage_module_ids uuid[], p_wps_ids uuid[], p_priority text, p_actor_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE parent public.work_orders; v_actor text; v_qty numeric; v_stages uuid[]; v_wps uuid[]; v_child uuid; v_label text; v_child_number text;
BEGIN
    IF p_kind NOT IN ('garantia', 'reparacion') THEN RAISE EXCEPTION 'Tipo inválido'; END IF;
    IF nullif(btrim(p_reason), '') IS NULL OR length(btrim(p_reason)) > 2000 THEN
        RAISE EXCEPTION 'Escribe el motivo (máximo 2000 caracteres)';
    END IF;
    v_actor := public.smaa_set_actor(p_actor_id, p_reason);
    SELECT * INTO parent FROM public.work_orders WHERE id = p_parent_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'OT no encontrada'; END IF;
    IF parent.status = 'Cancelled' THEN RAISE EXCEPTION 'La OT está cancelada'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.work_order_closures WHERE work_order_id = parent.id AND coalesce(qc_released_qty, 0) > 0)
       AND parent.status <> 'QC_Released' THEN
        RAISE EXCEPTION 'Solo se abre garantía o reparación de una OT con piezas liberadas o entregadas';
    END IF;
    v_qty := public.smaa_valid_quantity(p_quantity, 'La cantidad de piezas');
    IF v_qty > parent.quantity THEN RAISE EXCEPTION 'La OT original tiene % pieza(s)', trim_scale(parent.quantity); END IF;

    v_stages := CASE WHEN coalesce(cardinality(p_stage_module_ids), 0) > 0 THEN p_stage_module_ids
        ELSE (SELECT array_agg(module_id ORDER BY sequence) FROM public.work_order_stages WHERE work_order_id = parent.id) END;
    v_wps := CASE WHEN coalesce(cardinality(p_wps_ids), 0) > 0 THEN p_wps_ids
        ELSE (SELECT array_agg(wps_id) FROM public.work_order_wps WHERE work_order_id = parent.id) END;
    v_label := CASE p_kind WHEN 'garantia' THEN 'Garantía' ELSE 'Reparación' END;

    INSERT INTO public.work_orders (module_id, quotation_id, client_name, client_rfc, work_title, priority, notes, status,
        quantity, unit, order_kind, parent_work_order_id, created_by, created_by_name)
    VALUES (v_stages[1], parent.quotation_id, parent.client_name, parent.client_rfc, parent.work_title,
        coalesce(nullif(p_priority, ''), 'Alta'), btrim(p_reason), 'Open', v_qty, parent.unit, p_kind, parent.id, p_actor_id, v_actor)
    RETURNING id, order_number INTO v_child, v_child_number;

    INSERT INTO public.work_order_stages (work_order_id, module_id, sequence)
    SELECT v_child, t.module_id, t.ord FROM unnest(v_stages) WITH ORDINALITY AS t(module_id, ord);
    IF EXISTS (SELECT 1 FROM public.manufacturing_modules WHERE id = ANY(v_stages) AND code = 'soldadura')
       AND coalesce(cardinality(v_wps), 0) = 0 THEN
        RAISE EXCEPTION 'Soldadura requiere WPS';
    END IF;
    INSERT INTO public.work_order_wps (work_order_id, wps_id) SELECT DISTINCT v_child, unnest(coalesce(v_wps, '{}'::uuid[]));

    INSERT INTO public.work_order_warranty_events (work_order_id, reason, reopened_by, reopened_by_name, previous_state, kind, quantity, child_work_order_id)
    VALUES (parent.id, btrim(p_reason), p_actor_id, v_actor, to_jsonb(parent), p_kind, v_qty, v_child);
    INSERT INTO public.work_order_notes (work_order_id, note, created_by, created_by_name) VALUES
        (parent.id, v_label || ' abierta en ' || v_child_number || ' (' || trim_scale(v_qty) || ' ' || parent.unit || '): ' || btrim(p_reason), p_actor_id, v_actor),
        (v_child, v_label || ' de ' || parent.order_number || ': ' || btrim(p_reason), p_actor_id, v_actor);
    RETURN v_child;
END;
$$;

-- Edición de datos de la OT (con motivo en la bitácora).
CREATE OR REPLACE FUNCTION public.update_work_order_details(p_work_order_id uuid, p_changes jsonb, p_stage_module_ids uuid[],
    p_wps_ids uuid[], p_actor_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
    w public.work_orders; v_qty numeric; v_locked uuid[]; v_locked_count integer; v_last_active integer;
    v_final_has_closures boolean; v_current uuid[]; v_max_seq integer; v_keep integer;
BEGIN
    PERFORM public.smaa_set_actor(p_actor_id, p_reason);
    SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'OT no encontrada'; END IF;
    IF w.status = 'Cancelled' THEN RAISE EXCEPTION 'La OT está cancelada'; END IF;

    IF p_changes ? 'work_title' AND nullif(btrim(p_changes ->> 'work_title'), '') IS NULL THEN RAISE EXCEPTION 'Falta el título'; END IF;
    IF p_changes ? 'quantity' THEN
        v_qty := public.smaa_valid_quantity((p_changes ->> 'quantity')::numeric, 'La cantidad de piezas');
        IF v_qty < coalesce((SELECT max(public.work_order_stage_done(id)) FROM public.work_order_stages WHERE work_order_id = w.id), 0) THEN
            RAISE EXCEPTION 'La cantidad no puede ser menor a las piezas ya cerradas';
        END IF;
    END IF;
    IF w.quotation_id IS NOT NULL AND (p_changes ? 'client_name' OR p_changes ? 'client_rfc') THEN
        RAISE EXCEPTION 'El cliente viene de la cotización; edítalo en la cotización';
    END IF;
    IF w.quotation_id IS NULL AND p_changes ? 'client_name' AND nullif(btrim(p_changes ->> 'client_name'), '') IS NULL THEN
        RAISE EXCEPTION 'Falta el cliente';
    END IF;

    UPDATE public.work_orders SET
        work_title = CASE WHEN p_changes ? 'work_title' THEN btrim(p_changes ->> 'work_title') ELSE work_title END,
        priority = CASE WHEN p_changes ? 'priority' THEN coalesce(nullif(p_changes ->> 'priority', ''), 'Normal') ELSE priority END,
        quantity = coalesce(v_qty, quantity),
        unit = CASE WHEN p_changes ? 'unit' THEN coalesce(nullif(btrim(p_changes ->> 'unit'), ''), 'pza') ELSE unit END,
        client_name = CASE WHEN p_changes ? 'client_name' THEN btrim(p_changes ->> 'client_name') ELSE client_name END,
        client_rfc = CASE WHEN p_changes ? 'client_rfc' THEN nullif(upper(btrim(p_changes ->> 'client_rfc')), '') ELSE client_rfc END,
        updated_at = now()
     WHERE id = w.id;

    -- Con otra cantidad cambia qué etapas quedan completas.
    IF v_qty IS NOT NULL AND v_qty <> w.quantity THEN
        UPDATE public.work_order_stages s SET
            status = CASE WHEN public.work_order_stage_done(s.id) >= v_qty THEN 'Done'
                          WHEN s.status = 'Done' THEN 'Pending' ELSE s.status END,
            completed_at = CASE WHEN public.work_order_stage_done(s.id) >= v_qty THEN coalesce(s.completed_at, now()) ELSE NULL END
         WHERE s.work_order_id = w.id;
    END IF;

    IF p_stage_module_ids IS NOT NULL THEN
        IF cardinality(p_stage_module_ids) = 0 THEN RAISE EXCEPTION 'La OT necesita al menos una etapa'; END IF;
        IF EXISTS (SELECT 1 FROM unnest(p_stage_module_ids) AS m(id)
                    WHERE NOT EXISTS (SELECT 1 FROM public.manufacturing_modules mm WHERE mm.id = m.id AND mm.is_active)) THEN
            RAISE EXCEPTION 'Una de las etapas no es válida';
        END IF;
        SELECT array_agg(module_id ORDER BY sequence) INTO v_current FROM public.work_order_stages WHERE work_order_id = w.id;
        IF v_current IS DISTINCT FROM p_stage_module_ids THEN
            -- Las etapas hasta la última con actividad no se pueden quitar ni reordenar.
            SELECT max(s.sequence) INTO v_last_active FROM public.work_order_stages s
             WHERE s.work_order_id = w.id AND (s.started_at IS NOT NULL OR s.status <> 'Pending'
                OR EXISTS (SELECT 1 FROM public.work_order_closures c WHERE c.stage_id = s.id)
                OR EXISTS (SELECT 1 FROM public.work_order_pauses p WHERE p.stage_id = s.id));
            SELECT coalesce(array_agg(module_id ORDER BY sequence), '{}'::uuid[]), count(*) INTO v_locked, v_locked_count
              FROM public.work_order_stages WHERE work_order_id = w.id AND sequence <= coalesce(v_last_active, 0);
            IF p_stage_module_ids[1:v_locked_count] IS DISTINCT FROM v_locked AND v_locked_count > 0 THEN
                RAISE EXCEPTION 'Las etapas que ya tienen actividad no se pueden quitar ni cambiar de orden';
            END IF;
            SELECT max(sequence) INTO v_max_seq FROM public.work_order_stages WHERE work_order_id = w.id;
            v_final_has_closures := EXISTS (SELECT 1 FROM public.work_order_closures c JOIN public.work_order_stages s ON s.id = c.stage_id
                                             WHERE s.work_order_id = w.id AND s.sequence = v_max_seq);
            IF v_final_has_closures AND cardinality(p_stage_module_ids) > v_locked_count THEN
                RAISE EXCEPTION 'La última etapa ya envió piezas a Calidad; abre otra OT para procesos adicionales';
            END IF;
            -- Sólo se reemplaza desde la primera etapa que cambia: las que siguen
            -- igual conservan su registro (y el historial no muestra ruido).
            v_keep := v_locked_count;
            WHILE v_keep < cardinality(p_stage_module_ids) AND v_keep < cardinality(v_current)
                  AND p_stage_module_ids[v_keep + 1] = v_current[v_keep + 1] LOOP
                v_keep := v_keep + 1;
            END LOOP;
            IF v_keep = 0 THEN
                DELETE FROM public.work_order_stages WHERE work_order_id = w.id;
            ELSE
                DELETE FROM public.work_order_stages s
                 WHERE s.work_order_id = w.id
                   AND s.sequence > (SELECT k.sequence FROM public.work_order_stages k WHERE k.work_order_id = w.id
                                      ORDER BY k.sequence OFFSET v_keep - 1 LIMIT 1);
            END IF;
            INSERT INTO public.work_order_stages (work_order_id, module_id, sequence)
            SELECT w.id, t.module_id, coalesce((SELECT max(sequence) FROM public.work_order_stages WHERE work_order_id = w.id), 0) + t.ord
              FROM unnest(p_stage_module_ids[v_keep + 1:cardinality(p_stage_module_ids)]) WITH ORDINALITY AS t(module_id, ord);
            UPDATE public.work_orders SET module_id = p_stage_module_ids[1] WHERE id = w.id AND module_id IS DISTINCT FROM p_stage_module_ids[1];
        END IF;
    END IF;

    IF p_wps_ids IS NOT NULL THEN
        DELETE FROM public.work_order_wps WHERE work_order_id = w.id AND NOT (wps_id = ANY(p_wps_ids));
        INSERT INTO public.work_order_wps (work_order_id, wps_id)
        SELECT DISTINCT w.id, x FROM unnest(p_wps_ids) AS x
         WHERE NOT EXISTS (SELECT 1 FROM public.work_order_wps WHERE work_order_id = w.id AND wps_id = x);
    END IF;
    IF EXISTS (SELECT 1 FROM public.work_order_stages s JOIN public.manufacturing_modules m ON m.id = s.module_id
                WHERE s.work_order_id = w.id AND m.code = 'soldadura')
       AND NOT EXISTS (SELECT 1 FROM public.work_order_wps WHERE work_order_id = w.id) THEN
        RAISE EXCEPTION 'Soldadura requiere WPS';
    END IF;
    PERFORM public.refresh_work_order_status(w.id);
END;
$$;

-- El alta anterior (una sola etapa) también deja la etapa creada.
CREATE OR REPLACE FUNCTION public.create_work_order(p_order jsonb, p_wps_ids uuid[] DEFAULT '{}') RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE result uuid; module_code text;
BEGIN
    SELECT code INTO module_code FROM public.manufacturing_modules WHERE id = (p_order->>'module_id')::uuid AND is_active;
    IF module_code IS NULL THEN RAISE EXCEPTION 'Módulo inválido'; END IF;
    IF nullif(btrim(p_order->>'work_title'),'') IS NULL THEN RAISE EXCEPTION 'Falta el título'; END IF;
    IF module_code = 'soldadura' AND coalesce(cardinality(p_wps_ids),0) = 0 THEN RAISE EXCEPTION 'Soldadura requiere WPS'; END IF;
    IF nullif(p_order->>'quotation_id','') IS NOT NULL THEN
        PERFORM 1 FROM public.quotations WHERE id = (p_order->>'quotation_id')::uuid AND status IN ('Approved','Confirmed');
        IF NOT FOUND THEN RAISE EXCEPTION 'La cotización debe estar aprobada'; END IF;
    ELSIF nullif(btrim(p_order->>'client_name'),'') IS NULL THEN RAISE EXCEPTION 'Falta el cliente';
    END IF;
    INSERT INTO public.work_orders(module_id,quotation_id,client_name,client_rfc,work_title,priority,notes,status)
    VALUES ((p_order->>'module_id')::uuid,(p_order->>'quotation_id')::uuid,p_order->>'client_name',p_order->>'client_rfc',p_order->>'work_title',p_order->>'priority',p_order->>'notes','Open') RETURNING id INTO result;
    INSERT INTO public.work_order_stages(work_order_id, module_id, sequence) VALUES (result, (p_order->>'module_id')::uuid, 1);
    INSERT INTO public.work_order_wps(work_order_id,wps_id) SELECT result, unnest(p_wps_ids);
    RETURN result;
END; $$;

-- -----------------------------------------------------
-- 6) Migración de registros anteriores (sin ensuciar la bitácora)
-- -----------------------------------------------------
ALTER TABLE public.work_orders DISABLE TRIGGER trg_audit_work_orders;
ALTER TABLE public.deliveries DISABLE TRIGGER trg_audit_deliveries;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_log_work_orders') THEN
        ALTER TABLE public.work_orders DISABLE TRIGGER trg_log_work_orders;
    END IF;
END;
$$;

INSERT INTO public.work_order_stages (work_order_id, module_id, sequence, status, started_at, paused_at, completed_at, created_at)
SELECT w.id,
       coalesce(w.module_id, (SELECT id FROM public.manufacturing_modules WHERE code = 'maquinado')),
       1,
       CASE w.status
           WHEN 'In Progress' THEN 'In Progress'
           WHEN 'Paused' THEN 'Paused'
           WHEN 'Completed' THEN 'Done'
           WHEN 'QC' THEN 'Done'
           WHEN 'QC_Released' THEN 'Done'
           ELSE 'Pending'
       END,
       w.started_at, w.paused_at, w.completed_at, coalesce(w.created_at, now())
  FROM public.work_orders w
 WHERE NOT EXISTS (SELECT 1 FROM public.work_order_stages s WHERE s.work_order_id = w.id)
   AND coalesce(w.module_id, (SELECT id FROM public.manufacturing_modules WHERE code = 'maquinado')) IS NOT NULL;

UPDATE public.work_orders w SET module_id = s.module_id
  FROM public.work_order_stages s
 WHERE s.work_order_id = w.id AND s.sequence = 1 AND w.module_id IS NULL;

INSERT INTO public.work_order_closures (work_order_id, stage_id, sequence_no, quantity, is_final, qc_status,
    qc_released_qty, qc_rejected_qty, operator_name, signature_url, notes, closed_at, qc_decided_at, qc_decided_by_name)
SELECT w.id, s.id, 1, w.quantity, true,
       CASE WHEN w.status = 'QC_Released' THEN 'released' ELSE 'pending' END,
       CASE WHEN w.status = 'QC_Released' THEN w.quantity END,
       CASE WHEN w.status = 'QC_Released' THEN 0 END,
       coalesce(nullif(btrim(w.operator_name), ''), 'Registro anterior'),
       w.operator_signature_url,
       'Cierre migrado del flujo anterior (una sola etapa).',
       coalesce(w.completed_at, w.qc_released_at, w.created_at, now()),
       CASE WHEN w.status = 'QC_Released' THEN coalesce(w.qc_released_at, w.completed_at, now()) END,
       CASE WHEN w.status = 'QC_Released' THEN coalesce(w.qc_released_by, 'Calidad') END
  FROM public.work_orders w
  JOIN public.work_order_stages s ON s.work_order_id = w.id AND s.sequence = 1
 WHERE w.status IN ('Completed', 'QC', 'QC_Released')
   AND NOT EXISTS (SELECT 1 FROM public.work_order_closures c WHERE c.work_order_id = w.id);

UPDATE public.work_order_pauses p SET stage_id = s.id
  FROM public.work_order_stages s
 WHERE s.work_order_id = p.work_order_id AND s.sequence = 1 AND p.stage_id IS NULL;

UPDATE public.work_order_completion_photos ph SET stage_id = s.id,
       closure_id = (SELECT c.id FROM public.work_order_closures c WHERE c.stage_id = s.id ORDER BY c.closed_at LIMIT 1)
  FROM public.work_order_stages s
 WHERE s.work_order_id = ph.work_order_id AND s.sequence = 1 AND ph.stage_id IS NULL;

UPDATE public.work_order_qc_records r SET closure_id = c.id
  FROM public.work_order_closures c
 WHERE c.work_order_id = r.work_order_id AND r.closure_id IS NULL AND r.decision = 'released' AND c.qc_status = 'released';

UPDATE public.deliveries d SET quantity = w.quantity
  FROM public.work_orders w
 WHERE w.id = d.work_order_id AND d.quantity IS NULL;

-- Recalcula el estado de las OT migradas con el nuevo modelo.
DO $$
DECLARE r record;
BEGIN
    FOR r IN SELECT id FROM public.work_orders WHERE status <> 'Cancelled' LOOP
        PERFORM public.refresh_work_order_status(r.id);
    END LOOP;
END;
$$;

ALTER TABLE public.work_orders ENABLE TRIGGER trg_audit_work_orders;
ALTER TABLE public.deliveries ENABLE TRIGGER trg_audit_deliveries;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_log_work_orders') THEN
        ALTER TABLE public.work_orders ENABLE TRIGGER trg_log_work_orders;
    END IF;
END;
$$;

-- -----------------------------------------------------
-- 7) Entregas
-- -----------------------------------------------------
-- Valida cualquier alta de entrega (también si llega por la API directa).
CREATE OR REPLACE FUNCTION public.guard_warranty_delivery() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE w public.work_orders; v_available numeric;
BEGIN
    SELECT * INTO w FROM public.work_orders WHERE id = NEW.work_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'OT no encontrada'; END IF;
    IF TG_OP = 'INSERT' THEN
        NEW.warranty_cycle := w.warranty_count;
        IF w.warranty_count > 0 AND EXISTS (SELECT 1 FROM public.deliveries WHERE work_order_id = w.id AND stage <> 'delivered') THEN
            RAISE EXCEPTION 'La OT ya tiene una entrega pendiente; continúa con esa nota después de liberarla';
        END IF;
        IF EXISTS (SELECT 1 FROM public.work_order_stages WHERE work_order_id = w.id) THEN
            v_available := public.work_order_deliverable_qty(w.id);
            IF NEW.quantity IS NULL THEN NEW.quantity := v_available; END IF;
            IF NEW.quantity <= 0 THEN RAISE EXCEPTION 'No hay piezas liberadas por Calidad pendientes de entregar'; END IF;
            IF NEW.quantity > v_available THEN
                RAISE EXCEPTION 'Solo hay % pieza(s) liberadas por Calidad pendientes de entregar', trim_scale(v_available);
            END IF;
        END IF;
    ELSIF NEW.quantity IS DISTINCT FROM OLD.quantity OR NEW.work_order_id IS DISTINCT FROM OLD.work_order_id THEN
        RAISE EXCEPTION 'La OT y la cantidad de una nota de entrega no se pueden modificar';
    END IF;
    IF (NEW.stage = 'delivered' OR NEW.packaged_at IS NOT NULL) AND w.warranty_count > 0 AND w.status <> 'QC_Released' THEN
        RAISE EXCEPTION 'La OT está en garantía; Calidad debe liberarla antes de entregarla';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_warranty_delivery ON public.deliveries;
CREATE TRIGGER guard_warranty_delivery BEFORE INSERT OR UPDATE OF stage, packaged_at, work_order_id, quantity ON public.deliveries
FOR EACH ROW EXECUTE FUNCTION public.guard_warranty_delivery();

-- -----------------------------------------------------
-- 8) Permisos y bitácora
-- -----------------------------------------------------
DO $$
DECLARE v_fn text;
BEGIN
    FOREACH v_fn IN ARRAY ARRAY[
        'public.create_work_order_v2(jsonb, uuid[], uuid[], uuid)',
        'public.smaa_lock_stage(uuid)',
        'public.start_work_order_stage(uuid, uuid)',
        'public.pause_work_order_stage(uuid, uuid, text, text, text)',
        'public.resume_work_order_stage(uuid, uuid)',
        'public.close_work_order_stage(uuid, numeric, uuid, text, text, text)',
        'public.decide_work_order_closure(uuid, numeric, uuid, text, text, text)',
        'public.cancel_work_order_v2(uuid, uuid, text)',
        'public.create_work_order_delivery(uuid, numeric, jsonb, uuid)',
        'public.open_work_order_warranty(uuid, text, text, numeric, uuid[], uuid[], text, uuid)',
        'public.update_work_order_details(uuid, jsonb, uuid[], uuid[], uuid, text)',
        'public.refresh_work_order_status(uuid)',
        'public.next_delivery_number(uuid)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_fn);
    END LOOP;
    -- Lecturas que usa la pantalla.
    GRANT EXECUTE ON FUNCTION public.work_order_stage_done(uuid), public.work_order_stage_available(uuid),
        public.work_order_deliverable_qty(uuid), public.smaa_valid_quantity(numeric, text) TO anon, authenticated, service_role;

    PERFORM public.smaa_attach_audit('work_order_stages', 'work_orders', 'work_order_id');
    PERFORM public.smaa_attach_audit('work_order_closures', 'work_orders', 'work_order_id');
    PERFORM public.smaa_attach_audit('work_order_pauses', 'work_orders', 'work_order_id');
END;
$$;

COMMIT;
