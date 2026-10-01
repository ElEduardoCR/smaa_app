'use server';

import { revalidatePath } from 'next/cache';
import { supabase } from '@/lib/supabase';
import { getSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { fileExtension, safeStorageName } from '@/lib/storageNames';
import { storageErrorMessage } from '@/lib/storageErrors';

async function requireSession() {
    const s = await getSession();
    if (!s) throw new Error('No autenticado.');
    return s;
}

const ACTION_LABEL = { view: 'ver', create: 'crear', edit: 'editar', delete: 'eliminar' } as const;

async function requireCan(action: 'view' | 'create' | 'edit' | 'delete') {
    const s = await requireSession();
    if (!can(s.role, s.permissions, 'purchases', action) && s.role !== 'master') {
        throw new Error(`No tienes permisos para ${ACTION_LABEL[action]} compras.`);
    }
    return s;
}

// =============================================================================
// Crear PO (también usado para el alta manual desde el form en /purchases/new)
// =============================================================================
export type CreatePOInput = {
    supplier_id: string | null;
    subtotal: number;
    vat_total: number;
    total: number;
    supplier_quote_url?: string | null;
    notes?: string | null;
    items: Array<{ description: string; quantity: number; unit_price: number; line_total: number }>;
    purchase_group_id?: string | null;
};

export async function createPurchaseOrderAction(input: CreatePOInput) {
    const session = await requireCan('create');
    if (!input.items || input.items.length === 0) {
        throw new Error('Agrega al menos un artículo.');
    }
    for (const it of input.items) {
        if (!it.description?.trim()) throw new Error('Cada artículo debe tener descripción.');
        if (it.quantity <= 0) throw new Error('La cantidad debe ser mayor a 0.');
        if (it.unit_price < 0) throw new Error('El precio unitario no puede ser negativo.');
    }
    if (input.supplier_id) {
        const { data: sup } = await supabase.from('suppliers').select('id').eq('id', input.supplier_id).maybeSingle();
        if (!sup) throw new Error('El proveedor seleccionado no existe.');
    }

    const { data: po, error: poErr } = await supabase
        .from('purchase_orders')
        .insert({
            supplier_id: input.supplier_id,
            status: 'Draft',
            subtotal: input.subtotal,
            vat_total: input.vat_total,
            total: input.total,
            supplier_quote_url: input.supplier_quote_url?.trim() || null,
            notes: input.notes?.trim() || null,
            purchase_group_id: input.purchase_group_id ?? null,
        })
        .select('id, po_number')
        .single();
    if (poErr) throw new Error('Error al crear PO: ' + poErr.message);

    const items = input.items.map((it) => ({
        purchase_order_id: po.id,
        description: it.description.trim(),
        quantity: it.quantity,
        unit_price: it.unit_price,
        line_total: it.line_total,
    }));
    const { error: itemsErr } = await supabase.from('purchase_order_items').insert(items);
    if (itemsErr) throw new Error('Error al crear items: ' + itemsErr.message);

    revalidatePath('/purchases');
    return { id: po.id, po_number: po.po_number };
}

// =============================================================================
// MULTICOMPRA: crear N POs en una sola transacción, una por proveedor,
// todas compartiendo un mismo `purchase_group_id`.
//
// Cada grupo debe tener al menos 1 item con descripción y cantidad > 0.
// Si una sola falla, hacemos rollback conceptual borrando las POs creadas.
// =============================================================================
export type MultiPurchaseGroupInput = {
    supplier_id: string | null;
    items: Array<{ description: string; quantity: number; unit_price: number; line_total: number }>;
    supplier_quote_url?: string | null;
};

export type CreateMultiPOInput = {
    notes?: string | null;
    groups: MultiPurchaseGroupInput[];
};

export async function createMultiPurchaseOrderAction(input: CreateMultiPOInput) {
    const session = await requireCan('create');

    if (!input.groups || input.groups.length < 2) {
        throw new Error('La multicompra requiere al menos 2 proveedores.');
    }

    // Validación por grupo
    for (let g = 0; g < input.groups.length; g++) {
        const group = input.groups[g];
        if (!group.supplier_id) throw new Error(`Grupo ${g + 1}: selecciona un proveedor.`);
        if (!group.items || group.items.length === 0) {
            throw new Error(`Grupo ${g + 1}: agrega al menos un artículo.`);
        }
        for (const it of group.items) {
            if (!it.description?.trim()) throw new Error(`Grupo ${g + 1}: cada artículo debe tener descripción.`);
            if (it.quantity <= 0) throw new Error(`Grupo ${g + 1}: la cantidad debe ser mayor a 0.`);
            if (it.unit_price < 0) throw new Error(`Grupo ${g + 1}: el precio unitario no puede ser negativo.`);
        }
        // Validar proveedor
        const { data: sup } = await supabase.from('suppliers').select('id').eq('id', group.supplier_id).maybeSingle();
        if (!sup) throw new Error(`Grupo ${g + 1}: el proveedor seleccionado no existe.`);
    }

    // Un único UUID para el grupo (Postgres lo genera en la primera PO y lo
    // propagamos a las siguientes). En la primera usamos gen_random_uuid()
    // explícitamente para tener un valor conocido desde el cliente.
    const groupId = (await import('crypto')).randomUUID();

    const createdPOs: { id: string; po_number: string; supplier_id: string; subtotal: number; vat_total: number; total: number }[] = [];

    try {
        for (const group of input.groups) {
            const subtotal = group.items.reduce((s, it) => s + it.line_total, 0);
            const vat_total = subtotal * 0.16;
            const total = subtotal + vat_total;

            const { data: po, error: poErr } = await supabase
                .from('purchase_orders')
                .insert({
                    supplier_id: group.supplier_id,
                    status: 'Draft',
                    subtotal,
                    vat_total,
                    total,
                    supplier_quote_url: group.supplier_quote_url?.trim() || null,
                    notes: input.notes?.trim() || null,
                    purchase_group_id: groupId,
                })
                .select('id, po_number')
                .single();

            if (poErr) throw new Error(`Error creando PO del grupo: ${poErr.message}`);

            const items = group.items.map((it) => ({
                purchase_order_id: po.id,
                description: it.description.trim(),
                quantity: it.quantity,
                unit_price: it.unit_price,
                line_total: it.line_total,
            }));
            const { error: itemsErr } = await supabase.from('purchase_order_items').insert(items);
            if (itemsErr) throw new Error('Error creando items: ' + itemsErr.message);

            createdPOs.push({
                id: po.id,
                po_number: po.po_number,
                supplier_id: group.supplier_id!,
                subtotal,
                vat_total,
                total,
            });
        }
    } catch (err) {
        // Rollback: borrar las POs que sí se crearon. Si esto también
        // falla, las POs huérfanas quedan — admin las limpia con el
        // botón "Obsoletar" (que ya existe en la lista).
        for (const p of createdPOs) {
            await supabase.from('purchase_orders').delete().eq('id', p.id);
        }
        throw err;
    }

    revalidatePath('/purchases');

    return {
        purchase_group_id: groupId,
        pos: createdPOs,
    };
}

// =============================================================================
// Update PO (usado por la página de edición /purchases/[id])
// =============================================================================
export type UpdatePOInput = {
    id: string;
    supplier_id: string | null;
    status: 'Draft' | 'Sent' | 'Approved' | 'Received';
    notes?: string | null;
    items: Array<{ description: string; quantity: number; unit_price: number; line_total: number }>;
};

export async function updatePurchaseOrderAction(input: UpdatePOInput) {
    const session = await requireCan('edit');
    if (!input.id) throw new Error('Falta el ID de la PO.');
    if (!input.items || input.items.length === 0) {
        throw new Error('Agrega al menos un artículo con descripción.');
    }
    if (input.supplier_id) {
        const { data: sup } = await supabase.from('suppliers').select('id').eq('id', input.supplier_id).maybeSingle();
        if (!sup) throw new Error('El proveedor seleccionado no existe.');
    }

    // Calcular totales
    const subtotal = input.items.reduce((s, it) => s + it.line_total, 0);
    const vat_total = subtotal * 0.16;
    const total = subtotal + vat_total;

    // 1. Update header
    const { error: poErr } = await supabase
        .from('purchase_orders')
        .update({
            supplier_id: input.supplier_id,
            status: input.status,
            subtotal,
            vat_total,
            total,
            notes: input.notes?.trim() || null,
        })
        .eq('id', input.id);
    if (poErr) throw new Error('Error al actualizar PO: ' + poErr.message);

    // 2. Replace items (delete + insert)
    const { error: delErr } = await supabase
        .from('purchase_order_items')
        .delete()
        .eq('purchase_order_id', input.id);
    if (delErr) throw new Error('Error al limpiar items: ' + delErr.message);

    const items = input.items.map((it) => ({
        purchase_order_id: input.id,
        description: it.description.trim(),
        quantity: it.quantity,
        unit_price: it.unit_price,
        line_total: it.line_total,
    }));
    const { error: itemsErr } = await supabase.from('purchase_order_items').insert(items);
    if (itemsErr) throw new Error('Error al guardar items: ' + itemsErr.message);

    revalidatePath('/purchases');
    revalidatePath(`/purchases/${input.id}`);
}

// =============================================================================
// Delete PO (en realidad obsoleta — soft delete)
// =============================================================================
export async function deletePurchaseOrderAction(id: string) {
    const session = await requireCan('delete');
    if (!id) throw new Error('Falta el ID de la PO.');

    // Soft-delete: marcar como obsoleto en vez de borrar.
    // Las POs son registros contables — no deben borrarse físicamente.
    const { error } = await supabase
        .from('purchase_orders')
        .update({ is_active: false })
        .eq('id', id);
    if (error) throw new Error('Error al obsoletar: ' + error.message);

    revalidatePath('/purchases');
    revalidatePath(`/purchases/${id}`);
}

/** Restaura una PO que fue marcada como obsoleto. */
export async function restorePurchaseOrderAction(id: string) {
    const session = await requireCan('edit');
    if (!id) throw new Error('Falta el ID de la PO.');

    const { error } = await supabase
        .from('purchase_orders')
        .update({ is_active: true })
        .eq('id', id);
    if (error) throw new Error('Error al restaurar: ' + error.message);

    revalidatePath('/purchases');
    revalidatePath(`/purchases/${id}`);
}

// =============================================================================
// Archivos de la PO (facturas, fotos, otros).
//
// Los archivos NO pasan por el servidor: en Vercel el cuerpo de una request
// a una función (y por lo tanto a una server action) topa en 4.5 MB, y una
// foto de celular en base64 ya lo rebasa. El flujo es:
//   1) createPurchaseUploadAction → valida permiso/tipo/tamaño y devuelve
//      una URL firmada de subida para una ruta dentro de la carpeta de la PO.
//   2) El navegador sube directo a Storage con uploadToSignedUrl.
//   3) receivePurchaseOrderAction / addPurchaseAttachmentAction registran
//      las rutas ya subidas (sólo se aceptan rutas de la carpeta de esa PO).
// =============================================================================
export type PurchaseFileKind = 'invoice' | 'evidence' | 'other';

export type UploadedPurchaseFile = {
    path: string;
    fileName: string;
    contentType: string;
};

const PURCHASE_FILE_LIMIT_BYTES = 50 * 1024 * 1024;
const OFFICE_EXTENSIONS = ['doc', 'docx', 'xls', 'xlsx'];

function purchaseFolder(poId: string, kind: PurchaseFileKind) {
    return `${kind === 'invoice' ? 'invoices' : kind}/${poId}/`;
}

function validatePurchaseFile(fileName: string, contentType: string, fileSize: number, kind: PurchaseFileKind) {
    if (!fileName?.trim()) throw new Error('El archivo no tiene nombre.');
    if (!Number.isFinite(fileSize) || fileSize <= 0) throw new Error(`"${fileName}" está vacío.`);
    if (fileSize > PURCHASE_FILE_LIMIT_BYTES) throw new Error(`"${fileName}" excede el límite de 50 MB.`);

    const type = (contentType || '').toLowerCase();
    const ext = fileExtension(fileName);
    const isImage = type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(ext);
    const isPdf = type === 'application/pdf' || ext === 'pdf';
    const isXml = type.endsWith('/xml') || ext === 'xml';

    if (kind === 'evidence' && !isImage) throw new Error(`"${fileName}": la evidencia debe ser una imagen.`);
    if (kind === 'invoice' && !isPdf && !isImage && !isXml) {
        throw new Error(`"${fileName}": la factura debe ser PDF, XML o imagen.`);
    }
    if (kind === 'other' && !isPdf && !isImage && !isXml && !OFFICE_EXTENSIONS.includes(ext)) {
        throw new Error(`"${fileName}": sólo se aceptan PDF, XML, imágenes, Word o Excel.`);
    }
}

export async function createPurchaseUploadAction(
    poId: string,
    fileName: string,
    contentType: string,
    fileSize: number,
    kind: PurchaseFileKind,
): Promise<{ path: string; token: string }> {
    await requireCan('edit');
    if (!poId) throw new Error('Falta el ID de la PO.');
    validatePurchaseFile(fileName, contentType, fileSize, kind);

    const { data: po } = await supabase.from('purchase_orders').select('id').eq('id', poId).maybeSingle();
    if (!po) throw new Error('La orden de compra no existe.');

    const path = `${purchaseFolder(poId, kind)}${Date.now()}-${safeStorageName(fileName)}`;
    const { data, error } = await supabase.storage.from('purchase_files').createSignedUploadUrl(path);
    if (error || !data?.token) {
        throw new Error('No se pudo preparar la carga: ' + storageErrorMessage(error?.message || 'token no generado.'));
    }
    return { path, token: data.token };
}

function attachmentRows(
    poId: string,
    files: UploadedPurchaseFile[],
    kind: PurchaseFileKind,
    employeeId: string,
) {
    const folder = purchaseFolder(poId, kind);
    return files.map((f) => {
        if (!f.path?.startsWith(folder) || f.path.includes('..')) {
            throw new Error(`Ruta de archivo inválida para esta orden: ${f.fileName}`);
        }
        return {
            purchase_order_id: poId,
            kind,
            file_url: supabase.storage.from('purchase_files').getPublicUrl(f.path).data.publicUrl,
            file_name: f.fileName,
            content_type: f.contentType,
            uploaded_by: employeeId,
        };
    });
}

// Recibir PO: registra 1..N facturas (+ fotos opcionales) ya subidas y
// cambia el status a Received.
export async function receivePurchaseOrderAction(
    poId: string,
    invoices: UploadedPurchaseFile[],
    evidences: UploadedPurchaseFile[] = []
) {
    const session = await requireCan('edit');
    if (!poId) throw new Error('Falta el ID de la PO.');
    if (!invoices || invoices.length === 0) {
        throw new Error('Sube al menos una factura (PDF, XML o imagen) para recibir la compra.');
    }

    const invoiceRows = attachmentRows(poId, invoices, 'invoice', session.employeeId);
    const evidenceRows = attachmentRows(poId, evidences, 'evidence', session.employeeId);
    const { error: attErr } = await supabase
        .from('purchase_order_attachments')
        .insert([...invoiceRows, ...evidenceRows]);
    if (attErr) throw new Error('Error al registrar los archivos: ' + attErr.message);

    // invoice_url / evidence_photo_url conservan la primera de cada tipo
    // (retrocompatibilidad). Si no llegó evidencia nueva, no se borra la previa.
    const patch: Record<string, string> = {
        status: 'Received',
        invoice_url: invoiceRows[0].file_url,
    };
    if (evidenceRows.length > 0) patch.evidence_photo_url = evidenceRows[0].file_url;
    const { error: updateErr } = await supabase
        .from('purchase_orders')
        .update(patch)
        .eq('id', poId);
    if (updateErr) throw new Error('Error al actualizar status: ' + updateErr.message);

    revalidatePath('/purchases');
    revalidatePath(`/purchases/${poId}`);
    return {
        invoice_url: invoiceRows[0].file_url,
        attachment_count: invoiceRows.length,
        evidence_count: evidenceRows.length,
    };
}

// =============================================================================
// Agregar N adjuntos (ya subidos) a una PO existente sin cambiar status.
// Útil para "agregar otra factura" o "subir más evidencia" sin
// reabrir el flujo de "Recibir".
// =============================================================================
export async function addPurchaseAttachmentAction(
    poId: string,
    files: UploadedPurchaseFile[],
    kind: PurchaseFileKind = 'other'
) {
    const session = await requireCan('edit');
    if (!poId) throw new Error('Falta el ID de la PO.');
    if (!files || files.length === 0) throw new Error('Selecciona al menos un archivo.');

    const rows = attachmentRows(poId, files, kind, session.employeeId);
    const { error: insErr } = await supabase
        .from('purchase_order_attachments')
        .insert(rows);
    if (insErr) throw new Error('Error al registrar adjuntos: ' + insErr.message);

    // Si era la primera factura y la PO no tenía invoice_url, la llenamos
    if (kind === 'invoice') {
        const { data: po } = await supabase
            .from('purchase_orders')
            .select('invoice_url')
            .eq('id', poId)
            .maybeSingle();
        if (po && !po.invoice_url) {
            await supabase
                .from('purchase_orders')
                .update({ invoice_url: rows[0].file_url })
                .eq('id', poId);
        }
    }

    revalidatePath('/purchases');
    revalidatePath(`/purchases/${poId}`);
    return { count: rows.length, files: rows.map((r) => ({ url: r.file_url, name: r.file_name })) };
}

// =============================================================================
// Eliminar un adjunto (storage + BD)
// =============================================================================
export async function deletePurchaseAttachmentAction(attachmentId: string) {
    const session = await requireCan('edit');
    if (!attachmentId) throw new Error('Falta el ID del adjunto.');

    const { data: att } = await supabase
        .from('purchase_order_attachments')
        .select('*')
        .eq('id', attachmentId)
        .maybeSingle();
    if (!att) throw new Error('Adjunto no encontrado.');

    // Borrar del storage
    try {
        const path = (att as any).file_url.split('/purchase_files/').pop();
        if (path) {
            await supabase.storage.from('purchase_files').remove([decodeURIComponent(path)]);
        }
    } catch (storageErr) {
        console.warn('[deletePurchaseAttachmentAction] storage delete warning:', storageErr);
    }

    const { error } = await supabase
        .from('purchase_order_attachments')
        .delete()
        .eq('id', attachmentId);
    if (error) throw new Error('Error al eliminar: ' + error.message);

    revalidatePath('/purchases');
    revalidatePath(`/purchases/${(att as any).purchase_order_id}`);
    return { ok: true };
}

export async function viewPurchasesAction() {
    return await requireCan('view');
}
