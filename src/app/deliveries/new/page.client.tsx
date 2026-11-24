"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { ArrowLeft, PackageCheck, Save, AlertCircle, RefreshCw, Truck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { createDeliveryAction } from "@/app/actions/manufacturing";
import { matchesSearch } from "@/lib/search";

type Option = {
    id: string;
    order_number: string;
    work_title: string | null;
    unit: string;
    quantity: number;
    order_kind: string;
    client: string;
    quotation_number: string | null;
    released: number;
    delivered: number;
    inDelivery: number;
    deliverable: number;
    pendingQc: number;
};

const one = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""));

function NewDeliveryForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const preselected = searchParams?.get("ot") || "";
    const [options, setOptions] = useState<Option[]>([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [selectedId, setSelectedId] = useState(preselected);
    const [quantity, setQuantity] = useState("");
    const [observations, setObservations] = useState("");
    const [shippingMethod, setShippingMethod] = useState("");
    const [shippingAddress, setShippingAddress] = useState("");
    const [shippingCarrier, setShippingCarrier] = useState("");
    const [trackingNumber, setTrackingNumber] = useState("");

    useEffect(() => {
        (async () => {
            try {
                // OT con piezas liberadas por Calidad que aún no tienen nota de entrega.
                const { data: progress, error } = await supabase.from("v_work_order_progress")
                    .select("work_order_id, qty_released, qty_delivered, qty_in_delivery, qty_deliverable, qty_pending_qc")
                    .or("qty_deliverable.gt.0,qty_pending_qc.gt.0");
                if (error) throw error;
                const ids = (progress || []).map((p) => p.work_order_id);
                if (preselected && !ids.includes(preselected)) ids.push(preselected);
                if (ids.length === 0) { setOptions([]); return; }
                const { data: orders, error: ordersError } = await supabase.from("work_orders")
                    .select("id, order_number, work_title, unit, quantity, order_kind, status, client_name, quotation:quotations(quotation_number, client:clients(name, business_name))")
                    .in("id", ids).neq("status", "Cancelled");
                if (ordersError) throw ordersError;
                const byId = new Map((progress || []).map((p) => [p.work_order_id, p]));
                setOptions((orders || []).map((o: any) => {
                    const p = byId.get(o.id);
                    const quotation = one(o.quotation) as any;
                    const client = one(quotation?.client) as any;
                    return {
                        id: o.id, order_number: o.order_number, work_title: o.work_title, unit: o.unit, quantity: Number(o.quantity), order_kind: o.order_kind,
                        client: client ? [client.name, client.business_name].filter(Boolean).join(" · ") : o.client_name || "—",
                        quotation_number: quotation?.quotation_number || null,
                        released: Number(p?.qty_released || 0), delivered: Number(p?.qty_delivered || 0), inDelivery: Number(p?.qty_in_delivery || 0),
                        deliverable: Number(p?.qty_deliverable || 0), pendingQc: Number(p?.qty_pending_qc || 0),
                    };
                }).sort((a, b) => b.deliverable - a.deliverable || a.order_number.localeCompare(b.order_number)));
            } catch (err) {
                setErrorMsg(err instanceof Error ? err.message : "No se pudieron cargar las OT disponibles.");
            } finally {
                setLoading(false);
            }
        })();
    }, [preselected]);

    const selected = options.find((o) => o.id === selectedId) || null;
    useEffect(() => { if (selected) setQuantity(fmt(selected.deliverable)); }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps
    const visible = useMemo(() => options.filter((o) => matchesSearch(search, o.order_number, o.work_title, o.client, o.quotation_number)), [options, search]);
    const value = Number(quantity);
    const valid = !!selected && Number.isFinite(value) && value > 0 && value <= selected.deliverable;

    const onSubmit = async () => {
        if (!selected || !valid) { setErrorMsg("Selecciona una OT y una cantidad válida."); return; }
        setSubmitting(true);
        setErrorMsg(null);
        try {
            await createDeliveryAction({
                workOrderId: selected.id, quantity: value, observations, shippingMethod, shippingAddress, shippingCarrier, trackingNumber,
            });
            router.push("/deliveries");
        } catch (error) {
            setErrorMsg(error instanceof Error ? error.message : "Error al crear la entrega.");
            setSubmitting(false);
        }
    };

    const input = "w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-4 py-3 text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20";

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-3 sm:p-6 md:p-8 lg:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-4xl mx-auto space-y-8">
                <header className="flex items-center gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <Link href="/deliveries" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors text-neutral-400 hover:text-white border border-neutral-700"><ArrowLeft className="w-5 h-5" /></Link>
                    <div>
                        <h1 className="text-3xl font-bold text-white flex items-center gap-3"><PackageCheck className="w-8 h-8 text-emerald-400" /> Nueva Entrega</h1>
                        <p className="text-neutral-400 text-sm mt-1">Entrega completa o parcial de las piezas que ya liberó Calidad.</p>
                    </div>
                </header>

                {errorMsg && <div role="alert" className="p-4 rounded-xl border bg-red-500/10 border-red-500/30 text-red-400 flex items-center gap-3"><AlertCircle className="w-5 h-5" />{errorMsg}</div>}

                <section className="bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 space-y-3">
                    <h2 className="text-lg font-semibold text-white">Orden de trabajo</h2>
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar OT, cliente o cotización…" className={input} />
                    {loading ? <p className="text-sm text-neutral-400 flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" /> Cargando…</p> : visible.length === 0 ? (
                        <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 text-sm text-amber-200 space-y-2">
                            <p className="font-semibold">No hay piezas liberadas pendientes de entregar.</p>
                            <p className="text-amber-300/80 text-xs">Las piezas aparecen aquí cuando Calidad libera un lote. Puede ser parcial: si de 4 piezas se liberan 2, ya puedes entregar esas 2.</p>
                            <Link href="/quality" className="inline-flex text-xs text-sky-300 hover:text-white bg-sky-500/10 px-3 py-1.5 rounded-lg border border-sky-500/20">Ir a Calidad →</Link>
                        </div>
                    ) : (
                        <ul className="max-h-80 overflow-y-auto rounded-xl border border-neutral-700/50 divide-y divide-neutral-800/60 bg-neutral-900/40">
                            {visible.map((o) => {
                                const disabled = o.deliverable <= 0;
                                return (
                                    <li key={o.id}>
                                        <button type="button" disabled={disabled} onClick={() => setSelectedId(o.id)}
                                            className={`w-full text-left p-3 flex items-center gap-3 ${selectedId === o.id ? "bg-emerald-500/10 ring-1 ring-emerald-500/40" : "hover:bg-neutral-800/60"} disabled:opacity-50 disabled:cursor-not-allowed`}>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm text-white"><span className="font-mono text-orange-300">{o.order_number}</span> · {o.work_title || "—"}</p>
                                                <p className="text-[11px] text-neutral-500">{o.client}{o.quotation_number ? ` · ${o.quotation_number}` : ""}</p>
                                            </div>
                                            <div className="text-right text-xs">
                                                <p className={disabled ? "text-neutral-400" : "text-emerald-300 font-semibold"}>{fmt(o.deliverable)} {o.unit} por entregar</p>
                                                <p className="text-neutral-500">{fmt(o.released)} de {fmt(o.quantity)} liberadas · {fmt(o.delivered + o.inDelivery)} con nota{o.pendingQc > 0 ? ` · ${fmt(o.pendingQc)} en Calidad` : ""}</p>
                                            </div>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                    {selected && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-neutral-900/40 p-4 rounded-xl border border-neutral-700/30">
                            <label className="text-sm text-neutral-300">Piezas a entregar
                                <input type="number" min="0.01" step="any" max={selected.deliverable} value={quantity} onChange={(e) => setQuantity(e.target.value)} className={`${input} mt-1 text-lg font-semibold`} />
                            </label>
                            <div className="text-xs text-neutral-400 self-end space-y-1">
                                <p>Disponibles: <span className="text-emerald-300 font-semibold">{fmt(selected.deliverable)} {selected.unit}</span></p>
                                {valid && value < selected.deliverable && <p className="text-amber-300">Entrega parcial: quedarán {fmt(selected.deliverable - value)} {selected.unit} liberadas para otra nota.</p>}
                                {!valid && quantity !== "" && <p className="text-red-300">Debe ser mayor a cero y no más de {fmt(selected.deliverable)}.</p>}
                                <p>El folio se asigna al guardar (NE-…; las entregas siguientes de la misma OT llevan -2, -3…).</p>
                            </div>
                        </div>
                    )}
                </section>

                <section className="bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50">
                    <h2 className="text-lg font-semibold text-white mb-4">Observaciones</h2>
                    <textarea value={observations} onChange={(e) => setObservations(e.target.value)} className={`${input} min-h-[100px]`} placeholder="Observaciones sobre la entrega, condiciones del producto, etc." />
                </section>

                <section className="bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50">
                    <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2"><Truck className="w-5 h-5 text-orange-400" /> Datos de envío (opcional)</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <label className="space-y-2 text-sm font-medium text-neutral-300">Método de envío
                            <select value={shippingMethod} onChange={(e) => setShippingMethod(e.target.value)} className={input}>
                                <option value="">Ninguno / Recolección</option>
                                <option value="Paquetería">Paquetería</option>
                                <option value="Envío propio">Envío propio</option>
                                <option value="Flete">Flete</option>
                                <option value="Otro">Otro</option>
                            </select>
                        </label>
                        <label className="space-y-2 text-sm font-medium text-neutral-300">Paquetería / Carrier<input value={shippingCarrier} onChange={(e) => setShippingCarrier(e.target.value)} className={input} placeholder="Ej: DHL, FedEx, Estafeta" /></label>
                        <label className="space-y-2 text-sm font-medium text-neutral-300">No. de guía<input value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} className={input} placeholder="Número de rastreo" /></label>
                        <label className="space-y-2 text-sm font-medium text-neutral-300">Dirección de envío<input value={shippingAddress} onChange={(e) => setShippingAddress(e.target.value)} className={input} placeholder="Dirección completa del destinatario" /></label>
                    </div>
                </section>

                <div className="flex justify-end">
                    <button onClick={onSubmit} disabled={submitting || !valid}
                        className="w-full md:w-auto bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-500/50 text-white px-10 py-4 rounded-xl font-bold flex items-center justify-center gap-2 text-lg disabled:cursor-not-allowed">
                        {submitting ? <><RefreshCw className="w-5 h-5 animate-spin" /> Creando…</> : <><Save className="w-5 h-5" /> Crear nota de entrega</>}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function NewDeliveryPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center"><RefreshCw className="w-8 h-8 animate-spin text-emerald-400" /></div>}>
            <NewDeliveryForm />
        </Suspense>
    );
}
