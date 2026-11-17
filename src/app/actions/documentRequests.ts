'use server';

/**
 * ===========================================================================
 * documentRequests.ts — Server actions para el workflow de requisiciones
 * de documentos (nuevo o cambio).
 *
 * Flujo:
 *   1) Cualquier empleado con permiso 'documents:create' crea una requisición.
 *      status = 'pending_doc_control'
 *   2) Controlador de documentos la revisa:
 *      - Aprueba → 'pending_top_mgmt'
 *      - Rechaza (con notas) → 'rejected_by_doc_control' (el solicitante
 *        puede modificar y reenviar)
 *   3) Alta dirección revisa:
 *      - Aprueba y firma → 'approved' (luego se publica → 'published')
 *      - Rechaza (con notas) → 'rejected'
 *   4) Cuando se publica:
 *      - type='new' → crea un documento nuevo con el payload
 *      - type='change' → conserva ID y código; guarda la revisión anterior
 *        y publica la nueva revisión con la firma real de Alta Dirección.
 *
 * Evidencias: cada cambio de estado se registra en `change_log` con
 * metadata del reviewer, notas y timestamp.
 * ===========================================================================
 */

import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { getServerSupabase } from '@/lib/supabaseServer';
import { storeControlledSignature, removeUncommittedControlledSignature } from '@/lib/documents/approvalStorage';

// -----------------------------------------------------------------------------
// Tipos
// -----------------------------------------------------------------------------
export type DocumentRequestType = 'new' | 'change';
export type DocumentRequestStatus =
    | 'pending_doc_control'
    | 'rejected_by_doc_control'
    | 'pending_top_mgmt'
    | 'rejected'
    | 'approved'
    | 'published'
    | 'cancelled';

export type DocumentPayload = {
    type_id?: string;
    title: string;
    keywords?: string;
    objective?: string;
    scope?: string;
    definitions?: string;
    responsibilities?: string;
    content: string;
    document_references?: string;
    records?: string;
    effective_date?: string | null;
    next_review_date?: string | null;
    version?: string;
    /** Revisión leída al preparar la solicitud; el servidor la establece. */
    base_revision?: number;
};

export type CreateRequestInput = {
    type: DocumentRequestType;
    target_document_id?: string | null;
    title: string;
    change_summary?: string;
    reason: string;
    payload: DocumentPayload;
};

export type ReviewAction = {
    requestId: string;
    decision: 'approve' | 'reject';
    notes?: string;
    signatureDataUrl?: string;
};

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
async function requireSession() {
    const s = await getSession();
    if (!s) throw new Error('No autenticado.');
    return s;
}

async function prepareRequestPayload(input: CreateRequestInput): Promise<DocumentPayload> {
    if (!['new', 'change'].includes(input.type)) throw new Error('Tipo de requisición no válido.');
    if (!input.payload.title?.trim() || !input.payload.content?.trim()) throw new Error('El documento requiere título y contenido.');
    if (input.payload.version && !/^\d+\.\d+$/.test(input.payload.version)) throw new Error('La versión debe tener formato 1.0.');
    const payload = { ...input.payload };
    delete payload.base_revision;
    if (input.type === 'change') {
        const { data, error } = await getServerSupabase().from('documents').select('revision, status').eq('id', input.target_document_id).single();
        if (error || !data) throw new Error('Documento objetivo no encontrado.');
        if (['obsolete', 'pending_obsolete'].includes(data.status)) throw new Error('No se puede cambiar un documento obsoleto.');
        if (input.payload.base_revision !== undefined && input.payload.base_revision !== data.revision) {
            throw new Error('El documento cambió mientras preparabas la solicitud. Actualiza la página y revisa la versión vigente.');
        }
        payload.base_revision = data.revision;
    }
    return payload;
}

async function logChange(
    entityId: string,
    action: string,
    description: string,
    changedBy: string,
    metadata: Record<string, unknown> = {}
) {
    await getServerSupabase().from('change_log').insert({
        entity_type: 'document_request',
        entity_id: entityId,
        action,
        description,
        changed_by: changedBy,
        source: 'ui',
        metadata,
    });
}

// -----------------------------------------------------------------------------
// Acciones
// -----------------------------------------------------------------------------

/**
 * Cualquier empleado con permiso 'documents:create' puede crear una
 * requisición. También se permite a master y document_controller/top_management.
 */
