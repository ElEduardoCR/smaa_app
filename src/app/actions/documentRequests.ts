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
 *      - type='change' → marca el documento objetivo como obsoleto y crea
 *        uno nuevo con los datos actualizados (incrementa revisión)
 *
 * Evidencias: cada cambio de estado se registra en `change_log` con
 * metadata del reviewer, notas y timestamp.
 * ===========================================================================
 */

import { revalidatePath } from 'next/cache';
import { supabase } from '@/lib/supabase';
import { getSession } from '@/lib/session';
import { can } from '@/lib/permissions';

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
};

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
async function requireSession() {
    const s = await getSession();
    if (!s) throw new Error('No autenticado.');
    return s;
}

async function logChange(
    entityId: string,
    action: string,
    description: string,
    changedBy: string,
    metadata: Record<string, any> = {}
) {
    await supabase.from('change_log').insert({
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

    const { data, error } = await supabase
        .from('document_requests')
        .insert({
            type: input.type,
            target_document_id: input.target_document_id ?? null,
            title: input.title,
            change_summary: input.change_summary ?? null,
            reason: input.reason,
            payload: input.payload as any,
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
    const { data: req, error: rErr } = await supabase
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

    const { error } = await supabase
        .from('document_requests')
        .update({
            title: updates.title ?? req.title,
            change_summary: updates.change_summary ?? req.change_summary,
            reason: updates.reason ?? req.reason,
            payload: updates.payload ?? req.payload,
            status: 'pending_doc_control',
            doc_control_notes: null,
            top_mgmt_notes: null,
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

    const { data: req, error: rErr } = await supabase
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

    const { error } = await supabase
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

    const { data: req, error: rErr } = await supabase
        .from('document_requests')
        .select('*')
        .eq('id', input.requestId)
        .single();
    if (rErr || !req) throw new Error('Requisición no encontrada.');
    if (req.status !== 'pending_top_mgmt') {
        throw new Error(`La requisición está en estado "${req.status}" y no puede ser aprobada por Alta Dirección.`);
    }
    if (input.decision === 'reject' && !input.notes?.trim()) {
        throw new Error('Para rechazar, debes indicar las notas.');
    }

    const newStatus: DocumentRequestStatus = input.decision === 'approve' ? 'approved' : 'rejected';

    const { error } = await supabase
        .from('document_requests')
        .update({
            status: newStatus,
            top_mgmt_approver: s.employeeId,
            top_mgmt_approved_at: new Date().toISOString(),
            top_mgmt_notes: input.notes ?? null,
        })
        .eq('id', input.requestId);
    if (error) throw new Error('Error al guardar la aprobación: ' + error.message);

    await logChange(input.requestId, 'top_mgmt_' + input.decision, `Alta Dirección ${input.decision === 'approve' ? 'APROBÓ' : 'RECHAZÓ'} la requisición`, s.employeeId ?? s.username, {
        notes: input.notes,
    });

    revalidatePath('/documents/requests');
    revalidatePath(`/documents/requests/${input.requestId}`);
}

/**
 * Publica una requisición aprobada. Crea el documento real:
 * - type='new' → crea un documento nuevo con el payload.
 * - type='change' → marca el documento objetivo como obsoleto y crea
 *   uno nuevo con la versión incrementada.
 */
export async function publishDocumentRequestAction(requestId: string) {
    const s = await requireSession();
    if (s.role !== 'master' && s.role !== 'top_management') {
        throw new Error('Solo Alta Dirección puede publicar.');
    }
    if (!requestId) throw new Error('Falta el ID.');

    const { data: req, error: rErr } = await supabase
        .from('document_requests')
        .select('*')
        .eq('id', requestId)
        .single();
    if (rErr || !req) throw new Error('Requisición no encontrada.');
    if (req.status !== 'approved') {
        throw new Error(`La requisición está en estado "${req.status}" y no se puede publicar.`);
    }

    const payload = req.payload as DocumentPayload;
    let resultingDocId: string | null = null;
    let obsoletedDocId: string | null = null;

    if (req.type === 'change' && req.target_document_id) {
        // 1) Marcar el documento objetivo como obsoleto
        const { data: oldDoc, error: oErr } = await supabase
            .from('documents')
            .update({
                status: 'obsolete',
                obsoleted_at: new Date().toISOString(),
                obsoleted_reason: `Reemplazado por nueva versión vía requisición ${requestId.slice(0, 8)}`,
            })
            .eq('id', req.target_document_id)
            .select('id, version, revision')
            .single();
        if (oErr) throw new Error('Error al obsoletar el documento anterior: ' + oErr.message);
        obsoletedDocId = oldDoc.id;

        // 2) Calcular nueva versión (incrementar minor: 1.0 → 1.1)
        const newVersion = bumpVersion(oldDoc.version ?? '1.0');

        // 3) Crear el nuevo documento
        const { data: newDoc, error: nErr } = await supabase
            .from('documents')
            .insert({
                type_id: payload.type_id ?? null,
                title: payload.title,
                keywords: payload.keywords ?? null,
                objective: payload.objective ?? null,
                scope: payload.scope ?? null,
                definitions: payload.definitions ?? null,
                responsibilities: payload.responsibilities ?? null,
                content: payload.content,
                document_references: payload.document_references ?? null,
                records: payload.records ?? null,
                effective_date: payload.effective_date ?? new Date().toISOString().slice(0, 10),
                next_review_date: payload.next_review_date ?? null,
                version: payload.version ?? newVersion,
                status: 'approved',
                approval_name: req.top_mgmt_approver ? s.fullName ?? s.username : null,
                approval_role: s.position ?? 'Alta Dirección',
                approval_signed_at: new Date().toISOString(),
                created_by: req.requested_by,
            })
            .select('id, folio, version')
            .single();
        if (nErr) throw new Error('Error al crear el nuevo documento: ' + nErr.message);
        resultingDocId = newDoc.id;
    } else {
        // type='new': crear el documento desde cero
        const { data: newDoc, error: nErr } = await supabase
            .from('documents')
            .insert({
                type_id: payload.type_id ?? null,
                title: payload.title,
                keywords: payload.keywords ?? null,
                objective: payload.objective ?? null,
                scope: payload.scope ?? null,
                definitions: payload.definitions ?? null,
                responsibilities: payload.responsibilities ?? null,
                content: payload.content,
                document_references: payload.document_references ?? null,
                records: payload.records ?? null,
                effective_date: payload.effective_date ?? new Date().toISOString().slice(0, 10),
                next_review_date: payload.next_review_date ?? null,
                version: payload.version ?? '1.0',
                status: 'approved',
                approval_name: s.fullName ?? s.username,
                approval_role: s.position ?? 'Alta Dirección',
                approval_signed_at: new Date().toISOString(),
                created_by: req.requested_by,
            })
            .select('id, folio, version')
            .single();
        if (nErr) throw new Error('Error al crear el documento: ' + nErr.message);
        resultingDocId = newDoc.id;
    }

    // 4) Actualizar la requisición
    const { error: uErr } = await supabase
        .from('document_requests')
        .update({
            status: 'published',
            resulting_document_id: resultingDocId,
            published_at: new Date().toISOString(),
        })
        .eq('id', requestId);
    if (uErr) throw new Error('Error al actualizar la requisición: ' + uErr.message);

    await logChange(requestId, 'published', `Requisición publicada. Documento ${resultingDocId} creado.${obsoletedDocId ? ' Versión anterior obsoletada.' : ''}`, s.employeeId ?? s.username, {
        resulting_document_id: resultingDocId,
        obsoleted_document_id: obsoletedDocId,
    });

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

    const { data: req, error: rErr } = await supabase
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

    const { error } = await supabase
        .from('document_requests')
        .update({ status: 'cancelled' })
        .eq('id', requestId);
    if (error) throw new Error('Error al cancelar: ' + error.message);

    await logChange(requestId, 'cancelled', `Requisición cancelada por ${s.fullName ?? s.username}`, s.employeeId ?? s.username);

    revalidatePath('/documents/requests');
    revalidatePath(`/documents/requests/${requestId}`);
}

// -----------------------------------------------------------------------------
// Helper: bumpVersion
// -----------------------------------------------------------------------------
function bumpVersion(v: string): string {
    const parts = v.split('.').map((n) => parseInt(n, 10));
    if (parts.length === 1) return `${parts[0]}.1`;
    if (parts.length >= 2) {
        parts[1] = (parts[1] ?? 0) + 1;
        return parts.slice(0, 2).join('.');
    }
    return v;
}
