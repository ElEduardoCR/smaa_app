// E2E 04 — ¿Las tarjetas del Inicio y los enlaces del menú lateral llevan a
// páginas que el usuario sí puede abrir?
import { launch, loginContext, BASE } from './lib.mjs';
const USERS = (process.env.USERS || 'qa_admin,qa_operador,qa_almacen,qa_finanzas,qa_cxc,qa_calidad,qa_docs,qa_direccion').split(',');
const browser = await launch();
for (const u of USERS) {
    const ctx = await loginContext(browser, u, 'QaPrueba#2026');
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const cards = await page.locator('.app-main a[href^="/"]').evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute('href')))]);
    const side = await page.locator('.app-sidebar a[href^="/"]').evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute('href')))]);
    const all = [...new Set([...cards, ...side])].filter((h) => h !== '/');
    const dead = [];
    for (const h of all) {
        await page.goto(`${BASE}${h}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(300);
        if (page.url().includes('denied=1')) dead.push(`${h} [${cards.includes(h) ? 'tarjeta' : ''}${cards.includes(h) && side.includes(h) ? '+' : ''}${side.includes(h) ? 'menú' : ''}]`);
    }
    const onlySide = side.filter((h) => h !== '/' && !cards.includes(h));
    const onlyCards = cards.filter((h) => !side.includes(h));
    console.log(`\n${u}\n  tarjetas: ${cards.join(' ')}\n  menú:     ${side.join(' ')}\n  solo en menú: ${onlySide.join(' ') || '-'} | solo en tarjetas: ${onlyCards.join(' ') || '-'}\n  ENLACES A "ACCESO DENEGADO": ${dead.join(', ') || 'ninguno'}`);
    await ctx.close();
}
await browser.close();
