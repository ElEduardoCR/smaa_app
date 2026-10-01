// E2E 05 — Clientes → Ventas → Fabricación (OT completa) → Calidad → Entregas.
import fs from 'node:fs';
import { launch, loginContext, watch, shot, fixtures, BASE } from './lib.mjs';

const F = fixtures();
const steps = [];
const errors = [];
const browser = await launch();
const sessions = {};
async function as(user) {
    if (!sessions[user]) {
        const ctx = await loginContext(browser, user, user === 'qa_master' ? 'QaMaster#2026' : 'QaPrueba#2026', { geolocation: { latitude: 28.6353, longitude: -106.0889 }, permissions: ['geolocation'] });
        const page = await ctx.newPage();
        watch(page, user, errors);
        sessions[user] = page;
    }
    return sessions[user];
}
async function step(name, fn) {
    const t0 = Date.now();
    try {
        const note = await fn();
        steps.push({ name, ok: true, note: note ?? '', ms: Date.now() - t0 });
    } catch (e) {
        steps.push({ name, ok: false, note: String(e.message || e).split('\n')[0].slice(0, 400), ms: Date.now() - t0 });
        const p = sessions[name.match(/\[(\w+)\]/)?.[1]] || Object.values(sessions)[0];
        if (p) await shot(p, `fail5-${name.replace(/[^a-z0-9]+/gi, '_').slice(0, 40)}`).catch(() => {});
    }
}
const fileArg = (p, name, mime) => ({ name: name || p.split('/').pop(), mimeType: mime || (p.endsWith('.pdf') ? 'application/pdf' : p.endsWith('.png') ? 'image/png' : 'image/jpeg'), buffer: fs.readFileSync(p) });
const text = async (page) => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
async function sign(page, nth = 0) {
    const c = page.locator('canvas').nth(nth);
    await c.scrollIntoViewIfNeeded();
    const b = await c.boundingBox();
    await page.mouse.move(b.x + 20, b.y + b.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(b.x + 20 + i * 20, b.y + b.height / 2 + (i % 2 ? 15 : -15));
    await page.mouse.up();
}

// ------------------------------------------------------------------ Clientes
for (const c of [
    { rfc: 'QAC010101AAA', bn: 'QA CLIENTE PRUEBA SA DE CV', name: 'QA Cliente', csf: F.pdf },
    { rfc: 'PEÑA800101AB1', bn: 'QA PEÑA PERSONA FISICA', name: 'QA Peña (RFC con Ñ)', csf: F.pdf },
]) {
    await step(`[qa_admin] Clientes: alta ${c.rfc} con CSF`, async () => {
        const page = await as('qa_admin');
        await page.goto(`${BASE}/clients`);
        await page.getByRole('button', { name: /Agregar|Nuevo/i }).first().click();
        await page.locator('input[name=rfc]').fill(c.rfc);
        await page.locator('input[name=business_name]').fill(c.bn);
        await page.locator('input[name=name]').fill(c.name);
        await page.locator('select[name=fiscal_regime]').selectOption('601');
        await page.locator('input[name=fiscal_zip_code]').fill('31000');
        await page.locator('input[name=payment_days]').fill('30');
        await page.locator('input[type=file]').setInputFiles(fileArg(c.csf, 'Constancia Situación Fiscal.pdf'));
        await page.locator('form button[type=submit]').click();
        await page.waitForTimeout(2500);
        const t = await text(page);
        if (!t.includes('Cliente agregado')) throw new Error(t.match(/(File upload failed[^.]*\.?[^ ]*|Error[^.]{0,160}|RFC[^.]{0,100})/)?.[0] || 'sin mensaje');
        return 'ok';
    });
}

// ------------------------------------------------------------------ Ventas
let quoteNumber = null;
await step('[qa_admin] Ventas: crear cotización', async () => {
    const page = await as('qa_admin');
    await page.goto(`${BASE}/sales/new`);
    await page.waitForTimeout(1500);
    const cs = page.getByPlaceholder('Escribe nombre, alias o RFC…');
    await cs.click(); await cs.fill('QA Cliente');
    await page.getByRole('option', { name: /QA Cliente/ }).first().click();
    await page.locator('input[name=title]').fill('QA Soporte de prueba (borrar)');
    await page.locator('input[name="items.0.description"]').fill('QA Soporte soldado acero A36');
    await page.locator('input[name="items.0.quantity"]').fill('2');
    await page.locator('input[name="items.0.unit_price"]').fill('1000');
    await page.getByRole('button', { name: /Guardar Cotización/ }).click();
    await page.waitForURL(/\/sales$/, { timeout: 15000 }).catch(() => {});
    if (!page.url().endsWith('/sales')) throw new Error((await text(page)).match(/(Please select[^.]*|Error[^.]{0,150}|violates[^.]{0,150})/)?.[0] || 'no regresó a /sales');
    await page.waitForTimeout(1500);
    quoteNumber = (await text(page)).match(/(COT[-\w]*\d+|Q[-\w]*\d{3,})/)?.[0];
    return quoteNumber || 'creada';
});
await step('[qa_admin] Ventas: aprobar cotización + PDF + subir OC del cliente', async () => {
    const page = await as('qa_admin');
    await page.goto(`${BASE}/sales`);
    await page.waitForTimeout(1500);
    const row = page.locator('tr', { hasText: 'QA Soporte de prueba' }).first();
    await row.locator('button[title="Confirm Quote"]').click();
    await page.waitForTimeout(1500);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }).catch(() => null), row.locator('button[title="Download PDF"]').click()]);
    await row.locator('input[type=file]').setInputFiles(fileArg(F.pdf, 'OC cliente nº 123.pdf'));
    await page.waitForTimeout(2500);
    const t = await text(page);
    const alertErr = errors.filter((e) => e.kind === 'dialog' && /Error/.test(e.text)).slice(-1)[0];
    if (alertErr) throw new Error(alertErr.text);
    return `aprobada; PDF: ${dl ? dl.suggestedFilename() : 'NO DESCARGÓ'}; ${t.includes('Approved') || t.includes('Aprobada') ? 'status Approved' : 'status?'}`;
});

