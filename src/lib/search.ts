/** Accent-insensitive, multi-word search across the visible business fields. */
export function matchesSearch(query: string, ...values: unknown[]): boolean {
    const normalize = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const haystack = values.flat(Infinity).map(normalize).join(' ');
    return normalize(query).trim().split(/\s+/).every(word => haystack.includes(word));
}

/** Formatos con los que alguien teclea un monto: 1234.5, 1234.50, 1,234.50, $1,234.50 */
export function amountSearchTerms(value: number | string | null | undefined): string[] {
    if (value === null || value === undefined || value === '') return [];
    const n = Number(value);
    if (!isFinite(n)) return [];
    const grouped = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return [String(n), n.toFixed(2), grouped, `$${grouped}`];
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Las columnas DATE llegan como "YYYY-MM-DD"; new Date() las toma como UTC y
 * en México se muestran un día antes. Se parsean como fecha local.
 */
export function parseLocalDate(value: string): Date {
    if (DATE_ONLY.test(value)) {
        const [y, m, d] = value.split('-').map(Number);
        return new Date(y, m - 1, d);
    }
    return new Date(value);
}

/** Formatos con los que alguien teclea una fecha: 2026-10-01, 01/10/2026, 1/10/2026, 01 oct 2026, octubre */
export function dateSearchTerms(value: string | null | undefined): string[] {
    if (!value) return [];
    const d = parseLocalDate(value);
    if (isNaN(d.getTime())) return [value];
    const day = d.getDate(), month = d.getMonth() + 1, year = d.getFullYear();
    const dd = String(day).padStart(2, '0'), mm = String(month).padStart(2, '0');
    return [
        `${year}-${mm}-${dd}`,
        `${dd}/${mm}/${year}`,
        `${day}/${month}/${year}`,
        d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }),
        d.toLocaleDateString('es-MX', { month: 'long' }),
    ];
}

export function partyLabel(party?: { name?: string | null; business_name?: string | null } | null): string {
    return [party?.name, party?.business_name].filter(Boolean).join(' · ');
}
