"use client";

import Link from "next/link";
import {
    ArrowLeft, Cog, Flame, Cpu, RefreshCw, Factory, ChevronRight, ShieldCheck, Plus
} from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";
import { useEffect, useState } from "react";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

type Module = { id: string; code: string; name: string; color: string; icon: string };

const ICONS: Record<string, any> = { Cog, Flame, Cpu };

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

export default function ManufacturingIndex({
    modules,
    counts,
    qcQueueCount,
    canCreateOT,
    user,
}: {
    modules: Module[];
    counts: Record<string, { open: number; inProgress: number; paused: number; completed: number; qc: number; qcReleased: number }>;
    qcQueueCount: number;
    canCreateOT: boolean;
    user: { fullName: string; role: string };
}) {
    const [tick, setTick] = useState(0);
    useEffect(() => {
        const t = setInterval(() => setTick((x) => x + 1), 30000);
        return () => clearInterval(t);
    }, []);

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-6 md:p-10 font-[family-name:var(--font-sans)]">
            <div className="w-full max-w-6xl mx-auto space-y-8">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors text-neutral-400 hover:text-white border border-neutral-700">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div>
                            <h1 className="text-2xl font-bold text-white">Fabricación</h1>
                            <p className="text-sm text-neutral-400">
                                {user.role === "master" ? "Todos los módulos" : "Módulos a los que tienes acceso"} · {modules.length} disponibles
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {canCreateOT && (
                            <Link href="/manufacturing/new" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white text-sm font-semibold">
                                <Plus className="w-4 h-4" /> Nueva OT
                            </Link>
                        )}
                        <button onClick={() => setTick((x) => x + 1)} className="p-2 rounded-xl bg-neutral-800/60 hover:bg-neutral-700 border border-neutral-700/50 text-neutral-300">
                            <RefreshCw className="w-4 h-4" />
                        </button>
                    </div>
                </header>

                {modules.length === 0 ? (
                    <div className="bg-neutral-800/40 border border-amber-500/30 rounded-3xl p-10 text-center">
                        <ShieldCheck className="w-12 h-12 text-amber-400 mx-auto mb-3" />
                        <h2 className="text-lg font-bold text-white mb-2">No tienes módulos de fabricación asignados</h2>
                        <p className="text-sm text-neutral-400">Pide al administrador que te asigne acceso en Configuración → Empleados.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                        {modules.map((m) => {
                            const Icon = ICONS[m.icon] || Factory;
                            const c = COLOR_CLASSES[m.color] || COLOR_CLASSES.orange;
                            const k = tick; // para forzar re-render con stats frescos
                            void k;
                            const stats = counts[m.id] || { open: 0, inProgress: 0, paused: 0, completed: 0, qc: 0, qcReleased: 0 };
                            return (
                                <Link
                                    key={m.id}
                                    href={`/manufacturing/${m.code}`}
                                    className={cn(
                                        "group relative bg-neutral-800/40 rounded-3xl border-2 p-6 transition-all duration-200 hover:-translate-y-1 hover:shadow-2xl",
                                        c.card
                                    )}
                                >
                                    <div className="flex items-start justify-between mb-4">
                                        <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center bg-neutral-900/50 border", c.pill)}>
                                            <Icon className={cn("w-6 h-6", c.icon)} />
                                        </div>
                                        <ChevronRight className="w-5 h-5 text-neutral-600 group-hover:text-white group-hover:translate-x-1 transition-all" />
                                    </div>
                                    <h2 className="text-xl font-bold text-white mb-1">{m.name}</h2>
                                    <p className="text-sm text-neutral-400 mb-4">
                                        OTs abiertas, en curso, pausadas y completadas.
                                    </p>
                                    <div className="grid grid-cols-3 gap-2 text-center">
                                        <Stat label="Abiertas" value={stats.open} color="orange" />
                                        <Stat label="En curso" value={stats.inProgress + stats.paused} color="amber" />
                                        <Stat label="Terminadas" value={stats.completed + stats.qcReleased} color="emerald" />
                                    </div>
                                </Link>
                            );
                        })}
                    </div>
                )}

                {qcQueueCount > 0 && (
                    <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-4 text-sm text-yellow-200">
                        Hay {qcQueueCount} OT{qcQueueCount === 1 ? "" : "s"} esperando revisión de calidad.
                    </div>
                )}
            </div>
        </div>
    );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
    const colors: Record<string, string> = {
        orange: "text-orange-300",
        amber: "text-amber-300",
        emerald: "text-emerald-300",
    };
    return (
        <div className="bg-neutral-900/50 rounded-xl border border-neutral-700/40 p-2">
            <p className={cn("text-xl font-bold tabular-nums", colors[color] || "text-white")}>{value}</p>
            <p className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</p>
        </div>
    );
}
