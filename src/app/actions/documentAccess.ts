'use server';

import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/session';
import { can, type Action } from '@/lib/permissions';
import { getServerSupabase } from '@/lib/supabaseServer';
import { assertDigitalId } from '@/lib/documents/validation';
import { storeControlledSignature, signControlledSignature, removeUncommittedControlledSignature } from '@/lib/documents/approvalStorage';
import type { DigitalTemplate } from '@/lib/documents/schema';
import type { DocumentPayload, DocumentRequestStatus, DocumentRequestType } from './documentRequests';

export type ControlledDocumentSummary = {
    id: string; folio: string; title: string; version: string; revision: number; status: string;
    effective_date: string | null; next_review_date: string | null; created_at: string; updated_at: string;
    area: string | null; priority_order: number; digital_kind: string | null; source_key: string | null;
    type?: { code: string; name: string; prefix: string };
};
export type ControlledDocument = ControlledDocumentSummary & {
    type_id: string; objective: string | null; scope: string | null; definitions: string | null;
    responsibilities: string | null; content: string; document_references: string | null; records: string | null; keywords: string | null;
    approval_name: string | null; approval_role: string | null; approval_signature_url: string | null; approval_signed_at: string | null;
    created_by: string | null; template_schema: DigitalTemplate | null;
};
export type ControlledDocumentVersion = {
    id: string; version: string; revision: number; title: string; change_summary: string | null; changed_by: string | null; changed_at: string;
};
export type ControlledDocumentSignature = {
    id: string; version: string; signer_name: string; signer_role: string | null; signature_url: string; signed_at: string; purpose: string;
};
export type ControlledChange = {
    id: string; entity_type: string; entity_id: string | null; action: string; field_name: string | null;
    old_value: string | null; new_value: string | null; description: string | null; changed_by: string | null;
    source: string; commit_sha: string | null; commit_message: string | null; commit_author: string | null;
    commit_url: string | null; commit_date: string | null; changed_at: string; metadata: Record<string, unknown>;
};
export type ControlledRequest = {
    id: string; type: DocumentRequestType; title: string; change_summary: string | null; reason: string;
    payload: DocumentPayload; status: DocumentRequestStatus; requested_at: string; requested_by: string;
    doc_control_reviewer: string | null; doc_control_reviewed_at: string | null; doc_control_notes: string | null;
    top_mgmt_approver: string | null; top_mgmt_approved_at: string | null; top_mgmt_notes: string | null;
    top_mgmt_signature_url: string | null; revision_count: number; resulting_document_id: string | null;
    target_document_id: string | null; published_at: string | null;
};
export type DocumentTypeOption = { id: string; code: string; name: string; prefix: string; sort_order: number };
type EmployeeLite = { id: string; full_name: string; role: string };

async function authorizeDocuments(actions: Action | Action[] = 'view') {
    const session = await getSession();
    const allowed = Array.isArray(actions) ? actions : [actions];
    if (!session || !allowed.some(action => can(session.role, session.permissions, 'documents', action))) {
        throw new Error('No tienes permisos para acceder a esta información documental.');
    }
    return session;
}
async function authorizeRequests() {
    const session = await getSession();
    if (!session || (!['master', 'document_controller', 'top_management'].includes(session.role) &&
        !can(session.role, session.permissions, 'document_requests', 'view'))) {
        throw new Error('No tienes permisos para ver requisiciones de documentos.');
    }
    return session;
}
const summaryColumns = 'id,folio,title,version,revision,status,effective_date,next_review_date,created_at,updated_at,area,priority_order,digital_kind,source_key,type:document_types(code,name,prefix)';
const normalizeType = <T extends { type?: unknown }>(row: T) => ({ ...row, type: Array.isArray(row.type) ? row.type[0] : row.type });
const refreshDocument = (id?: string) => { revalidatePath('/documents'); if (id) revalidatePath(`/documents/${id}`); revalidatePath('/changes'); };

export async function listControlledDocumentsAction(): Promise<ControlledDocumentSummary[]> {
    await authorizeDocuments();
    const { data, error } = await getServerSupabase().from('documents').select(summaryColumns)
        .order('priority_order', { ascending: true, nullsFirst: false }).order('folio');
    if (error) throw new Error('No se pudo consultar el catálogo de documentos.');
    return (data || []).map(normalizeType) as unknown as ControlledDocumentSummary[];
}

