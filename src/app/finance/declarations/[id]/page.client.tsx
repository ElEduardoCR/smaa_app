"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
    ArrowLeft, Receipt, Save, CheckCircle2, X, Upload, FileText, RefreshCw,
    Calculator, AlertCircle, Download, Trash2, ExternalLink, ScanLine,
    Loader2, Sparkles, ArrowRight, CheckCircle
} from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";
import { extractAndParseAcuse, buildComparison, ComparisonRow, ExtractedAcuse } from "@/lib/satAcuseParser";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

const fmt = (n: number | null | undefined) =>
    `$${(Number(n) || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const monthLabel = (period: string) => {
    const [y, m] = period.split("-");
    const meses = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    return `${meses[parseInt(m, 10) - 1] || m} ${y}`;
};

const TYPE_LABEL: Record<string, string> = { IVA: "IVA", ISR_PROVISIONAL: "ISR Provisional", DIOT: "DIOT", ANUAL: "Anual" };

type Declaration = {
    id: string; period: string; declaration_type: string; status: string;
    due_date: string | null; filed_at: string | null; paid_at: string | null;
    folio_sat: string | null; total_to_pay: number; in_favor: number;
    pdf_url: string | null; pdf_file_name: string | null; notes: string | null;
    sat_folio: string | null; sat_iva_a_pagar: number | null; sat_isr_a_pagar: number | null;
    sat_iva_a_favor: number | null; sat_iva_cobrado: number | null; sat_iva_acreditable: number | null;
    sat_ingresos_nominales: number | null; sat_deducciones_autorizadas: number | null;
    sat_filing_date: string | null; sat_due_date: string | null; sat_cantidad_a_pagar: number | null;
    sat_linea_captura: string | null; sat_tipo_declaracion: string | null;
    sat_periodo: string | null; sat_raw_text: string | null; extracted_data: any;
    comparison_diff_iva: number | null; comparison_diff_isr: number | null;
    comparison_diff_pct: number | null; comparison_notes: string | null;
};

export default function DeclarationDetailPage() {
    const params = useParams();
    const id = params?.id as string;

    const [dec, setDec] = useState<Declaration | null>(null);
    const [iva, setIva] = useState<any>(null);
    const [isr, setIsr] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [extracting, setExtracting] = useState(false);
    const [extractionProgress, setExtractionProgress] = useState("");
    const [msg, setMsg] = useState<{ type: "error" | "success" | "info"; text: string } | null>(null);
    const [comparison, setComparison] = useState<ComparisonRow[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const flash = (type: "error" | "success" | "info", text: string) => {
        setMsg({ type, text });
        setTimeout(() => setMsg(null), 5000);
    };

    const load = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase.from("monthly_declarations").select("*").eq("id", id).single();
            if (error) throw error;
            setDec(data);

            let ours = { iva_a_pagar: 0, isr_a_pagar: 0, iva_cobrado_total: 0, iva_acreditable_total: 0 };

            if (data.declaration_type === "IVA") {
                const { data: ivaData } = await supabase.from("declaration_iva").select("*").eq("declaration_id", id).maybeSingle();
                setIva(ivaData);
                ours = {
                    iva_a_pagar: Number(ivaData?.iva_a_pagar || data.total_to_pay || 0),
                    isr_a_pagar: 0,
                    iva_cobrado_total: Number(ivaData?.iva_cobrado_total || 0),
                    iva_acreditable_total: Number(ivaData?.iva_acreditable_total || 0),
                };
            } else if (data.declaration_type === "ISR_PROVISIONAL") {
                const { data: isrData } = await supabase.from("declaration_isr").select("*").eq("declaration_id", id).maybeSingle();
                setIsr(isrData);
                ours = {
                    iva_a_pagar: 0,
                    isr_a_pagar: Number(isrData?.isr_a_pagar || data.total_to_pay || 0),
                    iva_cobrado_total: 0,
                    iva_acreditable_total: 0,
                };
            } else {
                // For other types, use total_to_pay as a proxy
                ours.iva_a_pagar = data.declaration_type === "IVA" ? Number(data.total_to_pay || 0) : 0;
                ours.isr_a_pagar = data.declaration_type === "ISR_PROVISIONAL" ? Number(data.total_to_pay || 0) : 0;
            }

            // Build comparison if we have SAT data
            if (data.sat_iva_a_pagar !== null || data.sat_isr_a_pagar !== null || data.sat_cantidad_a_pagar !== null) {
                const fakeSat: ExtractedAcuse = {
                    raw_text: data.sat_raw_text || "",
                    sat_folio: data.sat_folio,
                    sat_tipo_declaracion: data.sat_tipo_declaracion,
                    sat_periodo: data.sat_periodo,
                    sat_filing_date: data.sat_filing_date,
                    sat_due_date: data.sat_due_date,
                    sat_iva_a_pagar: data.sat_iva_a_pagar,
                    sat_iva_a_favor: data.sat_iva_a_favor,
                    sat_isr_a_pagar: data.sat_isr_a_pagar,
                    sat_iva_cobrado: data.sat_iva_cobrado,
                    sat_iva_acreditable: data.sat_iva_acreditable,
                    sat_ingresos_nominales: data.sat_ingresos_nominales,
                    sat_deducciones_autorizadas: data.sat_deducciones_autorizadas,
                    sat_cantidad_a_pagar: data.sat_cantidad_a_pagar,
                    sat_linea_captura: data.sat_linea_captura,
                    rfc: null,
                    razon_social: null,
                };
                setComparison(buildComparison(ours, fakeSat));
            } else {
                setComparison([]);
            }
        } catch (e: any) { setMsg({ type: "error", text: e?.message || "Error" }); }
        finally { setLoading(false); }
    };
    useEffect(() => { if (id) load(); }, [id]);

    const updateDec = async (patch: Partial<Declaration>) => {
        setBusy(true);
        try {
            const { error } = await supabase.from("monthly_declarations").update(patch).eq("id", id);
            if (error) throw error;
            await load();
            flash("success", "Declaración actualizada.");
        } catch (e: any) { flash("error", e?.message || "Error."); }
        finally { setBusy(false); }
    };

    const saveIva = async (patch: any) => {
        setBusy(true);
        try {
            const ivaCobrado = Number(patch.iva_cobrado_16 || 0) + Number(patch.iva_cobrado_8 || 0) + Number(patch.iva_cobrado_0 || 0);
            const ivaAcreditable = Number(patch.iva_acreditable_16 || 0) + Number(patch.iva_acreditable_8 || 0) + Number(patch.iva_acreditable_0 || 0);
            const saldoFavAnt = Number(patch.saldo_a_favor_anterior || 0);
            const ivaAPagar = Math.max(0, ivaCobrado - ivaAcreditable - saldoFavAnt);
            const saldoFavNuevo = Math.max(0, ivaAcreditable + saldoFavAnt - ivaCobrado);
            const finalPatch = { ...patch, iva_cobrado_total: ivaCobrado, iva_acreditable_total: ivaAcreditable, iva_a_pagar: ivaAPagar, saldo_a_favor_nuevo: saldoFavNuevo };
            const { error } = await supabase.from("declaration_iva").update(finalPatch).eq("declaration_id", id);
            if (error) throw error;
            await supabase.from("monthly_declarations").update({ total_to_pay: ivaAPagar, in_favor: saldoFavNuevo }).eq("id", id);
            await load();
            flash("success", "IVA recalculado.");
        } catch (e: any) { flash("error", e?.message || "Error."); }
        finally { setBusy(false); }
    };

    const saveIsr = async (patch: any) => {
        setBusy(true);
        try {
            const ingresos = Number(patch.ingresos_nominales || 0);
            const deducciones = Number(patch.deducciones_autorizadas || 0);
            const utilidad = ingresos - deducciones;
            const tasa = Number(patch.tasa_isr || 0);
            const isrCausado = utilidad * tasa;
            const pagosAnt = Number(patch.pagos_provisionales_anteriores || 0);
            const isrAPagar = Math.max(0, isrCausado - pagosAnt);
            const finalPatch = { ...patch, ingresos_acumulables: ingresos, utilidad_fiscal: utilidad, isr_causado: isrCausado, isr_a_pagar: isrAPagar };
            const { error } = await supabase.from("declaration_isr").update(finalPatch).eq("declaration_id", id);
            if (error) throw error;
            await supabase.from("monthly_declarations").update({ total_to_pay: isrAPagar }).eq("id", id);
            await load();
            flash("success", "ISR recalculado.");
        } catch (e: any) { flash("error", e?.message || "Error."); }
        finally { setBusy(false); }
    };

    // Auto-refresh from monthly_iva_summary
    const refreshFromInvoices = async () => {
        if (!dec || dec.declaration_type !== "IVA") return;
        setBusy(true);
        try {
            const { data: sum } = await supabase
                .from("monthly_iva_summary")
                .select("*")
                .eq("period", dec.period)
                .maybeSingle();
            if (!sum) { flash("info", "Aún no hay movimientos para este periodo."); setBusy(false); return; }
            const saldoFavAnt = iva?.saldo_a_favor_anterior || 0;
            const ivaAPagar = Math.max(0, Number(sum.iva_cobrado_total) - Number(sum.iva_acreditable_total) - Number(saldoFavAnt));
            const saldoFavNuevo = Math.max(0, Number(sum.iva_acreditable_total) + Number(saldoFavAnt) - Number(sum.iva_cobrado_total));
            const patch = {
                iva_cobrado_16: Number(sum.iva_cobrado_16) || 0,
                iva_cobrado_8: Number(sum.iva_cobrado_8) || 0,
                iva_cobrado_0: Number(sum.iva_cobrado_0) || 0,
                iva_cobrado_total: Number(sum.iva_cobrado_total) || 0,
                iva_acreditable_16: Number(sum.iva_acreditable_16) || 0,
                iva_acreditable_8: Number(sum.iva_acreditable_8) || 0,
                iva_acreditable_0: Number(sum.iva_acreditable_0) || 0,
                iva_acreditable_total: Number(sum.iva_acreditable_total) || 0,
                ingresos_gravados_16: Number(sum.total_ventas_gravadas) || 0,
                deducciones_gravadas_16: Number(sum.total_compras_gravadas) || 0,
                iva_a_pagar: ivaAPagar,
                saldo_a_favor_nuevo: saldoFavNuevo,
            };
            const { error } = await supabase.from("declaration_iva").update(patch).eq("declaration_id", id);
            if (error) throw error;
            await supabase.from("monthly_declarations").update({ total_to_pay: ivaAPagar, in_favor: saldoFavNuevo }).eq("id", id);
            await load();
            flash("success", `Refrescado: ${sum.invoice_count_sales} ventas + ${sum.invoice_count_purchases} compras`);
        } catch (e: any) { flash("error", e?.message || "Error al refrescar."); }
        finally { setBusy(false); }
    };

    const handleAcuseUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        if (!f) return;
        setExtracting(true);
        setExtractionProgress("Subiendo archivo…");
        try {
            // 1) Upload
            const path = `declarations/${dec?.declaration_type}/${dec?.period}_${Date.now()}_${f.name}`;
            const { error: upErr } = await supabase.storage.from("finance_files").upload(path, f, { cacheControl: "3600", upsert: false, contentType: f.type });
            if (upErr) throw upErr;
            const { data: urlData } = supabase.storage.from("finance_files").getPublicUrl(path);

            // 2) Extract + parse
            setExtractionProgress("Extrayendo texto del acuse…");
            const extracted = await extractAndParseAcuse(f);

            // 3) Compute diff vs ours
            let diffIva: number | null = null;
            let diffIsr: number | null = null;
            let diffPct: number | null = null;
            const satIva = extracted.sat_iva_a_pagar ?? extracted.sat_cantidad_a_pagar;
            const satIsr = extracted.sat_isr_a_pagar;
            if (dec?.declaration_type === "IVA" && satIva != null) {
                const ourIva = Number(dec.total_to_pay || 0);
                diffIva = satIva - ourIva;
                diffPct = ourIva !== 0 ? (diffIva / ourIva) * 100 : null;
            }
            if (dec?.declaration_type === "ISR_PROVISIONAL" && satIsr != null) {
                const ourIsr = Number(dec.total_to_pay || 0);
                diffIsr = satIsr - ourIsr;
            }

            // 4) Save extracted + diff + auto-fill some fields
            const update: any = {
                pdf_url: urlData.publicUrl,
                pdf_file_name: f.name,
                extracted_data: extracted,
                sat_raw_text: extracted.raw_text,
                sat_folio: extracted.sat_folio,
                sat_tipo_declaracion: extracted.sat_tipo_declaracion,
                sat_periodo: extracted.sat_periodo,
                sat_filing_date: extracted.sat_filing_date,
                sat_due_date: extracted.sat_due_date,
                sat_cantidad_a_pagar: extracted.sat_cantidad_a_pagar,
                sat_iva_a_pagar: extracted.sat_iva_a_pagar,
                sat_iva_a_favor: extracted.sat_iva_a_favor,
                sat_isr_a_pagar: extracted.sat_isr_a_pagar,
                sat_iva_cobrado: extracted.sat_iva_cobrado,
                sat_iva_acreditable: extracted.sat_iva_acreditable,
                sat_ingresos_nominales: extracted.sat_ingresos_nominales,
                sat_deducciones_autorizadas: extracted.sat_deducciones_autorizadas,
                sat_linea_captura: extracted.sat_linea_captura,
                comparison_diff_iva: diffIva,
                comparison_diff_isr: diffIsr,
                comparison_diff_pct: diffPct,
            };
            // Auto-fill visible fields if currently empty
            if (!dec?.folio_sat && extracted.sat_folio) update.folio_sat = extracted.sat_folio;
            if (!dec?.filed_at && extracted.sat_filing_date) update.filed_at = extracted.sat_filing_date;
            if (!dec?.due_date && extracted.sat_due_date) update.due_date = extracted.sat_due_date;

            // Mark as filed automatically
            if (dec?.status === "draft") {
                update.status = "filed";
                if (!dec.filed_at && extracted.sat_filing_date) update.filed_at = extracted.sat_filing_date;
            }

            const { error: updErr } = await supabase.from("monthly_declarations").update(update).eq("id", id);
            if (updErr) throw updErr;

            flash("success", `Acuse procesado. ${extracted.sat_folio ? `Folio: ${extracted.sat_folio}.` : ""} ${diffIva != null ? `Diferencia IVA: ${fmt(diffIva)}.` : ""}`);
            await load();
        } catch (e: any) {
            flash("error", e?.message || "Error al procesar el acuse.");
        } finally {
            setExtracting(false);
            setExtractionProgress("");
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const removePdf = async () => {
        if (!dec?.pdf_url) return;
        if (!confirm("¿Eliminar el archivo del acuse?")) return;
        await supabase.from("monthly_declarations").update({ pdf_url: null, pdf_file_name: null }).eq("id", id);
        load();
    };

    if (loading) return <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center"><RefreshCw className="w-8 h-8 animate-spin text-rose-400" /></div>;
    if (!dec) return <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 flex items-center justify-center">Declaración no encontrada.</div>;

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-6 md:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-5xl mx-auto space-y-6">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50">
                    <div className="flex items-center gap-4">
                        <Link href="/finance/declarations" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl text-neutral-400 hover:text-white border border-neutral-700">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div>
                            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                                <Receipt className="w-6 h-6 text-rose-400" />
                                {TYPE_LABEL[dec.declaration_type]} · {monthLabel(dec.period)}
                            </h1>
                            <p className="text-xs text-neutral-500 mt-0.5 uppercase">Estatus: <span className="text-rose-300 font-semibold">{dec.status}</span></p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        {dec.status === "draft" && (
                            <button onClick={() => updateDec({ status: "filed", filed_at: new Date().toISOString() })} className="text-sm bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg font-semibold flex items-center gap-1.5">
                                <CheckCircle2 className="w-4 h-4" /> Marcar como presentada
                            </button>
                        )}
                        {dec.status === "filed" && (
                            <button onClick={() => updateDec({ status: "paid", paid_at: new Date().toISOString() })} className="text-sm bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg font-semibold flex items-center gap-1.5">
                                <CheckCircle2 className="w-4 h-4" /> Marcar como pagada
                            </button>
                        )}
                    </div>
                </header>

                {msg && (
                    <div className={cn("p-3 rounded-xl border flex items-center gap-2",
                        msg.type === "error" ? "bg-red-500/10 border-red-500/30 text-red-300" :
                        msg.type === "success" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" :
                        "bg-sky-500/10 border-sky-500/30 text-sky-300"
                    )}>
                        {msg.type === "error" ? <AlertCircle className="w-4 h-4" /> : msg.type === "success" ? <CheckCircle2 className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />} {msg.text}
                    </div>
                )}

                {/* Acuse + extracción SAT */}
                <div className="bg-neutral-800/40 p-5 rounded-2xl border border-neutral-700/50">
                    <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
                        <ScanLine className="w-4 h-4 text-rose-400" /> Acuse del SAT (auto-extracción)
                    </h3>
                    {extracting ? (
                        <div className="bg-sky-500/10 border border-sky-500/30 rounded-xl p-4 flex items-center gap-3">
                            <Loader2 className="w-5 h-5 animate-spin text-sky-300" />
                            <div>
                                <p className="text-sm text-sky-200 font-medium">Procesando acuse…</p>
                                <p className="text-xs text-sky-300/80">{extractionProgress}</p>
                            </div>
                        </div>
                    ) : dec.pdf_url ? (
                        <div className="space-y-2">
                            <div className="flex items-center gap-3 bg-neutral-900/40 p-3 rounded-xl border border-neutral-700/50">
                                <FileText className="w-8 h-8 text-rose-400 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm text-white truncate">{dec.pdf_file_name || "Acuse.pdf"}</p>
                                    <a href={dec.pdf_url} target="_blank" rel="noopener noreferrer" className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1">
                                        <ExternalLink className="w-3 h-3" /> Abrir en nueva pestaña
                                    </a>
                                </div>
                                <button onClick={removePdf} className="p-1.5 text-neutral-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"><Trash2 className="w-4 h-4" /></button>
                            </div>
                            {dec.sat_folio && (
                                <p className="text-xs text-emerald-300 flex items-center gap-1.5">
                                    <CheckCircle className="w-3.5 h-3.5" /> Folio extraído: <span className="font-mono">{dec.sat_folio}</span>
                                </p>
                            )}
                        </div>
                    ) : (
                        <label className="text-sm flex items-center justify-center gap-2 text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 px-4 py-3 rounded-lg border border-rose-500/20 cursor-pointer transition-colors">
                            <Upload className="w-4 h-4" />
                            Subir acuse del SAT (PDF o imagen) — se extraen folio, periodo, IVA/ISR y se compara
                            <input ref={fileInputRef} type="file" accept=".pdf,image/*" className="hidden" onChange={handleAcuseUpload} disabled={extracting} />
                        </label>
                    )}
                </div>

                {/* Comparación con SAT */}
                {comparison.length > 0 && (
                    <div className="bg-neutral-800/40 p-5 rounded-2xl border border-rose-500/30 space-y-3">
                        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                            <ArrowRight className="w-4 h-4 text-rose-400" /> Comparación: nuestro cálculo vs SAT
                        </h3>
                        {dec.sat_filing_date && (
                            <p className="text-xs text-neutral-400">
                                Presentada el {new Date(dec.sat_filing_date).toLocaleString()} {dec.sat_folio && <>· Folio <span className="font-mono text-rose-300">{dec.sat_folio}</span></>}
                            </p>
                        )}
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-xs text-neutral-400 uppercase tracking-wider border-b border-neutral-700/50">
                                    <th className="text-left py-2">Concepto</th>
                                    <th className="text-right py-2">Nuestro cálculo</th>
                                    <th className="text-right py-2">SAT (extraído)</th>
                                    <th className="text-right py-2">Diferencia</th>
                                    <th className="text-right py-2">%</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-700/30">
                                {comparison.map((r) => {
                                    const significantDiff = r.diff !== null && Math.abs(r.diff) > 1 && Math.abs(r.pct || 0) > 0.5;
                                    return (
                                        <tr key={r.field} className={significantDiff ? "bg-amber-500/5" : ""}>
                                            <td className="py-2 text-neutral-300">{r.label}</td>
                                            <td className="py-2 text-right font-mono text-neutral-200">{r.ours != null ? fmt(r.ours) : "—"}</td>
                                            <td className="py-2 text-right font-mono text-rose-200">{r.sat != null ? fmt(r.sat) : "—"}</td>
                                            <td className={cn("py-2 text-right font-mono font-bold",
                                                r.diff == null ? "text-neutral-500" :
                                                Math.abs(r.diff) < 1 ? "text-emerald-300" :
                                                Math.abs(r.pct || 0) < 5 ? "text-amber-300" : "text-rose-300"
                                            )}>
                                                {r.diff != null ? (r.diff >= 0 ? "+" : "") + fmt(r.diff) : "—"}
                                            </td>
                                            <td className={cn("py-2 text-right font-mono",
                                                r.pct == null ? "text-neutral-500" :
                                                Math.abs(r.pct) < 0.5 ? "text-emerald-300" :
                                                Math.abs(r.pct) < 5 ? "text-amber-300" : "text-rose-300"
                                            )}>
                                                {r.pct != null ? (r.pct >= 0 ? "+" : "") + r.pct.toFixed(2) + "%" : "—"}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        {dec.comparison_diff_pct !== null && Math.abs(dec.comparison_diff_pct) > 0.5 && (
                            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-xs text-amber-200 space-y-1">
                                <p className="font-semibold flex items-center gap-1.5">
                                    <AlertCircle className="w-3.5 h-3.5" /> Diferencia significativa detectada
                                </p>
                                <p>
                                    Hay un {dec.comparison_diff_pct.toFixed(2)}% de diferencia entre nuestro cálculo y el SAT.
                                    Esto puede deberse a: facturas no clasificadas como gravadas/exentas, ajustes manuales,
                                    retenciones no consideradas, o créditos fiscales aplicados en el SAT.
                                </p>
                                <textarea
                                    placeholder="Notas de la diferencia (opcional)…"
                                    defaultValue={dec.comparison_notes || ""}
                                    onBlur={(e) => updateDec({ comparison_notes: e.target.value || null })}
                                    className="w-full mt-2 bg-neutral-900/50 border border-amber-500/30 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-amber-500 min-h-[50px]"
                                />
                            </div>
                        )}
                    </div>
                )}

                {/* Datos administrativos */}
                <div className="bg-neutral-800/40 p-5 rounded-2xl border border-neutral-700/50">
                    <h3 className="text-sm font-semibold text-white mb-3">Datos administrativos</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                            <label className="text-xs text-neutral-400">Fecha límite de pago</label>
                            <input type="date" defaultValue={dec.due_date || ""} onBlur={e => updateDec({ due_date: e.target.value || null })} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-rose-500" />
                        </div>
                        <div>
                            <label className="text-xs text-neutral-400">Folio del acuse (SAT)</label>
                            <input defaultValue={dec.folio_sat || ""} onBlur={e => updateDec({ folio_sat: e.target.value || null })} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-rose-500" />
                        </div>
                        <div>
                            <label className="text-xs text-neutral-400">Notas</label>
                            <input defaultValue={dec.notes || ""} onBlur={e => updateDec({ notes: e.target.value || null })} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-rose-500" />
                        </div>
                    </div>
                </div>

                {/* IVA form (with refresh button) */}
                {dec.declaration_type === "IVA" && iva && (
                    <div className="space-y-3">
                        <div className="flex justify-between items-center">
                            <h3 className="text-sm font-semibold text-emerald-200">Cálculo de IVA</h3>
                            <button onClick={refreshFromInvoices} disabled={busy} className="text-xs bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 px-3 py-1.5 rounded-lg border border-cyan-500/20 flex items-center gap-1.5">
                                <RefreshCw className={cn("w-3.5 h-3.5", busy && "animate-spin")} /> Refrescar desde facturas
                            </button>
                        </div>
                        <IvaForm iva={iva} onSave={saveIva} busy={busy} />
                    </div>
                )}
                {dec.declaration_type === "ISR_PROVISIONAL" && (
                    <IsrForm isr={isr} onSave={saveIsr} busy={busy} period={dec.period} />
                )}
            </div>
        </div>
    );
}

function IvaForm({ iva, onSave, busy }: any) {
    const [data, setData] = useState(iva);
    useEffect(() => setData(iva), [iva]);

    const update = (k: string, v: any) => setData((d: any) => ({ ...d, [k]: v }));
    return (
        <div className="bg-neutral-800/40 p-5 rounded-2xl border border-emerald-500/30 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                    <h4 className="text-xs uppercase tracking-wider text-emerald-300 mb-2">IVA cobrado (ventas)</h4>
                    <Field label="IVA 16%" value={data.iva_cobrado_16 || 0} onChange={(v: number) => update("iva_cobrado_16", v)} />
                    <Field label="IVA 8% (frontera)" value={data.iva_cobrado_8 || 0} onChange={(v: number) => update("iva_cobrado_8", v)} />
                    <Field label="IVA 0% / exento" value={data.iva_cobrado_0 || 0} onChange={(v: number) => update("iva_cobrado_0", v)} />
                    <Field label="Ingresos gravados 16%" value={data.ingresos_gravados_16 || 0} onChange={(v: number) => update("ingresos_gravados_16", v)} />
                </div>
                <div>
                    <h4 className="text-xs uppercase tracking-wider text-amber-300 mb-2">IVA acreditable (compras)</h4>
                    <Field label="IVA 16%" value={data.iva_acreditable_16 || 0} onChange={(v: number) => update("iva_acreditable_16", v)} />
                    <Field label="IVA 8% (frontera)" value={data.iva_acreditable_8 || 0} onChange={(v: number) => update("iva_acreditable_8", v)} />
                    <Field label="IVA 0% / exento" value={data.iva_acreditable_0 || 0} onChange={(v: number) => update("iva_acreditable_0", v)} />
                    <Field label="Deducciones gravadas 16%" value={data.deducciones_gravadas_16 || 0} onChange={(v: number) => update("deducciones_gravadas_16", v)} />
                </div>
            </div>
            <Field label="Saldo a favor del periodo anterior" value={data.saldo_a_favor_anterior || 0} onChange={(v: number) => update("saldo_a_favor_anterior", v)} />
            <div className="grid grid-cols-2 gap-3">
                <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3">
                    <p className="text-xs uppercase text-rose-300">IVA a pagar</p>
                    <p className="text-2xl font-bold text-rose-200 font-mono">{fmt(data.iva_a_pagar)}</p>
                </div>
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3">
                    <p className="text-xs uppercase text-emerald-300">Saldo a favor nuevo</p>
                    <p className="text-2xl font-bold text-emerald-200 font-mono">{fmt(data.saldo_a_favor_nuevo)}</p>
                </div>
            </div>
            <div className="flex justify-end">
                <button onClick={() => onSave(data)} disabled={busy} className="bg-emerald-500 hover:bg-emerald-600 text-white px-5 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50">
                    {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar y recalcular
                </button>
            </div>
        </div>
    );
}

function IsrForm({ isr, onSave, busy, period }: any) {
    const [data, setData] = useState(isr || {});
    useEffect(() => setData(isr || {}), [isr]);
    const update = (k: string, v: any) => setData((d: any) => ({ ...d, [k]: v }));
    return (
        <div className="bg-neutral-800/40 p-5 rounded-2xl border border-amber-500/30 space-y-4">
            <h3 className="text-sm font-semibold text-amber-200 flex items-center gap-2"><Calculator className="w-4 h-4" /> Cálculo ISR Provisional — {period}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                    <Field label="Ingresos nominales del mes" value={data.ingresos_nominales || 0} onChange={(v: number) => update("ingresos_nominales", v)} />
                    <Field label="Deducciones autorizadas" value={data.deducciones_autorizadas || 0} onChange={(v: number) => update("deducciones_autorizadas", v)} />
                    <Field label="Pagos provisionales anteriores" value={data.pagos_provisionales_anteriores || 0} onChange={(v: number) => update("pagos_provisionales_anteriores", v)} />
                </div>
                <div>
                    <Field label="Coeficiente de utilidad" value={data.coeficiente_utilidad || 0} onChange={(v: number) => update("coeficiente_utilidad", v)} step="0.0001" />
                    <div>
                        <label className="text-xs text-neutral-400">Tasa ISR (decimal, ej 0.0125 = 1.25%)</label>
                        <input type="number" step="0.0001" value={data.tasa_isr || 0.0125} onChange={e => update("tasa_isr", Number(e.target.value))} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500" />
                    </div>
                    <div>
                        <label className="text-xs text-neutral-400">Régimen</label>
                        <select value={data.regimen || "general"} onChange={e => update("regimen", e.target.value)} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500">
                            <option value="general">Régimen General</option>
                            <option value="resico">RESICO</option>
                            <option value="plataformas">Plataformas Tecnológicas</option>
                        </select>
                    </div>
                </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
                <div className="bg-sky-500/10 border border-sky-500/30 rounded-xl p-3">
                    <p className="text-xs uppercase text-sky-300">Utilidad fiscal</p>
                    <p className="text-xl font-bold text-sky-200 font-mono">{fmt(data.utilidad_fiscal)}</p>
                </div>
                <div className="bg-violet-500/10 border border-violet-500/30 rounded-xl p-3">
                    <p className="text-xs uppercase text-violet-300">ISR causado</p>
                    <p className="text-xl font-bold text-violet-200 font-mono">{fmt(data.isr_causado)}</p>
                </div>
                <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3">
                    <p className="text-xs uppercase text-rose-300">ISR a pagar</p>
                    <p className="text-xl font-bold text-rose-200 font-mono">{fmt(data.isr_a_pagar)}</p>
                </div>
            </div>
            <div className="flex justify-end">
                <button onClick={() => onSave(data)} disabled={busy} className="bg-amber-500 hover:bg-amber-600 text-white px-5 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50">
                    {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar y recalcular
                </button>
            </div>
        </div>
    );
}

function Field({ label, value, onChange, step = "0.01" }: any) {
    return (
        <div className="mb-2">
            <label className="text-xs text-neutral-400">{label}</label>
            <input type="number" step={step} defaultValue={value} onBlur={e => onChange(Number(e.target.value))} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500 font-mono" />
        </div>
    );
}
