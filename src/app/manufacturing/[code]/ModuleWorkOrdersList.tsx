"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
    ArrowLeft, Plus, RefreshCw, Cog, Flame, Cpu, Eye, Filter, Factory
} from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

const ICONS: Record<string, any> = { Cog, Flame, Cpu };
const COLORS: Record<string, string> = {
    orange: "text-orange-400",
    amber:  "text-amber-400",
    cyan:   "text-cyan-400",
};

const STATUS_STYLES: Record<string, string> = {
    "Open":        "bg-orange-500/10 text-orange-300 border-orange-500/30",
    "In Progress": "bg-sky-500/10 text-sky-300 border-sky-500/30",
    "Paused":      "bg-amber-500/10 text-amber-300 border-amber-500/30",
    "Completed":   "bg-violet-500/10 text-violet-300 border-violet-500/30",
    "QC":          "bg-yellow-500/10 text-yellow-300 border-yellow-500/30",
    "QC_Released": "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
    "Cancelled":   "bg-red-500/10 text-red-300 border-red-500/30",
};
const STATUS_LABEL: Record<string, string> = {
    "Open": "Abierta",
    "In Progress": "En curso",
    "Paused": "Pausada",
    "Completed": "Terminada",
    "QC": "En calidad",
    "QC_Released": "Liberada",
    "Cancelled": "Cancelada",
};

type WO = {
    id: string;
    order_number: string;
    status: string;
    work_title: string | null;
    priority: string | null;
    client_name: string | null;
    quotation?: {
        quotation_number: string;
        client: { business_name: string };
    } | null;
    created_at: string;
};

type Module = { id: string; code: string; name: string; color: string; icon: string };

