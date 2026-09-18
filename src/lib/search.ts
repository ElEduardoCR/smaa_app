/** Accent-insensitive, multi-word search across the visible business fields. */
export function matchesSearch(query: string, ...values: unknown[]): boolean {
    const normalize = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const haystack = values.flat(Infinity).map(normalize).join(' ');
    return normalize(query).trim().split(/\s+/).every(word => haystack.includes(word));
}

export function partyLabel(party?: { name?: string | null; business_name?: string | null } | null): string {
    return [party?.name, party?.business_name].filter(Boolean).join(' · ');
}
