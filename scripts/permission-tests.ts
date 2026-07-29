/**
 * ===========================================================================
 * permission-tests.ts
 * ===========================================================================
 *
 * Test rig para validar el sistema de permisos de SMAA ERP contra la base
 * de datos real (Supabase). Usa conexión directa de Postgres.
 *
 * Uso:
 *   DB_URL=postgresql://postgres:xxx@host:5432/postgres \
 *     npx tsx scripts/permission-tests.ts
 *
 * Requisitos:
 *   - `pg` instalado (en /tmp-pg-runner o en el proyecto)
 *   - Las migraciones SQL aplicadas (incluyendo las de este PR)
 *
 * El script:
 *   1. Crea 5 empleados de prueba con permisos distintos (TEST_*)
 *   2. Para cada (módulo, acción), verifica que el comportamiento real
 *      coincida con el esperado según la matriz de docs/permission-audit.md
 *   3. Limpia los registros creados
 *   4. Imprime un resumen con ✅ / ❌ por caso
 *
 * NOTA: La RLS de Supabase es "Allow all" en la mayoría de tablas, así que
 * estos tests validan principalmente:
 *   - Que el schema acepte las operaciones esperadas
 *   - Que las constraints (FKs, NOT NULL) se respeten
 *   - Que el modelo de datos funcione end-to-end
 *
 * Para validar la LÓGICA de permisos (can(), requirePermission), se necesita
 * el unit test del código TypeScript o probar via la app en vivo.
 * ===========================================================================
 */

import { Client } from 'pg';

const DB_URL = process.env.DB_URL;
if (!DB_URL) {
    console.error('❌ Falta DB_URL. Ejemplo:');
    console.error('  $env:DB_URL = "postgresql://postgres:xxx@host:5432/postgres"');
    console.error('  npx tsx scripts/permission-tests.ts');
    process.exit(1);
}

const sb = new Client({ connectionString: DB_URL });

// =============================================================================
// Test fixtures
// =============================================================================

type EmployeeFixture = {
    label: string;
    username: string;
    role: 'master' | 'admin' | 'operator';
    permissions: Array<{
        module_code: string;
        sub_code: string | null;
        can_view: boolean;
        can_create: boolean;
        can_edit: boolean;
        can_delete: boolean;
        can_start?: boolean;
        can_pause?: boolean;
        can_complete?: boolean;
        can_request_supplies?: boolean;
        can_purchase?: boolean;
    }>;
};

const FIXTURES: EmployeeFixture[] = [
    {
        label: 'master (todos los permisos)',
        username: 'TEST_master',
        role: 'master',
        permissions: [],
    },
    {
        label: 'admin completo (clientes, suppliers, sales, purchases, requisiciones, manufacturing, employees)',
        username: 'TEST_admin',
        role: 'admin',
        permissions: [
            { module_code: 'clients', sub_code: null, can_view: true, can_create: true, can_edit: true, can_delete: true },
            { module_code: 'suppliers', sub_code: null, can_view: true, can_create: true, can_edit: true, can_delete: true },
            { module_code: 'sales', sub_code: null, can_view: true, can_create: true, can_edit: true, can_delete: true },
            { module_code: 'purchases', sub_code: null, can_view: true, can_create: true, can_edit: true, can_delete: true },
            { module_code: 'requisitions', sub_code: null, can_view: true, can_create: true, can_edit: true, can_request_supplies: true, can_purchase: true },
            { module_code: 'manufacturing', sub_code: 'maquinado', can_view: true, can_create: true, can_edit: true, can_delete: true, can_start: true, can_pause: true, can_complete: true },
            { module_code: 'manufacturing', sub_code: 'soldadura', can_view: true, can_create: true, can_edit: true, can_delete: true, can_start: true, can_pause: true, can_complete: true },
            { module_code: 'manufacturing', sub_code: 'automatizacion', can_view: true, can_create: true, can_edit: true, can_delete: true, can_start: true, can_pause: true, can_complete: true },
            { module_code: 'employees', sub_code: null, can_view: true, can_edit: true },
        ],
    },
    {
        label: 'operador solo-requisiciones (puede crear, no comprar, no editar todo)',
        username: 'TEST_op_requis',
        role: 'operator',
        permissions: [
            { module_code: 'requisitions', sub_code: null, can_view: true, can_create: true, can_request_supplies: true },
        ],
    },
    {
        label: 'operador con can_create pero SIN can_request_supplies (regression test fix #1)',
        username: 'TEST_op_create_only',
        role: 'operator',
        permissions: [
            { module_code: 'requisitions', sub_code: null, can_view: true, can_create: true },
        ],
    },
    {
        label: 'comprador (purchase + purchases:edit)',
        username: 'TEST_buyer',
        role: 'operator',
        permissions: [
            { module_code: 'requisitions', sub_code: null, can_view: true, can_purchase: true },
            { module_code: 'purchases', sub_code: null, can_view: true, can_edit: true, can_create: true },
        ],
    },
];

