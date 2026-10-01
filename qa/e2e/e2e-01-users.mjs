// E2E 01 — Alta de usuarios de prueba desde Configuración → Empleados.
// Prueba: modal de alta, foto (employee_photos), rol, matriz de permisos.
import { launch, loginContext, watch, shot, fixtures, BASE } from './lib.mjs';

const F = fixtures();
const errors = [];
const results = [];
const browser = await launch();
const ctx = await loginContext(browser, 'qa_master', 'QaMaster#2026');
const page = await ctx.newPage();
watch(page, 'users', errors);

const ALL = ['Ver', 'Crear', 'Editar', 'Eliminar'];
const USERS = [
    {
        username: 'qa_admin', full: 'QA Admin Compras', pos: 'QA Comprador', role: 'admin', photo: F.png,
        perms: [
            ['Dashboard / Inicio', null, ['Ver']],
            ['Requisiciones', null, ['Ver', 'Crear', 'Editar', 'Solicitar insumos', 'Convertir a compra']],
            ['Compras / POs', null, ALL],
            ['Proveedores', null, ALL],
            ['Clientes', null, ALL],
            ['Ventas / Cotizaciones', null, ALL],
            ['Entregas', null, ['Ver', 'Crear', 'Editar']],
            ['Calidad', null, ['Ver', 'Liberar/Rechazar']],
            ['Documentos / Cambios', null, ['Ver', 'Crear', 'Editar']],
            ['Requisiciones de Documentos', null, ['Ver', 'Crear']],
            ['PFMEA / AMEF', null, ALL],
            ['Configuración empresa', null, ['Ver', 'Editar']],
            ['Empleados (este módulo)', null, ALL],
            ['Fabricación (OTs)', 'Maquinado', ['Ver', 'Crear OT', 'Editar OT', 'Eliminar', 'Iniciar', 'Pausar', 'Terminar']],
            ['Fabricación (OTs)', 'Soldadura', ['Ver', 'Crear OT', 'Editar OT', 'Eliminar', 'Iniciar', 'Pausar', 'Terminar']],
            ['Nóminas y Contabilidad', 'Cuentas por Cobrar', ['Ver', 'Crear', 'Editar']],
        ],
    },
    {
        // Operador típico: SOLO "Solicitar insumos" + su sub-módulo de fabricación
        username: 'qa_operador', full: 'QA Operador Soldadura', pos: 'QA Soldador', role: 'operator', photo: F.pngAccent,
        perms: [
            ['Requisiciones', null, ['Solicitar insumos']],
            ['Fabricación (OTs)', 'Soldadura', ['Ver', 'Iniciar', 'Pausar', 'Terminar']],
        ],
    },
    {
        username: 'qa_almacen', full: 'QA Almacenista', pos: 'QA Almacén', role: 'operator',
        perms: [
            ['Requisiciones', null, ['Ver', 'Solicitar insumos']],
            ['Compras / POs', null, ['Ver']],
        ],
    },
    {
        username: 'qa_finanzas', full: 'QA Finanzas', pos: 'QA Contabilidad', role: 'operator',
        perms: (process.env.FIXED ? [['Nóminas y Contabilidad', 'General \\(nómina, checador, IVA, declaraciones\\)', ['Ver', 'Crear', 'Editar']]] : []).concat([
            ['Nóminas y Contabilidad', 'Cuentas por Cobrar', ['Ver', 'Crear', 'Editar']],
        ]),
    },
    {
        username: 'qa_cxc', full: 'QA Cuentas por Cobrar', pos: 'QA Cobranza', role: 'operator',
        perms: [
            ['Nóminas y Contabilidad', 'Cuentas por Cobrar', ['Ver']],
        ],
    },
    {
        username: 'qa_calidad', full: 'QA Inspector Calidad', pos: 'QA Inspector', role: 'operator',
        perms: [
            ['Calidad', null, ['Ver', 'Liberar/Rechazar']],
        ],
    },
    {
        username: 'qa_docs', full: 'QA Control Documentos', pos: 'QA Calidad', role: 'document_controller',
        perms: [
            ['Requisiciones de Documentos', null, ['Ver', 'Crear']],
        ],
    },
    {
        username: 'qa_direccion', full: 'QA Alta Direccion', pos: 'QA Director', role: 'top_management',
        perms: [
            ['Requisiciones de Documentos', null, ['Ver', 'Crear']],
            ['Documentos / Cambios', null, ['Ver']],
        ],
    },
];

async function grant(modal, moduleLabel, subLabel, flags) {
    const card = modal.locator('div.rounded-2xl').filter({ has: page.getByText(moduleLabel, { exact: true }) }).first();
    let scope = card;
    if (subLabel) {
        scope = card.locator('div.border-t, div.pt-2\\.5, div').filter({ has: page.locator('label > span', { hasText: new RegExp(`^${subLabel}$`) }) }).last();
        const box = scope.locator('label > input[type=checkbox]').first();
        if (!(await box.isChecked())) await box.check();
    }
    for (const f of flags) {
        const lbl = scope.locator('label').filter({ hasText: new RegExp(`^${f.replace('/', '\\/')}$`) }).first();
        await lbl.click();
    }
}

await page.goto(`${BASE}/settings/employees`);
await page.waitForLoadState('networkidle');

for (const u of USERS) {
    try {
        await page.getByRole('button', { name: /Nuevo empleado/i }).click();
        const modal = page.locator('form').filter({ hasText: 'Nuevo empleado' });
        await modal.getByPlaceholder('Juan Pérez López').fill(u.full);
        await modal.getByPlaceholder('Operador de Soldadura').fill(u.pos);
        await modal.getByPlaceholder('jperez').fill(u.username);
        await modal.getByPlaceholder('Mínimo 6 caracteres').fill('QaPrueba#2026');
        await modal.locator('select').first().selectOption(u.role);
        if (u.photo) {
            await modal.locator('input[type=file]').setInputFiles(u.photo);
            await page.waitForTimeout(1500);
        }
        for (const [m, s, flags] of u.perms) await grant(modal, m, s, flags);
        await shot(page, `users-form-${u.username}`);
        await modal.getByRole('button', { name: /Crear empleado/i }).click();
        await page.waitForTimeout(2000);
        const stillOpen = await page.locator('form h2', { hasText: 'Nuevo empleado' }).count();
        const errBox = stillOpen ? await modal.locator('.text-rose-200, .text-rose-300, [class*="rose"]').allInnerTexts() : [];
        results.push({ user: u.username, ok: !stillOpen, note: errBox.join(' | ').slice(0, 300) });
        if (stillOpen) await page.keyboard.press('Escape');
    } catch (e) {
        results.push({ user: u.username, ok: false, note: e.message.slice(0, 300) });
        await shot(page, `users-fail-${u.username}`);
        await page.goto(`${BASE}/settings/employees`);
    }
}
await page.reload();
await shot(page, 'users-list');
console.log(JSON.stringify({ results, errors }, null, 1));
await browser.close();
