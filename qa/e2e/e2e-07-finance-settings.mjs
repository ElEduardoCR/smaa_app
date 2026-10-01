// E2E 07 — Finanzas (expediente, declaraciones) + Configuración (logo).
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { launch, loginContext, watch, shot, fixtures, BASE } from './lib.mjs';
const require = createRequire(new URL('../../package.json', import.meta.url));
const { Client } = require('pg');

const F = fixtures();
const bigPdf = F.pdf.replace('QA-cotizacion.pdf', 'QA-INE-escaneada-4MB.pdf');
if (!fs.existsSync(bigPdf)) fs.writeFileSync(bigPdf, Buffer.concat([fs.readFileSync(F.pdf), Buffer.alloc(4 * 1024 * 1024, 32)]));
const db = new Client({ host: '127.0.0.1', port: 54322, user: 'postgres', database: 'postgres' });
await db.connect();
const empId = (await db.query("select id from employees where username='qa_operador'")).rows[0].id;

const steps = [];
const errors = [];
const browser = await launch();
const page = await (await loginContext(browser, 'qa_master', 'QaMaster#2026')).newPage();
watch(page, 'qa_master', errors);
const text = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
async function step(name, fn) {
    try { steps.push({ name, ok: true, note: (await fn()) ?? '' }); }
    catch (e) { steps.push({ name, ok: false, note: String(e.message).split('\n')[0].slice(0, 300) }); await shot(page, `fail7-${name.replace(/[^a-z0-9]+/gi, '_').slice(0, 30)}`); }
}
page.on('dialog', async (d) => { if (d.type() === 'prompt') await d.accept('2027-12-31').catch(() => {}); });

for (const [label, file, name] of [['PDF chico', F.pdf, 'INE frente ñ.pdf'], ['PDF escaneado de 4 MB', bigPdf, 'INE escaneada.pdf']]) {
    await step(`Expediente: subir ${label}`, async () => {
        await page.goto(`${BASE}/finance/employees/${empId}`);
        await page.waitForTimeout(2500);
        await page.getByRole('button', { name: 'Expediente' }).click();
        await page.waitForTimeout(2000);
        const [chooser] = await Promise.all([
            page.waitForEvent('filechooser', { timeout: 5000 }),
            page.getByRole('button', { name: /^(Subir|Reemplazar)$/ }).first().click(),
        ]);
        await chooser.setFiles({ name, mimeType: 'application/pdf', buffer: fs.readFileSync(file) });
        await page.waitForTimeout(5000);
        const t = await text();
        const ok = t.match(/Documento guardado en el expediente|Constancia guardada/);
        if (!ok) throw new Error(t.match(/(No se pudo[^.]{0,160}|Tipo de archivo[^.]{0,100}|Request Entity Too Large[^.]*|FUNCTION_PAYLOAD_TOO_LARGE|Error[^.]{0,150}|An unexpected response[^.]{0,120})/)?.[0] || errors.slice(-1)[0]?.text || 'sin confirmación');
        return 'guardado';
    });
}
await step('Expediente: ver documento (URL firmada de bucket privado)', async () => {
    await page.goto(`${BASE}/finance/employees/${empId}`);
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: 'Expediente' }).click();
    await page.waitForTimeout(2000);
    const [popup] = await Promise.all([page.waitForEvent('popup', { timeout: 8000 }).catch(() => null), page.locator('button[title="Ver"]').first().click()]);
    if (!popup) throw new Error((await text()).match(/(No se pudo[^.]{0,120})/)?.[0] || 'no abrió');
    await popup.waitForLoadState().catch(() => {});
    return popup.url().replace(/token=[^&]+/, 'token=…').slice(0, 120);
});
// Declaraciones (acuse con acentos): ver e2e-08-declarations.mjs
await step('Configuración: subir logo de la empresa', async () => {
    await page.goto(`${BASE}/settings`);
    await page.waitForTimeout(2000);
    await page.locator('input[type=file]').first().setInputFiles({ name: 'logo empresa.png', mimeType: 'image/png', buffer: fs.readFileSync(F.png) });
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /Guardar Configuración/ }).click();
    await page.waitForTimeout(3000);
    const t = await text();
    const err = t.match(/(Error[^.]{0,150}|mime type[^.]*|Invalid key[^ ]*)/);
    if (err) throw new Error(err[0]);
    const logo = (await db.query('select logo_url from company_settings limit 1')).rows[0]?.logo_url;
    return logo ? 'logo guardado' : 'sin logo_url en BD';
});
await db.end();
console.log(JSON.stringify({ steps, errors: errors.filter((e) => !/hmr|DevTools|hydrat/i.test(e.text)) }, null, 1));
await browser.close();
