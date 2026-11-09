import assert from 'node:assert/strict';
import { calculatePriceTotals, priceLine, priceWithoutVat, roundMoney } from '../src/lib/pricing';

assert.deepEqual(priceLine({ quantity: 1, unit_price: 116, price_includes_vat: true }), {
    unitPrice: 100, subtotal: 100, vat: 16, total: 116,
});
assert.deepEqual(calculatePriceTotals([{ quantity: 1, unit_price: 100 }]), { subtotal: 100, vat: 16, total: 116 });

// Preserve unit precision: rounding 100 / 1.16 too early overcharges three units.
const entered = { quantity: 3, unit_price: 100, price_includes_vat: true };
assert.deepEqual(calculatePriceTotals([entered]), { subtotal: 258.62, vat: 41.38, total: 300 });
const saved = { quantity: entered.quantity, unit_price: priceWithoutVat(entered.unit_price, true) };
assert.deepEqual(calculatePriceTotals([saved]), calculatePriceTotals([entered]));

// A document can mix prices entered with and without VAT.
assert.deepEqual(calculatePriceTotals([
    { quantity: 2, unit_price: 116, price_includes_vat: true },
    { quantity: 1, unit_price: 50 },
]), { subtotal: 250, vat: 40, total: 290 });
assert.deepEqual(calculatePriceTotals([{ quantity: 0.5, unit_price: 116, price_includes_vat: true }]), { subtotal: 50, vat: 8, total: 58 });
assert.deepEqual(calculatePriceTotals([]), { subtotal: 0, vat: 0, total: 0 });
assert.deepEqual(calculatePriceTotals([{ quantity: 1, unit_price: 0, price_includes_vat: true }]), { subtotal: 0, vat: 0, total: 0 });
assert.equal(priceWithoutVat(108, true, 0.08), 100);
assert.equal(priceWithoutVat(100, true, 0), 100);
// Quotation profit applies to the untaxed cost; customer VAT is added only once.
assert.deepEqual(calculatePriceTotals([{ quantity: 1, unit_price: priceWithoutVat(116, true) * 1.38 }]), { subtotal: 138, vat: 22.08, total: 160.08 });
// Manual receivables store the rounded base and recalculate the same displayed total.
const gross = roundMoney(priceWithoutVat(100, true));
assert.equal(roundMoney(gross + roundMoney(gross * 0.16)), 100);
for (const amount of [0.01, 0.04, 0.07, 0.11, 100.01, 100.08, 999.99]) {
    const line = { quantity: 1, unit_price: amount, price_includes_vat: true };
    const savedLine = { quantity: 1, unit_price: priceWithoutVat(amount, true) };
    assert.equal(priceLine(line).total, amount);
    assert.equal(priceLine(savedLine).total, amount);
    assert.deepEqual(calculatePriceTotals([savedLine]), calculatePriceTotals([line]));
}
assert.deepEqual(calculatePriceTotals([
    { quantity: 1, unit_price: 0.04, price_includes_vat: true },
    { quantity: 1, unit_price: 0.04, price_includes_vat: true },
    { quantity: 1, unit_price: 100.01, price_includes_vat: true },
]), { subtotal: 86.28, vat: 13.81, total: 100.09 });
for (let cents = 1; cents <= 10000; cents++) {
    const entered = cents / 100;
    const invoice = priceLine({ quantity: 1, unit_price: entered, price_includes_vat: true });
    assert.equal(invoice.total, entered);
    assert.equal(roundMoney(invoice.subtotal + invoice.vat), entered);
}
console.log('Pricing: VAT included/excluded, mixed lines, fractional quantities, profit and save/reload checks passed.');
