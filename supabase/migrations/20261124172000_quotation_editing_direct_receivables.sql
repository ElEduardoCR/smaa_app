-- =====================================================
-- EDICIÓN DE COTIZACIONES CON HISTORIAL + CxC SIN OT
--
-- save_quotation: alta o edición en una sola transacción. Las partidas se
-- actualizan por id (no se borran y recrean), así el historial muestra qué
-- partida cambió. Funciona también con cotizaciones aprobadas, con OT o ya
-- enviadas a cobro: si hay cuenta por cobrar, se actualiza su importe y se
-- conservan los pagos (el total no puede quedar por debajo de lo pagado).
--
-- quotation_to_receivable: ya no exige OT. Sirve para ventas que sólo se
-- compraron y entregaron, y para trabajos hechos que se registran después
-- (fecha de venta en el pasado; el vencimiento se calcula desde esa fecha).
-- =====================================================

BEGIN;

-- Orden estable de las partidas: al editarlas en su lugar ya no dependen del
-- orden físico de la tabla.
ALTER TABLE public.quotation_items ADD COLUMN IF NOT EXISTS position integer;
ALTER TABLE public.quotation_items DISABLE TRIGGER trg_audit_quotation_items;
UPDATE public.quotation_items qi SET position = o.rn
  FROM (SELECT id, row_number() OVER (PARTITION BY quotation_id ORDER BY ctid) AS rn FROM public.quotation_items) o
 WHERE o.id = qi.id AND qi.position IS NULL;
ALTER TABLE public.quotation_items ENABLE TRIGGER trg_audit_quotation_items;
CREATE INDEX IF NOT EXISTS quotation_items_position_idx ON public.quotation_items (quotation_id, position);

