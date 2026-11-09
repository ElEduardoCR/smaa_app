type PurposeItem = { purpose?: string | null; notes?: string | null };

/** A line may override the common project/use, or inherit it when left blank. */
export function requisitionItemPurpose(generalPurpose: string | null | undefined, item: PurposeItem): string | null {
    return item.purpose?.trim() || generalPurpose?.trim() || null;
}

export function validateRequisitionPurpose(generalPurpose: string | null | undefined, items: PurposeItem[]): void {
    const missing = items.findIndex(item => !requisitionItemPurpose(generalPurpose, item));
    if (missing !== -1) {
        throw new Error(`Indica para qué se requiere la compra en general o en el artículo ${missing + 1}.`);
    }
}

/** Keep the project/use and the existing specifications when converting to a PO. */
export function requisitionPurchaseNotes(generalPurpose: string | null | undefined, item: PurposeItem): string | null {
    const purpose = requisitionItemPurpose(generalPurpose, item);
    return [purpose ? `Para: ${purpose}` : null, item.notes?.trim()].filter(Boolean).join('\n') || null;
}