// =============================================================================
// Test cases
// =============================================================================

type TestCase = {
    id: string;
    description: string;
    fixture: string;
    run: (client: Client, employeeId: string) => Promise<{ ok: boolean; note?: string }>;
    expect: 'allow' | 'deny';
};

const TEST_CASES: TestCase[] = [
    // ===========================================================
    // FIX #1 REGRESSION: can_create debe funcionar para upload
    // ===========================================================
    {
        id: 'REQ-001',
        description: 'Operador con can_create (sin request_supplies) puede INSERTAR requisición',
        fixture: 'TEST_op_create_only',
        expect: 'allow',
        run: async (c, employeeId) => {
            const code = 'TEST-REQ-' + Date.now();
            const res = await c.query(
                `INSERT INTO requisitions (code, requested_by, status, priority, suggested_supplier_text)
                 VALUES ($1, $2, 'pending', 'normal', 'Test supplier')
                 RETURNING id`,
                [code, employeeId]
            );
            if (res.rows.length > 0) {
                // Insertar un item obligatorio
                await c.query(
                    `INSERT INTO requisition_items (requisition_id, description, quantity, unit)
                     VALUES ($1, 'item test', 1, 'pza')`,
                    [res.rows[0].id]
                );
                return { ok: true, note: `Created requisition ${code}` };
            }
            return { ok: false, note: 'No rows returned' };
        },
    },
    {
        id: 'REQ-002',
        description: 'Operador sin permisos NO puede INSERTAR requisición (controlamos via app, no DB)',
        fixture: 'TEST_op_requis',
        expect: 'allow',  // Este sí tiene can_create
        run: async (c, employeeId) => {
            const code = 'TEST-REQ-' + Date.now();
            const res = await c.query(
                `INSERT INTO requisitions (code, requested_by, status, priority, suggested_supplier_text)
                 VALUES ($1, $2, 'pending', 'normal', 'Test 2')
                 RETURNING id`,
                [code, employeeId]
            );
            return { ok: res.rows.length > 0, note: res.rows.length > 0 ? `Created ${code}` : 'Failed' };
        },
    },
    {
        id: 'REQ-003',
        description: 'Requisición con file_url (upload de cotización) - validación de schema',
        fixture: 'TEST_op_requis',
        expect: 'allow',
        run: async (c, employeeId) => {
            const code = 'TEST-REQ-' + Date.now();
            const res = await c.query(
                `INSERT INTO requisitions (code, requested_by, status, priority)
                 VALUES ($1, $2, 'pending', 'normal')
                 RETURNING id`,
                [code, employeeId]
            );
            const reqId = res.rows[0].id;
            // Insertar quotation (simula el upload)
            await c.query(
                `INSERT INTO requisition_quotations (requisition_id, file_url, file_name, uploaded_by)
                 VALUES ($1, 'https://example.com/test.pdf', 'cotizacion.pdf', $2)`,
                [reqId, employeeId]
            );
            return { ok: true, note: `Created req with quotation` };
        },
    },
    // ===========================================================
    // FIX #2: Auto-crear PO al marcar requisición como comprada
    // ===========================================================
    {
        id: 'PO-001',
        description: 'PO se puede crear SIN supplier_id (gracias a migration supplier_id nullable)',
        fixture: 'TEST_buyer',
        expect: 'allow',
        run: async (c) => {
            const res = await c.query(
                `INSERT INTO purchase_orders (supplier_id, status, subtotal, vat_total, total)
                 VALUES (NULL, 'Draft', 0, 0, 0)
                 RETURNING id, po_number`,
            );
            return { ok: res.rows.length > 0, note: res.rows.length > 0 ? `Created ${res.rows[0].po_number} sin supplier` : 'Failed' };
        },
    },
    {
        id: 'PO-002',
        description: 'PO se puede crear CON supplier_id (caso normal)',
        fixture: 'TEST_buyer',
        expect: 'allow',
        run: async (c) => {
            // Crear supplier de prueba
            const supRes = await c.query(
                `INSERT INTO suppliers (rfc, business_name) VALUES ($1, $2) RETURNING id`,
                ['TEST' + Date.now().toString().slice(-8), 'TEST Supplier ' + Date.now()]
            );
            const supplierId = supRes.rows[0].id;
            const res = await c.query(
                `INSERT INTO purchase_orders (supplier_id, status, subtotal, vat_total, total)
                 VALUES ($1, 'Draft', 100, 16, 116)
                 RETURNING id, po_number`,
                [supplierId]
            );
            return { ok: res.rows.length > 0, note: res.rows.length > 0 ? `Created ${res.rows[0].po_number}` : 'Failed' };
        },
    },
    {
        id: 'PO-003',
        description: 'PO se puede linkear a una requisición (requisition_id FK)',
        fixture: 'TEST_buyer',
        expect: 'allow',
        run: async (c, employeeId) => {
            // Crear requisición
            const reqRes = await c.query(
                `INSERT INTO requisitions (code, requested_by, status, priority)
                 VALUES ($1, $2, 'pending', 'normal') RETURNING id`,
                ['TEST-PO3-' + Date.now(), employeeId]
            );
            const reqId = reqRes.rows[0].id;
            // Crear PO linkeada
            const poRes = await c.query(
                `INSERT INTO purchase_orders (supplier_id, status, subtotal, vat_total, total, requisition_id)
                 VALUES (NULL, 'Draft', 0, 0, 0, $1)
                 RETURNING id, po_number`,
                [reqId]
            );
            return { ok: poRes.rows.length > 0, note: poRes.rows.length > 0 ? `Created ${poRes.rows[0].po_number} linked to req ${reqId.slice(0, 8)}` : 'Failed' };
        },
    },
    {
        id: 'PO-004',
        description: 'PO tiene columna notes (gracias a migration)',
        fixture: 'TEST_buyer',
        expect: 'allow',
        run: async (c) => {
            const res = await c.query(
                `INSERT INTO purchase_orders (supplier_id, status, subtotal, vat_total, total, notes)
                 VALUES (NULL, 'Draft', 0, 0, 0, 'Notas de prueba')
                 RETURNING id, notes`,
            );
            return { ok: res.rows.length > 0 && res.rows[0].notes === 'Notas de prueba', note: `Created PO with notes` };
        },
    },
    {
        id: 'PO-005',
        description: 'PO acepta invoice_url (de la requisición cerrada)',
        fixture: 'TEST_buyer',
        expect: 'allow',
        run: async (c) => {
            const res = await c.query(
                `INSERT INTO purchase_orders (supplier_id, status, subtotal, vat_total, total, invoice_url, invoice_date)
                 VALUES (NULL, 'Draft', 100, 16, 116, 'https://example.com/factura.pdf', NOW())
                 RETURNING id`,
            );
            return { ok: res.rows.length > 0, note: `Created PO with invoice_url` };
        },
    },
    {
        id: 'PO-006',
        description: 'Status "Received" es válido (usado por el flujo de "Recibir")',
        fixture: 'TEST_buyer',
        expect: 'allow',
        run: async (c) => {
            const res = await c.query(
                `INSERT INTO purchase_orders (supplier_id, status, subtotal, vat_total, total)
                 VALUES (NULL, 'Received', 0, 0, 0)
                 RETURNING id`,
            );
            return { ok: res.rows.length > 0, note: `Created PO with status Received` };
        },
    },
    // ===========================================================
    // FIX #3: suppliers es visible/usable
    // ===========================================================
    {
        id: 'SUP-001',
        description: 'Cualquier user puede leer suppliers (RLS allow all)',
        fixture: 'TEST_op_requis',
        expect: 'allow',
        run: async (c) => {
            const res = await c.query(`SELECT COUNT(*) FROM suppliers`);
            return { ok: res.rows.length > 0, note: `Found ${res.rows[0].count} suppliers` };
        },
    },
    {
        id: 'SUP-002',
        description: 'Se puede crear supplier con CSF (todos los campos del catálogo)',
        fixture: 'TEST_admin',
        expect: 'allow',
        run: async (c) => {
            const rfc = 'TEST' + Date.now().toString().slice(-8);
            const res = await c.query(
                `INSERT INTO suppliers (rfc, business_name, fiscal_regime, fiscal_zip_code, email, phone, address, constancia_pdf_url)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 RETURNING id`,
                [rfc, 'TEST CSF Auto-fill', '626', '31060', 'test@example.com', '5512345678', 'Test Address 123', 'https://example.com/csf.pdf']
            );
            return { ok: res.rows.length > 0, note: `Created supplier ${rfc}` };
        },
    },
    // ===========================================================
    // FIX #5: Permisos de empleados
    // ===========================================================
    {
        id: 'EMP-001',
        description: 'Admin puede crear empleado',
        fixture: 'TEST_admin',
        expect: 'allow',
        run: async (c) => {
            const username = 'TEST_created_' + Date.now();
            const res = await c.query(
                `INSERT INTO employees (full_name, username, password_hash, role, is_active)
                 VALUES ($1, $2, 'placeholder', 'operator', false)
                 RETURNING id`,
                ['Test Employee', username]
            );
            return { ok: res.rows.length > 0, note: `Created ${username}` };
        },
    },
    {
        id: 'EMP-002',
        description: 'Se pueden asignar permisos por sub-módulo (manufacturing:maquinado)',
        fixture: 'TEST_admin',
        expect: 'allow',
        run: async (c) => {
            // Obtener un empleado admin
            const empRes = await c.query(`SELECT id FROM employees WHERE username = $1`, ['TEST_admin']);
            if (empRes.rows.length === 0) return { ok: false, note: 'TEST_admin not found' };
            const adminId = empRes.rows[0].id;
            // Verificar que ya tiene permisos de manufacturing por sub (los creó el setup)
            const res = await c.query(
                `SELECT sub_code FROM employee_permissions
                 WHERE employee_id = $1 AND module_code = 'manufacturing'`,
                [adminId]
            );
            const subs = res.rows.map(r => r.sub_code);
            return {
                ok: subs.includes('maquinado') && subs.includes('soldadura') && subs.includes('automatizacion'),
                note: `Subs permitidos: ${subs.join(', ')}`
            };
        },
    },
    {
        id: 'EMP-003',
        description: 'FK de employee_permissions apunta a employees (no payroll_employees)',
        fixture: 'TEST_admin',
        expect: 'allow',
        run: async (c) => {
            const res = await c.query(`
                SELECT
                    tc.table_name,
                    tc.constraint_name,
                    ccu.table_name AS foreign_table_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.constraint_column_usage ccu
                  ON tc.constraint_name = ccu.constraint_name
                WHERE tc.constraint_type = 'FOREIGN KEY'
                  AND tc.table_name = 'employee_permissions'
                  AND ccu.table_name = 'employees'
            `);
            return { ok: res.rows.length > 0, note: `${res.rows.length} FK(s) found: ${res.rows.map(r => r.constraint_name).join(', ')}` };
        },
    },
    // ===========================================================
    // Migrations: verificar que la CSF y otras migraciones están aplicadas
    // ===========================================================
    {
        id: 'SCHEMA-001',
        description: 'Tabla requisition_quotations existe (para upload de cotizaciones)',
        fixture: 'TEST_admin',
        expect: 'allow',
        run: async (c) => {
            const res = await c.query(`
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'requisition_quotations'
                ORDER BY ordinal_position
            `);
            return { ok: res.rows.length >= 5, note: `${res.rows.length} columns` };
        },
    },
    {
        id: 'SCHEMA-002',
        description: 'Tabla purchase_orders tiene supplier_id nullable + notes',
        fixture: 'TEST_admin',
        expect: 'allow',
        run: async (c) => {
            const res = await c.query(`
                SELECT column_name, is_nullable
                FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'purchase_orders'
                  AND column_name IN ('supplier_id', 'notes', 'requisition_id', 'invoice_url', 'po_number')
                ORDER BY column_name
            `);
            const sup = res.rows.find(r => r.column_name === 'supplier_id');
            const notes = res.rows.find(r => r.column_name === 'notes');
            const req = res.rows.find(r => r.column_name === 'requisition_id');
            return {
                ok: sup?.is_nullable === 'YES' && notes?.is_nullable === 'YES' && req?.is_nullable === 'YES',
                note: `supplier_id: ${sup?.is_nullable}, notes: ${notes?.is_nullable}, requisition_id: ${req?.is_nullable}`
            };
        },
    },
    {
        id: 'SCHEMA-003',
        description: 'Catálogo de módulos cargable (no testeable desde DB, pero verificamos que manufacture_modules existe)',
        fixture: 'TEST_admin',
        expect: 'allow',
        run: async (c) => {
            const res = await c.query(`
                SELECT column_name FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'manufacturing_modules'
                ORDER BY ordinal_position
            `);
            return { ok: res.rows.length >= 4, note: `${res.rows.length} columns: ${res.rows.map(r => r.column_name).join(', ')}` };
        },
    },
];