ALTER TABLE public.ar_invoices ADD COLUMN IF NOT EXISTS sale_origin text;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ar_invoices_sale_origin_check') THEN
        ALTER TABLE public.ar_invoices ADD CONSTRAINT ar_invoices_sale_origin_check
            CHECK (sale_origin IS NULL OR sale_origin IN ('fabricacion', 'venta_directa', 'trabajo_previo'));
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_quotation(p_quotation_id uuid, p_header jsonb, p_items jsonb, p_totals jsonb,
    p_actor_id uuid, p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
    q public.quotations; v_id uuid; v_item jsonb; v_item_id uuid; v_keep uuid[] := '{}'; v_position integer := 0;
    v_subtotal numeric; v_vat numeric; v_total numeric; v_ar public.ar_invoices; v_client bigint;
BEGIN
    PERFORM public.smaa_set_actor(p_actor_id, p_reason);
    IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Agrega al menos una partida'; END IF;
    v_client := nullif(p_header ->> 'client_id', '')::bigint;
    IF v_client IS NULL OR NOT EXISTS (SELECT 1 FROM public.clients WHERE id = v_client) THEN RAISE EXCEPTION 'Selecciona un cliente válido'; END IF;
    v_subtotal := round((p_totals ->> 'subtotal')::numeric, 2);
    v_vat := round((p_totals ->> 'vat')::numeric, 2);
    v_total := round((p_totals ->> 'total')::numeric, 2);
    IF v_subtotal IS NULL OR v_vat IS NULL OR v_total IS NULL OR v_subtotal < 0 OR v_vat < 0 OR v_total < v_subtotal THEN
        RAISE EXCEPTION 'Importes inválidos';
    END IF;

    IF p_quotation_id IS NULL THEN
        INSERT INTO public.quotations (client_id, title, seller, delivery_time, delivery_date, terms_conditions, commissioners,
            subtotal, vat_total, total, status)
        VALUES (v_client, nullif(btrim(p_header ->> 'title'), ''), nullif(btrim(p_header ->> 'seller'), ''),
            nullif(btrim(p_header ->> 'delivery_time'), ''), nullif(p_header ->> 'delivery_date', '')::date,
            nullif(p_header ->> 'terms_conditions', ''), coalesce(p_header -> 'commissioners', '[]'::jsonb),
            v_subtotal, v_vat, v_total, coalesce(nullif(p_header ->> 'status', ''), 'Draft'))
        RETURNING id INTO v_id;
    ELSE
        SELECT * INTO q FROM public.quotations WHERE id = p_quotation_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Cotización no encontrada'; END IF;
        v_id := q.id;
        SELECT * INTO v_ar FROM public.ar_invoices WHERE quotation_id = q.id FOR UPDATE;
        IF FOUND THEN
            IF v_client <> q.client_id THEN
                RAISE EXCEPTION 'La cotización ya está en cuentas por cobrar; no se puede cambiar el cliente';
            END IF;
            IF v_ar.status <> 'cancelled' AND v_ar.is_active AND v_total < v_ar.paid_amount THEN
                RAISE EXCEPTION 'El total no puede ser menor a lo ya cobrado ($%)', to_char(v_ar.paid_amount, 'FM999,999,990.00');
            END IF;
        END IF;
        UPDATE public.quotations SET
            client_id = v_client,
            title = nullif(btrim(p_header ->> 'title'), ''),
            seller = nullif(btrim(p_header ->> 'seller'), ''),
            delivery_time = nullif(btrim(p_header ->> 'delivery_time'), ''),
            delivery_date = nullif(p_header ->> 'delivery_date', '')::date,
            terms_conditions = nullif(p_header ->> 'terms_conditions', ''),
            commissioners = coalesce(p_header -> 'commissioners', '[]'::jsonb),
            subtotal = v_subtotal, vat_total = v_vat, total = v_total, updated_at = now()
         WHERE id = q.id;
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_position := v_position + 1;
        IF nullif(btrim(v_item ->> 'description'), '') IS NULL THEN RAISE EXCEPTION 'Cada partida necesita descripción'; END IF;
        IF (v_item ->> 'quantity')::numeric IS NULL OR (v_item ->> 'quantity')::numeric <= 0 THEN RAISE EXCEPTION 'Cantidad inválida en "%"', v_item ->> 'description'; END IF;
        IF (v_item ->> 'unit_price')::numeric IS NULL OR (v_item ->> 'unit_price')::numeric < 0 THEN RAISE EXCEPTION 'Precio inválido en "%"', v_item ->> 'description'; END IF;
        v_item_id := nullif(v_item ->> 'id', '')::uuid;
        IF v_item_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.quotation_items WHERE id = v_item_id AND quotation_id = v_id) THEN
            UPDATE public.quotation_items SET
                description = btrim(v_item ->> 'description'),
                quantity = (v_item ->> 'quantity')::numeric,
                unit_price = (v_item ->> 'unit_price')::numeric,
                line_total = round((v_item ->> 'line_total')::numeric, 2),
                cost_unit_price = (v_item ->> 'cost_unit_price')::numeric,
                cost_line_total = round((v_item ->> 'cost_line_total')::numeric, 2),
                margin_pct = coalesce((v_item ->> 'margin_pct')::numeric, margin_pct),
                item_type = coalesce(nullif(v_item ->> 'item_type', ''), 'product'),
                service_concepts = CASE WHEN jsonb_typeof(v_item -> 'service_concepts') = 'array' THEN v_item -> 'service_concepts' END,
                position = v_position
             WHERE id = v_item_id;
        ELSE
            INSERT INTO public.quotation_items (quotation_id, description, quantity, unit_price, line_total, cost_unit_price,
                cost_line_total, margin_pct, item_type, service_concepts, position)
            VALUES (v_id, btrim(v_item ->> 'description'), (v_item ->> 'quantity')::numeric, (v_item ->> 'unit_price')::numeric,
                round((v_item ->> 'line_total')::numeric, 2), (v_item ->> 'cost_unit_price')::numeric,
                round((v_item ->> 'cost_line_total')::numeric, 2), coalesce((v_item ->> 'margin_pct')::numeric, 0),
                coalesce(nullif(v_item ->> 'item_type', ''), 'product'),
                CASE WHEN jsonb_typeof(v_item -> 'service_concepts') = 'array' THEN v_item -> 'service_concepts' END, v_position)
            RETURNING id INTO v_item_id;
        END IF;
        v_keep := v_keep || v_item_id;
    END LOOP;
    DELETE FROM public.quotation_items WHERE quotation_id = v_id AND NOT (id = ANY(v_keep));

    -- La cuenta por cobrar sigue a la cotización; los pagos se conservan.
    UPDATE public.ar_invoices SET gross_amount = v_subtotal, vat_amount = v_vat, net_amount = v_total,
        concept = coalesce(nullif(btrim(p_header ->> 'title'), ''), concept), updated_by = p_actor_id, updated_at = now()
     WHERE quotation_id = v_id AND status <> 'cancelled' AND is_active
       AND (gross_amount, vat_amount, net_amount) IS DISTINCT FROM (v_subtotal, v_vat, v_total);
    RETURN v_id;
END;
$$;

