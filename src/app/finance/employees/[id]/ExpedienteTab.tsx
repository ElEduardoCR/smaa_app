"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
    FileText, Upload, Download, Eye, Trash2, RefreshCw, CheckCircle2,
    AlertTriangle, XCircle, Sparkles,
} from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";
import { extractAndParseCSF } from "@/lib/csfParser";
import {
    applyCsfToEmployeeAction, deleteEmployeeDocumentAction,
    getDocumentLinkAction, getEmployeeExpedienteAction, uploadEmployeeDocumentAction,
    type ExpedienteResult,
} from "@/app/actions/employeeDocuments";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

const CATEGORY_LABELS: Record<string, string> = {
    identidad: "Identidad", fiscal: "Fiscal", laboral: "Laboral",
    academico: "Académico", salud: "Salud", bancario: "Bancario", otro: "Otros",
};

const STATUS_STYLE: Record<string, { label: string; cls: string; Icon: any }> = {
    vigente:    { label: "Vigente",    cls: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30", Icon: CheckCircle2 },
    por_vencer: { label: "Por vencer", cls: "text-amber-300 bg-amber-500/10 border-amber-500/30",       Icon: AlertTriangle },
    vencido:    { label: "Vencido",    cls: "text-rose-300 bg-rose-500/10 border-rose-500/30",          Icon: XCircle },
    faltante:   { label: "Faltante",   cls: "text-neutral-400 bg-neutral-700/30 border-neutral-600/40", Icon: FileText },
};

function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = String(reader.result);
            resolve(result.slice(result.indexOf(",") + 1));   // quitar "data:...;base64,"
        };
        reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
        reader.readAsDataURL(file);
    });
}

type Props = {
    employeeId: string;
    /** Se llama cuando la CSF actualizó los datos fiscales del empleado. */
    onFiscalDataApplied?: () => void;
};

