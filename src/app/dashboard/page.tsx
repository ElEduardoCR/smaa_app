"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, BarChart3, RefreshCw, TrendingUp, Calendar, ShoppingCart } from "lucide-react";
import Link from "next/link";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

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

const MONTH_NAMES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const fmtMoney = (n: number) =>
    `$${Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function DashboardPage() {
    const [rows, setRows] = useState<PORow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedYear, setSelectedYear] = useState<number | null>(null);

    const fetchData = async () => {
        setLoading(true);
        setError(null);
        try {
            const { data, error } = await supabase
                .from('purchase_orders')
                .select('id, total, invoice_date, created_at, status')
                .limit(10000);
            if (error) throw error;
            setRows((data as PORow[]) || []);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, []);

    // Fecha efectiva: fecha de la factura emitida, con respaldo a fecha de creación
    const effectiveDate = (r: PORow): Date => new Date(r.invoice_date || r.created_at);

    const stats = useMemo(() => {
        // Excluye órdenes canceladas del conteo de gasto
        const valid = rows.filter(r => (r.status || '').toLowerCase() !== 'cancelled' && (r.status || '').toLowerCase() !== 'canceled');

        let grandTotal = 0;
        let grandCount = 0;
        const byYear = new Map<number, { total: number; count: number }>();
        // clave "YYYY-MM"
        const byMonth = new Map<string, { total: number; count: number }>();

        for (const r of valid) {
            const amount = Number(r.total) || 0;
            const d = effectiveDate(r);
            if (isNaN(d.getTime())) continue;
            const y = d.getFullYear();
            const m = d.getMonth();

            grandTotal += amount;
            grandCount += 1;

            const yEntry = byYear.get(y) || { total: 0, count: 0 };
            yEntry.total += amount; yEntry.count += 1;
            byYear.set(y, yEntry);

            const key = `${y}-${m}`;
            const mEntry = byMonth.get(key) || { total: 0, count: 0 };
            mEntry.total += amount; mEntry.count += 1;
            byMonth.set(key, mEntry);
        }

        const years = Array.from(byYear.entries())
            .map(([year, v]) => ({ year, ...v }))
            .sort((a, b) => b.year - a.year);

        return { grandTotal, grandCount, years, byMonth };
    }, [rows]);

    // Selecciona automáticamente el año más reciente cuando lleguen los datos
    useEffect(() => {
        if (selectedYear == null && stats.years.length > 0) {
            setSelectedYear(stats.years[0].year);
        }
    }, [stats.years, selectedYear]);

    const monthsForSelectedYear = useMemo(() => {
        if (selectedYear == null) return [];
        return MONTH_NAMES.map((name, idx) => {
            const entry = stats.byMonth.get(`${selectedYear}-${idx}`);
            return { idx, name, total: entry?.total || 0, count: entry?.count || 0 };
        });
    }, [selectedYear, stats.byMonth]);

    const maxMonthTotal = useMemo(
        () => Math.max(1, ...monthsForSelectedYear.map(m => m.total)),
        [monthsForSelectedYear]
    );

    const selectedYearTotal = useMemo(() => {
        if (selectedYear == null) return 0;
        return stats.years.find(y => y.year === selectedYear)?.total || 0;
    }, [selectedYear, stats.years]);

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
                            <p className="text-slate-400 text-sm mt-1">Estadísticas del negocio. Por ahora: gasto en facturas de compras, por año y por mes.</p>
                        </div>
                    </div>
                    <button onClick={fetchData} className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium" disabled={loading}>
                        <RefreshCw className={cn("w-4 h-4", loading && "animate-spin text-sky-400")} /> Refresh
                    </button>
                </header>

                {error && (
                    <div className="p-4 rounded-xl border bg-red-500/10 border-red-500/30 text-red-400">
                        {error}
                    </div>
                )}

                {/* Total general (todos los años) */}
                <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="md:col-span-2 bg-gradient-to-br from-sky-500/10 to-indigo-500/10 border border-sky-500/30 rounded-3xl p-8 flex flex-col justify-between shadow-lg shadow-black/20">
                        <div className="flex items-center gap-3 text-sky-300/80 text-sm font-semibold uppercase tracking-wider">
                            <ShoppingCart className="w-5 h-5" /> Total en compras · todos los años
                        </div>
                        <div className="mt-4">
                            {loading ? (
                                <div className="h-12 w-64 bg-slate-700/40 rounded-xl animate-pulse" />
                            ) : (
                                <p className="text-5xl font-bold text-white tracking-tight">{fmtMoney(stats.grandTotal)}</p>
                            )}
                            <p className="text-slate-400 text-sm mt-2">{stats.grandCount} factura(s) de compra registrada(s)</p>
                        </div>
                    </div>

                    <div className="bg-slate-800/40 border border-slate-700/50 rounded-3xl p-8 flex flex-col justify-between shadow-lg shadow-black/20">
                        <div className="flex items-center gap-3 text-emerald-300/80 text-sm font-semibold uppercase tracking-wider">
                            <TrendingUp className="w-5 h-5" /> Años con compras
                        </div>
                        <div className="mt-4">
                            <p className="text-5xl font-bold text-white tracking-tight">{stats.years.length}</p>
                            <p className="text-slate-400 text-sm mt-2">
                                {stats.years.length > 0
                                    ? `${stats.years[stats.years.length - 1].year} – ${stats.years[0].year}`
                                    : 'Sin datos'}
                            </p>
                        </div>
                    </div>
                </section>

                {/* Por año */}
                <section className="space-y-4">
                    <h2 className="text-xl font-semibold text-slate-200 flex items-center gap-2">
                        <Calendar className="w-5 h-5 text-sky-400" /> Por año
                    </h2>
                    {loading ? (
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                            {[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-slate-800/40 rounded-2xl animate-pulse border border-slate-700/40" />)}
                        </div>
                    ) : stats.years.length === 0 ? (
                        <p className="text-slate-500 text-sm bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6">No hay facturas de compra registradas todavía.</p>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                            {stats.years.map(y => (
                                <button
                                    key={y.year}
                                    onClick={() => setSelectedYear(y.year)}
                                    className={cn(
                                        "text-left rounded-2xl p-5 border transition-all hover:-translate-y-0.5",
                                        selectedYear === y.year
                                            ? "bg-sky-500/15 border-sky-500/50 shadow-lg shadow-sky-500/10"
                                            : "bg-slate-800/40 border-slate-700/50 hover:bg-slate-800/80 hover:border-slate-600"
                                    )}
                                >
                                    <p className={cn("text-sm font-semibold", selectedYear === y.year ? "text-sky-300" : "text-slate-400")}>{y.year}</p>
                                    <p className="text-2xl font-bold text-white mt-2 tracking-tight">{fmtMoney(y.total)}</p>
                                    <p className="text-xs text-slate-500 mt-1">{y.count} factura(s)</p>
                                </button>
                            ))}
                        </div>
                    )}
                </section>

                {/* Por mes (del año seleccionado) */}
                <section className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <h2 className="text-xl font-semibold text-slate-200 flex items-center gap-2">
                            <Calendar className="w-5 h-5 text-violet-400" /> Por mes
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
                                                    m.total > 0 ? "bg-gradient-to-r from-violet-500/60 to-sky-500/60" : ""
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
            </div>
        </div>
    );
}
