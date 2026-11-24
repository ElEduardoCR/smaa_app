-- Edición de cotizaciones con historial y envío a CxC sin OT. Termina en ROLLBACK:
--   psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 -f scripts/test-quotation-editing.sql
BEGIN;
CREATE TEMP TABLE t_ids (k text PRIMARY KEY, v text);
GRANT ALL ON t_ids TO service_role;

DO $$
DECLARE v_emp uuid; v_client bigint; v_client2 bigint;
BEGIN
    INSERT INTO public.employees (full_name, username, password_hash, role) VALUES ('Vendedor Prueba', 'qa_t_sales', 'x', 'operator') RETURNING id INTO v_emp;
    INSERT INTO public.clients (business_name, rfc, payment_days) VALUES ('Cliente Crédito', 'QATQ010101AA1', 30) RETURNING id INTO v_client;
    INSERT INTO public.clients (business_name, rfc) VALUES ('Otro Cliente', 'QATQ010101AA2') RETURNING id INTO v_client2;
    INSERT INTO t_ids VALUES ('emp', v_emp::text), ('client', v_client::text), ('client2', v_client2::text);
END;
$$;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

DO $$
DECLARE
    v_emp uuid := (SELECT v FROM t_ids WHERE k = 'emp')::uuid;
    v_client text := (SELECT v FROM t_ids WHERE k = 'client');
    v_q uuid; v_ar uuid; v_item1 uuid; v_item2 uuid; v_failed boolean; v_inv public.ar_invoices;
BEGIN
    v_q := public.save_quotation(NULL, jsonb_build_object('client_id', v_client, 'title', 'Tornillería'),
        '[{"description":"Tornillo","quantity":10,"unit_price":5,"line_total":50,"cost_unit_price":4,"cost_line_total":40,"margin_pct":25},
          {"description":"Tuerca","quantity":10,"unit_price":5,"line_total":50,"cost_unit_price":4,"cost_line_total":40,"margin_pct":25}]',
        '{"subtotal":100,"vat":16,"total":116}', v_emp, NULL);
    SELECT id INTO v_item1 FROM public.quotation_items WHERE quotation_id = v_q AND description = 'Tornillo';
    SELECT id INTO v_item2 FROM public.quotation_items WHERE quotation_id = v_q AND description = 'Tuerca';

    -- Venta directa sin OT, registrada con fecha pasada
    v_ar := public.quotation_to_receivable(v_q, v_emp, current_date - 10, 'venta_directa', 'Se compró y entregó');
    SELECT * INTO v_inv FROM public.ar_invoices WHERE id = v_ar;
    IF v_inv.invoice_date <> current_date - 10 OR v_inv.due_date <> current_date + 20 OR v_inv.sale_origin <> 'venta_directa' THEN
        RAISE EXCEPTION 'FALLA: fechas/origen de la cuenta por cobrar';
    END IF;
    IF (SELECT status FROM public.quotations WHERE id = v_q) <> 'Approved' THEN RAISE EXCEPTION 'FALLA: la cotización debió aprobarse'; END IF;
    IF public.quotation_to_receivable(v_q, v_emp, NULL, 'venta_directa', NULL) <> v_ar THEN RAISE EXCEPTION 'FALLA: no es idempotente'; END IF;
    v_failed := false;
    BEGIN
        PERFORM public.quotation_to_receivable(public.save_quotation(NULL, jsonb_build_object('client_id', v_client),
            '[{"description":"X","quantity":1,"unit_price":1,"line_total":1}]', '{"subtotal":1,"vat":0.16,"total":1.16}', v_emp, NULL),
            v_emp, current_date + 1, 'trabajo_previo', NULL);
    EXCEPTION WHEN others THEN v_failed := SQLERRM LIKE '%futura%';
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'FALLA: aceptó fecha futura'; END IF;

    INSERT INTO t_ids VALUES ('q', v_q::text), ('ar', v_ar::text), ('item1', v_item1::text), ('item2', v_item2::text);
END;
$$;

-- Pago de $50 (como lo registra CxC)
RESET ROLE;
WITH p AS (
    INSERT INTO public.ar_payments (client_id, amount, registered_by)
    VALUES ((SELECT v FROM t_ids WHERE k = 'client')::bigint, 50, (SELECT v FROM t_ids WHERE k = 'emp')::uuid) RETURNING id
)
INSERT INTO public.ar_payment_allocations (payment_id, invoice_id, amount_applied) SELECT id, (SELECT v FROM t_ids WHERE k = 'ar')::uuid, 50 FROM p;
SET LOCAL ROLE service_role;

