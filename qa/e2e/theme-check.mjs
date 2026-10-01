// Revisión visual del tema claro/oscuro + menú lateral.
import { launch, loginContext, watch, shot, setTheme, BASE } from './lib.mjs';

const errors = [];
const browser = await launch();
const ctx = await loginContext(browser, 'qa_master', 'QaMaster#2026');
const page = await ctx.newPage();
watch(page, 'theme', errors);

for (const theme of ['light', 'dark']) {
    await page.goto(`${BASE}/`);
    await setTheme(page, theme);
    await page.reload();
    await page.waitForLoadState('networkidle');
    await shot(page, `theme-${theme}-dashboard`);

    await page.goto(`${BASE}/settings/employees`);
    await page.waitForLoadState('networkidle');
    await shot(page, `theme-${theme}-employees`);
    // abrir modal de alta para ver si el menú lateral lo tapa
    const btn = page.getByRole('button', { name: /nuevo/i }).first();
    if (await btn.count()) {
        await btn.click();
        await page.waitForTimeout(500);
        await shot(page, `theme-${theme}-employees-modal`);
        // ¿qué elemento está en la esquina superior izquierda con el modal abierto?
        const topEl = await page.evaluate(() => {
            const el = document.elementFromPoint(100, 300);
            return el ? (el.closest('.app-sidebar') ? 'SIDEBAR (encima del modal)' : el.className?.toString().slice(0, 80)) : null;
        });
        console.log(theme, 'elemento en (100,300) con modal abierto:', topEl);
        await page.keyboard.press('Escape');
    }
}

// Móvil
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await ctx.storageState() });
const mp = await m.newPage();
watch(mp, 'mobile', errors);
await mp.goto(`${BASE}/requisitions`);
await mp.waitForLoadState('networkidle');
await shot(mp, 'theme-mobile-requisitions');
await mp.getByRole('button', { name: 'Abrir menú' }).click();
await mp.waitForTimeout(400);
await shot(mp, 'theme-mobile-drawer');

console.log('ERRORES:', JSON.stringify(errors, null, 1));
await browser.close();
