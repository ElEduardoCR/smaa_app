'use server';

import { revalidatePath } from 'next/cache';
import { getSession, type Session } from '@/lib/session';
import { can, canCreateAnywhereInModule, type Action } from '@/lib/permissions';
import { getServerSupabase } from '@/lib/supabaseServer';

// ===========================================================================
// Fabricación unificada: OT con etapas, cierres parciales, Calidad por lotes,
// entregas parciales, garantías/reparaciones y edición con bitácora.
//
// Todas las escrituras pasan por funciones de la base (service_role) que
// reciben el empleado: la bitácora (audit_log) guarda quién hizo cada cosa.
// Los permisos de Fabricación siguen siendo por proceso (maquinado,
// soldadura, automatización) y se aplican a la etapa correspondiente.
// ===========================================================================

async function requireSession(): Promise<Session> {
    const session = await getSession();
    if (!session) throw new Error('No autenticado.');
    return session;
}

function canProcess(session: Session, action: Action, code: string) {
    return can(session.role, session.permissions, 'manufacturing', action, code);
}

function revalidateOrder(id?: string) {
    revalidatePath('/manufacturing');
    if (id) revalidatePath(`/manufacturing/ot/${id}`);
    revalidatePath('/quality');
    revalidatePath('/deliveries');
}

async function stageContext(stageId: string) {
    const { data, error } = await getServerSupabase().from('work_order_stages')
        .select('id, work_order_id, module:manufacturing_modules(code, name)').eq('id', stageId).single();
    if (error || !data) throw new Error('No se encontró la etapa.');
    const moduleRow = Array.isArray(data.module) ? data.module[0] : data.module;
    return { workOrderId: data.work_order_id as string, code: moduleRow?.code as string, name: moduleRow?.name as string };
}

/** Procesos (códigos de módulo) de las etapas de una OT. */
async function orderProcesses(workOrderId: string): Promise<string[]> {
    const { data, error } = await getServerSupabase().from('work_order_stages')
        .select('module:manufacturing_modules(code)').eq('work_order_id', workOrderId);
    if (error) throw new Error(error.message);
    return (data || []).map((row) => {
        const moduleRow = Array.isArray(row.module) ? row.module[0] : row.module;
        return moduleRow?.code as string;
    }).filter(Boolean);
}

async function requireOrderPermission(workOrderId: string, action: Action, message: string) {
    const session = await requireSession();
    const processes = await orderProcesses(workOrderId);
    if (session.role !== 'master' && !processes.some((code) => canProcess(session, action, code))) throw new Error(message);
    return session;
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await getServerSupabase().rpc(name, args);
    if (error) throw new Error(error.message);
    return data as T;
}

// ---------------------------------------------------------------------------
// Alta
// ---------------------------------------------------------------------------
export type NewWorkOrderInput = {
    stageModuleIds: string[];
    quotationId: string | null;
    clientName: string | null;
    clientRfc: string | null;
    workTitle: string;
    priority: string;
    quantity: number;
    unit: string;
    notes: string | null;
    wpsIds: string[];
};

export async function createWorkOrderAction(input: NewWorkOrderInput) {
    const session = await requireSession();
    if (!canCreateAnywhereInModule(session.role, session.permissions, 'manufacturing')) throw new Error('Sin permiso para crear OT.');
    if (!input.stageModuleIds.length) throw new Error('Selecciona al menos una etapa.');
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) throw new Error('La cantidad de piezas debe ser mayor a cero.');
    const { data: modules, error } = await getServerSupabase().from('manufacturing_modules').select('id, code').in('id', input.stageModuleIds);
    if (error) throw new Error(error.message);
    if (session.role !== 'master' && !(modules || []).some((m) => canProcess(session, 'create', m.code))) {
        throw new Error('Sin permiso para crear OT con estas etapas.');
    }
    const id = await rpc<string>('create_work_order_v2', {
        p_order: {
            quotation_id: input.quotationId, client_name: input.clientName, client_rfc: input.clientRfc,
            work_title: input.workTitle, priority: input.priority, quantity: input.quantity, unit: input.unit, notes: input.notes,
        },
        p_stage_module_ids: input.stageModuleIds,
        p_wps_ids: input.wpsIds,
        p_actor_id: session.employeeId,
    });
    revalidateOrder();
    return { id };
}

// ---------------------------------------------------------------------------
// Etapas: iniciar, pausar, reanudar, cerrar piezas
// ---------------------------------------------------------------------------
async function requireStagePermission(stageId: string, action: Action, verb: string) {
    const session = await requireSession();
    const stage = await stageContext(stageId);
    if (!canProcess(session, action, stage.code)) throw new Error(`Sin permiso para ${verb} la etapa de ${stage.name}.`);
    return { session, stage };
}

