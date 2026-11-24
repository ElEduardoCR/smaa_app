"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, RefreshCw, Eye, Filter, Factory, ShieldCheck, Wrench } from "lucide-react";
import { matchesSearch, partyLabel } from "@/lib/search";
import { supabase } from "@/lib/supabase";
import {
    cn, KIND_LABEL, ProgressBar, qty, StageChain, STATUS_LABEL, STATUS_STYLE, type OrderProgress,
} from "./shared";

type WorkOrderRow = {
    id: string;
    order_number: string;
    status: string;
    work_title: string | null;
    priority: string | null;
    client_name: string | null;
    created_at: string;
    quantity: number;
    unit: string;
    order_kind: string;
    warranty_count: number;
    quotation: {
        quotation_number: string;
        title?: string | null;
        items?: { description: string }[];
        client: { name?: string | null; business_name: string } | null;
    } | null;
    progress: OrderProgress | null;
};

const PROCESS_LABEL: Record<string, string> = { maquinado: "Maquinado", soldadura: "Soldadura", automatizacion: "Automatización" };
const STATUS_FILTERS = ["all", "Open", "In Progress", "Paused", "QC", "QC_Released", "Cancelled"];

const one = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);

export default function WorkOrdersList({ processes, initialProcess, canCreate }: { processes: string[]; initialProcess: string; canCreate: boolean }) {
    const [orders, setOrders] = useState<WorkOrderRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [search, setSearch] = useState("");
    const [status, setStatus] = useState("all");
    const [process, setProcess] = useState(initialProcess);
    const [kind, setKind] = useState<"all" | "normal" | "garantia_reparacion">("all");

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const [{ data: rows, error: rowsError }, { data: progress, error: progressError }] = await Promise.all([
                supabase.from("work_orders").select(`
                    id, order_number, status, work_title, priority, client_name, created_at, quantity, unit, order_kind, warranty_count,
                    quotation:quotations(quotation_number, title, items:quotation_items(description), client:clients(name, business_name))
                `).order("created_at", { ascending: false }),
                supabase.from("v_work_order_progress").select("*"),
            ]);
            if (rowsError) throw rowsError;
            if (progressError) throw progressError;
            const byId = new Map((progress || []).map((p: OrderProgress) => [p.work_order_id, p]));
            setOrders((rows || []).map((row: any) => {
                const quotation = one(row.quotation) as WorkOrderRow["quotation"];
                return {
                    ...row,
                    quotation: quotation ? { ...quotation, client: one(quotation.client as any) } : null,
                    progress: byId.get(row.id) || null,
                };
            }));
        } catch (e) {
            setError(e instanceof Error ? e.message : "No se pudieron cargar las OT.");
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { load(); }, [load]);

    // Sólo las OT que pasan por algún proceso asignado al usuario.
    const accessible = useMemo(() => orders.filter((o) => {
        const codes = o.progress?.stages.map((s) => s.module_code) || [];
        return codes.length === 0 || codes.some((code) => processes.includes(code));
    }), [orders, processes]);

    const filtered = useMemo(() => accessible.filter((o) => {
        if (status !== "all" && o.status !== status) return false;
        if (process !== "all" && !(o.progress?.stages || []).some((s) => s.module_code === process)) return false;
        if (kind === "normal" && o.order_kind !== "normal") return false;
        if (kind === "garantia_reparacion" && o.order_kind === "normal") return false;
        return matchesSearch(search, o.order_number, o.work_title, o.client_name, o.quotation?.quotation_number, o.quotation?.title,
            o.quotation?.client?.name, o.quotation?.client?.business_name, o.quotation?.items?.map((i) => i.description),
            o.progress?.stages.map((s) => s.module_name), KIND_LABEL[o.order_kind]);
    }), [accessible, status, process, kind, search]);

    const count = (s: string) => accessible.filter((o) => o.status === s).length;
    const clientOf = (o: WorkOrderRow) => partyLabel(o.quotation?.client) || o.client_name || "—";

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-3 sm:p-6 md:p-8 lg:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-[1800px] mx-auto space-y-6">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors text-neutral-400 hover:text-white border border-neutral-700">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div>
                            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                                <Factory className="w-8 h-8 text-orange-400" /> Fabricación
                            </h1>
                            <p className="text-neutral-400 text-sm mt-1">Todas las órdenes de trabajo en una lista. Cada OT pasa por sus etapas: maquinado, soldadura y/o automatización.</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <button onClick={load} disabled={loading} className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg transition-colors flex items-center gap-2 text-sm">
                            <RefreshCw className={cn("w-4 h-4 text-orange-400", loading && "animate-spin")} /> Actualizar
                        </button>
                        <Link href="/manufacturing/garantias" className="flex items-center gap-2 bg-neutral-800/70 hover:bg-neutral-700 text-amber-200 border border-amber-500/30 px-4 py-2.5 rounded-xl text-sm font-medium">
                            <Wrench className="w-4 h-4" /> Garantías y reparaciones
                        </Link>
                        {canCreate && (
                            <Link href="/manufacturing/new" className="flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-5 py-2.5 rounded-xl font-medium transition-all active:scale-95">
                                <Plus className="w-5 h-5" /> Nueva OT
                            </Link>
                        )}
                    </div>
                </header>

                <input aria-label="Buscar órdenes de trabajo" value={search} onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar OT, cotización, descripción, cliente o proceso…"
                    className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-white" />

                <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-neutral-500 uppercase tracking-wider mr-1 flex items-center gap-1"><Filter className="w-3.5 h-3.5" /> Estado</span>
                        {STATUS_FILTERS.map((s) => (
                            <button key={s} onClick={() => setStatus(s)} className={cn("text-xs px-3 py-1.5 rounded-full border transition-colors",
                                status === s ? "bg-white/10 text-white border-white/20" : "bg-neutral-800/40 text-neutral-400 border-neutral-700/50 hover:bg-neutral-800")}>
                                {s === "all" ? `Todas (${accessible.length})` : `${STATUS_LABEL[s]} (${count(s)})`}
                            </button>
                        ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-neutral-500 uppercase tracking-wider mr-1">Proceso</span>
                        {["all", ...processes].map((p) => (
                            <button key={p} onClick={() => setProcess(p)} className={cn("text-xs px-3 py-1.5 rounded-full border transition-colors",
                                process === p ? "bg-orange-500/15 text-orange-200 border-orange-500/40" : "bg-neutral-800/40 text-neutral-400 border-neutral-700/50 hover:bg-neutral-800")}>
                                {p === "all" ? "Todos" : PROCESS_LABEL[p] || p}
                            </button>
                        ))}
                        <span className="text-xs text-neutral-500 uppercase tracking-wider ml-3 mr-1">Tipo</span>
                        {([["all", "Todas"], ["normal", "Normales"], ["garantia_reparacion", "Garantías / reparaciones"]] as const).map(([value, label]) => (
                            <button key={value} onClick={() => setKind(value)} className={cn("text-xs px-3 py-1.5 rounded-full border transition-colors",
                                kind === value ? "bg-amber-500/15 text-amber-200 border-amber-500/40" : "bg-neutral-800/40 text-neutral-400 border-neutral-700/50 hover:bg-neutral-800")}>
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}

                <div className="hidden lg:block bg-neutral-800/40 border border-neutral-700/50 rounded-3xl overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-neutral-900/50 text-neutral-400 uppercase text-xs font-semibold tracking-wider">
                                <tr>
                                    <th className="px-5 py-4">OT #</th>
                                    <th className="px-5 py-4">Título / cliente</th>
                                    <th className="px-5 py-4">Cotización</th>
                                    <th className="px-5 py-4">Etapas</th>
                                    <th className="px-5 py-4">Piezas</th>
                                    <th className="px-5 py-4">Prioridad</th>
                                    <th className="px-5 py-4">Estatus</th>
                                    <th className="px-5 py-4 text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-700/50">
                                {loading ? (
                                    <tr><td colSpan={8} className="px-6 py-12 text-center text-neutral-400"><RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-orange-400" />Cargando…</td></tr>
                                ) : filtered.length === 0 ? (
                                    <tr><td colSpan={8} className="px-6 py-12 text-center text-neutral-400">No hay órdenes con estos filtros.</td></tr>
                                ) : filtered.map((o) => (
                                    <tr key={o.id} className="hover:bg-neutral-800/80 transition-colors">
                                        <td className="px-5 py-4 whitespace-nowrap align-top">
                                            <span className="font-mono font-medium text-orange-300 bg-orange-500/10 px-2.5 py-1 rounded-md border border-orange-500/20">{o.order_number}</span>
                                            {o.order_kind !== "normal" && <span className="block mt-1.5 text-[10px] font-semibold uppercase text-amber-300">{KIND_LABEL[o.order_kind]}</span>}
                                            {o.warranty_count > 0 && <span className="block mt-1.5 text-[10px] text-amber-300">Garantía #{o.warranty_count} (anterior)</span>}
                                        </td>
                                        <td className="px-5 py-4 align-top max-w-xs">
                                            <p className="text-neutral-100 truncate" title={o.work_title || ""}>{o.work_title || "—"}</p>
                                            <p className="text-xs text-neutral-500 truncate">{clientOf(o)}</p>
                                        </td>
                                        <td className="px-5 py-4 align-top whitespace-nowrap">
                                            {o.quotation?.quotation_number
                                                ? <span className="font-mono text-emerald-300 text-xs bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">{o.quotation.quotation_number}</span>
                                                : <span className="text-xs text-neutral-500 italic">Sin cotización</span>}
                                        </td>
                                        <td className="px-5 py-4 align-top"><StageChain stages={o.progress?.stages || []} target={Number(o.quantity)} /></td>
                                        <td className="px-5 py-4 align-top min-w-[170px]">
                                            <PiecesCell order={o} />
                                        </td>
                                        <td className="px-5 py-4 align-top text-xs text-neutral-300 whitespace-nowrap">{o.priority || "Normal"}</td>
                                        <td className="px-5 py-4 align-top whitespace-nowrap">
                                            <span className={cn("px-2.5 py-1 rounded-full text-xs font-semibold border", STATUS_STYLE[o.status] || STATUS_STYLE.Open)}>{STATUS_LABEL[o.status] || o.status}</span>
                                            <p className="text-[11px] text-neutral-500 mt-1.5">{new Date(o.created_at).toLocaleDateString("es-MX")}</p>
                                        </td>
                                        <td className="px-5 py-4 align-top text-right whitespace-nowrap">
                                            <Link href={`/manufacturing/ot/${o.id}`} className="inline-flex items-center gap-1.5 text-xs font-medium text-orange-400 hover:text-orange-300 bg-orange-500/10 hover:bg-orange-500/20 px-3 py-1.5 rounded-lg border border-orange-500/20">
                                                <Eye className="w-3.5 h-3.5" /> Abrir
                                            </Link>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="lg:hidden space-y-3">
                    {loading ? (
                        <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-8 text-center text-neutral-400"><RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-orange-400" />Cargando…</div>
                    ) : filtered.length === 0 ? (
                        <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-8 text-center text-neutral-400">No hay órdenes con estos filtros.</div>
                    ) : filtered.map((o) => (
                        <Link key={o.id} href={`/manufacturing/ot/${o.id}`} className="block bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-4 hover:bg-neutral-800/60 transition-colors space-y-3">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <span className="font-mono font-medium text-orange-300 bg-orange-500/10 px-2.5 py-1 rounded-md border border-orange-500/20 text-xs">{o.order_number}</span>
                                    {o.order_kind !== "normal" && <span className="ml-2 text-[10px] font-semibold uppercase text-amber-300">{KIND_LABEL[o.order_kind]}</span>}
                                    <p className="text-white font-medium mt-2 break-words">{o.work_title || "—"}</p>
                                    <p className="text-xs text-neutral-500">{clientOf(o)}{o.quotation?.quotation_number ? ` · ${o.quotation.quotation_number}` : ""}</p>
                                </div>
                                <span className={cn("shrink-0 px-2.5 py-1 rounded-full text-[10px] font-semibold border", STATUS_STYLE[o.status] || STATUS_STYLE.Open)}>{STATUS_LABEL[o.status] || o.status}</span>
                            </div>
                            <StageChain stages={o.progress?.stages || []} target={Number(o.quantity)} compact />
                            <PiecesCell order={o} />
                        </Link>
                    ))}
                </div>

                <p className="text-xs text-neutral-500 flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" /> Las piezas pasan a Calidad cuando la última etapa las cierra; Calidad puede liberar por partes y Entregas entrega por partes.</p>
            </div>
        </div>
    );
}

function PiecesCell({ order }: { order: WorkOrderRow }) {
    const p = order.progress;
    const target = Number(order.quantity);
    if (!p) return <span className="text-xs text-neutral-500">{qty(target)} {order.unit}</span>;
    return (
        <div className="space-y-1 text-xs">
            <p className="text-neutral-200"><span className="font-semibold">{qty(p.qty_released)}</span> de {qty(target)} {order.unit} liberadas</p>
            <ProgressBar value={Number(p.qty_released)} total={target} />
            <p className="text-neutral-500">
                {Number(p.qty_pending_qc) > 0 && <span className="text-yellow-300">{qty(p.qty_pending_qc)} en Calidad · </span>}
                {qty(p.qty_delivered)} entregadas{Number(p.qty_in_delivery) > 0 ? ` · ${qty(p.qty_in_delivery)} por entregar` : ""}
            </p>
        </div>
    );
}
