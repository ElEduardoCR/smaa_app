"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
    ArrowLeft, Banknote, Plus, RefreshCw, Eye, Calendar, Calculator, CheckCircle2, X
} from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

const fmt = (n: number | null | undefined) =>
    `$${(Number(n) || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Period = {
    id: string; period_type: string; start_date: string; end_date: string; payment_date: string | null;
    status: string; total_gross: number; total_deductions: number; total_net: number;
    receipt_count?: number;
};

const STATUS_STYLE: Record<string, string> = {
    draft: "bg-neutral-500/10 text-neutral-300 border-neutral-500/30",
    calculated: "bg-amber-500/10 text-amber-300 border-amber-500/30",
    approved: "bg-sky-500/10 text-sky-300 border-sky-500/30",
    paid: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
};
const STATUS_LABEL: Record<string, string> = {
    draft: "Borrador", calculated: "Calculado", approved: "Aprobado", paid: "Pagado",
};

const TYPE_LABEL: Record<string, string> = {
    monthly: "Mensual", biweekly: "Quincenal", weekly: "Semanal",
};

export default function PayrollPage() {
    const [periods, setPeriods] = useState<Period[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [showNew, setShowNew] = useState(false);
    const [msg, setMsg] = useState<{ type: "error" | "success"; text: string } | null>(null);
    const [newPeriod, setNewPeriod] = useState({ period_type: "biweekly", start_date: "", end_date: "", payment_date: "" });

    const load = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from("payroll_periods")
                .select("id, period_type, start_date, end_date, payment_date, status, total_gross, total_deductions, total_net, payroll_receipts(id)")
                .order("start_date", { ascending: false });
            if (error) throw error;
            const formatted = (data || []).map((p: any) => ({
                ...p,
                receipt_count: Array.isArray(p.payroll_receipts) ? p.payroll_receipts.length : 0,
            }));
            setPeriods(formatted);
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);

    const flash = (type: "error" | "success", text: string) => {
        setMsg({ type, text });
        setTimeout(() => setMsg(null), 3500);
    };

    const createPeriod = async () => {
        if (!newPeriod.start_date || !newPeriod.end_date) {
            flash("error", "Fechas requeridas.");
            return;
        }
        setBusy(true);
        try {
            const { data, error } = await supabase.from("payroll_periods").insert([{
                period_type: newPeriod.period_type,
                start_date: newPeriod.start_date,
                end_date: newPeriod.end_date,
                payment_date: newPeriod.payment_date || null,
                status: "draft",
            }]).select().single();
            if (error) throw error;
            setShowNew(false);
            setNewPeriod({ period_type: "biweekly", start_date: "", end_date: "", payment_date: "" });
            flash("success", "Periodo creado.");
            router_push(data.id);
        } catch (e: any) { flash("error", e?.message || "Error."); }
        finally { setBusy(false); }
    };

    const router_push = (id: string) => {
        window.location.href = `/finance/payroll/${id}`;
    };

    const del = async (p: Period) => {
        if (!confirm("¿Eliminar este periodo y todos sus recibos?")) return;
        await supabase.from("payroll_periods").delete().eq("id", p.id);
        load();
    };

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-3 sm:p-6 md:p-8 lg:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-6xl mx-auto space-y-6">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                        <Link href="/finance" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl text-neutral-400 hover:text-white border border-neutral-700">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div>
                            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                                <Banknote className="w-8 h-8 text-amber-400" />
                                Nómina
                            </h1>
                            <p className="text-neutral-400 text-sm mt-1">Periodos, cálculo automático y recibos detallados.</p>
                        </div>
                    </div>
                    <button onClick={() => setShowNew(s => !s)} className="flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-5 py-3 rounded-xl font-medium transition-all hover:shadow-[0_0_20px_rgba(245,158,11,0.4)] active:scale-95">
                        <Plus className="w-5 h-5" /> Nuevo periodo
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
                    <div className="bg-neutral-800/40 p-5 rounded-2xl border border-amber-500/30 space-y-3">
                        <h3 className="text-sm font-semibold text-white">Crear periodo de nómina</h3>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                            <div>
                                <label className="text-xs text-neutral-400">Tipo</label>
                                <select value={newPeriod.period_type} onChange={e => setNewPeriod({ ...newPeriod, period_type: e.target.value })} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500">
                                    <option value="monthly">Mensual</option>
                                    <option value="biweekly">Quincenal</option>
                                    <option value="weekly">Semanal</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-xs text-neutral-400">Inicio</label>
                                <input value={newPeriod.start_date} onChange={e => setNewPeriod({ ...newPeriod, start_date: e.target.value })} type="date" className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500" />
                            </div>
                            <div>
                                <label className="text-xs text-neutral-400">Fin</label>
                                <input value={newPeriod.end_date} onChange={e => setNewPeriod({ ...newPeriod, end_date: e.target.value })} type="date" className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500" />
                            </div>
                            <div>
                                <label className="text-xs text-neutral-400">Pago</label>
                                <input value={newPeriod.payment_date} onChange={e => setNewPeriod({ ...newPeriod, payment_date: e.target.value })} type="date" className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500" />
                            </div>
                        </div>
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setShowNew(false)} className="text-sm px-4 py-2 rounded-lg text-neutral-300 hover:bg-neutral-700">Cancelar</button>
                            <button onClick={createPeriod} disabled={busy} className="text-sm bg-amber-500 hover:bg-amber-600 text-white px-5 py-2 rounded-lg font-semibold flex items-center gap-1.5 disabled:opacity-50">
                                {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Crear
                            </button>
                        </div>
                    </div>
                )}

                <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-neutral-900/50 text-neutral-400 uppercase text-xs font-semibold tracking-wider">
                                <tr>
                                    <th className="px-6 py-4 rounded-tl-xl">Periodo</th>
                                    <th className="px-6 py-4">Tipo</th>
                                    <th className="px-6 py-4">Recibos</th>
                                    <th className="px-6 py-4 text-right">Bruto</th>
                                    <th className="px-6 py-4 text-right">Deducciones</th>
                                    <th className="px-6 py-4 text-right">Neto</th>
                                    <th className="px-6 py-4">Estatus</th>
                                    <th className="px-6 py-4 rounded-tr-xl text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-700/50">
                                {loading ? (
                                    <tr><td colSpan={8} className="px-6 py-12 text-center text-neutral-400"><RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-amber-500" /> Cargando…</td></tr>
                                ) : periods.length === 0 ? (
                                    <tr><td colSpan={8} className="px-6 py-12 text-center text-neutral-400">
                                        <Calendar className="w-10 h-10 mx-auto mb-3 opacity-40" />
                                        <p className="text-lg text-neutral-300 font-medium">No hay periodos</p>
                                        <p className="text-sm mt-1">Crea el primero con el botón de arriba.</p>
                                    </td></tr>
                                ) : periods.map(p => (
                                    <tr key={p.id} className="hover:bg-neutral-800/80 transition-colors group">
                                        <td className="px-6 py-4">
                                            <p className="text-white font-medium">{new Date(p.start_date).toLocaleDateString()} → {new Date(p.end_date).toLocaleDateString()}</p>
                                            {p.payment_date && <p className="text-[11px] text-neutral-500">Pago: {new Date(p.payment_date).toLocaleDateString()}</p>}
                                        </td>
                                        <td className="px-6 py-4 text-xs text-neutral-300">{TYPE_LABEL[p.period_type] || p.period_type}</td>
                                        <td className="px-6 py-4 text-xs text-neutral-300">{p.receipt_count || 0}</td>
                                        <td className="px-6 py-4 text-right font-mono text-emerald-300">{fmt(p.total_gross)}</td>
                                        <td className="px-6 py-4 text-right font-mono text-rose-300">−{fmt(p.total_deductions)}</td>
                                        <td className="px-6 py-4 text-right font-mono text-white font-bold">{fmt(p.total_net)}</td>
                                        <td className="px-6 py-4">
                                            <span className={cn("px-2.5 py-1 rounded-full text-xs font-semibold border", STATUS_STYLE[p.status])}>{STATUS_LABEL[p.status] || p.status}</span>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex items-center gap-2 justify-end">
                                                <Link href={`/finance/payroll/${p.id}`} className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 px-3 py-1.5 rounded-lg border border-amber-500/20">
                                                    <Calculator className="w-3.5 h-3.5" /> Calcular
                                                </Link>
                                                <button onClick={() => del(p)} className="p-1.5 text-neutral-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors" title="Eliminar">
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
