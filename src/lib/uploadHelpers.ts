"use client";

import { supabase } from "@/lib/supabase";

/**
 * Upload a base64 dataURL (typically a signature PNG) to the 'signatures' bucket.
 * Returns the public URL.
 */
export async function uploadSignatureDataUrl(dataUrl: string, prefix = "sig"): Promise<string> {
    const blob = await (await fetch(dataUrl)).blob();
    const filename = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
    const path = filename;
    const { error } = await supabase.storage
        .from("signatures")
        .upload(path, blob, { cacheControl: "3600", upsert: false, contentType: "image/png" });
    if (error) throw error;
    const { data } = supabase.storage.from("signatures").getPublicUrl(path);
    return data.publicUrl;
}

/**
 * Upload a File (e.g. photo) to a bucket, return its public URL.
 */
export async function uploadFileToBucket(
    file: File | Blob,
    bucket: "work_order_files" | "purchase_files" | "signatures" | "public_assets",
    path: string
): Promise<string> {
    const { error } = await supabase.storage.from(bucket).upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: (file as File).type || "application/octet-stream",
    });
    if (error) throw error;
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
}
