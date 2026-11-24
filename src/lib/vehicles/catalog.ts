// ===========================================================================
// Catálogos y cálculos del expediente de vehículos (sin dependencias de
// servidor: los usa la pantalla y las acciones).
// ===========================================================================

export const DOCUMENT_TYPES = [
    { code: 'seguro', label: 'Seguro / póliza' },
    { code: 'tarjeta_circulacion', label: 'Tarjeta de circulación' },
    { code: 'verificacion', label: 'Verificación' },
    { code: 'tenencia', label: 'Tenencia / refrendo' },
    { code: 'factura', label: 'Factura del vehículo' },
    { code: 'permiso', label: 'Permiso' },
    { code: 'otro', label: 'Otro' },
] as const;
export type DocumentTypeCode = (typeof DOCUMENT_TYPES)[number]['code'];

export const SERVICE_ITEMS = [
    { code: 'aceite', label: 'Cambio de aceite' },
    { code: 'filtro_aceite', label: 'Filtro de aceite' },
    { code: 'filtro_aire', label: 'Filtro de aire' },
    { code: 'filtro_gasolina', label: 'Filtro de gasolina / diésel' },
    { code: 'filtro_cabina', label: 'Filtro de cabina (A/C)' },
    { code: 'bujias', label: 'Bujías' },
    { code: 'afinacion', label: 'Afinación' },
    { code: 'frenos', label: 'Frenos' },
    { code: 'llantas', label: 'Llantas' },
    { code: 'alineacion', label: 'Alineación y balanceo' },
    { code: 'bateria', label: 'Batería' },
    { code: 'anticongelante', label: 'Anticongelante' },
    { code: 'transmision', label: 'Aceite de transmisión' },
    { code: 'otro', label: 'Otro' },
] as const;
export type ServiceItemCode = (typeof SERVICE_ITEMS)[number]['code'];

/** Piezas cuyo "último cambio" se muestra en la ficha del vehículo. */
export const TRACKED_SERVICE_ITEMS: ServiceItemCode[] = ['aceite', 'filtro_aceite', 'filtro_aire', 'filtro_gasolina', 'filtro_cabina', 'frenos', 'llantas', 'bateria'];

export const EXPENSE_CATEGORIES = [
    { code: 'combustible', label: 'Combustible' },
    { code: 'casetas', label: 'Casetas' },
    { code: 'estacionamiento', label: 'Estacionamiento' },
    { code: 'lavado', label: 'Lavado' },
    { code: 'reparacion', label: 'Reparación' },
    { code: 'refacciones', label: 'Refacciones' },
    { code: 'llantas', label: 'Llantas' },
    { code: 'multa', label: 'Multa' },
    { code: 'tenencia', label: 'Tenencia' },
    { code: 'verificacion', label: 'Verificación' },
    { code: 'seguro', label: 'Seguro' },
    { code: 'otro', label: 'Otro' },
] as const;
export type ExpenseCategoryCode = (typeof EXPENSE_CATEGORIES)[number]['code'];

export const FUEL_TYPES = ['Gasolina', 'Diésel', 'Gas LP', 'Híbrido', 'Eléctrico'];

export function labelOf(list: readonly { code: string; label: string }[], code: string): string {
    return list.find((item) => item.code === code)?.label || code;
}

// ---------------------------------------------------------------------------
// Cálculos
// ---------------------------------------------------------------------------
export type VehicleServiceRow = {
    id: string; service_date: string; odometer_km: number | null; items: string[]; cost: number;
    next_service_date: string | null; next_service_km: number | null;
};
export type VehicleDocumentRow = { id: string; doc_type: string; expires_at: string | null; provider: string | null; document_number: string | null };
export type VehicleExpenseRow = { expense_date: string; amount: number; category: string };

const DAY = 24 * 60 * 60 * 1000;

export function todayLocal(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function parseDate(value: string): Date {
    const [y, m, d] = value.slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d);
}

export function daysUntil(date: string, today = todayLocal()): number {
    return Math.round((parseDate(date).getTime() - parseDate(today).getTime()) / DAY);
}

