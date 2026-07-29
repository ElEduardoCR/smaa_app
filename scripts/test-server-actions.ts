/**
 * ===========================================================================
 * test-server-actions.ts
 * ===========================================================================
 *
 * Tests que validan la LÓGICA de los server actions (permission gates +
 * validaciones de negocio + acceso a BD). Usa la conexión directa a Postgres
 * para simular el comportamiento de cada acción.
 *
 * ¿Por qué no solo unit tests?
 *   Los server actions usan `next/headers` (cookies) que solo están disponibles
 *   dentro de un request real. Para validar la lógica sin browser, hacemos
 *   una simulación: ejecutamos las validaciones (can, validaciones de
 *   negocio) manualmente y luego las queries SQL que haría el server action.
 *
 * Uso:
 *   DB_URL=postgresql://postgres:xxx@host:5432/postgres \
 *     npx tsx scripts/test-server-actions.ts
 *
 * Requisitos:
 *   - `pg` instalado (en /tmp-pg-runner)
 *   - Las migraciones SQL aplicadas
 * ===========================================================================
 */

import { Client } from 'pg';

// Implementación inline de can() para no importar permissions.ts
// (que tiene `server-only` y truena fuera de Next.js).
// Esta es una copia fiel de la lógica en src/lib/permissions.ts.

type EmployeeRole = 'master' | 'admin' | 'operator';
type Action = 'view' | 'create' | 'edit' | 'delete' | 'start' | 'pause' | 'complete' | 'request_supplies' | 'purchase';

type PermFlag = {
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
};

function resolvePermission(perms: PermFlag[], moduleCode: string, subCode: string | null = null): PermFlag | null {
    const exact = perms.find((p) => p.module_code === moduleCode && p.sub_code === subCode);
    if (exact) return exact;
    const moduleOnly = perms.find(
        (p) => p.module_code === moduleCode && (p.sub_code === null || p.sub_code === '')
    );
    return moduleOnly || null;
}

function can(role: EmployeeRole, perms: PermFlag[], moduleCode: string, action: Action, subCode: string | null = null): boolean {
    if (role === 'master') return true;
    const p = resolvePermission(perms, moduleCode, subCode);
    if (!p) return false;
    switch (action) {
        case 'view': return p.can_view;
        case 'create': return p.can_create;
        case 'edit': return p.can_edit;
        case 'delete': return p.can_delete;
        case 'start': return p.can_start ?? false;
        case 'pause': return p.can_pause ?? false;
        case 'complete': return p.can_complete ?? false;
        case 'request_supplies': return p.can_request_supplies ?? false;
        case 'purchase': return p.can_purchase ?? false;
    }
}

const DB_URL = process.env.DB_URL;

if (!DB_URL) {
    console.error('❌ Falta DB_URL');
    process.exit(1);
}

const sb = new Client({ connectionString: DB_URL });

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
    }>;
};

const FIXTURES: EmployeeFixture[] = [
    {
        label: 'master',
        username: 'TEST_sa_master',
        role: 'master',
        permissions: [],
    },
    {
        label: 'admin con todos los permisos',
        username: 'TEST_sa_admin',
        role: 'admin',
        permissions: [
            { module_code: 'clients', sub_code: null, can_view: true, can_create: true, can_edit: true, can_delete: true },
            { module_code: 'suppliers', sub_code: null, can_view: true, can_create: true, can_edit: true, can_delete: true },
            { module_code: 'purchases', sub_code: null, can_view: true, can_create: true, can_edit: true, can_delete: true },
            { module_code: 'finance', sub_code: 'receivable', can_view: true, can_create: true, can_edit: true, can_delete: true },
        ],
    },
    {
        label: 'operador solo con view (sin create/edit/delete)',
        username: 'TEST_sa_viewer',
        role: 'operator',
        permissions: [
            { module_code: 'clients', sub_code: null, can_view: true },
            { module_code: 'suppliers', sub_code: null, can_view: true },
            { module_code: 'purchases', sub_code: null, can_view: true },
            { module_code: 'finance', sub_code: 'receivable', can_view: true },
        ],
    },
];

let passed = 0, failed = 0;

function check(testId: string, description: string, condition: boolean, note?: string) {
    if (condition) {
        console.log(`  ✅ ${testId}: ${description}${note ? ' — ' + note : ''}`);
        passed++;
    } else {
        console.log(`  ❌ ${testId}: ${description}${note ? ' — ' + note : ''}`);
        failed++;
    }
}

