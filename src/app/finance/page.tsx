"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
    ArrowLeft, Users, Banknote, FileBarChart, Clock, Wallet, Receipt, ChevronRight,
    RefreshCw, Calculator, Calendar, AlertCircle, CheckCircle2, Hourglass
} from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

const monthLabel = (period: string) => {
    // 'YYYY-MM' → 'Mes Año'
    const [y, m] = period.split("-");
    const meses = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    return `${meses[parseInt(m, 10) - 1] || m} ${y}`;
};

const fmtMoney = (n: number | null | undefined) =>
    `$${(Number(n) || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function FinanceIndex() {
    const [stats, setStats] = useState({
        activeEmployees: 0,
        openPeriods: 0,
        recentDeclarations: 0,
        lastMonthIva: null as null | { period: string; iva_to_pay: number },
    });
    const [recentDeclarations, setRecentDeclarations] = useState<any[]>([]);
    const [pendingMovements, setPendingMovements] = useState(0);
    const [loading, setLoading] = useState(true);

    const load = async () => {
        setLoading(true);
        try {
            const [{ count: empCount }, { data: periods }, { data: declarations }, { count: moveCount }] = await Promise.all([
                supabase.from("employees").select("id", { count: "exact", head: true }).eq("status", "active"),
                supabase.from("payroll_periods").select("id, period_type, start_date, end_date, status, total_net").in("status", ["draft", "calculated", "approved"]),
                supabase.from("monthly_declarations").select("*").order("period", { ascending: false }).limit(6),
                supabase.from("bank_movements").select("id", { count: "exact", head: true }),
            ]);
            setStats(s => ({
                ...s,
                activeEmployees: empCount || 0,
                openPeriods: (periods || []).length,
                recentDeclarations: (declarations || []).length,
            }));
            setRecentDeclarations(declarations || []);
            setPendingMovements(moveCount || 0);

            // Buscar última declaración IVA
            const { data: lastIva } = await supabase
                .from("monthly_declarations")
                .select("id, period, total_to_pay, in_favor, declaration_iva(iva_a_pagar, saldo_a_favor_nuevo)")
                .eq("declaration_type", "IVA")
                .order("period", { ascending: false })
                .limit(1)
                .single();
            if (lastIva) {
                const ivaData = Array.isArray(lastIva.declaration_iva) ? lastIva.declaration_iva[0] : lastIva.declaration_iva;
                setStats(s => ({
                    ...s,
                    lastMonthIva: {
                        period: lastIva.period,
                        iva_to_pay: ivaData?.iva_a_pagar ?? lastIva.total_to_pay ?? 0,
                    },
                }));
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { load(); }, []);

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-6 md:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-6xl mx-auto space-y-8">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors text-neutral-400 hover:text-white border border-neutral-700">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div>
                            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                                <Wallet className="w-8 h-8 text-emerald-400" />
                                Nóminas y Contabilidad
                            </h1>
                            <p className="text-neutral-400 text-sm mt-1">Empleados, nómina, checador y declaraciones mensuales.</p>
                        </div>
                    </div>
                    <button onClick={load} className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg transition-colors flex items-center gap-2 text-sm" disabled={loading}>
                        <RefreshCw className={cn("w-4 h-4", loading && "animate-spin text-emerald-400")} /> Actualizar
                    </button>
                </header>

                {/* Quick stats */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <StatCard
                        title="Empleados activos"
                        value={String(stats.activeEmployees)}
                        Icon={Users}
                        color="emerald"
                        sub="En plantilla"
                    />
                    <StatCard
                        title="Periodos abiertos"
                        value={String(stats.openPeriods)}
                        Icon={Hourglass}
                        color="amber"
                        sub="Por calcular / pagar"
                    />
                    <StatCard
                        title="Último IVA a pagar"
                        value={stats.lastMonthIva ? fmtMoney(stats.lastMonthIva.iva_to_pay) : "—"}
                        Icon={Calculator}
                        color="cyan"
                        sub={stats.lastMonthIva ? monthLabel(stats.lastMonthIva.period) : "Sin declaración aún"}
                    />
                </div>

                {/* Modules */}
                <section>
                    <h2 className="text-xl font-semibold text-white mb-4">Módulos</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                        <ModuleCard
                            href="/finance/employees"
                            title="Empleados"
                            desc="Personal contratado: salario, bonos, deducciones, datos fiscales."
                            Icon={Users}
                            color="emerald"
                            badge={`${stats.activeEmployees} activos`}
                        />
                        <ModuleCard
                            href="/finance/checador"
                            title="Checador"
                            desc="Sube el archivo del reloj checador y calcula las horas trabajadas y extras."
                            Icon={Clock}
                            color="cyan"
                            badge="CSV / XLSX"
                        />
                        <ModuleCard
                            href="/finance/payroll"
                            title="Nómina"
                            desc="Periodos (semanal / quincenal / mensual), cálculo automático, recibos detallados."
                            Icon={Banknote}
                            color="amber"
                            badge={`${stats.openPeriods} abiertos`}
                        />
                        <ModuleCard
                            href="/finance/declarations"
                            title="Declaraciones mensuales"
                            desc="IVA, ISR provisional, DIOT. Acuses del SAT y control de pagos."
                            Icon={Receipt}
                            color="rose"
                            badge="Almacén histórico"
                        />
                        <ModuleCard
                            href="/finance/iva"
                            title="Cálculo de IVA"
                            desc="Vista rápida: iva cobrado (ventas) − iva acreditable (compras) = iva a pagar."
                            Icon={Calculator}
                            color="emerald"
                            badge="Tiempo real"
                        />
                        <ModuleCard
                            href="/finance/movements"
                            title="Movimientos bancarios"
                            desc="Tracking de ingresos / egresos con conciliado contra declaraciones y nómina."
                            Icon={FileBarChart}
                            color="sky"
                            badge={`${pendingMovements} registrados`}
                        />
                    </div>
                </section>

                {/* Recent declarations */}
                <section className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl p-5">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                            <Receipt className="w-5 h-5 text-rose-400" /> Declaraciones recientes
                        </h3>
                        <Link href="/finance/declarations" className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1">
                            Ver todas <ChevronRight className="w-3.5 h-3.5" />
                        </Link>
                    </div>
                    {recentDeclarations.length === 0 ? (
                        <p className="text-sm text-neutral-500 text-center py-6">Sin declaraciones registradas aún.</p>
                    ) : (
                        <ul className="divide-y divide-neutral-700/50">
                            {recentDeclarations.map(d => (
                                <li key={d.id} className="py-3 flex items-center gap-3 hover:bg-neutral-800/40 -mx-2 px-2 rounded-lg">
                                    <div className={cn(
                                        "w-10 h-10 rounded-lg flex items-center justify-center",
                                        d.declaration_type === "IVA" ? "bg-emerald-500/10 text-emerald-300" :
                                        d.declaration_type === "ISR_PROVISIONAL" ? "bg-amber-500/10 text-amber-300" :
                                        "bg-sky-500/10 text-sky-300"
                                    )}>
                                        <Receipt className="w-5 h-5" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-white font-medium text-sm">{d.declaration_type.replace("_", " ")} · {monthLabel(d.period)}</p>
                                        <p className="text-[11px] text-neutral-500">
                                            {d.status === "filed" ? `Presentada ${d.filed_at ? new Date(d.filed_at).toLocaleDateString() : ""}` :
                                             d.status === "paid" ? `Pagada ${d.paid_at ? new Date(d.paid_at).toLocaleDateString() : ""}` :
                                             d.status === "draft" ? "Borrador" : d.status}
                                            {d.folio_sat ? ` · Folio SAT: ${d.folio_sat}` : ""}
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm font-mono font-semibold text-emerald-300">{fmtMoney(d.total_to_pay)}</p>
                                        <p className="text-[10px] text-neutral-500">{d.status}</p>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            </div>
        </div>
    );
}

function StatCard({ title, value, Icon, color, sub }: any) {
    const colors: Record<string, string> = {
        emerald: "border-emerald-500/30 bg-emerald-500/5 text-emerald-300",
        amber:   "border-amber-500/30 bg-amber-500/5 text-amber-300",
        cyan:    "border-cyan-500/30 bg-cyan-500/5 text-cyan-300",
    };
    return (
        <div className={cn("rounded-2xl border p-4 flex items-center gap-3", colors[color])}>
            <div className="w-11 h-11 rounded-xl bg-neutral-900/40 flex items-center justify-center">
                <Icon className="w-5 h-5" />
            </div>
            <div>
                <p className="text-[11px] uppercase tracking-wider opacity-80">{title}</p>
                <p className="text-2xl font-bold text-white">{value}</p>
                <p className="text-[10px] text-neutral-500">{sub}</p>
            </div>
        </div>
    );
}

function ModuleCard({ href, title, desc, Icon, color, badge }: any) {
    const palette: Record<string, { card: string; icon: string; badge: string }> = {
        emerald: { card: "border-emerald-500/30 hover:border-emerald-500/70", icon: "bg-emerald-500/20 text-emerald-300", badge: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" },
        amber:   { card: "border-amber-500/30 hover:border-amber-500/70", icon: "bg-amber-500/20 text-amber-300", badge: "bg-amber-500/10 text-amber-300 border-amber-500/30" },
        cyan:    { card: "border-cyan-500/30 hover:border-cyan-500/70", icon: "bg-cyan-500/20 text-cyan-300", badge: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30" },
        rose:    { card: "border-rose-500/30 hover:border-rose-500/70", icon: "bg-rose-500/20 text-rose-300", badge: "bg-rose-500/10 text-rose-300 border-rose-500/30" },
        sky:     { card: "border-sky-500/30 hover:border-sky-500/70", icon: "bg-sky-500/20 text-sky-300", badge: "bg-sky-500/10 text-sky-300 border-sky-500/30" },
    };
    const c = palette[color] || palette.emerald;
    return (
        <Link href={href} className={cn("group bg-neutral-800/40 border rounded-2xl p-5 hover:bg-neutral-800/70 transition-all shadow-lg shadow-black/20 hover:-translate-y-0.5", c.card)}>
            <div className="flex items-start justify-between">
                <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform", c.icon)}>
                    <Icon className="w-6 h-6" />
                </div>
                <ChevronRight className="w-5 h-5 text-neutral-500 group-hover:text-white transition-colors" />
            </div>
            <h3 className="mt-3 text-lg font-semibold text-white">{title}</h3>
            <p className="text-sm text-neutral-400 mt-1">{desc}</p>
            {badge && <span className={cn("inline-block mt-3 text-[10px] font-semibold px-2 py-0.5 rounded-full border uppercase tracking-wider", c.badge)}>{badge}</span>}
        </Link>
    );
}
