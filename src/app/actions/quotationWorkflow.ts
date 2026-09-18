'use server';

import { supabase } from '@/lib/supabase';
import { getSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { revalidatePath } from 'next/cache';

export async function addQuotationExtraAction(input: { quotationId: string; description: string; quantity: number; unitPrice: number; note: string }) {
    const session = await getSession();
    if (!session || !can(session.role, session.permissions, 'sales', 'edit')) throw new Error('Sin permiso para editar cotizaciones.');
    if (!input.description.trim() || !Number.isFinite(input.quantity) || input.quantity < 0.01 || !Number.isFinite(input.unitPrice) || input.unitPrice < 0) throw new Error('Revisa descripción, cantidad y precio.');
    const { error } = await supabase.rpc('add_quotation_extra', { p_quotation_id: input.quotationId, p_description: input.description, p_quantity: input.quantity, p_unit_price: input.unitPrice, p_note: input.note });
    if (error) throw new Error(error.message);
    revalidatePath('/sales');
    revalidatePath('/finance/receivable', 'layout');
}

export async function quotationToReceivableAction(quotationId: string) {
    const session = await getSession();
    if (!session || !can(session.role, session.permissions, 'finance', 'create', 'receivable') || !can(session.role, session.permissions, 'sales', 'view')) throw new Error('Sin permiso para enviar a cuentas por cobrar.');
    const { data, error } = await supabase.rpc('quotation_to_receivable', { p_quotation_id: quotationId, p_employee_id: session.employeeId });
    if (error) throw new Error(error.message);
    const { data: invoice, error: readError } = await supabase.from('ar_invoices').select('client_id').eq('id', data).single();
    if (readError) throw new Error(readError.message);
    revalidatePath('/finance/receivable', 'layout');
    return { id: data as string, clientId: invoice.client_id as number };
}

export async function createWorkOrderAction(order: { module_id: string; quotation_id: string | null; client_name: string | null; client_rfc: string | null; work_title: string; priority: string; notes: string | null }, wpsIds: string[]) {
    const session = await getSession();
    if (!session) throw new Error('No autenticado.');
    const { data: module, error: moduleError } = await supabase.from('manufacturing_modules').select('code').eq('id', order.module_id).single();
    if (moduleError || !module || !can(session.role, session.permissions, 'manufacturing', 'create', module.code)) throw new Error('Sin permiso para crear una OT en este módulo.');
    const { data, error } = await supabase.rpc('create_work_order', { p_order: order, p_wps_ids: wpsIds });
    if (error) throw new Error(error.message);
    revalidatePath('/manufacturing');
    return { id: data as string };
}
