"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
    ArrowLeft, Receipt, Plus, RefreshCw, Eye, Calendar, CheckCircle2, X, FileText, AlertTriangle, Upload, Loader2
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

const STATUS_STYLE: Record<string, string> = {
    draft: "bg-neutral-500/10 text-neutral-300 border-neutral-500/30",
    filed: "bg-amber-500/10 text-amber-300 border-amber-500/30",
    paid: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
    complement: "bg-sky-500/10 text-sky-300 border-sky-500/30",
};
const STATUS_LABEL: Record<string, string> = {
    draft: "Borrador", filed: "Presentada", paid: "Pagada", complement: "Complemento",
};

const TYPE_LABEL: Record<string, string> = {
    IVA: "IVA",
    ISR_PROVISIONAL: "ISR Provisional",
    DIOT: "DIOT",
    ANUAL: "Anual",
};

const TYPE_ICON_COLOR: Record<string, string> = {
    IVA: "bg-emerald-500/10 text-emerald-300",
    ISR_PROVISIONAL: "bg-amber-500/10 text-amber-300",
    DIOT: "bg-sky-500/10 text-sky-300",
    ANUAL: "bg-rose-500/10 text-rose-300",
};

type Declaration = {
    id: string; period: string; declaration_type: string; status: string;
    due_date: string | null; filed_at: string | null; paid_at: string | null;
    folio_sat: string | null; total_to_pay: number; in_favor: number;
    pdf_url: string | null; pdf_file_name: string | null; notes: string | null;
    created_at: string;
};

