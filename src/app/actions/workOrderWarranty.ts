'use server';

import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { getServerSupabase } from '@/lib/supabaseServer';

async function authorizedWorkOrder(workOrderId: string, edit: boolean) {
    const session = await getSession();
    if (!session) throw new Error('No autenticado.');
    const database = getServerSupabase();
    const { data: order, error } = await database.from('work_orders')
        .select('id,module:manufacturing_modules(code)').eq('id', workOrderId).single();
    if (error || !order) throw new Error('No se encontró la OT.');
    const moduleRow = Array.isArray(order.module) ? order.module[0] : order.module;
    const code = moduleRow?.code;
    const action = edit ? 'edit' : 'view';
    if (!code || (!can(session.role, session.permissions, 'manufacturing', action, code)
        && !can(session.role, session.permissions, 'quality', action))) {
        throw new Error(edit ? 'Sin permiso para reabrir esta OT por garantía.' : 'Sin permiso para ver esta OT.');
    }
    return { session, database, code };
}

export async function reopenWorkOrderWarrantyAction(workOrderId: string, reason: string) {
    const { session, database, code } = await authorizedWorkOrder(workOrderId, true);
    const trimmedReason = reason.trim();
    if (!trimmedReason || trimmedReason.length > 2000) throw new Error('Escribe el motivo de la garantía (máximo 2000 caracteres).');
    const { error } = await database.rpc('reopen_work_order_warranty', {
        p_work_order_id: workOrderId,
        p_employee_id: session.employeeId,
        p_reason: trimmedReason,
    });
    if (error) throw new Error(error.message);
    revalidatePath(`/manufacturing/${code}/${workOrderId}`);
    revalidatePath(`/manufacturing/${code}`);
    revalidatePath('/quality');
    revalidatePath('/deliveries');
}

export async function getWorkOrderWarrantyHistoryAction(workOrderId: string) {
    const { database } = await authorizedWorkOrder(workOrderId, false);
    const { data, error } = await database.from('work_order_warranty_events')
        .select('id,reason,reopened_by_name,reopened_at,previous_state')
        .eq('work_order_id', workOrderId).order('reopened_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []).map(event => ({
        id: event.id as string,
        reason: event.reason as string,
        reopenedBy: event.reopened_by_name as string,
        reopenedAt: event.reopened_at as string,
        previousReleasedAt: event.previous_state.qc_released_at as string | null,
        previousReleasedBy: event.previous_state.qc_released_by as string | null,
        previousOperatorSignature: event.previous_state.operator_signature_url as string | null,
    }));
}
