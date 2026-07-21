"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
    ArrowLeft, Cog, Flame, Cpu, Plus, RefreshCw, Factory, ChevronRight, ShieldCheck
} from "lucide-react";
import Link from "next/link";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

type Module = {
    id: string;
    code: string;
    name: string;
    color: string;
    icon: string;
};

const ICONS: Record<string, any> = {
    Cog, Flame, Cpu,
};

const COLOR_CLASSES: Record<string, { card: string; pill: string; icon: string }> = {
    orange: {
        card: "border-orange-500/30 hover:border-orange-500/70",
        pill: "bg-orange-500/20 text-orange-300 border-orange-500/30",
        icon: "text-orange-400",
    },
    amber: {
        card: "border-amber-500/30 hover:border-amber-500/70",
        pill: "bg-amber-500/20 text-amber-300 border-amber-500/30",
        icon: "text-amber-400",
    },
    cyan: {
        card: "border-cyan-500/30 hover:border-cyan-500/70",
        pill: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
        icon: "text-cyan-400",
    },
};

export default function ManufacturingIndex() {
    const [modules, setModules] = useState<Module[]>([]);
    const [counts, setCounts] = useState<Record<string, { open: number; inProgress: number; paused: number; completed: number; qc: number; qcReleased: number }>>({});
    const [qcQueueCount, setQcQueueCount] = useState(0);
    const [loading, setLoading] = useState(true);

    const load = async () => {
        setLoading(true);
        try {
            const { data: mods, error: mErr } = await supabase
                .from("manufacturing_modules")
                .select("*")
                .eq("is_active", true)
                .order("sort_order", { ascending: true });
            if (mErr) throw mErr;
            setModules(mods || []);

            const { data: wos, error: wErr } = await supabase
                .from("work_orders")
                .select("module_id, status");
            if (wErr) throw wErr;

            const c: Record<string, any> = {};
            for (const wo of (wos || [])) {
                if (!wo.module_id) continue;
                c[wo.module_id] = c[wo.module_id] || { open: 0, inProgress: 0, paused: 0, completed: 0, qc: 0, qcReleased: 0 };
                const bucket = c[wo.module_id];
                if (wo.status === "Open") bucket.open++;
                else if (wo.status === "In Progress") bucket.inProgress++;
                else if (wo.status === "Paused") bucket.paused++;
                else if (wo.status === "Completed") bucket.completed++;
                else if (wo.status === "QC") bucket.qc++;
                else if (wo.status === "QC_Released") bucket.qcReleased++;
            }
            setCounts(c);

            // QC queue: any OT with status QC and not yet released
            const qcCount = (wos || []).filter((w: any) => w.status === "QC").length;
            setQcQueueCount(qcCount);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { load(); }, []);

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-6 md:p-10 font-[family-name:var(--font-sans)]">
            <div className="w-full max-w-6xl mx-auto space-y-8">
                {/* Header */}
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors text-neutral-400 hover:text-white border border-neutral-700">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div>
                            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                                <Factory className="w-8 h-8 text-orange-400" />
                                Fabricación
                            </h1>
                            <p className="text-neutral-400 text-sm mt-1">3 módulos: Maquinado, Soldadura y Automatización.</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={load}
                            className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg transition-colors flex items-center gap-2 text-sm"
                            disabled={loading}
                        >
                            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin text-orange-400")} />
                            Actualizar
                        </button>
                        <Link
                            href="/manufacturing/new"
                            className="flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-5 py-3 rounded-xl font-medium transition-all hover:shadow-[0_0_20px_rgba(249,115,22,0.4)] active:scale-95"
                        >
                            <Plus className="w-5 h-5" /> Nueva Orden de Trabajo
                        </Link>
                    </div>
                </header>

                {/* Module cards */}
                <section>
                    <h2 className="text-sm font-bold text-white mb-3 uppercase tracking-[0.15em] flex items-center gap-1.5">
                        <span className="w-1 h-3 rounded-full bg-orange-400/70" />
                        Módulos
                        <span className="text-neutral-600 ml-1">· {modules.length}</span>
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-3 gap-2.5">
                        {modules.map((m) => {
                            const c = COLOR_CLASSES[m.color] || COLOR_CLASSES.orange;
                            const Icon = ICONS[m.icon] || Cog;
                            const stats = counts[m.id] || { open: 0, inProgress: 0, paused: 0, completed: 0, qc: 0, qcReleased: 0 };
                            return (
                                <Link
                                    key={m.id}
                                    href={`/manufacturing/${m.code}`}
                                    className={cn(
                                        "group relative bg-neutral-800/40 border rounded-2xl p-4 hover:bg-neutral-800/80 transition-all duration-200 shadow-lg shadow-black/10 hover:-translate-y-0.5 flex flex-col overflow-hidden",
                                        c.card
                                    )}
                                >
                                    <div className="flex items-start justify-between mb-2.5">
                                        <div className={cn("w-10 h-10 rounded-xl bg-neutral-900/60 flex items-center justify-center border border-neutral-700/50 group-hover:scale-105 transition-transform", c.icon)}>
                                            <Icon className="w-5 h-5" />
                                        </div>
                                        <ChevronRight className="w-4 h-4 text-neutral-500 group-hover:text-white transition-colors" />
                                    </div>
                                    <h3 className="text-base font-bold text-white leading-tight">{m.name}</h3>
                                    <p className="text-[11px] text-neutral-400 mt-0.5 line-clamp-1">OTs, archivos, plano y 3D en el mismo lugar</p>
                                    <div className="mt-3 pt-2.5 border-t border-neutral-700/40 flex flex-wrap gap-1.5 text-[10px] font-semibold">
                                        <span className={cn("px-2 py-0.5 rounded-full border", c.pill)}>{stats.open + stats.inProgress} activas</span>
                                        {stats.paused > 0 && <span className="px-2 py-0.5 rounded-full border bg-amber-500/10 text-amber-300 border-amber-500/30">{stats.paused} pausadas</span>}
                                        {stats.qc > 0 && <span className="px-2 py-0.5 rounded-full border bg-sky-500/10 text-sky-300 border-sky-500/30">{stats.qc} en calidad</span>}
                                        {stats.qcReleased > 0 && <span className="px-2 py-0.5 rounded-full border bg-emerald-500/10 text-emerald-300 border-emerald-500/30">{stats.qcReleased} liberadas</span>}
                                    </div>
                                </Link>
                            );
                        })}
                    </div>
                </section>

                {/* QC queue shortcut */}
                <section>
                    <Link
                        href="/quality"
                        className="flex items-center justify-between bg-neutral-800/40 border border-sky-500/30 hover:border-sky-500/70 rounded-2xl p-5 transition-colors group"
                    >
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center">
                                <ShieldCheck className="w-6 h-6 text-sky-400" />
                            </div>
                            <div>
                                <h3 className="text-lg font-semibold text-white">Cola de Calidad</h3>
                                <p className="text-sm text-neutral-400">Liberación de primera pieza, fotos de evidencia y firma de calidad.</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className={cn("text-sm font-semibold px-3 py-1.5 rounded-full border", qcQueueCount > 0 ? "bg-sky-500/20 text-sky-300 border-sky-500/30" : "bg-neutral-700/40 text-neutral-400 border-neutral-700/50")}>
                                {qcQueueCount} por revisar
                            </span>
                            <ChevronRight className="w-5 h-5 text-neutral-500 group-hover:text-white" />
                        </div>
                    </Link>
                </section>
            </div>
        </div>
    );
}