// ------------------------------------------------------------------ Fabricación
let otUrl = null;
await step('[qa_admin] Fabricación: crear OT de Soldadura desde la cotización (con WPS)', async () => {
    const page = await as('qa_admin');
    await page.goto(`${BASE}/manufacturing/new`);
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: /Soldadura/ }).first().click();
    await page.getByRole('button', { name: 'Con cotización' }).click();
    await page.getByPlaceholder('Buscar por nombre, descripción, folio, alias o cliente…').fill('QA Soporte');
    await page.waitForTimeout(500);
    await page.locator('button', { hasText: 'QA Soporte de prueba' }).first().click();
    await page.waitForTimeout(800);
    const wps = page.locator('button', { has: page.locator('span.font-mono.text-amber-300') }).first();
    await wps.click();
    await page.getByRole('button', { name: /Crear Orden de Trabajo/ }).click();
    await page.waitForURL(/\/manufacturing\/soldadura\/[0-9a-f-]{36}/, { timeout: 15000 }).catch(() => {});
    if (!/\/manufacturing\/soldadura\/[0-9a-f-]{36}/.test(page.url())) throw new Error((await text(page)).match(/(Selecciona[^.]*|Captura[^.]*|Soldadura requiere[^.]*|La cotización[^.]*|Sin permiso[^.]*|Error[^.]{0,150})/)?.[0] || 'no se creó');
    otUrl = new URL(page.url()).pathname;
    return otUrl;
});
await step('[qa_admin] Fabricación: asignar operador a la OT', async () => {
    const page = await as('qa_admin');
    await page.goto(`${BASE}${otUrl}`);
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: /Asignar/ }).first().click();
    await page.locator('button', { hasText: 'QA Operador Soldadura' }).first().click();
    await page.waitForTimeout(1500);
    const t = await text(page);
    if (!t.includes('QA Operador Soldadura')) throw new Error('no aparece asignado');
    return 'asignado';
});
for (const [label, name] of [['nombre simple', 'QA-plano-brida.pdf'], ['nombre con acentos/símbolos', 'Plano brida 4″ revisión Ñ #2.pdf']]) {
    await step(`[qa_admin] Fabricación: subir plano PDF (${label})`, async () => {
        const page = await as('qa_admin');
        await page.goto(`${BASE}${otUrl}`);
        await page.waitForTimeout(2000);
        await page.locator('input[type=file][multiple]').first().setInputFiles(fileArg(F.pdf, name));
        await page.waitForTimeout(3000);
        const t = await text(page);
        const err = t.match(/(Invalid key[^ ]* [^ ]*|mime type[^.]*|exceeded[^.]*|Error al subir[^.]*)/);
        if (err) throw new Error(err[0]);
        if (!t.includes(name)) throw new Error('no aparece en la lista');
        return 'ok';
    });
}
await step('[qa_operador] Fabricación: operador inicia, pausa y reanuda', async () => {
    const page = await as('qa_operador');
    await page.goto(`${BASE}${otUrl}`);
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: /Iniciar trabajo/ }).click();
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: /^Pausar$/ }).first().click();
    await page.locator('div.fixed select').selectOption({ index: 1 });
    await page.locator('div.fixed textarea').fill('QA pausa de prueba');
    await page.locator('div.fixed').getByRole('button', { name: /Pausar/ }).click();
    await page.waitForTimeout(2000);
    let t = await text(page);
    if (!t.includes('Pausada')) throw new Error('no quedó en pausa');
    await page.getByRole('button', { name: /^Reanudar$/ }).click();
    await page.waitForTimeout(2000);
    t = await text(page);
    if (!t.includes('En curso')) throw new Error('no reanudó');
    return 'In Progress';
});
for (const [label, name] of [['nombre simple', 'pieza-terminada.png'], ['nombre con acentos', 'Pieza terminada ñ #1.png']]) {
    await step(`[qa_operador] Fabricación: foto de pieza terminada (${label})`, async () => {
        const page = await as('qa_operador');
        await page.goto(`${BASE}${otUrl}`);
        await page.waitForTimeout(2500);
        const before = await page.locator('#complete-section img').count();
        await page.locator('#complete-section input[type=file]:not([capture])').first().setInputFiles(fileArg(F.png, name));
        await page.getByRole('button', { name: /Usar esta foto/ }).click();
        await page.waitForTimeout(3500);
        const t = await text(page);
        const err = t.match(/(Invalid key[^ ]* [^ ]*|Error al subir[^.]*|mime type[^.]*)/);
        if (err) throw new Error(err[0]);
        const after = await page.locator('#complete-section img').count();
        if (after <= before) throw new Error('la foto no apareció');
        return 'ok';
    });
}
await step('[qa_operador] Fabricación: firmar y enviar a Calidad', async () => {
    const page = await as('qa_operador');
    await page.goto(`${BASE}${otUrl}`);
    await page.waitForTimeout(2500);
    await sign(page, 0);
    await page.getByRole('button', { name: /Firmar y enviar a Calidad/ }).click();
    await page.waitForTimeout(3500);
    const t = await text(page);
    if (!t.includes('Esta OT está en el módulo de Calidad')) throw new Error(t.match(/(Invalid key[^ ]*|Error[^.]{0,150}|No se pudo[^.]{0,100})/)?.[0] || 'no pasó a QC');
    return 'QC';
});
await step('[qa_operador] Calidad: ¿el operador puede liberar su propia OT? (no debería)', async () => {
    const page = await as('qa_operador');
    await page.goto(`${BASE}${otUrl}`);
    await page.waitForTimeout(2500);
    const visible = await page.getByRole('button', { name: /Firmar y liberar/ }).count();
    if (visible) throw new Error('el operador VE "Firmar y liberar" (sin permiso de Calidad)');
    return 'oculto';
});
await step('[qa_calidad] Calidad: inspector (solo permiso Calidad) abre la OT desde /quality y libera con firma', async () => {
    const page = await as('qa_calidad');
    await page.goto(`${BASE}/quality`);
    await page.waitForTimeout(2000);
    await page.locator(`a[href="${otUrl}"]`).first().click();
    await page.waitForURL(/\/manufacturing\/soldadura\//);
    await page.waitForTimeout(2500);
    await sign(page, 0);
    await page.getByRole('button', { name: /Firmar y liberar/ }).click();
    await page.waitForTimeout(3500);
    const t = await text(page);
    if (!t.includes('Liberada por Calidad')) throw new Error(t.match(/(Error[^.]{0,150})/)?.[0] || 'no liberó');
    return 'QC_Released';
});

// ------------------------------------------------------------------ Entregas
await step('[qa_admin] Entregas: crear entrega de la OT liberada', async () => {
    const page = await as('qa_admin');
    await page.goto(`${BASE}/deliveries/new`);
    await page.waitForTimeout(2000);
    const sel = page.locator('select').first();
    const opts = await sel.locator('option').allInnerTexts();
    const idx = opts.findIndex((o) => /QA Soporte|OT/.test(o) && !/Elige/.test(o));
    if (idx < 0) throw new Error(`la OT no aparece en el selector (${opts.length - 1} opciones)`);
    await sel.selectOption({ index: idx });
    await page.getByPlaceholder('Observaciones sobre la entrega, condiciones del producto, etc.').fill('QA entrega de prueba');
    await page.getByRole('button', { name: /Crear Entrega y Cerrar OT/ }).click();
    await page.waitForURL(/\/deliveries$/, { timeout: 15000 }).catch(() => {});
    if (!page.url().endsWith('/deliveries')) throw new Error((await text(page)).match(/(Error[^.]{0,150}|violates[^.]{0,150})/)?.[0] || 'no regresó');
    return 'creada';
});
await step('[qa_admin] Entregas: foto de embalaje (acentos), embalar, PDF y firma de entrega', async () => {
    const page = await as('qa_admin');
    await page.goto(`${BASE}/deliveries`);
    await page.waitForTimeout(2500);
    const notes = [];
    const fileInputs = page.locator('input[type=file]:not([capture])');
    if (await fileInputs.count()) {
        await fileInputs.first().setInputFiles(fileArg(F.png, 'Embalaje caja nº 1.png'));
        const use = page.getByRole('button', { name: /Usar esta foto/ });
        if (await use.count()) await use.first().click();
        await page.waitForTimeout(3000);
        const t = await text(page);
        const err = t.match(/(Invalid key[^ ]* [^ ]*|Error[^.]{0,120})/);
        notes.push(err ? `foto: ${err[0]}` : 'foto ok');
    }
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null), page.getByRole('button', { name: /PDF/ }).first().click().catch(() => {})]);
    notes.push(dl ? 'pdf ok' : 'pdf NO');
    return notes.join(' | ');
});

console.log(JSON.stringify({ steps, errors: errors.filter((e) => !/webpack-hmr|Fast Refresh|DevTools|hydrat/i.test(e.text)) }, null, 1));
await browser.close();
