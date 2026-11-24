'use server';

import { supabase } from '@/lib/supabase';
import { getSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { revalidatePath } from 'next/cache';
import { getServerSupabase } from '@/lib/supabaseServer';

export async function addQuotationExtraAction(input: { quotationId: string; description: string; quantity: number; unitPrice: number; note: string }) {
    const session = await getSession();
    if (!session || !can(session.role, session.permissions, 'sales', 'edit')) throw new Error('Sin permiso para editar cotizaciones.');
    if (!input.description.trim() || !Number.isFinite(input.quantity) || input.quantity < 0.01 || !Number.isFinite(input.unitPrice) || input.unitPrice < 0) throw new Error('Revisa descripción, cantidad y precio.');
    const { error } = await supabase.rpc('add_quotation_extra', { p_quotation_id: input.quotationId, p_description: input.description, p_quantity: input.quantity, p_unit_price: input.unitPrice, p_note: input.note });
    if (error) throw new Error(error.message);
    revalidatePath('/sales');
    revalidatePath('/finance/receivable', 'layout');
}

export type SaleOrigin = 'fabricacion' | 'venta_directa' | 'trabajo_previo';

/**
 * Envía una cotización a cuentas por cobrar. No requiere OT: también sirve
 * para material que sólo se compró y entregó, y para trabajos ya hechos que se
 * registran después (con su fecha de venta; el vencimiento corre desde ahí).
 */
export async function quotationToReceivableAction(quotationId: string, options: { origin: SaleOrigin; invoiceDate?: string | null; notes?: string | null } = { origin: 'fabricacion' }) {
    const session = await getSession();
    if (!session || !can(session.role, session.permissions, 'finance', 'create', 'receivable') || !can(session.role, session.permissions, 'sales', 'view')) throw new Error('Sin permiso para enviar a cuentas por cobrar.');
    if (options.invoiceDate && !/^\d{4}-\d{2}-\d{2}$/.test(options.invoiceDate)) throw new Error('Fecha de venta inválida.');
    const database = getServerSupabase();
    const { data, error } = await database.rpc('quotation_to_receivable', {
        p_quotation_id: quotationId, p_employee_id: session.employeeId,
        p_invoice_date: options.invoiceDate || null, p_origin: options.origin, p_notes: options.notes?.trim() || null,
    });
    if (error) throw new Error(error.message);
    const { data: invoice, error: readError } = await database.from('ar_invoices').select('client_id').eq('id', data).single();
    if (readError) throw new Error(readError.message);
    revalidatePath('/finance/receivable', 'layout');
    revalidatePath('/sales');
    return { id: data as string, clientId: invoice.client_id as number };
}