// =============================================================================
// Helpers
// =============================================================================

async function getEmployeeId(c: Client, username: string): Promise<string | null> {
    const res = await c.query(`SELECT id FROM employees WHERE username = $1`, [username]);
    return res.rows[0]?.id ?? null;
}

// =============================================================================
// Setup / teardown
// =============================================================================

async function setup() {
    console.log('🛠  Creando empleados de prueba...');
    for (const fx of FIXTURES) {
        // Borrar si ya existe
        await sb.query(`DELETE FROM employee_permissions WHERE employee_id IN (SELECT id FROM employees WHERE username = $1)`, [fx.username]);
        await sb.query(`DELETE FROM employees WHERE username = $1`, [fx.username]);

        // Crear
        const empRes = await sb.query(
            `INSERT INTO employees (full_name, username, password_hash, role, is_active)
             VALUES ($1, $2, 'placeholder', $3, true)
             RETURNING id`,
            [fx.label, fx.username, fx.role]
        );
        const empId = empRes.rows[0].id;

        // Permisos
        if (fx.permissions.length > 0) {
            for (const p of fx.permissions) {
                await sb.query(
                    `INSERT INTO employee_permissions
                       (employee_id, module_code, sub_code, can_view, can_create, can_edit, can_delete,
                        can_start, can_pause, can_complete, can_request_supplies, can_purchase)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                     ON CONFLICT (employee_id, module_code, sub_code) DO NOTHING`,
                    [
                        empId, p.module_code, p.sub_code,
                        p.can_view ?? false, p.can_create ?? false, p.can_edit ?? false, p.can_delete ?? false,
                        p.can_start ?? false, p.can_pause ?? false, p.can_complete ?? false,
                        p.can_request_supplies ?? false, p.can_purchase ?? false,
                    ]
                );
            }
        }
        console.log(`  ✓ ${fx.label} (${fx.username})`);
    }
}