function addMonths(date: string, months: number): string {
    const d = parseDate(date);
    d.setMonth(d.getMonth() + months);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export type LastService = { code: string; date: string; odometer: number | null };

export function lastServices(services: VehicleServiceRow[]): Record<string, LastService> {
    const sorted = [...services].sort((a, b) => b.service_date.localeCompare(a.service_date));
    const out: Record<string, LastService> = {};
    for (const service of sorted) {
        for (const code of service.items) {
            if (!out[code]) out[code] = { code, date: service.service_date, odometer: service.odometer_km };
        }
    }
    return out;
}

export type OilStatus = {
    last: LastService | null;
    nextDate: string | null;
    nextKm: number | null;
    state: 'sin_registro' | 'al_corriente' | 'proximo' | 'vencido';
};

export function oilStatus(
    services: VehicleServiceRow[],
    vehicle: { odometer_km: number | null; oil_interval_km: number; oil_interval_months: number },
    today = todayLocal(),
): OilStatus {
    const latest = [...services].filter((s) => s.items.includes('aceite'))
        .sort((a, b) => b.service_date.localeCompare(a.service_date))[0];
    if (!latest) return { last: null, nextDate: null, nextKm: null, state: 'sin_registro' };
    const nextDate = latest.next_service_date || addMonths(latest.service_date, vehicle.oil_interval_months);
    const nextKm = latest.next_service_km ?? (latest.odometer_km !== null ? latest.odometer_km + vehicle.oil_interval_km : null);
    const days = daysUntil(nextDate, today);
    const kmLeft = nextKm !== null && vehicle.odometer_km !== null ? nextKm - vehicle.odometer_km : null;
    const state = days < 0 || (kmLeft !== null && kmLeft <= 0) ? 'vencido'
        : days <= 15 || (kmLeft !== null && kmLeft <= 500) ? 'proximo' : 'al_corriente';
    return { last: { code: 'aceite', date: latest.service_date, odometer: latest.odometer_km }, nextDate, nextKm, state };
}

export type DocumentAlert = { id: string; docType: string; expiresAt: string; days: number; state: 'vencido' | 'proximo' };

/** Documentos vencidos o por vencer (30 días), sólo el más reciente de cada tipo. */
export function documentAlerts(documents: VehicleDocumentRow[], today = todayLocal()): DocumentAlert[] {
    const latestByType = new Map<string, VehicleDocumentRow>();
    for (const doc of documents) {
        if (!doc.expires_at) continue;
        const current = latestByType.get(doc.doc_type);
        if (!current || (current.expires_at || '') < doc.expires_at) latestByType.set(doc.doc_type, doc);
    }
    return Array.from(latestByType.values()).map((doc) => ({ doc, days: daysUntil(doc.expires_at!, today) }))
        .filter(({ days }) => days <= 30)
        .map(({ doc, days }): DocumentAlert => ({ id: doc.id, docType: doc.doc_type, expiresAt: doc.expires_at!, days, state: days < 0 ? 'vencido' : 'proximo' }))
        .sort((a, b) => a.days - b.days);
}

export type SpendSummary = { month: number; year: number; total: number; byCategory: Record<string, number> };

export function spendSummary(services: VehicleServiceRow[], expenses: VehicleExpenseRow[], documents: { issued_at?: string | null; cost?: number | null; doc_type: string }[], today = todayLocal()): SpendSummary {
    const month = today.slice(0, 7);
    const year = today.slice(0, 4);
    const out: SpendSummary = { month: 0, year: 0, total: 0, byCategory: {} };
    const add = (date: string | null | undefined, amount: number, category: string) => {
        if (!amount) return;
        out.total += amount;
        out.byCategory[category] = (out.byCategory[category] || 0) + amount;
        if (date?.startsWith(year)) out.year += amount;
        if (date?.startsWith(month)) out.month += amount;
    };
    services.forEach((s) => add(s.service_date, Number(s.cost) || 0, 'mantenimiento'));
    expenses.forEach((e) => add(e.expense_date, Number(e.amount) || 0, e.category));
    documents.forEach((d) => add(d.issued_at, Number(d.cost) || 0, d.doc_type === 'seguro' ? 'seguro' : d.doc_type));
    out.total = Math.round(out.total * 100) / 100;
    out.year = Math.round(out.year * 100) / 100;
    out.month = Math.round(out.month * 100) / 100;
    return out;
}
