// Utilidades compartidas para las pruebas E2E.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

export const BASE = process.env.BASE_URL || 'http://localhost:3000';
export const QA = path.dirname(new URL(import.meta.url).pathname);
export const SHOTS = path.join(QA, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

export async function launch() {
    return chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
}

/** Contexto con sesión iniciada vía /api/auth/login (setea la cookie). */
export async function loginContext(browser, username, password, opts = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-MX', ...opts });
    const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username, password } });
    const body = await r.json().catch(() => ({}));
    if (!r.ok() || !body.ok) throw new Error(`login ${username} falló: ${r.status()} ${JSON.stringify(body)}`);
    return ctx;
}

/** Registra errores de consola, errores JS y respuestas HTTP fallidas de una página. */
export function watch(page, label, sink) {
    page.on('console', (m) => {
        if (m.type() === 'error') sink.push({ label, kind: 'console', text: m.text().slice(0, 400) });
    });
    page.on('pageerror', (e) => sink.push({ label, kind: 'pageerror', text: String(e.message).slice(0, 400) }));
    page.on('response', async (res) => {
        const u = res.url();
        if (res.status() >= 400 && !u.includes('/_next/') && !u.includes('favicon')) {
            let body = '';
            try { body = (await res.text()).slice(0, 300); } catch { /* */ }
            sink.push({ label, kind: 'http', text: `${res.request().method()} ${u.replace(BASE, '')} -> ${res.status()} ${body}` });
        }
    });
    page.on('dialog', async (d) => {
        sink.push({ label, kind: 'dialog', text: `${d.type()}: ${d.message().slice(0, 300)}` });
        await d.accept().catch(() => {});
    });
}

export async function shot(page, name) {
    const p = path.join(SHOTS, `${name}.png`);
    await page.screenshot({ path: p, fullPage: false });
    return p;
}

export async function setTheme(page, theme) {
    await page.evaluate((t) => { localStorage.setItem('smaa-theme', t); document.documentElement.dataset.theme = t; }, theme);
}

/** Archivos de prueba (PDF / PNG / XML) generados en disco. */
export function fixtures() {
    const dir = path.join(QA, 'fixtures');
    fs.mkdirSync(dir, { recursive: true });
    const pdf = path.join(dir, 'QA-cotizacion.pdf');
    if (!fs.existsSync(pdf)) {
        fs.writeFileSync(pdf, '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
    }
    const pdfAccent = path.join(dir, 'Cotización Proveedor Ñandú #1.pdf');
    if (!fs.existsSync(pdfAccent)) fs.copyFileSync(pdf, pdfAccent);
    const png = path.join(dir, 'QA-foto.png');
    if (!fs.existsSync(png)) {
        fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
    }
    const pngAccent = path.join(dir, 'Foto recepción.png');
    if (!fs.existsSync(pngAccent)) fs.copyFileSync(png, pngAccent);
    const xml = path.join(dir, 'QA-factura.xml');
    if (!fs.existsSync(xml)) {
        fs.writeFileSync(xml, `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Serie="QA" Folio="1001" Fecha="2026-09-30T10:00:00" SubTotal="1000.00" Total="1160.00" Moneda="MXN" TipoDeComprobante="I">
  <cfdi:Emisor Rfc="QAPR010101AAA" Nombre="QA PROVEEDOR PRUEBA SA DE CV" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="SMA010101AAA" Nombre="SMAA" UsoCFDI="G03" DomicilioFiscalReceptor="31000" RegimenFiscalReceptor="601"/>
  <cfdi:Conceptos><cfdi:Concepto ClaveProdServ="31161500" Cantidad="10" ClaveUnidad="H87" Descripcion="QA Tornillo prueba" ValorUnitario="100.00" Importe="1000.00" ObjetoImp="02"/></cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="160.00"/>
  <cfdi:Complemento><tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" UUID="11111111-2222-3333-4444-555555555555" FechaTimbrado="2026-09-30T10:05:00"/></cfdi:Complemento>
</cfdi:Comprobante>
`);
    }
    return { pdf, pdfAccent, png, pngAccent, xml };
}
