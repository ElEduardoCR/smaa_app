'use server';

import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/session';
import { can, canCreateAnywhereInModule } from '@/lib/permissions';
import { getActorSupabase, getServerSupabase } from '@/lib/supabaseServer';
import { calculatePriceTotals, priceLine } from '@/lib/pricing';
import type { Commissioner } from '@/lib/commissioners';

// ===========================================================================
// Alta y edición de cotizaciones. Todo pasa por save_quotation (una sola
// transacción, partidas actualizadas por id) para que la bitácora muestre
// exactamente qué cambió, quién y cuándo. Cualquier cotización se puede
// editar con el permiso «Editar» de Ventas, aunque ya esté aprobada, en
// fabricación o en cuentas por cobrar (la cuenta sigue al nuevo importe).
// ===========================================================================

export type QuotationItemInput = {
    id?: string | null;
    description: string;
    quantity: number;
    /** Precio al cliente sin IVA. */
    unit_price: number;
    cost_unit_price: number | null;
    margin_pct: number;
    item_type: 'product' | 'service';
    service_concepts: { concept: string; rate: number; hours: number }[] | null;
};

export type QuotationInput = {
    id: string | null;
    client_id: string;
    title: string | null;
    seller: string | null;
    delivery_time: string | null;
    delivery_date: string | null;
    terms_conditions: string | null;
    commissioners: Commissioner[];
    items: QuotationItemInput[];
    reason?: string | null;
};

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export async function saveQuotationAction(input: QuotationInput) {
    const session = await getSession();
    if (!session) throw new Error('No autenticado.');
    const action = input.id ? 'edit' : 'create';
    if (!can(session.role, session.permissions, 'sales', action)) {
        throw new Error(input.id ? 'Sin permiso para editar cotizaciones.' : 'Sin permiso para crear cotizaciones.');
    }
    if (!input.items.length) throw new Error('Agrega al menos una partida.');
    for (const item of input.items) {
        if (!item.description?.trim()) throw new Error('Cada partida necesita descripción.');
        if (!Number.isFinite(item.quantity) || item.quantity <= 0) throw new Error(`Cantidad inválida en "${item.description}".`);
        if (!Number.isFinite(item.unit_price) || item.unit_price < 0) throw new Error(`Precio inválido en "${item.description}".`);
    }
    const totals = calculatePriceTotals(input.items.map((item) => ({ quantity: item.quantity, unit_price: item.unit_price })));
    const items = input.items.map((item) => ({
        id: item.id || null,
        description: item.description.trim(),
        quantity: item.quantity,
        unit_price: item.unit_price,
        line_total: priceLine({ quantity: item.quantity, unit_price: item.unit_price }).subtotal,
        cost_unit_price: item.cost_unit_price,
        cost_line_total: item.cost_unit_price === null ? null : round2(item.quantity * item.cost_unit_price),
        margin_pct: item.margin_pct,
        item_type: item.item_type,
        service_concepts: item.service_concepts,
    }));
    const { data, error } = await getServerSupabase().rpc('save_quotation', {
        p_quotation_id: input.id,
        p_header: {
            client_id: input.client_id, title: input.title, seller: input.seller, delivery_time: input.delivery_time,
            delivery_date: input.delivery_date || null, terms_conditions: input.terms_conditions, commissioners: input.commissioners,
        },
        p_items: items,
        p_totals: totals,
        p_actor_id: session.employeeId,
        p_reason: input.reason?.trim() || null,
    });
    if (error) throw new Error(error.message);
    revalidatePath('/sales');
    revalidatePath('/finance/receivable', 'layout');
    return { id: data as string };
}

const STATUSES = ['Draft', 'Sent', 'Approved', 'Rejected'] as const;

export async function setQuotationStatusAction(id: string, status: (typeof STATUSES)[number]) {
    const session = await getSession();
    if (!session) throw new Error('No autenticado.');
    // Quien crea OT puede confirmar la cotización desde el alta de la OT.
    const allowed = can(session.role, session.permissions, 'sales', 'edit')
        || (status === 'Approved' && canCreateAnywhereInModule(session.role, session.permissions, 'manufacturing'));
    if (!allowed) throw new Error('Sin permiso para cambiar el estado de la cotización.');
    if (!STATUSES.includes(status)) throw new Error('Estado inválido.');
    const { error } = await getActorSupabase(session.employeeId).from('quotations')
        .update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(error.message);
    revalidatePath('/sales');
}

export async function setQuotationClientPoAction(id: string, url: string) {
    const session = await getSession();
    if (!session || !can(session.role, session.permissions, 'sales', 'edit')) throw new Error('Sin permiso para adjuntar la OC del cliente.');
    if (!/^https?:\/\//.test(url)) throw new Error('Archivo inválido.');
    const { error } = await getActorSupabase(session.employeeId).from('quotations')
        .update({ client_po_url: url, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(error.message);
    revalidatePath('/sales');
}

/** Datos para editar una cotización (incluye ids de partidas para conservar el historial). */
export async function getQuotationForEditAction(id: string) {
    const session = await getSession();
    if (!session || !can(session.role, session.permissions, 'sales', 'view')) throw new Error('Sin permiso para ver cotizaciones.');
    const db = getServerSupabase();
    const [{ data: quote, error }, { data: items, error: itemsError }, { data: ar }, { data: orders }] = await Promise.all([
        db.from('quotations').select('*').eq('id', id).single(),
        db.from('quotation_items').select('*').eq('quotation_id', id).order('position', { ascending: true, nullsFirst: false }),
        db.from('ar_invoices').select('id, paid_amount, status, is_active').eq('quotation_id', id).maybeSingle(),
        db.from('work_orders').select('id').eq('quotation_id', id).neq('status', 'Cancelled').limit(1),
    ]);
    if (error || !quote) throw new Error('No se encontró la cotización.');
    if (itemsError) throw new Error(itemsError.message);
    return {
        quote,
        items: items || [],
        canEdit: can(session.role, session.permissions, 'sales', 'edit'),
        receivable: ar ? { paid: Number(ar.paid_amount), active: ar.is_active && ar.status !== 'cancelled' } : null,
        inManufacturing: !!orders?.length,
    };
}
