-- Preserve unit precision when extracting VAT from tax-inclusive prices.
-- Line and document totals remain rounded to currency cents.
ALTER TABLE public.quotation_items ALTER COLUMN unit_price TYPE NUMERIC;

-- Keep inclusive extra prices exact when updating quotations and receivables.
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
    INSERT INTO public.quotation_items(quotation_id,description,quantity,unit_price,line_total,is_extra,extra_note,margin_pct)
    VALUES(q.id,'[Extra] ' || btrim(p_description),round(p_quantity,2),p_unit_price,amount,true,nullif(btrim(p_note),''),0) RETURNING id INTO result;
    SELECT coalesce(sum(line_total),0) INTO new_subtotal FROM public.quotation_items WHERE quotation_id=q.id;
    -- Add the new line's payable total to the stored document total. This
    -- preserves historical rounding of existing lines and previous payments.
    new_total := q.total + round(round(p_quantity,2)*p_unit_price*1.16,2);
    new_vat := new_total-new_subtotal;
    UPDATE public.quotations SET subtotal=new_subtotal,vat_total=new_vat,total=new_total,updated_at=now() WHERE id=q.id;
    UPDATE public.ar_invoices SET gross_amount=new_subtotal,vat_amount=new_vat,net_amount=new_total,
        status=CASE WHEN paid_amount=0 THEN 'pending' WHEN paid_amount >= new_total THEN 'paid' ELSE 'partial' END,
        updated_at=now() WHERE quotation_id=q.id;
    RETURN result;
END; $$;

