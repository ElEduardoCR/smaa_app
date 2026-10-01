// E2E 03 — Barrido de todas las pantallas con cada usuario de prueba.
// Registra: a dónde terminó (¿denegado?), errores de render, errores JS,
// respuestas HTTP fallidas y errores del servidor Next en ese intervalo.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { launch, loginContext, BASE, QA } from './lib.mjs';
const require = createRequire(new URL('../../package.json', import.meta.url));
const { Client } = require('pg');

const db = new Client({ host: '127.0.0.1', port: 54322, user: 'postgres', database: 'postgres' });
await db.connect();
const one = async (sql) => (await db.query(sql)).rows[0]?.id ?? null;
const ids = {
    req: await one('select id from requisitions order by created_at limit 1'),
    po: await one('select id from purchase_orders order by created_at limit 1'),
    wo: await one('select w.id from work_orders w order by created_at limit 1'),
    doc: await one('select id from documents order by created_at limit 1'),
    docreq: await one('select id from document_requests order by created_at limit 1'),
    pfmea: await one('select id from pfmea_risks order by created_at limit 1').catch(() => null),
    emp: await one("select id from employees where username='qa_operador'"),
    payroll: await one('select id from payroll_periods order by created_at limit 1').catch(() => null),
    decl: await one('select id from monthly_declarations order by created_at limit 1').catch(() => null),
    client: await one('select id from clients order by id limit 1'),
};
await db.end();

const ROUTES = [
    '/', '/dashboard', '/manufacturing', '/manufacturing/new', '/manufacturing/soldadura', '/manufacturing/maquinado',
    '/quality', '/deliveries', '/deliveries/new', '/requisitions', '/requisitions/new',
    ids.req && `/requisitions/${ids.req}`,
    '/clients', '/sales', '/sales/new', '/sales/quick', '/sales/billing-inbox', '/issued-invoices',
    '/purchases', '/purchases/new', '/purchases/inbox', ids.po && `/purchases/${ids.po}`,
    '/suppliers', '/finance', '/finance/employees', ids.emp && `/finance/employees/${ids.emp}`, '/finance/employees/new',
    '/finance/checador', '/finance/payroll', ids.payroll && `/finance/payroll/${ids.payroll}`, '/finance/iva', '/finance/declarations', ids.decl && `/finance/declarations/${ids.decl}`, '/finance/movements',
    '/finance/receivable', ids.client && `/finance/receivable/${ids.client}`,
    '/pfmea', '/pfmea/new', ids.pfmea && `/pfmea/${ids.pfmea}`,
    '/documents', '/documents/new', ids.doc && `/documents/${ids.doc}`,
    '/documents/requests', '/documents/requests/new', ids.docreq && `/documents/requests/${ids.docreq}`,
    '/changes', '/changes/settings', '/settings', '/settings/employees',
].filter(Boolean);

const USERS = (process.env.USERS || 'qa_master,qa_admin,qa_operador,qa_almacen,qa_finanzas,qa_docs,qa_direccion').split(',');
// Log del servidor Next (opcional) para atribuir errores del servidor a cada pantalla.
const LOG = process.env.NEXT_LOG || `${QA}/../next-dev.log`;
const logSize = () => { try { return fs.statSync(LOG).size; } catch { return 0; } };
const logSince = (n) => { try { return fs.readFileSync(LOG, 'utf8').slice(n); } catch { return ''; } };
const browser = await launch();
const out = {};
for (const u of USERS) {
    const ctx = await loginContext(browser, u, u === 'qa_master' ? 'QaMaster#2026' : 'QaPrueba#2026');
    const page = await ctx.newPage();
    out[u] = [];
    for (const r of ROUTES) {
        const issues = [];
        const onConsole = (m) => { if (m.type() === 'error' && !/hmr|DevTools|hydrat/i.test(m.text())) issues.push('console: ' + m.text().slice(0, 200)); };
        const onErr = (e) => issues.push('js: ' + e.message.slice(0, 200));
        const onResp = async (res) => {
            const url = res.url();
            if (res.status() >= 400 && !url.includes('/_next/') && !url.includes('favicon')) {
                let b = ''; try { b = (await res.text()).slice(0, 160); } catch { /* */ }
                issues.push(`http ${res.status()} ${res.request().method()} ${url.replace(BASE, '').replace('http://127.0.0.1:54321', '[supabase]').slice(0, 120)} ${b}`);
            }
        };
        page.on('console', onConsole); page.on('pageerror', onErr); page.on('response', onResp);
        const logStart = logSize();
        let status = null;
        try {
            const resp = await page.goto(`${BASE}${r}`, { waitUntil: 'networkidle', timeout: 45000 });
            status = resp?.status();
        } catch (e) { issues.push('nav: ' + e.message.split('\n')[0]); }
        await page.waitForTimeout(400);
        const final = page.url().replace(BASE, '');
        const body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
        const boundary = body.match(/(Application error[^.]*|This page couldn.t load|Something went wrong|Ocurrió un error[^.]*|Unhandled Runtime Error|Error: [^.]{0,120}|404: This page could not be found|could not be found)/i);
        if (boundary) issues.push('render: ' + boundary[0].slice(0, 160));
        const serverLog = logSince(logStart).split('\n').filter((l) => /⨯|Error|error/.test(l) && !/hmr/i.test(l)).slice(0, 3);
        for (const l of serverLog) issues.push('server: ' + l.trim().slice(0, 200));
        page.off('console', onConsole); page.off('pageerror', onErr); page.off('response', onResp);
        const denied = final.includes('denied=1') ? 'DENEGADO' : (final.startsWith('/login') ? 'LOGIN' : (final.split('?')[0] !== r ? `→ ${final}` : 'ok'));
        out[u].push({ route: r, status, result: denied, issues });
    }
    await ctx.close();
}
await browser.close();
fs.writeFileSync(`${QA}/crawl.json`, JSON.stringify({ ids, out }, null, 1));
for (const u of USERS) {
    console.log(`\n=== ${u}`);
    for (const x of out[u]) {
        if (x.result !== 'ok' || x.issues.length) console.log(`${x.result.padEnd(10)} ${x.route.padEnd(48)} ${x.issues.join(' || ').slice(0, 400)}`);
    }
    console.log(`ok sin problemas: ${out[u].filter((x) => x.result === 'ok' && !x.issues.length).length}/${out[u].length}`);
}
