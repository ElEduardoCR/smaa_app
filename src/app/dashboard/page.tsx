"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
    ArrowLeft, BarChart3, RefreshCw, TrendingUp, Calendar, ShoppingCart,
    Coins, Wallet, Receipt, ExternalLink, Link2, FileSpreadsheet, Check, RotateCcw,
} from "lucide-react";
import Link from "next/link";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";
import QuotationItemsModal from "./QuotationItemsModal";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

type PORow = {
    id: string;
    total: number | null;
    invoice_date: string | null;
    created_at: string;
    status: string | null;
};

type IssuedRow = {
    id: string;
    total: number | null;
    invoice_date: string | null;
    created_at: string;
    paid: boolean | null;
    paid_at: string | null;
    receptor_nombre: string | null;
    receptor_rfc: string | null;
    serie: string | null;
    folio: string | null;
};

type QuoteLite = {
    id: string;
    quotation_number: string;
    total: number | null;
    created_at: string;
    client_name: string | null;
};

type QItemLite = {
    id: string;
    quotation_id: string;
    line_total: number | null;
};

type View = "ventas" | "compras";

const BILLING_YEAR = 2026;

const MONTH_NAMES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const fmtMoney = (n: number) =>
    `$${Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Item = { amount: number; date: Date };

function buildStats(items: Item[]) {
    let grandTotal = 0;
    let grandCount = 0;
    const byYear = new Map<number, { total: number; count: number }>();
    const byMonth = new Map<string, { total: number; count: number }>(); // clave "YYYY-M"

    for (const it of items) {
        if (isNaN(it.date.getTime())) continue;
        const y = it.date.getFullYear();
        const m = it.date.getMonth();
        grandTotal += it.amount;
        grandCount += 1;

        const ye = byYear.get(y) || { total: 0, count: 0 };
        ye.total += it.amount; ye.count += 1;
        byYear.set(y, ye);

        const key = `${y}-${m}`;
        const me = byMonth.get(key) || { total: 0, count: 0 };
        me.total += it.amount; me.count += 1;
        byMonth.set(key, me);
    }

    const years = Array.from(byYear.entries())
        .map(([year, v]) => ({ year, ...v }))
        .sort((a, b) => b.year - a.year);

    return { grandTotal, grandCount, years, byMonth };
}

export default function DashboardPage() {
    const [poRows, setPoRows] = useState<PORow[]>([]);
    const [issuedRows, setIssuedRows] = useState<IssuedRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [salesNote, setSalesNote] = useState<string | null>(null);
    const [view, setView] = useState<View>("ventas");
    const [selectedYear, setSelectedYear] = useState<number | null>(null);

    // Facturación (cotizaciones aprobadas ↔ facturas emitidas)
    const [approvedQuotes, setApprovedQuotes] = useState<QuoteLite[]>([]);
    const [quotationItems, setQuotationItems] = useState<QItemLite[]>([]);
    const [confirmedItemIds, setConfirmedItemIds] = useState<Set<string>>(new Set());
    const [manuallyBilledIds, setManuallyBilledIds] = useState<Set<string>>(new Set());
    const [markingId, setMarkingId] = useState<string | null>(null);
    const [markError, setMarkError] = useState<string | null>(null);
    const [billingNote, setBillingNote] = useState<string | null>(null);
    const [selectedQuote, setSelectedQuote] = useState<{ id: string; number: string; client: string | null } | null>(null);

    const fetchData = async () => {
        setLoading(true);
        setError(null);
        setSalesNote(null);
        try {
            const { data, error } = await supabase
                .from('purchase_orders')
                .select('id, total, invoice_date, created_at, status')
                .limit(10000);
            if (error) throw error;
            setPoRows((data as PORow[]) || []);
        } catch (e: any) {
            setError(e.message);
        }

        // Facturas emitidas (ventas). Si la migración aún no corre, no rompe el dashboard.
        try {
            const { data, error } = await supabase
                .from('issued_invoices')
                .select('id, total, invoice_date, created_at, paid, paid_at, receptor_nombre, receptor_rfc, serie, folio')
                .limit(10000);
            if (error) throw error;
            setIssuedRows((data as IssuedRow[]) || []);
        } catch (e: any) {
            setIssuedRows([]);
            setSalesNote("No se pudieron cargar las ventas. Si es la primera vez, corre la migración de 'issued_invoices' (paid).");
        }

        // Cotizaciones aprobadas del año + partidas + matches confirmados (para "por facturar")
        setBillingNote(null);
        try {
            const yStart = `${BILLING_YEAR}-01-01T00:00:00.000Z`;
            const yEnd = `${BILLING_YEAR + 1}-01-01T00:00:00.000Z`;
            const { data: q, error: qErr } = await supabase
                .from('quotations')
                .select('id, quotation_number, total, created_at, client:clients(business_name)')
                .eq('status', 'Approved')
                .gte('created_at', yStart)
                .lt('created_at', yEnd);
            if (qErr) throw qErr;
            const quotes: QuoteLite[] = ((q as any[]) || []).map(x => ({
                id: x.id,
                quotation_number: x.quotation_number,
                total: x.total,
                created_at: x.created_at,
                client_name: Array.isArray(x.client) ? (x.client[0]?.business_name ?? null) : (x.client?.business_name ?? null),
            }));
            setApprovedQuotes(quotes);

            const ids = quotes.map(x => x.id);
            if (ids.length) {
                const { data: items } = await supabase
                    .from('quotation_items')
                    .select('id, quotation_id, line_total')
                    .in('quotation_id', ids);
                setQuotationItems((items as QItemLite[]) || []);
            } else {
                setQuotationItems([]);
            }

            const { data: confirmed, error: cmErr } = await supabase
                .from('quotation_billing_matches')
                .select('quotation_item_id')
                .eq('status', 'confirmed');
            if (cmErr) {
                setBillingNote("Para activar la facturación con IA, corre la migración 'quotation_billing_matches'.");
                setConfirmedItemIds(new Set());
            } else {
                const set = new Set<string>();
                for (const c of (confirmed as { quotation_item_id: string | null }[]) || []) {
                    if (c.quotation_item_id) set.add(c.quotation_item_id);
                }
                setConfirmedItemIds(set);
            }

            // Cotizaciones marcadas manualmente como ya facturadas (resiliente si falta la columna)
            try {
                const { data: mb, error: mbErr } = await supabase
                    .from('quotations')
                    .select('id, billed_manually')
                    .eq('status', 'Approved')
                    .gte('created_at', yStart)
                    .lt('created_at', yEnd);
                if (mbErr) throw mbErr;
                const s = new Set<string>();
                for (const r of (mb as { id: string; billed_manually: boolean | null }[]) || []) {
                    if (r.billed_manually) s.add(r.id);
                }
                setManuallyBilledIds(s);
            } catch {
                setManuallyBilledIds(new Set());
            }
        } catch {
            setApprovedQuotes([]);
            setQuotationItems([]);
            setConfirmedItemIds(new Set());
        }

        setLoading(false);
    };

    // Marca/desmarca una cotización como ya facturada manualmente (sale del "por facturar")
    const markBilled = async (quoteId: string, value: boolean) => {
        setMarkingId(quoteId);
        setMarkError(null);
        setManuallyBilledIds(prev => {
            const n = new Set(prev);
            if (value) n.add(quoteId); else n.delete(quoteId);
            return n;
        });
        const { error } = await supabase
            .from('quotations')
            .update({ billed_manually: value, billed_manually_at: value ? new Date().toISOString() : null })
            .eq('id', quoteId);
        if (error) {
            setManuallyBilledIds(prev => {
                const n = new Set(prev);
                if (value) n.delete(quoteId); else n.add(quoteId);
                return n;
            });
            setMarkError(`No se pudo actualizar: ${error.message}. ¿Ya corriste la migración 'billed_manually'?`);
        }
        setMarkingId(null);
    };

    useEffect(() => { fetchData(); }, []);

    // ===== Compras =====
    const comprasStats = useMemo(() => {
        const valid = poRows.filter(r => {
            const s = (r.status || '').toLowerCase();
            return s !== 'cancelled' && s !== 'canceled';
        });
        return buildStats(valid.map(r => ({
            amount: Number(r.total) || 0,
            date: new Date(r.invoice_date || r.created_at),
        })));
    }, [poRows]);

    // ===== Ventas (solo facturas emitidas COBRADAS) =====
    const ventasStats = useMemo(() => {
        const paid = issuedRows.filter(r => r.paid);
        return buildStats(paid.map(r => ({
            amount: Number(r.total) || 0,
            date: new Date(r.invoice_date || r.created_at),
        })));
    }, [issuedRows]);

    // ===== Cuentas por cobrar (facturas emitidas NO cobradas) =====
    const porCobrar = useMemo(() => {
        const unpaid = issuedRows.filter(r => !r.paid);
        const total = unpaid.reduce((acc, r) => acc + (Number(r.total) || 0), 0);
        const list = [...unpaid].sort((a, b) => {
            const da = new Date(a.invoice_date || a.created_at).getTime();
            const db = new Date(b.invoice_date || b.created_at).getTime();
            return db - da;
        });
        return { total, count: unpaid.length, list };
    }, [issuedRows]);

    // ===== Por facturar vs por cobrar (solo BILLING_YEAR) =====
    const facturacion = useMemo(() => {
        const quoteById = new Map(approvedQuotes.map(q => [q.id, q]));
        const perQuote = new Map<string, { id: string; number: string; client: string | null; pendingAmount: number; pendingCount: number }>();
        let porFacturar = 0;
        let facturado = 0;

        for (const it of quotationItems) {
            const q = quoteById.get(it.quotation_id);
            if (!q) continue;
            const amt = Number(it.line_total) || 0;
            // Confirmada por la IA o marcada manualmente como facturada → cuenta como facturado
            if (confirmedItemIds.has(it.id) || manuallyBilledIds.has(q.id)) {
                facturado += amt;
            } else {
                porFacturar += amt;
                const e = perQuote.get(q.id) || { id: q.id, number: q.quotation_number, client: q.client_name, pendingAmount: 0, pendingCount: 0 };
                e.pendingAmount += amt;
                e.pendingCount += 1;
                perQuote.set(q.id, e);
            }
        }
        const pendingList = Array.from(perQuote.values()).sort((a, b) => b.pendingAmount - a.pendingAmount);

        // Cotizaciones marcadas manualmente como ya facturadas (para deshacer)
        const manualList = approvedQuotes
            .filter(q => manuallyBilledIds.has(q.id))
            .map(q => ({ id: q.id, number: q.quotation_number, client: q.client_name, total: Number(q.total) || 0 }))
            .sort((a, b) => b.total - a.total);

        const inYear = (iso: string) => {
            const d = new Date(iso);
            return !isNaN(d.getTime()) && d.getFullYear() === BILLING_YEAR;
        };
        const unpaid = issuedRows.filter(r => !r.paid && inYear(r.invoice_date || r.created_at));
        const porCobrarYear = unpaid.reduce((acc, r) => acc + (Number(r.total) || 0), 0);

        return {
            porFacturar,
            facturado,
            pendingList,
            manualList,
            approvedCount: approvedQuotes.length,
            porCobrarYear,
            porCobrarYearCount: unpaid.length,
        };
    }, [approvedQuotes, quotationItems, confirmedItemIds, manuallyBilledIds, issuedRows]);

    const activeStats = view === 'ventas' ? ventasStats : comprasStats;
    const accent = view === 'ventas'
        ? { text: 'text-emerald-400', textSoft: 'text-emerald-300', spin: 'text-emerald-400' }
        : { text: 'text-sky-400', textSoft: 'text-sky-300', spin: 'text-sky-400' };

    // Selecciona/ajusta el año según el dataset activo
    useEffect(() => {
        const years = activeStats.years.map(y => y.year);
        if (years.length > 0 && (selectedYear == null || !years.includes(selectedYear))) {
            setSelectedYear(years[0]);
        }
    }, [activeStats.years, selectedYear]);

    const monthsForSelectedYear = useMemo(() => {
        if (selectedYear == null) return [];
        return MONTH_NAMES.map((name, idx) => {
            const entry = activeStats.byMonth.get(`${selectedYear}-${idx}`);
            return { idx, name, total: entry?.total || 0, count: entry?.count || 0 };
        });
    }, [selectedYear, activeStats.byMonth]);

    const maxMonthTotal = useMemo(
        () => Math.max(1, ...monthsForSelectedYear.map(m => m.total)),
        [monthsForSelectedYear]
    );

    const selectedYearTotal = useMemo(() => {
        if (selectedYear == null) return 0;
        return activeStats.years.find(y => y.year === selectedYear)?.total || 0;
    }, [selectedYear, activeStats.years]);

    const dayAge = (iso: string | null, fallback: string) => {
        const d = new Date(iso || fallback);
        if (isNaN(d.getTime())) return null;
        const diff = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
        return diff < 0 ? 0 : diff;
    };

    return (
        <div className="min-h-screen bg-[#0B1120] text-slate-200 p-6 md:p-10 font-[family-name:var(--font-sans)]">
            <div className="w-full space-y-8">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-slate-800/40 p-6 rounded-3xl border border-slate-700/50 backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="p-3 bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors text-slate-400 hover:text-white border border-slate-700"><ArrowLeft className="w-5 h-5" /></Link>
                        <div>
                            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                                <BarChart3 className="w-8 h-8 text-sky-400" />
                                Dashboard
                            </h1>
                            <p className="text-slate-400 text-sm mt-1">Estadísticas del negocio: ventas cobradas, cuentas por cobrar y gasto en compras.</p>
                        </div>
                    </div>
                    <button onClick={fetchData} className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium" disabled={loading}>
                        <RefreshCw className={cn("w-4 h-4", loading && "animate-spin", loading && accent.spin)} /> Refresh
                    </button>
                </header>

                {error && (
                    <div className="p-4 rounded-xl border bg-red-500/10 border-red-500/30 text-red-400">
                        {error}
                    </div>
                )}

                {/* Toggle Ventas / Compras */}
                <div className="inline-flex items-center gap-1 bg-slate-800/40 border border-slate-700/50 rounded-2xl p-1.5">
                    <button
                        onClick={() => setView('ventas')}
                        className={cn(
                            "inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all",
                            view === 'ventas' ? "bg-emerald-500/15 text-emerald-300 shadow-lg shadow-emerald-500/10" : "text-slate-400 hover:text-white"
                        )}
                    >
                        <Coins className="w-4 h-4" /> Ventas
                    </button>
                    <button
                        onClick={() => setView('compras')}
                        className={cn(
                            "inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all",
                            view === 'compras' ? "bg-sky-500/15 text-sky-300 shadow-lg shadow-sky-500/10" : "text-slate-400 hover:text-white"
                        )}
                    >
                        <ShoppingCart className="w-4 h-4" /> Compras
                    </button>
                </div>

                {view === 'ventas' && salesNote && (
                    <div className="p-4 rounded-xl border bg-amber-500/10 border-amber-500/30 text-amber-300 text-sm">
                        {salesNote}
                    </div>
                )}

                {/* Tarjetas resumen */}
                <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {view === 'ventas' ? (
                        <>
                            <div className="md:col-span-2 bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border border-emerald-500/30 rounded-3xl p-8 flex flex-col justify-between shadow-lg shadow-black/20">
                                <div className="flex items-center gap-3 text-emerald-300/80 text-sm font-semibold uppercase tracking-wider">
                                    <Coins className="w-5 h-5" /> Ventas cobradas · todos los años
                                </div>
                                <div className="mt-4">
                                    {loading ? (
                                        <div className="h-12 w-64 bg-slate-700/40 rounded-xl animate-pulse" />
                                    ) : (
                                        <p className="text-5xl font-bold text-white tracking-tight">{fmtMoney(ventasStats.grandTotal)}</p>
                                    )}
                                    <p className="text-slate-400 text-sm mt-2">{ventasStats.grandCount} factura(s) cobrada(s)</p>
                                </div>
                            </div>

                            <div className="bg-gradient-to-br from-amber-500/10 to-orange-500/5 border border-amber-500/30 rounded-3xl p-8 flex flex-col justify-between shadow-lg shadow-black/20">
                                <div className="flex items-center gap-3 text-amber-300/80 text-sm font-semibold uppercase tracking-wider">
                                    <Wallet className="w-5 h-5" /> Cuentas por cobrar
                                </div>
                                <div className="mt-4">
                                    <p className="text-4xl font-bold text-white tracking-tight">{fmtMoney(porCobrar.total)}</p>
                                    <p className="text-slate-400 text-sm mt-2">{porCobrar.count} factura(s) sin cobrar</p>
                                </div>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="md:col-span-2 bg-gradient-to-br from-sky-500/10 to-indigo-500/10 border border-sky-500/30 rounded-3xl p-8 flex flex-col justify-between shadow-lg shadow-black/20">
                                <div className="flex items-center gap-3 text-sky-300/80 text-sm font-semibold uppercase tracking-wider">
                                    <ShoppingCart className="w-5 h-5" /> Total en compras · todos los años
                                </div>
                                <div className="mt-4">
                                    {loading ? (
                                        <div className="h-12 w-64 bg-slate-700/40 rounded-xl animate-pulse" />
                                    ) : (
                                        <p className="text-5xl font-bold text-white tracking-tight">{fmtMoney(comprasStats.grandTotal)}</p>
                                    )}
                                    <p className="text-slate-400 text-sm mt-2">{comprasStats.grandCount} factura(s) de compra registrada(s)</p>
                                </div>
                            </div>

                            <div className="bg-slate-800/40 border border-slate-700/50 rounded-3xl p-8 flex flex-col justify-between shadow-lg shadow-black/20">
                                <div className="flex items-center gap-3 text-emerald-300/80 text-sm font-semibold uppercase tracking-wider">
                                    <TrendingUp className="w-5 h-5" /> Años con compras
                                </div>
                                <div className="mt-4">
                                    <p className="text-5xl font-bold text-white tracking-tight">{comprasStats.years.length}</p>
                                    <p className="text-slate-400 text-sm mt-2">
                                        {comprasStats.years.length > 0
                                            ? `${comprasStats.years[comprasStats.years.length - 1].year} – ${comprasStats.years[0].year}`
                                            : 'Sin datos'}
                                    </p>
                                </div>
                            </div>
                        </>
                    )}
                </section>

                {/* Por año */}
                <section className="space-y-4">
                    <h2 className="text-xl font-semibold text-slate-200 flex items-center gap-2">
                        <Calendar className={cn("w-5 h-5", accent.text)} /> {view === 'ventas' ? 'Ventas por año' : 'Compras por año'}
                    </h2>
                    {loading ? (
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                            {[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-slate-800/40 rounded-2xl animate-pulse border border-slate-700/40" />)}
                        </div>
                    ) : activeStats.years.length === 0 ? (
                        <p className="text-slate-500 text-sm bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6">
                            {view === 'ventas'
                                ? 'Aún no hay ventas cobradas. Marca facturas como cobradas en "Facturas Emitidas".'
                                : 'No hay facturas de compra registradas todavía.'}
                        </p>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                            {activeStats.years.map(y => {
                                const isSel = selectedYear === y.year;
                                return (
                                    <button
                                        key={y.year}
                                        onClick={() => setSelectedYear(y.year)}
                                        className={cn(
                                            "text-left rounded-2xl p-5 border transition-all hover:-translate-y-0.5",
                                            isSel
                                                ? (view === 'ventas'
                                                    ? "bg-emerald-500/15 border-emerald-500/50 shadow-lg shadow-emerald-500/10"
                                                    : "bg-sky-500/15 border-sky-500/50 shadow-lg shadow-sky-500/10")
                                                : "bg-slate-800/40 border-slate-700/50 hover:bg-slate-800/80 hover:border-slate-600"
                                        )}
                                    >
                                        <p className={cn("text-sm font-semibold", isSel ? accent.textSoft : "text-slate-400")}>{y.year}</p>
                                        <p className="text-2xl font-bold text-white mt-2 tracking-tight">{fmtMoney(y.total)}</p>
                                        <p className="text-xs text-slate-500 mt-1">{y.count} factura(s)</p>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </section>

                {/* Por mes (del año seleccionado) */}
                <section className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <h2 className="text-xl font-semibold text-slate-200 flex items-center gap-2">
                            <Calendar className="w-5 h-5 text-violet-400" /> {view === 'ventas' ? 'Ventas por mes' : 'Compras por mes'}
                            {selectedYear != null && <span className="text-violet-300">· {selectedYear}</span>}
                        </h2>
                        {selectedYear != null && (
                            <span className="text-sm text-slate-400">
                                Total {selectedYear}: <span className="text-white font-semibold">{fmtMoney(selectedYearTotal)}</span>
                            </span>
                        )}
                    </div>

                    {loading ? (
                        <div className="bg-slate-800/40 border border-slate-700/50 rounded-3xl p-6 space-y-3">
                            {[...Array(6)].map((_, i) => <div key={i} className="h-8 bg-slate-700/30 rounded-lg animate-pulse" />)}
                        </div>
                    ) : selectedYear == null ? (
                        <p className="text-slate-500 text-sm bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6">Selecciona un año para ver el desglose mensual.</p>
                    ) : (
                        <div className="bg-slate-800/40 border border-slate-700/50 rounded-3xl p-6 backdrop-blur-sm">
                            <div className="space-y-2">
                                {monthsForSelectedYear.map(m => (
                                    <div key={m.idx} className="flex items-center gap-4">
                                        <span className="w-24 text-sm text-slate-400 flex-shrink-0">{m.name}</span>
                                        <div className="flex-1 h-7 bg-slate-900/50 rounded-lg overflow-hidden relative">
                                            <div
                                                className={cn(
                                                    "h-full rounded-lg transition-all duration-500",
                                                    m.total > 0
                                                        ? (view === 'ventas'
                                                            ? "bg-gradient-to-r from-emerald-500/60 to-teal-500/60"
                                                            : "bg-gradient-to-r from-violet-500/60 to-sky-500/60")
                                                        : ""
                                                )}
                                                style={{ width: `${(m.total / maxMonthTotal) * 100}%` }}
                                            />
                                        </div>
                                        <span className="w-36 text-right text-sm font-medium text-slate-200 flex-shrink-0">{fmtMoney(m.total)}</span>
                                        <span className="w-20 text-right text-xs text-slate-500 flex-shrink-0">{m.count} fact.</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </section>

                {/* Por facturar vs por cobrar (año objetivo) */}
                <section className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <h2 className="text-xl font-semibold text-slate-200 flex items-center gap-2">
                            <Link2 className="w-5 h-5 text-fuchsia-400" /> Por facturar vs por cobrar
                            <span className="text-fuchsia-300">· {BILLING_YEAR}</span>
                        </h2>
                        <Link href="/sales/billing-inbox" className="inline-flex items-center gap-1.5 text-sm text-fuchsia-300 hover:text-fuchsia-200 bg-fuchsia-500/10 hover:bg-fuchsia-500/20 px-3 py-1.5 rounded-lg border border-fuchsia-500/20">
                            <Link2 className="w-3.5 h-3.5" /> Revisar facturación IA <ExternalLink className="w-3 h-3" />
                        </Link>
                    </div>

                    <p className="text-sm text-slate-400 -mt-1">
                        Compara la <span className="text-violet-300">venta aprobada que falta por facturar</span> (cotizaciones aprobadas sin su CFDI) contra las <span className="text-amber-300">facturas que faltan por cobrar</span>. Haz clic en una cotización para ver sus partidas.
                    </p>

                    {billingNote && (
                        <div className="p-4 rounded-xl border bg-amber-500/10 border-amber-500/30 text-amber-300 text-sm">
                            {billingNote}
                        </div>
                    )}
                    {markError && (
                        <div className="p-4 rounded-xl border bg-red-500/10 border-red-500/30 text-red-400 text-sm">
                            {markError}
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="bg-gradient-to-br from-violet-500/10 to-indigo-500/10 border border-violet-500/30 rounded-3xl p-6 flex flex-col justify-between shadow-lg shadow-black/20">
                            <div className="flex items-center gap-3 text-violet-300/80 text-sm font-semibold uppercase tracking-wider">
                                <FileSpreadsheet className="w-5 h-5" /> Venta aprobada por facturar
                            </div>
                            <div className="mt-4">
                                <p className="text-4xl font-bold text-white tracking-tight">{fmtMoney(facturacion.porFacturar)}</p>
                                <p className="text-slate-400 text-sm mt-2">{facturacion.pendingList.length} cotización(es) con partidas pendientes</p>
                            </div>
                        </div>

                        <div className="bg-gradient-to-br from-amber-500/10 to-orange-500/5 border border-amber-500/30 rounded-3xl p-6 flex flex-col justify-between shadow-lg shadow-black/20">
                            <div className="flex items-center gap-3 text-amber-300/80 text-sm font-semibold uppercase tracking-wider">
                                <Wallet className="w-5 h-5" /> Facturas por cobrar
                            </div>
                            <div className="mt-4">
                                <p className="text-4xl font-bold text-white tracking-tight">{fmtMoney(facturacion.porCobrarYear)}</p>
                                <p className="text-slate-400 text-sm mt-2">{facturacion.porCobrarYearCount} factura(s) emitida(s) sin cobrar</p>
                            </div>
                        </div>

                        <div className="bg-slate-800/40 border border-slate-700/50 rounded-3xl p-6 flex flex-col justify-between shadow-lg shadow-black/20">
                            <div className="flex items-center gap-3 text-emerald-300/80 text-sm font-semibold uppercase tracking-wider">
                                <Coins className="w-5 h-5" /> Ya facturado de lo aprobado
                            </div>
                            <div className="mt-4">
                                <p className="text-4xl font-bold text-white tracking-tight">{fmtMoney(facturacion.facturado)}</p>
                                <p className="text-slate-400 text-sm mt-2">{facturacion.approvedCount} cotización(es) aprobada(s) en {BILLING_YEAR}</p>
                            </div>
                        </div>
                    </div>

                    {loading ? null : facturacion.pendingList.length === 0 ? (
                        <p className="text-slate-500 text-sm bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6">
                            {facturacion.approvedCount === 0
                                ? `No hay cotizaciones aprobadas en ${BILLING_YEAR}.`
                                : "Todas las partidas de las cotizaciones aprobadas ya están facturadas (por IA confirmada o marcadas manualmente). 🎉"}
                        </p>
                    ) : (
                        <div className="bg-slate-800/40 border border-slate-700/50 rounded-3xl overflow-hidden backdrop-blur-sm">
                            <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                                <table className="w-full text-left text-sm whitespace-nowrap">
                                    <thead className="bg-slate-900/50 text-slate-400 uppercase text-xs font-semibold tracking-wider sticky top-0">
                                        <tr>
                                            <th className="px-6 py-4">Cotización</th>
                                            <th className="px-6 py-4">Cliente</th>
                                            <th className="px-6 py-4 text-center">Partidas pendientes</th>
                                            <th className="px-6 py-4 text-right">Por facturar</th>
                                            <th className="px-6 py-4 text-right">Acción</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-700/50">
                                        {facturacion.pendingList.map((q) => (
                                            <tr
                                                key={q.id}
                                                onClick={() => setSelectedQuote({ id: q.id, number: q.number, client: q.client })}
                                                className="hover:bg-slate-800/80 transition-colors cursor-pointer"
                                            >
                                                <td className="px-6 py-4">
                                                    <span className="font-mono font-medium text-emerald-300 bg-emerald-500/10 px-2.5 py-1 rounded-md border border-emerald-500/20">{q.number}</span>
                                                </td>
                                                <td className="px-6 py-4 font-medium text-slate-200 max-w-[280px] truncate">{q.client || "—"}</td>
                                                <td className="px-6 py-4 text-center text-slate-400">{q.pendingCount}</td>
                                                <td className="px-6 py-4 text-right font-medium text-violet-300">{fmtMoney(q.pendingAmount)}</td>
                                                <td className="px-6 py-4 text-right">
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); markBilled(q.id, true); }}
                                                        disabled={markingId === q.id}
                                                        title="Esta cotización ya está entregada y facturada — quitar de 'por facturar'"
                                                        className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 px-3 py-1.5 rounded-lg border border-emerald-500/20 disabled:opacity-50 disabled:cursor-wait whitespace-nowrap"
                                                    >
                                                        {markingId === q.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Ya facturada
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* Marcadas manualmente como facturadas (deshacer) */}
                    {facturacion.manualList.length > 0 && (
                        <div className="bg-slate-800/30 border border-slate-700/40 rounded-2xl p-4">
                            <p className="text-xs text-slate-400 uppercase tracking-wide font-semibold mb-3 flex items-center gap-2">
                                <Check className="w-3.5 h-3.5 text-emerald-400" /> Marcadas manualmente como facturadas ({facturacion.manualList.length})
                            </p>
                            <div className="flex flex-wrap gap-2">
                                {facturacion.manualList.map(q => (
                                    <span key={q.id} className="inline-flex items-center gap-2 bg-slate-900/50 border border-slate-700/50 rounded-lg pl-3 pr-1.5 py-1.5 text-xs">
                                        <button onClick={() => setSelectedQuote({ id: q.id, number: q.number, client: q.client })} className="font-mono text-emerald-300 hover:text-emerald-200 hover:underline" title="Ver partidas">{q.number}</button>
                                        <span className="text-slate-400 max-w-[160px] truncate">{q.client || "—"}</span>
                                        <span className="text-slate-300 font-medium">{fmtMoney(q.total)}</span>
                                        <button
                                            onClick={() => markBilled(q.id, false)}
                                            disabled={markingId === q.id}
                                            title="Deshacer: volver a contar como 'por facturar'"
                                            className="inline-flex items-center gap-1 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 px-2 py-1 rounded-md border border-slate-700 disabled:opacity-50"
                                        >
                                            {markingId === q.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />} Deshacer
                                        </button>
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </section>

                {/* Cuentas por cobrar */}
                <section className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <h2 className="text-xl font-semibold text-slate-200 flex items-center gap-2">
                            <Wallet className="w-5 h-5 text-amber-400" /> Cuentas por cobrar
                            <span className="text-sm font-normal text-slate-400">{porCobrar.count}</span>
                        </h2>
                        <div className="flex items-center gap-4">
                            <span className="text-sm text-slate-400">
                                Total: <span className="text-amber-300 font-semibold">{fmtMoney(porCobrar.total)}</span>
                            </span>
                            <Link href="/issued-invoices" className="inline-flex items-center gap-1.5 text-sm text-teal-300 hover:text-teal-200 bg-teal-500/10 hover:bg-teal-500/20 px-3 py-1.5 rounded-lg border border-teal-500/20">
                                <Receipt className="w-3.5 h-3.5" /> Ver facturas <ExternalLink className="w-3 h-3" />
                            </Link>
                        </div>
                    </div>

                    {loading ? (
                        <div className="bg-slate-800/40 border border-slate-700/50 rounded-3xl p-6 space-y-3">
                            {[...Array(4)].map((_, i) => <div key={i} className="h-8 bg-slate-700/30 rounded-lg animate-pulse" />)}
                        </div>
                    ) : porCobrar.count === 0 ? (
                        <p className="text-slate-500 text-sm bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6">
                            No hay cuentas por cobrar. Todas las facturas emitidas están marcadas como cobradas. 🎉
                        </p>
                    ) : (
                        <div className="bg-slate-800/40 border border-slate-700/50 rounded-3xl overflow-hidden backdrop-blur-sm">
                            <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                                <table className="w-full text-left text-sm whitespace-nowrap">
                                    <thead className="bg-slate-900/50 text-slate-400 uppercase text-xs font-semibold tracking-wider sticky top-0">
                                        <tr>
                                            <th className="px-6 py-4">Cliente</th>
                                            <th className="px-6 py-4">RFC</th>
                                            <th className="px-6 py-4">Serie-Folio</th>
                                            <th className="px-6 py-4">Fecha</th>
                                            <th className="px-6 py-4">Antigüedad</th>
                                            <th className="px-6 py-4 text-right">Total</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-700/50">
                                        {porCobrar.list.map(r => {
                                            const age = dayAge(r.invoice_date, r.created_at);
                                            return (
                                                <tr key={r.id} className="hover:bg-slate-800/80 transition-colors">
                                                    <td className="px-6 py-4 font-medium text-slate-200 max-w-[260px] truncate">{r.receptor_nombre || "—"}</td>
                                                    <td className="px-6 py-4 font-mono text-xs text-slate-400">{r.receptor_rfc || "—"}</td>
                                                    <td className="px-6 py-4 font-mono text-xs text-teal-300">{[r.serie, r.folio].filter(Boolean).join("-") || "—"}</td>
                                                    <td className="px-6 py-4 text-slate-400">{r.invoice_date ? new Date(r.invoice_date).toLocaleDateString() : "—"}</td>
                                                    <td className="px-6 py-4">
                                                        {age == null ? <span className="text-slate-600">—</span> : (
                                                            <span className={cn(
                                                                "text-xs font-medium px-2 py-1 rounded-md",
                                                                age >= 60 ? "bg-red-500/10 text-red-300 border border-red-500/20"
                                                                    : age >= 30 ? "bg-amber-500/10 text-amber-300 border border-amber-500/20"
                                                                        : "bg-slate-700/40 text-slate-300 border border-slate-600/30"
                                                            )}>
                                                                {age} día{age === 1 ? "" : "s"}
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="px-6 py-4 text-right font-medium text-amber-300">{fmtMoney(Number(r.total) || 0)}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </section>
            </div>

            {selectedQuote && (
                <QuotationItemsModal
                    quote={selectedQuote}
                    confirmedItemIds={confirmedItemIds}
                    manuallyBilled={manuallyBilledIds.has(selectedQuote.id)}
                    marking={markingId === selectedQuote.id}
                    onToggleBilled={(value) => markBilled(selectedQuote.id, value)}
                    onClose={() => setSelectedQuote(null)}
                />
            )}
        </div>
    );
}
