BEGIN;

DO $$
DECLARE
    v_buyer_id UUID;
    v_requisition_id UUID;
    v_purchase_order_id UUID;
    active_employee_count INTEGER;
    allowed_requester_count INTEGER;
    buyer_count INTEGER;
    test_suffix TEXT := txid_current()::TEXT;
BEGIN
    SELECT COUNT(*)
    INTO buyer_count
    FROM public.employees e
    JOIN public.employee_permissions p ON p.employee_id = e.id
    WHERE e.is_active = TRUE
      AND e.role <> 'master'
      AND p.module_code = 'requisitions'
      AND p.sub_code IS NULL
      AND p.can_purchase = TRUE;

    IF buyer_count <> 1 THEN
        RAISE EXCEPTION 'Se esperaba una sola empleada no-master con can_purchase; encontradas: %', buyer_count;
    END IF;

    SELECT e.id
    INTO v_buyer_id
    FROM public.employees e
    JOIN public.employee_permissions p ON p.employee_id = e.id
    WHERE e.is_active = TRUE
      AND e.role <> 'master'
      AND p.module_code = 'requisitions'
      AND p.sub_code IS NULL
      AND p.can_purchase = TRUE
    LIMIT 1;

    SELECT COUNT(*)
    INTO active_employee_count
    FROM public.employees
    WHERE is_active = TRUE;

    SELECT COUNT(*)
    INTO allowed_requester_count
    FROM public.employees e
    WHERE e.is_active = TRUE
      AND (
          e.role = 'master'
          OR EXISTS (
              SELECT 1
              FROM public.employee_permissions p
              WHERE p.employee_id = e.id
                AND p.module_code = 'requisitions'
                AND p.sub_code IS NULL
                AND (p.can_create = TRUE OR p.can_request_supplies = TRUE)
          )
      );

    IF allowed_requester_count <> active_employee_count THEN
        RAISE EXCEPTION 'No todos los empleados activos pueden crear requisiciones: % de %',
            allowed_requester_count, active_employee_count;
    END IF;

    INSERT INTO public.requisitions (
        code,
        requested_by,
        status,
        priority
    ) VALUES (
        'TEST-SMOKE-REQ-' || test_suffix,
        v_buyer_id,
        'pending',
        'normal'
    )
    RETURNING id INTO v_requisition_id;

    INSERT INTO public.requisition_items (
        requisition_id,
        description,
        quantity,
        unit
    ) VALUES (
        v_requisition_id,
        'Artículo de prueba transaccional',
        1,
        'pza'
    );

    INSERT INTO public.purchase_orders (
        po_number,
        supplier_id,
        status,
        subtotal,
        vat_total,
        total,
        invoice_url,
        evidence_photo_url,
        invoice_date,
        requisition_id,
        purchase_group_id
    ) VALUES (
        'TEST-SMOKE-PO-' || test_suffix,
        NULL,
        'Draft',
        0,
        0,
        0,
        'https://example.com/factura.pdf',
        'https://example.com/recibido.jpg',
        NOW(),
        v_requisition_id,
        gen_random_uuid()
    )
    RETURNING id INTO v_purchase_order_id;

    INSERT INTO public.purchase_order_items (
        purchase_order_id,
        description,
        quantity,
        unit_price,
        line_total
    ) VALUES (
        v_purchase_order_id,
        'Artículo de prueba transaccional',
        1,
        0,
        0
    );

    INSERT INTO public.purchase_order_attachments (
        purchase_order_id,
        kind,
        file_url,
        file_name,
        content_type,
        uploaded_by
    ) VALUES (
        v_purchase_order_id,
        'invoice',
        'https://example.com/factura.pdf',
        'factura.pdf',
        'application/pdf',
        v_buyer_id
    );

    UPDATE public.requisitions
    SET status = 'purchased',
        purchased_at = NOW(),
        purchased_by = v_buyer_id,
        invoice_url = 'https://example.com/factura.pdf',
        invoice_photo_url = 'https://example.com/recibido.jpg'
    WHERE id = v_requisition_id;

    IF NOT EXISTS (
        SELECT 1
        FROM public.requisitions r
        JOIN public.purchase_orders po ON po.requisition_id = r.id
        JOIN public.purchase_order_items poi ON poi.purchase_order_id = po.id
        JOIN public.purchase_order_attachments poa ON poa.purchase_order_id = po.id
        WHERE r.id = v_requisition_id
          AND r.status = 'purchased'
          AND r.purchased_by = v_buyer_id
          AND po.status = 'Draft'
          AND po.evidence_photo_url = 'https://example.com/recibido.jpg'
          AND poa.kind = 'invoice'
    ) THEN
        RAISE EXCEPTION 'El flujo requisición -> compra no quedó consistente.';
    END IF;
END $$;

ROLLBACK;
