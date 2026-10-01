-- =============================================================================
-- Limpieza de los datos de ejemplo que crea la batería E2E de QA (qa/e2e).
--
-- Sólo borra registros ligados a identificadores EXACTOS de la batería
-- (usuarios qa_*, RFCs QA de proveedores/clientes, UUID del CFDI de prueba),
-- nunca por coincidencias de texto, para no tocar datos reales.
--
-- Uso (SQL Editor de Supabase o psql). Revisa los conteos del SELECT final
-- antes de cambiar ROLLBACK por COMMIT.
--
-- Nota: los archivos en Storage no se borran desde SQL (Supabase lo
-- desaconseja: quedarían huérfanos en el almacenamiento). Las rutas de los
-- archivos de prueba incluyen el id de la PO / OT / empleado, así que se
-- pueden quitar desde el dashboard de Storage si hace falta.
-- =============================================================================
BEGIN;

CREATE TEMP TABLE qa_emp ON COMMIT DROP AS
    SELECT id FROM public.employees
    WHERE username IN ('qa_master', 'qa_admin', 'qa_operador', 'qa_almacen', 'qa_finanzas',
                       'qa_cxc', 'qa_calidad', 'qa_docs', 'qa_direccion');

CREATE TEMP TABLE qa_sup ON COMMIT DROP AS
    SELECT id FROM public.suppliers
    WHERE rfc IN ('QAP010101AAA', 'QAD020202BBB', 'MUÑ850101AB1');

CREATE TEMP TABLE qa_cli ON COMMIT DROP AS
    SELECT id FROM public.clients WHERE rfc IN ('QAC010101AAA', 'PEÑA800101AB1');

CREATE TEMP TABLE qa_req ON COMMIT DROP AS
    SELECT id FROM public.requisitions WHERE requested_by IN (SELECT id FROM qa_emp);

CREATE TEMP TABLE qa_po ON COMMIT DROP AS
    SELECT id FROM public.purchase_orders
    WHERE requisition_id IN (SELECT id FROM qa_req)
       OR supplier_id IN (SELECT id FROM qa_sup);

CREATE TEMP TABLE qa_quote ON COMMIT DROP AS
    SELECT id FROM public.quotations WHERE client_id IN (SELECT id FROM qa_cli);

CREATE TEMP TABLE qa_wo ON COMMIT DROP AS
    SELECT id FROM public.work_orders WHERE quotation_id IN (SELECT id FROM qa_quote);

-- Entregas y fabricación
DELETE FROM public.delivery_photos WHERE delivery_id IN (SELECT id FROM public.deliveries WHERE work_order_id IN (SELECT id FROM qa_wo));
DELETE FROM public.deliveries WHERE work_order_id IN (SELECT id FROM qa_wo);
DELETE FROM public.work_order_qc_records WHERE work_order_id IN (SELECT id FROM qa_wo);
DELETE FROM public.work_order_completion_photos WHERE work_order_id IN (SELECT id FROM qa_wo);
DELETE FROM public.work_order_pauses WHERE work_order_id IN (SELECT id FROM qa_wo);
DELETE FROM public.work_order_notes WHERE work_order_id IN (SELECT id FROM qa_wo);
DELETE FROM public.work_order_files WHERE work_order_id IN (SELECT id FROM qa_wo);
DELETE FROM public.work_order_operators WHERE work_order_id IN (SELECT id FROM qa_wo);
DELETE FROM public.work_order_wps WHERE work_order_id IN (SELECT id FROM qa_wo);
DELETE FROM public.work_orders WHERE id IN (SELECT id FROM qa_wo);

-- Ventas / cuentas por cobrar
DELETE FROM public.ar_invoices WHERE quotation_id IN (SELECT id FROM qa_quote);
DELETE FROM public.quotation_items WHERE quotation_id IN (SELECT id FROM qa_quote);
DELETE FROM public.quotations WHERE id IN (SELECT id FROM qa_quote);

-- Compras y requisiciones
DELETE FROM public.purchase_order_attachments WHERE purchase_order_id IN (SELECT id FROM qa_po);
DELETE FROM public.purchase_order_items WHERE purchase_order_id IN (SELECT id FROM qa_po);
DELETE FROM public.purchase_orders WHERE id IN (SELECT id FROM qa_po);
DELETE FROM public.requisition_quotations WHERE requisition_id IN (SELECT id FROM qa_req);
DELETE FROM public.requisition_items WHERE requisition_id IN (SELECT id FROM qa_req);
DELETE FROM public.requisitions WHERE id IN (SELECT id FROM qa_req);

-- Catálogos
DELETE FROM public.suppliers WHERE id IN (SELECT id FROM qa_sup);
DELETE FROM public.clients WHERE id IN (SELECT id FROM qa_cli);
DELETE FROM public.issued_invoices WHERE uuid = '11111111-2222-3333-4444-555555555555';

-- Usuarios de prueba (expediente, nómina y permisos van en cascada)
DELETE FROM public.employee_documents WHERE employee_id IN (SELECT id FROM qa_emp);
DELETE FROM public.employee_permissions WHERE employee_id IN (SELECT id FROM qa_emp);
DELETE FROM public.payroll_employees WHERE employee_id IN (SELECT id FROM qa_emp);
DELETE FROM public.employees WHERE id IN (SELECT id FROM qa_emp);

-- Verificación: todo debe quedar en 0
SELECT
    (SELECT count(*) FROM public.employees WHERE username LIKE 'qa\_%') AS empleados_qa,
    (SELECT count(*) FROM public.suppliers WHERE rfc IN ('QAP010101AAA', 'QAD020202BBB', 'MUÑ850101AB1')) AS proveedores_qa,
    (SELECT count(*) FROM public.clients WHERE rfc IN ('QAC010101AAA', 'PEÑA800101AB1')) AS clientes_qa;

ROLLBACK;  -- cambia a COMMIT cuando los conteos sean correctos
