"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, Wrench, ShieldCheck, ClipboardList, Eye } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { matchesSearch, partyLabel } from "@/lib/search";
import { listWarrantyRecordsAction, type WarrantyRecord } from "@/app/actions/manufacturing";
import { cn, qty, STATUS_LABEL, STATUS_STYLE } from "../shared";

type ClosedOrder = {
    id: string; order_number: string; work_title: string | null; status: string; quantity: number; unit: string;
    client: string; quotation_number: string | null; released: number; delivered: number; releasedAt: string | null;
    openings: number;
};

const one = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);

export default function WarrantiesClient({ canOpen }: { canOpen: boolean }) {
    const [tab, setTab] = useState<"registro" | "cerradas">("registro");
    const [records, setRecords] = useState<WarrantyRecord[]>([]);
    const [closed, setClosed] = useState<ClosedOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [search, setSearch] = useState("");
    const [kind, setKind] = useState<"all" | "garantia" | "reparacion">("all");

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const [registry, progress] = await Promise.all([
                listWarrantyRecordsAction(),
                supabase.from("v_work_order_progress").select("work_order_id, qty_released, qty_delivered").gt("qty_released", 0),
            ]);
            setRecords(registry);
            if (progress.error) throw progress.error;
            const ids = (progress.data || []).map((p) => p.work_order_id);
            if (ids.length) {
                const { data: orders, error: ordersError } = await supabase.from("work_orders")
                    .select("id, order_number, work_title, status, quantity, unit, order_kind, client_name, qc_released_at, quotation:quotations(quotation_number, client:clients(name, business_name))")
                    .in("id", ids).eq("order_kind", "normal").neq("status", "Cancelled").order("created_at", { ascending: false });
                if (ordersError) throw ordersError;
                const byId = new Map((progress.data || []).map((p) => [p.work_order_id, p]));
                const openings = new Map<string, number>();
                registry.forEach((r) => openings.set(r.parent.id, (openings.get(r.parent.id) || 0) + 1));
                setClosed((orders || []).map((o: any) => {
                    const quotation = one(o.quotation) as any;
                    return {
                        id: o.id, order_number: o.order_number, work_title: o.work_title, status: o.status, quantity: Number(o.quantity), unit: o.unit,
                        client: partyLabel(one(quotation?.client)) || o.client_name || "—", quotation_number: quotation?.quotation_number || null,
                        released: Number(byId.get(o.id)?.qty_released || 0), delivered: Number(byId.get(o.id)?.qty_delivered || 0),
                        releasedAt: o.qc_released_at, openings: openings.get(o.id) || 0,
                    };
                }));
            } else {
                setClosed([]);
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : "No se pudo cargar.");
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { load(); }, [load]);

    const visibleRecords = useMemo(() => records.filter((r) => (kind === "all" || r.kind === kind)
        && matchesSearch(search, r.parent.orderNumber, r.parent.workTitle, r.child?.orderNumber, r.reason, r.openedBy)), [records, kind, search]);
    const visibleClosed = useMemo(() => closed.filter((o) => matchesSearch(search, o.order_number, o.work_title, o.client, o.quotation_number)), [closed, search]);
    const totals = useMemo(() => ({
        garantias: records.filter((r) => r.kind === "garantia").length,
        reparaciones: records.filter((r) => r.kind === "reparacion").length,
        abiertas: records.filter((r) => r.child && !["QC_Released", "Cancelled"].includes(r.child.status)).length,
    }), [records]);

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-3 sm:p-6 md:p-8 lg:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-[1600px] mx-auto space-y-6">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50">
                    <div className="flex items-center gap-4">
                        <Link href="/manufacturing" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl text-neutral-400 hover:text-white border border-neutral-700"><ArrowLeft className="w-5 h-5" /></Link>
                        <div>
                            <h1 className="text-3xl font-bold text-white flex items-center gap-3"><Wrench className="w-8 h-8 text-amber-400" /> Garantías y reparaciones</h1>
                            <p className="text-neutral-400 text-sm mt-1">Registro de cada OT cerrada que regresó, y desde aquí se reabre como garantía o reparación.</p>
                        </div>
                    </div>
                    <button onClick={load} disabled={loading} className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg flex items-center gap-2 text-sm">
                        <RefreshCw className={cn("w-4 h-4 text-amber-400", loading && "animate-spin")} /> Actualizar
                    </button>
                </header>

                <div className="grid grid-cols-3 gap-3 max-w-xl">
                    <Stat label="Garantías" value={totals.garantias} />
                    <Stat label="Reparaciones" value={totals.reparaciones} />
                    <Stat label="En proceso" value={totals.abiertas} />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => setTab("registro")} className={cn("px-4 py-2 rounded-xl text-sm font-medium border flex items-center gap-2",
                        tab === "registro" ? "bg-amber-500/15 text-amber-200 border-amber-500/40" : "bg-neutral-800/40 text-neutral-400 border-neutral-700/50")}>
                        <ClipboardList className="w-4 h-4" /> Registro ({records.length})
                    </button>
                    <button onClick={() => setTab("cerradas")} className={cn("px-4 py-2 rounded-xl text-sm font-medium border flex items-center gap-2",
                        tab === "cerradas" ? "bg-emerald-500/15 text-emerald-200 border-emerald-500/40" : "bg-neutral-800/40 text-neutral-400 border-neutral-700/50")}>
                        <ShieldCheck className="w-4 h-4" /> OT cerradas / entregadas ({closed.length})
                    </button>
                    {tab === "registro" && ([["all", "Todas"], ["garantia", "Garantías"], ["reparacion", "Reparaciones"]] as const).map(([value, label]) => (
                        <button key={value} onClick={() => setKind(value)} className={cn("text-xs px-3 py-1.5 rounded-full border",
                            kind === value ? "bg-white/10 text-white border-white/20" : "bg-neutral-800/40 text-neutral-400 border-neutral-700/50")}>{label}</button>
                    ))}
                </div>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar folio, cliente, motivo…" className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-white" />
                {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}

                {loading ? (
                    <div className="p-12 text-center text-neutral-400"><RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-amber-400" /> Cargando…</div>
                ) : tab === "registro" ? (
                    visibleRecords.length === 0 ? <Empty text="No hay garantías ni reparaciones registradas." /> : (
                        <ul className="space-y-3">
                            {visibleRecords.map((r) => (
                                <li key={r.id} className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-4 flex flex-col md:flex-row md:items-center gap-3">
                                    <div className="flex-1 min-w-0 space-y-1">
                                        <p className="text-sm">
                                            <span className={cn("text-[10px] font-bold uppercase px-2 py-0.5 rounded border mr-2", r.kind === "garantia" ? "border-amber-500/40 text-amber-300" : "border-sky-500/40 text-sky-300")}>{r.kind === "garantia" ? "Garantía" : "Reparación"}</span>
                                            <Link href={`/manufacturing/ot/${r.parent.id}`} className="font-mono text-orange-300 hover:underline">{r.parent.orderNumber}</Link>
                                            {r.child ? <> → <Link href={`/manufacturing/ot/${r.child.id}`} className="font-mono text-amber-300 hover:underline">{r.child.orderNumber}</Link></> : <span className="text-xs text-neutral-500"> (reabierta en la misma OT, flujo anterior)</span>}
                                            {r.quantity !== null && <span className="text-xs text-neutral-400"> · {qty(r.quantity)} pzas</span>}
                                        </p>
                                        <p className="text-sm text-neutral-200">{r.reason}</p>
                                        <p className="text-xs text-neutral-500">{r.parent.workTitle || ""} · Abrió {r.openedBy} · {new Date(r.openedAt).toLocaleString("es-MX")}</p>
                                    </div>
                                    {r.child && <span className={cn("self-start md:self-center px-2.5 py-1 rounded-full text-xs font-semibold border", STATUS_STYLE[r.child.status])}>{STATUS_LABEL[r.child.status] || r.child.status}</span>}
                                </li>
                            ))}
                        </ul>
                    )
                ) : visibleClosed.length === 0 ? <Empty text="Aún no hay OT con piezas liberadas." /> : (
                    <ul className="space-y-3">
                        {visibleClosed.map((o) => (
                            <li key={o.id} className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-4 flex flex-col md:flex-row md:items-center gap-3">
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm text-white"><span className="font-mono text-orange-300">{o.order_number}</span> · {o.work_title || "—"}</p>
                                    <p className="text-xs text-neutral-500">{o.client}{o.quotation_number ? ` · ${o.quotation_number}` : ""} · {qty(o.released)} de {qty(o.quantity)} {o.unit} liberadas · {qty(o.delivered)} entregadas
                                        {o.releasedAt ? ` · cerrada ${new Date(o.releasedAt).toLocaleDateString("es-MX")}` : ""}{o.openings > 0 ? ` · ${o.openings} garantía(s)/reparación(es)` : ""}</p>
                                </div>
                                <div className="flex gap-2">
                                    <Link href={`/manufacturing/ot/${o.id}`} className="text-xs text-neutral-200 border border-neutral-600 px-3 py-1.5 rounded-lg flex items-center gap-1.5"><Eye className="w-3.5 h-3.5" /> Ver</Link>
                                    {canOpen && <Link href={`/manufacturing/ot/${o.id}?garantia=1`} className="text-xs font-semibold text-amber-200 border border-amber-500/40 hover:bg-amber-500/10 px-3 py-1.5 rounded-lg flex items-center gap-1.5"><Wrench className="w-3.5 h-3.5" /> Reabrir como garantía / reparación</Link>}
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}

function Stat({ label, value }: { label: string; value: number }) {
    return (
        <div className="bg-neutral-800/40 rounded-xl border border-neutral-700/50 p-3 text-center">
            <p className="text-2xl font-bold text-white tabular-nums">{value}</p>
            <p className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</p>
        </div>
    );
}

function Empty({ text }: { text: string }) {
    return <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl p-12 text-center text-neutral-400"><Wrench className="w-10 h-10 mx-auto mb-3 opacity-40" />{text}</div>;
}
