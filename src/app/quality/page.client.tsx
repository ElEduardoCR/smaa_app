"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, RefreshCw, ShieldCheck, Eye, Clock, CheckCircle2 } from "lucide-react";
import { cn, ProcessIcon, processColor, qty } from "@/app/manufacturing/shared";

type Lot = {
    id: string;
    sequence_no: number;
    quantity: number;
    qc_status: string;
    qc_released_qty: number | null;
    qc_rejected_qty: number | null;
    qc_decided_at: string | null;
    qc_decided_by_name: string | null;
    operator_name: string;
    closed_at: string;
    work_order: {
        id: string; order_number: string; work_title: string | null; unit: string; quantity: number; order_kind: string; client_name: string | null;
        quotation: { client: { name?: string | null; business_name: string } | null } | null;
    } | null;
    stage: { module: { code: string; name: string; icon: string } | null } | null;
};

const one = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);

function normalize(rows: any[]): Lot[] {
    return rows.map((row) => {
        const wo = one(row.work_order) as any;
        const quotation = wo ? one(wo.quotation) as any : null;
        const stage = one(row.stage) as any;
        return {
            ...row,
            quantity: Number(row.quantity),
            work_order: wo ? { ...wo, quotation: quotation ? { client: one(quotation.client) } : null } : null,
            stage: stage ? { module: one(stage.module) } : null,
        };
    });
}

const SELECT = `id, sequence_no, quantity, qc_status, qc_released_qty, qc_rejected_qty, qc_decided_at, qc_decided_by_name, operator_name, closed_at,
    work_order:work_orders(id, order_number, work_title, unit, quantity, order_kind, client_name, quotation:quotations(client:clients(name, business_name))),
    stage:work_order_stages(module:manufacturing_modules(code, name, icon))`;

