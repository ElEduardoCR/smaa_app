import { matchesSearch } from './search';

type SearchablePurchase = {
    po_number: string;
    notes?: string | null;
    supplier?: { name?: string | null; business_name?: string | null; rfc?: string | null } | null;
    items?: { description: string; notes?: string | null }[] | null;
};

export function matchesPurchaseSearch(query: string, purchase: SearchablePurchase): boolean {
    return matchesSearch(query,
        purchase.po_number, purchase.notes,
        purchase.supplier?.name, purchase.supplier?.business_name, purchase.supplier?.rfc,
        purchase.items?.map(item => [item.description, item.notes])
    );
}