/**
 * Simula la lógica del server action: checkea permisos + ejecuta SQL.
 * Devuelve true si el server action habría tenido éxito, false si habría tirado error.
 */
async function simulateServerAction(
    action: 'create' | 'edit' | 'delete' | 'view',
    moduleCode: 'clients' | 'suppliers' | 'purchases',
    fixture: EmployeeFixture,
    doSql: () => Promise<any>
): Promise<{ allowed: boolean; error?: string }> {
    // Master siempre pasa
    if (fixture.role === 'master') {
        try {
            await doSql();
            return { allowed: true };
        } catch (e: any) {
            return { allowed: false, error: e.message };
        }
    }

    // Otros: chequear permiso
    const perms = fixture.permissions.map(p => ({
        ...p,
        can_start: false, can_pause: false, can_complete: false,
        can_request_supplies: false, can_purchase: false,
    }));
    const allowed = can(fixture.role, perms as any, moduleCode, action);
    if (!allowed) {
        return { allowed: false, error: 'Sin permiso (can() === false)' };
    }

    // Si tiene permiso, ejecutar SQL
    try {
        await doSql();
        return { allowed: true };
    } catch (e: any) {
        return { allowed: false, error: e.message };
    }
}

async function setup() {
    console.log('🛠  Creando empleados de prueba...');
    for (const fx of FIXTURES) {
        await sb.query(`DELETE FROM employee_permissions WHERE employee_id IN (SELECT id FROM employees WHERE username = $1)`, [fx.username]);
        await sb.query(`DELETE FROM employees WHERE username = $1`, [fx.username]);
        const empRes = await sb.query(
            `INSERT INTO employees (full_name, username, password_hash, role, is_active) VALUES ($1, $2, 'placeholder', $3, true) RETURNING id`,
            [fx.label, fx.username, fx.role]
        );
        const empId = empRes.rows[0].id;
        for (const p of fx.permissions) {
            await sb.query(
                `INSERT INTO employee_permissions
                  (employee_id, module_code, sub_code, can_view, can_create, can_edit, can_delete, can_start, can_pause, can_complete, can_request_supplies, can_purchase)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, false, false, false, false, false)
                 ON CONFLICT (employee_id, module_code, sub_code) DO NOTHING`,
                [empId, p.module_code, p.sub_code, p.can_view ?? false, p.can_create ?? false, p.can_edit ?? false, p.can_delete ?? false]
            );
        }
        console.log(`  ✓ ${fx.label}`);
    }
}

async function teardown() {
    console.log('\n🧹 Limpiando...');
    // Borrar cualquier cliente/supplier/PO de prueba
    await sb.query(`DELETE FROM purchase_order_items WHERE purchase_order_id IN (SELECT id FROM purchase_orders WHERE notes = 'TEST sa notes')`);
    await sb.query(`DELETE FROM purchase_orders WHERE notes = 'TEST sa notes'`);
    await sb.query(`DELETE FROM requisition_items WHERE requisition_id IN (SELECT id FROM requisitions WHERE code LIKE 'TEST-SA-%')`);
    await sb.query(`DELETE FROM requisitions WHERE code LIKE 'TEST-SA-%'`);
    // AR cleanup (orden importa por FKs)
    await sb.query(`DELETE FROM ar_payment_promise_items WHERE promise_id IN (SELECT id FROM ar_payment_promises WHERE client_notes = 'TEST promesa')`);
    await sb.query(`DELETE FROM ar_payment_promises WHERE client_notes = 'TEST promesa'`);
    // Cualquier AR con empleado TEST o cliente TEST
    await sb.query(`DELETE FROM ar_payment_allocations WHERE invoice_id IN (SELECT id FROM ar_invoices WHERE concept LIKE 'TEST SA AR%' OR concept LIKE 'TEST AR%' OR client_id IN (SELECT id FROM clients WHERE business_name = 'TEST SA AR Client'))`);
    await sb.query(`DELETE FROM ar_payments WHERE client_id IN (SELECT id FROM clients WHERE business_name = 'TEST SA AR Client') OR registered_by IN (SELECT id FROM employees WHERE username LIKE 'TEST_sa_%')`);
    await sb.query(`DELETE FROM ar_share_links WHERE client_id IN (SELECT id FROM clients WHERE business_name = 'TEST SA AR Client')`);
    await sb.query(`DELETE FROM ar_invoices WHERE concept LIKE 'TEST SA AR%' OR concept LIKE 'TEST AR%' OR client_id IN (SELECT id FROM clients WHERE business_name = 'TEST SA AR Client')`);
    await sb.query(`DELETE FROM clients WHERE business_name = 'TEST SA AR Client'`);
    // Resto
    await sb.query(`DELETE FROM clients WHERE rfc LIKE 'TESTSA%'`);
    await sb.query(`DELETE FROM suppliers WHERE rfc LIKE 'TESTSA%'`);
    await sb.query(`DELETE FROM employee_permissions WHERE employee_id IN (SELECT id FROM employees WHERE username LIKE 'TEST_sa_%')`);
    await sb.query(`DELETE FROM employees WHERE username LIKE 'TEST_sa_%'`);
    console.log('  ✓ Limpieza completa');
}

