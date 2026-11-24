// Usuarios QA con permisos por proceso para probar la fabricación unificada,
// Calidad por lotes, ventas → CxC y vehículos. Sólo para la base local de QA.
// Uso: PGPORT=55432 node qa/seed-operacion.mjs   (contraseña: QaPrueba#2026)
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../package.json', import.meta.url));
const { Client } = require('pg');

const PASSWORD = 'QaPrueba#2026';
function hashPassword(plain) {
    const salt = crypto.randomBytes(16);
    const derived = crypto.scryptSync(plain.normalize('NFKC'), salt, 64, { N: 16384, r: 8, p: 1 });
    return ['scrypt', 'n=16384,r=8,p=1', salt.toString('base64'), derived.toString('base64')].join('$');
}

const all = { can_view: true, can_create: true, can_edit: true, can_delete: true, can_start: true, can_pause: true, can_complete: true };
const operate = { can_view: true, can_start: true, can_pause: true, can_complete: true };
const USERS = [
    { username: 'qa_maquinado', full_name: 'Mario Maquinista (QA)', perms: [['manufacturing', 'maquinado', { ...operate, can_create: true, can_edit: true }]] },
    { username: 'qa_soldador', full_name: 'Sofía Soldadora (QA)', perms: [['manufacturing', 'soldadura', operate]] },
    { username: 'qa_calidad', full_name: 'Carlos Calidad (QA)', perms: [['quality', null, { can_view: true, can_edit: true }], ['deliveries', null, { can_view: true, can_create: true, can_edit: true }]] },
    { username: 'qa_ventas', full_name: 'Valeria Ventas (QA)', perms: [['sales', null, { can_view: true, can_create: true, can_edit: true }], ['finance', 'receivable', { can_view: true, can_create: true }], ['clients', null, { can_view: true, can_create: true }]] },
    { username: 'qa_vehiculos', full_name: 'Víctor Vehículos (QA)', perms: [['vehicles', null, all]] },
    { username: 'qa_direccion', full_name: 'Dirección (QA)', perms: [['audit', null, { can_view: true }], ['sales', null, { can_view: true }]] },
];

const db = new Client({ host: '127.0.0.1', port: Number(process.env.PGPORT || 55432), user: 'postgres', database: 'postgres' });
await db.connect();
for (const user of USERS) {
    const { rows } = await db.query(
        `INSERT INTO public.employees (username, full_name, password_hash, role) VALUES ($1, $2, $3, 'operator')
         ON CONFLICT (username) DO UPDATE SET full_name = EXCLUDED.full_name, password_hash = EXCLUDED.password_hash, is_active = true
         RETURNING id`, [user.username, user.full_name, hashPassword(PASSWORD)]);
    const id = rows[0].id;
    await db.query('DELETE FROM public.employee_permissions WHERE employee_id = $1', [id]);
    for (const [module, sub, flags] of user.perms) {
        const cols = Object.keys(flags);
        await db.query(
            `INSERT INTO public.employee_permissions (employee_id, module_code, sub_code, ${cols.join(', ')})
             VALUES ($1, $2, $3, ${cols.map((_, i) => `$${i + 4}`).join(', ')})`,
            [id, module, sub, ...cols.map((c) => flags[c])]);
    }
    console.log(`${user.username} listo`);
}
// Cliente y cotización aprobada de ejemplo para crear OT.
const client = await db.query(`INSERT INTO public.clients (business_name, name, rfc, payment_days) VALUES ('Industrias QA del Norte SA de CV', 'Industrias QA', 'IQN010101AB1', 30)
    ON CONFLICT (rfc) DO UPDATE SET business_name = EXCLUDED.business_name RETURNING id`);
await db.query(`INSERT INTO public.quotations (client_id, status, title, subtotal, vat_total, total)
    SELECT $1, 'Approved', 'Bridas soldadas QA', 4000, 640, 4640 WHERE NOT EXISTS (SELECT 1 FROM public.quotations WHERE title = 'Bridas soldadas QA')`, [client.rows[0].id]);
await db.query(`INSERT INTO public.quotation_items (quotation_id, description, quantity, unit_price, line_total, cost_unit_price, cost_line_total, margin_pct, position)
    SELECT q.id, 'Brida soldada 4"', 4, 1000, 4000, 725, 2900, 38, 1 FROM public.quotations q
     WHERE q.title = 'Bridas soldadas QA' AND NOT EXISTS (SELECT 1 FROM public.quotation_items i WHERE i.quotation_id = q.id)`);
await db.end();
console.log('Datos QA de operación listos');
