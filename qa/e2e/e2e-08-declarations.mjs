import fs from 'node:fs';
import { launch, loginContext, watch, shot, fixtures, BASE } from './lib.mjs';
const F = fixtures();
const errors = [];
const browser = await launch();
const page = await (await loginContext(browser, 'qa_master', 'QaMaster#2026')).newPage();
watch(page, 'qa_master', errors);
const text = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
await page.goto(`${BASE}/finance/declarations`);
await page.waitForTimeout(2000);
await page.getByRole('button', { name: /Nueva declaración/ }).click();
await page.getByPlaceholder('2026-01').fill('2026-07');
await page.getByRole('button', { name: /^Crear$/ }).click();
await page.waitForURL(/\/finance\/declarations\/[0-9a-f-]{36}/, { timeout: 15000 }).catch(() => {});
console.log('URL:', page.url().replace(BASE, ''));
await page.waitForTimeout(2500);
for (const name of ['Acuse de recibo Declaración IVA.pdf']) {
    await page.locator('input[type=file]').first().setInputFiles({ name, mimeType: 'application/pdf', buffer: fs.readFileSync(F.pdf) });
    await page.waitForTimeout(5000);
    const t = await text();
    console.log(name, '→', t.match(/(Invalid key[^ ]* [^ ]*|Error[^.]{0,150}|No se pudo[^.]{0,100}|Acuse[^.]{0,80}guardad[^.]{0,40}|comparaci[^.]{0,60})/)?.[0] || '(sin mensaje)');
}
await shot(page, 'declaration');
console.log(JSON.stringify(errors.filter((e) => !/hmr|DevTools|hydrat/i.test(e.text)).map((e) => e.text.slice(0, 200)), null, 1));
await browser.close();