async function runTests() {
    console.log('\n🧪 Tests de server actions (lógica de permisos)\n');

    const master = FIXTURES.find(f => f.username === 'TEST_sa_master')!;
    const admin = FIXTURES.find(f => f.username === 'TEST_sa_admin')!;
    const viewer = FIXTURES.find(f => f.username === 'TEST_sa_viewer')!;

    // ==================== CLIENTS ====================
    console.log('--- CLIENTS ---');

    // Test C-001: master puede crear cliente
    {
        const r = await simulateServerAction('create', 'clients', master, async () => {
            const rfc = 'TESTSA' + Date.now().toString().slice(-7);
            await sb.query(
                `INSERT INTO clients (rfc, business_name, fiscal_regime, fiscal_zip_code) VALUES ($1, $2, '601', '12345')`,
                [rfc, 'TEST SA Master']
            );
        });
        check('C-001', 'master puede crear cliente', r.allowed, r.error);
    }

    // Test C-002: admin puede crear cliente
    {
        const r = await simulateServerAction('create', 'clients', admin, async () => {
            const rfc = 'TESTSA' + Date.now().toString().slice(-7);
            await sb.query(
                `INSERT INTO clients (rfc, business_name, fiscal_regime, fiscal_zip_code) VALUES ($1, $2, '601', '12345')`,
                [rfc, 'TEST SA Admin']
            );
        });
        check('C-002', 'admin con create puede crear cliente', r.allowed, r.error);
    }

    // Test C-003: viewer NO puede crear cliente (regression test fix #1)
    {
        const r = await simulateServerAction('create', 'clients', viewer, async () => {
            const rfc = 'TESTSA' + Date.now().toString().slice(-7);
            await sb.query(
                `INSERT INTO clients (rfc, business_name, fiscal_regime, fiscal_zip_code) VALUES ($1, $2, '601', '12345')`,
                [rfc, 'TEST SA Viewer Should Fail']
            );
        });
        check('C-003', 'viewer SIN create NO puede crear cliente (regression test)', !r.allowed, r.error);
    }

    // Test C-004: viewer puede ver clientes (lectura permitida)
    {
        const r = await simulateServerAction('view', 'clients', viewer, async () => {
            await sb.query(`SELECT id FROM clients LIMIT 1`);
        });
        check('C-004', 'viewer puede ver clientes', r.allowed, r.error);
    }

    // Test C-005: viewer NO puede eliminar cliente
    {
        const r = await simulateServerAction('delete', 'clients', viewer, async () => {
            await sb.query(`DELETE FROM clients WHERE rfc = 'NONEXISTENT'`);
        });
        check('C-005', 'viewer SIN delete NO puede eliminar cliente', !r.allowed, r.error);
    }

    // ==================== SUPPLIERS ====================
    console.log('\n--- SUPPLIERS ---');

    {
        const r = await simulateServerAction('create', 'suppliers', admin, async () => {
            const rfc = 'TESTSA' + Date.now().toString().slice(-7);
            await sb.query(
                `INSERT INTO suppliers (rfc, business_name, fiscal_regime, fiscal_zip_code) VALUES ($1, $2, '601', '12345')`,
                [rfc, 'TEST SA Admin Supplier']
            );
        });
        check('S-001', 'admin puede crear supplier', r.allowed, r.error);
    }

    {
        const r = await simulateServerAction('create', 'suppliers', viewer, async () => {
            const rfc = 'TESTSA' + Date.now().toString().slice(-7);
            await sb.query(
                `INSERT INTO suppliers (rfc, business_name) VALUES ($1, 'TEST SA Viewer Should Fail')`,
                [rfc]
            );
        });
        check('S-002', 'viewer SIN create NO puede crear supplier', !r.allowed, r.error);
    }

    // ==================== PURCHASES ====================
    console.log('\n--- PURCHASES ---');

    {
        const r = await simulateServerAction('create', 'purchases', admin, async () => {
            const supRes = await sb.query(`INSERT INTO suppliers (rfc, business_name) VALUES ($1, 'TEST SA PO Supplier') RETURNING id`, ['TESTSAPO' + Date.now().toString().slice(-6)]);
            const supplierId = supRes.rows[0].id;
            await sb.query(
                `INSERT INTO purchase_orders (supplier_id, status, subtotal, vat_total, total, notes) VALUES ($1, 'Draft', 100, 16, 116, 'TEST sa notes')`,
                [supplierId]
            );
        });
        check('P-001', 'admin puede crear PO con supplier válido', r.allowed, r.error);
    }

    {
        const r = await simulateServerAction('create', 'purchases', viewer, async () => {
            await sb.query(
                `INSERT INTO purchase_orders (supplier_id, status, subtotal, vat_total, total, notes) VALUES (NULL, 'Draft', 0, 0, 0, 'TEST sa notes')`
            );
        });
        check('P-002', 'viewer SIN create NO puede crear PO', !r.allowed, r.error);
    }

    // Test del "Recibir" (update status a Received + invoice_url)
    {
        const r = await simulateServerAction('edit', 'purchases', admin, async () => {
            // Crear PO de prueba
            const supRes = await sb.query(`INSERT INTO suppliers (rfc, business_name) VALUES ($1, 'TEST SA Receive') RETURNING id`, ['TESTSARC' + Date.now().toString().slice(-6)]);
            const supplierId = supRes.rows[0].id;
            const poRes = await sb.query(
                `INSERT INTO purchase_orders (supplier_id, status, subtotal, vat_total, total, notes) VALUES ($1, 'Draft', 0, 0, 0, 'TEST sa notes') RETURNING id`,
                [supplierId]
            );
            const poId = poRes.rows[0].id;
            // Simular "Recibir": update status + invoice_url
            await sb.query(
                `UPDATE purchase_orders SET status = 'Received', invoice_url = 'https://test.com/inv.pdf' WHERE id = $1`,
                [poId]
            );
        });
        check('P-003', 'admin puede Recibir PO (update status + invoice_url)', r.allowed, r.error);
    }

    {
        const r = await simulateServerAction('edit', 'purchases', viewer, async () => {
            await sb.query(
                `UPDATE purchase_orders SET status = 'Received' WHERE id = (SELECT id FROM purchase_orders LIMIT 1)`
            );
        });
        check('P-004', 'viewer SIN edit NO puede Recibir PO', !r.allowed, r.error);
    }

    // ==================== OBSOLETE / RESTORE (soft-delete) ====================
    console.log('\n--- OBSOLETE / RESTORE ---');

    // Soft-delete cliente: master puede (can_delete)
    {
        const r = await simulateServerAction('delete', 'clients', master, async () => {
            const rfc = 'TESTSA' + Date.now().toString().slice(-7);
            const ins = await sb.query(
                `INSERT INTO clients (rfc, business_name, fiscal_regime, fiscal_zip_code) VALUES ($1, 'TEST SA Obsoletable Master', '601', '12345') RETURNING id`,
                [rfc]
            );
            const id = ins.rows[0].id;
            await sb.query(`UPDATE clients SET is_active = false WHERE id = $1`, [id]);
        });
        check('O-001', 'master puede obsoletar cliente (can_delete)', r.allowed, r.error);
    }

    // Soft-delete cliente: admin con can_delete puede
    {
        const r = await simulateServerAction('delete', 'clients', admin, async () => {
            const rfc = 'TESTSA' + Date.now().toString().slice(-7);
            const ins = await sb.query(
                `INSERT INTO clients (rfc, business_name, fiscal_regime, fiscal_zip_code) VALUES ($1, 'TEST SA Obsoletable Admin', '601', '12345') RETURNING id`,
                [rfc]
            );
            const id = ins.rows[0].id;
            await sb.query(`UPDATE clients SET is_active = false WHERE id = $1`, [id]);
        });
        check('O-002', 'admin con can_delete puede obsoletar cliente', r.allowed, r.error);
    }

    // Soft-delete cliente: viewer NO puede
    {
        const r = await simulateServerAction('delete', 'clients', viewer, async () => {
            await sb.query(`UPDATE clients SET is_active = false WHERE rfc = 'NONEXISTENT'`);
        });
        check('O-003', 'viewer SIN can_delete NO puede obsoletar cliente', !r.allowed, r.error);
    }

    // Restaurar cliente: master puede (can_edit)
    {
        const r = await simulateServerAction('edit', 'clients', master, async () => {
            const rfc = 'TESTSA' + Date.now().toString().slice(-7);
            const ins = await sb.query(
                `INSERT INTO clients (rfc, business_name, fiscal_regime, fiscal_zip_code, is_active) VALUES ($1, 'TEST SA To Restore Master', '601', '12345', false) RETURNING id`,
                [rfc]
            );
            const id = ins.rows[0].id;
            await sb.query(`UPDATE clients SET is_active = true WHERE id = $1`, [id]);
        });
        check('O-004', 'master puede restaurar cliente (can_edit)', r.allowed, r.error);
    }

    // Restaurar cliente: admin con can_edit puede
    {
        const r = await simulateServerAction('edit', 'clients', admin, async () => {
            const rfc = 'TESTSA' + Date.now().toString().slice(-7);
            const ins = await sb.query(
                `INSERT INTO clients (rfc, business_name, fiscal_regime, fiscal_zip_code, is_active) VALUES ($1, 'TEST SA To Restore Admin', '601', '12345', false) RETURNING id`,
                [rfc]
            );
            const id = ins.rows[0].id;
            await sb.query(`UPDATE clients SET is_active = true WHERE id = $1`, [id]);
        });
        check('O-005', 'admin con can_edit puede restaurar cliente', r.allowed, r.error);
    }

    // Restaurar cliente: viewer NO puede
    {
        const r = await simulateServerAction('edit', 'clients', viewer, async () => {
            await sb.query(`UPDATE clients SET is_active = true WHERE rfc = 'NONEXISTENT'`);
        });
        check('O-006', 'viewer SIN can_edit NO puede restaurar cliente', !r.allowed, r.error);
    }

    // Soft-delete supplier: admin puede
    {
        const r = await simulateServerAction('delete', 'suppliers', admin, async () => {
            const rfc = 'TESTSA' + Date.now().toString().slice(-7);
            const ins = await sb.query(
                `INSERT INTO suppliers (rfc, business_name) VALUES ($1, 'TEST SA Supplier Obsoletable') RETURNING id`,
                [rfc]
            );
            const id = ins.rows[0].id;
            await sb.query(`UPDATE suppliers SET is_active = false WHERE id = $1`, [id]);
        });
        check('O-007', 'admin puede obsoletar supplier', r.allowed, r.error);
    }

    // Restaurar supplier: admin puede
    {
        const r = await simulateServerAction('edit', 'suppliers', admin, async () => {
            const rfc = 'TESTSA' + Date.now().toString().slice(-7);
            const ins = await sb.query(
                `INSERT INTO suppliers (rfc, business_name, is_active) VALUES ($1, 'TEST SA Supplier Restore', false) RETURNING id`,
                [rfc]
            );
            const id = ins.rows[0].id;
            await sb.query(`UPDATE suppliers SET is_active = true WHERE id = $1`, [id]);
        });
        check('O-008', 'admin puede restaurar supplier', r.allowed, r.error);
    }

    // Soft-delete PO: admin puede (no se borra, solo is_active=false)
    {
        const r = await simulateServerAction('delete', 'purchases', admin, async () => {
            const supRes = await sb.query(
                `INSERT INTO suppliers (rfc, business_name) VALUES ($1, 'TEST SA PO Obs Supplier') RETURNING id`,
                ['TESTSAPO' + Date.now().toString().slice(-6)]
            );
            const supplierId = supRes.rows[0].id;
            const ins = await sb.query(
                `INSERT INTO purchase_orders (supplier_id, status, subtotal, vat_total, total, notes) VALUES ($1, 'Draft', 0, 0, 0, 'TEST sa notes') RETURNING id`,
                [supplierId]
            );
            const poId = ins.rows[0].id;
            // Soft-delete (set is_active=false, NO DELETE)
            await sb.query(`UPDATE purchase_orders SET is_active = false WHERE id = $1`, [poId]);
        });
        check('O-009', 'admin puede obsoletar PO (soft-delete via is_active=false)', r.allowed, r.error);
    }

    // Soft-delete PO: viewer NO puede
    {
        const r = await simulateServerAction('delete', 'purchases', viewer, async () => {
            await sb.query(`UPDATE purchase_orders SET is_active = false WHERE id = (SELECT id FROM purchase_orders LIMIT 1)`);
        });
        check('O-010', 'viewer SIN can_delete NO puede obsoletar PO', !r.allowed, r.error);
    }

    // Restaurar PO: admin puede
    {
        const r = await simulateServerAction('edit', 'purchases', admin, async () => {
            const supRes = await sb.query(
                `INSERT INTO suppliers (rfc, business_name) VALUES ($1, 'TEST SA PO Rest Supplier') RETURNING id`,
                ['TESTSAPO' + Date.now().toString().slice(-6)]
            );
            const supplierId = supRes.rows[0].id;
            const ins = await sb.query(
                `INSERT INTO purchase_orders (supplier_id, status, subtotal, vat_total, total, notes, is_active) VALUES ($1, 'Draft', 0, 0, 0, 'TEST sa notes', false) RETURNING id`,
                [supplierId]
            );
            const poId = ins.rows[0].id;
            await sb.query(`UPDATE purchase_orders SET is_active = true WHERE id = $1`, [poId]);
        });
        check('O-011', 'admin puede restaurar PO', r.allowed, r.error);
    }

    // Restaurar PO: viewer NO puede
    {
        const r = await simulateServerAction('edit', 'purchases', viewer, async () => {
            await sb.query(`UPDATE purchase_orders SET is_active = true WHERE id = (SELECT id FROM purchase_orders LIMIT 1)`);
        });
        check('O-012', 'viewer SIN can_edit NO puede restaurar PO', !r.allowed, r.error);
    }

    // Verificar que obsoletar NO hace DELETE (datos preservados)
    {
        const rfc = 'TESTSA' + Date.now().toString().slice(-7);
        const ins = await sb.query(
            `INSERT INTO clients (rfc, business_name, fiscal_regime, fiscal_zip_code) VALUES ($1, 'TEST SA Preserved', '601', '12345') RETURNING id`,
            [rfc]
        );
        const id = ins.rows[0].id;
        await sb.query(`UPDATE clients SET is_active = false WHERE id = $1`, [id]);
        const stillThere = await sb.query(`SELECT id FROM clients WHERE id = $1`, [id]);
        check('O-013', 'Registro obsoletado sigue en la BD (no se borra)', stillThere.rows.length === 1, `id=${id.slice(0, 8)}...`);
    }

    // ==================== AR / CUENTAS POR COBRAR ====================
    console.log('\n--- AR / CUENTAS POR COBRAR ---');

    // Helper para simular server actions AR (necesita subCode)
    const simulateAR = async (
        action: 'view' | 'create' | 'edit' | 'delete',
        fixture: EmployeeFixture,
        doSql: () => Promise<any>
    ): Promise<{ allowed: boolean; error?: string }> => {
        if (fixture.role === 'master') {
            try { await doSql(); return { allowed: true }; }
            catch (e: any) { return { allowed: false, error: e.message }; }
        }
        const perms = fixture.permissions.map(p => ({
            ...p,
            can_start: false, can_pause: false, can_complete: false,
            can_request_supplies: false, can_purchase: false,
        }));
        const allowed = can(fixture.role, perms as any, 'finance', action, 'receivable');
        if (!allowed) return { allowed: false, error: 'Sin permiso (can() === false)' };
        try { await doSql(); return { allowed: true }; }
        catch (e: any) { return { allowed: false, error: e.message }; }
    };

    // Setup: cliente de prueba
    const arClient = (await sb.query(
        `INSERT INTO clients (rfc, business_name, fiscal_regime, fiscal_zip_code) VALUES ($1, 'TEST SA AR Client', '601', '12345') RETURNING id`,
        ['TESTSACX' + Date.now().toString().slice(-5)]
    )).rows[0];

    // Test AR-001: master puede crear partida
    {
        const r = await simulateAR('create', master, async () => {
            await sb.query(
                `INSERT INTO ar_invoices (client_id, concept, gross_amount, vat_amount, net_amount, created_by)
                 SELECT $1, 'TEST SA AR Master', 1000, 160, 1160, id FROM employees WHERE username = $2`,
                [arClient.id, 'TEST_sa_master']
            );
        });
        check('AR-001', 'master puede crear partida AR (can_create)', r.allowed, r.error);
    }

    // Test AR-002: admin con can_create puede crear partida
    {
        const r = await simulateAR('create', admin, async () => {
            await sb.query(
                `INSERT INTO ar_invoices (client_id, concept, gross_amount, vat_amount, net_amount, created_by)
                 SELECT $1, 'TEST SA AR Admin', 1000, 160, 1160, id FROM employees WHERE username = $2`,
                [arClient.id, 'TEST_sa_admin']
            );
        });
        check('AR-002', 'admin con can_create puede crear partida AR', r.allowed, r.error);
    }

    // Test AR-003: viewer (solo view) NO puede crear partida
    {
        const r = await simulateAR('create', viewer, async () => {
            await sb.query(
                `INSERT INTO ar_invoices (client_id, concept, gross_amount, vat_amount, net_amount, created_by)
                 SELECT $1, 'TEST SA AR Viewer Should Fail', 0, 0, 0, id FROM employees WHERE username = $2`,
                [arClient.id, 'TEST_sa_viewer']
            );
        });
        check('AR-003', 'viewer SIN can_create NO puede crear partida AR', !r.allowed, r.error);
    }

    // Test AR-004: master puede obsoletar partida
    {
        const r = await simulateAR('delete', master, async () => {
            const ins = await sb.query(
                `INSERT INTO ar_invoices (client_id, concept, gross_amount, vat_amount, net_amount)
                 VALUES ($1, 'TEST SA AR Obsoletable Master', 0, 0, 0) RETURNING id`,
                [arClient.id]
            );
            await sb.query(`UPDATE ar_invoices SET is_active = false WHERE id = $1`, [ins.rows[0].id]);
        });
        check('AR-004', 'master puede obsoletar partida AR (can_delete)', r.allowed, r.error);
    }

    // Test AR-005: admin con can_delete puede obsoletar
    {
        const r = await simulateAR('delete', admin, async () => {
            const ins = await sb.query(
                `INSERT INTO ar_invoices (client_id, concept, gross_amount, vat_amount, net_amount)
                 VALUES ($1, 'TEST SA AR Obsoletable Admin', 0, 0, 0) RETURNING id`,
                [arClient.id]
            );
            await sb.query(`UPDATE ar_invoices SET is_active = false WHERE id = $1`, [ins.rows[0].id]);
        });
        check('AR-005', 'admin con can_delete puede obsoletar partida AR', r.allowed, r.error);
    }

    // Test AR-006: viewer NO puede obsoletar
    {
        const r = await simulateAR('delete', viewer, async () => {
            await sb.query(`UPDATE ar_invoices SET is_active = false WHERE id = (SELECT id FROM ar_invoices LIMIT 1)`);
        });
        check('AR-006', 'viewer SIN can_delete NO puede obsoletar partida AR', !r.allowed, r.error);
    }

    // Test AR-007: master puede restaurar partida
    {
        const r = await simulateAR('edit', master, async () => {
            const ins = await sb.query(
                `INSERT INTO ar_invoices (client_id, concept, gross_amount, vat_amount, net_amount, is_active)
                 VALUES ($1, 'TEST SA AR Restore Master', 0, 0, 0, false) RETURNING id`,
                [arClient.id]
            );
            await sb.query(`UPDATE ar_invoices SET is_active = true WHERE id = $1`, [ins.rows[0].id]);
        });
        check('AR-007', 'master puede restaurar partida AR (can_edit)', r.allowed, r.error);
    }

    // Test AR-008: master puede crear link público
    {
        const r = await simulateAR('create', master, async () => {
            // Simular el hash SHA-256 de un token fake
            const fakeHash = 'b'.repeat(64);
            await sb.query(
                `INSERT INTO ar_share_links (client_id, token_hash, expires_at, created_by)
                 SELECT $1, $2, NOW() + INTERVAL '30 days', id FROM employees WHERE username = $3`,
                [arClient.id, fakeHash, 'TEST_sa_master']
            );
        });
        check('AR-008', 'master puede crear link público AR (can_create)', r.allowed, r.error);
    }

    // Test AR-009: viewer NO puede crear link
    {
        const r = await simulateAR('create', viewer, async () => {
            const fakeHash = 'c'.repeat(64);
            await sb.query(
                `INSERT INTO ar_share_links (client_id, token_hash, expires_at, created_by)
                 SELECT $1, $2, NOW() + INTERVAL '30 days', id FROM employees WHERE username = $3`,
                [arClient.id, fakeHash, 'TEST_sa_viewer']
            );
        });
        check('AR-009', 'viewer SIN can_create NO puede crear link público', !r.allowed, r.error);
    }

    // Test AR-010: master puede revocar link
    {
        const r = await simulateAR('delete', master, async () => {
            const link = (await sb.query(`SELECT id FROM ar_share_links WHERE client_id = $1 LIMIT 1`, [arClient.id])).rows[0];
            if (link) await sb.query(`UPDATE ar_share_links SET status = 'revoked' WHERE id = $1`, [link.id]);
        });
        check('AR-010', 'master puede revocar link público (can_delete)', r.allowed, r.error);
    }

    // Test AR-011: master puede registrar pago
    {
        const r = await simulateAR('create', master, async () => {
            const inv = (await sb.query(
                `INSERT INTO ar_invoices (client_id, concept, gross_amount, vat_amount, net_amount, created_by)
                 SELECT $1, 'TEST SA AR Payment', 1000, 160, 1160, id FROM employees WHERE username = $2 RETURNING id`,
                [arClient.id, 'TEST_sa_master']
            )).rows[0];
            const pay = (await sb.query(
                `INSERT INTO ar_payments (client_id, payment_date, amount, payment_method, registered_by)
                 SELECT $1, CURRENT_DATE, 1160, 'transfer', id FROM employees WHERE username = $2 RETURNING id`,
                [arClient.id, 'TEST_sa_master']
            )).rows[0];
            await sb.query(
                `INSERT INTO ar_payment_allocations (payment_id, invoice_id, amount_applied) VALUES ($1, $2, 1160)`,
                [pay.id, inv.id]
            );
        });
        check('AR-011', 'master puede registrar pago + allocations (can_create)', r.allowed, r.error);
    }

    // Test AR-012: el trigger recalcula paid_amount al insertar allocation
    {
        const inv = (await sb.query(
            `INSERT INTO ar_invoices (client_id, concept, gross_amount, vat_amount, net_amount)
             VALUES ($1, 'TEST SA AR TriggerCheck', 100, 16, 116) RETURNING id`,
            [arClient.id]
        )).rows[0];
        const pay = (await sb.query(
            `INSERT INTO ar_payments (client_id, payment_date, amount, payment_method, registered_by)
             VALUES ($1, CURRENT_DATE, 50, 'cash', (SELECT id FROM employees WHERE username = 'TEST_sa_master')) RETURNING id`,
            [arClient.id]
        )).rows[0];
        await sb.query(
            `INSERT INTO ar_payment_allocations (payment_id, invoice_id, amount_applied) VALUES ($1, $2, 50)`,
            [pay.id, inv.id]
        );
        const after = await sb.query(`SELECT status, paid_amount, balance FROM ar_invoices WHERE id = $1`, [inv.id]);
        const ok = after.rows[0].status === 'partial' && Number(after.rows[0].paid_amount) === 50 && Number(after.rows[0].balance) === 66;
        check('AR-012', 'Trigger recalcula paid_amount + status al insertar allocation', ok, `status=${after.rows[0].status}, paid=${after.rows[0].paid_amount}, balance=${after.rows[0].balance}`);
    }

    // Test AR-013: el balance es GENERATED (no se puede asignar a mano)
    {
        const inv = (await sb.query(
            `INSERT INTO ar_invoices (client_id, concept, gross_amount, vat_amount, net_amount)
             VALUES ($1, 'TEST SA AR BalanceGenerated', 200, 32, 232) RETURNING balance`,
            [arClient.id]
        )).rows[0];
        const ok = Number(inv.balance) === 232;
        check('AR-013', 'balance es GENERATED (gross + vat = 232)', ok, `balance=${inv.balance}`);
    }

    // ==================== RESUMEN ====================
    console.log(`\n📊 Resumen: ${passed} pasaron, ${failed} fallaron (de ${passed + failed} total)`);
}

(async () => {
    try {
        await sb.connect();
        await setup();
        await runTests();
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
