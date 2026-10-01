"use client";

import { supabase } from "@/lib/supabase";
import { storageErrorMessage } from "@/lib/storageErrors";
import {
    createPurchaseUploadAction,
    type PurchaseFileKind,
    type UploadedPurchaseFile,
} from "@/app/actions/purchases";

/**
 * Sube los archivos de una PO directo del navegador a Storage (con URL
 * firmada por el servidor) y devuelve las rutas para registrarlas con
 * receivePurchaseOrderAction / addPurchaseAttachmentAction.
 */
export async function uploadPurchaseFiles(
    poId: string,
    files: File[],
    kind: PurchaseFileKind,
): Promise<UploadedPurchaseFile[]> {
    const uploaded: UploadedPurchaseFile[] = [];
    for (const file of files) {
        const contentType = file.type || "application/octet-stream";
        const { path, token } = await createPurchaseUploadAction(poId, file.name, contentType, file.size, kind);
        const { error } = await supabase.storage
            .from("purchase_files")
            .uploadToSignedUrl(path, token, file, { contentType });
        if (error) throw new Error(`No se pudo subir "${file.name}": ${storageErrorMessage(error.message)}`);
        uploaded.push({ path, fileName: file.name, contentType });
    }
    return uploaded;
}
