'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/session';
import { can, type Action } from '@/lib/permissions';
import { getServerSupabase } from '@/lib/supabaseServer';
import type { DigitalTemplate, DigitalValues } from '@/lib/documents/schema';
import { initialDigitalValues } from '@/lib/documents/schema';
import { assertDigitalId, readDigitalTemplate, validateDigitalValues } from '@/lib/documents/validation';
import { generateDigitalPdf } from '@/lib/documents/pdf';
import { removeUncommittedDigitalPdf, signDigitalPdf, uploadDigitalPdf } from '@/lib/documents/storage';

export type DigitalEntrySummary = {
    id: string;
    document_id: string;
    folio: string;
    revision: number;
    template_version: string;
    status: 'draft' | 'finalized';
    created_by: string | null;
    created_by_name: string;
    created_at: string;
    updated_at: string;
    finalized_at: string | null;
};

export type DigitalEntryDetail = DigitalEntrySummary & {
    values: DigitalValues;
    template_snapshot: DigitalTemplate;
    template_revision: number;
    document_title: string;
    pdf_versions: { revision: number; created_at: string; sha256: string }[];
    can_edit: boolean;
};

export type SaveDigitalEntryInput = {
    documentId: string;
    entryId?: string;
    expectedRevision?: number;
    expectedTemplateVersion?: string;
    expectedTemplateRevision?: number;
    values: DigitalValues;
    status: 'draft' | 'finalized';
};

const SUMMARY_COLUMNS = 'id,document_id,folio,revision,template_version,status,created_by,created_by_name,created_at,updated_at,finalized_at';

async function requireDocuments(action: Action = 'view') {
    const session = await getSession();
    if (!session) throw new Error('Inicia sesión para acceder a los documentos.');
    if (!can(session.role, session.permissions, 'documents', action)) throw new Error('No tienes permiso para esta acción en Documentos.');
    return session;
}

async function loadDigitalDocument(documentId: string) {
    assertDigitalId(documentId, 'Documento');
    const { data, error } = await getServerSupabase().from('documents')
        .select('id,folio,title,version,revision,status,source_key,template_schema,updated_at').eq('id', documentId).single();
    if (error || !data) throw new Error('El documento digital no existe o no se pudo consultar.');
    const template = readDigitalTemplate(data.template_schema);
    // Display the controlled identity from the document row, including later
    // approved title/code changes, while retaining the exact stored schema.
    return { document: data, template };
}

export async function listDigitalEntriesAction(documentId: string): Promise<DigitalEntrySummary[]> {
    await requireDocuments();
    assertDigitalId(documentId, 'Documento');
    const db = getServerSupabase();
    const entries: DigitalEntrySummary[] = [];
    for (let offset = 0; ; offset += 200) {
        const { data, error } = await db.from('document_entries').select(SUMMARY_COLUMNS)
            .eq('document_id', documentId).order('updated_at', { ascending: false }).order('id').range(offset, offset + 199);
        if (error) throw new Error(`No se pudieron consultar las capturas: ${error.message}`);
        entries.push(...(data || []) as DigitalEntrySummary[]);
        if (!data || data.length < 200) break;
    }
    return entries;
}

export async function getDigitalEntryAction(entryId: string): Promise<DigitalEntryDetail> {
    const session = await requireDocuments();
    assertDigitalId(entryId, 'Captura');
    const db = getServerSupabase();
    const { data, error } = await db.from('document_entries').select('*').eq('id', entryId).single();
    if (error || !data) throw new Error('La captura no existe o no se pudo consultar.');
    const [{ data: versions, error: versionError }, { data: document, error: docError }] = await Promise.all([
        db.from('document_entry_versions').select('revision,created_at,sha256').eq('entry_id', entryId).order('revision', { ascending: false }),
        db.from('documents').select('title').eq('id', data.document_id).single(),
    ]);
    if (versionError || docError) throw new Error('No se pudo consultar el historial de la captura.');
    return { ...data, template_snapshot: readDigitalTemplate(data.template_snapshot),
        document_title: document?.title || data.template_snapshot.title,
        pdf_versions: versions || [],
        can_edit: data.status === 'draft' && (data.created_by === session.employeeId || can(session.role, session.permissions, 'documents', 'edit')),
    } as DigitalEntryDetail;
}

