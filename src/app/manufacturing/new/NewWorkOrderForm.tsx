"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save, Factory, AlertCircle, RefreshCw, CheckCircle2, Lock, Flame, Search, ListChecks } from "lucide-react";
import { createWorkOrderAction } from "@/app/actions/manufacturing";
import { setQuotationStatusAction } from "@/app/actions/quotations";
import { matchesSearch, partyLabel } from "@/lib/search";
import { supabase } from "@/lib/supabase";
import { cn, StagePicker, type ModuleRow } from "../shared";

type Quotation = {
    id: string;
    quotation_number: string;
    title?: string | null;
    items?: { description: string; quantity: number }[];
    status: string;
    total: number | null;
    client: { name?: string | null; business_name: string; rfc?: string } | null;
};
type WpsProcedure = { id: string; code: string; name: string; joint_type: string | null; base_metal: string | null; filler_metal: string | null; position: string | null };

export default function NewWorkOrderForm({ accessibleSubs }: { accessibleSubs: string[] }) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const initialModule = searchParams?.get("module") || "";

    const [modules, setModules] = useState<ModuleRow[]>([]);
    const [stageIds, setStageIds] = useState<string[]>([]);
    const [mode, setMode] = useState<"quotation" | "adhoc">("quotation");
    const [quotations, setQuotations] = useState<Quotation[]>([]);
    const [quotationSearch, setQuotationSearch] = useState("");
    const [selectedQuotationId, setSelectedQuotationId] = useState("");
    const [confirmingQuotation, setConfirmingQuotation] = useState(false);
    const [confirmError, setConfirmError] = useState<string | null>(null);
    const [clientName, setClientName] = useState("");
    const [clientRfc, setClientRfc] = useState("");
    const [workTitle, setWorkTitle] = useState("");
    const [quantity, setQuantity] = useState("1");
    const [unit, setUnit] = useState("pza");
    const [priority, setPriority] = useState("Normal");
    const [notes, setNotes] = useState("");
    const [wpsList, setWpsList] = useState<WpsProcedure[]>([]);
    const [selectedWpsIds, setSelectedWpsIds] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            const { data } = await supabase.from("manufacturing_modules").select("id, code, name, icon").eq("is_active", true).order("sort_order");
            setModules(data || []);
            const initial = (data || []).find((m) => m.code === initialModule);
            if (initial) setStageIds([initial.id]);
        })();
    }, [initialModule]);

    useEffect(() => {
        (async () => {
            const { data, error } = await supabase
                .from("quotations")
                .select("id, title, quotation_number, status, total, items:quotation_items(description, quantity), client:clients(name, business_name, rfc)")
                .in("status", ["Draft", "Sent", "Pending", "Approved", "Confirmed"])
                .order("created_at", { ascending: false });
            if (error) { setErr(error.message); return; }
            setQuotations((data || []).map((q: any) => ({ ...q, client: Array.isArray(q.client) ? q.client[0] : q.client })));
        })();
    }, []);

    const weldingId = modules.find((m) => m.code === "soldadura")?.id;
    const isWelding = !!weldingId && stageIds.includes(weldingId);
    useEffect(() => {
        if (!isWelding) { setSelectedWpsIds([]); return; }
        supabase.from("wps_procedures").select("id, code, name, joint_type, base_metal, filler_metal, position").eq("is_active", true).order("code")
            .then(({ data }) => setWpsList(data || []));
    }, [isWelding]);

    // Sólo se ofrecen los procesos en los que el usuario puede crear OT.
    const creatableModules = modules.filter((m) => accessibleSubs.length === 0 || accessibleSubs.includes(m.code));
    const filteredQuotations = useMemo(() => quotations.filter((q) => matchesSearch(quotationSearch, q.quotation_number, q.title, q.client?.name,
        q.client?.business_name, q.client?.rfc, q.items?.map((i) => i.description))), [quotations, quotationSearch]);
    const selectedQuotation = quotations.find((q) => q.id === selectedQuotationId) || null;

    const selectQuotation = (q: Quotation) => {
        setSelectedQuotationId(q.id);
        if (!workTitle.trim()) setWorkTitle(q.title || q.items?.[0]?.description || "");
        // Con una sola partida, la cantidad de la OT es la de la cotización.
        if (q.items?.length === 1 && Number(q.items[0].quantity) > 0) setQuantity(String(Number(q.items[0].quantity)));
    };

    const handleConfirmQuotation = async () => {
        if (!selectedQuotation) return;
        setConfirmingQuotation(true);
        setConfirmError(null);
        try {
            await setQuotationStatusAction(selectedQuotation.id, "Approved");
            setQuotations((qs) => qs.map((q) => (q.id === selectedQuotation.id ? { ...q, status: "Approved" } : q)));
        } catch (e) {
            setConfirmError(e instanceof Error ? e.message : "No se pudo confirmar la cotización.");
        } finally {
            setConfirmingQuotation(false);
        }
    };

    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErr(null);
        const qtyValue = Number(quantity);
        if (stageIds.length === 0) { setErr("Agrega al menos una etapa (maquinado, soldadura o automatización)."); return; }
        if (mode === "quotation" && !selectedQuotationId) { setErr("Selecciona una cotización."); return; }
        if (mode === "quotation" && selectedQuotation && !["Approved", "Confirmed"].includes(selectedQuotation.status)) {
            setErr("La cotización seleccionada debe estar aprobada. Confírmala primero."); return;
        }
        if (mode === "adhoc" && !clientName.trim()) { setErr("Captura el nombre del cliente."); return; }
        if (isWelding && selectedWpsIds.length === 0) { setErr("Soldadura requiere al menos un WPS asignado."); return; }
        if (!workTitle.trim()) { setErr("Captura el título del trabajo."); return; }
        if (!Number.isFinite(qtyValue) || qtyValue <= 0) { setErr("La cantidad de piezas debe ser mayor a cero."); return; }
        setBusy(true);
        try {
            const { id } = await createWorkOrderAction({
                stageModuleIds: stageIds,
                quotationId: mode === "quotation" ? selectedQuotationId : null,
                clientName: mode === "adhoc" ? clientName : null,
                clientRfc: mode === "adhoc" ? clientRfc : null,
                workTitle, priority, quantity: qtyValue, unit: unit.trim() || "pza", notes: notes || null, wpsIds: selectedWpsIds,
            });
            router.push(`/manufacturing/ot/${id}`);
        } catch (e) {
            setErr(e instanceof Error ? e.message : "Error al crear la OT.");
            setBusy(false);
        }
    };

    const input = "w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20";

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-3 sm:p-6 md:p-8 lg:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-5xl mx-auto space-y-8">
                <header className="flex items-center gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <Link href="/manufacturing" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors text-neutral-400 hover:text-white border border-neutral-700">
                        <ArrowLeft className="w-5 h-5" />
                    </Link>
                    <div>
                        <h1 className="text-3xl font-bold text-white flex items-center gap-3"><Factory className="w-8 h-8 text-orange-400" /> Nueva Orden de Trabajo</h1>
                        <p className="text-neutral-400 text-sm mt-1">Una OT con sus etapas en orden: puede ser solo maquinado, maquinado y soldadura, soldadura y automatización…</p>
                    </div>
                </header>

                {err && <div role="alert" className="p-4 rounded-xl border bg-red-500/10 border-red-500/30 text-red-400 flex items-center gap-3"><AlertCircle className="w-5 h-5 flex-shrink-0" /> {err}</div>}

                <form onSubmit={onSubmit} className="space-y-6">
                    <section className="bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 space-y-3">
                        <h2 className="text-lg font-semibold text-white flex items-center gap-2"><ListChecks className="w-5 h-5 text-orange-400" /> 1) Etapas de fabricación</h2>
                        <p className="text-sm text-neutral-400">Agrégalas en el orden en que se trabajan. Cada etapa cierra piezas y se las pasa a la siguiente; la última las manda a Calidad.</p>
                        <StagePicker modules={creatableModules} value={stageIds} onChange={setStageIds} />
                        {stageIds.length === 0 && <p className="text-xs text-amber-300">Agrega al menos una etapa.</p>}
                    </section>

                    <section className="bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 space-y-4">
                        <h2 className="text-lg font-semibold text-white">2) Origen</h2>
                        <div className="grid grid-cols-2 gap-2 max-w-md">
                            {([["quotation", "Con cotización"], ["adhoc", "Sin cotización (ad-hoc)"]] as const).map(([value, label]) => (
                                <button key={value} type="button" onClick={() => setMode(value)} className={cn("px-4 py-2.5 rounded-xl border text-sm font-medium",
                                    mode === value ? "bg-orange-500/15 text-orange-300 border-orange-500/40" : "bg-neutral-900/40 text-neutral-400 border-neutral-700/50 hover:bg-neutral-800")}>{label}</button>
                            ))}
                        </div>
                        {mode === "quotation" ? (
                            <div className="space-y-3">
                                <div className="relative">
                                    <Search className="w-4 h-4 absolute left-3 top-3.5 text-neutral-500" />
                                    <input type="text" placeholder="Buscar por nombre, descripción, folio, alias o cliente…" value={quotationSearch} onChange={(e) => setQuotationSearch(e.target.value)}
                                        className="w-full pl-9 pr-3 py-2.5 bg-neutral-900/50 border border-neutral-700 rounded-lg text-white text-sm focus:outline-none focus:border-orange-500" />
                                </div>
                                <div className="max-h-72 overflow-y-auto rounded-xl border border-neutral-700/50 divide-y divide-neutral-800/60 bg-neutral-900/40">
                                    {filteredQuotations.length === 0 ? <p className="p-4 text-sm text-neutral-500 text-center">No hay cotizaciones pendientes o aprobadas.</p> : filteredQuotations.map((q) => {
                                        const approved = ["Approved", "Confirmed"].includes(q.status);
                                        return (
                                            <button type="button" key={q.id} onClick={() => selectQuotation(q)} className={cn("w-full text-left p-3 hover:bg-neutral-800/60 flex items-center gap-3", selectedQuotationId === q.id && "bg-orange-500/10 ring-1 ring-orange-500/40")}>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-mono text-emerald-300 text-xs bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">{q.quotation_number}</span>
                                                        <span className="text-sm text-white truncate">{partyLabel(q.client)}</span>
                                                    </div>
                                                    <p className="text-sm text-neutral-200 mt-1">{q.title || q.items?.[0]?.description || "Sin nombre"}</p>
                                                    <p className="text-[11px] text-neutral-500 mt-1">{q.client?.rfc ? `RFC ${q.client.rfc} · ` : ""}{q.total ? `Total $${Number(q.total).toLocaleString("es-MX", { minimumFractionDigits: 2 })}` : ""}</p>
                                                </div>
                                                <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border uppercase tracking-wider",
                                                    approved ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" : "bg-amber-500/10 text-amber-300 border-amber-500/30")}>{approved ? "Aprobada" : q.status}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                                {selectedQuotation && !["Approved", "Confirmed"].includes(selectedQuotation.status) && (
                                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                                        <Lock className="w-5 h-5 text-amber-400 flex-shrink-0" />
                                        <div className="flex-1">
                                            <p className="text-sm text-amber-200">Esta cotización aún no está aprobada. La OT no puede crearse hasta confirmarla.</p>
                                            {confirmError && <p className="text-xs text-red-400 mt-1">{confirmError}</p>}
                                        </div>
                                        <button type="button" onClick={handleConfirmQuotation} disabled={confirmingQuotation} className="text-sm font-semibold bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg flex items-center gap-1.5 disabled:opacity-50">
                                            {confirmingQuotation ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Confirmar cotización
                                        </button>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <label className="text-xs text-neutral-400 ml-1">Cliente *<input value={clientName} onChange={(e) => setClientName(e.target.value)} className={input} placeholder="Nombre del cliente" /></label>
                                <label className="text-xs text-neutral-400 ml-1">RFC (opcional)<input value={clientRfc} onChange={(e) => setClientRfc(e.target.value.toUpperCase())} className={input} placeholder="XAXX010101000" maxLength={13} /></label>
                            </div>
                        )}
                    </section>

                    <section className="bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 space-y-3">
                        <h2 className="text-lg font-semibold text-white">3) Detalles del trabajo</h2>
                        <label className="block text-xs text-neutral-400 ml-1">Título del trabajo *<input value={workTitle} onChange={(e) => setWorkTitle(e.target.value)} className={input} placeholder="Ej. Fabricación de brida 4″ acero al carbón" /></label>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <label className="text-xs text-neutral-400 ml-1">Cantidad de piezas *<input type="number" min="0.01" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={input} /></label>
                            <label className="text-xs text-neutral-400 ml-1">Unidad<input value={unit} onChange={(e) => setUnit(e.target.value)} className={input} placeholder="pza, juego, m…" /></label>
                            <label className="text-xs text-neutral-400 ml-1">Prioridad
                                <select value={priority} onChange={(e) => setPriority(e.target.value)} className={input}>
                                    {["Baja", "Normal", "Alta", "Urgente"].map((p) => <option key={p}>{p}</option>)}
                                </select>
                            </label>
                        </div>
                        <label className="block text-xs text-neutral-400 ml-1">Notas (opcional)<textarea value={notes} onChange={(e) => setNotes(e.target.value)} className={cn(input, "min-h-[80px]")} placeholder="Indicaciones, materiales, tolerancias, etc." /></label>
                    </section>

                    {isWelding && (
                        <section className="bg-amber-500/5 border border-amber-500/30 p-6 rounded-3xl space-y-3">
                            <h2 className="text-lg font-semibold text-white flex items-center gap-2"><Flame className="w-5 h-5 text-amber-400" /> WPS (Welding Procedure Specification) *</h2>
                            <p className="text-sm text-amber-200/80">La etapa de soldadura requiere al menos un WPS.</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {wpsList.length === 0 && <p className="text-sm text-neutral-500">Cargando WPS…</p>}
                                {wpsList.map((w) => {
                                    const on = selectedWpsIds.includes(w.id);
                                    return (
                                        <button type="button" key={w.id} onClick={() => setSelectedWpsIds((ids) => (on ? ids.filter((x) => x !== w.id) : [...ids, w.id]))}
                                            className={cn("text-left p-3 rounded-xl border", on ? "bg-amber-500/15 border-amber-500/50 ring-1 ring-amber-500/30" : "bg-neutral-900/40 border-neutral-700/50 hover:bg-neutral-800/60")}>
                                            <div className="flex items-center justify-between"><span className="font-mono text-amber-300 text-xs">{w.code}</span>{on && <CheckCircle2 className="w-4 h-4 text-amber-300" />}</div>
                                            <p className="text-sm text-white mt-0.5">{w.name}</p>
                                            <p className="text-[11px] text-neutral-400 mt-1">{w.joint_type || "—"} · {w.base_metal || "—"} · {w.filler_metal || "—"} · Pos. {w.position || "—"}</p>
                                        </button>
                                    );
                                })}
                            </div>
                        </section>
                    )}

                    <div className="flex justify-end gap-3">
                        <Link href="/manufacturing" className="px-5 py-3 rounded-xl text-neutral-300 hover:text-white hover:bg-neutral-800 text-sm font-medium">Cancelar</Link>
                        <button type="submit" disabled={busy} className="bg-orange-500 hover:bg-orange-600 disabled:bg-orange-500/50 text-white px-8 py-3 rounded-xl font-bold flex items-center justify-center gap-2">
                            {busy ? <><RefreshCw className="w-5 h-5 animate-spin" /> Creando…</> : <><Save className="w-5 h-5" /> Crear Orden de Trabajo</>}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
