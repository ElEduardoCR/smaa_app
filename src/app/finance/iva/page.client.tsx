"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
    ArrowLeft, Calculator, RefreshCw, TrendingUp, TrendingDown, Wallet
} from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

const fmt = (n: number | null | undefined) =>
    `$${(Number(n) || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const monthLabel = (period: string) => {
    const [y, m] = period.split("-");
    const meses = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    return `${meses[parseInt(m, 10) - 1] || m} ${y}`;
};

export default function IvaCalcPage() {
    const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
    const [saldoFavorAnt, setSaldoFavorAnt] = useState(0);
    const [sales, setSales] = useState({ iva: 0, ingresos: 0, count: 0 });
    const [purchases, setPurchases] = useState({ iva: 0, subtotal: 0, count: 0 });
    const [loading, setLoading] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            // La tabla monthly_iva_summary se actualiza automáticamente
            // por trigger al subir/modificar facturas (ventas o compras).
            const { data: s } = await supabase
                .from("monthly_iva_summary")
                .select("*")
                .eq("period", period)
                .maybeSingle();
            setSales({
                iva: s?.iva_cobrado_total || 0,
                ingresos: s?.total_ventas_gravadas || 0,
                count: s?.invoice_count_sales || 0,
            });
            setPurchases({
                iva: s?.iva_acreditable_total || 0,
                subtotal: s?.total_compras_gravadas || 0,
                count: s?.invoice_count_purchases || 0,
            });

            // Saldo a favor anterior: última declaración anterior
            const { data: prev } = await supabase
                .from("monthly_declarations")
                .select("in_favor, declaration_iva(saldo_a_favor_nuevo)")
                .lt("period", period)
                .order("period", { ascending: false })
                .limit(1)
                .maybeSingle();
            const ivaData = Array.isArray(prev?.declaration_iva) ? prev.declaration_iva[0] : prev?.declaration_iva;
            setSaldoFavorAnt(ivaData?.saldo_a_favor_nuevo ?? prev?.in_favor ?? 0);
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    };
    useEffect(() => { load(); }, [period]);

    const ivaAPagar = Math.max(0, sales.iva - purchases.iva - saldoFavorAnt);
    const saldoFavorNuevo = Math.max(0, purchases.iva + saldoFavorAnt - sales.iva);

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-6 md:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-5xl mx-auto space-y-6">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50">
                    <div className="flex items-center gap-4">
                        <Link href="/finance" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl text-neutral-400 hover:text-white border border-neutral-700">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div>
                            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                                <Calculator className="w-8 h-8 text-emerald-400" />
                                Cálculo de IVA
                            </h1>
                            <p className="text-neutral-400 text-sm mt-1">Tiempo real: ventas (CFDI emitidos) − compras (CFDI recibidos) = IVA a pagar.</p>
                        </div>
                    </div>
                    <Link href="/finance/declarations" className="text-sm text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 px-4 py-2 rounded-lg border border-emerald-500/20">
                        Ir a declaraciones →
                    </Link>
                </header>

                <div className="bg-neutral-800/40 p-4 rounded-2xl border border-neutral-700/50 flex items-center gap-3">
                    <label className="text-sm text-neutral-400">Periodo (YYYY-MM):</label>
                    <input value={period} onChange={e => setPeriod(e.target.value)} placeholder="2026-01" className="bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-emerald-500 font-mono" />
                    <button onClick={load} className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg" disabled={loading}>
                        <RefreshCw className={cn("w-4 h-4", loading && "animate-spin text-emerald-400")} />
                    </button>
                    <span className="text-sm text-neutral-300 ml-2">{monthLabel(period)}</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-emerald-500/5 border border-emerald-500/30 rounded-2xl p-5">
                        <div className="flex items-center gap-2 mb-2">
                            <TrendingUp className="w-5 h-5 text-emerald-400" />
                            <h2 className="text-sm font-semibold text-emerald-200">IVA cobrado (ventas)</h2>
                        </div>
                        <p className="text-3xl font-bold text-emerald-100 font-mono">{fmt(sales.iva)}</p>
                        <p className="text-xs text-emerald-300/80 mt-2">Sobre {fmt(sales.ingresos)} de ingresos gravados · {sales.count} factura(s)</p>
                    </div>
                    <div className="bg-amber-500/5 border border-amber-500/30 rounded-2xl p-5">
                        <div className="flex items-center gap-2 mb-2">
                            <TrendingDown className="w-5 h-5 text-amber-400" />
                            <h2 className="text-sm font-semibold text-amber-200">IVA acreditable (compras)</h2>
                        </div>
                        <p className="text-3xl font-bold text-amber-100 font-mono">{fmt(purchases.iva)}</p>
                        <p className="text-xs text-amber-300/80 mt-2">Sobre {fmt(purchases.subtotal)} de compras · {purchases.count} factura(s)</p>
                    </div>
                </div>

                <div className="bg-neutral-800/40 p-4 rounded-2xl border border-neutral-700/50">
                    <label className="text-sm text-neutral-400">Saldo a favor del periodo anterior (manual):</label>
                    <input type="number" step="0.01" value={saldoFavorAnt} onChange={e => setSaldoFavorAnt(Number(e.target.value))} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500 font-mono" />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-rose-500/10 border-2 border-rose-500/40 rounded-2xl p-6 text-center">
                        <Wallet className="w-8 h-8 mx-auto mb-2 text-rose-300" />
                        <p className="text-xs uppercase tracking-wider text-rose-300">IVA a pagar al SAT</p>
                        <p className="text-4xl font-bold text-rose-200 font-mono mt-2">{fmt(ivaAPagar)}</p>
                        <p className="text-[10px] text-rose-300/60 mt-2">Si hay saldo a favor nuevo, no hay pago pero se reporta.</p>
                    </div>
                    <div className="bg-emerald-500/10 border-2 border-emerald-500/40 rounded-2xl p-6 text-center">
                        <Wallet className="w-8 h-8 mx-auto mb-2 text-emerald-300" />
                        <p className="text-xs uppercase tracking-wider text-emerald-300">Saldo a favor nuevo</p>
                        <p className="text-4xl font-bold text-emerald-200 font-mono mt-2">{fmt(saldoFavorNuevo)}</p>
                        <p className="text-[10px] text-emerald-300/60 mt-2">Se arrastra al siguiente periodo.</p>
                    </div>
                </div>

                <p className="text-xs text-neutral-500 text-center">
                    Los datos se leen de las tablas <code>issued_invoices</code> (ventas) y <code>purchase_orders</code> + <code>invoice_inbox</code> (compras) para el periodo seleccionado. Si tus facturas no aparecen, revisa que tengan <code>invoice_date</code> y que el formato sea <code>YYYY-MM</code>.
                </p>
            </div>
        </div>
    );
}
