// Limpieza manual de datos TEST_ que quedaron de runs anteriores
import { Client } from 'pg';

const DB_URL = process.env.DB_URL;
if (!DB_URL) {
    console.error('Falta DB_URL');
    process.exit(1);
}

(async () => {
    const c = new Client({ connectionString: DB_URL });
    await c.connect();

    console.log('Limpiando datos TEST_ huérfanos...');
    // Primero: borrar TODOS los POs/items que referencian a suppliers de prueba
    await c.query(`DELETE FROM purchase_order_items WHERE purchase_order_id IN (SELECT po.id FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE s.rfc LIKE 'TEST%')`);
    await c.query(`DELETE FROM purchase_orders WHERE supplier_id IN (SELECT id FROM suppliers WHERE rfc LIKE 'TEST%')`);
    // Luego: los POs con notas de prueba o linkeados a requisiciones de test
    await c.query(`DELETE FROM purchase_order_items WHERE purchase_order_id IN (SELECT id FROM purchase_orders WHERE notes = 'Notas de prueba' OR requisition_id IN (SELECT id FROM requisitions WHERE code LIKE 'TEST-%'))`);
    await c.query(`DELETE FROM purchase_orders WHERE notes = 'Notas de prueba' OR requisition_id IN (SELECT id FROM requisitions WHERE code LIKE 'TEST-%')`);
    // Requisiciones
    await c.query(`DELETE FROM requisition_items WHERE requisition_id IN (SELECT id FROM requisitions WHERE code LIKE 'TEST-%')`);
    await c.query(`DELETE FROM requisition_quotations WHERE requisition_id IN (SELECT id FROM requisitions WHERE code LIKE 'TEST-%')`);
    await c.query(`DELETE FROM requisitions WHERE code LIKE 'TEST-%'`);
    // Cualquier huérfano
    await c.query(`DELETE FROM purchase_order_items WHERE purchase_order_id NOT IN (SELECT id FROM purchase_orders)`);
    // AR: promesas + allocations + pagos + links + partidas
    await c.query(`DELETE FROM ar_payment_promise_items WHERE promise_id IN (SELECT id FROM ar_payment_promises WHERE client_notes = 'TEST promesa')`);
    await c.query(`DELETE FROM ar_payment_promises WHERE client_notes = 'TEST promesa'`);
    await c.query(`DELETE FROM ar_payment_allocations WHERE invoice_id IN (SELECT id FROM ar_invoices WHERE concept LIKE 'TEST SA AR%' OR concept LIKE 'TEST AR%')`);
    await c.query(`DELETE FROM ar_payments WHERE client_id IN (SELECT id FROM clients WHERE rfc LIKE 'TESTSACX%' OR business_name = 'TEST AR Client')`);
    await c.query(`DELETE FROM ar_share_links WHERE client_id IN (SELECT id FROM clients WHERE rfc LIKE 'TESTSACX%' OR business_name = 'TEST AR Client')`);
    await c.query(`DELETE FROM ar_invoices WHERE concept LIKE 'TEST SA AR%' OR concept LIKE 'TEST AR%'`);
    await c.query(`DELETE FROM clients WHERE business_name IN ('TEST AR Client', 'TEST SA AR Client')`);
    // Suppliers
    await c.query(`DELETE FROM suppliers WHERE rfc LIKE 'TEST%'`);
    // Empleados
    await c.query(`DELETE FROM employee_permissions WHERE employee_id IN (SELECT id FROM employees WHERE username LIKE 'TEST_%')`);
    await c.query(`DELETE FROM employees WHERE username LIKE 'TEST_%'`);
    console.log('Limpieza OK');
    await c.end();
})();
