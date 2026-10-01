"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
    ArrowLeft, RefreshCw, Wallet, Plus, Archive, ArchiveRestore, Receipt,
    CheckCircle, Clock, XCircle, CreditCard, Link2, Copy, Trash2, FileText,
    Download, ChevronDown, ChevronUp, X, FileBarChart, AlertCircle, Send, ExternalLink,
    Pencil
} from "lucide-react";
import {
    createARInvoiceAction, updateARInvoiceAction, obsoleteARInvoiceAction, restoreARInvoiceAction,
    registerARPaymentAction, createShareLinkAction, revokeShareLinkAction,
    markPromiseStatusAction,
} from "@/app/actions/ar";
import { generateARStatementPDF } from "@/lib/generateArStatementPdf";
import { amountSearchTerms, dateSearchTerms, matchesSearch, parseLocalDate } from "@/lib/search";
import SearchBox from "@/components/SearchBox";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

const fmtMoney = (n: number | null | undefined) =>
    `$ ${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (iso: string | null) => {
    if (!iso) return "—";
    try { return parseLocalDate(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }); }
    catch { return iso; }
};

const round2 = (n: number) => Math.round(n * 100) / 100;

const STATUS_LABELS: Record<string, { label: string; chip: string; Icon: any }> = {
    pending:   { label: "Pendiente", chip: "bg-amber-500/15 text-amber-300 border-amber-500/30",  Icon: Clock },
    partial:   { label: "Parcial",   chip: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",      Icon: Receipt },
    paid:      { label: "Pagada",    chip: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", Icon: CheckCircle },
    cancelled: { label: "Cancelada", chip: "bg-neutral-500/15 text-neutral-400 border-neutral-500/30", Icon: XCircle },
};

const METHOD_LABELS: Record<string, string> = {
    transfer: "Transferencia",
    cash: "Efectivo",
    check: "Cheque",
    card: "Tarjeta",
    other: "Otro",
};

const PROMISE_STATUS_LABELS: Record<string, { label: string; chip: string }> = {
    pending:   { label: "Pendiente", chip: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
    fulfilled: { label: "Cumplida",  chip: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
    expired:   { label: "Vencida",   chip: "bg-neutral-500/15 text-neutral-400 border-neutral-500/30" },
    cancelled: { label: "Cancelada", chip: "bg-neutral-500/15 text-neutral-400 border-neutral-500/30" },
};

const LINK_STATUS_LABELS: Record<string, { label: string; chip: string }> = {
    active:  { label: "Activo",   chip: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
    revoked: { label: "Revocado", chip: "bg-rose-500/15 text-rose-300 border-rose-500/30" },
    expired: { label: "Expirado", chip: "bg-neutral-500/15 text-neutral-400 border-neutral-500/30" },
};

type Invoice = {
    id: string;
    client_id: number;
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
    promise_id?: string | null;  // promesa que este pago cumplió
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

// Campos por los que se busca en cada lista (lo visible + montos y fechas en varios formatos)
const invoiceSearchFields = (i: Invoice) => [
    i.invoice_number, i.concept, i.notes, STATUS_LABELS[i.status]?.label,
    i.source_type === 'issued_cfdi' ? 'CFDI' : null,
    dateSearchTerms(i.invoice_date), dateSearchTerms(i.due_date), dateSearchTerms(i.work_date),
    amountSearchTerms(i.gross_amount), amountSearchTerms(i.vat_amount), amountSearchTerms(i.net_amount),
    amountSearchTerms(i.paid_amount), amountSearchTerms(i.balance),
];

const paymentSearchFields = (p: Payment) => [
    p.payment_method, METHOD_LABELS[p.payment_method], p.reference, p.notes,
    p.promise_id ? 'promesa' : null,
    dateSearchTerms(p.payment_date), amountSearchTerms(p.amount),
    p.allocations.map((a) => [a.invoice?.invoice_number, a.invoice?.concept, amountSearchTerms(a.amount_applied)]),
];

const linkSearchFields = (l: ShareLink) => [
    l.label, l.status, LINK_STATUS_LABELS[l.status]?.label, String(l.access_count),
    dateSearchTerms(l.created_at), dateSearchTerms(l.expires_at), dateSearchTerms(l.last_accessed_at),
];

const promiseSearchFields = (p: PromiseRow) => [
    p.client_notes, p.status, PROMISE_STATUS_LABELS[p.status]?.label,
    dateSearchTerms(p.promise_date), dateSearchTerms(p.expected_payment_date), amountSearchTerms(p.total_committed),
    p.items.map((it) => [it.invoice?.invoice_number, it.invoice?.concept, amountSearchTerms(it.amount_committed)]),
];

/** Fila "sin resultados" para tablas filtradas por el buscador. */
function NoMatchesRow({ colSpan, query }: { colSpan: number; query: string }) {
    return (
        <tr><td colSpan={colSpan} className="p-8 text-center text-sm text-neutral-500">
            Sin resultados para “{query.trim()}”.
        </td></tr>
    );
}

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
    const [payingPromise, setPayingPromise] = useState<PromiseRow | null>(null);
    const [linkOpen, setLinkOpen] = useState(false);
    const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);

    // Buscadores de cada lista
    const [invoiceSearch, setInvoiceSearch] = useState("");
    const [paymentSearch, setPaymentSearch] = useState("");
    const [linkSearch, setLinkSearch] = useState("");
    const [promiseSearch, setPromiseSearch] = useState("");

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

    // Pago registrado al cumplir cada promesa
    const paymentByPromise = useMemo(() => {
        const map = new Map<string, Payment>();
        for (const p of payments) if (p.promise_id) map.set(p.promise_id, p);
        return map;
    }, [payments]);

    // IDs de facturas cubiertas por una promesa CUMPLIDA sin pago ligado
    // (promesas marcadas como "Cumplida" sin registrar el pago desde la promesa:
    // el status de la factura sigue siendo pending/partial).
    // Se usan para tachar visualmente las facturas en la tabla de partidas.
    const fulfilledInvoiceIds = useMemo(() => {
        const set = new Set<string>();
        for (const p of promises) {
            if (p.status === 'fulfilled' && !paymentByPromise.has(p.id)) {
                for (const it of p.items) set.add(it.invoice_id);
            }
        }
        return set;
    }, [promises, paymentByPromise]);

    const openInvoiceIds = useMemo(() => new Set(openInvoices.map((i) => i.id)), [openInvoices]);

    // Listas filtradas por su buscador
    const filteredInvoices = useMemo(
        () => activeInvoices.filter((i) => matchesSearch(invoiceSearch, invoiceSearchFields(i))),
        [activeInvoices, invoiceSearch]
    );
    const filteredTotals = useMemo(() => filteredInvoices.reduce(
        (acc, i) => ({
            gross: acc.gross + Number(i.gross_amount),
            vat: acc.vat + Number(i.vat_amount),
            net: acc.net + Number(i.net_amount),
            paid: acc.paid + Number(i.paid_amount),
            balance: acc.balance + Number(i.balance),
        }),
        { gross: 0, vat: 0, net: 0, paid: 0, balance: 0 }
    ), [filteredInvoices]);
    const filteredPayments = useMemo(
        () => payments.filter((p) => matchesSearch(paymentSearch, paymentSearchFields(p))),
        [payments, paymentSearch]
    );
    const filteredLinks = useMemo(
        () => shareLinks.filter((l) => matchesSearch(linkSearch, linkSearchFields(l))),
        [shareLinks, linkSearch]
    );
    const filteredPromises = useMemo(
        () => promises.filter((p) => matchesSearch(promiseSearch, promiseSearchFields(p))),
        [promises, promiseSearch]
    );

    // Estado para expandir/colapsar las filas de promesas y ver el detalle
    const [expandedPromises, setExpandedPromises] = useState<Set<string>>(new Set());
    const togglePromise = (id: string) => {
        setExpandedPromises((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

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
                    <div className="p-5 border-b border-neutral-700/50 bg-neutral-800/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <h2 className="text-lg font-semibold text-white">
                            Partidas
                            {invoiceSearch.trim() && (
                                <span className="ml-2 text-xs font-normal text-neutral-400">{filteredInvoices.length} de {activeInvoices.length}</span>
                            )}
                        </h2>
                        <SearchBox
                            value={invoiceSearch}
                            onChange={setInvoiceSearch}
                            placeholder="Buscar concepto, factura, monto, fecha"
                            className="w-full sm:w-96"
                        />
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
                                ) : filteredInvoices.length === 0 ? (
                                    <NoMatchesRow colSpan={10} query={invoiceSearch} />
                                ) : filteredInvoices.map((inv) => {
                                    const st = STATUS_LABELS[inv.status];
                                    const isFulfilled = fulfilledInvoiceIds.has(inv.id);
                                    return (
                                        <tr key={inv.id} className={cn(
                                            "border-t border-neutral-800/60 hover:bg-neutral-800/40",
                                            !inv.is_active && "opacity-50",
                                            isFulfilled && "opacity-60 bg-emerald-500/[0.03] hover:bg-emerald-500/[0.06]"
                                        )}>
                                            <td className="p-3">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <p className={cn(
                                                        "text-white font-medium text-sm",
                                                        isFulfilled && "line-through decoration-2 decoration-emerald-500/70"
                                                    )}>{inv.invoice_number || "—"}</p>
                                                    {isFulfilled && (
                                                        <span className="text-[9px] uppercase tracking-wider text-emerald-300 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/30 font-bold inline-flex items-center gap-1">
                                                            <CheckCircle className="w-2.5 h-2.5" /> Cubierta por promesa
                                                        </span>
                                                    )}
                                                </div>
                                                <p className={cn(
                                                    "text-[11px] text-neutral-400 line-clamp-1",
                                                    isFulfilled && "line-through decoration-1 decoration-emerald-500/50"
                                                )}>{inv.concept}</p>
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
                                                    <button
                                                        onClick={() => setEditingInvoice(inv)}
                                                        disabled={busy}
                                                        className="p-1.5 rounded-lg text-cyan-400 hover:bg-cyan-500/10 disabled:opacity-30 disabled:cursor-not-allowed"
                                                        title="Editar partida"
                                                    >
                                                        <Pencil className="w-3.5 h-3.5" />
                                                    </button>
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
                            {filteredInvoices.length > 0 && (
                                <tfoot className="bg-neutral-900/50 border-t-2 border-neutral-700/50 text-xs font-semibold">
                                    <tr>
                                        <td colSpan={3} className="p-3 text-right text-neutral-400 uppercase tracking-wider">
                                            {invoiceSearch.trim() ? "Totales (filtrados):" : "Totales:"}
                                        </td>
                                        <td className="p-3 text-right text-neutral-200 font-mono">{fmtMoney(filteredTotals.gross)}</td>
                                        <td className="p-3 text-right text-neutral-200 font-mono">{fmtMoney(filteredTotals.vat)}</td>
                                        <td className="p-3 text-right text-white font-mono">{fmtMoney(filteredTotals.net)}</td>
                                        <td className="p-3 text-right text-emerald-300 font-mono">{fmtMoney(filteredTotals.paid)}</td>
                                        <td className="p-3 text-right text-rose-300 font-mono">{fmtMoney(filteredTotals.balance)}</td>
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
                        <div className="p-5 border-b border-neutral-700/50 bg-neutral-800/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                                <CreditCard className="w-5 h-5 text-emerald-400" /> Pagos registrados
                                {paymentSearch.trim() && (
                                    <span className="text-xs font-normal text-neutral-400">{filteredPayments.length} de {payments.length}</span>
                                )}
                            </h2>
                            <SearchBox
                                value={paymentSearch}
                                onChange={setPaymentSearch}
                                placeholder="Buscar monto, fecha, método, referencia"
                                className="w-full sm:w-96"
                            />
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
                                    {filteredPayments.length === 0 ? (
                                        <NoMatchesRow colSpan={5} query={paymentSearch} />
                                    ) : filteredPayments.map((p) => (
                                        <tr key={p.id} className="border-t border-neutral-800/60">
                                            <td className="p-3 text-neutral-300 text-xs">{fmtDate(p.payment_date)}</td>
                                            <td className="p-3">
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-neutral-700/40 text-neutral-300 border border-neutral-700">
                                                        {METHOD_LABELS[p.payment_method] || p.payment_method}
                                                    </span>
                                                    {p.promise_id && (
                                                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30">
                                                            Promesa
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="p-3 text-xs">
                                                <p className="text-neutral-400 font-mono">{p.reference || "—"}</p>
                                                {p.notes && <p className="text-[10px] text-neutral-500 italic line-clamp-1" title={p.notes}>{p.notes}</p>}
                                            </td>
                                            <td className="p-3 text-right text-emerald-300 font-mono font-semibold">{fmtMoney(p.amount)}</td>
                                            <td className="p-3 text-xs text-neutral-400" title={p.allocations.map((a) => `${a.invoice?.invoice_number || a.invoice?.concept || a.invoice_id.slice(0, 8)}: ${fmtMoney(a.amount_applied)}`).join("\n")}>
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
                        <div className="p-5 border-b border-neutral-700/50 bg-neutral-800/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                                <Link2 className="w-5 h-5 text-violet-400" /> Links públicos generados
                                {linkSearch.trim() && (
                                    <span className="text-xs font-normal text-neutral-400">{filteredLinks.length} de {shareLinks.length}</span>
                                )}
                            </h2>
                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                <SearchBox
                                    value={linkSearch}
                                    onChange={setLinkSearch}
                                    placeholder="Buscar etiqueta, fecha, estado"
                                    className="flex-1 sm:w-80"
                                />
                                <button onClick={() => setLinkOpen(true)} className="shrink-0 text-xs text-violet-300 hover:text-white bg-violet-500/10 hover:bg-violet-500/20 px-3 py-2 rounded-lg border border-violet-500/20 inline-flex items-center gap-1.5">
                                    <Plus className="w-3.5 h-3.5" /> Nuevo
                                </button>
                            </div>
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
                                    {filteredLinks.length === 0 ? (
                                        <NoMatchesRow colSpan={6} query={linkSearch} />
                                    ) : filteredLinks.map((l) => {
                                        const expired = new Date(l.expires_at) < new Date();
                                        return (
                                            <tr key={l.id} className="border-t border-neutral-800/60">
                                                <td className="p-3 text-neutral-200 text-xs">{l.label || "—"}</td>
                                                <td className="p-3 text-neutral-400 text-xs">{fmtDate(l.created_at)}</td>
                                                <td className="p-3 text-neutral-400 text-xs">{fmtDate(l.expires_at)}{expired ? " (vencido)" : ""}</td>
                                                <td className="p-3 text-center text-neutral-300 text-xs">{l.access_count}</td>
                                                <td className="p-3 text-center">
                                                    <span className={cn("text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border",
                                                        LINK_STATUS_LABELS[l.status]?.chip || LINK_STATUS_LABELS.expired.chip
                                                    )}>{LINK_STATUS_LABELS[l.status]?.label || l.status}</span>
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
                        <div className="p-5 border-b border-neutral-700/50 bg-neutral-800/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div>
                                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                                    <Send className="w-5 h-5 text-amber-400" /> Promesas de pago del cliente
                                    {promiseSearch.trim() && (
                                        <span className="text-xs font-normal text-neutral-400">{filteredPromises.length} de {promises.length}</span>
                                    )}
                                </h2>
                                <p className="text-[11px] text-neutral-500 mt-1">Haz click en una fila para ver el detalle de facturas y el desglose.</p>
                            </div>
                            <SearchBox
                                value={promiseSearch}
                                onChange={setPromiseSearch}
                                placeholder="Buscar monto, fecha, factura, nota"
                                className="w-full sm:w-96"
                            />
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-neutral-900/50 text-[10px] uppercase tracking-wider text-neutral-400">
                                    <tr>
                                        <th className="text-left p-3 w-8"></th>
                                        <th className="text-left p-3">Fecha</th>
                                        <th className="text-left p-3">Esperado</th>
                                        <th className="text-right p-3">Comprometido</th>
                                        <th className="text-left p-3">Facturas</th>
                                        <th className="text-center p-3">Estado</th>
                                        <th className="p-3"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredPromises.length === 0 ? (
                                        <NoMatchesRow colSpan={7} query={promiseSearch} />
                                    ) : filteredPromises.map((p) => {
                                        const isExpanded = expandedPromises.has(p.id);
                                        const promisePayment = paymentByPromise.get(p.id);
                                        const promiseStatus = PROMISE_STATUS_LABELS[p.status] || PROMISE_STATUS_LABELS.cancelled;
                                        // Cumplida sin pago ligado y con facturas aún abiertas → se puede registrar el pago
                                        const canRegisterLater = p.status === 'fulfilled' && !promisePayment
                                            && p.items.some((it) => openInvoiceIds.has(it.invoice_id));
                                        // Desglose agregado: prorrateo gross/vat por item según
                                        // su participación en el net de la factura.
                                        let aggGross = 0, aggVat = 0, aggNet = 0;
                                        for (const it of p.items) {
                                            const inv = it.invoice;
                                            const committed = Number(it.amount_committed);
                                            if (inv && Number(inv.net_amount) > 0) {
                                                const ratio = committed / Number(inv.net_amount);
                                                aggGross += Number(inv.gross_amount) * ratio;
                                                aggVat += Number(inv.vat_amount) * ratio;
                                            }
                                            aggNet += committed;
                                        }
                                        return (
                                            <Fragment key={p.id}>
                                                <tr
                                                    onClick={() => togglePromise(p.id)}
                                                    className={cn(
                                                        "border-t border-neutral-800/60 cursor-pointer transition-colors",
                                                        isExpanded ? "bg-amber-500/[0.04]" : "hover:bg-neutral-800/40"
                                                    )}
                                                >
                                                    <td className="p-3 text-neutral-400">
                                                        {isExpanded
                                                            ? <ChevronUp className="w-4 h-4" />
                                                            : <ChevronDown className="w-4 h-4" />}
                                                    </td>
                                                    <td className="p-3 text-neutral-300 text-xs">{fmtDate(p.promise_date)}</td>
                                                    <td className="p-3 text-neutral-300 text-xs">{fmtDate(p.expected_payment_date)}</td>
                                                    <td className="p-3 text-right text-amber-300 font-mono font-semibold">{fmtMoney(p.total_committed)}</td>
                                                    <td className="p-3 text-xs text-neutral-400 max-w-[280px]">
                                                        <span className="font-semibold text-neutral-200">{p.items.length}</span> {p.items.length === 1 ? 'factura' : 'facturas'}
                                                        {p.client_notes && (
                                                            <span className="block text-[10px] text-neutral-500 italic mt-0.5 truncate" title={p.client_notes}>
                                                                "{p.client_notes}"
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="p-3 text-center">
                                                        <span className={cn("text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border", promiseStatus.chip)}>
                                                            {promiseStatus.label}
                                                        </span>
                                                        {promisePayment && (
                                                            <p className="text-[10px] text-emerald-300 font-mono mt-1" title="Pago registrado">
                                                                Pagó {fmtMoney(promisePayment.amount)}
                                                            </p>
                                                        )}
                                                    </td>
                                                    <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                                                        {p.status === 'pending' && (
                                                            <button
                                                                onClick={() => setPayingPromise(p)}
                                                                disabled={busy}
                                                                title="Registrar el pago de esta promesa"
                                                                className="text-xs text-emerald-300 hover:text-white bg-emerald-500/10 hover:bg-emerald-500/20 px-2.5 py-1 rounded-lg border border-emerald-500/20 inline-flex items-center gap-1"
                                                            >
                                                                <CheckCircle className="w-3 h-3" /> Cumplida
                                                            </button>
                                                        )}
                                                        {canRegisterLater && (
                                                            <button
                                                                onClick={() => setPayingPromise(p)}
                                                                disabled={busy}
                                                                className="text-xs text-cyan-300 hover:text-white bg-cyan-500/10 hover:bg-cyan-500/20 px-2.5 py-1 rounded-lg border border-cyan-500/20 inline-flex items-center gap-1"
                                                            >
                                                                <CreditCard className="w-3 h-3" /> Registrar pago
                                                            </button>
                                                        )}
                                                    </td>
                                                </tr>
                                                {isExpanded && (
                                                    <tr className="bg-neutral-900/30">
                                                        <td colSpan={7} className="p-0">
                                                            <div className="p-4 border-t border-amber-500/20">
                                                                {/* Notas del cliente */}
                                                                {p.client_notes && (
                                                                    <div className="mb-3 bg-violet-500/5 border border-violet-500/20 rounded-xl p-3">
                                                                        <p className="text-[10px] uppercase tracking-wider text-violet-300 font-bold mb-1">Nota del cliente</p>
                                                                        <p className="text-xs text-neutral-200 whitespace-pre-wrap">{p.client_notes}</p>
                                                                    </div>
                                                                )}

                                                                {/* Tabla de facturas incluidas */}
                                                                <div className="rounded-xl border border-neutral-700/50 overflow-hidden">
                                                                    <table className="w-full text-xs">
                                                                        <thead className="bg-neutral-900/60 text-[9px] uppercase tracking-wider text-neutral-400">
                                                                            <tr>
                                                                                <th className="text-left p-2"># Factura</th>
                                                                                <th className="text-left p-2">Concepto</th>
                                                                                <th className="text-right p-2">F. Factura</th>
                                                                                <th className="text-right p-2">Bruto</th>
                                                                                <th className="text-right p-2">IVA</th>
                                                                                <th className="text-right p-2">Total factura</th>
                                                                                <th className="text-right p-2">Saldo</th>
                                                                                <th className="text-right p-2">Comprometido</th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody>
                                                                            {p.items.map((it) => {
                                                                                const inv = it.invoice;
                                                                                const committed = Number(it.amount_committed);
                                                                                const invNet = inv ? Number(inv.net_amount) : 0;
                                                                                const ratio = invNet > 0 ? committed / invNet : 1;
                                                                                const committedGross = inv ? Number(inv.gross_amount) * ratio : 0;
                                                                                const committedVat = inv ? Number(inv.vat_amount) * ratio : 0;
                                                                                return (
                                                                                    <tr key={it.id} className="border-t border-neutral-800/40">
                                                                                        <td className="p-2 text-white font-mono">{inv?.invoice_number || it.invoice_id.slice(0, 8)}</td>
                                                                                        <td className="p-2 text-neutral-300 max-w-[260px] truncate" title={inv?.concept}>{inv?.concept || '—'}</td>
                                                                                        <td className="p-2 text-right text-neutral-400">{fmtDate(inv?.invoice_date ?? null)}</td>
                                                                                        <td className="p-2 text-right text-neutral-300 font-mono">{fmtMoney(committedGross)}</td>
                                                                                        <td className="p-2 text-right text-neutral-300 font-mono">{fmtMoney(committedVat)}</td>
                                                                                        <td className="p-2 text-right text-neutral-400 font-mono">{inv ? fmtMoney(inv.net_amount) : '—'}</td>
                                                                                        <td className="p-2 text-right text-rose-300 font-mono">{inv ? fmtMoney(inv.balance) : '—'}</td>
                                                                                        <td className="p-2 text-right text-amber-300 font-mono font-semibold">{fmtMoney(committed)}</td>
                                                                                    </tr>
                                                                                );
                                                                            })}
                                                                        </tbody>
                                                                        <tfoot className="bg-neutral-900/60 border-t-2 border-amber-500/30 text-[11px] font-semibold">
                                                                            <tr>
                                                                                <td colSpan={3} className="p-2 text-right text-neutral-400 uppercase tracking-wider">Total prometido:</td>
                                                                                <td className="p-2 text-right text-neutral-200 font-mono">{fmtMoney(aggGross)}</td>
                                                                                <td className="p-2 text-right text-neutral-200 font-mono">{fmtMoney(aggVat)}</td>
                                                                                <td className="p-2 text-right text-white font-mono font-bold">{fmtMoney(aggNet)}</td>
                                                                                <td colSpan={2}></td>
                                                                            </tr>
                                                                        </tfoot>
                                                                    </table>
                                                                </div>

                                                                {/* Pago con el que se cumplió la promesa */}
                                                                {promisePayment && (
                                                                    <div className="mt-3 bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3 text-[11px] text-emerald-200 flex items-start gap-2">
                                                                        <CheckCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                                                        <span>
                                                                            Pago registrado el <strong>{fmtDate(promisePayment.payment_date)}</strong> por <strong className="font-mono">{fmtMoney(promisePayment.amount)}</strong>
                                                                            {' '}({METHOD_LABELS[promisePayment.payment_method] || promisePayment.payment_method}{promisePayment.reference ? ` · ${promisePayment.reference}` : ''})
                                                                            {Math.abs(Number(promisePayment.amount) - Number(p.total_committed)) >= 0.01 && (
                                                                                <> — distinto a lo prometido ({fmtMoney(p.total_committed)}).</>
                                                                            )}
                                                                        </span>
                                                                    </div>
                                                                )}

                                                                {/* Cumplida sin pago ligado (marcada antes de que se registrara el pago desde la promesa) */}
                                                                {p.status === 'fulfilled' && !promisePayment && (
                                                                    <div className="mt-3 bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3 text-[11px] text-emerald-200 flex items-start gap-2">
                                                                        <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                                                        <span className="flex-1">
                                                                            Esta promesa está marcada como <strong>cumplida</strong> sin un pago registrado desde la promesa. Si el dinero aún no está capturado, regístralo para que el saldo de las facturas se actualice.
                                                                        </span>
                                                                        {canRegisterLater && (
                                                                            <button
                                                                                onClick={() => setPayingPromise(p)}
                                                                                className="shrink-0 text-xs text-cyan-300 hover:text-white bg-cyan-500/10 hover:bg-cyan-500/20 px-2.5 py-1 rounded-lg border border-cyan-500/20"
                                                                            >
                                                                                Registrar pago
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </Fragment>
                                        );
                                    })}
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
                {editingInvoice && (
                    <EditInvoiceModal
                        invoice={editingInvoice}
                        onClose={() => setEditingInvoice(null)}
                        onSaved={async () => { setEditingInvoice(null); flash('success', 'Partida actualizada.'); await load(); }}
                        setErr={(t) => flash('error', t)}
                    />
                )}
                {(payOpen || payingPromise) && (
                    <PaymentModal
                        key={payingPromise?.id || 'manual'}
                        clientId={Number(clientId)}
                        openInvoices={openInvoices}
                        promise={payingPromise}
                        onClose={() => { setPayOpen(false); setPayingPromise(null); }}
                        onSaved={async (message, warning) => {
                            setPayOpen(false);
                            setPayingPromise(null);
                            flash(warning ? 'error' : 'success', warning || message);
                            await load();
                        }}
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
    const [cfdiSearch, setCfdiSearch] = useState("");

    // El CFDI seleccionado se queda en la lista aunque no coincida con la búsqueda
    const filteredCfdis = useMemo(() => availableCfdis.filter((c: any) =>
        c.id === selectedCfdi || matchesSearch(cfdiSearch,
            c.serie, c.folio, [c.serie, c.folio].filter(Boolean).join("-"), c.uuid, c.receptor_nombre,
            amountSearchTerms(c.total), amountSearchTerms(c.subtotal), dateSearchTerms(c.invoice_date?.slice(0, 10)))
    ), [availableCfdis, cfdiSearch, selectedCfdi]);

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
                        <SearchBox
                            value={cfdiSearch}
                            onChange={setCfdiSearch}
                            placeholder="Buscar CFDI por folio, UUID, monto, fecha..."
                            className="mt-1"
                        />
                        <select value={selectedCfdi} onChange={(e) => handleCfdiChange(e.target.value)} className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white mt-2 focus:outline-none focus:border-cyan-500">
                            <option value="">
                                {cfdiSearch.trim()
                                    ? `— ${filteredCfdis.length} de ${availableCfdis.length} CFDIs coinciden · Crear manual (sin CFDI) —`
                                    : "— Crear manual (sin CFDI) —"}
                            </option>
                            {filteredCfdis.map((c: any) => (
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

function EditInvoiceModal({ invoice, onClose, onSaved, setErr }: { invoice: Invoice; onClose: () => void; onSaved: () => void | Promise<void>; setErr: (t: string) => void }) {
    const [concept, setConcept] = useState(invoice.concept);
    const [gross, setGross] = useState(String(invoice.gross_amount));
    const [invoiceNumber, setInvoiceNumber] = useState(invoice.invoice_number || "");
    const [invoiceDate, setInvoiceDate] = useState(invoice.invoice_date || new Date().toISOString().slice(0, 10));
    const [dueDate, setDueDate] = useState(invoice.due_date || "");
    const [notes, setNotes] = useState(invoice.notes || "");
    const [busy, setBusy] = useState(false);

    const hasPayments = invoice.paid_amount > 0;
    const isLocked = hasPayments || invoice.status === 'cancelled';

    const submit = async () => {
        if (!concept.trim()) { setErr("Falta el concepto."); return; }
        const g = Number(gross);
        if (!isFinite(g) || g < 0) { setErr("Monto inválido."); return; }

        // Validación: si ya tiene pagos, el nuevo gross no puede ser menor al ya pagado
        if (hasPayments && g < Number(invoice.paid_amount)) {
            setErr(`El nuevo monto bruto ($${g.toFixed(2)}) no puede ser menor a lo ya pagado ($${Number(invoice.paid_amount).toFixed(2)}).`);
            return;
        }

        setBusy(true);
        try {
            await updateARInvoiceAction(invoice.id, {
                client_id: invoice.client_id,
                concept: concept.trim(),
                gross_amount: g,
                invoice_number: invoiceNumber.trim() || null,
                invoice_date: invoiceDate,
                due_date: dueDate || null,
                notes: notes.trim() || null,
            });
            onSaved();
        } catch (e: any) { setErr(e.message); }
        finally { setBusy(false); }
    };

    const grossNum = Number(gross);
    const vat = isFinite(grossNum) && grossNum >= 0 ? Math.round(grossNum * 0.16 * 100) / 100 : 0;
    const net = isFinite(grossNum) && grossNum >= 0 ? Math.round((grossNum + vat) * 100) / 100 : 0;

    return (
        <ModalShell title={`Editar partida${hasPayments ? ' (con pagos aplicados)' : ''}`} onClose={onClose}>
            {hasPayments && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 mb-4 text-xs text-amber-200">
                    <strong>Esta partida ya tiene ${Number(invoice.paid_amount).toFixed(2)} aplicados.</strong> El nuevo monto bruto no puede ser menor a lo ya pagado.
                </div>
            )}
            <div className="space-y-4">
                <div>
                    <label className="text-xs font-medium text-neutral-300">Concepto *</label>
                    <input
                        value={concept}
                        onChange={(e) => setConcept(e.target.value)}
                        disabled={isLocked}
                        placeholder="Ej. Maquinado de pieza especial..."
                        className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white mt-1 focus:outline-none focus:border-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-xs font-medium text-neutral-300"># Factura</label>
                        <input
                            value={invoiceNumber}
                            onChange={(e) => setInvoiceNumber(e.target.value)}
                            disabled={isLocked}
                            placeholder="Folio o número"
                            className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white mt-1 focus:outline-none focus:border-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                    </div>
                    <div>
                        <label className="text-xs font-medium text-neutral-300">Fecha factura</label>
                        <input
                            type="date"
                            value={invoiceDate}
                            onChange={(e) => setInvoiceDate(e.target.value)}
                            disabled={isLocked}
                            className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white mt-1 focus:outline-none focus:border-cyan-500 [color-scheme:dark] disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-xs font-medium text-neutral-300">Subtotal (Bruto) *</label>
                        <input
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            value={gross}
                            onChange={(e) => setGross(e.target.value)}
                            disabled={isLocked}
                            placeholder="0.00"
                            className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white mt-1 focus:outline-none focus:border-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                        <p className="text-[10px] text-neutral-500 mt-1">IVA 16% se recalcula automáticamente</p>
                    </div>
                    <div>
                        <label className="text-xs font-medium text-neutral-300">Fecha vencimiento</label>
                        <input
                            type="date"
                            value={dueDate}
                            onChange={(e) => setDueDate(e.target.value)}
                            disabled={isLocked}
                            className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white mt-1 focus:outline-none focus:border-cyan-500 [color-scheme:dark] disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                    </div>
                </div>
                <div>
                    <label className="text-xs font-medium text-neutral-300">Notas (opcional)</label>
                    <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        disabled={isLocked}
                        rows={2}
                        className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white mt-1 focus:outline-none focus:border-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                </div>
                {!isLocked && (
                    <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-xl p-3 text-xs space-y-1">
                        <div className="flex justify-between text-neutral-300"><span>Bruto:</span><span className="font-mono">${grossNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                        <div className="flex justify-between text-neutral-300"><span>IVA 16%:</span><span className="font-mono">${vat.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                        <div className="flex justify-between text-white font-semibold border-t border-cyan-500/20 pt-1"><span>Total:</span><span className="font-mono">${net.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                    </div>
                )}
                {isLocked && (
                    <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 text-xs text-rose-200">
                        Partida bloqueada para edición. {invoice.status === 'cancelled' ? 'Está cancelada.' : 'Tiene pagos aplicados — solo puedes editar concepto, folio y notas.'}
                    </div>
                )}
            </div>
            <div className="mt-6 flex justify-end gap-3">
                <button onClick={onClose} className="px-4 py-2 text-sm text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded-xl">Cancelar</button>
                <button onClick={submit} disabled={busy || isLocked} className="px-5 py-2 text-sm font-semibold text-white bg-gradient-to-r from-cyan-500 to-cyan-600 hover:from-cyan-600 hover:to-cyan-700 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed">
                    {busy ? "Guardando..." : "Guardar cambios"}
                </button>
            </div>
        </ModalShell>
    );
}

type PayMode = 'exact' | 'other';

function PaymentModal({ clientId, openInvoices, promise, onClose, onSaved }: {
    clientId: number;
    openInvoices: Invoice[];
    /** Si viene, el pago cumple esta promesa: se pregunta si fue el monto exacto u otra cantidad. */
    promise?: PromiseRow | null;
    onClose: () => void;
    onSaved: (message: string, warning?: string | null) => void | Promise<void>;
}) {
    const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
    const [amount, setAmount] = useState("");
    const [method, setMethod] = useState<"transfer" | "cash" | "check" | "card" | "other">("transfer");
    const [reference, setReference] = useState("");
    const [notes, setNotes] = useState(promise ? `Pago de la promesa del ${fmtDate(promise.promise_date)}` : "");
    const [allocations, setAllocations] = useState<Record<string, string>>({});
    // Con promesa, primero se elige si pagó exactamente lo prometido u otra cantidad
    const [mode, setMode] = useState<PayMode | null>(promise ? null : 'other');
    const [search, setSearch] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const openById = useMemo(() => new Map(openInvoices.map((i) => [i.id, i])), [openInvoices]);

    // Lo que la promesa cubre de cada factura, topado al saldo actual
    // (si hubo otros pagos después de la promesa, solo se aplica lo que falta).
    const promiseTargets = useMemo(() => (promise?.items || []).map((it) => {
        const open = openById.get(it.invoice_id);
        const committed = round2(Number(it.amount_committed));
        return {
            invoice_id: it.invoice_id,
            invoice: open || it.invoice,
            committed,
            applicable: open ? round2(Math.min(committed, Number(open.balance))) : 0,
        };
    }), [promise, openById]);
    const promiseCommitted = useMemo(() => new Map(promiseTargets.map((t) => [t.invoice_id, t.committed])), [promiseTargets]);
    const committedTotal = round2(promiseTargets.reduce((s, t) => s + t.committed, 0));
    const exactTotal = round2(promiseTargets.reduce((s, t) => s + t.applicable, 0));

    const totalAlloc = round2(Object.values(allocations).reduce((s, v) => s + (Number(v) || 0), 0));
    const amountNum = Number(amount) || 0;
    const diff = round2(amountNum - totalAlloc);

    // Reparte un monto entre las facturas de la promesa: primero hasta lo
    // comprometido en cada una y, si sobra, hasta su saldo completo.
    const distribute = (total: number) => {
        let left = round2(total);
        const applied: Record<string, number> = {};
        for (const t of promiseTargets) {
            const take = round2(Math.min(left, t.applicable));
            if (take > 0) { applied[t.invoice_id] = take; left = round2(left - take); }
        }
        for (const t of promiseTargets) {
            const open = openById.get(t.invoice_id);
            if (!open) continue;
            const take = round2(Math.min(left, Number(open.balance) - (applied[t.invoice_id] || 0)));
            if (take > 0) { applied[t.invoice_id] = round2((applied[t.invoice_id] || 0) + take); left = round2(left - take); }
        }
        return Object.fromEntries(Object.entries(applied).map(([id, v]) => [id, v.toFixed(2)]));
    };

    const chooseMode = (m: PayMode) => {
        setMode(m);
        setError(null);
        if (m === 'exact') {
            setAmount(exactTotal.toFixed(2));
            setAllocations(distribute(exactTotal));
        } else {
            setAmount("");
            setAllocations({});
        }
    };

    const onAmountChange = (value: string) => {
        setAmount(value);
        // Con promesa, el monto se reparte solo entre sus facturas; después se puede ajustar a mano
        if (promise && mode === 'other') setAllocations(distribute(Number(value) || 0));
    };

    // Pone (o quita) el saldo completo de la factura como monto aplicado
    const toggleFull = (inv: Invoice) => {
        const balance = round2(Number(inv.balance));
        setAllocations((prev) => {
            const isFull = Math.abs((Number(prev[inv.id]) || 0) - balance) < 0.005;
            return { ...prev, [inv.id]: isFull ? "" : balance.toFixed(2) };
        });
    };

    // Facturas de la promesa primero; el buscador filtra sin perder lo ya asignado
    const rows = useMemo(() => {
        const list = promise
            ? [...openInvoices].sort((a, b) => Number(promiseCommitted.has(b.id)) - Number(promiseCommitted.has(a.id)))
            : openInvoices;
        return list.filter((inv) => matchesSearch(search, invoiceSearchFields(inv)));
    }, [openInvoices, promise, promiseCommitted, search]);
    const visibleIds = new Set(rows.map((r) => r.id));
    const hiddenAssigned = Object.entries(allocations).filter(([id, v]) => Number(v) > 0 && !visibleIds.has(id)).length;

    const submit = async () => {
        setError(null);
        if (promise && !mode) { setError("Indica si el cliente pagó exactamente lo prometido u otra cantidad."); return; }
        if (amountNum <= 0) { setError("El monto del pago debe ser mayor a 0."); return; }
        const allocs = Object.entries(allocations)
            .filter(([, v]) => Number(v) > 0)
            .map(([id, v]) => ({ invoice_id: id, amount_applied: round2(Number(v)) }));
        if (allocs.length === 0) { setError("Asigna el pago a al menos una factura."); return; }
        for (const a of allocs) {
            const inv = openById.get(a.invoice_id);
            if (inv && a.amount_applied - Number(inv.balance) > 0.005) {
                setError(`A "${inv.invoice_number || inv.concept}" se le asignan ${fmtMoney(a.amount_applied)} pero su saldo es ${fmtMoney(inv.balance)}.`);
                return;
            }
        }
        if (Math.abs(totalAlloc - amountNum) > 0.01) {
            setError(`La suma asignada (${fmtMoney(totalAlloc)}) no coincide con el monto (${fmtMoney(amountNum)}).`);
            return;
        }
        setBusy(true);
        try {
            const res = await registerARPaymentAction({
                client_id: clientId,
                payment_date: paymentDate,
                amount: amountNum,
                payment_method: method,
                reference: reference.trim() || null,
                notes: notes.trim() || null,
                allocations: allocs,
                promise_id: promise?.id ?? null,
            });
            await onSaved(promise ? 'Pago registrado y promesa cumplida.' : 'Pago registrado.', res.warning);
        } catch (e: any) { setError(e.message); }
        finally { setBusy(false); }
    };

    // Para cuando el pago ya se capturó por separado con "Registrar pago"
    const markFulfilledOnly = async () => {
        if (!promise) return;
        if (!confirm('¿Marcar la promesa como cumplida SIN registrar un pago?\n\nÚsalo solo si el pago ya se capturó por separado con "Registrar pago".')) return;
        setError(null);
        setBusy(true);
        try {
            await markPromiseStatusAction(promise.id, 'fulfilled');
            await onSaved('Promesa marcada como cumplida (sin registrar pago).');
        } catch (e: any) { setError(e.message); }
        finally { setBusy(false); }
    };

    return (
        <ModalShell title={promise ? "Promesa cumplida — registrar pago" : "Registrar pago"} onClose={onClose}>
            <div className="space-y-4">
                {promise && (
                    <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4">
                        <p className="text-sm font-semibold text-white">¿El cliente pagó exactamente lo prometido?</p>
                        <p className="text-[11px] text-neutral-400 mt-0.5">
                            Promesa del {fmtDate(promise.promise_date)}
                            {promise.expected_payment_date ? ` · pago esperado ${fmtDate(promise.expected_payment_date)}` : ""}
                            {" · "}{promise.items.length} {promise.items.length === 1 ? "factura" : "facturas"}
                            {" · comprometido "}<span className="font-mono">{fmtMoney(committedTotal)}</span>
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                            <button
                                type="button"
                                onClick={() => chooseMode('exact')}
                                disabled={busy || exactTotal <= 0}
                                className={cn(
                                    "text-left rounded-xl border px-3 py-2.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
                                    mode === 'exact' ? "border-emerald-500/60 bg-emerald-500/15" : "border-neutral-700 hover:border-emerald-500/40 hover:bg-emerald-500/5"
                                )}
                            >
                                <span className="flex items-center gap-1.5 text-sm font-semibold text-emerald-300">
                                    <CheckCircle className="w-4 h-4" /> Sí, exactamente
                                </span>
                                <span className="block text-xs text-neutral-300 font-mono mt-0.5">{fmtMoney(exactTotal)}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => chooseMode('other')}
                                disabled={busy}
                                className={cn(
                                    "text-left rounded-xl border px-3 py-2.5 transition-colors",
                                    mode === 'other' ? "border-cyan-500/60 bg-cyan-500/15" : "border-neutral-700 hover:border-cyan-500/40 hover:bg-cyan-500/5"
                                )}
                            >
                                <span className="flex items-center gap-1.5 text-sm font-semibold text-cyan-300">
                                    <Pencil className="w-4 h-4" /> No, otra cantidad
                                </span>
                                <span className="block text-xs text-neutral-400 mt-0.5">Capturo el monto que llegó</span>
                            </button>
                        </div>
                        {exactTotal < committedTotal - 0.005 && (
                            <p className="mt-2 text-[11px] text-amber-200 flex items-start gap-1.5">
                                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                {exactTotal > 0
                                    ? `Algunas facturas de la promesa ya recibieron pagos: solo quedan ${fmtMoney(exactTotal)} por aplicar de lo prometido.`
                                    : "Las facturas de esta promesa ya no tienen saldo pendiente."}
                            </p>
                        )}
                    </div>
                )}

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
                        <input
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            value={amount}
                            onChange={(e) => onAmountChange(e.target.value)}
                            disabled={mode !== 'other'}
                            placeholder={mode ? "0.00" : "Elige una opción arriba"}
                            className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white mt-1 focus:outline-none focus:border-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed"
                        />
                        {mode === 'other' && totalAlloc > 0 && Math.abs(diff) >= 0.01 && (
                            <button type="button" onClick={() => setAmount(totalAlloc.toFixed(2))} className="text-[10px] text-emerald-300 hover:text-white hover:underline underline-offset-2 mt-1">
                                Usar lo asignado ({fmtMoney(totalAlloc)})
                            </button>
                        )}
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

                {/* Monto exacto: se aplica lo prometido a cada factura de la promesa */}
                {mode === 'exact' && (
                    <div>
                        <label className="text-xs font-medium text-neutral-300">Se aplicará a</label>
                        <div className="mt-1 rounded-xl border border-neutral-700/50 overflow-hidden">
                            <table className="w-full text-xs">
                                <thead className="bg-neutral-900/60 text-[9px] uppercase tracking-wider text-neutral-400">
                                    <tr>
                                        <th className="text-left p-2"># Factura / Concepto</th>
                                        <th className="text-right p-2">Saldo</th>
                                        <th className="text-right p-2">Prometido</th>
                                        <th className="text-right p-2">Se aplica</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {promiseTargets.map((t) => {
                                        const open = openById.get(t.invoice_id);
                                        return (
                                            <tr key={t.invoice_id} className={cn("border-t border-neutral-800/40", t.applicable <= 0 && "opacity-50")}>
                                                <td className="p-2">
                                                    <p className="text-white font-mono">{t.invoice?.invoice_number || t.invoice_id.slice(0, 8)}</p>
                                                    <p className="text-[10px] text-neutral-400 truncate max-w-[240px]" title={t.invoice?.concept}>{t.invoice?.concept || "—"}</p>
                                                </td>
                                                <td className="p-2 text-right text-rose-300 font-mono">{open ? fmtMoney(open.balance) : "Sin saldo"}</td>
                                                <td className="p-2 text-right text-amber-300 font-mono">{fmtMoney(t.committed)}</td>
                                                <td className="p-2 text-right text-emerald-300 font-mono font-semibold">{fmtMoney(t.applicable)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                                <tfoot className="bg-neutral-900/60 border-t-2 border-emerald-500/30 text-[11px] font-semibold">
                                    <tr>
                                        <td colSpan={2} className="p-2 text-right text-neutral-400 uppercase tracking-wider">Total:</td>
                                        <td className="p-2 text-right text-amber-300 font-mono">{fmtMoney(committedTotal)}</td>
                                        <td className="p-2 text-right text-emerald-300 font-mono">{fmtMoney(exactTotal)}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                        <p className="text-[10px] text-neutral-500 mt-1">¿Llegó otro monto o hay que repartirlo distinto? Elige “No, otra cantidad”.</p>
                    </div>
                )}

                {/* Distribución manual entre facturas abiertas */}
                {mode === 'other' && (
                    openInvoices.length === 0 ? (
                        <p className="text-xs text-neutral-500 bg-neutral-900/40 border border-neutral-700/50 rounded-xl p-4 text-center">
                            El cliente no tiene facturas con saldo pendiente.
                        </p>
                    ) : (
                        <div>
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                <label className="text-xs font-medium text-neutral-300">Aplicar a facturas</label>
                                <SearchBox
                                    value={search}
                                    onChange={setSearch}
                                    placeholder="Buscar concepto, factura, monto, fecha"
                                    className="sm:w-96"
                                />
                            </div>
                            <p className="text-[10px] text-neutral-500 mt-1">
                                {promise
                                    ? "El monto se reparte primero entre las facturas de la promesa; puedes ajustarlo a mano. “Liquidar” pone el saldo completo de la factura."
                                    : "“Liquidar” pone el saldo completo de la factura; si el pago no alcanza, escribe el monto a mano."}
                            </p>
                            <div className="mt-2 max-h-72 overflow-y-auto bg-neutral-900/40 border border-neutral-700/50 rounded-xl">
                                {rows.length === 0 ? (
                                    <p className="p-4 text-center text-xs text-neutral-500">Sin resultados para “{search.trim()}”.</p>
                                ) : rows.map((inv) => {
                                    const balance = round2(Number(inv.balance));
                                    const current = Number(allocations[inv.id]) || 0;
                                    const isFull = balance > 0 && Math.abs(current - balance) < 0.005;
                                    const committed = promiseCommitted.get(inv.id);
                                    return (
                                        <div key={inv.id} className={cn("flex items-center gap-2 sm:gap-3 p-3 border-b border-neutral-800/60 last:border-0", current > 0 && "bg-emerald-500/[0.04]")}>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-1.5">
                                                    <p className="text-white text-sm font-medium truncate">{inv.invoice_number || "—"}</p>
                                                    {committed !== undefined && (
                                                        <span className="shrink-0 text-[9px] uppercase tracking-wider text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/30 font-bold">Promesa</span>
                                                    )}
                                                </div>
                                                <p className="text-[11px] text-neutral-400 truncate" title={inv.concept}>{inv.concept}</p>
                                                <p className="text-[10px] text-neutral-500">
                                                    Saldo: <span className="font-mono text-rose-300">{fmtMoney(balance)}</span> · {fmtDate(inv.invoice_date)}
                                                    {committed !== undefined && <> · Prometido: <span className="font-mono text-amber-300">{fmtMoney(committed)}</span></>}
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => toggleFull(inv)}
                                                title={isFull ? "Quitar el monto" : `Aplicar el saldo completo (${fmtMoney(balance)})`}
                                                className={cn(
                                                    "shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border transition-colors",
                                                    isFull
                                                        ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                                                        : "text-neutral-300 border-neutral-700 hover:text-white hover:border-emerald-500/40 hover:bg-emerald-500/10"
                                                )}
                                            >
                                                {isFull ? <CheckCircle className="w-3 h-3" /> : <Wallet className="w-3 h-3" />}
                                                {isFull ? "Liquidada" : "Liquidar"}
                                            </button>
                                            <input
                                                type="number"
                                                inputMode="decimal"
                                                step="0.01"
                                                min={0}
                                                max={balance}
                                                aria-label={`Monto a aplicar a ${inv.invoice_number || inv.concept}`}
                                                value={allocations[inv.id] || ""}
                                                onChange={(e) => setAllocations((prev) => ({ ...prev, [inv.id]: e.target.value }))}
                                                placeholder="0.00"
                                                className="w-24 sm:w-28 bg-neutral-800/60 border border-neutral-700 rounded-lg px-2 py-1 text-sm text-white text-right focus:outline-none focus:border-emerald-500"
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                            {hiddenAssigned > 0 && (
                                <p className="text-[10px] text-amber-300 mt-1">
                                    {hiddenAssigned} {hiddenAssigned === 1 ? "factura con monto asignado no se muestra" : "facturas con monto asignado no se muestran"} por la búsqueda.
                                </p>
                            )}
                            <div className="mt-2 flex justify-between text-xs">
                                <span className="text-neutral-400">Asignado:</span>
                                <span className={cn("font-mono font-semibold", Math.abs(diff) < 0.01 ? "text-emerald-300" : "text-amber-300")}>
                                    {fmtMoney(totalAlloc)} / {fmtMoney(amountNum)}
                                </span>
                            </div>
                            {Math.abs(diff) >= 0.01 && amountNum > 0 && (
                                <p className="text-[10px] text-right text-amber-300">
                                    {diff > 0 ? `Falta asignar ${fmtMoney(diff)}` : `Asignado de más: ${fmtMoney(-diff)}`}
                                </p>
                            )}
                        </div>
                    )
                )}

                {error && (
                    <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 text-xs text-rose-200 flex items-start gap-2">
                        <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <span>{error}</span>
                    </div>
                )}
            </div>
            <div className="mt-6 flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    {promise?.status === 'pending' && (
                        <button type="button" onClick={markFulfilledOnly} disabled={busy} className="text-[11px] text-neutral-400 hover:text-white hover:underline underline-offset-2 disabled:opacity-50">
                            El pago ya estaba registrado: solo marcar cumplida
                        </button>
                    )}
                </div>
                <div className="flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 text-sm text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded-xl">Cancelar</button>
                    <button onClick={submit} disabled={busy || !mode} className="px-5 py-2 text-sm font-semibold text-white bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed">
                        {busy ? "Registrando..." : "Registrar pago"}
                    </button>
                </div>
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