export async function saveDigitalEntryAction(input: SaveDigitalEntryInput): Promise<{ id: string; revision: number }> {
    const session = await requireDocuments();
    if (!input || typeof input !== 'object' || !['draft', 'finalized'].includes(input.status)) throw new Error('Estado de captura no válido.');
    assertDigitalId(input.documentId, 'Documento');
    if (input.entryId !== undefined) assertDigitalId(input.entryId, 'Captura');
    const canEdit = can(session.role, session.permissions, 'documents', 'edit');
    if (!input.entryId && !can(session.role, session.permissions, 'documents', 'create')) {
        throw new Error('No tienes permiso para crear capturas.');
    }
    const db = getServerSupabase();
    const { document, template } = await loadDigitalDocument(input.documentId);
    if (['obsolete', 'pending_obsolete'].includes(document.status)) throw new Error('Este formato está obsoleto. Utiliza la versión vigente.');
    if (template.captureEnabled === false || !template.sections.some(s => s.fields?.length || s.table)) throw new Error('Este documento es de consulta y no tiene campos de captura.');
    if ((input.expectedTemplateVersion !== undefined && input.expectedTemplateVersion !== document.version) ||
        (input.expectedTemplateRevision !== undefined && input.expectedTemplateRevision !== document.revision)) {
        throw new Error('El formato cambió. Actualiza antes de iniciar la captura.');
    }
    const values = validateDigitalValues(template, input.values, input.status === 'finalized');
    let entryId = input.entryId;
    let folio: string;
    let revision = 1;
    if (entryId) {
        if (!Number.isInteger(input.expectedRevision) || (input.expectedRevision ?? 0) < 1) throw new Error('Actualiza la captura antes de guardar.');
        const { data: current, error } = await db.from('document_entries').select('*').eq('id', entryId).single();
        if (error || !current || current.document_id !== document.id) throw new Error('La captura no pertenece a este documento.');
        if (current.status === 'finalized') throw new Error('La captura finalizada conserva su evidencia y ya no se puede editar.');
        if (current.created_by !== session.employeeId && !canEdit) throw new Error('Solo puedes editar tus borradores.');
        if (current.revision !== input.expectedRevision) throw new Error('Otra persona guardó cambios. Actualiza antes de guardar.');
        if (current.template_version !== document.version || current.template_revision !== document.revision ||
            JSON.stringify(current.template_snapshot) !== JSON.stringify(document.template_schema)) {
            // JSONB may reorder keys identically across reads. The transaction
            // also compares JSONB equality to close the concurrent-edit window.
            if (current.template_version !== document.version || current.template_revision !== document.revision ||
                JSON.stringify(sortJson(current.template_snapshot)) !== JSON.stringify(sortJson(document.template_schema))) {
                throw new Error('Este borrador utiliza una versión anterior. Inicia una nueva captura con el formato actualizado.');
            }
        }
        folio = current.folio;
        revision = current.revision + 1;
    } else {
        if (input.expectedRevision !== undefined && input.expectedRevision !== 0) throw new Error('Revisión inicial no válida.');
        entryId = randomUUID();
        const { data, error } = await db.rpc('digital_next_entry_folio', { p_document_id: document.id });
        if (error || typeof data !== 'string') throw new Error(`No se pudo asignar el folio: ${error?.message || 'respuesta no válida'}`);
        folio = data;
    }
    const savedAt = new Date().toISOString();
    const authorName = session.fullName || session.username;
    const pdfTemplate = { ...template, code: document.folio, title: document.title };
    const pdf = generateDigitalPdf({ template: pdfTemplate, values, folio, templateVersion: document.version,
        templateRevision: document.revision, revision, status: input.status, authorName, savedAt });
    const pdfPath = `entries/${entryId}/r${revision}-${randomUUID()}.pdf`;
    await uploadDigitalPdf(pdfPath, pdf.bytes);
    let committed = false;
    try {
        const { data, error } = await db.rpc('save_digital_entry', {
            p_entry_id: entryId, p_document_id: document.id, p_expected_revision: input.expectedRevision ?? 0, p_folio: folio,
            p_template_version: document.version, p_template_revision: document.revision, p_template_snapshot: document.template_schema,
            p_values: values, p_status: input.status, p_actor_id: session.employeeId, p_actor_name: authorName, p_can_edit: canEdit,
            p_pdf_path: pdfPath, p_sha256: pdf.sha256, p_pdf_size: pdf.bytes.length, p_saved_at: savedAt,
        });
        if (error || !data?.id) throw new Error(error?.message || 'No se pudo confirmar la captura.');
        committed = true;
        revalidatePath(`/documents/${document.id}`);
        revalidatePath(`/documents/${document.id}/entries/${entryId}`);
        return { id: data.id, revision: data.revision };
    } catch (error) {
        // A lost network response can follow a successful commit. Never remove
        // evidence unless a successful DB read confirms this path is unlinked.
        if (!committed) {
            const { data: version, error: checkError } = await db.from('document_entry_versions')
                .select('entry_id,revision').eq('pdf_path', pdfPath).maybeSingle();
            if (version) return { id: version.entry_id, revision: version.revision };
            if (!checkError) await removeUncommittedDigitalPdf(pdfPath).catch(() => undefined);
        }
        throw error;
    }
}

