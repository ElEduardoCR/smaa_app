"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
    ArrowLeft, Receipt, Save, CheckCircle2, X, Upload, FileText, RefreshCw,
    Calculator, AlertCircle, Download, Trash2, ExternalLink
} from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

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
};

export default function DeclarationDetailPage() {
    const params = useParams();
    const id = params?.id as string;

    const [dec, setDec] = useState<Declaration | null>(null);
    const [iva, setIva] = useState<any>(null);
    const [isr, setIsr] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState<{ type: "error" | "success" | "info"; text: string } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const load = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase.from("monthly_declarations").select("*").eq("id", id).single();
            if (error) throw error;
            setDec(data);

            if (data.declaration_type === "IVA") {
                const { data: ivaData } = await supabase.from("declaration_iva").select("*").eq("declaration_id", id).maybeSingle();
                setIva(ivaData);
            } else if (data.declaration_type === "ISR_PROVISIONAL") {
                const { data: isrData } = await supabase.from("declaration_isr").select("*").eq("declaration_id", id).maybeSingle();
                setIsr(isrData);
            }
        } catch (e: any) { setMsg({ type: "error", text: e?.message || "Error" }); }
        finally { setLoading(false); }
    };
    useEffect(() => { if (id) load(); }, [id]);

    const flash = (type: "error" | "success" | "info", text: string) => {
        setMsg({ type, text });
        setTimeout(() => setMsg(null), 3500);
    };

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
            // Recalcular total a pagar
            const ivaCobrado = Number(patch.iva_cobrado_16 || 0) + Number(patch.iva_cobrado_8 || 0) + Number(patch.iva_cobrado_0 || 0);
            const ivaAcreditable = Number(patch.iva_acreditable_16 || 0) + Number(patch.iva_acreditable_8 || 0) + Number(patch.iva_acreditable_0 || 0);
            const saldoFavAnt = Number(patch.saldo_a_favor_anterior || 0);
            const ivaAPagar = Math.max(0, ivaCobrado - ivaAcreditable - saldoFavAnt);
            const saldoFavNuevo = Math.max(0, ivaAcreditable + saldoFavAnt - ivaCobrado);
            const finalPatch = { ...patch, iva_cobrado_total: ivaCobrado, iva_acreditable_total: ivaAcreditable, iva_a_pagar: ivaAPagar, saldo_a_favor_nuevo: saldoFavNuevo };
            const { error } = await supabase.from("declaration_iva").update(finalPatch).eq("declaration_id", id);
            if (error) throw error;
            // Actualizar totales en la declaración
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

    const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        if (!f) return;
        setBusy(true);
        try {
            const path = `declarations/${dec?.declaration_type}/${dec?.period}_${Date.now()}_${f.name}`;
            const { error: upErr } = await supabase.storage.from("finance_files").upload(path, f, { cacheControl: "3600", upsert: false, contentType: f.type });
            if (upErr) throw upErr;
            const { data } = supabase.storage.from("finance_files").getPublicUrl(path);
            await supabase.from("monthly_declarations").update({ pdf_url: data.publicUrl, pdf_file_name: f.name }).eq("id", id);
            flash("success", "Acuse del SAT guardado.");
            await load();
        } catch (e: any) { flash("error", e?.message || "Error al subir."); }
        finally {
            setBusy(false);
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
                        {msg.type === "error" ? <AlertCircle className="w-4 h-4" /> : msg.type === "success" ? <CheckCircle2 className="w-4 h-4" /> : <Calculator className="w-4 h-4" />} {msg.text}
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

                {/* Detalle según tipo */}
                {dec.declaration_type === "IVA" && iva && (
                    <IvaForm iva={iva} onSave={saveIva} busy={busy} />
                )}
                {dec.declaration_type === "ISR_PROVISIONAL" && (
                    <IsrForm isr={isr} onSave={saveIsr} busy={busy} period={dec.period} />
                )}

                {/* Archivo adjunto */}
                <div className="bg-neutral-800/40 p-5 rounded-2xl border border-neutral-700/50">
                    <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
                        <FileText className="w-4 h-4 text-rose-400" /> Acuse del SAT
                    </h3>
                    {dec.pdf_url ? (
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
                    ) : (
                        <label className="text-sm flex items-center justify-center gap-2 text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 px-4 py-3 rounded-lg border border-rose-500/20 cursor-pointer transition-colors">
                            {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                            Subir acuse del SAT (PDF o imagen)
                            <input ref={fileInputRef} type="file" accept=".pdf,image/*" className="hidden" onChange={handlePdfUpload} disabled={busy} />
                        </label>
                    )}
                </div>
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
            <h3 className="text-sm font-semibold text-emerald-200 flex items-center gap-2"><Calculator className="w-4 h-4" /> Cálculo de IVA</h3>
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