export async function startStageAction(stageId: string) {
    const { session, stage } = await requireStagePermission(stageId, 'start', 'iniciar');
    await rpc('start_work_order_stage', { p_stage_id: stageId, p_actor_id: session.employeeId });
    revalidateOrder(stage.workOrderId);
}

export async function pauseStageAction(stageId: string, reason: string, customReason: string, notes: string) {
    const { session, stage } = await requireStagePermission(stageId, 'pause', 'pausar');
    await rpc('pause_work_order_stage', {
        p_stage_id: stageId, p_actor_id: session.employeeId, p_reason: reason, p_custom_reason: customReason, p_notes: notes,
    });
    revalidateOrder(stage.workOrderId);
}

export async function resumeStageAction(stageId: string) {
    const { session, stage } = await requireStagePermission(stageId, 'start', 'reanudar');
    await rpc('resume_work_order_stage', { p_stage_id: stageId, p_actor_id: session.employeeId });
    revalidateOrder(stage.workOrderId);
}

export async function closeStageAction(input: { stageId: string; quantity: number; operatorName: string; signatureUrl: string; notes: string }) {
    const { session, stage } = await requireStagePermission(input.stageId, 'complete', 'cerrar piezas en');
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) throw new Error('Indica cuántas piezas cierras.');
    const id = await rpc<string>('close_work_order_stage', {
        p_stage_id: input.stageId, p_quantity: input.quantity, p_actor_id: session.employeeId,
        p_operator_name: input.operatorName, p_signature_url: input.signatureUrl, p_notes: input.notes,
    });
    revalidateOrder(stage.workOrderId);
    return { id };
}

// ---------------------------------------------------------------------------
// Calidad
// ---------------------------------------------------------------------------
export async function decideClosureAction(input: { closureId: string; releasedQty: number; inspectorName: string; signatureUrl: string | null; comments: string }) {
    const session = await requireSession();
    if (!can(session.role, session.permissions, 'quality', 'edit')) throw new Error('Solo Calidad puede liberar o rechazar piezas.');
    const { data: closure, error } = await getServerSupabase().from('work_order_closures').select('work_order_id').eq('id', input.closureId).single();
    if (error || !closure) throw new Error('No se encontró el lote.');
    const status = await rpc<string>('decide_work_order_closure', {
        p_closure_id: input.closureId, p_released_qty: input.releasedQty, p_actor_id: session.employeeId,
        p_inspector_name: input.inspectorName, p_signature_url: input.signatureUrl, p_comments: input.comments,
    });
    revalidateOrder(closure.work_order_id);
    return { status };
}

// ---------------------------------------------------------------------------
// Cancelación y edición
// ---------------------------------------------------------------------------
export async function cancelWorkOrderAction(workOrderId: string, reason: string) {
    const session = await requireOrderPermission(workOrderId, 'delete', 'Sin permiso para cancelar esta OT.');
    await rpc('cancel_work_order_v2', { p_work_order_id: workOrderId, p_actor_id: session.employeeId, p_reason: reason });
    revalidateOrder(workOrderId);
}

export type WorkOrderChanges = {
    work_title?: string;
    priority?: string;
    quantity?: number;
    unit?: string;
    client_name?: string;
    client_rfc?: string;
};

export async function updateWorkOrderAction(input: {
    workOrderId: string;
    changes: WorkOrderChanges;
    stageModuleIds: string[] | null;
    wpsIds: string[] | null;
    reason: string;
}) {
    const session = await requireOrderPermission(input.workOrderId, 'edit', 'Sin permiso para editar esta OT.');
    if (input.stageModuleIds && session.role !== 'master') {
        const { data: modules, error } = await getServerSupabase().from('manufacturing_modules').select('code').in('id', input.stageModuleIds);
        if (error) throw new Error(error.message);
        if (!(modules || []).every((m) => canProcess(session, 'view', m.code) || canProcess(session, 'edit', m.code))) {
            throw new Error('Sin permiso para agregar etapas de un proceso que no tienes asignado.');
        }
    }
    await rpc('update_work_order_details', {
        p_work_order_id: input.workOrderId, p_changes: input.changes, p_stage_module_ids: input.stageModuleIds,
        p_wps_ids: input.wpsIds, p_actor_id: session.employeeId, p_reason: input.reason,
    });
    revalidateOrder(input.workOrderId);
}