export async function getControlledDocumentAction(id: string) {
    const session = await authorizeDocuments(['view', 'edit']);
    assertDigitalId(id, 'Documento');
    const db = getServerSupabase();
    const [document, versions, signatures] = await Promise.all([
        db.from('documents').select('*,type:document_types(code,name,prefix)').eq('id', id).single(),
        db.from('document_versions').select('id,version,revision,title,change_summary,changed_by,changed_at').eq('document_id', id).order('changed_at', { ascending: false }),
        db.from('document_signatures').select('id,version,signer_name,signer_role,signature_url,signed_at,purpose').eq('document_id', id).order('signed_at', { ascending: false }),
    ]);
    if (document.error || versions.error || signatures.error || !document.data) throw new Error('No se pudo consultar el documento y su historial.');
    const signed = await Promise.all((signatures.data || []).map(async signature => ({ ...signature, signature_url: await signControlledSignature(signature.signature_url) || '' })));
    return {
        document: { ...normalizeType(document.data), approval_signature_url: await signControlledSignature(document.data.approval_signature_url) } as ControlledDocument,
        versions: (versions.data || []) as ControlledDocumentVersion[], signatures: signed as ControlledDocumentSignature[],
        viewer: { fullName: session.fullName || session.username, position: session.position || session.role },
    };
}

export async function getDocumentEditorOptionsAction() {
    const session = await getSession();
    if (!session || (!['master', 'document_controller', 'top_management'].includes(session.role) &&
        !['view', 'create', 'edit'].some(action => can(session.role, session.permissions, 'documents', action as Action)) &&
        !can(session.role, session.permissions, 'document_requests', 'create'))) {
        throw new Error('No tienes permisos para consultar las opciones del editor documental.');
    }
    const { data, error } = await getServerSupabase().from('document_types').select('id,code,name,prefix,sort_order').eq('is_active', true).order('sort_order');
    if (error) throw new Error('No se pudieron consultar los tipos de documento.');
    return { types: (data || []) as DocumentTypeOption[], viewer: { fullName: session.fullName || session.username, position: session.position || session.role } };
}

export async function saveLegacyControlledDocumentAction(input: { documentId?: string; expectedRevision?: number; payload: DocumentPayload }) {
    const session = await authorizeDocuments(input.documentId ? 'edit' : 'create');
    if (input.documentId) assertDigitalId(input.documentId, 'Documento');
    if (!input.payload || typeof input.payload !== 'object' || !input.payload.title?.trim() || !input.payload.content?.trim()) throw new Error('El título y el contenido son obligatorios.');
    if (!input.payload.type_id) throw new Error('Selecciona un tipo de documento.');
    assertDigitalId(input.payload.type_id, 'Tipo de documento');
    if (JSON.stringify(input.payload).length > 800_000 || input.payload.title.length > 300) throw new Error('El documento excede el tamaño permitido.');
    const { data, error } = await getServerSupabase().rpc('save_legacy_controlled_document', {
        p_document_id: input.documentId || null, p_expected_revision: input.expectedRevision ?? 0,
        p_payload: input.payload, p_actor_name: session.fullName || session.username,
    });
    if (error || !data?.id) throw new Error(error?.message || 'No se pudo guardar el documento.');
    refreshDocument(data.id);
    return { id: data.id as string };
}

export async function changeControlledDocumentStatusAction(input: { documentId: string; expectedRevision: number; status: string }) {
    await authorizeDocuments('edit');
    assertDigitalId(input.documentId, 'Documento');
    const previousStatus = input.status === 'in_review' ? 'draft' : input.status === 'pending_obsolete' ? 'approved' : null;
    if (!previousStatus) throw new Error('Solo se puede enviar un borrador a revisión o marcar un vigente para obsolescencia.');
    const { error, data } = await getServerSupabase().from('documents').update({ status: input.status, updated_at: new Date().toISOString() })
        .eq('id', input.documentId).eq('revision', input.expectedRevision).eq('status', previousStatus).select('id').single();
    if (error || !data) throw new Error('El documento cambió o no se pudo actualizar. Recarga antes de continuar.');
    refreshDocument(input.documentId);
}

export async function obsoleteControlledDocumentAction(input: { documentId: string; expectedRevision: number; reason: string }) {
    await authorizeDocuments('edit'); assertDigitalId(input.documentId, 'Documento');
    if (!input.reason?.trim() || input.reason.length > 2000) throw new Error('Indica el motivo de obsolescencia.');
    const { data, error } = await getServerSupabase().from('documents').update({ status: 'obsolete', obsoleted_at: new Date().toISOString(), obsoleted_reason: input.reason.trim(), updated_at: new Date().toISOString() })
        .eq('id', input.documentId).eq('revision', input.expectedRevision).in('status', ['approved', 'pending_obsolete']).select('id').single();
    if (error || !data) throw new Error('El documento cambió o no se pudo marcar como obsoleto.');
    refreshDocument(input.documentId);
}

