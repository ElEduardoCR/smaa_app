"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
    ArrowLeft, Save, Factory, AlertCircle, RefreshCw, CheckCircle2, Lock,
    Cog, Flame, Cpu, X, Search
} from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

const ICONS: Record<string, any> = { Cog, Flame, Cpu };
const COLORS: Record<string, string> = { orange: "text-orange-400", amber: "text-amber-400", cyan: "text-cyan-400" };

type Module = { id: string; code: string; name: string; color: string; icon: string };
type Quotation = {
    id: string;
    quotation_number: string;
    status: string;
    total: number | null;
    client: { business_name: string; rfc?: string };
};
type WpsProcedure = {
    id: string;
    code: string;
    name: string;
    joint_type: string | null;
    base_metal: string | null;
    filler_metal: string | null;
    position: string | null;
};

function NewWorkOrderForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const initialModule = searchParams?.get("module") || "";

    const [modules, setModules] = useState<Module[]>([]);
    const [moduleCode, setModuleCode] = useState<string>(initialModule);
    const [moduleId, setModuleId] = useState<string>("");

    // Quotation vs. ad-hoc
    const [mode, setMode] = useState<"quotation" | "adhoc">("quotation");
    const [quotations, setQuotations] = useState<Quotation[]>([]);
    const [quotationSearch, setQuotationSearch] = useState("");
    const [selectedQuotationId, setSelectedQuotationId] = useState<string>("");
    const [confirmingQuotation, setConfirmingQuotation] = useState(false);
    const [confirmError, setConfirmError] = useState<string | null>(null);

    const [clientName, setClientName] = useState("");
    const [clientRfc, setClientRfc] = useState("");
    const [workTitle, setWorkTitle] = useState("");
    const [priority, setPriority] = useState("Normal");
    const [notes, setNotes] = useState("");

    // WPS (only for soldadura)
    const [wpsList, setWpsList] = useState<WpsProcedure[]>([]);
    const [selectedWpsIds, setSelectedWpsIds] = useState<string[]>([]);

    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    // Load modules
    useEffect(() => {
        (async () => {
            const { data } = await supabase.from("manufacturing_modules").select("*").eq("is_active", true).order("sort_order");
            setModules(data || []);
            if (initialModule) {
                const m = (data || []).find((x: any) => x.code === initialModule);
                if (m) setModuleId(m.id);
            }
        })();
    }, [initialModule]);

    // Load quotations when needed
    useEffect(() => {
        (async () => {
            const { data, error } = await supabase
                .from("quotations")
                .select("id, quotation_number, status, total, client:clients(business_name, rfc)")
                .in("status", ["Pending", "Approved", "Confirmed"])
                .order("created_at", { ascending: false });
            if (error) { console.error(error); return; }
            const formatted = (data || []).map((q: any) => ({
                ...q,
                client: Array.isArray(q.client) ? q.client[0] : q.client,
            }));
            setQuotations(formatted);
        })();
    }, []);

    // Load WPS when soldadura
    useEffect(() => {
        if (moduleCode !== "soldadura") { setWpsList([]); setSelectedWpsIds([]); return; }
        (async () => {
            const { data } = await supabase
                .from("wps_procedures")
                .select("id, code, name, joint_type, base_metal, filler_metal, position")
                .eq("is_active", true)
                .order("code");
            setWpsList(data || []);
        })();
    }, [moduleCode]);

    const filteredQuotations = useMemo(() => {
        const s = quotationSearch.trim().toLowerCase();
        if (!s) return quotations;
        return quotations.filter(q =>
            (q.quotation_number || "").toLowerCase().includes(s) ||
            (q.client?.business_name || "").toLowerCase().includes(s) ||
            (q.client?.rfc || "").toLowerCase().includes(s)
        );
    }, [quotations, quotationSearch]);

    const selectedModule = modules.find(m => m.id === moduleId) || null;
    const selectedQuotation = quotations.find(q => q.id === selectedQuotationId) || null;
    const isSoldadura = moduleCode === "soldadura";
    const requiresWps = isSoldadura && selectedWpsIds.length === 0;

    const handleConfirmQuotation = async () => {
        if (!selectedQuotation) return;
        setConfirmingQuotation(true);
        setConfirmError(null);
        try {
            const { error } = await supabase
                .from("quotations")
                .update({ status: "Approved" })
                .eq("id", selectedQuotation.id);
            if (error) throw error;
            setQuotations(qs => qs.map(q => q.id === selectedQuotation.id ? { ...q, status: "Approved" } : q));
        } catch (e: any) {
            setConfirmError(e?.message || "No se pudo confirmar la cotización.");
        } finally {
            setConfirmingQuotation(false);
        }
    };

    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErr(null);
        if (!moduleId) { setErr("Selecciona un módulo."); return; }
        if (mode === "quotation" && !selectedQuotationId) { setErr("Selecciona una cotización."); return; }
        if (mode === "quotation" && selectedQuotation && selectedQuotation.status !== "Approved") {
            setErr("La cotización seleccionada debe estar aprobada/confirma da. Confírmala primero."); return;
        }
        if (mode === "adhoc" && !clientName.trim()) { setErr("Captura el nombre del cliente."); return; }
        if (requiresWps) { setErr("Soldadura requiere al menos un WPS asignado."); return; }
        if (!workTitle.trim()) { setErr("Captura el título del trabajo."); return; }

        setBusy(true);
        try {
            // Generate order number: from quotation SMAA00001 -> OT-MAQ-00001, OT-SOLD-00001, OT-AUTO-00001
            const modulePrefix: Record<string, string> = {
                maquinado: "MAQ",
                soldadura: "SOLD",
                automatizacion: "AUTO",
            };
            const prefix = modulePrefix[moduleCode] || "OT";

            // Count existing OTs in this module to generate a sequence
            const { count } = await supabase
                .from("work_orders")
                .select("id", { count: "exact", head: true })
                .eq("module_id", moduleId);
            const seq = String((count || 0) + 1).padStart(5, "0");

            let orderNumber: string;
            if (mode === "quotation" && selectedQuotation) {
                const qDigits = (selectedQuotation.quotation_number || "").replace(/\D/g, "") || seq;
                orderNumber = `OT-${prefix}-${qDigits}`;
            } else {
                orderNumber = `OT-${prefix}-${seq}`;
            }

            const { data: wo, error: woErr } = await supabase.from("work_orders").insert([{
                order_number: orderNumber,
                module_id: moduleId,
                quotation_id: mode === "quotation" ? selectedQuotationId : null,
                client_name: mode === "adhoc" ? clientName : null,
                client_rfc: mode === "adhoc" ? clientRfc : null,
                work_title: workTitle,
                priority,
                notes: notes || null,
                status: "Open",
            }]).select().single();
            if (woErr) throw woErr;

            if (selectedWpsIds.length > 0) {
                const links = selectedWpsIds.map(wid => ({ work_order_id: wo.id, wps_id: wid }));
                const { error: wpsErr } = await supabase.from("work_order_wps").insert(links);
                if (wpsErr) throw wpsErr;
            }

            router.push(`/manufacturing/${moduleCode}/${wo.id}`);
        } catch (e: any) {
            setErr(e?.message || "Error al crear la OT.");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-6 md:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-5xl mx-auto space-y-8">
                <header className="flex items-center gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <Link href="/manufacturing" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors text-neutral-400 hover:text-white border border-neutral-700">
                        <ArrowLeft className="w-5 h-5" />
                    </Link>
                    <div>
                        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                            <Factory className="w-8 h-8 text-orange-400" />
                            Nueva Orden de Trabajo
                        </h1>
                        <p className="text-neutral-400 text-sm mt-1">Crea una OT con o sin cotización anidada.</p>
                    </div>
                </header>

                {err && (
                    <div className="p-4 rounded-xl border bg-red-500/10 border-red-500/30 text-red-400 flex items-center gap-3">
                        <AlertCircle className="w-5 h-5 flex-shrink-0" /> {err}
                    </div>
                )}

                <form onSubmit={onSubmit} className="space-y-6">
                    {/* Módulo */}
                    <div className="bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                        <h2 className="text-lg font-semibold text-white mb-4">1) Módulo de fabricación</h2>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            {modules.map(m => {
                                const Icon = ICONS[m.icon] || Factory;
                                const c = COLORS[m.color] || "text-orange-400";
                                const isOn = moduleId === m.id;
                                return (
                                    <button
                                        type="button"
                                        key={m.id}
                                        onClick={() => { setModuleId(m.id); setModuleCode(m.code); }}
                                        className={cn(
                                            "flex items-center gap-3 p-4 rounded-2xl border transition-all text-left",
                                            isOn
                                                ? "bg-neutral-700/40 border-orange-500/60 shadow-[0_0_0_2px_rgba(249,115,22,0.2)]"
                                                : "bg-neutral-900/40 border-neutral-700/50 hover:bg-neutral-800/60"
                                        )}
                                    >
                                        <Icon className={cn("w-7 h-7", c)} />
                                        <div className="flex-1">
                                            <p className="text-white font-semibold">{m.name}</p>
                                            <p className="text-[11px] text-neutral-500 uppercase tracking-wider">{m.code}</p>
                                        </div>
                                        {isOn && <CheckCircle2 className="w-5 h-5 text-orange-400" />}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Cotización vs ad-hoc */}
                    <div className="bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm space-y-4">
                        <h2 className="text-lg font-semibold text-white">2) Origen</h2>
                        <div className="grid grid-cols-2 gap-2 max-w-md">
                            <button
                                type="button"
                                onClick={() => setMode("quotation")}
                                className={cn(
                                    "px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors",
                                    mode === "quotation" ? "bg-orange-500/15 text-orange-300 border-orange-500/40" : "bg-neutral-900/40 text-neutral-400 border-neutral-700/50 hover:bg-neutral-800"
                                )}
                            >Con cotización</button>
                            <button
                                type="button"
                                onClick={() => setMode("adhoc")}
                                className={cn(
                                    "px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors",
                                    mode === "adhoc" ? "bg-orange-500/15 text-orange-300 border-orange-500/40" : "bg-neutral-900/40 text-neutral-400 border-neutral-700/50 hover:bg-neutral-800"
                                )}
                            >Sin cotización (ad-hoc)</button>
                        </div>

                        {mode === "quotation" && (
                            <div className="space-y-3">
                                <div className="relative">
                                    <Search className="w-4 h-4 absolute left-3 top-3.5 text-neutral-500" />
                                    <input
                                        type="text"
                                        placeholder="Buscar por folio, cliente o RFC…"
                                        value={quotationSearch}
                                        onChange={(e) => setQuotationSearch(e.target.value)}
                                        className="w-full pl-9 pr-3 py-2.5 bg-neutral-900/50 border border-neutral-700 rounded-lg text-white text-sm focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
                                    />
                                </div>
                                <div className="max-h-72 overflow-y-auto rounded-xl border border-neutral-700/50 divide-y divide-neutral-800/60 bg-neutral-900/40">
                                    {filteredQuotations.length === 0 ? (
                                        <p className="p-4 text-sm text-neutral-500 text-center">No hay cotizaciones pendientes o aprobadas.</p>
                                    ) : filteredQuotations.map(q => {
                                        const approved = q.status === "Approved";
                                        const isSel = selectedQuotationId === q.id;
                                        return (
                                            <button
                                                type="button"
                                                key={q.id}
                                                onClick={() => setSelectedQuotationId(q.id)}
                                                className={cn(
                                                    "w-full text-left p-3 hover:bg-neutral-800/60 transition-colors flex items-center gap-3",
                                                    isSel && "bg-orange-500/10 ring-1 ring-orange-500/40"
                                                )}
                                            >
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-mono text-emerald-300 text-xs bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                                                            {q.quotation_number}
                                                        </span>
                                                        <span className="text-sm text-white truncate">{q.client?.business_name}</span>
                                                    </div>
                                                    <p className="text-[11px] text-neutral-500 mt-1">
                                                        {q.client?.rfc ? `RFC ${q.client.rfc} · ` : ""}{q.total ? `Total $${q.total.toLocaleString("es-MX", { minimumFractionDigits: 2 })}` : ""}
                                                    </p>
                                                </div>
                                                <span className={cn(
                                                    "text-[10px] font-semibold px-2 py-0.5 rounded-full border uppercase tracking-wider",
                                                    approved
                                                        ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                                                        : "bg-amber-500/10 text-amber-300 border-amber-500/30"
                                                )}>
                                                    {approved ? "Aprobada" : q.status}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>

                                {/* In-line confirmation */}
                                {selectedQuotation && selectedQuotation.status !== "Approved" && (
                                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                                        <Lock className="w-5 h-5 text-amber-400 flex-shrink-0" />
                                        <div className="flex-1">
                                            <p className="text-sm text-amber-200">
                                                Esta cotización aún no está aprobada. La OT no puede crearse hasta confirmarla.
                                            </p>
                                            {confirmError && <p className="text-xs text-red-400 mt-1">{confirmError}</p>}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleConfirmQuotation}
                                            disabled={confirmingQuotation}
                                            className="text-sm font-semibold bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg flex items-center gap-1.5 disabled:opacity-50"
                                        >
                                            {confirmingQuotation ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                                            Confirmar cotización
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        {mode === "adhoc" && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs text-neutral-400 ml-1">Cliente *</label>
                                    <input
                                        value={clientName}
                                        onChange={e => setClientName(e.target.value)}
                                        className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
                                        placeholder="Nombre del cliente"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-neutral-400 ml-1">RFC (opcional)</label>
                                    <input
                                        value={clientRfc}
                                        onChange={e => setClientRfc(e.target.value.toUpperCase())}
                                        className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
                                        placeholder="XAXX010101000"
                                        maxLength={13}
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Detalles */}
                    <div className="bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm space-y-3">
                        <h2 className="text-lg font-semibold text-white">3) Detalles del trabajo</h2>
                        <div>
                            <label className="text-xs text-neutral-400 ml-1">Título del trabajo *</label>
                            <input
                                value={workTitle}
                                onChange={e => setWorkTitle(e.target.value)}
                                className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
                                placeholder="Ej. Fabricación de brida bridada 4″ Acero al carbón"
                            />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                                <label className="text-xs text-neutral-400 ml-1">Prioridad</label>
                                <select
                                    value={priority}
                                    onChange={e => setPriority(e.target.value)}
                                    className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500"
                                >
                                    <option>Baja</option>
                                    <option>Normal</option>
                                    <option>Alta</option>
                                    <option>Urgente</option>
                                </select>
                            </div>
                        </div>
                        <div>
                            <label className="text-xs text-neutral-400 ml-1">Notas (opcional)</label>
                            <textarea
                                value={notes}
                                onChange={e => setNotes(e.target.value)}
                                className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500 min-h-[80px]"
                                placeholder="Indicaciones, materiales, tolerancias, etc."
                            />
                        </div>
                    </div>

                    {/* WPS soldadura */}
                    {isSoldadura && (
                        <div className="bg-amber-500/5 border border-amber-500/30 p-6 rounded-3xl space-y-3">
                            <div className="flex items-center gap-2">
                                <Flame className="w-5 h-5 text-amber-400" />
                                <h2 className="text-lg font-semibold text-white">WPS (Welding Procedure Specification) *</h2>
                            </div>
                            <p className="text-sm text-amber-200/80">
                                Soldadura requiere que el operador tenga claro qué procedimiento usar. Selecciona al menos un WPS.
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {wpsList.length === 0 && (
                                    <p className="text-sm text-neutral-500">Cargando WPS…</p>
                                )}
                                {wpsList.map(w => {
                                    const on = selectedWpsIds.includes(w.id);
                                    return (
                                        <button
                                            type="button"
                                            key={w.id}
                                            onClick={() => setSelectedWpsIds(ids => on ? ids.filter(x => x !== w.id) : [...ids, w.id])}
                                            className={cn(
                                                "text-left p-3 rounded-xl border transition-colors",
                                                on
                                                    ? "bg-amber-500/15 border-amber-500/50 ring-1 ring-amber-500/30"
                                                    : "bg-neutral-900/40 border-neutral-700/50 hover:bg-neutral-800/60"
                                            )}
                                        >
                                            <div className="flex items-center justify-between">
                                                <span className="font-mono text-amber-300 text-xs">{w.code}</span>
                                                {on && <CheckCircle2 className="w-4 h-4 text-amber-300" />}
                                            </div>
                                            <p className="text-sm text-white mt-0.5">{w.name}</p>
                                            <p className="text-[11px] text-neutral-400 mt-1">
                                                {w.joint_type || "—"} · {w.base_metal || "—"} · {w.filler_metal || "—"} · Pos. {w.position || "—"}
                                            </p>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    <div className="flex justify-end gap-3">
                        <Link href="/manufacturing" className="px-5 py-3 rounded-xl text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors text-sm font-medium">
                            Cancelar
                        </Link>
                        <button
                            type="submit"
                            disabled={busy}
                            className="bg-orange-500 hover:bg-orange-600 disabled:bg-orange-500/50 text-white px-8 py-3 rounded-xl font-bold transition-all shadow-[0_0_15px_rgba(249,115,22,0.2)] hover:shadow-[0_0_20px_rgba(249,115,22,0.4)] flex items-center justify-center gap-2"
                        >
                            {busy ? <><RefreshCw className="w-5 h-5 animate-spin" /> Creando…</> : <><Save className="w-5 h-5" /> Crear Orden de Trabajo</>}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default function NewWorkOrderFormPage() {
    return <NewWorkOrderForm />;
}
