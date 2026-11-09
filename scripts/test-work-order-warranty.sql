-- Run only on a local test database after all migrations. Everything rolls back.
BEGIN;
DO $$
DECLARE employee_id uuid; client_id bigint; quote_id uuid; order_id uuid; module_id uuid; invoice_id uuid; snapshot jsonb;
BEGIN
    INSERT INTO employees(full_name,username,password_hash,role) VALUES('QA garantía','qa_warranty_'||gen_random_uuid(),'test-only','master') RETURNING id INTO employee_id;
    INSERT INTO clients(business_name,payment_days) VALUES('QA garantía',15) RETURNING id INTO client_id;
    SELECT id INTO module_id FROM manufacturing_modules WHERE code='maquinado';
    INSERT INTO quotations(client_id,status,subtotal,vat_total,total) VALUES(client_id,'Approved',100,16,116) RETURNING id INTO quote_id;
    order_id := create_work_order(jsonb_build_object('module_id',module_id,'quotation_id',quote_id,'work_title','Garantía QA','priority','Normal'),ARRAY[]::uuid[]);
    invoice_id := quotation_to_receivable(quote_id,employee_id);
    ASSERT (SELECT status='Open' FROM work_orders WHERE id=order_id), 'Billing changed OT status';
    ASSERT quotation_to_receivable(quote_id,employee_id)=invoice_id, 'Duplicate invoice';
    UPDATE work_orders SET status='QC_Released',completed_at=now(),qc_released_at=now(),qc_released_by='QA',operator_signature_url='https://example.invalid/previous.png' WHERE id=order_id;
    INSERT INTO deliveries(delivery_number,work_order_id,stage) VALUES('QA-'||gen_random_uuid(),order_id,'delivered');
    SELECT to_jsonb(i) INTO snapshot FROM ar_invoices i WHERE id=invoice_id;
    PERFORM reopen_work_order_warranty(order_id,employee_id,'Prueba de garantía');
    ASSERT (SELECT status='Open' AND warranty_count=1 AND operator_signature_url IS NULL FROM work_orders WHERE id=order_id), 'Warranty did not reopen correctly';
    ASSERT (SELECT count(*)=1 FROM work_order_warranty_events WHERE work_order_id=order_id), 'Missing audit record';
    ASSERT (SELECT to_jsonb(i)=snapshot FROM ar_invoices i WHERE id=invoice_id), 'Warranty changed receivable';
    ASSERT (SELECT count(*)=1 FROM deliveries WHERE work_order_id=order_id AND stage='delivered'), 'Historical delivery lost';
    BEGIN
        INSERT INTO deliveries(delivery_number,work_order_id,stage) VALUES('QA-'||gen_random_uuid(),order_id,'delivered');
        RAISE EXCEPTION 'Expected warranty delivery to be blocked';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM NOT LIKE '%Calidad debe liberarla%' THEN RAISE; END IF;
    END;
    ASSERT NOT has_function_privilege('anon','reopen_work_order_warranty(uuid,uuid,text)','EXECUTE');
    ASSERT NOT has_function_privilege('authenticated','quotation_to_receivable(uuid,uuid)','EXECUTE');
    ASSERT has_function_privilege('service_role','reopen_work_order_warranty(uuid,uuid,text)','EXECUTE');
    RAISE NOTICE 'PASS: full migrated schema, early AR, warranty audit, unchanged finances, historical delivery and new release requirement';
END $$;
ROLLBACK;
