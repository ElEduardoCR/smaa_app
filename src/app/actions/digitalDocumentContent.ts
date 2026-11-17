'use server';

import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { getServerSupabase } from '@/lib/supabaseServer';
import { digitalTemplateContent } from '@/lib/documents/catalog';
import { initialDigitalValues, type DigitalRow, type DigitalTemplate, type DigitalValues } from '@/lib/documents/schema';
import { readDigitalTemplate, validateDigitalValues } from '@/lib/documents/validation';

async function authorize(action: 'view' | 'create' | 'edit') {
    const session = await getSession();
    if (!session || !can(session.role, session.permissions, 'documents', action)) throw new Error('No tienes permisos para esta operación.');
    return session;
}

export async function getDigitalRegisterValuesAction(documentId: string, documentCode?: string): Promise<DigitalValues> {
    const session = await authorize('create');
    const db = getServerSupabase();
    const { data: document, error } = await db.from('documents').select('source_key,template_schema').eq('id', documentId).single();
    if (error || !document?.template_schema) throw new Error('Registro maestro no encontrado.');
    const template = document.template_schema as DigitalTemplate;
    const values = initialDigitalValues(template);
    if ('actualizado_por' in values) values.actualizado_por = session.fullName || session.username;
    if ('fecha_actualizacion' in values) values.fecha_actualizacion = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chihuahua' }).format(new Date());
    if (document.source_key === 'listado-maestro-documentos' || document.source_key === 'listado-maestro-registros') {
        let query = db.from('documents').select('folio,title,revision,updated_at,effective_date,area,created_by,digital_kind').not('status', 'in', '(obsolete,pending_obsolete)').order('priority_order').order('folio');
        if (document.source_key === 'listado-maestro-registros') query = query.in('digital_kind', ['form', 'register']);
        const { data, error: listError } = await query;
        if (listError) throw new Error('No se pudo consultar el catálogo vigente.');
        if (document.source_key === 'listado-maestro-documentos') values.documentos = (data || []).map(item => ({ codigo: item.folio, nombre: item.title, responsable: '', revision: String(item.revision), fecha_revision: item.updated_at.slice(0, 10) }));
        else values.registros = (data || []).map(item => ({ codigo: item.folio, area: item.area || '', nombre: item.title, revision: String(item.revision), fecha_revision: item.updated_at.slice(0, 10), retencion_meses: '', regla_retencion: '', medio: 'Electrónico', responsable_disposicion: '', codigos_pendientes: '' }));
    } else if (document.source_key === 'indice-revisiones' && documentCode?.trim()) {
        const { data: target, error: targetError } = await db.from('documents').select('id,folio,title,revision,updated_at').eq('folio', documentCode.trim().toUpperCase()).single();
        if (targetError || !target) throw new Error('No se encontró ese código de documento.');
        const { data: versions, error: versionError } = await db.from('document_versions').select('revision,changed_at,change_summary,document_snapshot').eq('document_id', target.id).order('revision');
        if (versionError) throw new Error('No se pudieron consultar las revisiones.');
        values.codigo_documento = target.folio; values.nombre_documento = target.title;
        values.revisiones = [...(versions || []).map(item => ({ revision: String(item.revision), fecha_revision: String(item.document_snapshot?.updated_at || item.document_snapshot?.approval_signed_at || item.document_snapshot?.effective_date || item.changed_at).slice(0, 10), rcd: '', cambios: item.change_summary || '' })), { revision: String(target.revision), fecha_revision: target.updated_at.slice(0, 10), rcd: '', cambios: 'Revisión actual' }];
    }
    return values;
}

