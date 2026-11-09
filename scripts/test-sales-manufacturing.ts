/** Local integration tests. Creates and removes only its own isolated database.
 * Run: npx tsx scripts/test-sales-manufacturing.ts
 * Requires a local PostgreSQL server; never reads the production DB_URL.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { matchesSearch, partyLabel } from '../src/lib/search';

async function main() {
const database = `smaa_workflow_test_${process.pid}`;
const admin = new Client({ host: 'localhost', database: 'postgres' });
const pool = new Pool({ host: 'localhost', database, max: 12 });
const migration = (name: string) => readFileSync(`supabase/migrations/${name}.sql`, 'utf8');
await admin.connect();
await admin.query(`CREATE DATABASE ${database}`);
try {
    await pool.query(`
        CREATE SCHEMA storage;
        CREATE TABLE storage.buckets(id text primary key, allowed_mime_types text[]);
        INSERT INTO storage.buckets VALUES ('purchase_files',ARRAY['application/pdf']);
        CREATE TABLE public.clients(id bigserial primary key,business_name text,payment_days integer DEFAULT 0,is_active boolean DEFAULT true);
        CREATE TABLE public.employees(id uuid primary key DEFAULT gen_random_uuid(),full_name text NOT NULL DEFAULT 'Empleado prueba',is_active boolean NOT NULL DEFAULT true);
        CREATE TABLE public.manufacturing_modules(id uuid primary key DEFAULT gen_random_uuid(),code text,is_active boolean DEFAULT true);
        CREATE TABLE public.wps_procedures(id uuid primary key DEFAULT gen_random_uuid());
    `);
    await pool.query(migration('20260228210226_create_sales_schema'));
    await pool.query(migration('20260601150000_add_item_type_to_quotation_items'));
    await pool.query(migration('20260601160000_add_margin_to_quotation_items'));
    await pool.query(`CREATE TABLE public.work_orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_number text UNIQUE NOT NULL,module_id uuid REFERENCES manufacturing_modules(id),quotation_id uuid REFERENCES quotations(id),client_name text,client_rfc text,work_title text,priority text,notes text,status text DEFAULT 'Open');
        CREATE TABLE public.work_order_wps(work_order_id uuid REFERENCES work_orders(id),wps_id uuid REFERENCES wps_procedures(id),PRIMARY KEY(work_order_id,wps_id));`);
    await pool.query(migration('20260729020000_ar_module'));
    await pool.query(migration('20260729020001_fix_ar_trigger'));
    const clientId = (await pool.query("INSERT INTO clients(business_name,payment_days) VALUES('Cliente prueba',30) RETURNING id")).rows[0].id;
    const employeeId = (await pool.query('INSERT INTO employees DEFAULT VALUES RETURNING id')).rows[0].id;
    const moduleId = (await pool.query("INSERT INTO manufacturing_modules(code) VALUES('maquinado') RETURNING id")).rows[0].id;
    const weldingId = (await pool.query("INSERT INTO manufacturing_modules(code) VALUES('soldadura') RETURNING id")).rows[0].id;
    const quoteId = (await pool.query("INSERT INTO quotations(client_id,status,subtotal,vat_total,total) VALUES($1,'Approved',100,16,116) RETURNING id",[clientId])).rows[0].id;
    await pool.query("INSERT INTO quotation_items(quotation_id,description,quantity,unit_price,line_total) VALUES($1,'Original',1,100,100)",[quoteId]);
    await pool.query("INSERT INTO work_orders(order_number,module_id,quotation_id) VALUES('OT-MAQ-99999',$1,$2)",[moduleId,quoteId]);
    const sql = migration('20260918210804_sales_manufacturing_workflow').replaceAll('TO anon, authenticated','TO CURRENT_USER');
    await pool.query(sql);
    const mimeTypes = (await pool.query("SELECT allowed_mime_types FROM storage.buckets WHERE id='purchase_files'")).rows[0].allowed_mime_types;
    for (const type of ['application/pdf','image/jpeg','image/png','image/heic']) assert(mimeTypes.includes(type));
    const order = {module_id:moduleId,quotation_id:quoteId,work_title:'Prueba simultánea',priority:'Normal'};
    await Promise.all(Array.from({length:20},()=>pool.query('SELECT create_work_order($1,$2)',[order,[]])));
    const counts = (await pool.query('SELECT count(*)::int AS n,count(DISTINCT order_number)::int AS unique_n FROM work_orders')).rows[0];
    assert.equal(counts.n,21); assert.equal(counts.unique_n,21);
    assert.equal((await pool.query("SELECT count(*)::int n FROM work_orders WHERE order_number='OT-MAQ-100000'")).rows[0].n,1);
    await assert.rejects(pool.query('SELECT create_work_order($1,$2)',[{...order,module_id:weldingId},[]]),/WPS/);
    await assert.rejects(pool.query('SELECT create_work_order($1,$2)',[order,[randomUUID()]]),/foreign key/);
    assert.equal((await pool.query('SELECT count(*)::int n FROM work_orders')).rows[0].n,21);
    await assert.rejects(pool.query('SELECT quotation_to_receivable($1,$2)',[quoteId,employeeId]),/termina/);
    await Promise.all(Array.from({length:5},()=>pool.query('SELECT add_quotation_extra($1,$2,$3,$4,$5)',[quoteId,'Soporte',2,25,'Solicitado durante fabricación'])));
    assert.equal((await pool.query('SELECT total FROM quotations WHERE id=$1',[quoteId])).rows[0].total,'406.00');
    assert.equal((await pool.query("SELECT count(*)::int n FROM quotation_items WHERE NOT is_extra AND description='Original'")).rows[0].n,1);
    await assert.rejects(pool.query('SELECT add_quotation_extra($1,$2,$3,$4,$5)',[quoteId,'Inválido',0,25,'']),/inválida/);
    await pool.query(`ALTER TABLE work_orders ADD COLUMN started_at timestamptz, ADD COLUMN paused_at timestamptz, ADD COLUMN completed_at timestamptz,
        ADD COLUMN operator_signature_url text, ADD COLUMN qc_released_at timestamptz, ADD COLUMN qc_released_by text,
        ADD COLUMN qc_rejected_at timestamptz, ADD COLUMN qc_reject_reason text, ADD COLUMN qc_approved boolean, ADD COLUMN qc_approved_at timestamptz;
        CREATE TABLE work_order_notes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),work_order_id uuid REFERENCES work_orders(id),note text,created_by uuid REFERENCES employees(id),created_by_name text);
        CREATE TABLE deliveries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),work_order_id uuid REFERENCES work_orders(id),stage text,packaged_at timestamptz);`);
    const warrantySql = migration('20261109185938_work_order_warranty_and_early_receivables');
    await pool.query(warrantySql);
    const transfers = await Promise.all(Array.from({length:10},()=>pool.query('SELECT quotation_to_receivable($1,$2) AS id',[quoteId,employeeId])));
    assert.equal((await pool.query("SELECT count(*)::int n FROM work_orders WHERE status='Open'")).rows[0].n,21, 'Early billing must not complete/release any OT');
    assert.equal(new Set(transfers.map(r=>r.rows[0].id)).size,1);
    const invoiceId=transfers[0].rows[0].id;
    const invoice=(await pool.query('SELECT *,due_date-invoice_date AS days FROM ar_invoices WHERE id=$1',[invoiceId])).rows[0];
    assert.equal(invoice.client_id,clientId); assert.equal(invoice.days,30); assert.equal(invoice.net_amount,'406.00');
    const paymentId=(await pool.query('INSERT INTO ar_payments(client_id,amount,registered_by) VALUES($1,406,$2) RETURNING id',[clientId,employeeId])).rows[0].id;
    await pool.query('INSERT INTO ar_payment_allocations(payment_id,invoice_id,amount_applied) VALUES($1,$2,406)',[paymentId,invoiceId]);
    await pool.query('SELECT add_quotation_extra($1,$2,$3,$4,$5)',[quoteId,'Extra después del pago',1,100,'Nueva solicitud']);
    const after=(await pool.query('SELECT * FROM ar_invoices WHERE id=$1',[invoiceId])).rows[0];
    assert.equal(after.net_amount,'522.00'); assert.equal(after.paid_amount,'406.00'); assert.equal(after.balance,'116.00'); assert.equal(after.status,'partial');
    // Simulate an allocation update whose caller calculated an obsolete status.
    await pool.query("UPDATE ar_invoices SET paid_amount=406,status='paid' WHERE id=$1",[invoiceId]);
    assert.equal((await pool.query('SELECT status FROM ar_invoices WHERE id=$1',[invoiceId])).rows[0].status,'partial');
    // Warranty reopening is atomic and keeps previous evidence and finances.
    const woId = (await pool.query('SELECT id FROM work_orders LIMIT 1')).rows[0].id;
    await assert.rejects(pool.query('SELECT reopen_work_order_warranty($1,$2,$3)', [woId,employeeId,'   ']), /motivo/);
    await assert.rejects(pool.query('SELECT reopen_work_order_warranty($1,$2,$3)', [woId,employeeId,'Corrección de ajuste']), /liberadas/);
    await pool.query("UPDATE work_orders SET status='QC_Released',started_at=now()-interval '2 days',completed_at=now()-interval '1 day',qc_released_at=now(),qc_released_by='Calidad QA',operator_signature_url='https://example.invalid/firma.png' WHERE id=$1",[woId]);
    const deliveredId = (await pool.query("INSERT INTO deliveries(work_order_id,stage) VALUES($1,'delivered') RETURNING id",[woId])).rows[0].id;
    const beforeWarranty = (await pool.query('SELECT * FROM work_orders WHERE id=$1',[woId])).rows[0];
    const reopenResults = await Promise.allSettled(Array.from({length:3},()=>pool.query('SELECT reopen_work_order_warranty($1,$2,$3)',[woId,employeeId,'Corrección de ajuste'])));
    assert.equal(reopenResults.filter(r=>r.status==='fulfilled').length,1);
    const reopened = (await pool.query('SELECT * FROM work_orders WHERE id=$1',[woId])).rows[0];
    assert.equal(reopened.status,'Open'); assert.equal(reopened.order_number,beforeWarranty.order_number); assert.equal(reopened.quotation_id,quoteId);
    assert.equal(reopened.warranty_count,1); assert.equal(reopened.started_at,null); assert.equal(reopened.completed_at,null); assert.equal(reopened.operator_signature_url,null); assert.equal(reopened.qc_released_at,null);
    const history = (await pool.query('SELECT * FROM work_order_warranty_events WHERE work_order_id=$1',[woId])).rows;
    assert.equal(history.length,1); assert.equal(history[0].previous_state.operator_signature_url,'https://example.invalid/firma.png'); assert.equal(history[0].previous_state.qc_released_by,'Calidad QA'); assert.equal(history[0].reopened_by,employeeId);
    assert.equal((await pool.query('SELECT count(*)::int n FROM work_order_notes WHERE work_order_id=$1',[woId])).rows[0].n,1);
    assert.equal((await pool.query('SELECT stage FROM deliveries WHERE id=$1',[deliveredId])).rows[0].stage,'delivered');
    await assert.rejects(pool.query("INSERT INTO deliveries(work_order_id,stage) VALUES($1,'delivered')",[woId]), /Calidad/);
    assert.equal((await pool.query('SELECT quotation_to_receivable($1,$2) id',[quoteId,employeeId])).rows[0].id,invoiceId);
    const finances = (await pool.query('SELECT paid_amount,balance,net_amount,status FROM ar_invoices WHERE id=$1',[invoiceId])).rows[0];
    assert.deepEqual(finances,{paid_amount:'406.00',balance:'116.00',net_amount:'522.00',status:'partial'});
    await pool.query("UPDATE work_orders SET status='QC_Released',qc_released_at=now(),qc_released_by='Calidad nueva' WHERE id=$1",[woId]);
    await pool.query("INSERT INTO deliveries(work_order_id,stage) VALUES($1,'delivered')",[woId]);
    await pool.query('SELECT reopen_work_order_warranty($1,$2,$3)',[woId,employeeId,'Segunda garantía']);
    assert.equal((await pool.query('SELECT warranty_count FROM work_orders WHERE id=$1',[woId])).rows[0].warranty_count,2);
    assert.equal((await pool.query("SELECT has_function_privilege('anon','reopen_work_order_warranty(uuid,uuid,text)','EXECUTE') allowed")).rows[0].allowed,false);
    assert.equal((await pool.query("SELECT has_function_privilege('anon','quotation_to_receivable(uuid,uuid)','EXECUTE') allowed")).rows[0].allowed,false);
    assert.equal((await pool.query("SELECT count(*)::int n FROM pg_proc WHERE proname IN ('create_work_order','add_quotation_extra','quotation_to_receivable','quotation_ar_amount_status') AND prosecdef")).rows[0].n,0);
    await pool.query(sql); // Applying again does not reset the sequence.
    await pool.query(warrantySql);
    await pool.query('SELECT create_work_order($1,$2)',[order,[]]);
    assert(matchesSearch('tigre descripcion','Tigre Blanco','Descripción de pieza'));
    assert(matchesSearch('smaa 42','SMAA00042'));
    assert(!matchesSearch('otro proveedor','Tigre Blanco'));
    assert.equal(partyLabel({name:'Tigre Blanco',business_name:'Persona Física'}),'Tigre Blanco · Persona Física');
    console.log('PASS: concurrent OT folios, WPS rollback, extras, early AR without release, idempotent transfers, credit days, paid invoice extras, warranty concurrency/history/signatures, finances unchanged, delivery quality guard, server-only RPCs, repeat migration, accent-insensitive search.');
} finally {
    await pool.end();
    await admin.query(`DROP DATABASE ${database}`);
    await admin.end();
}

}
main().catch(error => { console.error(error); process.exitCode = 1; });