export default function ExpedienteTab({ employeeId, onFiscalDataApplied }: Props) {
    const [data, setData] = useState<ExpedienteResult | null>(null);
    const [loading, setLoading] = useState(true);
    const [busyType, setBusyType] = useState<string | null>(null);
    const [msg, setMsg] = useState<{ type: "error" | "success" | "info"; text: string } | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const pendingType = useRef<{ code: string; hasExpiry: boolean } | null>(null);

    const flash = (type: "error" | "success" | "info", text: string) => {
        setMsg({ type, text });
        setTimeout(() => setMsg(null), 6000);
    };

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setData(await getEmployeeExpedienteAction(employeeId));
        } catch (e: any) {
            flash("error", e?.message || "No se pudo cargar el expediente.");
        } finally { setLoading(false); }
    }, [employeeId]);

    useEffect(() => { load(); }, [load]);

    const pickFile = (code: string, hasExpiry: boolean) => {
        pendingType.current = { code, hasExpiry };
        fileInputRef.current?.click();
    };

    const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        const pending = pendingType.current;
        if (!file || !pending) return;

        setBusyType(pending.code);
        try {
            let expiresAt: string | null = null;
            if (pending.hasExpiry) {
                const input = window.prompt(
                    "¿Cuándo vence este documento? (AAAA-MM-DD, o deja vacío si no vence)", "",
                );
                if (input && /^\d{4}-\d{2}-\d{2}$/.test(input.trim())) expiresAt = input.trim();
                else if (input && input.trim()) {
                    flash("error", "La fecha debe ir como AAAA-MM-DD. Se guardó sin vencimiento.");
                }
            }

            const base64 = await fileToBase64(file);
            const res = await uploadEmployeeDocumentAction({
                employeeId,
                typeCode: pending.code,
                fileName: file.name,
                contentType: file.type || "application/octet-stream",
                base64,
                expiresAt,
            });
            if (!res.ok) { flash("error", res.error); return; }

            // La CSF además llena los datos fiscales que exige el CFDI 4.0.
            if (pending.code === "csf") {
                try {
                    const csf = await extractAndParseCSF(file);
                    const applied = await applyCsfToEmployeeAction(employeeId, {
                        fiscal_name: csf.business_name,
                        rfc: csf.rfc,
                        fiscal_zip_code: csf.fiscal_zip_code,
                        fiscal_regime: csf.fiscal_regime,
                    });
                    if (applied.ok) {
                        flash("success",
                            `Constancia guardada. Se llenaron: ${applied.applied.join(", ")}. Verifícalos antes de timbrar.`);
                        onFiscalDataApplied?.();
                    } else {
                        flash("info", `Constancia guardada, pero no se pudo leer: ${applied.error}`);
                    }
                } catch {
                    flash("info", "Constancia guardada, pero no se pudieron leer los datos. Captúralos a mano.");
                }
            } else {
                flash("success", "Documento guardado en el expediente.");
            }
            await load();
        } catch (e: any) {
            flash("error", e?.message || "No se pudo subir el documento.");
        } finally {
            setBusyType(null);
            pendingType.current = null;
        }
    };

    const openDoc = async (id: string, download: boolean) => {
        const res = await getDocumentLinkAction(id, download);
        if (!res.ok) { flash("error", res.error); return; }
        window.open(res.url, "_blank", "noopener,noreferrer");
    };

    const removeDoc = async (id: string, name: string) => {
        if (!confirm(`¿Borrar "${name}" del expediente? No se puede deshacer.`)) return;
        const res = await deleteEmployeeDocumentAction(id);
        if (!res.ok) { flash("error", res.error); return; }
        flash("success", "Documento eliminado.");
        await load();
    };

    if (loading) {
        return (
            <div className="flex items-center gap-2 text-neutral-400 text-sm p-8 justify-center">
                <RefreshCw className="w-4 h-4 animate-spin" /> Cargando expediente…
            </div>
        );
    }
    if (!data) return null;

    const statusByType = new Map(data.status.map(s => [s.type_code, s]));
    const docsByType = new Map<string, typeof data.documents>();
    for (const d of data.documents) {
        docsByType.set(d.type_code, [...(docsByType.get(d.type_code) || []), d]);
    }

    const pct = data.completeness.total === 0
        ? 100
        : Math.round((data.completeness.present / data.completeness.total) * 100);

    const categories = [...new Set(data.types.map(t => t.category))];

    return (
        <div className="space-y-4">
            <input ref={fileInputRef} type="file" className="hidden"
                accept="application/pdf,image/*" onChange={handleFile} />

            {msg && (
                <div className={cn("p-3 rounded-xl border text-sm",
                    msg.type === "error" ? "bg-rose-500/10 border-rose-500/30 text-rose-300" :
                    msg.type === "success" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" :
                    "bg-sky-500/10 border-sky-500/30 text-sky-300")}>
                    {msg.text}
                </div>
            )}

            {/* Completitud */}
            <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-white">Expediente completo</h3>
                    <span className={cn("text-sm font-mono",
                        pct === 100 ? "text-emerald-300" : pct >= 60 ? "text-amber-300" : "text-rose-300")}>
                        {data.completeness.present}/{data.completeness.total} · {pct}%
                    </span>
                </div>
                <div className="h-2 bg-neutral-700/50 rounded-full overflow-hidden">
                    <div className={cn("h-full rounded-full transition-all",
                        pct === 100 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-rose-500")}
                        style={{ width: `${pct}%` }} />
                </div>
                <p className="text-xs text-neutral-500 mt-2">
                    Cuenta sólo los documentos obligatorios. Los archivos viven en un bucket privado:
                    los enlaces se firman al momento y caducan en 5 minutos.
                </p>
            </div>

            {categories.map(cat => (
                <div key={cat} className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl overflow-hidden">
                    <div className="px-5 py-3 border-b border-neutral-700/50">
                        <h4 className="text-xs uppercase tracking-wider text-neutral-400 font-semibold">
                            {CATEGORY_LABELS[cat] ?? cat}
                        </h4>
                    </div>
                    <div className="divide-y divide-neutral-700/30">
                        {data.types.filter(t => t.category === cat).map(t => {
                            const st = statusByType.get(t.code);
                            const docs = docsByType.get(t.code) || [];
                            const style = STATUS_STYLE[st?.status ?? (docs.length ? "vigente" : "faltante")];
                            const StatusIcon = style.Icon;
                            return (
                                <div key={t.code} className="px-5 py-3">
                                    <div className="flex items-center justify-between gap-3 flex-wrap">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-sm text-neutral-200">{t.name}</span>
                                                {t.required && (
                                                    <span className="text-[10px] uppercase tracking-wider text-neutral-500 border border-neutral-600/50 rounded px-1.5 py-0.5">
                                                        obligatorio
                                                    </span>
                                                )}
                                                {t.required && (
                                                    <span className={cn("text-[10px] uppercase tracking-wider border rounded px-1.5 py-0.5 flex items-center gap-1", style.cls)}>
                                                        <StatusIcon className="w-3 h-3" /> {style.label}
                                                    </span>
                                                )}
                                                {t.code === "csf" && (
                                                    <span className="text-[10px] text-sky-300 flex items-center gap-1">
                                                        <Sparkles className="w-3 h-3" /> llena RFC, régimen y CP
                                                    </span>
                                                )}
                                            </div>
                                            {t.description && (
                                                <p className="text-[11px] text-neutral-500 mt-0.5">{t.description}</p>
                                            )}
                                        </div>
                                        <button
                                            onClick={() => pickFile(t.code, t.has_expiry)}
                                            disabled={busyType === t.code}
                                            className="text-xs px-3 py-1.5 rounded-lg border border-neutral-700 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 flex items-center gap-1.5 disabled:opacity-50">
                                            {busyType === t.code
                                                ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                                : <Upload className="w-3.5 h-3.5" />}
                                            {docs.length > 0 && !t.allows_multiple ? "Reemplazar" : "Subir"}
                                        </button>
                                    </div>

                                    {docs.map(d => (
                                        <div key={d.id} className="flex items-center justify-between gap-2 mt-2 pl-3 border-l-2 border-neutral-700/50">
                                            <div className="min-w-0 text-xs text-neutral-400 truncate">
                                                <span className="text-neutral-300">{d.file_name}</span>
                                                {d.expires_at && <span className="ml-2">vence {d.expires_at}</span>}
                                                {d.source === "generated" && (
                                                    <span className="ml-2 text-[10px] uppercase text-sky-400">generado</span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-1 flex-shrink-0">
                                                <button onClick={() => openDoc(d.id, false)} title="Ver"
                                                    className="p-1.5 rounded-lg hover:bg-neutral-700 text-neutral-400 hover:text-white">
                                                    <Eye className="w-3.5 h-3.5" />
                                                </button>
                                                <button onClick={() => openDoc(d.id, true)} title="Descargar"
                                                    className="p-1.5 rounded-lg hover:bg-neutral-700 text-neutral-400 hover:text-white">
                                                    <Download className="w-3.5 h-3.5" />
                                                </button>
                                                <button onClick={() => removeDoc(d.id, d.file_name)} title="Borrar"
                                                    className="p-1.5 rounded-lg hover:bg-rose-500/20 text-neutral-400 hover:text-rose-300">
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
}