DROP FUNCTION IF EXISTS public.quotation_to_receivable(uuid, uuid);
CREATE OR REPLACE FUNCTION public.quotation_to_receivable(p_quotation_id uuid, p_employee_id uuid, p_invoice_date date DEFAULT NULL,
    p_origin text DEFAULT 'fabricacion', p_notes text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE q public.quotations; result uuid; credit_days integer; v_date date; v_origin text; v_label text;
BEGIN
    PERFORM public.smaa_set_actor(p_employee_id, p_notes);
    SELECT * INTO q FROM public.quotations WHERE id = p_quotation_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cotización no encontrada'; END IF;
    SELECT id INTO result FROM public.ar_invoices WHERE quotation_id = q.id;
    IF result IS NOT NULL THEN RETURN result; END IF;
    IF q.status = 'Rejected' OR q.total IS NULL OR q.total <= 0 THEN RAISE EXCEPTION 'La cotización no tiene un importe cobrable'; END IF;
    v_origin := coalesce(nullif(p_origin, ''), 'fabricacion');
    IF v_origin NOT IN ('fabricacion', 'venta_directa', 'trabajo_previo') THEN RAISE EXCEPTION 'Origen inválido'; END IF;
    v_date := coalesce(p_invoice_date, current_date);
    IF v_date > current_date THEN RAISE EXCEPTION 'La fecha de venta no puede ser futura'; END IF;
    SELECT greatest(coalesce(payment_days, 0), 0) INTO credit_days FROM public.clients WHERE id = q.client_id AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'El cliente está inactivo'; END IF;
    v_label := CASE v_origin
        WHEN 'venta_directa' THEN 'venta directa (comprado y entregado, sin fabricación)'
        WHEN 'trabajo_previo' THEN 'trabajo ya realizado, registrado después'
        ELSE 'fabricación' END;
    INSERT INTO public.ar_invoices (client_id, quotation_id, source_type, source_id, concept, invoice_number, invoice_date, due_date,
        gross_amount, vat_amount, net_amount, created_by, updated_by, notes, sale_origin)
    VALUES (q.client_id, q.id, 'sale', q.id, coalesce(nullif(q.title, ''), q.quotation_number), q.quotation_number, v_date, v_date + credit_days,
        q.subtotal, q.vat_total, q.total, p_employee_id, p_employee_id,
        'Origen: cotización ' || q.quotation_number || ' — ' || v_label || '.' || coalesce(' ' || nullif(btrim(p_notes), ''), ''), v_origin)
    RETURNING id INTO result;
    -- Si se cobra es porque se vendió.
    IF q.status IN ('Draft', 'Sent') THEN
        UPDATE public.quotations SET status = 'Approved', updated_at = now() WHERE id = q.id;
    END IF;
    RETURN result;
END;
$$;

-- Los extras se agregan al final de las partidas.
CREATE OR REPLACE FUNCTION public.add_quotation_extra(p_quotation_id uuid, p_description text, p_quantity numeric, p_unit_price numeric, p_note text) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE q public.quotations; result uuid; amount numeric; new_subtotal numeric; new_vat numeric; new_total numeric;
BEGIN
    SELECT * INTO q FROM public.quotations WHERE id = p_quotation_id FOR UPDATE;
    IF NOT FOUND OR q.status = 'Rejected' THEN RAISE EXCEPTION 'Cotización no disponible'; END IF;
    IF nullif(btrim(p_description),'') IS NULL OR p_quantity IS NULL OR p_unit_price IS NULL OR p_quantity < 0.01 OR p_unit_price < 0
       OR p_quantity::text IN ('NaN','Infinity','-Infinity') OR p_unit_price::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Partida inválida'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.work_orders WHERE quotation_id=q.id AND status <> 'Cancelled') THEN RAISE EXCEPTION 'La cotización aún no está en fabricación'; END IF;
    PERFORM 1 FROM public.ar_invoices WHERE quotation_id=q.id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.ar_invoices WHERE quotation_id=q.id AND (status='cancelled' OR NOT is_active)) THEN RAISE EXCEPTION 'Restaura la cuenta por cobrar antes de agregar extras'; END IF;
    amount := round(round(p_quantity,2)*p_unit_price,2);
    INSERT INTO public.quotation_items(quotation_id,description,quantity,unit_price,line_total,is_extra,extra_note,margin_pct,position)
    VALUES(q.id,'[Extra] ' || btrim(p_description),round(p_quantity,2),p_unit_price,amount,true,nullif(btrim(p_note),''),0,
        (SELECT coalesce(max(position), count(*)) + 1 FROM public.quotation_items WHERE quotation_id = q.id)) RETURNING id INTO result;
    SELECT coalesce(sum(line_total),0) INTO new_subtotal FROM public.quotation_items WHERE quotation_id=q.id;
    new_total := q.total + round(round(p_quantity,2)*p_unit_price*1.16,2);
    new_vat := new_total-new_subtotal;
    UPDATE public.quotations SET subtotal=new_subtotal,vat_total=new_vat,total=new_total,updated_at=now() WHERE id=q.id;
    UPDATE public.ar_invoices SET gross_amount=new_subtotal,vat_amount=new_vat,net_amount=new_total,
        status=CASE WHEN paid_amount=0 THEN 'pending' WHEN paid_amount >= new_total THEN 'paid' ELSE 'partial' END,
        updated_at=now() WHERE quotation_id=q.id;
    RETURN result;
END; $$;

REVOKE ALL ON FUNCTION public.save_quotation(uuid, jsonb, jsonb, jsonb, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_quotation(uuid, jsonb, jsonb, jsonb, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.quotation_to_receivable(uuid, uuid, date, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quotation_to_receivable(uuid, uuid, date, text, text) TO service_role;

COMMIT;