export async function createDocumentRequestAction(input: CreateRequestInput) {
    const s = await requireSession();
    const role = s.role;
    const canCreate =
        role === 'master' ||
        role === 'document_controller' ||
        role === 'top_management' ||
        can(s.role, s.permissions, 'documents', 'create');
    if (!canCreate) {
        throw new Error('No tienes permisos para crear requisiciones de documentos.');
    }
    if (!input.title?.trim()) throw new Error('El título es obligatorio.');
    if (!input.reason?.trim()) throw new Error('La justificación es obligatoria.');
    if (!input.payload?.content?.trim()) throw new Error('El contenido del documento es obligatorio.');
    if (input.type === 'change' && !input.target_document_id) {
        throw new Error('Para cambio de documento, debes indicar el documento objetivo.');
    }
    if (input.type === 'new' && input.target_document_id) {
        throw new Error('Para documento nuevo, no debe haber documento objetivo.');
    }
    const payload = await prepareRequestPayload(input);

    const { data, error } = await getServerSupabase()
        .from('document_requests')
        .insert({
            type: input.type,
            target_document_id: input.target_document_id ?? null,
            title: input.title,
            change_summary: input.change_summary ?? null,
            reason: input.reason,
            payload,
            status: 'pending_doc_control',
            requested_by: s.employeeId,
        })
        .select()
        .single();
    if (error) throw new Error('Error al crear requisición: ' + error.message);

    await logChange(data.id, 'created', `Requisición creada por ${s.fullName ?? s.username}`, s.employeeId ?? s.username, {
        type: input.type,
        target_document_id: input.target_document_id ?? null,
    });

    revalidatePath('/documents/requests');
    return { id: data.id };
}

/**
 * El solicitante original puede modificar la requisición cuando está
 * en 'rejected_by_doc_control' o 'rejected' y reenviarla al controlador.
 */
export async function resubmitDocumentRequestAction(
    requestId: string,
    updates: Partial<CreateRequestInput>
) {
    const s = await requireSession();
    if (!requestId) throw new Error('Falta el ID de la requisición.');

    // Verificar que la requisición existe y es del solicitante
    const { data: req, error: rErr } = await getServerSupabase()
        .from('document_requests')
        .select('*')
        .eq('id', requestId)
        .single();
    if (rErr || !req) throw new Error('Requisición no encontrada.');
    if (req.requested_by !== s.employeeId && s.role !== 'master') {
        throw new Error('Solo el solicitante original puede modificar la requisición.');
    }
    if (!['rejected_by_doc_control', 'rejected'].includes(req.status)) {
        throw new Error('Solo puedes modificar requisiciones que fueron rechazadas.');
    }
    const payload = await prepareRequestPayload({
        type: req.type, target_document_id: req.target_document_id,
        title: updates.title ?? req.title, reason: updates.reason ?? req.reason,
        payload: updates.payload ?? req.payload,
    });

    const { error } = await getServerSupabase()
        .from('document_requests')
        .update({
            title: updates.title ?? req.title,
            change_summary: updates.change_summary ?? req.change_summary,
            reason: updates.reason ?? req.reason,
            payload,
            status: 'pending_doc_control',
            doc_control_notes: null,
            top_mgmt_notes: null,
            top_mgmt_approver: null,
            top_mgmt_approved_at: null,
            top_mgmt_signature_url: null,
            top_mgmt_approver_name: null,
            top_mgmt_approver_role: null,
            revision_count: (req.revision_count ?? 0) + 1,
        })
        .eq('id', requestId);
    if (error) throw new Error('Error al reenviar: ' + error.message);

    await logChange(requestId, 'resubmitted', `Requisición modificada y reenviada por ${s.fullName ?? s.username}`, s.employeeId ?? s.username, {
        revision: (req.revision_count ?? 0) + 1,
    });

    revalidatePath('/documents/requests');
    revalidatePath(`/documents/requests/${requestId}`);
}

/**
 * El controlador de documentos (rol document_controller) revisa la
 * requisición: la aprueba o la rechaza con notas.
 */
export async function reviewByDocumentControllerAction(input: ReviewAction) {
    const s = await requireSession();
    if (s.role !== 'master' && s.role !== 'document_controller') {
        throw new Error('Solo el Controlador de Documentos puede revisar requisiciones.');
    }

    const { data: req, error: rErr } = await getServerSupabase()
        .from('document_requests')
        .select('*')
        .eq('id', input.requestId)
        .single();
    if (rErr || !req) throw new Error('Requisición no encontrada.');
    if (req.status !== 'pending_doc_control') {
        throw new Error(`La requisición está en estado "${req.status}" y no puede ser revisada por el controlador.`);
    }
    if (input.decision === 'reject' && !input.notes?.trim()) {
        throw new Error('Para rechazar, debes indicar las notas con lo que el solicitante debe corregir.');
    }

    const newStatus: DocumentRequestStatus = input.decision === 'approve' ? 'pending_top_mgmt' : 'rejected_by_doc_control';

    const { error } = await getServerSupabase()
        .from('document_requests')
        .update({
            status: newStatus,
            doc_control_reviewer: s.employeeId,
            doc_control_reviewed_at: new Date().toISOString(),
            doc_control_notes: input.notes ?? null,
        })
        .eq('id', input.requestId);
    if (error) throw new Error('Error al guardar la revisión: ' + error.message);

    await logChange(input.requestId, 'doc_control_' + input.decision, `Controlador de documentos ${input.decision === 'approve' ? 'APROBÓ' : 'RECHAZÓ'} la requisición`, s.employeeId ?? s.username, {
        notes: input.notes,
    });

    revalidatePath('/documents/requests');
    revalidatePath(`/documents/requests/${input.requestId}`);
}

