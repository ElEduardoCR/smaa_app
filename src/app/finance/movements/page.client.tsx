"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
    ArrowLeft, FileBarChart, Plus, RefreshCw, ArrowDownLeft, ArrowUpRight, ArrowRightLeft, Trash2
} from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

const fmt = (n: number | null | undefined) =>
    `$${(Number(n) || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const TYPE_LABEL: Record<string, string> = { income: "Ingreso", expense: "Egreso", transfer: "Transferencia" };
const CAT_LABEL: Record<string, string> = { nomina: "Nómina", impuestos: "Impuestos", proveedores: "Proveedores", clientes: "Clientes", otro: "Otro" };

type Movement = {
    id: string; movement_date: string; type: string; category: string | null;
    concept: string; amount: number; reference: string | null; created_at: string;
};

export default function MovementsPage() {
    const [movs, setMovs] = useState<Movement[]>([]);
    const [loading, setLoading] = useState(true);
    const [showNew, setShowNew] = useState(false);
    const [busy, setBusy] = useState(false);
    const [filter, setFilter] = useState<"all" | "income" | "expense" | "transfer">("all");
    const [m, setM] = useState({ movement_date: new Date().toISOString().slice(0, 10), type: "expense", category: "otro", concept: "", amount: "", reference: "" });

    const load = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase.from("bank_movements").select("*").order("movement_date", { ascending: false }).limit(200);
            if (error) throw error;
            setMovs(data || []);
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);

    const add = async () => {
        if (!m.concept || !m.amount) { alert("Concepto y monto requeridos."); return; }
        setBusy(true);
        try {
            const { error } = await supabase.from("bank_movements").insert([{
                ...m, amount: Number(m.amount) || 0, category: m.category || null,
            }]);
            if (error) throw error;
            setM({ movement_date: new Date().toISOString().slice(0, 10), type: "expense", category: "otro", concept: "", amount: "", reference: "" });
            setShowNew(false);
            load();
        } catch (e: any) { alert(e?.message || "Error"); }
        finally { setBusy(false); }
    };

    const del = async (id: string) => {
        if (!confirm("¿Eliminar este movimiento?")) return;
        await supabase.from("bank_movements").delete().eq("id", id);
        load();
    };

    const totalIn = movs.filter(m => m.type === "income").reduce((acc, m) => acc + Number(m.amount), 0);
    const totalOut = movs.filter(m => m.type === "expense").reduce((acc, m) => acc + Number(m.amount), 0);
    const filtered = movs.filter(m => filter === "all" || m.type === filter);

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-3 sm:p-6 md:p-8 lg:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-6xl mx-auto space-y-6">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50">
                    <div className="flex items-center gap-4">
                        <Link href="/finance" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl text-neutral-400 hover:text-white border border-neutral-700">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div>
                            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                                <FileBarChart className="w-8 h-8 text-sky-400" />
                                Movimientos bancarios
                            </h1>
                            <p className="text-neutral-400 text-sm mt-1">Tracking de ingresos / egresos. Conciliable contra declaraciones y nómina.</p>
                        </div>
                    </div>
                    <button onClick={() => setShowNew(s => !s)} className="flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-600 text-white px-5 py-3 rounded-xl font-medium">
                        <Plus className="w-5 h-5" /> Nuevo movimiento
                    </button>
                </header>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="bg-emerald-500/5 border border-emerald-500/30 rounded-2xl p-4">
                        <p className="text-xs uppercase text-emerald-300">Total ingresos</p>
                        <p className="text-2xl font-bold text-emerald-200 font-mono">{fmt(totalIn)}</p>
                    </div>
                    <div className="bg-rose-500/5 border border-rose-500/30 rounded-2xl p-4">
                        <p className="text-xs uppercase text-rose-300">Total egresos</p>
                        <p className="text-2xl font-bold text-rose-200 font-mono">{fmt(totalOut)}</p>
                    </div>
                    <div className={cn("rounded-2xl p-4 border",
                        totalIn - totalOut >= 0 ? "bg-sky-500/5 border-sky-500/30" : "bg-rose-500/5 border-rose-500/30"
                    )}>
                        <p className="text-xs uppercase text-sky-300">Flujo neto</p>
                        <p className={cn("text-2xl font-bold font-mono", totalIn - totalOut >= 0 ? "text-sky-200" : "text-rose-200")}>
                            {fmt(totalIn - totalOut)}
                        </p>
                    </div>
                </div>

                {showNew && (
                    <div className="bg-neutral-800/40 p-5 rounded-2xl border border-sky-500/30 space-y-3">
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                            <input type="date" value={m.movement_date} onChange={e => setM({ ...m, movement_date: e.target.value })} className="bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm" />
                            <select value={m.type} onChange={e => setM({ ...m, type: e.target.value })} className="bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm">
                                <option value="income">Ingreso</option>
                                <option value="expense">Egreso</option>
                                <option value="transfer">Transferencia</option>
                            </select>
                            <select value={m.category} onChange={e => setM({ ...m, category: e.target.value })} className="bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm">
                                {Object.entries(CAT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                            </select>
                            <input value={m.amount} onChange={e => setM({ ...m, amount: e.target.value })} type="number" step="0.01" placeholder="Monto" className="bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm" />
                            <input value={m.reference} onChange={e => setM({ ...m, reference: e.target.value })} placeholder="Referencia" className="bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm" />
                        </div>
                        <input value={m.concept} onChange={e => setM({ ...m, concept: e.target.value })} placeholder="Concepto" className="w-full bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm" />
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setShowNew(false)} className="text-sm px-4 py-2 rounded-lg text-neutral-300 hover:bg-neutral-700">Cancelar</button>
                            <button onClick={add} disabled={busy} className="text-sm bg-sky-500 hover:bg-sky-600 text-white px-5 py-2 rounded-lg font-semibold">Guardar</button>
                        </div>
                    </div>
                )}

                <div className="flex items-center gap-2">
                    {["all", "income", "expense", "transfer"].map(f => (
                        <button key={f} onClick={() => setFilter(f as any)} className={cn(
                            "text-xs px-3 py-1.5 rounded-full border transition-colors",
                            filter === f ? "bg-white/10 text-white border-white/20" : "bg-neutral-800/40 text-neutral-400 border-neutral-700/50 hover:bg-neutral-800"
                        )}>
                            {f === "all" ? "Todos" : TYPE_LABEL[f]}
                        </button>
                    ))}
                </div>

                <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl overflow-hidden">
                    {loading ? (
                        <div className="p-12 text-center text-neutral-400"><RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-sky-400" /> Cargando…</div>
                    ) : filtered.length === 0 ? (
                        <div className="p-12 text-center text-neutral-400">
                            <FileBarChart className="w-10 h-10 mx-auto mb-3 opacity-40" />
                            <p>Sin movimientos. Agrega el primero con el botón de arriba.</p>
                        </div>
                    ) : (
                        <ul className="divide-y divide-neutral-700/50">
                            {filtered.map(m => (
                                <li key={m.id} className="p-3 flex items-center gap-3 hover:bg-neutral-800/60">
                                    <div className={cn(
                                        "w-9 h-9 rounded-lg flex items-center justify-center",
                                        m.type === "income" ? "bg-emerald-500/10 text-emerald-300" :
                                        m.type === "expense" ? "bg-rose-500/10 text-rose-300" :
                                        "bg-sky-500/10 text-sky-300"
                                    )}>
                                        {m.type === "income" ? <ArrowDownLeft className="w-4 h-4" /> :
                                         m.type === "expense" ? <ArrowUpRight className="w-4 h-4" /> :
                                         <ArrowRightLeft className="w-4 h-4" />}
                                    </div>
                                    <div className="flex-1 min-w-0 min-w-0">
                                        <p className="text-sm text-white">{m.concept}</p>
                                        <p className="text-[11px] text-neutral-500">
                                            {new Date(m.movement_date).toLocaleDateString()} · {TYPE_LABEL[m.type]} · {CAT_LABEL[m.category || "otro"] || m.category}
                                            {m.reference ? ` · Ref: ${m.reference}` : ""}
                                        </p>
                                    </div>
                                    <span className={cn("font-mono font-bold",
                                        m.type === "income" ? "text-emerald-300" :
                                        m.type === "expense" ? "text-rose-300" : "text-sky-300"
                                    )}>
                                        {m.type === "income" ? "+" : m.type === "expense" ? "−" : ""}{fmt(m.amount)}
                                    </span>
                                    <button onClick={() => del(m.id)} className="p-1.5 text-neutral-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
}
