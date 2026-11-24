-- Prueba de la fabricación unificada, cierres parciales, Calidad, entregas
-- parciales, garantías y bitácora. Corre contra una base local con todas las
-- migraciones y SIEMPRE termina en ROLLBACK:
--   psql -h 127.0.0.1 -p 55432 -U postgres -v ON_ERROR_STOP=1 -f scripts/test-unified-manufacturing.sql
BEGIN;

CREATE TEMP TABLE t_ids (k text PRIMARY KEY, v uuid);
GRANT ALL ON t_ids TO service_role, anon;

DO $$
DECLARE v_op uuid; v_qc uuid; v_client bigint; v_quote uuid;
BEGIN
    INSERT INTO public.employees (full_name, username, password_hash, role) VALUES ('Operador Prueba', 'qa_t_op', 'x', 'operator') RETURNING id INTO v_op;
    INSERT INTO public.employees (full_name, username, password_hash, role) VALUES ('Calidad Prueba', 'qa_t_qc', 'x', 'operator') RETURNING id INTO v_qc;
    INSERT INTO public.clients (business_name, rfc) VALUES ('Cliente Prueba SA', 'QATM010101AA1') RETURNING id INTO v_client;
    INSERT INTO public.quotations (client_id, status, subtotal, vat_total, total, title) VALUES (v_client, 'Approved', 100, 16, 116, 'Prueba') RETURNING id INTO v_quote;
    INSERT INTO t_ids VALUES ('op', v_op), ('qc', v_qc), ('quote', v_quote),
        ('maq', (SELECT id FROM public.manufacturing_modules WHERE code = 'maquinado')),
        ('sold', (SELECT id FROM public.manufacturing_modules WHERE code = 'soldadura')),
        ('auto', (SELECT id FROM public.manufacturing_modules WHERE code = 'automatizacion')),
        ('wps', (SELECT id FROM public.wps_procedures ORDER BY code LIMIT 1));
END;
$$;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

DO $$
DECLARE
    v_op uuid := (SELECT v FROM t_ids WHERE k = 'op');
    v_qc uuid := (SELECT v FROM t_ids WHERE k = 'qc');
    v_wo uuid; v_s1 uuid; v_s2 uuid; v_lot uuid; v_lot2 uuid; v_child uuid; v_folio text; v_delivery jsonb; v_status text;
    v_failed boolean;
