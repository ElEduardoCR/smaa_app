// E2E 02 — Proveedores → Requisiciones → Compras.
import fs from 'node:fs';
import { launch, loginContext, watch, shot, fixtures, BASE } from './lib.mjs';

const F = fixtures();
const big = F.png.replace('QA-foto.png', 'QA-foto-grande-4MB.jpg');
if (!fs.existsSync(big)) fs.writeFileSync(big, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(4 * 1024 * 1024, 7)]));
const xlsx = F.pdf.replace('QA-cotizacion.pdf', 'QA-cotizacion.xlsx');
if (!fs.existsSync(xlsx)) fs.writeFileSync(xlsx, Buffer.from('PK\x03\x04 fake xlsx'));

const steps = [];
const errors = [];
const browser = await launch();
const sessions = {};
async function as(user) {
    if (!sessions[user]) {
        const ctx = await loginContext(browser, user, user === 'qa_master' ? 'QaMaster#2026' : 'QaPrueba#2026');
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
        steps.push({ name, ok: false, note: String(e.message || e).slice(0, 400), ms: Date.now() - t0 });
        for (const p of Object.values(sessions)) await shot(p, `fail-${name.replace(/[^a-z0-9]+/gi, '_').slice(0, 40)}`).catch(() => {});
    }
}
const fileArg = (p, name, mime) => ({ name: name || p.split('/').pop(), mimeType: mime || (p.endsWith('.pdf') ? 'application/pdf' : p.endsWith('.png') ? 'image/png' : p.endsWith('.jpg') ? 'image/jpeg' : p.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/octet-stream'), buffer: fs.readFileSync(p) });
const bodyText = async (page) => (await page.locator('body').innerText()).replace(/\s+/g, ' ');

// ---------------------------------------------------------------- Proveedores
const SUPPLIERS = [
    { rfc: 'QAP010101AAA', business_name: 'QA PROVEEDOR UNO SA DE CV', name: 'QA Aceros', file: F.pdf },
    { rfc: 'QAD020202BBB', business_name: 'QA DISTRIBUIDORA DOS SA DE CV', name: 'QA Tornillería', file: null },
    { rfc: 'MUÑ850101AB1', business_name: 'QA MUÑOZ FERRETERA', name: 'QA Muñoz (RFC con Ñ)', file: F.pdf },
];
for (const s of SUPPLIERS) {
    await step(`Proveedor: alta ${s.rfc}${s.file ? ' con CSF' : ''}`, async () => {
        const page = await as('qa_admin');
        await page.goto(`${BASE}/suppliers`);
        await page.getByRole('button', { name: /Agregar Proveedor/i }).click();
        if (s.file) {
            await page.locator('input[type=file]').first().setInputFiles(fileArg(s.file));
            await page.waitForTimeout(2500);
        }
        await page.locator('input[name=rfc]').fill(s.rfc);
        await page.locator('input[name=business_name]').fill(s.business_name);
        await page.locator('input[name=name]').fill(s.name);
        await page.locator('form button[type=submit]').click();
        await page.waitForTimeout(2500);
        const txt = await bodyText(page);
        if (!txt.includes('Proveedor agregado')) {
            const m = txt.match(/(Upload failed[^.]*\.|Error[^.]{0,160}|RFC[^.]{0,120}\.)/);
            throw new Error(m ? m[0] : 'sin mensaje de éxito');
        }
        return 'ok';
    });
}
await step('Proveedor: editar y obsoletar/restaurar', async () => {
    const page = await as('qa_admin');
    await page.goto(`${BASE}/suppliers`);
    await page.getByPlaceholder('Buscar nombre, razón social o RFC...').fill('QAD020202BBB');
    await page.waitForTimeout(800);
    const row = page.locator('tr', { hasText: 'QAD020202BBB' });
    await row.locator('button').first().click(); // editar
    await page.locator('input[name=phone]').fill('6141234567');
    await page.locator('form button[type=submit]').click();
    await page.waitForTimeout(2000);
    if (!(await bodyText(page)).includes('Proveedor actualizado')) throw new Error('no se actualizó');
    await page.getByPlaceholder('Buscar nombre, razón social o RFC...').fill('QAD020202BBB');
    await page.waitForTimeout(800);
    await page.locator('tr', { hasText: 'QAD020202BBB' }).locator('button[title*="bsolet" i], button:has(svg.lucide-archive)').first().click();
    await page.waitForTimeout(1500);
    return 'editado + obsoletado';
});

// ---------------------------------------------------------------- Requisiciones
let reqOperador = null, reqAlmacen = null;
await step('Requisiciones: operador (solo "Solicitar insumos") ve el módulo en el inicio', async () => {
    const page = await as('qa_operador');
    await page.goto(`${BASE}/`);
    const cardVisible = await page.locator('main, .app-main').getByText('Requisiciones', { exact: true }).count();
    const inSidebar = await page.locator('.app-sidebar').getByText('Requisiciones', { exact: true }).count();
    if (!cardVisible) throw new Error(`tarjeta NO visible en Inicio (menú lateral: ${inSidebar ? 'sí' : 'no'})`);
    return 'visible';
});
await step('Requisiciones: operador abre la lista /requisitions', async () => {
    const page = await as('qa_operador');
    await page.goto(`${BASE}/requisitions`);
    await page.waitForLoadState('networkidle');
    if (page.url().includes('denied')) throw new Error(`redirigido a ${page.url().replace(BASE, '')}`);
    return page.url().replace(BASE, '');
});
await step('Requisiciones: operador crea requisición con cotización (nombre con acentos)', async () => {
    const page = await as('qa_operador');
    await page.goto(`${BASE}/requisitions/new`);
    await page.getByPlaceholder('Descripción (ej. Electrodo E7018 3/32)').fill('QA Electrodo E7018 3/32');
    await page.locator('input[type=number]').first().fill('5');
    await page.getByPlaceholder("O escribe uno libre (ej. 'Materiales del Sur')").fill('QA Aceros');
    await page.getByPlaceholder('Para qué es el material, especificaciones adicionales, etc.').fill('QA requisición de prueba (borrar)');
    await page.locator('input[type=file]').setInputFiles(fileArg(F.pdfAccent));
    await page.waitForTimeout(2500);
    const t1 = await bodyText(page);
    if (/Error al subir|No tienes permisos|No se pudo preparar/.test(t1)) throw new Error(t1.match(/(Error al subir[^.]*|No tienes permisos[^.]*|No se pudo preparar[^.]*)/)[0]);
    await page.getByRole('button', { name: /Crear requisición/i }).click();
    await page.waitForURL(/\/requisitions\/[0-9a-f-]{36}|denied=1/, { timeout: 15000 });
    reqOperador = await page.evaluate(async () => location.pathname);
    if (page.url().includes('denied')) throw new Error('se creó, pero al redirigir al detalle el operador recibe "acceso denegado"');
    return reqOperador;
});
await step('Requisiciones: operador abre el detalle de SU requisición', async () => {
    const page = await as('qa_operador');
    if (!reqOperador) throw new Error('no se creó');
    await page.goto(`${BASE}${reqOperador}`);
    await page.waitForLoadState('networkidle');
    if (page.url().includes('denied')) throw new Error(`redirigido a ${page.url().replace(BASE, '')}`);
    return 'ok';
});
await step('Requisiciones: almacén (Ver + Solicitar) crea, ve lista y detalle', async () => {
    const page = await as('qa_almacen');
    await page.goto(`${BASE}/requisitions/new`);
    await page.getByPlaceholder('Descripción (ej. Electrodo E7018 3/32)').fill('QA Disco de corte 4.5"');
    await page.getByRole('button', { name: /Agregar/ }).first().click();
    await page.getByPlaceholder('Descripción (ej. Electrodo E7018 3/32)').nth(1).fill('QA Guantes de carnaza');
    await page.locator('select').nth(1).selectOption({ index: 1 }).catch(() => {});
    await page.getByRole('button', { name: /Crear requisición/i }).click();
    await page.waitForURL(/\/requisitions\/[0-9a-f-]{36}|denied=1/, { timeout: 15000 });
    if (page.url().includes('denied')) throw new Error('acceso denegado al detalle');
    reqAlmacen = new URL(page.url()).pathname;
    await page.goto(`${BASE}/requisitions`);
    const t = await bodyText(page);
    if (!t.includes('QA Almacenista') && !t.includes('REQ-')) throw new Error('lista vacía');
    return reqAlmacen;
});
await step('Requisiciones: almacén cancela su propia requisición', async () => {
    const page = await as('qa_almacen');
    await page.goto(`${BASE}${reqAlmacen}`);
    await page.getByRole('button', { name: /^Cancelar$/ }).click();
    await page.waitForTimeout(5000);
    const t = await bodyText(page);
    if (!/cancelada/i.test(t)) throw new Error('no cambió a Cancelada');
    return 'cancelada';
});
await step('Requisiciones: comprador ve pendientes y cierra compra (factura PDF + foto, nombres con acentos)', async () => {
    const page = await as('qa_admin');
    await page.goto(`${BASE}/requisitions`);
    const link = page.locator('a[href^="/requisitions/"]').filter({ hasText: /REQ-/ }).first();
    const href = reqOperador && !reqOperador.includes('denied') ? reqOperador : await link.getAttribute('href');
    await page.goto(`${BASE}${href}`);
    await page.getByRole('button', { name: /Marcar como comprada/i }).click();
    const modal = page.locator('form').filter({ hasText: 'Cerrar compra' });
    await modal.locator('input[type=file]').nth(0).setInputFiles(fileArg(F.pdfAccent, 'Factura Ñandú #77.pdf'));
    await page.waitForTimeout(2500);
    await modal.locator('input[type=file]').nth(0).setInputFiles(fileArg(F.pngAccent)).catch(() => {});
    await page.waitForTimeout(2500);
    let t = await bodyText(page);
    if (/Error al subir[^.]*/.test(t)) throw new Error(t.match(/Error al subir[^.]*/)[0]);
    await modal.getByPlaceholder('Proveedor real, fecha, observaciones…').fill('QA compra cerrada en prueba');
    await modal.getByRole('button', { name: /Confirmar compra/i }).click();
    await page.waitForTimeout(3000);
    t = await bodyText(page);
    const m = t.match(/(PO\d{5})/);
    if (!t.includes('Compra cerrada')) throw new Error(t.match(/(No se pudo[^.]*|La factura[^.]*|Error[^.]{0,150})/)?.[0] || 'sin confirmación');
    const needsSupplier = t.includes('No se pudo asignar proveedor automáticamente');
    return `PO creada: ${m ? m[1] : '(número no visible)'}; proveedor ${needsSupplier ? 'NO asignado (texto libre no coincidió)' : 'asignado'}`;
});
await step('Requisiciones: almacén (sin "Convertir a compra") NO ve botón de comprar', async () => {
    const page = await as('qa_almacen');
    await page.goto(`${BASE}/requisitions?tab=pending`);
    const href = await page.locator('a[href^="/requisitions/"]').filter({ hasText: /REQ-/ }).first().getAttribute('href').catch(() => null);
    if (!href) return 'no hay pendientes visibles';
    await page.goto(`${BASE}${href}`);
    const n = await page.getByRole('button', { name: /Marcar como comprada/i }).count();
    if (n) throw new Error('el botón aparece sin permiso');
    return 'correcto';
});

// ---------------------------------------------------------------- Compras
await step('Compras: /purchases/new abre en modo "compra única"', async () => {
    const page = await as('qa_admin');
    await page.goto(`${BASE}/purchases/new`);
    await page.waitForTimeout(1500);
    const t = await bodyText(page);
    if (t.includes('Modo: Multicompra')) throw new Error('abre en "Multicompra" con 2 proveedores vacíos por defecto');
    return 'compra única';
});
async function pickSupplier(page, gIdx, text) {
    const combo = page.getByPlaceholder('Buscar por nombre, razón social o RFC…').nth(gIdx);
    await combo.click();
    await combo.fill(text);
    await page.locator('button', { hasText: text }).first().click();
}
await step('Compras: crear PO única con cotización PDF', async () => {
    const page = await as('qa_admin');
    await page.goto(`${BASE}/purchases/new`);
    await page.waitForTimeout(1500);
    if ((await bodyText(page)).includes('Modo: Multicompra')) await page.getByRole('button', { name: /Cambiar a compra única/ }).click();
    await pickSupplier(page, 0, 'QA Aceros');
    await page.locator('input[type=file]').first().setInputFiles(fileArg(F.pdfAccent));
    await page.getByPlaceholder('Descripción del artículo').first().fill('QA Placa A36 1/4"');
    await page.locator('input[name="groups.0.items.0.quantity"]').fill('3');
    await page.locator('input[name="groups.0.items.0.unit_price"]').fill('1500');
    await page.getByPlaceholder('Condiciones de pago, observaciones, referencia…').fill('QA PO de prueba (borrar)');
    await page.getByRole('button', { name: /Crear Orden de Compra/ }).click();
    await page.waitForURL(/\/purchases$/, { timeout: 15000 }).catch(() => {});
    if (!page.url().endsWith('/purchases')) throw new Error((await bodyText(page)).match(/(Error[^.]{0,200}|mime type[^.]*|Invalid key[^.]*|new row[^.]*)/)?.[0] || 'no regresó a la lista');
    return 'creada';
});
await step('Compras: crear multicompra (2 proveedores) con cotizaciones', async () => {
    const page = await as('qa_admin');
    await page.goto(`${BASE}/purchases/new`);
    await page.waitForTimeout(1500);
    if (!(await bodyText(page)).includes('Modo: Multicompra')) await page.getByRole('button', { name: /Activar multicompra/ }).click();
    await pickSupplier(page, 0, 'QA Aceros');
    await pickSupplier(page, 1, 'QA Tornillería');
    await page.locator('input[type=file]').nth(0).setInputFiles(fileArg(F.pdf));
    await page.locator('input[type=file]').nth(1).setInputFiles(fileArg(F.png, 'cotización foto.png'));
    await page.getByPlaceholder('Descripción del artículo').nth(0).fill('QA Solera 2x1/4');
    await page.getByPlaceholder('Descripción del artículo').nth(1).fill('QA Pintura primer');
    await page.locator('input[name="groups.0.items.0.unit_price"]').fill('250');
    await page.locator('input[name="groups.1.items.0.unit_price"]').fill('480');
    await page.getByRole('button', { name: /Crear 2 POs/ }).click();
    await page.waitForTimeout(4000);
    const t = await bodyText(page);
    if (!/PO\d{5}/.test(t)) throw new Error(t.match(/(Error[^.]{0,200}|mime type[^.]*|Invalid key[^.]*)/i)?.[0] || 'error');
    return 'ok';
});
async function openPOByText(page, text) {
    await page.goto(`${BASE}/purchases`);
    await page.waitForTimeout(1500);
    const search = page.getByPlaceholder(/Buscar/).first();
    await search.fill(text);
    await page.waitForTimeout(800);
    return page.locator('tbody tr').filter({ hasText: /PO\d/ }).first();
}
await step('Compras: recibir PO con factura PDF + foto pequeña', async () => {
    const page = await as('qa_admin');
    const row = await openPOByText(page, 'QA Placa');
    await row.getByRole('button', { name: /Recibir/ }).click();
    const inputs = page.locator('div.fixed input[type=file]');
    await inputs.nth(0).setInputFiles(fileArg(F.pdfAccent, 'Factura QA Ñ.pdf'));
    await inputs.nth(1).setInputFiles(fileArg(F.png));
    await page.getByRole('button', { name: /Finalizar recepción/ }).click();
    await page.waitForTimeout(4000);
    const t = await bodyText(page);
    if (t.includes('Finalizar recepción')) throw new Error(errors.filter((e) => e.kind === 'dialog').slice(-1)[0]?.text || 'el modal sigue abierto');
    return 'Received';
});
await step('Compras: recibir PO con factura PDF + foto de celular de 4 MB (límite Vercel 4.5 MB)', async () => {
    const page = await as('qa_admin');
    const row = await openPOByText(page, 'QA Solera');
    await row.getByRole('button', { name: /Recibir/ }).click();
    const inputs = page.locator('div.fixed input[type=file]');
    await inputs.nth(0).setInputFiles(fileArg(F.pdf));
    await inputs.nth(1).setInputFiles(fileArg(big));
    await page.getByRole('button', { name: /Finalizar recepción/ }).click();
    await page.waitForTimeout(5000);
    const t = await bodyText(page);
    if (t.includes('Finalizar recepción')) throw new Error('falló: ' + (errors.filter((e) => e.kind === 'dialog').slice(-1)[0]?.text || 'modal abierto'));
    return 'Received';
});
await step('Compras: editar PO (precio, estatus Sent) y adjuntar cotización Excel', async () => {
    const page = await as('qa_admin');
    const row = await openPOByText(page, 'QA Pintura');
    await row.getByRole('link', { name: /Editar/ }).click();
    await page.waitForURL(/\/purchases\/[0-9a-f-]{36}/);
    await page.locator('input[type=number]').nth(1).fill('500');
    await page.locator('select').filter({ has: page.locator('option[value="Sent"]') }).first().selectOption('Sent');
    await page.getByRole('button', { name: /^Guardar$/ }).first().click();
    await page.waitForTimeout(2500);
    let t = await bodyText(page);
    if (!t.includes('Orden actualizada')) throw new Error(t.match(/(Error[^.]{0,200}|No tienes[^.]*|Selecciona[^.]*)/)?.[0] || 'no se actualizó');
    // Adjuntar "otro" (Excel)
    const kindSel = page.locator('select').filter({ has: page.locator('option[value="other"]') }).first();
    await kindSel.selectOption('other');
    await page.locator('input[type=file]').setInputFiles(fileArg(xlsx));
    await page.getByRole('button', { name: /Subir/ }).last().click();
    await page.waitForTimeout(3000);
    t = await bodyText(page);
    const err = t.match(/(Error al subir[^.]*\.?[^.]*|mime type[^.]*)/);
    if (err) throw new Error(err[0]);
    return 'actualizada + adjunto';
});
await step('Compras: obsoletar y restaurar PO', async () => {
    const page = await as('qa_admin');
    const row = await openPOByText(page, 'QA Pintura');
    await row.getByRole('button', { name: /Obsoletar/ }).click();
    await page.waitForTimeout(2000);
    await page.getByText(/Mostrar obsoletos|obsoletas/i).first().click().catch(() => {});
    await page.waitForTimeout(800);
    const r2 = page.locator('tbody tr').filter({ hasText: /PO\d/ }).filter({ has: page.getByRole('button', { name: /Restaurar/ }) }).first();
    await r2.getByRole('button', { name: /Restaurar/ }).click();
    await page.waitForTimeout(2000);
    return 'ok';
});
await step('Compras: PDF de la PO se genera', async () => {
    const page = await as('qa_admin');
    const row = await openPOByText(page, 'QA Placa');
    const [dl] = await Promise.all([
        page.waitForEvent('download', { timeout: 10000 }).catch(() => null),
        row.getByRole('button', { name: /PDF/ }).click(),
    ]);
    if (!dl) throw new Error(errors.filter((e) => e.label === 'qa_admin').slice(-1)[0]?.text || 'no hubo descarga');
    return dl.suggestedFilename();
});
await step('Compras: usuario solo-lectura (almacén) intenta recibir', async () => {
    const page = await as('qa_almacen');
    const row = await openPOByText(page, 'QA Pintura');
    const btn = row.getByRole('button', { name: /Recibir/ });
    if (!(await btn.count())) return 'botón oculto (correcto)';
    await btn.click();
    await page.locator('div.fixed input[type=file]').nth(0).setInputFiles(fileArg(F.pdf));
    await page.getByRole('button', { name: /Finalizar recepción/ }).click();
    await page.waitForTimeout(2500);
    const d = errors.filter((e) => e.label === 'qa_almacen' && e.kind === 'dialog').slice(-1)[0]?.text || '';
    if (/permisos/.test(d)) return `botón visible pero el servidor lo bloquea: "${d}"`;
    throw new Error('¡pudo recibir sin permiso de edición!');
});

console.log(JSON.stringify({ steps, errors: errors.filter((e) => !/webpack-hmr|Fast Refresh|DevTools/.test(e.text)) }, null, 1));
await browser.close();
