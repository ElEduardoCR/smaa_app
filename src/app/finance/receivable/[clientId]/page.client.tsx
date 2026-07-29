"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
    ArrowLeft, RefreshCw, Wallet, Plus, Archive, ArchiveRestore, Receipt,
    CheckCircle, Clock, XCircle, CreditCard, Link2, Copy, Trash2, FileText,
    Download, ChevronDown, ChevronUp, X, FileBarChart, AlertCircle, Send, ExternalLink
} from "lucide-react";
import {
    createARInvoiceAction, updateARInvoiceAction, obsoleteARInvoiceAction, restoreARInvoiceAction,
    registerARPaymentAction, createShareLinkAction, revokeShareLinkAction,
    markPromiseStatusAction,
} from "@/app/actions/ar";
import { generateARStatementPDF } from "@/lib/generateArStatementPdf";
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

const STATUS_LABELS: Record<string, { label: string; chip: string; Icon: any }> = {
    pending:   { label: "Pendiente", chip: "bg-amber-500/15 text-amber-300 border-amber-500/30",  Icon: Clock },
    partial:   { label: "Parcial",   chip: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",      Icon: Receipt },
    paid:      { label: "Pagada",    chip: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", Icon: CheckCircle },
    cancelled: { label: "Cancelada", chip: "bg-neutral-500/15 text-neutral-400 border-neutral-500/30", Icon: XCircle },
};

type Invoice = {
    id: string;
    invoice_number: string | null;
    concept: string;
    work_date: string | null;
    invoice_date: string;
    due_date: string | null;
    gross_amount: number;
    vat_amount: number;
    net_amount: number;
    paid_amount: number;
    balance: number;
    status: 'pending' | 'partial' | 'paid' | 'cancelled';
    notes: string | null;
    source_type: 'manual' | 'issued_cfdi' | 'sale';
    source_id: string | null;
    is_active: boolean;
    created_at: string;
};

type Payment = {
    id: string;
    payment_date: string;
    amount: number;
    payment_method: string;
    reference: string | null;
    notes: string | null;
    registered_by: string | null;
    created_at: string;
    allocations: Array<{ invoice_id: string; amount_applied: number; invoice?: Invoice }>;
};

type ShareLink = {
    id: string;
    token_plain: string | null;  // se llena solo en memoria tras crear
    label: string | null;
    expires_at: string;
    status: 'active' | 'revoked' | 'expired';
    access_count: number;
    last_accessed_at: string | null;
    created_at: string;
};

type PromiseRow = {
    id: string;
    promise_date: string;
    expected_payment_date: string | null;
    total_committed: number;
    client_notes: string | null;
    status: 'pending' | 'fulfilled' | 'expired' | 'cancelled';
    created_at: string;
    items: Array<{ id: string; invoice_id: string; amount_committed: number; invoice?: Invoice }>;
};

export default function ClientDetailPage({ clientId }: { clientId: string }) {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [client, setClient] = useState<any>(null);
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [payments, setPayments] = useState<Payment[]>([]);
    const [shareLinks, setShareLinks] = useState<ShareLink[]>([]);
    const [promises, setPromises] = useState<PromiseRow[]>([]);
    const [showObsolete, setShowObsolete] = useState(false);
    const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [busy, setBusy] = useState(false);

    // Modales
    const [newInvoiceOpen, setNewInvoiceOpen] = useState(false);
    const [payOpen, setPayOpen] = useState(false);
    const [linkOpen, setLinkOpen] = useState(false);
    const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);

    const load = async () => {
        setLoading(true);
        try {
            const cid = Number(clientId);
            const [cRes, iRes] = await Promise.all([
                supabase.from("clients").select("*").eq("id", cid).single(),
                supabase.from("ar_invoices").select("*").eq("client_id", cid).order("invoice_date", { ascending: false }),
            ]);
            if (cRes.error) throw cRes.error;
            setClient(cRes.data);
            const invs = (iRes.data || []) as Invoice[];
            setInvoices(invs);

            if (invs.length > 0) {
                const ids = invs.map((i) => i.id);
                const [payRes, linkRes, promRes] = await Promise.all([
                    supabase
                        .from("ar_payments")
                        .select("*, allocations:ar_payment_allocations(*)")
                        .eq("client_id", cid)
                        .order("payment_date", { ascending: false }),
                    supabase
                        .from("ar_share_links")
                        .select("*")
                        .eq("client_id", cid)
                        .order("created_at", { ascending: false }),
                    supabase
                        .from("ar_payment_promises")
                        .select("*, items:ar_payment_promise_items(*)")
                        .eq("client_id", cid)
                        .order("created_at", { ascending: false }),
                ]);

                // Enriquecer allocations/items con info de la factura
                const invById = new Map(invs.map((i) => [i.id, i]));
                const paymentsEnriched = (payRes.data || []).map((p: any) => ({
                    ...p,
                    allocations: (p.allocations || []).map((a: any) => ({ ...a, invoice: invById.get(a.invoice_id) })),
                }));
                const promisesEnriched = (promRes.data || []).map((p: any) => ({
                    ...p,
                    items: (p.items || []).map((it: any) => ({ ...it, invoice: invById.get(it.invoice_id) })),
                }));

                setPayments(paymentsEnriched);
                setShareLinks(linkRes.data || []);
                setPromises(promisesEnriched);
            } else {
                setPayments([]); setShareLinks([]); setPromises([]);
            }
        } catch (e: any) {
            setMsg({ type: 'error', text: 'Error: ' + e.message });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, [clientId]);

    // Derivados
    const activeInvoices = useMemo(() => invoices.filter((i) => showObsolete || i.is_active), [invoices, showObsolete]);
    const openInvoices = useMemo(() => activeInvoices.filter((i) => i.status !== 'paid' && i.status !== 'cancelled' && i.is_active), [activeInvoices]);
    const totals = useMemo(() => {
        return activeInvoices.reduce(
            (acc, i) => ({
                gross: acc.gross + Number(i.gross_amount),
                vat: acc.vat + Number(i.vat_amount),
                net: acc.net + Number(i.net_amount),
                paid: acc.paid + Number(i.paid_amount),
                balance: acc.balance + Number(i.balance),
            }),
            { gross: 0, vat: 0, net: 0, paid: 0, balance: 0 }
        );
    }, [activeInvoices]);

    const flash = (type: 'success' | 'error', text: string) => {
        setMsg({ type, text });
        setTimeout(() => setMsg(null), 4000);
    };

    const onObsolete = async (inv: Invoice) => {
        if (!confirm(`¿Obsoletar la partida "${inv.concept}"?`)) return;
        setBusy(true);
        try {
            await obsoleteARInvoiceAction(inv.id);
            flash('success', 'Partida obsoletada.');
            await load();
        } catch (e: any) { flash('error', e.message); }
        finally { setBusy(false); }
    };

    const onRestore = async (inv: Invoice) => {
        setBusy(true);
        try {
            await restoreARInvoiceAction(inv.id);
            flash('success', 'Partida restaurada.');
            await load();
        } catch (e: any) { flash('error', e.message); }
        finally { setBusy(false); }
    };

    const generatePDF = (onlyIds?: string[]) => {
        const list = onlyIds && onlyIds.length > 0
            ? activeInvoices.filter((i) => onlyIds.includes(i.id) && i.status !== 'paid' && i.status !== 'cancelled')
            : activeInvoices.filter((i) => i.status !== 'paid' && i.status !== 'cancelled' && i.is_active);
        if (list.length === 0) {
            flash('error', 'No hay partidas pendientes para incluir.');
            return;
        }
        generateARStatementPDF({
            title: onlyIds && onlyIds.length > 0 ? "Estado de Cuenta (seleccionadas)" : "Estado de Cuenta",
            issue_date: new Date().toISOString().slice(0, 10),
            client: {
                business_name: client?.business_name || '',
                rfc: client?.rfc,
                email: client?.email,
                phone: client?.phone,
                address: client?.address,
                fiscal_zip_code: client?.fiscal_zip_code,
            },
            company: { business_name: 'SMAA Manufactura' },
            invoices: list.map((i) => ({
                id: i.id,
                invoice_number: i.invoice_number,
                concept: i.concept,
                work_date: i.work_date,
                invoice_date: i.invoice_date,
                due_date: i.due_date,
                gross_amount: Number(i.gross_amount),
                vat_amount: Number(i.vat_amount),
                net_amount: Number(i.net_amount),
                paid_amount: Number(i.paid_amount),
                balance: Number(i.balance),
                status: i.status,
            })),
        });
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 flex items-center justify-center">
                <RefreshCw className="w-8 h-8 animate-spin text-cyan-400" />
            </div>
        );
    }

    if (!client) {
        return (
            <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-10 text-center">
                <p className="text-rose-400">Cliente no encontrado.</p>
                <Link href="/finance/receivable" className="text-cyan-300 hover:underline mt-4 inline-block">Volver al dashboard</Link>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-3 sm:p-6 md:p-8 lg:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-[1500px] mx-auto space-y-6">
                {/* Header */}
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                        <Link href="/finance/receivable" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors text-neutral-400 hover:text-white border border-neutral-700">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div>
                            <h1 className="text-2xl font-bold text-white">{client.business_name}</h1>
                            <p className="text-neutral-400 text-xs font-mono mt-1">
                                {client.rfc || "—"} · {client.email || "sin email"}
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Link href={`/clients`} className="text-xs text-cyan-300 hover:text-white bg-cyan-500/10 hover:bg-cyan-500/20 px-3 py-2 rounded-lg border border-cyan-500/20 inline-flex items-center gap-1.5">
                            Ver ficha del cliente <ExternalLink className="w-3 h-3" />
                        </Link>
                        <button onClick={() => generatePDF()} disabled={openInvoices.length === 0} className="text-xs text-amber-300 hover:text-white bg-amber-500/10 hover:bg-amber-500/20 px-3 py-2 rounded-lg border border-amber-500/20 inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
                            <FileText className="w-3.5 h-3.5" /> Estado de cuenta PDF
                        </button>
                        <button onClick={() => setLinkOpen(true)} disabled={openInvoices.length === 0} className="text-xs text-violet-300 hover:text-white bg-violet-500/10 hover:bg-violet-500/20 px-3 py-2 rounded-lg border border-violet-500/20 inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
                            <Link2 className="w-3.5 h-3.5" /> Generar link cliente
                        </button>
                        <button onClick={() => setPayOpen(true)} disabled={openInvoices.length === 0} className="text-xs text-emerald-300 hover:text-white bg-emerald-500/10 hover:bg-emerald-500/20 px-3 py-2 rounded-lg border border-emerald-500/20 inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
                            <CreditCard className="w-3.5 h-3.5" /> Registrar pago
                        </button>
                        <button onClick={() => setNewInvoiceOpen(true)} className="text-xs bg-gradient-to-r from-cyan-500 to-cyan-600 hover:from-cyan-600 hover:to-cyan-700 text-white px-3 py-2 rounded-lg font-semibold inline-flex items-center gap-1.5">
                            <Plus className="w-3.5 h-3.5" /> Nueva partida
                        </button>
                    </div>
                </header>

                {msg && (
                    <div className={cn(
                        "rounded-xl p-3 text-sm border",
                        msg.type === 'success'
                            ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
                            : "bg-rose-500/10 border-rose-500/30 text-rose-200"
                    )}>
                        {msg.text}
                    </div>
                )}

                {/* Resumen de totales */}
                <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <SummaryBox label="Subtotal (Bruto)" value={fmtMoney(totals.gross)} color="slate" />
                    <SummaryBox label="IVA 16%" value={fmtMoney(totals.vat)} color="amber" />
                    <SummaryBox label="Total" value={fmtMoney(totals.net)} color="emerald" />
                    <SummaryBox label="Pagado" value={fmtMoney(totals.paid)} color="cyan" />
                    <SummaryBox label="Saldo pendiente" value={fmtMoney(totals.balance)} color="rose" big />
                </section>

                {/* Toggle obsoletos */}
                <div className="flex justify-end">
                    <label className="flex items-center gap-1.5 text-xs text-neutral-300 cursor-pointer select-none">
                        <input type="checkbox" checked={showObsolete} onChange={(e) => setShowObsolete(e.target.checked)} className="w-4 h-4 accent-cyan-500" />
                        <Archive className="w-3.5 h-3.5" /> Mostrar obsoletos
                    </label>
                </div>

                {/* Tabla de partidas */}
                <section className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl overflow-hidden backdrop-blur-sm">
                    <div className="p-5 border-b border-neutral-700/50 bg-neutral-800/20">
                        <h2 className="text-lg font-semibold text-white">Partidas</h2>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-neutral-900/50 text-[10px] uppercase tracking-wider text-neutral-400">
                                <tr>
                                    <th className="text-left p-3"># Factura / Concepto</th>
                                    <th className="text-left p-3">F. Factura</th>
                                    <th className="text-left p-3">Vence</th>
                                    <th className="text-right p-3">Bruto</th>
                                    <th className="text-right p-3">IVA</th>
                                    <th className="text-right p-3">Total</th>
                                    <th className="text-right p-3">Pagado</th>
                                    <th className="text-right p-3">Saldo</th>
                                    <th className="text-center p-3">Estado</th>
                                    <th className="p-3"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {activeInvoices.length === 0 ? (
                                    <tr><td colSpan={10} className="p-10 text-center text-neutral-500">
                                        <FileBarChart className="w-12 h-12 mx-auto mb-3 text-neutral-700" />
                                        <p>Sin partidas. Agrega la primera.</p>
                                    </td></tr>
                                ) : activeInvoices.map((inv) => {
                                    const st = STATUS_LABELS[inv.status];
                                    return (
                                        <tr key={inv.id} className={cn(
                                            "border-t border-neutral-800/60 hover:bg-neutral-800/40",
                                            !inv.is_active && "opacity-50"
                                        )}>
                                            <td className="p-3">
                                                <p className="text-white font-medium text-sm">{inv.invoice_number || "—"}</p>
                                                <p className="text-[11px] text-neutral-400 line-clamp-1">{inv.concept}</p>
                                                {inv.source_type === 'issued_cfdi' && (
                                                    <span className="text-[9px] uppercase tracking-wider text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded border border-cyan-500/20 mt-0.5 inline-block">CFDI</span>
                                                )}
                                            </td>
                                            <td className="p-3 text-neutral-300 text-xs">{fmtDate(inv.invoice_date)}</td>
                                            <td className="p-3 text-neutral-300 text-xs">{fmtDate(inv.due_date)}</td>
                                            <td className="p-3 text-right text-neutral-200 font-mono text-xs">{fmtMoney(inv.gross_amount)}</td>
                                            <td className="p-3 text-right text-neutral-200 font-mono text-xs">{fmtMoney(inv.vat_amount)}</td>
                                            <td className="p-3 text-right text-white font-mono font-semibold text-sm">{fmtMoney(inv.net_amount)}</td>
                                            <td className="p-3 text-right text-emerald-300 font-mono text-xs">{fmtMoney(inv.paid_amount)}</td>
                                            <td className="p-3 text-right text-rose-300 font-mono font-semibold text-sm">{fmtMoney(inv.balance)}</td>
                                            <td className="p-3 text-center">
                                                <span className={cn("inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border", st.chip)}>
                                                    <st.Icon className="w-3 h-3" /> {st.label}
                                                </span>
                                            </td>
                                            <td className="p-3 text-right">
                                                <div className="inline-flex items-center gap-1">
                                                    {inv.is_active ? (
                                                        <button onClick={() => onObsolete(inv)} disabled={busy || inv.status === 'partial' || inv.status === 'paid'} className="p-1.5 rounded-lg text-amber-400 hover:bg-amber-500/10 disabled:opacity-30 disabled:cursor-not-allowed" title="Obsoletar">
                                                            <Archive className="w-3.5 h-3.5" />
                                                        </button>
                                                    ) : (
                                                        <button onClick={() => onRestore(inv)} disabled={busy} className="p-1.5 rounded-lg text-emerald-400 hover:bg-emerald-500/10" title="Restaurar">
                                                            <ArchiveRestore className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                            {activeInvoices.length > 0 && (
                                <tfoot className="bg-neutral-900/50 border-t-2 border-neutral-700/50 text-xs font-semibold">
                                    <tr>
                                        <td colSpan={3} className="p-3 text-right text-neutral-400 uppercase tracking-wider">Totales:</td>
                                        <td className="p-3 text-right text-neutral-200 font-mono">{fmtMoney(totals.gross)}</td>
                                        <td className="p-3 text-right text-neutral-200 font-mono">{fmtMoney(totals.vat)}</td>
                                        <td className="p-3 text-right text-white font-mono">{fmtMoney(totals.net)}</td>
                                        <td className="p-3 text-right text-emerald-300 font-mono">{fmtMoney(totals.paid)}</td>
                                        <td className="p-3 text-right text-rose-300 font-mono">{fmtMoney(totals.balance)}</td>
                                        <td colSpan={2}></td>
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    </div>
                </section>

                {/* Pagos registrados */}
                {payments.length > 0 && (
                    <section className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl overflow-hidden">
                        <div className="p-5 border-b border-neutral-700/50 bg-neutral-800/20">
                            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                                <CreditCard className="w-5 h-5 text-emerald-400" /> Pagos registrados
                            </h2>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-neutral-900/50 text-[10px] uppercase tracking-wider text-neutral-400">
                                    <tr>
                                        <th className="text-left p-3">Fecha</th>
                                        <th className="text-left p-3">Método</th>
                                        <th className="text-left p-3">Referencia</th>
                                        <th className="text-right p-3">Monto</th>
                                        <th className="text-left p-3">Aplicado a</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {payments.map((p) => (
                                        <tr key={p.id} className="border-t border-neutral-800/60">
                                            <td className="p-3 text-neutral-300 text-xs">{fmtDate(p.payment_date)}</td>
                                            <td className="p-3">
                                                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-neutral-700/40 text-neutral-300 border border-neutral-700">
                                                    {p.payment_method}
                                                </span>
                                            </td>
                                            <td className="p-3 text-neutral-400 text-xs font-mono">{p.reference || "—"}</td>
                                            <td className="p-3 text-right text-emerald-300 font-mono font-semibold">{fmtMoney(p.amount)}</td>
                                            <td className="p-3 text-xs text-neutral-400">
                                                {p.allocations.map((a) => a.invoice?.invoice_number || a.invoice_id.slice(0, 8)).join(", ") || "—"}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </section>
                )}

                {/* Links públicos generados */}
                {shareLinks.length > 0 && (
                    <section className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl overflow-hidden">
                        <div className="p-5 border-b border-neutral-700/50 bg-neutral-800/20 flex items-center justify-between">
                            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                                <Link2 className="w-5 h-5 text-violet-400" /> Links públicos generados
                            </h2>
                            <button onClick={() => setLinkOpen(true)} className="text-xs text-violet-300 hover:text-white bg-violet-500/10 hover:bg-violet-500/20 px-3 py-1.5 rounded-lg border border-violet-500/20 inline-flex items-center gap-1.5">
                                <Plus className="w-3.5 h-3.5" /> Nuevo
                            </button>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-neutral-900/50 text-[10px] uppercase tracking-wider text-neutral-400">
                                    <tr>
                                        <th className="text-left p-3">Etiqueta</th>
                                        <th className="text-left p-3">Creado</th>
                                        <th className="text-left p-3">Expira</th>
                                        <th className="text-center p-3">Accesos</th>
                                        <th className="text-center p-3">Estado</th>
                                        <th className="p-3"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {shareLinks.map((l) => {
                                        const expired = new Date(l.expires_at) < new Date();
                                        return (
                                            <tr key={l.id} className="border-t border-neutral-800/60">
                                                <td className="p-3 text-neutral-200 text-xs">{l.label || "—"}</td>
                                                <td className="p-3 text-neutral-400 text-xs">{fmtDate(l.created_at)}</td>
                                                <td className="p-3 text-neutral-400 text-xs">{fmtDate(l.expires_at)}{expired ? " (vencido)" : ""}</td>
                                                <td className="p-3 text-center text-neutral-300 text-xs">{l.access_count}</td>
                                                <td className="p-3 text-center">
                                                    <span className={cn("text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border",
                                                        l.status === 'active' ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" :
                                                        l.status === 'revoked' ? "bg-rose-500/15 text-rose-300 border-rose-500/30" :
                                                        "bg-neutral-500/15 text-neutral-400 border-neutral-500/30"
                                                    )}>{l.status}</span>
                                                </td>
                                                <td className="p-3 text-right">
                                                    {l.status === 'active' && (
                                                        <button onClick={async () => {
                                                            if (!confirm('¿Revocar este link?')) return;
                                                            setBusy(true);
                                                            try { await revokeShareLinkAction(l.id); flash('success', 'Link revocado.'); await load(); }
                                                            catch (e: any) { flash('error', e.message); }
                                                            finally { setBusy(false); }
                                                        }} disabled={busy} className="text-xs text-rose-300 hover:text-white bg-rose-500/10 hover:bg-rose-500/20 px-2.5 py-1 rounded-lg border border-rose-500/20">
                                                            Revocar
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </section>
                )}

                {/* Promesas del cliente */}
                {promises.length > 0 && (
                    <section className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl overflow-hidden">
                        <div className="p-5 border-b border-neutral-700/50 bg-neutral-800/20">
                            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                                <Send className="w-5 h-5 text-amber-400" /> Promesas de pago del cliente
                            </h2>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-neutral-900/50 text-[10px] uppercase tracking-wider text-neutral-400">
                                    <tr>
                                        <th className="text-left p-3">Fecha</th>
                                        <th className="text-left p-3">Esperado</th>
                                        <th className="text-right p-3">Comprometido</th>
                                        <th className="text-left p-3">Facturas</th>
                                        <th className="text-center p-3">Estado</th>
                                        <th className="p-3"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {promises.map((p) => (
                                        <tr key={p.id} className="border-t border-neutral-800/60">
                                            <td className="p-3 text-neutral-300 text-xs">{fmtDate(p.promise_date)}</td>
                                            <td className="p-3 text-neutral-300 text-xs">{fmtDate(p.expected_payment_date)}</td>
                                            <td className="p-3 text-right text-amber-300 font-mono font-semibold">{fmtMoney(p.total_committed)}</td>
                                            <td className="p-3 text-xs text-neutral-400 max-w-[300px] truncate">{p.client_notes || `${p.items.length} factura(s)`}</td>
                                            <td className="p-3 text-center">
                                                <span className={cn("text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border",
                                                    p.status === 'pending' ? "bg-amber-500/15 text-amber-300 border-amber-500/30" :
                                                    p.status === 'fulfilled' ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" :
                                                    "bg-neutral-500/15 text-neutral-400 border-neutral-500/30"
                                                )}>{p.status}</span>
                                            </td>
                                            <td className="p-3 text-right">
                                                {p.status === 'pending' && (
                                                    <button onClick={async () => {
                                                        if (!confirm('¿Marcar promesa como cumplida?')) return;
                                                        setBusy(true);
                                                        try { await markPromiseStatusAction(p.id, 'fulfilled'); flash('success', 'Promesa marcada como cumplida.'); await load(); }
                                                        catch (e: any) { flash('error', e.message); }
                                                        finally { setBusy(false); }
                                                    }} disabled={busy} className="text-xs text-emerald-300 hover:text-white bg-emerald-500/10 hover:bg-emerald-500/20 px-2.5 py-1 rounded-lg border border-emerald-500/20">
                                                        Cumplida
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </section>
                )}

                {/* Modales */}
                {newInvoiceOpen && (
                    <NewInvoiceModal
                        clientId={Number(clientId)}
                        onClose={() => setNewInvoiceOpen(false)}
                        onSaved={async () => { setNewInvoiceOpen(false); flash('success', 'Partida creada.'); await load(); }}
                        setErr={(t) => flash('error', t)}
                    />
                )}
                {payOpen && (
                    <PaymentModal
                        clientId={Number(clientId)}
                        openInvoices={openInvoices}
                        onClose={() => setPayOpen(false)}
                        onSaved={async () => { setPayOpen(false); flash('success', 'Pago registrado.'); await load(); }}
                        setErr={(t) => flash('error', t)}
                    />
                )}
                {linkOpen && (
                    <ShareLinkModal
                        clientId={Number(clientId)}
                        clientName={client.business_name}
                        onClose={() => setLinkOpen(false)}
                        onSaved={async (token) => {
                            setLinkOpen(false);
                            const fullUrl = `${window.location.origin}/ar/${token}`;
                            try { await navigator.clipboard.writeText(fullUrl); flash('success', `Link copiado al portapapeles: ${fullUrl}`); }
                            catch { flash('success', `Link: ${fullUrl}`); }
                            await load();
                        }}
                        setErr={(t) => flash('error', t)}
                    />
                )}
            </div>
        </div>
    );
}

function SummaryBox({ label, value, color, big }: { label: string; value: string; color: string; big?: boolean }) {
    const palette: Record<string, string> = {
        slate:   "border-neutral-700/40 bg-neutral-800/30",
        amber:   "border-amber-500/20 bg-amber-500/5",
        emerald: "border-emerald-500/30 bg-emerald-500/5",
        cyan:    "border-cyan-500/30 bg-cyan-500/5",
        rose:    "border-rose-500/30 bg-rose-500/5",
    };
    return (
        <div className={cn("rounded-2xl border p-4", palette[color])}>
            <p className="text-[10px] uppercase tracking-wider text-neutral-400">{label}</p>
            <p className={cn("font-bold font-mono text-white", big ? "text-2xl text-rose-300" : "text-lg")}>{value}</p>
        </div>
    );
}

// =================== MODALES ===================

function NewInvoiceModal({ clientId, onClose, onSaved, setErr }: { clientId: number; onClose: () => void; onSaved: () => void | Promise<void>; setErr: (t: string) => void }) {
    const [concept, setConcept] = useState("");
    const [gross, setGross] = useState("");
    const [invoiceNumber, setInvoiceNumber] = useState("");
    const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
    const [dueDate, setDueDate] = useState("");
    const [notes, setNotes] = useState("");
    const [busy, setBusy] = useState(false);
    const [availableCfdis, setAvailableCfdis] = useState<any[]>([]);
    const [selectedCfdi, setSelectedCfdi] = useState<string>("");

    useEffect(() => {
        // Cargar CFDIs del cliente que aún no están en AR
        (async () => {
            const { data: client } = await supabase.from("clients").select("rfc").eq("id", clientId).single();
            if (!client?.rfc) return;
            const { data: linked } = await supabase
                .from("ar_invoices")
                .select("source_id")
                .eq("source_type", "issued_cfdi");
            const linkedIds = new Set((linked || []).map((l: any) => l.source_id).filter(Boolean));
            const { data: cfdis } = await supabase
                .from("issued_invoices")
                .select("id, uuid, folio, serie, receptor_nombre, total, subtotal, vat_total, invoice_date")
                .eq("receptor_rfc", client.rfc)
                .order("invoice_date", { ascending: false })
                .limit(50);
            setAvailableCfdis((cfdis || []).filter((c: any) => !linkedIds.has(c.id)));
        })();
    }, [clientId]);

    const handleCfdiChange = (id: string) => {
        setSelectedCfdi(id);
        if (id) {
            const c = availableCfdis.find((x) => x.id === id);
            if (c) {
                // El CFDI tiene total, subtotal, vat_total — el "gross" para nosotros es el subtotal
                setGross(String(c.subtotal || ""));
                setInvoiceNumber([c.serie, c.folio].filter(Boolean).join("-"));
                if (c.invoice_date) setInvoiceDate(c.invoice_date.slice(0, 10));
            }
        }
    };

    const submit = async () => {
        if (!concept.trim()) { setErr("Falta el concepto."); return; }
        const g = Number(gross);
        if (!isFinite(g) || g < 0) { setErr("Monto inválido."); return; }
        setBusy(true);
        try {
            await createARInvoiceAction({
                client_id: clientId,
                concept: concept.trim(),
                gross_amount: g,
                invoice_number: invoiceNumber.trim() || null,
                invoice_date: invoiceDate,
                due_date: dueDate || null,
                notes: notes.trim() || null,
                source_type: selectedCfdi ? 'issued_cfdi' : 'manual',
                source_id: selectedCfdi || null,
            });
            onSaved();
        } catch (e: any) { setErr(e.message); }
        finally { setBusy(false); }
    };

    return (
        <ModalShell title="Nueva partida" onClose={onClose}>
            <div className="space-y-4">
                {availableCfdis.length > 0 && (
                    <div>
                        <label className="text-xs font-medium text-neutral-300">Vincular CFDI emitido (opcional)</label>
                        <select value={selectedCfdi} onChange={(e) => handleCfdiChange(e.target.value)} className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white mt-1 focus:outline-none focus:border-cyan-500">
                            <option value="">— Crear manual (sin CFDI) —</option>
                            {availableCfdis.map((c: any) => (
                                <option key={c.id} value={c.id}>
                                    {[c.serie, c.folio].filter(Boolean).join("-") || c.uuid?.slice(0, 8) || "—"} · {c.receptor_nombre} · ${Number(c.total || 0).toFixed(2)} · {c.invoice_date?.slice(0, 10)}
                                </option>
                            ))}
                        </select>
                    </div>
                )}
                <div>
                    <label className="text-xs font-medium text-neutral-300">Concepto *</label>
                    <input value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="Ej. Maquinado de pieza especial..." className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white mt-1 focus:outline-none focus:border-cyan-500" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-xs font-medium text-neutral-300"># Factura</label>
                        <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="Folio o número" className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white mt-1 focus:outline-none focus:border-cyan-500" />
                    </div>
                    <div>
                        <label className="text-xs font-medium text-neutral-300">Fecha factura</label>
                        <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white mt-1 focus:outline-none focus:border-cyan-500 [color-scheme:dark]" />
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-xs font-medium text-neutral-300">Subtotal (Bruto) *</label>
                        <input type="number" inputMode="decimal" step="0.01" value={gross} onChange={(e) => setGross(e.target.value)} placeholder="0.00" className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white mt-1 focus:outline-none focus:border-cyan-500" />
                        <p className="text-[10px] text-neutral-500 mt-1">IVA 16% se calcula automáticamente</p>
                    </div>
                    <div>
                        <label className="text-xs font-medium text-neutral-300">Fecha vencimiento</label>
                        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white mt-1 focus:outline-none focus:border-cyan-500 [color-scheme:dark]" />
                    </div>
                </div>
                <div>
                    <label className="text-xs font-medium text-neutral-300">Notas (opcional)</label>
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white mt-1 focus:outline-none focus:border-cyan-500" />
                </div>
                {gross && Number(gross) > 0 && (
                    <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-xl p-3 text-xs space-y-1">
                        <div className="flex justify-between text-neutral-300"><span>Bruto:</span><span className="font-mono">{fmtMoney(Number(gross))}</span></div>
                        <div className="flex justify-between text-neutral-300"><span>IVA 16%:</span><span className="font-mono">{fmtMoney(Number(gross) * 0.16)}</span></div>
                        <div className="flex justify-between text-white font-semibold border-t border-cyan-500/20 pt-1"><span>Total:</span><span className="font-mono">{fmtMoney(Number(gross) * 1.16)}</span></div>
                    </div>
                )}
            </div>
            <div className="mt-6 flex justify-end gap-3">
                <button onClick={onClose} className="px-4 py-2 text-sm text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded-xl">Cancelar</button>
                <button onClick={submit} disabled={busy} className="px-5 py-2 text-sm font-semibold text-white bg-gradient-to-r from-cyan-500 to-cyan-600 hover:from-cyan-600 hover:to-cyan-700 rounded-xl disabled:opacity-50">
                    {busy ? "Guardando..." : "Crear partida"}
                </button>
            </div>
        </ModalShell>
    );
}

function PaymentModal({ clientId, openInvoices, onClose, onSaved, setErr }: { clientId: number; openInvoices: Invoice[]; onClose: () => void; onSaved: () => void | Promise<void>; setErr: (t: string) => void }) {
    const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
    const [amount, setAmount] = useState("");
    const [method, setMethod] = useState<"transfer" | "cash" | "check" | "card" | "other">("transfer");
    const [reference, setReference] = useState("");
    const [notes, setNotes] = useState("");
    const [allocations, setAllocations] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);

    const totalAlloc = Object.values(allocations).reduce((s, v) => s + (Number(v) || 0), 0);
    const amountNum = Number(amount) || 0;

    const submit = async () => {
        if (amountNum <= 0) { setErr("Monto del pago debe ser mayor a 0."); return; }
        const allocs = Object.entries(allocations)
            .filter(([_, v]) => Number(v) > 0)
            .map(([id, v]) => ({ invoice_id: id, amount_applied: Number(v) }));
        if (allocs.length === 0) { setErr("Asigna el pago a al menos una factura."); return; }
        if (Math.abs(totalAlloc - amountNum) > 0.01) {
            setErr(`La suma asignada ($${totalAlloc.toFixed(2)}) no coincide con el monto ($${amountNum.toFixed(2)}).`);
            return;
        }
        setBusy(true);
        try {
            await registerARPaymentAction({
                client_id: clientId,
                payment_date: paymentDate,
                amount: amountNum,
                payment_method: method,
                reference: reference.trim() || null,
                notes: notes.trim() || null,
                allocations: allocs,
            });
            onSaved();
        } catch (e: any) { setErr(e.message); }
        finally { setBusy(false); }
    };

    return (
        <ModalShell title="Registrar pago" onClose={onClose}>
            <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-xs font-medium text-neutral-300">Fecha</label>
                        <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white mt-1 focus:outline-none focus:border-emerald-500 [color-scheme:dark]" />
                    </div>
                    <div>
                        <label className="text-xs font-medium text-neutral-300">Método</label>
                        <select value={method} onChange={(e) => setMethod(e.target.value as any)} className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white mt-1 focus:outline-none focus:border-emerald-500 [color-scheme:dark]">
                            <option value="transfer">Transferencia</option>
                            <option value="cash">Efectivo</option>
                            <option value="check">Cheque</option>
                            <option value="card">Tarjeta</option>
                            <option value="other">Otro</option>
                        </select>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-xs font-medium text-neutral-300">Monto *</label>
                        <input type="number" inputMode="decimal" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white mt-1 focus:outline-none focus:border-emerald-500" />
                    </div>
                    <div>
                        <label className="text-xs font-medium text-neutral-300">Referencia</label>
                        <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Núm. transferencia, cheque, etc." className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white mt-1 focus:outline-none focus:border-emerald-500" />
                    </div>
                </div>
                <div>
                    <label className="text-xs font-medium text-neutral-300">Notas (opcional)</label>
                    <input value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white mt-1 focus:outline-none focus:border-emerald-500" />
                </div>

                {openInvoices.length > 0 && (
                    <div>
                        <label className="text-xs font-medium text-neutral-300">Aplicar a facturas</label>
                        <div className="mt-1 max-h-64 overflow-y-auto bg-neutral-900/40 border border-neutral-700/50 rounded-xl">
                            {openInvoices.map((inv: Invoice) => (
                                <div key={inv.id} className="flex items-center gap-3 p-3 border-b border-neutral-800/60 last:border-0">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-white text-sm truncate">{inv.invoice_number || inv.concept}</p>
                                        <p className="text-[10px] text-neutral-500">Saldo: {fmtMoney(inv.balance)}</p>
                                    </div>
                                    <input
                                        type="number"
                                        inputMode="decimal"
                                        step="0.01"
                                        max={inv.balance}
                                        value={allocations[inv.id] || ""}
                                        onChange={(e) => setAllocations({ ...allocations, [inv.id]: e.target.value })}
                                        placeholder="0.00"
                                        className="w-28 bg-neutral-800/60 border border-neutral-700 rounded-lg px-2 py-1 text-sm text-white text-right focus:outline-none focus:border-emerald-500"
                                    />
                                </div>
                            ))}
                        </div>
                        <div className="mt-2 flex justify-between text-xs">
                            <span className="text-neutral-400">Asignado:</span>
                            <span className={cn("font-mono font-semibold", Math.abs(totalAlloc - amountNum) < 0.01 ? "text-emerald-300" : "text-amber-300")}>
                                {fmtMoney(totalAlloc)} / {fmtMoney(amountNum)}
                            </span>
                        </div>
                    </div>
                )}
            </div>
            <div className="mt-6 flex justify-end gap-3">
                <button onClick={onClose} className="px-4 py-2 text-sm text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded-xl">Cancelar</button>
                <button onClick={submit} disabled={busy} className="px-5 py-2 text-sm font-semibold text-white bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 rounded-xl disabled:opacity-50">
                    {busy ? "Registrando..." : "Registrar pago"}
                </button>
            </div>
        </ModalShell>
    );
}

function ShareLinkModal({ clientId, clientName, onClose, onSaved, setErr }: { clientId: number; clientName: string; onClose: () => void; onSaved: (token: string) => void | Promise<void>; setErr: (t: string) => void }) {
    const [days, setDays] = useState(30);
    const [label, setLabel] = useState("");
    const [busy, setBusy] = useState(false);

    const submit = async () => {
        setBusy(true);
        try {
            const res = await createShareLinkAction(clientId, days, label);
            onSaved(res.token);
        } catch (e: any) { setErr(e.message); }
        finally { setBusy(false); }
    };

    return (
        <ModalShell title="Generar link para el cliente" onClose={onClose}>
            <div className="space-y-4">
                <p className="text-sm text-neutral-300">
                    Se generará un link público que <strong>{clientName}</strong> podrá abrir sin login. Verá su estado de cuenta, podrá seleccionar qué facturas quiere pagar, descargar el PDF y enviar una promesa de pago.
                </p>
                <div>
                    <label className="text-xs font-medium text-neutral-300">Etiqueta (opcional)</label>
                    <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ej. Enviado a Juan Pérez el 29/07" className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white mt-1 focus:outline-none focus:border-violet-500" />
                </div>
                <div>
                    <label className="text-xs font-medium text-neutral-300">Días de vigencia</label>
                    <input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white mt-1 focus:outline-none focus:border-violet-500" />
                    <p className="text-[10px] text-neutral-500 mt-1">Por defecto 30 días. Puedes revocar el link cuando quieras.</p>
                </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
                <button onClick={onClose} className="px-4 py-2 text-sm text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded-xl">Cancelar</button>
                <button onClick={submit} disabled={busy} className="px-5 py-2 text-sm font-semibold text-white bg-gradient-to-r from-violet-500 to-violet-600 hover:from-violet-600 hover:to-violet-700 rounded-xl disabled:opacity-50">
                    {busy ? "Generando..." : "Generar y copiar link"}
                </button>
            </div>
        </ModalShell>
    );
}

function ModalShell({ title, onClose, children }: any) {
    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-neutral-900 border border-neutral-700/50 rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-bold text-white">{title}</h3>
                    <button onClick={onClose} className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-lg">
                        <X className="w-4 h-4" />
                    </button>
                </div>
                {children}
            </div>
        </div>
    );
}
