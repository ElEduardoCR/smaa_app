"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
    ArrowLeft, Plus, RefreshCw, AlertCircle, AlertTriangle, ShieldAlert,
    Search, Filter, Inbox, CheckCircle2, Clock
} from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

type Risk = {
    id: string;
    process: string;
    failure_mode: string;
    effect: string;
    cause: string;
    severity: number;
    occurrence: number;
    detection: number;
    rpn: number;
    status: 'open' | 'in_progress' | 'closed';
    responsible: string | null;
    target_date: string | null;
    updated_at: string;
};

const STATUS_META: Record<string, { label: string; chip: string; icon: any }> = {
    open:        { label: "Abierto",         chip: "bg-rose-500/10 text-rose-300 border-rose-500/30",       icon: AlertTriangle },
    in_progress: { label: "En progreso",     chip: "bg-amber-500/10 text-amber-300 border-amber-500/30",   icon: Clock },
    closed:      { label: "Cerrado",         chip: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30", icon: CheckCircle2 },
};

function rpnClass(rpn: number) {
    if (rpn >= 50) return { label: 'Crítico', chip: 'bg-rose-500/20 text-rose-200 border-rose-500/50' };
    if (rpn >= 25) return { label: 'Alto',    chip: 'bg-orange-500/20 text-orange-200 border-orange-500/50' };
    if (rpn >= 10) return { label: 'Medio',   chip: 'bg-amber-500/20 text-amber-200 border-amber-500/50' };
    return                  { label: 'Bajo',    chip: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/50' };
}

export default function PfmeaListPage() {
    const [risks, setRisks] = useState<Risk[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState("active");
    const [minRpn, setMinRpn] = useState(0);

    const load = async () => {
        setLoading(true);
        setErr(null);
        try {
            const { data, error } = await supabase
                .from('pfmea_risks')
                .select('*')
                .eq('is_active', true)
                .order('rpn', { ascending: false });
            if (error) throw error;
            setRisks((data || []) as any);
        } catch (e: any) { setErr(e?.message || 'Error'); }
        finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);

    const filtered = useMemo(() => {
        let list = risks;
        if (statusFilter === 'active') {
            list = list.filter(r => r.status !== 'closed');
        } else if (statusFilter !== 'all') {
            list = list.filter(r => r.status === statusFilter);
        }
        if (minRpn > 0) list = list.filter(r => r.rpn >= minRpn);
        if (search.trim()) {
            const q = search.trim().toLowerCase();
            list = list.filter(r =>
                r.process.toLowerCase().includes(q) ||
                r.failure_mode.toLowerCase().includes(q) ||
                r.effect.toLowerCase().includes(q) ||
                r.cause.toLowerCase().includes(q)
            );
        }
        return list;
    }, [risks, statusFilter, minRpn, search]);

    const stats = useMemo(() => ({
        total: risks.length,
        critical: risks.filter(r => r.rpn >= 50).length,
        high: risks.filter(r => r.rpn >= 25 && r.rpn < 50).length,
        open: risks.filter(r => r.status === 'open').length,
        inProgress: risks.filter(r => r.status === 'in_progress').length,
        closed: risks.filter(r => r.status === 'closed').length,
    }), [risks]);

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-3 sm:p-6 md:p-8 lg:p-10 font-[family-name:var(--font-sans)]">
            <div className="w-full space-y-8">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl text-neutral-400 hover:text-white border border-neutral-700">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div>
                            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                                <ShieldAlert className="w-8 h-8 text-orange-400" /> PFMEA / AMEF
                            </h1>
                            <p className="text-neutral-400 text-sm mt-1">
                                Análisis modal de fallos y efectos. RPN = Severidad × Ocurrencia × Detección.
                            </p>
                        </div>
                    </div>
                    <Link href="/pfmea/new"
                        className="flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-6 py-3 rounded-xl font-medium transition-all hover:shadow-[0_0_20px_rgba(249,115,22,0.4)] active:scale-95">
                        <Plus className="w-5 h-5" /> Nuevo riesgo
                    </Link>
                </header>

                {/* Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <StatCard label="Riesgos totales"  value={stats.total}        color="text-white" />
                    <StatCard label="Críticos (≥50)"   value={stats.critical}    color="text-rose-300" />
                    <StatCard label="Altos (25-49)"    value={stats.high}        color="text-orange-300" />
                    <StatCard label="Cerrados"         value={stats.closed}      color="text-emerald-300" />
                </div>

                {err && <div className="p-3 rounded-xl border bg-red-500/10 border-red-500/30 text-red-400 flex items-center gap-3"><AlertCircle className="w-5 h-5" /> {err}</div>}

                {/* Filtros */}
                <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl p-5 flex flex-wrap items-center gap-3">
                    <Filter className="w-4 h-4 text-neutral-400" />
                    <div className="relative flex-1 min-w-[200px]">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
                        <input value={search} onChange={e => setSearch(e.target.value)}
                            placeholder="Buscar por proceso, modo de falla, efecto, causa..."
                            className="w-full bg-neutral-900/60 border border-neutral-700/50 rounded-xl pl-10 pr-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-orange-500/50" />
                    </div>
                    <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                        className="bg-neutral-900/60 border border-neutral-700/50 rounded-xl px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-orange-500/50">
                        <option value="active">Activos</option>
                        <option value="all">Todos</option>
                        <option value="open">Abiertos</option>
                        <option value="in_progress">En progreso</option>
                        <option value="closed">Cerrados</option>
                    </select>
                    <select value={minRpn} onChange={e => setMinRpn(Number(e.target.value))}
                        className="bg-neutral-900/60 border border-neutral-700/50 rounded-xl px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-orange-500/50">
                        <option value="0">Cualquier RPN</option>
                        <option value="10">RPN ≥ 10</option>
                        <option value="25">RPN ≥ 25 (alto)</option>
                        <option value="50">RPN ≥ 50 (crítico)</option>
                    </select>
                    <button onClick={load} className="p-2 text-neutral-400 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded-lg border border-neutral-700" title="Refrescar">
                        <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
                    </button>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-16 text-neutral-500 gap-2">
                        <RefreshCw className="w-5 h-5 animate-spin" /> Cargando riesgos...
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-10 text-center">
                        <Inbox className="w-10 h-10 text-neutral-600 mx-auto mb-3" />
                        <p className="text-neutral-400">No hay riesgos con esos filtros.</p>
                        <Link href="/pfmea/new" className="inline-block mt-3 text-orange-400 hover:text-orange-300 text-sm">
                            Crear el primero →
                        </Link>
                    </div>
                ) : (
                    <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-neutral-900/60">
                                <tr className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">
                                    <th className="text-left p-3">Proceso / Falla</th>
                                    <th className="text-center p-3">S</th>
                                    <th className="text-center p-3">O</th>
                                    <th className="text-center p-3">D</th>
                                    <th className="text-center p-3">RPN</th>
                                    <th className="text-center p-3">Estado</th>
                                    <th className="text-left p-3">Responsable</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-700/30">
                                {filtered.map(r => {
                                    const rc = rpnClass(r.rpn);
                                    const sm = STATUS_META[r.status];
                                    const Icon = sm.icon;
                                    return (
                                        <tr key={r.id} className="hover:bg-neutral-800/60 cursor-pointer" onClick={() => window.location.href = `/pfmea/${r.id}`}>
                                            <td className="p-3">
                                                <p className="text-white font-medium">{r.process}</p>
                                                <p className="text-xs text-neutral-400 line-clamp-1">{r.failure_mode}</p>
                                            </td>
                                            <td className="text-center font-mono">{r.severity}</td>
                                            <td className="text-center font-mono">{r.occurrence}</td>
                                            <td className="text-center font-mono">{r.detection}</td>
                                            <td className="text-center">
                                                <span className={cn("inline-block px-2 py-0.5 rounded border font-mono font-bold", rc.chip)}>{r.rpn}</span>
                                                <p className="text-[10px] text-neutral-500 mt-0.5">{rc.label}</p>
                                            </td>
                                            <td className="text-center">
                                                <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border inline-flex items-center gap-1", sm.chip)}>
                                                    <Icon className="w-3 h-3" /> {sm.label}
                                                </span>
                                            </td>
                                            <td className="p-3 text-neutral-300">{r.responsible || '—'}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
    return (
        <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-4">
            <p className="text-[10px] uppercase font-semibold text-neutral-500 tracking-wider">{label}</p>
            <p className={cn("text-3xl font-bold mt-1 font-mono", color)}>{value}</p>
        </div>
    );
}