// ---------------------------------------------------------------------------
// Entregas parciales
// ---------------------------------------------------------------------------
export async function createDeliveryAction(input: {
    workOrderId: string;
    quantity: number;
    observations: string;
    shippingMethod: string;
    shippingAddress: string;
    shippingCarrier: string;
    trackingNumber: string;
}) {
    const session = await requireSession();
    if (!can(session.role, session.permissions, 'deliveries', 'create')) throw new Error('Sin permiso para crear entregas.');
    const result = await rpc<{ id: string; delivery_number: string }>('create_work_order_delivery', {
        p_work_order_id: input.workOrderId,
        p_quantity: input.quantity,
        p_details: {
            observations: input.observations, shipping_method: input.shippingMethod, shipping_address: input.shippingAddress,
            shipping_carrier: input.shippingCarrier, tracking_number: input.trackingNumber,
        },
        p_actor_id: session.employeeId,
    });
    revalidateOrder(input.workOrderId);
    return result;
}

// ---------------------------------------------------------------------------
// Garantías y reparaciones
// ---------------------------------------------------------------------------
function canHandleWarranty(session: Session) {
    return canCreateAnywhereInModule(session.role, session.permissions, 'manufacturing')
        || can(session.role, session.permissions, 'quality', 'edit');
}

export async function openWarrantyAction(input: {
    parentId: string;
    kind: 'garantia' | 'reparacion';
    reason: string;
    quantity: number;
    stageModuleIds: string[];
    priority: string;
}) {
    const session = await requireSession();
    if (!canHandleWarranty(session)) throw new Error('Sin permiso para abrir garantías o reparaciones.');
    const trimmed = input.reason.trim();
    if (!trimmed || trimmed.length > 2000) throw new Error('Escribe el motivo (máximo 2000 caracteres).');
    const id = await rpc<string>('open_work_order_warranty', {
        p_parent_id: input.parentId, p_kind: input.kind, p_reason: trimmed, p_quantity: input.quantity,
        p_stage_module_ids: input.stageModuleIds.length ? input.stageModuleIds : null, p_wps_ids: null,
        p_priority: input.priority, p_actor_id: session.employeeId,
    });
    revalidateOrder(input.parentId);
    revalidatePath('/manufacturing/garantias');
    return { id };
}

export type WarrantyRecord = {
    id: string;
    kind: 'garantia' | 'reparacion';
    reason: string;
    quantity: number | null;
    openedBy: string;
    openedAt: string;
    parent: { id: string; orderNumber: string; workTitle: string | null };
    child: { id: string; orderNumber: string; status: string } | null;
    /** Registros del flujo anterior: la misma OT reabierta. */
    legacy: { previousReleasedAt: string | null; previousReleasedBy: string | null; previousOperatorSignature: string | null } | null;
};

function canViewManufacturingOrQuality(session: Session) {
    return session.role === 'master'
        || session.permissions.some((p) => p.module_code === 'manufacturing' && p.can_view)
        || can(session.role, session.permissions, 'quality', 'view');
}

export async function listWarrantyRecordsAction(workOrderId?: string): Promise<WarrantyRecord[]> {
    const session = await requireSession();
    if (!canViewManufacturingOrQuality(session)) throw new Error('Sin permiso para ver garantías.');
    let query = getServerSupabase().from('work_order_warranty_events')
        .select('id, kind, reason, quantity, reopened_by_name, reopened_at, previous_state, work_order_id, child_work_order_id')
        .order('reopened_at', { ascending: false }).limit(500);
    if (workOrderId) {
        if (!/^[0-9a-f-]{36}$/i.test(workOrderId)) throw new Error('OT inválida.');
        query = query.or(`work_order_id.eq.${workOrderId},child_work_order_id.eq.${workOrderId}`);
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const ids = Array.from(new Set((data || []).flatMap((e) => [e.work_order_id, e.child_work_order_id]).filter(Boolean)));
    const orders = new Map<string, { id: string; order_number: string; work_title: string | null; status: string }>();
    if (ids.length) {
        const { data: rows, error: ordersError } = await getServerSupabase().from('work_orders')
            .select('id, order_number, work_title, status').in('id', ids);
        if (ordersError) throw new Error(ordersError.message);
        (rows || []).forEach((row) => orders.set(row.id, row));
    }
    return (data || []).map((event) => {
        const parent = orders.get(event.work_order_id);
        const child = event.child_work_order_id ? orders.get(event.child_work_order_id) : null;
        return {
            id: event.id,
            kind: event.kind,
            reason: event.reason,
            quantity: event.quantity === null ? null : Number(event.quantity),
            openedBy: event.reopened_by_name,
            openedAt: event.reopened_at,
            parent: { id: event.work_order_id, orderNumber: parent?.order_number || '—', workTitle: parent?.work_title || null },
            child: child ? { id: child.id, orderNumber: child.order_number, status: child.status } : null,
            legacy: event.child_work_order_id ? null : {
                previousReleasedAt: event.previous_state?.qc_released_at ?? null,
                previousReleasedBy: event.previous_state?.qc_released_by ?? null,
                previousOperatorSignature: event.previous_state?.operator_signature_url ?? null,
            },
        };
    });
}