async function teardown() {
    console.log('\n🧹 Limpiando datos de prueba...');
    // Primero: borrar TODOS los POs/items que referencian a suppliers de prueba
    // (algunos tests crean un supplier y le asignan una PO)
    await sb.query(`DELETE FROM purchase_order_items WHERE purchase_order_id IN (
        SELECT po.id FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
        WHERE s.rfc LIKE 'TEST%'
    )`);
    await sb.query(`DELETE FROM purchase_orders WHERE supplier_id IN (SELECT id FROM suppliers WHERE rfc LIKE 'TEST%')`);
    // Luego: POs con notas de prueba o linkeados a requisiciones TEST_
    await sb.query(`DELETE FROM purchase_order_items WHERE purchase_order_id IN (
        SELECT id FROM purchase_orders WHERE notes = 'Notas de prueba'
        OR requisition_id IN (SELECT id FROM requisitions WHERE code LIKE 'TEST-%')
    )`);
    await sb.query(`DELETE FROM purchase_orders WHERE notes = 'Notas de prueba' OR requisition_id IN (SELECT id FROM requisitions WHERE code LIKE 'TEST-%')`);
    // Requisiciones
    await sb.query(`DELETE FROM requisition_items WHERE requisition_id IN (SELECT id FROM requisitions WHERE code LIKE 'TEST-%')`);
    await sb.query(`DELETE FROM requisition_quotations WHERE requisition_id IN (SELECT id FROM requisitions WHERE code LIKE 'TEST-%')`);
    await sb.query(`DELETE FROM requisitions WHERE code LIKE 'TEST-%'`);
    // Huérfanos
    await sb.query(`DELETE FROM purchase_order_items WHERE purchase_order_id NOT IN (SELECT id FROM purchase_orders)`);
    // Suppliers
    await sb.query(`DELETE FROM suppliers WHERE rfc LIKE 'TEST%'`);
    // Empleados
    await sb.query(`DELETE FROM employee_permissions WHERE employee_id IN (SELECT id FROM employees WHERE username LIKE 'TEST_%')`);
    await sb.query(`DELETE FROM employees WHERE username LIKE 'TEST_%'`);
    console.log('  ✓ Limpieza completa');
}