export default function QualityPage() {
    const [queue, setQueue] = useState<Lot[]>([]);
    const [decided, setDecided] = useState<Lot[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [tab, setTab] = useState<"queue" | "decided">("queue");

    const load = async () => {
        setLoading(true);
        setError("");
        try {
            const [pending, recent] = await Promise.all([
                supabase.from("work_order_closures").select(SELECT).eq("qc_status", "pending").order("closed_at", { ascending: true }),
                supabase.from("work_order_closures").select(SELECT).in("qc_status", ["released", "rejected"]).order("qc_decided_at", { ascending: false }).limit(30),
            ]);
            if (pending.error) throw pending.error;
            if (recent.error) throw recent.error;
            setQueue(normalize(pending.data || []));
            setDecided(normalize(recent.data || []));
        } catch (e) {
            setError(e instanceof Error ? e.message : "No se pudo cargar la cola de Calidad.");
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { load(); }, []);

    const rows = tab === "queue" ? queue : decided;
    const pendingPieces = queue.reduce((sum, lot) => sum + lot.quantity, 0);

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-3 sm:p-6 md:p-8 lg:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-[1800px] mx-auto space-y-6">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors text-neutral-400 hover:text-white border border-neutral-700"><ArrowLeft className="w-5 h-5" /></Link>
                        <div>
                            <h1 className="text-3xl font-bold text-white flex items-center gap-3"><ShieldCheck className="w-8 h-8 text-sky-400" /> Calidad</h1>
                            <p className="text-neutral-400 text-sm mt-1">Lotes de piezas que cerró la última etapa de cada OT. Se pueden liberar completos o por partes.</p>
                        </div>
                    </div>
                    <button onClick={load} className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg flex items-center gap-2 text-sm" disabled={loading}>
                        <RefreshCw className={cn("w-4 h-4", loading && "animate-spin text-sky-400")} /> Actualizar
                    </button>
                </header>

                <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => setTab("queue")} className={cn("px-4 py-2 rounded-xl text-sm font-medium border flex items-center gap-2",
                        tab === "queue" ? "bg-sky-500/15 text-sky-300 border-sky-500/40" : "bg-neutral-800/40 text-neutral-400 border-neutral-700/50 hover:bg-neutral-800")}>
                        <Clock className="w-4 h-4" /> Por revisar ({queue.length} lote{queue.length === 1 ? "" : "s"} · {qty(pendingPieces)} pzas)
                    </button>
                    <button onClick={() => setTab("decided")} className={cn("px-4 py-2 rounded-xl text-sm font-medium border flex items-center gap-2",
                        tab === "decided" ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40" : "bg-neutral-800/40 text-neutral-400 border-neutral-700/50 hover:bg-neutral-800")}>
                        <CheckCircle2 className="w-4 h-4" /> Decisiones recientes
                    </button>
                </div>

                {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}

                <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl overflow-hidden">
                    {loading ? (
                        <div className="p-12 text-center text-neutral-400"><RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-sky-400" /> Cargando…</div>
                    ) : rows.length === 0 ? (
                        <div className="p-12 text-center text-neutral-400">
                            <ShieldCheck className="w-10 h-10 mx-auto mb-3 opacity-40" />
                            <p>{tab === "queue" ? "No hay piezas esperando revisión." : "Sin decisiones recientes."}</p>
                        </div>
                    ) : (
                        <ul className="divide-y divide-neutral-700/50">
                            {rows.map((lot) => {
                                const wo = lot.work_order;
                                const stageModule = lot.stage?.module;
                                const client = wo?.quotation?.client ? [wo.quotation.client.name, wo.quotation.client.business_name].filter(Boolean).join(" · ") : wo?.client_name;
                                return (
                                    <li key={lot.id} className="p-4 flex items-center gap-4 hover:bg-neutral-800/60 transition-colors">
                                        <ProcessIcon icon={stageModule?.icon} className={cn("w-6 h-6", processColor(stageModule?.code || "").text)} />
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-mono text-orange-300 text-xs bg-orange-500/10 px-2 py-0.5 rounded border border-orange-500/20">{wo?.order_number}</span>
                                                <span className="text-sm text-white font-semibold">{qty(lot.quantity)} {wo?.unit} <span className="text-neutral-500 font-normal">de {qty(wo?.quantity)} · lote #{lot.sequence_no}</span></span>
                                                {wo?.order_kind && wo.order_kind !== "normal" && <span className="text-[10px] uppercase text-amber-300">{wo.order_kind === "garantia" ? "Garantía" : "Reparación"}</span>}
                                            </div>
                                            <p className="text-sm text-neutral-200 mt-0.5 truncate">{wo?.work_title || "—"}</p>
                                            <p className="text-[11px] text-neutral-500 mt-0.5">
                                                {client || "—"} · {stageModule?.name} cerrada por {lot.operator_name} · {new Date(lot.closed_at).toLocaleString("es-MX")}
                                            </p>
                                            {tab === "decided" && (
                                                <p className={cn("text-[11px] mt-0.5", lot.qc_status === "released" ? "text-emerald-300" : "text-red-300")}>
                                                    {qty(lot.qc_released_qty || 0)} liberadas{Number(lot.qc_rejected_qty) > 0 ? ` · ${qty(lot.qc_rejected_qty || 0)} rechazadas` : ""} · {lot.qc_decided_by_name}
                                                    {lot.qc_decided_at ? ` · ${new Date(lot.qc_decided_at).toLocaleString("es-MX")}` : ""}
                                                </p>
                                            )}
                                        </div>
                                        {wo && (
                                            <Link href={`/manufacturing/ot/${wo.id}`} className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-400 hover:text-sky-300 bg-sky-500/10 hover:bg-sky-500/20 px-3 py-1.5 rounded-lg border border-sky-500/20">
                                                <Eye className="w-3.5 h-3.5" /> {tab === "queue" ? "Revisar" : "Ver"}
                                            </Link>
                                        )}
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
