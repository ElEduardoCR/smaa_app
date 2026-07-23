"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
    ArrowLeft, RefreshCw, Sparkles, CheckCircle, XCircle, Check, X,
    Link2, FileSpreadsheet, AlertCircle, Filter,
} from "lucide-react";
import Link from "next/link";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

type MatchStatus = "pending" | "confirmed" | "rejected";

type Match = {
    id: string;
    quotation_id: string;
    quotation_item_id: string | null;
    issued_invoice_id: string | null;
    quotation_number: string | null;
    client_name: string | null;
    item_description: string | null;
    invoice_uuid: string | null;
    invoice_folio: string | null;
    invoice_concept: string | null;
    matched_amount: number | null;
    confidence: number | null;
    ai_reason: string | null;
    status: MatchStatus;
    created_at: string;
};

const fmtMoney = (n: number | null) =>
    n == null ? "—" : `$${Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2 })}`;

const STATUS_TABS: { key: MatchStatus | "all"; label: string }[] = [
    { key: "pending", label: "Pendientes" },
    { key: "confirmed", label: "Confirmadas" },
    { key: "rejected", label: "Rechazadas" },
    { key: "all", label: "Todas" },
];

export default function BillingInboxPage() {
    const [rows, setRows] = useState<Match[]>([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState<MatchStatus | "all">("pending");
    const [detecting, setDetecting] = useState(false);
    const [actingId, setActingId] = useState<string | null>(null);
    const [msg, setMsg] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

    const fetchRows = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from("quotation_billing_matches")
                .select("*")
                .order("created_at", { ascending: false })
                .limit(3000);
            if (error) throw error;
            setRows((data as Match[]) || []);
        } catch (e: any) {
            setMsg({ type: "error", text: `No se pudo cargar la bandeja: ${e.message}` });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchRows(); }, []);

    const detectNow = async () => {
        setDetecting(true);
        setMsg({ type: "info", text: "La IA está revisando cotizaciones aprobadas contra tus facturas emitidas…" });
        try {
            const res = await fetch("/api/reconcile-billing/run", { method: "POST" });
            const json = await res.json();
            if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
            const extra = (json.errors && json.errors.length) ? ` · ${json.errors.length} con aviso` : "";
            setMsg({
                type: "success",
                text: `Detección lista: ${json.newMatches} emparejamiento(s) nuevo(s) de ${json.quotationsScanned} cotización(es) revisada(s)${extra}.`,
            });
            await fetchRows();
            setStatusFilter("pending");
        } catch (e: any) {
            setMsg({ type: "error", text: `Falló la detección: ${e.message}` });
        } finally {
            setDetecting(false);
        }
    };

    const setStatus = async (row: Match, newStatus: MatchStatus) => {
        setActingId(row.id);
        const prev = row.status;
        setRows(rs => rs.map(r => r.id === row.id ? { ...r, status: newStatus } : r));
        const { error } = await supabase
            .from("quotation_billing_matches")
            .update({ status: newStatus, updated_at: new Date().toISOString() })
            .eq("id", row.id);
        if (error) {
            setRows(rs => rs.map(r => r.id === row.id ? { ...r, status: prev } : r));
            setMsg({ type: "error", text: `No se pudo actualizar: ${error.message}` });
        }
        setActingId(null);
    };

    const counts = useMemo(() => ({
        pending: rows.filter(r => r.status === "pending").length,
        confirmed: rows.filter(r => r.status === "confirmed").length,
        rejected: rows.filter(r => r.status === "rejected").length,
        all: rows.length,
    }), [rows]);

    const visible = useMemo(
        () => statusFilter === "all" ? rows : rows.filter(r => r.status === statusFilter),
        [rows, statusFilter]
    );

    const confColor = (c: number | null) => {
        const v = c ?? 0;
        if (v >= 0.8) return "bg-emerald-500/10 text-emerald-300 border-emerald-500/20";
        if (v >= 0.65) return "bg-amber-500/10 text-amber-300 border-amber-500/20";
        return "bg-neutral-700/40 text-neutral-300 border-neutral-600/30";
    };

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-3 sm:p-6 md:p-8 lg:p-10 font-[family-name:var(--font-sans)]">
            <div className="w-full space-y-8">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                        <Link href="/sales" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors text-neutral-400 hover:text-white border border-neutral-700"><ArrowLeft className="w-5 h-5" /></Link>
                        <div>
                            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                                <Link2 className="w-8 h-8 text-orange-400" />
                                Facturación de cotizaciones
                            </h1>
                            <p className="text-neutral-400 text-sm mt-1">La IA liga, a nivel partida, qué renglones de tus cotizaciones aprobadas ya fueron facturados. Revisa y confirma.</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={detectNow}
                            disabled={detecting}
                            className="inline-flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-5 py-2.5 rounded-xl font-medium text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                        >
                            <Sparkles className={cn("w-4 h-4", detecting && "animate-pulse")} /> {detecting ? "Detectando…" : "Detectar ahora"}
                        </button>
                        <button onClick={fetchRows} className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium" disabled={loading}>
                            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin text-orange-400")} />
                        </button>
                    </div>
                </header>

                {msg && (
                    <div className={cn(
                        "p-4 rounded-xl border flex items-center gap-3",
                        msg.type === "error" ? "bg-red-500/10 border-red-500/30 text-red-400"
                            : msg.type === "success" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                                : "bg-orange-500/10 border-orange-500/30 text-orange-300"
                    )}>
                        {msg.type === "error" ? <AlertCircle className="w-5 h-5 flex-shrink-0" />
                            : msg.type === "success" ? <CheckCircle className="w-5 h-5 flex-shrink-0" />
                                : <RefreshCw className="w-5 h-5 flex-shrink-0 animate-spin" />}
                        {msg.text}
                    </div>
                )}

                {/* Filtros de estado */}
                <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl p-4 backdrop-blur-sm flex items-center gap-3 flex-wrap">
                    <span className="inline-flex items-center gap-2 text-neutral-400 text-sm font-medium"><Filter className="w-4 h-4" /> Estado</span>
                    <div className="flex items-center gap-1 bg-neutral-900/60 border border-neutral-700/50 rounded-xl p-1 flex-wrap">
                        {STATUS_TABS.map(t => (
                            <button
                                key={t.key}
                                onClick={() => setStatusFilter(t.key)}
                                className={cn(
                                    "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors inline-flex items-center gap-2",
                                    statusFilter === t.key ? "bg-orange-500/20 text-orange-300" : "text-neutral-400 hover:text-white"
                                )}
                            >
                                {t.label}
                                <span className="text-xs text-neutral-500">{counts[t.key]}</span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Tabla */}
                <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl overflow-hidden backdrop-blur-sm">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-neutral-900/50 text-neutral-400 uppercase text-xs font-semibold tracking-wider">
                                <tr>
                                    <th className="px-6 py-4">Cotización</th>
                                    <th className="px-6 py-4">Partida cotizada</th>
                                    <th className="px-6 py-4">Cliente</th>
                                    <th className="px-6 py-4">Factura</th>
                                    <th className="px-6 py-4">Concepto facturado</th>
                                    <th className="px-6 py-4 text-right">Monto</th>
                                    <th className="px-6 py-4 text-center">Confianza</th>
                                    <th className="px-6 py-4 text-right">Acción</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-700/50">
                                {loading ? (
                                    <tr><td colSpan={8} className="px-6 py-12 text-center text-neutral-400"><RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-orange-500" />Cargando...</td></tr>
                                ) : visible.length === 0 ? (
                                    <tr><td colSpan={8} className="px-6 py-12 text-center text-neutral-400">
                                        <div className="bg-neutral-800/50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border border-neutral-700"><Link2 className="w-8 h-8 text-neutral-500" /></div>
                                        <p className="text-lg text-neutral-300 font-medium">
                                            {statusFilter === "pending" ? "No hay emparejamientos por revisar" : "Sin registros"}
                                        </p>
                                        <p className="text-sm mt-1">Usa "Detectar ahora" para que la IA busque qué cotizaciones ya se facturaron.</p>
                                    </td></tr>
                                ) : (
                                    visible.map((r) => (
                                        <tr key={r.id} className="hover:bg-neutral-800/80 transition-colors align-top">
                                            <td className="px-6 py-4">
                                                <span className="font-mono font-medium text-emerald-300 bg-emerald-500/10 px-2.5 py-1 rounded-md border border-emerald-500/20">{r.quotation_number || "—"}</span>
                                            </td>
                                            <td className="px-6 py-4 text-neutral-200 max-w-[260px] whitespace-normal" title={r.item_description || ""}>
                                                {r.item_description || "—"}
                                                {r.ai_reason && <p className="text-xs text-neutral-500 mt-1 italic">“{r.ai_reason}”</p>}
                                            </td>
                                            <td className="px-6 py-4 text-neutral-400 max-w-[180px] truncate" title={r.client_name || ""}>{r.client_name || "—"}</td>
                                            <td className="px-6 py-4">
                                                <span className="font-mono text-xs text-teal-300">{r.invoice_folio || "—"}</span>
                                                {r.invoice_uuid && <p className="font-mono text-[10px] text-neutral-500 max-w-[160px] truncate" title={r.invoice_uuid}>{r.invoice_uuid}</p>}
                                            </td>
                                            <td className="px-6 py-4 text-neutral-400 max-w-[240px] whitespace-normal">{r.invoice_concept || "—"}</td>
                                            <td className="px-6 py-4 text-right font-medium text-neutral-200">{fmtMoney(r.matched_amount)}</td>
                                            <td className="px-6 py-4 text-center">
                                                <span className={cn("text-xs font-semibold px-2 py-1 rounded-md border", confColor(r.confidence))}>
                                                    {r.confidence == null ? "—" : `${Math.round(r.confidence * 100)}%`}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                {r.status === "pending" ? (
                                                    <div className="flex items-center justify-end gap-2">
                                                        <button
                                                            onClick={() => setStatus(r, "confirmed")}
                                                            disabled={actingId === r.id}
                                                            className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 px-3 py-1.5 rounded-lg border border-emerald-500/20 disabled:opacity-50"
                                                        >
                                                            <Check className="w-3.5 h-3.5" /> Confirmar
                                                        </button>
                                                        <button
                                                            onClick={() => setStatus(r, "rejected")}
                                                            disabled={actingId === r.id}
                                                            className="inline-flex items-center gap-1.5 text-xs font-medium text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 px-3 py-1.5 rounded-lg border border-red-500/20 disabled:opacity-50"
                                                        >
                                                            <X className="w-3.5 h-3.5" /> Rechazar
                                                        </button>
                                                    </div>
                                                ) : r.status === "confirmed" ? (
                                                    <div className="flex items-center justify-end gap-2">
                                                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-300 bg-emerald-500/10 px-2.5 py-1.5 rounded-lg border border-emerald-500/20"><CheckCircle className="w-3.5 h-3.5" /> Facturada</span>
                                                        <button onClick={() => setStatus(r, "pending")} disabled={actingId === r.id} className="text-xs text-neutral-500 hover:text-neutral-300 px-2 py-1.5 rounded-lg hover:bg-neutral-700/50 disabled:opacity-50">Deshacer</button>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center justify-end gap-2">
                                                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-300 bg-red-500/10 px-2.5 py-1.5 rounded-lg border border-red-500/20"><XCircle className="w-3.5 h-3.5" /> Rechazada</span>
                                                        <button onClick={() => setStatus(r, "pending")} disabled={actingId === r.id} className="text-xs text-neutral-500 hover:text-neutral-300 px-2 py-1.5 rounded-lg hover:bg-neutral-700/50 disabled:opacity-50">Deshacer</button>
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                <p className="text-xs text-neutral-500 flex items-center gap-2">
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    La detección automática corre todos los días a las 6:00 AM. Solo se consideran cotizaciones y facturas de {new Date().getFullYear()}.
                </p>
            </div>
        </div>
    );
}
