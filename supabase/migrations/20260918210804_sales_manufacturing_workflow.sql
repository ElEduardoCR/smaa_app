BEGIN;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.quotations ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.quotation_items ADD COLUMN IF NOT EXISTS is_extra boolean NOT NULL DEFAULT false;
ALTER TABLE public.quotation_items ADD COLUMN IF NOT EXISTS extra_note text;
ALTER TABLE public.ar_invoices ADD COLUMN IF NOT EXISTS quotation_id uuid REFERENCES public.quotations(id);
CREATE UNIQUE INDEX IF NOT EXISTS ar_invoices_quotation_unique ON public.ar_invoices(quotation_id) WHERE quotation_id IS NOT NULL;

-- A sequence, independent of quotation folios and row counts, is safe under concurrency.
CREATE SEQUENCE IF NOT EXISTS public.work_order_folio_seq;
SELECT setval('public.work_order_folio_seq', greatest(
    coalesce((SELECT max(substring(order_number from '([0-9]+)$')::bigint) FROM public.work_orders WHERE order_number ~ '^OT-(MAQ|SOLD|AUTO|OT)-[0-9]+$'),0),
    (SELECT last_value FROM public.work_order_folio_seq)), true);
CREATE OR REPLACE FUNCTION public.assign_work_order_folio() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE prefix text; folio text;
BEGIN
    IF NEW.order_number IS NULL OR btrim(NEW.order_number) = '' THEN
        SELECT CASE code WHEN 'maquinado' THEN 'MAQ' WHEN 'soldadura' THEN 'SOLD' WHEN 'automatizacion' THEN 'AUTO' ELSE 'OT' END
        INTO prefix FROM public.manufacturing_modules WHERE id = NEW.module_id;
        folio := nextval('public.work_order_folio_seq')::text;
        NEW.order_number := 'OT-' || coalesce(prefix,'OT') || '-' || lpad(folio,greatest(5,length(folio)),'0');
    END IF;
    RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS assign_work_order_folio ON public.work_orders;
CREATE TRIGGER assign_work_order_folio BEFORE INSERT ON public.work_orders FOR EACH ROW EXECUTE FUNCTION public.assign_work_order_folio();
GRANT USAGE ON SEQUENCE public.work_order_folio_seq TO anon, authenticated;

-- One transaction also includes WPS links, so retrying a failed creation leaves no orphan OT.
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
    INSERT INTO public.work_order_wps(work_order_id,wps_id) SELECT result, unnest(p_wps_ids);
    RETURN result;
END; $$;

-- Payments and extras may update the same account concurrently. Derive its status
-- from the final locked row, including payments registered by the existing trigger.
CREATE OR REPLACE FUNCTION public.quotation_ar_amount_status() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
    IF NEW.quotation_id IS NOT NULL AND NEW.status <> 'cancelled' THEN
        NEW.status := CASE WHEN NEW.paid_amount=0 THEN 'pending' WHEN NEW.paid_amount >= NEW.net_amount THEN 'paid' ELSE 'partial' END;
    END IF;
    RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS quotation_ar_amount_status ON public.ar_invoices;
CREATE TRIGGER quotation_ar_amount_status BEFORE UPDATE OF net_amount,paid_amount ON public.ar_invoices
FOR EACH ROW EXECUTE FUNCTION public.quotation_ar_amount_status();