BEGIN
    -- Soldadura sin WPS
    v_failed := false;
    BEGIN
        PERFORM public.create_work_order_v2(jsonb_build_object('work_title', 'Brida', 'quantity', 4, 'quotation_id', (SELECT v FROM t_ids WHERE k = 'quote')),
            ARRAY[(SELECT v FROM t_ids WHERE k = 'maq'), (SELECT v FROM t_ids WHERE k = 'sold')], '{}', v_op);
    EXCEPTION WHEN others THEN v_failed := SQLERRM LIKE '%WPS%';
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'FALLA: soldadura sin WPS debió rechazarse'; END IF;

    v_wo := public.create_work_order_v2(jsonb_build_object('work_title', 'Brida', 'quantity', 4, 'unit', 'pza', 'notes', 'Tolerancia ±0.1',
        'quotation_id', (SELECT v FROM t_ids WHERE k = 'quote')),
        ARRAY[(SELECT v FROM t_ids WHERE k = 'maq'), (SELECT v FROM t_ids WHERE k = 'sold')], ARRAY[(SELECT v FROM t_ids WHERE k = 'wps')], v_op);
    SELECT order_number INTO v_folio FROM public.work_orders WHERE id = v_wo;
    IF v_folio !~ '^OT-[0-9]{5,}$' THEN RAISE EXCEPTION 'FALLA: folio nuevo con formato inesperado %', v_folio; END IF;
    SELECT id INTO v_s1 FROM public.work_order_stages WHERE work_order_id = v_wo AND sequence = 1;
    SELECT id INTO v_s2 FROM public.work_order_stages WHERE work_order_id = v_wo AND sequence = 2;
    IF (SELECT count(*) FROM public.work_order_notes WHERE work_order_id = v_wo) <> 1 THEN RAISE EXCEPTION 'FALLA: la nota inicial no quedó en el historial'; END IF;

    -- Maquinado cierra 2 de 4
    PERFORM public.start_work_order_stage(v_s1, v_op);
    PERFORM public.close_work_order_stage(v_s1, 2, v_op, 'Operador Prueba', 'https://firma/1.png', NULL);
    IF public.work_order_stage_available(v_s1) <> 2 OR public.work_order_stage_available(v_s2) <> 2 THEN
        RAISE EXCEPTION 'FALLA: disponibles por etapa incorrectos';
    END IF;

    -- Soldadura no puede cerrar más de lo que entregó maquinado
    v_failed := false;
    BEGIN
        PERFORM public.close_work_order_stage(v_s2, 3, v_op, NULL, 'https://firma/2.png', NULL);
    EXCEPTION WHEN others THEN v_failed := SQLERRM LIKE 'Solo hay 2 pieza%';
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'FALLA: soldadura cerró más piezas de las disponibles'; END IF;

    -- Firma obligatoria
    v_failed := false;
    BEGIN
        PERFORM public.close_work_order_stage(v_s2, 1, v_op, NULL, '', NULL);
    EXCEPTION WHEN others THEN v_failed := SQLERRM LIKE '%firma%';
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'FALLA: cierre sin firma'; END IF;

    v_lot := public.close_work_order_stage(v_s2, 2, v_op, NULL, 'https://firma/2.png', 'Primer envío');
    IF (SELECT qc_status FROM public.work_order_closures WHERE id = v_lot) <> 'pending' THEN RAISE EXCEPTION 'FALLA: el lote final no quedó pendiente de Calidad'; END IF;
    IF (SELECT status FROM public.work_orders WHERE id = v_wo) <> 'In Progress' THEN RAISE EXCEPTION 'FALLA: estado esperado En curso'; END IF;

    -- Calidad libera 1 y rechaza 1 (con motivo)
    v_failed := false;
    BEGIN
        PERFORM public.decide_work_order_closure(v_lot, 1, v_qc, 'Calidad Prueba', 'https://firma/qc.png', NULL);
    EXCEPTION WHEN others THEN v_failed := SQLERRM LIKE '%motivo%';
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'FALLA: rechazo parcial sin motivo'; END IF;
    PERFORM public.decide_work_order_closure(v_lot, 1, v_qc, 'Calidad Prueba', 'https://firma/qc.png', 'Una pieza con poro');
    IF public.work_order_stage_done(v_s2) <> 1 OR public.work_order_stage_available(v_s2) <> 1 THEN
        RAISE EXCEPTION 'FALLA: la pieza rechazada debió regresar a soldadura';
    END IF;
    IF public.work_order_deliverable_qty(v_wo) <> 1 THEN RAISE EXCEPTION 'FALLA: debía haber 1 pieza por entregar'; END IF;

    -- Entrega parcial
    v_failed := false;
    BEGIN
        PERFORM public.create_work_order_delivery(v_wo, 2, '{}', v_op);
    EXCEPTION WHEN others THEN v_failed := SQLERRM LIKE 'Solo hay 1 pieza%';
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'FALLA: se entregó más de lo liberado'; END IF;
    v_delivery := public.create_work_order_delivery(v_wo, 1, '{"observations":"parcial"}', v_op);
    IF v_delivery ->> 'delivery_number' <> regexp_replace(v_folio, '^OT-', 'NE-') THEN
        RAISE EXCEPTION 'FALLA: número de entrega %', v_delivery ->> 'delivery_number';
    END IF;

    -- Resto del trabajo
    PERFORM public.close_work_order_stage(v_s1, 2, v_op, NULL, 'https://firma/3.png', NULL);
    IF (SELECT status FROM public.work_order_stages WHERE id = v_s1) <> 'Done' THEN RAISE EXCEPTION 'FALLA: maquinado debió quedar terminado'; END IF;
    v_lot2 := public.close_work_order_stage(v_s2, 3, v_op, NULL, 'https://firma/4.png', NULL);
    IF (SELECT status FROM public.work_orders WHERE id = v_wo) <> 'QC' THEN RAISE EXCEPTION 'FALLA: estado esperado En calidad, hay %', (SELECT status FROM public.work_orders WHERE id = v_wo); END IF;
    v_status := public.decide_work_order_closure(v_lot2, 3, v_qc, NULL, 'https://firma/qc2.png', NULL);
    IF v_status <> 'QC_Released' THEN RAISE EXCEPTION 'FALLA: debió quedar liberada, quedó %', v_status; END IF;
    v_delivery := public.create_work_order_delivery(v_wo, 3, '{}', v_op);
    IF v_delivery ->> 'delivery_number' <> regexp_replace(v_folio, '^OT-', 'NE-') || '-2' THEN
        RAISE EXCEPTION 'FALLA: número de la segunda entrega %', v_delivery ->> 'delivery_number';
    END IF;
    IF (SELECT qty_delivered + qty_in_delivery FROM public.v_work_order_progress WHERE work_order_id = v_wo) <> 4 THEN
        RAISE EXCEPTION 'FALLA: avance de entregas';
    END IF;

    -- Garantía: OT ligada con sufijo -G1
    v_child := public.open_work_order_warranty(v_wo, 'garantia', 'Fuga en cordón', 1, NULL, NULL, NULL, v_qc);
    IF (SELECT order_number FROM public.work_orders WHERE id = v_child) <> v_folio || '-G1' THEN RAISE EXCEPTION 'FALLA: folio de garantía'; END IF;
    IF (SELECT count(*) FROM public.work_order_stages WHERE work_order_id = v_child) <> 2 THEN RAISE EXCEPTION 'FALLA: etapas de la garantía'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.work_order_wps WHERE work_order_id = v_child) THEN RAISE EXCEPTION 'FALLA: WPS de la garantía'; END IF;
    IF (SELECT child_work_order_id FROM public.work_order_warranty_events WHERE work_order_id = v_wo) <> v_child THEN RAISE EXCEPTION 'FALLA: registro de garantía'; END IF;
    PERFORM public.open_work_order_warranty(v_wo, 'reparacion', 'Golpe en transporte', 1, ARRAY[(SELECT v FROM t_ids WHERE k = 'maq')], NULL, 'Urgente', v_qc);
    IF NOT EXISTS (SELECT 1 FROM public.work_orders WHERE order_number = v_folio || '-R1' AND order_kind = 'reparacion') THEN RAISE EXCEPTION 'FALLA: folio de reparación'; END IF;

    -- Edición: cantidad, etapas sin actividad y bloqueo de las que ya tienen actividad
    SELECT id INTO v_s1 FROM public.work_order_stages WHERE work_order_id = v_child AND sequence = 1;
    PERFORM public.update_work_order_details(v_child, '{"quantity":2,"work_title":"Brida (garantía)"}',
        ARRAY[(SELECT v FROM t_ids WHERE k = 'maq'), (SELECT v FROM t_ids WHERE k = 'sold'), (SELECT v FROM t_ids WHERE k = 'auto')], NULL, v_op, 'Cliente reporta 2 piezas');
    IF (SELECT count(*) FROM public.work_order_stages WHERE work_order_id = v_child) <> 3 THEN RAISE EXCEPTION 'FALLA: no se agregó la etapa'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.work_order_stages WHERE id = v_s1) THEN RAISE EXCEPTION 'FALLA: se recreó una etapa que no cambió'; END IF;
    PERFORM public.start_work_order_stage((SELECT id FROM public.work_order_stages WHERE work_order_id = v_child AND sequence = 1), v_op);
    v_failed := false;
    BEGIN
        PERFORM public.update_work_order_details(v_child, '{}', ARRAY[(SELECT v FROM t_ids WHERE k = 'sold')], NULL, v_op, NULL);
    EXCEPTION WHEN others THEN v_failed := SQLERRM LIKE '%actividad%';
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'FALLA: se quitó una etapa con actividad'; END IF;
    v_failed := false;
    BEGIN
        PERFORM public.update_work_order_details(v_wo, '{"quantity":3}', NULL, NULL, v_op, NULL);
    EXCEPTION WHEN others THEN v_failed := SQLERRM LIKE '%ya cerradas%';
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'FALLA: cantidad menor a lo cerrado'; END IF;

    -- Pausa y reanudación
    PERFORM public.pause_work_order_stage((SELECT id FROM public.work_order_stages WHERE work_order_id = v_child AND sequence = 1), v_op, 'Falta de materia prima', NULL, NULL);
    IF (SELECT status FROM public.work_orders WHERE id = v_child) <> 'Paused' THEN RAISE EXCEPTION 'FALLA: OT pausada'; END IF;
    PERFORM public.resume_work_order_stage((SELECT id FROM public.work_order_stages WHERE work_order_id = v_child AND sequence = 1), v_op);
    IF (SELECT resumed_at FROM public.work_order_pauses WHERE work_order_id = v_child) IS NULL THEN RAISE EXCEPTION 'FALLA: pausa sin cerrar'; END IF;

    -- Bitácora con autor
    IF NOT EXISTS (SELECT 1 FROM public.audit_log WHERE root_table = 'work_orders' AND root_id = v_wo::text AND table_name = 'work_order_closures' AND actor_id = v_op AND source = 'servidor') THEN
        RAISE EXCEPTION 'FALLA: cierres sin autor en la bitácora';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.audit_log WHERE root_id = v_child::text AND reason = 'Cliente reporta 2 piezas' AND 'quantity' = ANY(changed_fields)) THEN
        RAISE EXCEPTION 'FALLA: edición sin motivo en la bitácora';
    END IF;
    INSERT INTO t_ids VALUES ('wo', v_wo), ('child', v_child);
    RAISE NOTICE 'OK flujo parcial: % (% registros de bitácora)', v_folio, (SELECT count(*) FROM public.audit_log WHERE root_id IN (v_wo::text, v_child::text));