function sortJson(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortJson);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, sortJson(val)]));
    return value;
}

export async function getDigitalPdfAction(entryId: string, revision?: number, mode: 'inline' | 'download' = 'inline'): Promise<string> {
    await requireDocuments();
    assertDigitalId(entryId, 'Captura');
    if (revision !== undefined && (!Number.isInteger(revision) || revision < 1)) throw new Error('Revisión no válida.');
    const db = getServerSupabase();
    const { data: entry, error: entryError } = await db.from('document_entries').select('folio,revision').eq('id', entryId).single();
    if (entryError || !entry) throw new Error('La captura no existe.');
    const { data, error } = await db.from('document_entry_versions').select('pdf_path,revision').eq('entry_id', entryId)
        .eq('revision', revision ?? entry.revision).single();
    if (error || !data) throw new Error('No se encontró el PDF archivado de esta revisión.');
    if (!['inline', 'download'].includes(mode)) throw new Error('Modo de PDF no válido.');
    return signDigitalPdf(data.pdf_path, `${entry.folio.replaceAll('/', '-')}_r${data.revision}.pdf`, mode === 'download');
}

export async function getDigitalTemplatePdfAction(documentId: string, mode: 'inline' | 'download' = 'inline'): Promise<string> {
    await requireDocuments();
    const { document, template } = await loadDigitalDocument(documentId);
    const pdf = generateDigitalPdf({ template: { ...template, code: document.folio, title: document.title },
        values: initialDigitalValues(template), folio: `${document.folio} · EN BLANCO`,
        templateVersion: document.version, templateRevision: document.revision, revision: 0,
        status: 'blank', documentStatus: document.status, authorName: 'Sin captura', savedAt: document.updated_at });
    const path = `templates/${document.id}/${pdf.sha256}.pdf`;
    await uploadDigitalPdf(path, pdf.bytes, true);
    if (!['inline', 'download'].includes(mode)) throw new Error('Modo de PDF no válido.');
    return signDigitalPdf(path, `${document.folio}_Formato.pdf`, mode === 'download');
}

export async function getDigitalSourceEvidenceAction(documentId: string, sha256: string): Promise<string> {
    await requireDocuments();
    const { template } = await loadDigitalDocument(documentId);
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Referencia de archivo no válida.');
    const evidence = template.sourceEvidence?.find(source => source.sha256 === sha256);
    if (!evidence || evidence.storagePath !== `sources/${sha256}.pdf`) throw new Error('No se encontró el original de este documento.');
    return signDigitalPdf(evidence.storagePath, evidence.fileName);
}
