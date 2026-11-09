-- Run only against the local QA database after the migrations. No rows persist.
BEGIN;
DO $$
DECLARE c bigint := -987654321; q uuid; employee uuid; invoice uuid; amounts record;
BEGIN
    INSERT INTO clients(id,business_name) VALUES(c,'Pricing transaction test');
    INSERT INTO employees(full_name,username,password_hash,role)
        VALUES('Pricing transaction','pricing-'||gen_random_uuid(),'unused-test-hash','master') RETURNING id INTO employee;
    INSERT INTO quotations(client_id,status,subtotal,vat_total,total)
        VALUES(c,'Approved',.03,.01,.04) RETURNING id INTO q;
    INSERT INTO quotation_items(quotation_id,description,quantity,unit_price,line_total)
        VALUES(q,'Original inclusive',1,.04/1.16,.03);
    INSERT INTO work_orders(order_number,quotation_id,status) VALUES('PRICING-'||gen_random_uuid(),q,'Open');
    SELECT quotation_to_receivable(q,employee) INTO invoice;
    PERFORM add_quotation_extra(q,'Low inclusive extra',1,.04/1.16,'IVA test');
    SELECT subtotal,vat_total,total INTO amounts FROM quotations WHERE id=q;
    IF amounts.subtotal<>.06 OR amounts.vat_total<>.02 OR amounts.total<>.08 THEN
        RAISE EXCEPTION 'Quote breakdown incorrect: %',amounts;
    END IF;
    SELECT gross_amount,vat_amount,net_amount,balance INTO amounts FROM ar_invoices WHERE id=invoice;
    IF amounts.gross_amount<>.06 OR amounts.vat_amount<>.02 OR amounts.net_amount<>.08 OR amounts.balance<>.08 THEN
        RAISE EXCEPTION 'Receivable breakdown incorrect: %',amounts;
    END IF;
    PERFORM add_quotation_extra(q,'Repeated units',3,100.01/1.16,'IVA test');
    SELECT total INTO amounts FROM quotations WHERE id=q;
    IF amounts.total<>300.11 THEN RAISE EXCEPTION 'Extra unit precision lost: %',amounts; END IF;
    RAISE NOTICE 'Pricing SQL: inclusive extras, original rounding, AR balance, repeated units passed';
END $$;
ROLLBACK;