/**
 * La Alta Dirección (top_management) aprueba o rechaza. Si aprueba,
 * la requisición queda en 'approved' lista para publicar.
 */
export async function approveByTopManagementAction(input: ReviewAction) {
    const s = await requireSession();
    if (s.role !== 'master' && s.role !== 'top_management') {
        throw new Error('Solo Alta Dirección puede aprobar estas requisiciones.');
    }

    const { data: req, error: rErr } = await getServerSupabase()
        .from('document_requests')
        .select('*')
        .eq('id', input.requestId)
        .single();
    if (rErr || !req) throw new Error('Requisición no encontrada.');
    const needsLegacySignature = req.status === 'approved' && !req.top_mgmt_signature_url;
    if (req.status !== 'pending_top_mgmt' && !(needsLegacySignature && input.decision === 'approve')) {
        throw new Error(`La requisición está en estado "${req.status}" y no puede ser aprobada por Alta Dirección.`);
    }
    if (input.decision === 'reject' && !input.notes?.trim()) {
        throw new Error('Para rechazar, debes indicar las notas.');
    }
    if (input.decision === 'approve' && (!input.signatureDataUrl || !s.employeeId)) throw new Error('Dibuja tu firma para aprobar la requisición.');
    const signatureUri = input.decision === 'approve' ? await storeControlledSignature(input.signatureDataUrl!, s.employeeId) : null;

    const newStatus: DocumentRequestStatus = input.decision === 'approve' ? 'approved' : 'rejected';

    const { error } = await getServerSupabase()
        .from('document_requests')
        .update({
            status: newStatus,
            top_mgmt_approver: s.employeeId,
            top_mgmt_approved_at: new Date().toISOString(),
            top_mgmt_notes: input.notes ?? null,
            top_mgmt_signature_url: signatureUri,
            top_mgmt_approver_name: input.decision === 'approve' ? s.fullName || s.username : null,
            top_mgmt_approver_role: input.decision === 'approve' ? s.position || 'Alta Dirección' : null,
        })
        .eq('id', input.requestId)
        .eq('status', req.status)
        .select('id')
        .single();
    if (error) {
        if (signatureUri) await removeUncommittedControlledSignature(signatureUri);
        throw new Error('Error al guardar la aprobación: ' + error.message);
    }

    await logChange(input.requestId, 'top_mgmt_' + input.decision, `Alta Dirección ${input.decision === 'approve' ? 'APROBÓ' : 'RECHAZÓ'} la requisición`, s.employeeId ?? s.username, {
        notes: input.notes,
    });

    revalidatePath('/documents/requests');
    revalidatePath(`/documents/requests/${input.requestId}`);
}

/**
 * Publica una requisición aprobada con firma real de Alta Dirección:
 * - type='new' → crea un documento nuevo con el payload.
 * - type='change' → conserva ID/código y archiva la revisión anterior.
 */
export async function publishDocumentRequestAction(requestId: string) {
    const s = await requireSession();
    if (s.role !== 'master' && s.role !== 'top_management') {
        throw new Error('Solo Alta Dirección puede publicar.');
    }
    if (!requestId) throw new Error('Falta el ID.');

    const { data, error } = await getServerSupabase().rpc('publish_document_request_atomic', {
        p_request_id: requestId, p_actor_id: s.employeeId, p_actor_name: s.fullName || s.username,
    });
    if (error) throw new Error('No se pudo publicar la requisición: ' + error.message);
    const resultingDocId = data?.document_id as string | undefined;
    if (!resultingDocId) throw new Error('La publicación no devolvió un documento.');

    revalidatePath('/documents/requests');
    revalidatePath('/documents');
    revalidatePath(`/documents/requests/${requestId}`);
    if (resultingDocId) revalidatePath(`/documents/${resultingDocId}`);
    return { document_id: resultingDocId };
}

/**
 * El solicitante puede cancelar su requisición si aún no ha sido aprobada
 * por Alta Dirección.
 */
export async function cancelDocumentRequestAction(requestId: string) {
    const s = await requireSession();
    if (!requestId) throw new Error('Falta el ID.');

    const { data: req, error: rErr } = await getServerSupabase()
        .from('document_requests')
        .select('*')
        .eq('id', requestId)
        .single();
    if (rErr || !req) throw new Error('Requisición no encontrada.');
    if (req.requested_by !== s.employeeId && s.role !== 'master') {
        throw new Error('Solo el solicitante puede cancelar su requisición.');
    }
    if (['published', 'cancelled'].includes(req.status)) {
        throw new Error(`La requisición está en estado "${req.status}" y no se puede cancelar.`);
    }

    const { error } = await getServerSupabase()
        .from('document_requests')
        .update({ status: 'cancelled' })
        .eq('id', requestId);
    if (error) throw new Error('Error al cancelar: ' + error.message);

    await logChange(requestId, 'cancelled', `Requisición cancelada por ${s.fullName ?? s.username}`, s.employeeId ?? s.username);

    revalidatePath('/documents/requests');
    revalidatePath(`/documents/requests/${requestId}`);
}
