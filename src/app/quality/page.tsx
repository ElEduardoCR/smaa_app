"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, RefreshCw, ShieldCheck, Eye, Cog, Flame, Cpu, Clock, CheckCircle2, X } from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

const ICONS: Record<string, any> = { Cog, Flame, Cpu };
const COLORS: Record<string, string> = { orange: "text-orange-400", amber: "text-amber-400", cyan: "text-cyan-400" };

type WO = {
    id: string;
    order_number: string;
    status: string;
    work_title: string | null;
    completed_at: string | null;
    operator_name: string | null;
    created_at: string;
    module?: { id: string; code: string; name: string; color: string; icon: string };
    quotation?: { client?: { business_name: string } } | null;
    client_name?: string | null;
};

export default function QualityPage() {
    const [queue, setQueue] = useState<WO[]>([]);
    const [released, setReleased] = useState<WO[]>([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<"queue" | "released">("queue");

    const load = async () => {
        setLoading(true);
        try {
            const { data: q, error: qErr } = await supabase
                .from("work_orders")
                .select(`id, order_number, status, work_title, completed_at, operator_name, created_at, client_name,
                    module:manufacturing_modules(id, code, name, color, icon),
                    quotation:quotations(client:clients(business_name))`)
                .eq("status", "QC")
                .order("completed_at", { ascending: true });
            if (qErr) throw qErr;
            const fmt = (q || []).map((w: any) => ({
                ...w,
                module: Array.isArray(w.module) ? w.module[0] : w.module,
                quotation: Array.isArray(w.quotation) ? w.quotation[0] : w.quotation,
            })).map((w: any) => ({
                ...w,
                quotation: w.quotation ? { ...w.quotation, client: Array.isArray(w.quotation.client) ? w.quotation.client[0] : w.quotation.client } : null,
            }));
            setQueue(fmt);

            const { data: r, error: rErr } = await supabase
                .from("work_orders")
                .select(`id, order_number, status, work_title, completed_at, operator_name, created_at, client_name, qc_released_at,
                    module:manufacturing_modules(id, code, name, color, icon),
                    quotation:quotations(client:clients(business_name))`)
                .eq("status", "QC_Released")
                .order("qc_released_at", { ascending: false })
                .limit(20);
            if (rErr) throw rErr;
            const fmtR = (r || []).map((w: any) => ({
                ...w,
                module: Array.isArray(w.module) ? w.module[0] : w.module,
                quotation: Array.isArray(w.quotation) ? w.quotation[0] : w.quotation,
            })).map((w: any) => ({
                ...w,
                quotation: w.quotation ? { ...w.quotation, client: Array.isArray(w.quotation.client) ? w.quotation.client[0] : w.quotation.client } : null,
            }));
            setReleased(fmtR);
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    };

    useEffect(() => { load(); }, []);

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-6 md:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-6xl mx-auto space-y-6">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors text-neutral-400 hover:text-white border border-neutral-700">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div>
                            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                                <ShieldCheck className="w-8 h-8 text-sky-400" />
                                Calidad
                            </h1>
                            <p className="text-neutral-400 text-sm mt-1">Liberación final de las OT antes de pasar a entregas.</p>
                        </div>
                    </div>
                    <button onClick={load} className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg transition-colors flex items-center gap-2 text-sm" disabled={loading}>
                        <RefreshCw className={cn("w-4 h-4", loading && "animate-spin text-sky-400")} /> Actualizar
                    </button>
                </header>

                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setTab("queue")}
                        className={cn(
                            "px-4 py-2 rounded-xl text-sm font-medium border transition-colors flex items-center gap-2",
                            tab === "queue"
                                ? "bg-sky-500/15 text-sky-300 border-sky-500/40"
                                : "bg-neutral-800/40 text-neutral-400 border-neutral-700/50 hover:bg-neutral-800"
                        )}
                    >
                        <Clock className="w-4 h-4" /> Cola ({queue.length})
                    </button>
                    <button
                        onClick={() => setTab("released")}
                        className={cn(
                            "px-4 py-2 rounded-xl text-sm font-medium border transition-colors flex items-center gap-2",
                            tab === "released"
                                ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                                : "bg-neutral-800/40 text-neutral-400 border-neutral-700/50 hover:bg-neutral-800"
                        )}
                    >
                        <CheckCircle2 className="w-4 h-4" /> Liberadas (recientes)
                    </button>
                </div>

                <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl overflow-hidden">
                    {loading ? (
                        <div className="p-12 text-center text-neutral-400">
                            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-sky-400" /> Cargando…
                        </div>
                    ) : (tab === "queue" ? queue : released).length === 0 ? (
                        <div className="p-12 text-center text-neutral-400">
                            <ShieldCheck className="w-10 h-10 mx-auto mb-3 opacity-40" />
                            <p>{tab === "queue" ? "No hay OTs en cola de calidad." : "Sin liberaciones recientes."}</p>
                        </div>
                    ) : (
                        <ul className="divide-y divide-neutral-700/50">
                            {(tab === "queue" ? queue : released).map(w => {
                                const Icon = w.module ? (ICONS[w.module.icon] || ShieldCheck) : ShieldCheck;
                                const colorCls = w.module ? (COLORS[w.module.color] || "text-sky-400") : "text-sky-400";
                                return (
                                    <li key={w.id} className="p-4 flex items-center gap-4 hover:bg-neutral-800/60 transition-colors">
                                        <Icon className={cn("w-6 h-6", colorCls)} />
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-mono text-orange-300 text-xs bg-orange-500/10 px-2 py-0.5 rounded border border-orange-500/20">{w.order_number}</span>
                                                {w.module && <span className="text-[10px] uppercase tracking-wider text-neutral-500">{w.module.name}</span>}
                                            </div>
                                            <p className="text-sm text-white mt-0.5 truncate">{w.work_title || "—"}</p>
                                            <p className="text-[11px] text-neutral-500 mt-0.5">
                                                {w.quotation?.client?.business_name || w.client_name || "—"}
                                                {w.operator_name ? ` · Operador: ${w.operator_name}` : ""}
                                                {w.completed_at ? ` · Term: ${new Date(w.completed_at).toLocaleString()}` : ""}
                                            </p>
                                        </div>
                                        <Link
                                            href={`/manufacturing/${w.module?.code || "maquinado"}/${w.id}`}
                                            className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-400 hover:text-sky-300 bg-sky-500/10 hover:bg-sky-500/20 px-3 py-1.5 rounded-lg border border-sky-500/20"
                                        >
                                            <Eye className="w-3.5 h-3.5" /> {tab === "queue" ? "Revisar" : "Ver"}
                                        </Link>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
}