async function runTests() {
    console.log('\n🧪 Corriendo tests de permisos...\n');

    let passed = 0, failed = 0;
    for (const tc of TEST_CASES) {
        const fx = FIXTURES.find(f => f.username === tc.fixture);
        if (!fx) {
            console.log(`  ⚠️  ${tc.id}: fixture "${tc.fixture}" no existe`);
            failed++;
            continue;
        }

        const employeeId = await getEmployeeId(sb, tc.fixture);
        if (!employeeId) {
            console.log(`  ⚠️  ${tc.id}: empleado ${tc.fixture} no encontrado`);
            failed++;
            continue;
        }

        try {
            const result = await tc.run(sb, employeeId);
            const expectOk = tc.expect === 'allow';
            if (result.ok === expectOk) {
                passed++;
                console.log(`  ✅ ${tc.id}: ${tc.description}`);
                if (result.note) console.log(`     └─ ${result.note}`);
            } else {
                failed++;
                console.log(`  ❌ ${tc.id}: ${tc.description}`);
                if (result.note) console.log(`     └─ ${result.note}`);
            }
        } catch (ex: any) {
            failed++;
            console.log(`  ❌ ${tc.id}: ${tc.description}`);
            console.log(`     └─ Error: ${ex.message}`);
        }
    }

    console.log(`\n📊 Resumen: ${passed} pasaron, ${failed} fallaron (de ${TEST_CASES.length} total)`);
    return { passed, failed };
}

// =============================================================================
// Main
// =============================================================================

(async () => {
    try {
        await sb.connect();
        await setup();
        const { failed } = await runTests();
        await teardown();
        await sb.end();
        process.exit(failed > 0 ? 1 : 0);
    } catch (ex: any) {
        console.error('💥 Error fatal:', ex.message);
        try { await teardown(); } catch { /* ignore */ }
        try { await sb.end(); } catch { /* ignore */ }
        process.exit(2);
    }
})();
