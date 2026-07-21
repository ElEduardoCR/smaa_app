"use client";

import { useRef, useState } from "react";
import { Upload, FileText, Box, Image as ImageIcon, FileQuestion, RefreshCw, Trash2, Download, X, Loader2 } from "lucide-react";
import clsx from "clsx";
import { supabase } from "@/lib/supabase";

export type AttachedFile = {
    id?: string;
    file_name: string;
    file_url: string;
    file_size?: number | null;
    file_kind?: string; // drawing | reference | wps | photo | other
    mime_type?: string | null;
    created_at?: string;
};

type Props = {
    workOrderId: string;
    attachments: AttachedFile[];
    onChange: () => void;
    showKindSelector?: boolean;
};

function detectKind(file: File): { kind: string; mime: string; type: "pdf" | "step" | "image" | "other" } {
    const mime = file.type || "application/octet-stream";
    const name = file.name.toLowerCase();
    if (mime.includes("pdf") || name.endsWith(".pdf")) return { kind: "drawing", mime, type: "pdf" };
    if (
        name.endsWith(".step") || name.endsWith(".stp") ||
        name.endsWith(".iges") || name.endsWith(".igs") ||
        name.endsWith(".x_t") || name.endsWith(".x_b")
    ) {
        return { kind: "drawing", mime, type: "step" };
    }
    if (mime.startsWith("image/")) return { kind: "reference", mime, type: "image" };
    return { kind: "other", mime, type: "other" };
}

function iconFor(type: "pdf" | "step" | "image" | "other") {
    if (type === "pdf") return <FileText className="w-5 h-5 text-rose-400" />;
    if (type === "step") return <Box className="w-5 h-5 text-cyan-400" />;
    if (type === "image") return <ImageIcon className="w-5 h-5 text-emerald-400" />;
    return <FileQuestion className="w-5 h-5 text-neutral-400" />;
}

function formatSize(b?: number | null) {
    if (!b) return "—";
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
    return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function AttachmentUploader({ workOrderId, attachments, onChange, showKindSelector = true }: Props) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const [pendingKind, setPendingKind] = useState<string>("drawing");
    const [err, setErr] = useState<string | null>(null);

    const handleUpload = async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        setBusy(true);
        setErr(null);
        try {
            for (let i = 0; i < files.length; i++) {
                const f = files[i];
                if (f.size > 200 * 1024 * 1024) {
                    setErr(`"${f.name}" excede el límite de 200 MB.`);
                    continue;
                }
                const det = detectKind(f);
                const path = `${workOrderId}/${Date.now()}_${f.name}`;
                const { error: upErr } = await supabase.storage
                    .from("work_order_files")
                    .upload(path, f, { cacheControl: "3600", upsert: false, contentType: det.mime });
                if (upErr) throw upErr;
                const { data: urlData } = supabase.storage.from("work_order_files").getPublicUrl(path);
                const { error: insErr } = await supabase.from("work_order_files").insert([{
                    work_order_id: workOrderId,
                    file_name: f.name,
                    file_url: urlData.publicUrl,
                    file_size: f.size,
                    file_kind: showKindSelector ? pendingKind : det.kind,
                    mime_type: det.mime,
                    uploaded_by: "company",
                }]);
                if (insErr) throw insErr;
            }
            onChange();
        } catch (e: any) {
            setErr(e?.message || "Error al subir.");
        } finally {
            setBusy(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const handleDelete = async (a: AttachedFile) => {
        if (!a.id) return;
        if (!confirm(`¿Eliminar "${a.file_name}"?`)) return;
        try {
            const urlParts = a.file_url.split("/work_order_files/");
            if (urlParts.length > 1) {
                const storagePath = decodeURIComponent(urlParts[1]);
                await supabase.storage.from("work_order_files").remove([storagePath]);
            }
            await supabase.from("work_order_files").delete().eq("id", a.id);
            onChange();
        } catch (e: any) {
            setErr(e?.message || "Error al eliminar.");
        }
    };

    return (
        <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 bg-neutral-900/40 rounded-xl border border-neutral-700/30">
                {showKindSelector && (
                    <select
                        value={pendingKind}
                        onChange={(e) => setPendingKind(e.target.value)}
                        className="bg-neutral-900/80 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
                    >
                        <option value="drawing">Plano / Diseño</option>
                        <option value="wps">WPS / Procedimiento</option>
                        <option value="reference">Referencia / Manual</option>
                        <option value="photo">Foto</option>
                        <option value="other">Otro</option>
                    </select>
                )}
                <label
                    className={clsx(
                        "flex-1 sm:flex-none flex items-center justify-center gap-2 text-sm font-medium px-4 py-2 rounded-lg border transition-colors cursor-pointer",
                        busy
                            ? "bg-neutral-700 text-neutral-400 border-neutral-600 cursor-wait"
                            : "bg-orange-500/10 text-orange-400 border-orange-500/20 hover:bg-orange-500/20"
                    )}
                >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    {busy ? "Subiendo…" : "Subir archivos"}
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) => handleUpload(e.target.files)}
                        disabled={busy}
                    />
                </label>
                <span className="text-[11px] text-neutral-500">PDF, STEP, IGES, X_T, imágenes (hasta 200 MB c/u)</span>
            </div>

            {err && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg px-3 py-2 text-sm flex items-center gap-2">
                    <X className="w-4 h-4" /> {err}
                </div>
            )}

            {attachments.length === 0 ? (
                <p className="text-neutral-500 text-sm text-center py-4">Sin archivos adjuntos.</p>
            ) : (
                <ul className="space-y-2">
                    {attachments.map((a) => {
                        const isStep = /\.(step|stp|iges|igs|x_t|x_b)$/i.test(a.file_name);
                        const isPdf = /\.pdf$/i.test(a.file_name);
                        return (
                            <li key={a.id || a.file_url} className="flex items-center justify-between gap-3 bg-neutral-900/40 p-3 rounded-xl border border-neutral-700/30 hover:bg-neutral-800/60 transition-colors">
                                <div className="flex items-center gap-3 min-w-0">
                                    {iconFor(isStep ? "step" : isPdf ? "pdf" : a.mime_type?.startsWith("image/") ? "image" : "other")}
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium text-white truncate">{a.file_name}</p>
                                        <p className="text-[11px] text-neutral-500">
                                            {a.file_kind || "ref"} · {formatSize(a.file_size)} {a.created_at ? `· ${new Date(a.created_at).toLocaleDateString()}` : ""}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1 flex-shrink-0">
                                    <a
                                        href={a.file_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg transition-colors"
                                        title="Descargar"
                                    >
                                        <Download className="w-4 h-4" />
                                    </a>
                                    {a.id && (
                                        <button
                                            onClick={() => handleDelete(a)}
                                            className="p-2 text-neutral-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                                            title="Eliminar"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}

export function fileTypeFromName(name: string): "pdf" | "step" | "image" | "other" {
    const n = name.toLowerCase();
    if (n.endsWith(".pdf")) return "pdf";
    if (n.endsWith(".step") || n.endsWith(".stp") || n.endsWith(".iges") || n.endsWith(".igs") || n.endsWith(".x_t") || n.endsWith(".x_b")) return "step";
    if (/\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(n)) return "image";
    return "other";
}