export default function ModuleWorkOrdersList({ code }: { code: string }) {
    const [module, setModule] = useState<Module | null>(null);
    const [workOrders, setWorkOrders] = useState<WO[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<string>("all");

    const load = async () => {
        setLoading(true);
        try {
            const { data: mod, error: mErr } = await supabase
                .from("manufacturing_modules")
                .select("*")
                .eq("code", code)
                .single();
            if (mErr) throw mErr;
            setModule(mod);

            const { data: wos, error: wErr } = await supabase
                .from("work_orders")
                .select(`
                    id, order_number, status, work_title, priority, client_name, created_at,
                    quotation:quotations(quotation_number, client:clients(business_name))
                `)
                .eq("module_id", mod.id)
                .order("created_at", { ascending: false });
            if (wErr) throw wErr;

            const formatted = (wos || []).map((wo: any) => ({
                ...wo,
                quotation: Array.isArray(wo.quotation) ? wo.quotation[0] : wo.quotation,
            })).map((wo: any) => ({
                ...wo,
                quotation: wo.quotation ? {
                    ...wo.quotation,
                    client: Array.isArray(wo.quotation.client) ? wo.quotation.client[0] : wo.quotation.client,
                } : null,
            }));
            setWorkOrders(formatted);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { if (code) load(); }, [code]);

    const filtered = useMemo(() => {
        if (filter === "all") return workOrders;
        return workOrders.filter(w => w.status === filter);
    }, [workOrders, filter]);

    const Icon = module ? (ICONS[module.icon] || Factory) : Factory;
    const colorCls = module ? (COLORS[module.color] || COLORS.orange) : "text-orange-400";

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-3 sm:p-6 md:p-8 lg:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-6xl mx-auto space-y-8">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                        <Link href="/manufacturing" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors text-neutral-400 hover:text-white border border-neutral-700">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div>
                            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                                <Icon className={cn("w-8 h-8", colorCls)} />
                                {module?.name || "Módulo"}
                            </h1>
                            <p className="text-neutral-400 text-sm mt-1">Órdenes de trabajo de este módulo.</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={load}
                            className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg transition-colors flex items-center gap-2 text-sm"
                            disabled={loading}
                        >
                            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin", colorCls)} />
                            Actualizar
                        </button>
                        <Link
                            href={`/manufacturing/new?module=${code}`}
                            className="flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-5 py-3 rounded-xl font-medium transition-all hover:shadow-[0_0_20px_rgba(249,115,22,0.4)] active:scale-95"
                        >
                            <Plus className="w-5 h-5" /> Nueva OT
                        </Link>
                    </div>
                </header>

                {/* Filter chips */}
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-neutral-500 uppercase tracking-wider mr-1 flex items-center gap-1"><Filter className="w-3.5 h-3.5" /> Filtro</span>
                    {["all", "Open", "In Progress", "Paused", "Completed", "QC", "QC_Released", "Cancelled"].map(s => (
                        <button
                            key={s}
                            onClick={() => setFilter(s)}
                            className={cn(
                                "text-xs px-3 py-1.5 rounded-full border transition-colors",
                                filter === s
                                    ? "bg-white/10 text-white border-white/20"
                                    : "bg-neutral-800/40 text-neutral-400 border-neutral-700/50 hover:bg-neutral-800"
                            )}
                        >
                            {s === "all" ? "Todas" : (STATUS_LABEL[s] || s)} {s !== "all" && `(${workOrders.filter(w => w.status === s).length})`}
                        </button>
                    ))}
                </div>

                <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl overflow-hidden backdrop-blur-sm">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-neutral-900/50 text-neutral-400 uppercase text-xs font-semibold tracking-wider">
                                <tr>
                                    <th className="px-6 py-4 rounded-tl-xl">OT #</th>
                                    <th className="px-6 py-4">Título</th>
                                    <th className="px-6 py-4">Cliente</th>
                                    <th className="px-6 py-4">Cotización</th>
                                    <th className="px-6 py-4">Prioridad</th>
                                    <th className="px-6 py-4">Fecha</th>
                                    <th className="px-6 py-4">Estatus</th>
                                    <th className="px-6 py-4 rounded-tr-xl text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-700/50">
                                {loading ? (
                                    <tr><td colSpan={8} className="px-6 py-12 text-center text-neutral-400">
                                        <RefreshCw className={cn("w-6 h-6 animate-spin mx-auto mb-3", colorCls)} />
                                        Cargando…
                                    </td></tr>
                                ) : filtered.length === 0 ? (
                                    <tr><td colSpan={8} className="px-6 py-12 text-center text-neutral-400">
                                        <div className="bg-neutral-800/50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border border-neutral-700">
                                            <Icon className="w-8 h-8 text-neutral-500" />
                                        </div>
                                        <p className="text-lg text-neutral-300 font-medium">No hay órdenes en este filtro</p>
                                        <p className="text-sm mt-1">Crea una nueva OT con el botón de arriba.</p>
                                    </td></tr>
                                ) : (
                                    filtered.map(wo => (
                                        <tr key={wo.id} className="hover:bg-neutral-800/80 transition-colors group">
                                            <td className="px-6 py-4">
                                                <span className="font-mono font-medium text-orange-300 bg-orange-500/10 px-2.5 py-1 rounded-md border border-orange-500/20">
                                                    {wo.order_number}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 max-w-xs truncate text-neutral-200" title={wo.work_title || ""}>
                                                {wo.work_title || <span className="text-neutral-600">—</span>}
                                            </td>
                                            <td className="px-6 py-4 text-neutral-200">
                                                {wo.quotation?.client?.business_name || wo.client_name || <span className="text-neutral-500">—</span>}
                                            </td>
                                            <td className="px-6 py-4">
                                                {wo.quotation?.quotation_number ? (
                                                    <span className="font-mono text-emerald-300 text-xs bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                                                        {wo.quotation.quotation_number}
                                                    </span>
                                                ) : (
                                                    <span className="text-xs text-neutral-500 italic">Sin cotización</span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-xs text-neutral-300">
                                                {wo.priority || "Normal"}
                                            </td>
                                            <td className="px-6 py-4 text-neutral-400">
                                                {new Date(wo.created_at).toLocaleDateString()}
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={cn("px-2.5 py-1 rounded-full text-xs font-semibold border", STATUS_STYLES[wo.status] || STATUS_STYLES["Open"])}>
                                                    {STATUS_LABEL[wo.status] || wo.status}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <Link
                                                    href={`/manufacturing/${code}/${wo.id}`}
                                                    className="inline-flex items-center gap-1.5 text-xs font-medium text-orange-400 hover:text-orange-300 transition-colors bg-orange-500/10 hover:bg-orange-500/20 px-3 py-1.5 rounded-lg border border-orange-500/20"
                                                >
                                                    <Eye className="w-3.5 h-3.5" /> Abrir
                                                </Link>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
