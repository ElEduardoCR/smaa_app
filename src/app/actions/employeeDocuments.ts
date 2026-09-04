'use server';

import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { getServerSupabase } from '@/lib/supabaseServer';
import {
    removeEmployeeFile, signEmployeeFile, uploadEmployeeFile,
} from '@/lib/expediente/storage';

// ===========================================================================
// Expediente del empleado.
//
// Todo pasa por aquí porque el bucket es privado: el navegador no puede leer
// ni escribir esos archivos con la anon key, y así debe quedarse.
//
// Permisos: por ahora se gatean con el módulo `finance`, que es donde vive la
// pantalla. Cuando se cree el módulo `rh` esto cambia a 'rh' / 'expedientes'
// y es el único lugar que hay que tocar.
// ===========================================================================

const MODULE = 'finance';

async function requireView() {
    const session = await getSession();
    if (!session) throw new Error('No autenticado.');
    if (session.role !== 'master' && !can(session.role, session.permissions, MODULE, 'view')) {
        throw new Error('No tienes permisos para ver el expediente.');
    }
    return session;
}

async function requireWrite() {
    const session = await getSession();
    if (!session) throw new Error('No autenticado.');
    if (session.role !== 'master' && !can(session.role, session.permissions, MODULE, 'edit')) {
        throw new Error('No tienes permisos para modificar el expediente.');
    }
    return session;
}

export type DocumentType = {
    code: string; name: string; category: string;
    required: boolean; has_expiry: boolean; allows_multiple: boolean;
    description: string | null; sort_order: number;
};

export type EmployeeDocument = {
    id: string; type_code: string; file_name: string; file_size: number | null;
    content_type: string | null; issued_at: string | null; expires_at: string | null;
    source: string; signed_at: string | null; notes: string | null;
    created_at: string; superseded_by: string | null;
};

export type ExpedienteStatusRow = {
    type_code: string; type_name: string; present: boolean;
    expires_at: string | null; status: 'faltante' | 'vigente' | 'por_vencer' | 'vencido';
};

export type ExpedienteResult = {
    types: DocumentType[];
    documents: EmployeeDocument[];
    status: ExpedienteStatusRow[];
    /** Documentos obligatorios presentes / total. */
    completeness: { present: number; total: number };
};

/** Todo lo que necesita la pestaña de expediente, en un viaje. */
export async function getEmployeeExpedienteAction(employeeId: string): Promise<ExpedienteResult> {
    await requireView();
    const db = getServerSupabase();

    const [typesRes, docsRes, statusRes] = await Promise.all([
        db.from('employee_document_types')
            .select('code, name, category, required, has_expiry, allows_multiple, description, sort_order')
            .eq('active', true).order('sort_order'),
        db.from('employee_documents')
            .select('id, type_code, file_name, file_size, content_type, issued_at, expires_at, source, signed_at, notes, created_at, superseded_by')
            .eq('employee_id', employeeId)
            .is('superseded_by', null)
            .order('created_at', { ascending: false }),
        db.from('v_employee_document_status')
            .select('type_code, type_name, present, expires_at, status, sort_order')
            .eq('employee_id', employeeId).order('sort_order'),
    ]);

    if (typesRes.error) throw typesRes.error;
    if (docsRes.error) throw docsRes.error;
    if (statusRes.error) throw statusRes.error;

    const status = (statusRes.data || []) as ExpedienteStatusRow[];
    return {
        types: (typesRes.data || []) as DocumentType[],
        documents: (docsRes.data || []) as EmployeeDocument[],
        status,
        completeness: {
            present: status.filter((s) => s.present).length,
            total: status.length,
        },
    };
}

export type UploadDocumentInput = {
    employeeId: string;
    typeCode: string;
    fileName: string;
    contentType: string;
    base64: string;
    issuedAt?: string | null;
    expiresAt?: string | null;
    notes?: string | null;
};