export async function signControlledDocumentAction(input: { documentId: string; expectedRevision: number; signatureDataUrl: string }) {
    const session = await authorizeDocuments('edit'); assertDigitalId(input.documentId, 'Documento');
    const uri = await storeControlledSignature(input.signatureDataUrl, session.employeeId);
    try {
        const { error } = await getServerSupabase().rpc('sign_controlled_document', {
            p_document_id: input.documentId, p_expected_revision: input.expectedRevision,
            p_actor_name: session.fullName || session.username, p_actor_role: session.position || session.role, p_signature_uri: uri,
        });
        if (error) throw new Error(error.message);
    } catch (error) { await removeUncommittedControlledSignature(uri); throw error; }
    refreshDocument(input.documentId);
}

export async function deleteControlledDocumentAction(documentId: string) {
    await authorizeDocuments('delete'); assertDigitalId(documentId, 'Documento');
    const { data, error } = await getServerSupabase().from('documents').delete().eq('id', documentId).select('id').single();
    if (error || !data) throw new Error('No se pudo eliminar. Un documento con capturas conservadas debe marcarse como obsoleto.');
    refreshDocument();
}

export async function listControlledDocumentChangesAction(): Promise<ControlledChange[]> {
    await authorizeDocuments();
    const { data, error } = await getServerSupabase().from('change_log').select('*')
        .in('entity_type', ['document', 'document_version', 'document_request', 'document_entry']).order('changed_at', { ascending: false }).limit(300);
    if (error) throw new Error('No se pudo consultar la bitácora documental.');
    return (data || []) as ControlledChange[];
}

export async function listControlledDocumentRequestsAction() {
    await authorizeRequests();
    const db = getServerSupabase();
    const { data, error } = await db.from('document_requests')
        .select('id,type,title,change_summary,reason,status,requested_at,requested_by,doc_control_notes,top_mgmt_notes,revision_count,resulting_document_id,target_document_id')
        .order('requested_at', { ascending: false });
    if (error) throw new Error('No se pudieron consultar las requisiciones.');
    const ids = [...new Set((data || []).map(request => request.requested_by).filter(Boolean))];
    const employees = ids.length ? await db.from('employees').select('id,full_name,role').in('id', ids) : { data: [], error: null };
    if (employees.error) throw new Error('No se pudieron consultar los solicitantes.');
    return { requests: (data || []) as Pick<ControlledRequest, 'id' | 'type' | 'title' | 'change_summary' | 'reason' | 'status' | 'requested_at' | 'requested_by' | 'doc_control_notes' | 'top_mgmt_notes' | 'revision_count' | 'resulting_document_id' | 'target_document_id'>[], employees: Object.fromEntries((employees.data || []).map(employee => [employee.id, employee])) as Record<string, EmployeeLite> };
}

export async function getControlledDocumentRequestAction(id: string) {
    await authorizeRequests(); assertDigitalId(id, 'Requisición');
    const db = getServerSupabase();
    const { data: request, error } = await db.from('document_requests').select('*').eq('id', id).single();
    if (error || !request) throw new Error('No se pudo consultar la requisición.');
    const documentIds = [request.target_document_id, request.resulting_document_id].filter(Boolean);
    const [documents, changes] = await Promise.all([
        documentIds.length ? db.from('documents').select('id,folio,title,version,status').in('id', documentIds) : Promise.resolve({ data: [], error: null }),
        db.from('change_log').select('*').eq('entity_type', 'document_request').eq('entity_id', id).order('changed_at', { ascending: false }),
    ]);
    if (documents.error || changes.error) throw new Error('No se pudieron consultar los documentos e historial relacionados.');
    const employeeIds = [...new Set([request.requested_by, request.doc_control_reviewer, request.top_mgmt_approver,
        ...(changes.data || []).map(change => change.changed_by)].filter(value => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value)))];
    const employees = employeeIds.length ? await db.from('employees').select('id,full_name,role').in('id', employeeIds) : { data: [], error: null };
    if (employees.error) throw new Error('No se pudieron consultar los participantes de la requisición.');
    return {
        request: { ...request, top_mgmt_signature_url: await signControlledSignature(request.top_mgmt_signature_url) } as ControlledRequest,
        targetDocument: (documents.data || []).find(document => document.id === request.target_document_id) || null,
        resultingDocument: (documents.data || []).find(document => document.id === request.resulting_document_id) || null,
        changes: (changes.data || []) as ControlledChange[],
        employees: Object.fromEntries((employees.data || []).map(employee => [employee.id, employee])) as Record<string, EmployeeLite>,
    };
}
