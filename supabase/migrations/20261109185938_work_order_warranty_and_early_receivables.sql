BEGIN;

-- Billing is independent of manufacturing and quality release. Locking the
-- quotation plus the existing unique index makes repeated requests idempotent.
CREATE OR REPLACE FUNCTION public.quotation_to_receivable(p_quotation_id uuid, p_employee_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE q public.quotations; result uuid; credit_days integer;
BEGIN
    SELECT * INTO q FROM public.quotations WHERE id=p_quotation_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cotización no encontrada'; END IF;
    SELECT id INTO result FROM public.ar_invoices WHERE quotation_id=q.id;
    IF result IS NOT NULL THEN RETURN result; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.work_orders WHERE quotation_id=q.id AND status <> 'Cancelled') THEN
        RAISE EXCEPTION 'La cotización requiere al menos una OT activa';
    END IF;
    IF q.status='Rejected' OR q.total IS NULL OR q.total <= 0 THEN RAISE EXCEPTION 'La cotización no tiene un importe cobrable'; END IF;
    SELECT greatest(coalesce(payment_days,0),0) INTO credit_days FROM public.clients WHERE id=q.client_id AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'El cliente está inactivo'; END IF;
    INSERT INTO public.ar_invoices(client_id,quotation_id,source_type,source_id,concept,invoice_number,invoice_date,due_date,gross_amount,vat_amount,net_amount,created_by,updated_by,notes)
    VALUES(q.client_id,q.id,'sale',q.id,coalesce(nullif(q.title,''),q.quotation_number),q.quotation_number,current_date,current_date+credit_days,q.subtotal,q.vat_total,q.total,p_employee_id,p_employee_id,'Origen: cotización '||q.quotation_number||'. Envío a cobro independiente de la liberación de OT.') RETURNING id INTO result;
    RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.quotation_to_receivable(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quotation_to_receivable(uuid,uuid) TO service_role;

ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS warranty_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.deliveries ADD COLUMN IF NOT EXISTS warranty_cycle integer NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS deliveries_warranty_cycle_unique ON public.deliveries(work_order_id,warranty_cycle) WHERE warranty_cycle>0;
CREATE TABLE IF NOT EXISTS public.work_order_warranty_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE RESTRICT,
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
    reopened_by uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
    reopened_by_name text NOT NULL,
    reopened_at timestamptz NOT NULL DEFAULT now(),
    previous_state jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS work_order_warranty_events_order_idx ON public.work_order_warranty_events(work_order_id,reopened_at DESC);
ALTER TABLE public.work_order_warranty_events ENABLE ROW LEVEL SECURITY;
-- The app uses its own signed employee sessions. Only server actions that have
-- authorized that session may access the immutable warranty audit records.
REVOKE ALL ON public.work_order_warranty_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.work_order_warranty_events TO service_role;

CREATE OR REPLACE FUNCTION public.reopen_work_order_warranty(p_work_order_id uuid, p_employee_id uuid, p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE w public.work_orders; actor_name text; event_id uuid;
BEGIN
    IF nullif(btrim(p_reason),'') IS NULL OR length(btrim(p_reason)) > 2000 THEN
        RAISE EXCEPTION 'Escribe el motivo de la garantía (máximo 2000 caracteres)';
    END IF;
    SELECT full_name INTO actor_name FROM public.employees WHERE id=p_employee_id AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'El empleado no está activo'; END IF;
    SELECT * INTO w FROM public.work_orders WHERE id=p_work_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'OT no encontrada'; END IF;
    IF w.status <> 'QC_Released' THEN RAISE EXCEPTION 'Solo se pueden reabrir por garantía las OT liberadas'; END IF;
    INSERT INTO public.work_order_warranty_events(work_order_id,reason,reopened_by,reopened_by_name,previous_state)
    VALUES(w.id,btrim(p_reason),p_employee_id,actor_name,to_jsonb(w)) RETURNING id INTO event_id;
    INSERT INTO public.work_order_notes(work_order_id,note,created_by,created_by_name)
    VALUES(w.id,'Reapertura por garantía #' || (w.warranty_count+1) || ': ' || btrim(p_reason),p_employee_id,actor_name);
    -- Preserve folio, quotation, assignments, photos, QC records and deliveries.
    -- The snapshot preserves all prior timing/signature data before a new cycle.
    -- No receivable or payment is created or modified here.
    UPDATE public.work_orders SET status='Open', warranty_count=w.warranty_count+1,
        started_at=NULL, paused_at=NULL, completed_at=NULL,
        operator_signature_url=NULL, qc_released_at=NULL, qc_released_by=NULL,
        qc_rejected_at=NULL, qc_reject_reason=NULL, qc_approved=false, qc_approved_at=NULL
    WHERE id=w.id;
    RETURN event_id;
END; $$;
REVOKE ALL ON FUNCTION public.reopen_work_order_warranty(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_work_order_warranty(uuid,uuid,text) TO service_role;

-- A pending delivery cannot bypass the new warranty quality cycle. Completed
-- deliveries stay as history; once quality releases the OT again it may ship.
CREATE OR REPLACE FUNCTION public.guard_warranty_delivery() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE w public.work_orders;
BEGIN
    SELECT * INTO w FROM public.work_orders WHERE id=NEW.work_order_id FOR UPDATE;
    IF TG_OP='INSERT' THEN
        NEW.warranty_cycle := w.warranty_count;
        IF w.warranty_count>0 AND EXISTS (SELECT 1 FROM public.deliveries WHERE work_order_id=w.id AND stage<>'delivered') THEN
            RAISE EXCEPTION 'La OT ya tiene una entrega pendiente; continúa con esa nota después de liberarla';
        END IF;
    END IF;
    IF (NEW.stage='delivered' OR NEW.packaged_at IS NOT NULL) AND w.warranty_count>0 AND w.status<>'QC_Released' THEN
        RAISE EXCEPTION 'La OT está en garantía; Calidad debe liberarla antes de entregarla';
    END IF;
    RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS guard_warranty_delivery ON public.deliveries;
CREATE TRIGGER guard_warranty_delivery BEFORE INSERT OR UPDATE OF stage,packaged_at,work_order_id ON public.deliveries
FOR EACH ROW EXECUTE FUNCTION public.guard_warranty_delivery();
COMMIT;