-- Lock the quotation in both operations to serialize extras and transfer to AR.
CREATE OR REPLACE FUNCTION public.add_quotation_extra(p_quotation_id uuid, p_description text, p_quantity numeric, p_unit_price numeric, p_note text) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE q public.quotations; result uuid; amount numeric; new_subtotal numeric; new_vat numeric;
BEGIN
    SELECT * INTO q FROM public.quotations WHERE id = p_quotation_id FOR UPDATE;
    IF NOT FOUND OR q.status = 'Rejected' THEN RAISE EXCEPTION 'Cotización no disponible'; END IF;
    IF nullif(btrim(p_description),'') IS NULL OR p_quantity IS NULL OR p_unit_price IS NULL OR p_quantity < 0.01 OR p_unit_price < 0
       OR p_quantity::text IN ('NaN','Infinity','-Infinity') OR p_unit_price::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Partida inválida'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.work_orders WHERE quotation_id=q.id AND status <> 'Cancelled') THEN RAISE EXCEPTION 'La cotización aún no está en fabricación'; END IF;
    PERFORM 1 FROM public.ar_invoices WHERE quotation_id=q.id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.ar_invoices WHERE quotation_id=q.id AND (status='cancelled' OR NOT is_active)) THEN RAISE EXCEPTION 'Restaura la cuenta por cobrar antes de agregar extras'; END IF;
    amount := round(round(p_quantity,2)*round(p_unit_price,2),2);
    INSERT INTO public.quotation_items(quotation_id,description,quantity,unit_price,line_total,is_extra,extra_note,margin_pct)
    VALUES(q.id,'[Extra] ' || btrim(p_description),round(p_quantity,2),round(p_unit_price,2),amount,true,nullif(btrim(p_note),''),0) RETURNING id INTO result;
    SELECT coalesce(sum(line_total),0) INTO new_subtotal FROM public.quotation_items WHERE quotation_id=q.id;
    new_vat := round(new_subtotal*0.16,2);
    UPDATE public.quotations SET subtotal=new_subtotal,vat_total=new_vat,total=new_subtotal+new_vat,updated_at=now() WHERE id=q.id;
    UPDATE public.ar_invoices SET gross_amount=new_subtotal,vat_amount=new_vat,net_amount=new_subtotal+new_vat,
        status=CASE WHEN paid_amount=0 THEN 'pending' WHEN paid_amount >= new_subtotal+new_vat THEN 'paid' ELSE 'partial' END,
        updated_at=now() WHERE quotation_id=q.id;
    RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.quotation_to_receivable(p_quotation_id uuid, p_employee_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE q public.quotations; result uuid; credit_days integer;
BEGIN
    SELECT * INTO q FROM public.quotations WHERE id=p_quotation_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cotización no encontrada'; END IF;
    SELECT id INTO result FROM public.ar_invoices WHERE quotation_id=q.id;
    IF result IS NOT NULL THEN RETURN result; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.work_orders WHERE quotation_id=q.id AND status <> 'Cancelled') OR
       EXISTS (SELECT 1 FROM public.work_orders WHERE quotation_id=q.id AND status NOT IN ('Completed','QC','QC_Released','Cancelled')) THEN
        RAISE EXCEPTION 'Primero termina todas las órdenes de fabricación de esta cotización';
    END IF;
    IF q.status='Rejected' OR q.total <= 0 THEN RAISE EXCEPTION 'La cotización no tiene un importe cobrable'; END IF;
    SELECT greatest(coalesce(payment_days,0),0) INTO credit_days FROM public.clients WHERE id=q.client_id AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'El cliente está inactivo'; END IF;
    INSERT INTO public.ar_invoices(client_id,quotation_id,source_type,source_id,concept,invoice_number,invoice_date,due_date,gross_amount,vat_amount,net_amount,created_by,updated_by,notes)
    VALUES(q.client_id,q.id,'sale',q.id,coalesce(nullif(q.title,''),q.quotation_number),q.quotation_number,current_date,current_date+credit_days,q.subtotal,q.vat_total,q.total,p_employee_id,p_employee_id,'Origen: cotización fabricada '||q.quotation_number) RETURNING id INTO result;
    RETURN result;
END; $$;
-- Invoker functions preserve existing table RLS; application actions check module permissions.
REVOKE ALL ON FUNCTION public.create_work_order(jsonb,uuid[]), public.add_quotation_extra(uuid,text,numeric,numeric,text), public.quotation_to_receivable(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_work_order(jsonb,uuid[]), public.add_quotation_extra(uuid,text,numeric,numeric,text), public.quotation_to_receivable(uuid,uuid) TO anon, authenticated;
-- Preserve unrestricted buckets; extend a configured PDF-only allowlist for invoice photos.
UPDATE storage.buckets SET allowed_mime_types = ARRAY(
    SELECT DISTINCT mime FROM unnest(allowed_mime_types || ARRAY[
        'application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif','image/gif','image/avif','image/tiff','image/bmp'
    ]) AS mime
) WHERE id='purchase_files' AND allowed_mime_types IS NOT NULL;
COMMIT;
