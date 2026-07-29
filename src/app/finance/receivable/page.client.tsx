"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
    ArrowLeft, RefreshCw, Wallet, AlertTriangle, TrendingUp, Users, Receipt,
    ChevronRight, Search, X, FileBarChart, Calendar, BadgeDollarSign, ExternalLink
} from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

const fmtMoney = (n: number | null | undefined) =>
    `$ ${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (iso: string | null) => {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }); }
    catch { return iso; }
};

type ClientDebt = {
    client_id: number;
    business_name: string;
    rfc: string | null;
    total_gross: number;
    total_vat: number;
    total_net: number;
    total_paid: number;
    total_balance: number;
    open_invoices: number;
    oldest_invoice_date: string | null;
};

type OldestInvoice = {
    id: string;
    invoice_number: string | null;
    concept: string;
    invoice_date: string;
    due_date: string | null;
    gross_amount: number;
    vat_amount: number;
    net_amount: number;
    balance: number;
    client: { id: number; business_name: string; rfc: string | null } | null;
    days_overdue: number;
};

export default function ReceivableDashboard() {
    const [loading, setLoading] = useState(true);
    const [clients, setClients] = useState<any[]>([]);
    const [debts, setDebts] = useState<ClientDebt[]>([]);
    const [oldest, setOldest] = useState<OldestInvoice[]>([]);
    const [totals, setTotals] = useState({ gross: 0, vat: 0, net: 0, balance: 0, open: 0, clients: 0, overdue: 0 });
    const [search, setSearch] = useState("");
    const [showObsolete, setShowObsolete] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            // Traer solo partidas activas con saldo pendiente
            const { data: invs, error } = await supabase
                .from("ar_invoices")
                .select(`
                    id, invoice_number, concept, invoice_date, due_date,
                    gross_amount, vat_amount, net_amount, paid_amount, balance, status, client_id,
                    client:clients(id, business_name, rfc, is_active)
                `)
                .eq("is_active", true)
                .order("invoice_date", { ascending: true });
            if (error) throw error;

            // Traer todos los clientes (para los que no tienen deuda pero podrían recibir asignaciones)
            const { data: cls } = await supabase
                .from("clients")
                .select("id, business_name, rfc, is_active")
                .eq("is_active", true)
                .order("business_name");
            setClients(cls || []);

            // Calcular agregados
            const debtMap = new Map<number, ClientDebt>();
            const oldestList: OldestInvoice[] = [];
            const today = new Date();

            for (const inv of (invs as any[]) || []) {
                const balance = Number(inv.balance) || 0;
                if (balance <= 0 && inv.status === 'paid') continue; // ignorar pagadas
                if (balance <= 0 && inv.status === 'cancelled') continue; // ignorar canceladas

                const cid = inv.client_id;
                const clientObj = Array.isArray(inv.client) ? inv.client[0] : inv.client;
                if (!clientObj) continue;

                const existing = debtMap.get(cid) || {
                    client_id: cid,
                    business_name: clientObj.business_name,
                    rfc: clientObj.rfc,
                    total_gross: 0, total_vat: 0, total_net: 0, total_paid: 0, total_balance: 0,
                    open_invoices: 0, oldest_invoice_date: null,
                };
                existing.total_gross += Number(inv.gross_amount) || 0;
                existing.total_vat += Number(inv.vat_amount) || 0;
                existing.total_net += Number(inv.net_amount) || 0;
                existing.total_paid += Number(inv.paid_amount) || 0;
                existing.total_balance += balance;
                existing.open_invoices += 1;
                if (!existing.oldest_invoice_date || inv.invoice_date < existing.oldest_invoice_date) {
                    existing.oldest_invoice_date = inv.invoice_date;
                }
                debtMap.set(cid, existing);

                // Calcular días de vencido
                const due = inv.due_date || inv.invoice_date;
                const days = Math.floor((today.getTime() - new Date(due).getTime()) / 86400000);
                if (days > 0 && balance > 0) {
                    oldestList.push({
                        id: inv.id,
                        invoice_number: inv.invoice_number,
                        concept: inv.concept,
                        invoice_date: inv.invoice_date,
                        due_date: inv.due_date,
                        gross_amount: Number(inv.gross_amount) || 0,
                        vat_amount: Number(inv.vat_amount) || 0,
                        net_amount: Number(inv.net_amount) || 0,
                        balance,
                        client: { id: cid, business_name: clientObj.business_name, rfc: clientObj.rfc },
                        days_overdue: days,
                    });
                }
            }

            const debtsArr = Array.from(debtMap.values()).sort((a, b) => b.total_balance - a.total_balance);
            const oldestArr = oldestList.sort((a, b) => b.days_overdue - a.days_overdue).slice(0, 15);

            const tot = debtsArr.reduce(
                (acc, c) => ({
                    gross: acc.gross + c.total_gross,
                    vat: acc.vat + c.total_vat,
                    net: acc.net + c.total_net,
                    balance: acc.balance + c.total_balance,
                    open: acc.open + c.open_invoices,
                    clients: 0,
                    overdue: 0,
                }),
                { gross: 0, vat: 0, net: 0, balance: 0, open: 0, clients: 0, overdue: 0 }
            );
            tot.clients = debtsArr.length;
            tot.overdue = oldestArr.length;

            setDebts(debtsArr);
            setOldest(oldestArr);
            setTotals(tot);
        } catch (e) {
            console.error("Error cargando dashboard AR:", e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const filteredDebts = useMemo(() => {
        if (!search.trim()) return debts;
        const q = search.toLowerCase();
        return debts.filter((d) =>
            d.business_name.toLowerCase().includes(q) ||
            (d.rfc || "").toLowerCase().includes(q)
        );
    }, [debts, search]);

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-3 sm:p-6 md:p-8 lg:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-[1500px] mx-auto space-y-6">
                {/* Header */}
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                        <Link href="/finance" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors text-neutral-400 hover:text-white border border-neutral-700">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div>
                            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                                <BadgeDollarSign className="w-8 h-8 text-cyan-400" />
                                Cuentas por Cobrar
                            </h1>
                            <p className="text-neutral-400 text-sm mt-1">Saldo pendiente, antigüedad de saldos y envío de estados de cuenta.</p>
                        </div>
                    </div>
                    <button onClick={load} disabled={loading} className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium">
                        <RefreshCw className={cn("w-4 h-4", loading && "animate-spin text-cyan-400")} /> Actualizar
                    </button>
                </header>

                {/* KPIs */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <KPI
                        title="Total por cobrar"
                        value={fmtMoney(totals.balance)}
                        sub={`${totals.open} partidas abiertas`}
                        Icon={Wallet}
                        color="cyan"
                    />
                    <KPI
                        title="Clientes con deuda"
                        value={String(totals.clients)}
                        sub={`de ${clients.length} totales`}
                        Icon={Users}
                        color="emerald"
                    />
                    <KPI
                        title="Vencidas"
                        value={String(totals.overdue)}
                        sub={totals.overdue > 0 ? "con días vencidos" : "al día"}
                        Icon={AlertTriangle}
                        color="rose"
                    />
                    <KPI
                        title="Total facturado (IVA incl.)"
                        value={fmtMoney(totals.net)}
                        sub={`Bruto: ${fmtMoney(totals.gross)}`}
                        Icon={FileBarChart}
                        color="amber"
                    />
                </div>

                {/* Top deudores + facturas más viejas */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Top deudores */}
                    <section className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl overflow-hidden backdrop-blur-sm">
                        <div className="p-5 border-b border-neutral-700/50 flex items-center justify-between bg-neutral-800/20">
                            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                                <TrendingUp className="w-5 h-5 text-rose-400" /> Top deudores
                            </h2>
                            <span className="text-xs text-neutral-500">por saldo pendiente</span>
                        </div>
                        <div className="p-4 border-b border-neutral-700/50">
                            <div className="relative">
                                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
                                <input
                                    type="text"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder="Buscar cliente por nombre o RFC..."
                                    className="w-full bg-neutral-900/60 border border-neutral-700/50 rounded-xl pl-10 pr-9 py-2 text-sm text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-cyan-500/50"
                                />
                                {search && (
                                    <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white p-1 rounded-md hover:bg-neutral-700/50">
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="overflow-x-auto">
                            {loading ? (
                                <div className="p-10 text-center text-neutral-500"><RefreshCw className="w-6 h-6 animate-spin mx-auto text-cyan-400" /></div>
                            ) : filteredDebts.length === 0 ? (
                                <div className="p-10 text-center text-neutral-500">
                                    <Wallet className="w-12 h-12 mx-auto mb-3 text-neutral-700" />
                                    <p>No hay clientes con deuda.</p>
                                </div>
                            ) : (
                                <table className="w-full text-sm">
                                    <thead className="bg-neutral-900/50 text-[10px] uppercase tracking-wider text-neutral-400">
                                        <tr>
                                            <th className="text-left p-3">Cliente</th>
                                            <th className="text-center p-3"># Partidas</th>
                                            <th className="text-right p-3">Saldo</th>
                                            <th className="text-right p-3">Más vieja</th>
                                            <th className="p-3"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredDebts.slice(0, 10).map((d) => (
                                            <tr key={d.client_id} className="border-t border-neutral-800/60 hover:bg-neutral-800/40">
                                                <td className="p-3">
                                                    <p className="text-white font-medium text-sm">{d.business_name}</p>
                                                    <p className="text-[10px] text-neutral-500 font-mono">{d.rfc || "—"}</p>
                                                </td>
                                                <td className="p-3 text-center text-neutral-300 text-xs">{d.open_invoices}</td>
                                                <td className="p-3 text-right text-rose-300 font-mono font-semibold">{fmtMoney(d.total_balance)}</td>
                                                <td className="p-3 text-right text-neutral-400 text-[11px]">{fmtDate(d.oldest_invoice_date)}</td>
                                                <td className="p-3 text-right">
                                                    <Link href={`/finance/receivable/${d.client_id}`} className="inline-flex items-center gap-1 text-xs text-cyan-300 hover:text-white bg-cyan-500/10 hover:bg-cyan-500/20 px-2.5 py-1.5 rounded-lg border border-cyan-500/20">
                                                        Ver <ChevronRight className="w-3 h-3" />
                                                    </Link>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                        {filteredDebts.length > 10 && (
                            <div className="p-3 text-center text-xs text-neutral-500 border-t border-neutral-700/50">
                                Mostrando 10 de {filteredDebts.length} clientes
                            </div>
                        )}
                    </section>

                    {/* Facturas más viejas */}
                    <section className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl overflow-hidden backdrop-blur-sm">
                        <div className="p-5 border-b border-neutral-700/50 flex items-center justify-between bg-neutral-800/20">
                            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                                <AlertTriangle className="w-5 h-5 text-rose-400" /> Facturas más vencidas
                            </h2>
                            <span className="text-xs text-neutral-500">días de atraso</span>
                        </div>
                        <div className="overflow-x-auto">
                            {loading ? (
                                <div className="p-10 text-center text-neutral-500"><RefreshCw className="w-6 h-6 animate-spin mx-auto text-rose-400" /></div>
                            ) : oldest.length === 0 ? (
                                <div className="p-10 text-center text-neutral-500">
                                    <Calendar className="w-12 h-12 mx-auto mb-3 text-neutral-700" />
                                    <p>Sin facturas vencidas. ¡Bien!</p>
                                </div>
                            ) : (
                                <table className="w-full text-sm">
                                    <thead className="bg-neutral-900/50 text-[10px] uppercase tracking-wider text-neutral-400">
                                        <tr>
                                            <th className="text-left p-3">Cliente</th>
                                            <th className="text-left p-3">Factura</th>
                                            <th className="text-right p-3">Días</th>
                                            <th className="text-right p-3">Saldo</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {oldest.slice(0, 10).map((o) => (
                                            <tr key={o.id} className="border-t border-neutral-800/60 hover:bg-neutral-800/40">
                                                <td className="p-3">
                                                    <Link href={`/finance/receivable/${o.client?.id}`} className="text-cyan-300 hover:text-white text-sm font-medium inline-flex items-center gap-1">
                                                        {o.client?.business_name} <ExternalLink className="w-3 h-3" />
                                                    </Link>
                                                </td>
                                                <td className="p-3 text-neutral-300 text-xs">
                                                    <p className="line-clamp-1">{o.concept}</p>
                                                    <p className="text-[10px] text-neutral-500">{o.invoice_number || "—"} · {fmtDate(o.invoice_date)}</p>
                                                </td>
                                                <td className="p-3 text-right">
                                                    <span className={cn(
                                                        "text-xs font-bold px-2 py-0.5 rounded-full border",
                                                        o.days_overdue > 90 ? "bg-rose-500/15 text-rose-300 border-rose-500/30" :
                                                        o.days_overdue > 30 ? "bg-amber-500/15 text-amber-300 border-amber-500/30" :
                                                        "bg-orange-500/15 text-orange-300 border-orange-500/30"
                                                    )}>{o.days_overdue}d</span>
                                                </td>
                                                <td className="p-3 text-right text-rose-300 font-mono font-semibold">{fmtMoney(o.balance)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </section>
                </div>

                {/* Quick links a clientes sin deuda */}
                {clients.length > 0 && debts.length < clients.length && (
                    <section className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl p-5">
                        <h3 className="text-sm font-bold text-white mb-3 uppercase tracking-[0.15em] flex items-center gap-1.5">
                            <span className="w-1 h-3 rounded-full bg-cyan-400/70" />
                            Clientes sin deuda ({clients.length - debts.length})
                        </h3>
                        <p className="text-xs text-neutral-500 mb-3">Aquí puedes asignarles facturas nuevas o registrar pagos anticipados.</p>
                        <div className="flex flex-wrap gap-2">
                            {clients
                                .filter(c => !debts.find(d => d.client_id === c.id))
                                .slice(0, 20)
                                .map(c => (
                                    <Link key={c.id} href={`/finance/receivable/${c.id}`} className="text-xs bg-neutral-900/60 hover:bg-neutral-800 border border-neutral-700/50 hover:border-cyan-500/30 px-3 py-1.5 rounded-lg text-neutral-300 hover:text-white transition-colors">
                                        {c.business_name}
                                    </Link>
                                ))}
                        </div>
                    </section>
                )}
            </div>
        </div>
    );
}

function KPI({ title, value, sub, Icon, color }: any) {
    const palette: Record<string, string> = {
        cyan:    "border-cyan-500/30 bg-cyan-500/5 text-cyan-300",
        emerald: "border-emerald-500/30 bg-emerald-500/5 text-emerald-300",
        rose:    "border-rose-500/30 bg-rose-500/5 text-rose-300",
        amber:   "border-amber-500/30 bg-amber-500/5 text-amber-300",
    };
    return (
        <div className={cn("rounded-2xl border p-4 flex items-center gap-3", palette[color])}>
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