export default function DeclarationsPage() {
    const [declarations, setDeclarations] = useState<Declaration[]>([]);
    const [loading, setLoading] = useState(true);
    const [showNew, setShowNew] = useState(false);
    const [busy, setBusy] = useState(false);
    const [filter, setFilter] = useState<"all" | "IVA" | "ISR_PROVISIONAL" | "DIOT">("all");
    const [msg, setMsg] = useState<{ type: "error" | "success"; text: string } | null>(null);
    const [newDec, setNewDec] = useState({
        period: new Date().toISOString().slice(0, 7),
        declaration_type: "IVA",
        due_date: "",
        notes: "",
    });

    const load = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from("monthly_declarations")
                .select("*")
                .order("period", { ascending: false })
                .order("declaration_type", { ascending: true });
            if (error) throw error;
            setDeclarations(data || []);
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);

    const flash = (type: "error" | "success", text: string) => {
        setMsg({ type, text });
        setTimeout(() => setMsg(null), 3500);
    };

    const createDeclaration = async () => {
        if (!newDec.period || !newDec.declaration_type) { flash("error", "Periodo y tipo requeridos."); return; }
        setBusy(true);
        try {
            // Si es IVA, intentar pre-llenar desde facturas
            let total_to_pay = 0, in_favor = 0;
            if (newDec.declaration_type === "IVA") {
                const { data: sales } = await supabase.from("v_monthly_sales_iva").select("*").eq("period", newDec.period).single();
                const { data: purchases } = await supabase.from("v_monthly_purchases_iva").select("*").eq("period", newDec.period).single();
                const ivaCobrado = sales?.iva_cobrado || 0;
                const ivaAcreditable = purchases?.iva || 0;
                const iva_a_pagar = Math.max(0, ivaCobrado - ivaAcreditable);
                in_favor = Math.max(0, ivaAcreditable - ivaCobrado);
                total_to_pay = iva_a_pagar;

                const { data: dec, error } = await supabase.from("monthly_declarations").insert([{
                    period: newDec.period,
                    declaration_type: newDec.declaration_type,
                    due_date: newDec.due_date || null,
                    status: "draft",
                    total_to_pay,
                    in_favor,
                    notes: newDec.notes || null,
                }]).select().single();
                if (error) throw error;

                // Crear detalle IVA con datos pre-llenados
                await supabase.from("declaration_iva").insert([{
                    declaration_id: dec.id,
                    iva_cobrado_16: ivaCobrado,
                    iva_cobrado_total: ivaCobrado,
                    iva_acreditable_16: ivaAcreditable,
                    iva_acreditable_total: ivaAcreditable,
                    ingresos_gravados_16: sales?.ingresos_gravados || 0,
                    deducciones_gravadas_16: purchases?.subtotal || 0,
                    iva_a_pagar,
                    saldo_a_favor_nuevo: in_favor,
                }]);

                flash("success", "Declaración IVA creada con datos pre-llenados.");
                window.location.href = `/finance/declarations/${dec.id}`;
                return;
            } else {
                const { data: dec, error } = await supabase.from("monthly_declarations").insert([{
                    period: newDec.period,
                    declaration_type: newDec.declaration_type,
                    due_date: newDec.due_date || null,
                    status: "draft",
                    notes: newDec.notes || null,
                }]).select().single();
                if (error) throw error;
                flash("success", "Declaración creada.");
                window.location.href = `/finance/declarations/${dec.id}`;
                return;
            }
        } catch (e: any) {
            if (e?.message?.includes("duplicate")) {
                flash("error", "Ya existe una declaración de este tipo para ese periodo. Búscala en la lista.");
            } else {
                flash("error", e?.message || "Error.");
            }
        } finally {
            setBusy(false);
        }
    };

    const del = async (d: Declaration) => {
        if (!confirm(`¿Eliminar la declaración ${TYPE_LABEL[d.declaration_type]} de ${monthLabel(d.period)}?`)) return;
        await supabase.from("monthly_declarations").delete().eq("id", d.id);
        load();
    };

    const filtered = declarations.filter(d => filter === "all" || d.declaration_type === filter);

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-6 md:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-6xl mx-auto space-y-6">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                        <Link href="/finance" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl text-neutral-400 hover:text-white border border-neutral-700">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div>
                            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                                <Receipt className="w-8 h-8 text-rose-400" />
                                Declaraciones mensuales
                            </h1>
                            <p className="text-neutral-400 text-sm mt-1">IVA, ISR provisional, DIOT. Acuses y control de pagos.</p>
                        </div>
                    </div>
                    <button onClick={() => setShowNew(s => !s)} className="flex items-center justify-center gap-2 bg-rose-500 hover:bg-rose-600 text-white px-5 py-3 rounded-xl font-medium transition-all hover:shadow-[0_0_20px_rgba(244,63,94,0.4)] active:scale-95">
                        <Plus className="w-5 h-5" /> Nueva declaración
                    </button>
                </header>

                {msg && (
                    <div className={cn("p-3 rounded-xl border flex items-center gap-2",
                        msg.type === "error" ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                    )}>
                        {msg.type === "error" ? <X className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />} {msg.text}
                    </div>
                )}

                {showNew && (
                    <div className="bg-neutral-800/40 p-5 rounded-2xl border border-rose-500/30 space-y-3">
                        <h3 className="text-sm font-semibold text-white">Nueva declaración</h3>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                            <div>
                                <label className="text-xs text-neutral-400">Periodo (YYYY-MM)</label>
                                <input value={newDec.period} onChange={e => setNewDec({ ...newDec, period: e.target.value })} placeholder="2026-01" className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-rose-500" />
                            </div>
                            <div>
                                <label className="text-xs text-neutral-400">Tipo</label>
                                <select value={newDec.declaration_type} onChange={e => setNewDec({ ...newDec, declaration_type: e.target.value })} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-rose-500">
                                    <option value="IVA">IVA (se pre-llena con ventas/compras)</option>
                                    <option value="ISR_PROVISIONAL">ISR Provisional</option>
                                    <option value="DIOT">DIOT</option>
                                    <option value="ANUAL">Declaración Anual</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-xs text-neutral-400">Fecha límite</label>
                                <input value={newDec.due_date} onChange={e => setNewDec({ ...newDec, due_date: e.target.value })} type="date" className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-rose-500" />
                            </div>
                            <div className="flex items-end gap-2">
                                <button onClick={() => setShowNew(false)} className="text-sm px-4 py-2 rounded-lg text-neutral-300 hover:bg-neutral-700">Cancelar</button>
                                <button onClick={createDeclaration} disabled={busy} className="text-sm bg-rose-500 hover:bg-rose-600 text-white px-5 py-2 rounded-lg font-semibold flex items-center gap-1.5 disabled:opacity-50 flex-1 justify-center">
                                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Crear
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                <div className="flex items-center gap-2 flex-wrap">
                    {["all", "IVA", "ISR_PROVISIONAL", "DIOT"].map(f => (
                        <button key={f} onClick={() => setFilter(f as any)} className={cn(
                            "text-xs px-3 py-1.5 rounded-full border transition-colors",
                            filter === f ? "bg-white/10 text-white border-white/20" : "bg-neutral-800/40 text-neutral-400 border-neutral-700/50 hover:bg-neutral-800"
                        )}>
                            {f === "all" ? "Todos" : TYPE_LABEL[f]} ({f === "all" ? declarations.length : declarations.filter(d => d.declaration_type === f).length})
                        </button>
                    ))}
                </div>

                <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-neutral-900/50 text-neutral-400 uppercase text-xs font-semibold tracking-wider">
                                <tr>
                                    <th className="px-6 py-4 rounded-tl-xl">Periodo</th>
                                    <th className="px-6 py-4">Tipo</th>
                                    <th className="px-6 py-4">Estatus</th>
                                    <th className="px-6 py-4">Vence</th>
                                    <th className="px-6 py-4">Folio SAT</th>
                                    <th className="px-6 py-4 text-right">A pagar</th>
                                    <th className="px-6 py-4 text-right">A favor</th>
                                    <th className="px-6 py-4 rounded-tr-xl text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-700/50">
                                {loading ? (
                                    <tr><td colSpan={8} className="px-6 py-12 text-center text-neutral-400"><RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-rose-500" /> Cargando…</td></tr>
                                ) : filtered.length === 0 ? (
                                    <tr><td colSpan={8} className="px-6 py-12 text-center text-neutral-400">
                                        <Receipt className="w-10 h-10 mx-auto mb-3 opacity-40" />
                                        <p className="text-lg text-neutral-300 font-medium">Sin declaraciones</p>
                                        <p className="text-sm mt-1">Crea la primera con el botón de arriba.</p>
                                    </td></tr>
                                ) : filtered.map(d => (
                                    <tr key={d.id} className="hover:bg-neutral-800/60">
                                        <td className="px-6 py-4 font-medium text-white">{monthLabel(d.period)}</td>
                                        <td className="px-6 py-4">
                                            <div className={cn("inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-semibold", TYPE_ICON_COLOR[d.declaration_type])}>
                                                <FileText className="w-3.5 h-3.5" />
                                                {TYPE_LABEL[d.declaration_type]}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={cn("px-2.5 py-1 rounded-full text-xs font-semibold border", STATUS_STYLE[d.status])}>{STATUS_LABEL[d.status] || d.status}</span>
                                        </td>
                                        <td className="px-6 py-4 text-neutral-300 text-xs">{d.due_date ? new Date(d.due_date).toLocaleDateString() : "—"}</td>
                                        <td className="px-6 py-4 text-neutral-300 text-xs font-mono">{d.folio_sat || "—"}</td>
                                        <td className="px-6 py-4 text-right font-mono text-rose-300 font-bold">{fmt(d.total_to_pay)}</td>
                                        <td className="px-6 py-4 text-right font-mono text-emerald-300">{fmt(d.in_favor)}</td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex items-center gap-2 justify-end">
                                                <Link href={`/finance/declarations/${d.id}`} className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 px-3 py-1.5 rounded-lg border border-rose-500/20">
                                                    <Eye className="w-3.5 h-3.5" /> Ver
                                                </Link>
                                                <button onClick={() => del(d)} className="p-1.5 text-neutral-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors" title="Eliminar">
                                                    <X className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