END;
$$;

-- Autor por encabezado de la llave de servicio
SELECT set_config('request.headers', json_build_object('x-smaa-actor', (SELECT v FROM t_ids WHERE k = 'op'))::text, true);
UPDATE public.quotations SET title = 'Prueba editada' WHERE id = (SELECT v FROM t_ids WHERE k = 'quote');
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.audit_log WHERE root_table = 'quotations' AND root_id = (SELECT v FROM t_ids WHERE k = 'quote')::text
                    AND 'title' = ANY(changed_fields) AND actor_id = (SELECT v FROM t_ids WHERE k = 'op')) THEN
        RAISE EXCEPTION 'FALLA: el encabezado x-smaa-actor no identificó al autor';
    END IF;
END;
$$;

-- La llave pública no puede falsificar autor, ni escribir etapas/cierres, ni leer la bitácora
-- (En PostgREST cada petición es su propia transacción; aquí se limpia a mano.)
SELECT set_config('smaa.actor_id', '', true), set_config('smaa.reason', '', true);
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
UPDATE public.quotations SET title = 'Cambio desde el navegador' WHERE id = (SELECT v FROM t_ids WHERE k = 'quote');
DO $$
DECLARE v_failed boolean := false;
BEGIN
    BEGIN
        UPDATE public.work_order_closures SET quantity = 10;
    EXCEPTION WHEN insufficient_privilege THEN v_failed := true;
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'FALLA: anon pudo modificar cierres'; END IF;
    v_failed := false;
    BEGIN
        PERFORM count(*) FROM public.audit_log;
    EXCEPTION WHEN insufficient_privilege THEN v_failed := true;
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'FALLA: anon pudo leer la bitácora'; END IF;
    v_failed := false;
    BEGIN
        PERFORM public.start_work_order_stage((SELECT id FROM public.work_order_stages LIMIT 1), (SELECT v FROM t_ids WHERE k = 'op'));
    EXCEPTION WHEN insufficient_privilege THEN v_failed := true;
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'FALLA: anon pudo ejecutar operaciones de OT'; END IF;
    IF (SELECT count(*) FROM public.v_work_order_progress) = 0 THEN RAISE EXCEPTION 'FALLA: anon no puede leer el avance'; END IF;
END;
$$;
RESET ROLE;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.audit_log WHERE root_id = (SELECT v FROM t_ids WHERE k = 'quote')::text
                    AND new_data ->> 'title' = 'Cambio desde el navegador' AND actor_id IS NULL AND source = 'navegador') THEN
        RAISE EXCEPTION 'FALLA: el cambio desde el navegador no quedó marcado sin autor';
    END IF;
    RAISE NOTICE 'OK bitácora: autor por servidor, encabezado confiable y cambios sin sesión identificados';
END;
$$;

ROLLBACK;
