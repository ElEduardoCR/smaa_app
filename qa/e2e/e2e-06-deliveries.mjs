// E2E 06 — Entregas: crear, foto de factura/embalaje, embalar, PDF, firma de entrega.
import fs from 'node:fs';
import { launch, loginContext, watch, shot, fixtures, BASE } from './lib.mjs';
const F = fixtures();
const errors = [];
const steps = [];
const browser = await launch();
const ctx = await loginContext(browser, 'qa_admin', 'QaPrueba#2026', { geolocation: { latitude: 28.6353, longitude: -106.0889 }, permissions: ['geolocation'] });
const page = await ctx.newPage();
watch(page, 'qa_admin', errors);
const text = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
const fileArg = (name) => ({ name, mimeType: 'image/png', buffer: fs.readFileSync(F.png) });
async function step(name, fn) {
    try { steps.push({ name, ok: true, note: (await fn()) ?? '' }); }
    catch (e) { steps.push({ name, ok: false, note: String(e.message).split('\n')[0].slice(0, 300) }); await shot(page, `fail6-${name.replace(/[^a-z0-9]+/gi, '_').slice(0, 30)}`); }
}
await step('Entregas: crear entrega de la OT liberada', async () => {
    await page.goto(`${BASE}/deliveries/new`);
    await page.waitForTimeout(2000);
    const sel = page.locator('select').first();
    const opts = await sel.locator('option').allInnerTexts();
    const idx = opts.findIndex((o) => o.startsWith('✓'));
    if (idx < 0 && opts.some((o) => o.startsWith('🚚'))) return 'la OT ya tiene entrega (creada en e2e-05)';
    if (idx < 0) throw new Error(`sin OTs disponibles: ${opts.join(' | ')}`);
    await sel.selectOption({ index: idx });
    await page.getByPlaceholder('Observaciones sobre la entrega, condiciones del producto, etc.').fill('QA entrega de prueba');
    await page.locator('select').nth(1).selectOption('Paquetería');
    await page.getByPlaceholder('Ej: DHL, FedEx, Estafeta').fill('QA Paquetería');
    await page.getByRole('button', { name: /Crear Entrega y Cerrar OT/ }).click();
    await page.waitForURL(/\/deliveries$/, { timeout: 15000 }).catch(() => {});
    if (!page.url().endsWith('/deliveries')) throw new Error((await text()).match(/(Error[^.]{0,150}|duplicate[^.]{0,150}|violates[^.]{0,150})/)?.[0] || 'no regresó');
    return 'creada';
});
await page.goto(`${BASE}/deliveries`);
await page.waitForTimeout(2500);
await shot(page, 'deliveries-1');
console.log('botones:', (await page.getByRole('button').allInnerTexts()).map((s) => s.trim()).filter(Boolean).join(' | ').slice(0, 800));
for (const [label, name] of [['simple', 'embalaje-1.png'], ['acentos', 'Embalaje caja nº 1 (recepción).png']]) {
    await step(`Entregas: foto (${label})`, async () => {
        await page.goto(`${BASE}/deliveries`);
        await page.waitForTimeout(2500);
        const before = await page.locator('img').count();
        await page.getByRole('button', { name: /Subir foto del embalaje/ }).first().click();
        await page.waitForTimeout(500);
        const input = page.locator('input[type=file]:not([capture])').first();
        if (!(await input.count())) throw new Error('no hay input de foto visible (¿requiere abrir un panel?)');
        await input.setInputFiles(fileArg(name));
        await page.getByRole('button', { name: /Usar esta foto/ }).first().click();
        await page.waitForTimeout(3500);
        const t = await text();
        const err = t.match(/(Invalid key[^ ]* [^ ]*|Error[^.]{0,150})/);
        if (err) throw new Error(err[0]);
        if ((await page.locator('img').count()) <= before) throw new Error('la foto no apareció');
        return 'ok';
    });
}
await step('Entregas: marcar empacado y firmar entrega', async () => {
    await page.goto(`${BASE}/deliveries`);
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: /Marcar como empacado/ }).first().click();
    await page.waitForTimeout(2000);
    let t = await text();
    if (/Error/.test(t)) throw new Error(t.match(/Error[^.]{0,150}/)[0]);
    await page.getByRole('button', { name: /Firmar entrega/ }).first().click();
    await page.waitForTimeout(800);
    const c = page.locator('div.fixed canvas').first();
    const b = await c.boundingBox();
    await page.mouse.move(b.x + 20, b.y + b.height / 2); await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(b.x + 20 + i * 20, b.y + b.height / 2 + (i % 2 ? 15 : -15));
    await page.mouse.up();
    await page.getByRole('button', { name: /Confirmar entrega/ }).click();
    await page.waitForTimeout(3000);
    t = await text();
    if (!/Entrega confirmada|Entregados \(1\)/.test(t)) throw new Error(t.match(/(Error[^.]{0,150}|Invalid key[^ ]*)/)?.[0] || 'no se confirmó');
    return 'entregada';
});
await step('Entregas: PDF de nota de entrega', async () => {
    await page.goto(`${BASE}/deliveries`);
    await page.waitForTimeout(2000);
    // Ya entregada: la tarjeta vive en la pestaña "Entregados".
    if (!(await page.getByRole('button', { name: /PDF/ }).count())) await page.getByRole('button', { name: /Entregados/ }).click();
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }).catch(() => null), page.getByRole('button', { name: /PDF/ }).first().click()]);
    if (!dl) throw new Error(errors.slice(-1)[0]?.text || 'sin descarga');
    return dl.suggestedFilename();
});
console.log(JSON.stringify({ steps, errors: errors.filter((e) => !/hmr|DevTools|hydrat/i.test(e.text)) }, null, 1));
await browser.close();
