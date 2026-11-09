/** Prices are stored without VAT; the inclusion flag only describes the entered price. */
export const VAT_RATE = 0.16;

export function roundMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function priceWithoutVat(price: number, includesVat = false, vatRate = VAT_RATE): number {
    const amount = Number(price) || 0;
    return includesVat ? amount / (1 + vatRate) : amount;
}

export type PriceEntry = { quantity: number; unit_price: number; price_includes_vat?: boolean };

export function priceLine(item: PriceEntry, vatRate = VAT_RATE) {
    const unitPrice = priceWithoutVat(item.unit_price, item.price_includes_vat, vatRate);
    const subtotal = roundMoney((Number(item.quantity) || 0) * unitPrice);
    // Derive the payable amount before rounding the base; otherwise a price
    // such as $0.04 including VAT incorrectly becomes $0.03.
    const total = roundMoney((Number(item.quantity) || 0) * unitPrice * (1 + vatRate));
    const vat = roundMoney(total - subtotal);
    return { unitPrice, subtotal, vat, total };
}

export function calculatePriceTotals(items: readonly PriceEntry[], vatRate = VAT_RATE) {
    const lines = items.map((item) => priceLine(item, vatRate));
    const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.subtotal, 0));
    const total = roundMoney(lines.reduce((sum, line) => sum + line.total, 0));
    return { subtotal, vat: roundMoney(total - subtotal), total };
}