export async function updateDigitalDocumentContentAction(input: {
    documentId: string; expectedRevision: number; title: string; description: string;
    paragraphs: string[][]; nodeLabels: Record<string, string>; changeSummary: string;
    controlledTables?: Record<string, DigitalRow[]>;
}) {
    const session = await authorize('edit');
    if (!input.title?.trim() || input.title.length > 300 || !input.changeSummary?.trim() || input.changeSummary.length > 2000) throw new Error('Indica el título y el motivo del cambio.');
    const db = getServerSupabase();
    const { data: document, error } = await db.from('documents').select('template_schema,revision').eq('id', input.documentId).single();
    if (error || !document?.template_schema) throw new Error('Documento digital no encontrado.');
    const template = document.template_schema as DigitalTemplate;
    if (document.revision !== input.expectedRevision) throw new Error('El documento cambió. Recarga la página antes de editarlo.');
    if (!Array.isArray(input.paragraphs) || input.paragraphs.length !== template.sections.length || typeof input.description !== 'string' || input.description.length > 5000) throw new Error('Contenido no válido.');
    if (!input.nodeLabels || typeof input.nodeLabels !== 'object' || Array.isArray(input.nodeLabels)) throw new Error('Textos de actividades no válidos.');
    const tableKeys = new Set(template.captureEnabled === false ? template.sections.flatMap(section => section.table ? [section.table.key] : []) : []);
    if (input.controlledTables && (typeof input.controlledTables !== 'object' || Array.isArray(input.controlledTables) || Object.keys(input.controlledTables).some(key => !tableKeys.has(key)))) throw new Error('Sólo se puede editar el contenido de las tablas del documento controlado.');
    let size = 0;
    const updated: DigitalTemplate = { ...template, title: input.title.trim(), description: input.description.trim(), sections: template.sections.map((section, index) => {
        const paragraphs = input.paragraphs[index];
        if (!Array.isArray(paragraphs) || paragraphs.some(paragraph => typeof paragraph !== 'string' || paragraph.length > 30000) || paragraphs.length > 300) throw new Error('Una sección excede el tamaño permitido.');
        size += paragraphs.join('').length;
        const flow = section.flow ? { ...section.flow, nodes: section.flow.nodes.map(node => {
            const label = input.nodeLabels[`${index}:${node.id}`] ?? node.label;
            if (typeof label !== 'string' || !label.trim() || label.length > 2000) throw new Error('El texto de una actividad del mapa no es válido.');
            return { ...node, label: label.trim() };
        }) } : undefined;
        let table = section.table;
        if (table && input.controlledTables?.[table.key] !== undefined) {
            const proposedRows = input.controlledTables[table.key];
            if (!Array.isArray(proposedRows) || proposedRows.length > 500) throw new Error('La tabla excede la cantidad de filas permitidas.');
            const editable = { ...table, fixedRows: false, minRows: 0, maxRows: 500, initialRows: undefined,
                columns: table.columns.map(column => ({ ...column, readOnly: false })) };
            const rows = proposedRows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => {
                const column = editable.columns.find(column => column.key === key);
                return [key, column?.type !== 'number' && typeof value === 'number' ? String(value) : value];
            })));
            const cleaned = validateDigitalValues({ ...template, sections: [{ title: section.title, table: editable }] }, { [table.key]: rows }, false);
            table = { ...table, initialRows: cleaned[table.key] as DigitalRow[] };
        }
        return { ...section, paragraphs: paragraphs.map(paragraph => paragraph.trim()).filter(Boolean), ...(flow ? { flow } : {}), ...(table ? { table } : {}) };
    }) };
    if (size > 800000 || JSON.stringify(updated).length > 1500000) throw new Error('El documento excede el tamaño permitido.');
    readDigitalTemplate(updated);
    const { error: updateError } = await db.rpc('update_digital_document_content', {
        p_document_id: input.documentId, p_expected_revision: input.expectedRevision,
        p_template_schema: updated, p_content: digitalTemplateContent(updated),
        p_actor_name: session.fullName || session.username, p_change_summary: input.changeSummary.trim(),
    });
    if (updateError) throw new Error(updateError.message);
    revalidatePath('/documents'); revalidatePath(`/documents/${input.documentId}`);
    return { id: input.documentId };
}