DO $$
DECLARE
    v_emp uuid := (SELECT v FROM t_ids WHERE k = 'emp')::uuid;
    v_q uuid := (SELECT v FROM t_ids WHERE k = 'q')::uuid;
    v_item1 text := (SELECT v FROM t_ids WHERE k = 'item1');
    v_failed boolean; v_inv public.ar_invoices;
BEGIN
    -- Edición: sube el precio del tornillo, quita la tuerca y agrega arandela
    PERFORM public.save_quotation(v_q, jsonb_build_object('client_id', (SELECT v FROM t_ids WHERE k = 'client'), 'title', 'Tornillería'),
        jsonb_build_array(
            jsonb_build_object('id', v_item1, 'description', 'Tornillo', 'quantity', 10, 'unit_price', 6, 'line_total', 60, 'cost_unit_price', 4, 'cost_line_total', 40, 'margin_pct', 50),
            jsonb_build_object('description', 'Arandela', 'quantity', 10, 'unit_price', 1, 'line_total', 10, 'cost_unit_price', 0.5, 'cost_line_total', 5, 'margin_pct', 100)),
        '{"subtotal":70,"vat":11.2,"total":81.2}', v_emp, 'Precio actualizado por proveedor');
    IF (SELECT id::text FROM public.quotation_items WHERE quotation_id = v_q AND description = 'Tornillo') <> v_item1 THEN
        RAISE EXCEPTION 'FALLA: la partida editada cambió de id';
    END IF;
    SELECT * INTO v_inv FROM public.ar_invoices WHERE quotation_id = v_q;
    IF v_inv.net_amount <> 81.2 OR v_inv.paid_amount <> 50 OR v_inv.status <> 'partial' THEN
        RAISE EXCEPTION 'FALLA: CxC no siguió la edición (net %, pagado %, estado %)', v_inv.net_amount, v_inv.paid_amount, v_inv.status;
    END IF;

    -- No puede quedar por debajo de lo cobrado
    v_failed := false;
    BEGIN
        PERFORM public.save_quotation(v_q, jsonb_build_object('client_id', (SELECT v FROM t_ids WHERE k = 'client')),
            jsonb_build_array(jsonb_build_object('id', v_item1, 'description', 'Tornillo', 'quantity', 1, 'unit_price', 6, 'line_total', 6)),
            '{"subtotal":6,"vat":0.96,"total":6.96}', v_emp, NULL);
    EXCEPTION WHEN others THEN v_failed := SQLERRM LIKE '%ya cobrado%';
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'FALLA: total menor a lo cobrado'; END IF;

    -- Cliente bloqueado si ya hay CxC
    v_failed := false;
    BEGIN
        PERFORM public.save_quotation(v_q, jsonb_build_object('client_id', (SELECT v FROM t_ids WHERE k = 'client2')),
            jsonb_build_array(jsonb_build_object('id', v_item1, 'description', 'Tornillo', 'quantity', 10, 'unit_price', 6, 'line_total', 60)),
            '{"subtotal":60,"vat":9.6,"total":69.6}', v_emp, NULL);
    EXCEPTION WHEN others THEN v_failed := SQLERRM LIKE '%cliente%';
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'FALLA: se cambió el cliente con CxC'; END IF;

    -- Historial: precio anterior → nuevo, partida borrada y nueva, con autor y motivo
    IF NOT EXISTS (SELECT 1 FROM public.audit_log WHERE root_table = 'quotations' AND root_id = v_q::text AND table_name = 'quotation_items'
                    AND operation = 'UPDATE' AND old_data ->> 'unit_price' = '5' AND new_data ->> 'unit_price' = '6'
                    AND actor_id = v_emp AND reason = 'Precio actualizado por proveedor') THEN
        RAISE EXCEPTION 'FALLA: historial del cambio de precio';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.audit_log WHERE root_id = v_q::text AND table_name = 'quotation_items' AND operation = 'DELETE' AND old_data ->> 'description' = 'Tuerca') THEN
        RAISE EXCEPTION 'FALLA: historial de la partida eliminada';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.audit_log WHERE table_name = 'ar_invoices' AND root_id = (SELECT v FROM t_ids WHERE k = 'ar') AND 'net_amount' = ANY(changed_fields)) THEN
        RAISE EXCEPTION 'FALLA: historial de la CxC';
    END IF;
    RAISE NOTICE 'OK cotizaciones: edición con historial, CxC directa y pagos conservados';
END;
$$;
ROLLBACK;