export async function uploadEmployeeDocumentAction(
    input: UploadDocumentInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
    const session = await requireWrite();
    const db = getServerSupabase();

    try {
        const { data: type } = await db
            .from('employee_document_types')
            .select('code, has_expiry').eq('code', input.typeCode).single();
        if (!type) return { ok: false, error: `Tipo de documento desconocido: ${input.typeCode}` };

        const file = await uploadEmployeeFile({
            employeeId: input.employeeId,
            typeCode: input.typeCode,
            fileName: input.fileName,
            contentType: input.contentType,
            base64: input.base64,
        });

        const { data, error } = await db.from('employee_documents').insert({
            employee_id: input.employeeId,
            type_code: input.typeCode,
            file_path: file.path,
            file_name: file.fileName,
            content_type: file.contentType,
            file_size: file.size,
            issued_at: input.issuedAt || null,
            expires_at: type.has_expiry ? (input.expiresAt || null) : null,
            notes: input.notes || null,
            source: 'upload',
            uploaded_by: session.employeeId ?? null,
        }).select('id').single();

        if (error) {
            // El archivo ya subió pero la fila no: no dejar basura en el bucket.
            await removeEmployeeFile(file.path).catch(() => undefined);
            throw error;
        }

        revalidatePath(`/finance/employees/${input.employeeId}`);
        return { ok: true, id: data.id };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'No se pudo subir el documento.' };
    }
}

/** URL firmada de vida corta para ver o descargar. No se guarda en la base. */
export async function getDocumentLinkAction(
    documentId: string, download = false,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
    await requireView();
    try {
        const db = getServerSupabase();
        const { data, error } = await db
            .from('employee_documents').select('file_path').eq('id', documentId).single();
        if (error || !data) return { ok: false, error: 'El documento no existe.' };
        return { ok: true, url: await signEmployeeFile(data.file_path, download) };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'No se pudo generar el enlace.' };
    }
}

export async function deleteEmployeeDocumentAction(
    documentId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
    await requireWrite();
    try {
        const db = getServerSupabase();
        const { data, error } = await db
            .from('employee_documents')
            .select('id, employee_id, file_path').eq('id', documentId).single();
        if (error || !data) return { ok: false, error: 'El documento no existe.' };

        await db.from('employee_documents').delete().eq('id', documentId);
        await removeEmployeeFile(data.file_path).catch(() => undefined);

        revalidatePath(`/finance/employees/${data.employee_id}`);
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'No se pudo borrar el documento.' };
    }
}

/**
 * Aplica al empleado los datos leídos de su Constancia de Situación Fiscal.
 *
 * Esto es lo que evita el motivo #1 de rechazo de timbrado en CFDI 4.0: que
 * el nombre, el código postal o el régimen del receptor no coincidan con el
 * padrón del SAT. El parseo ocurre en el navegador (mismo camino que ya se
 * usa para proveedores); aquí sólo se guarda lo verificado.
 */
export type CsfPatch = {
    fiscal_name?: string | null;
    rfc?: string | null;
    fiscal_zip_code?: string | null;
    fiscal_regime?: string | null;
};

export async function applyCsfToEmployeeAction(
    employeeId: string, patch: CsfPatch,
): Promise<{ ok: true; applied: string[] } | { ok: false; error: string }> {
    await requireWrite();
    try {
        const db = getServerSupabase();
        const clean: Record<string, string> = {};
        if (patch.fiscal_name) clean.fiscal_name = patch.fiscal_name.trim();
        if (patch.rfc) clean.rfc = patch.rfc.trim().toUpperCase();
        if (patch.fiscal_zip_code) clean.fiscal_zip_code = patch.fiscal_zip_code.trim();
        if (patch.fiscal_regime) clean.fiscal_regime = patch.fiscal_regime.trim();

        if (Object.keys(clean).length === 0) {
            return { ok: false, error: 'La constancia no traía datos que se pudieran leer.' };
        }

        const { error } = await db
            .from('payroll_employees')
            .update({ ...clean, csf_parsed_at: new Date().toISOString() })
            .eq('employee_id', employeeId);
        if (error) throw error;

        revalidatePath(`/finance/employees/${employeeId}`);
        return { ok: true, applied: Object.keys(clean) };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'No se pudieron aplicar los datos.' };
    }
}
