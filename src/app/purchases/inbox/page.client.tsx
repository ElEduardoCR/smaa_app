"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, Inbox, RefreshCw, CheckCircle, X, FileText, FileCode, AlertCircle, Sparkles, Filter, Search, CheckCheck, XCircle, CalendarSearch, Link2 } from "lucide-react";
import Link from "next/link";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

type InboxRow = {
    id: string;
    email_message_id: string;
    email_from: string | null;
    email_subject: string | null;
    email_date: string | null;
    pdf_url: string | null;
    xml_url: string | null;
    detected_source: string | null;
    supplier_rfc: string | null;
    supplier_name: string | null;
    invoice_uuid: string | null;
    invoice_folio: string | null;
    invoice_date: string | null;
    subtotal: number | null;
    vat_total: number | null;
    total: number | null;
    currency: string | null;
    classification_confidence: number | null;
    status: string;
    purchase_order_id: string | null;
    duplicate_po_number: string | null;
    created_at: string;
};

const STATUS_FILTERS = [
    { key: 'pending', label: 'Pendientes' },
    { key: 'approved', label: 'Aprobadas' },
    { key: 'discarded', label: 'Descartadas' },
    { key: 'duplicate', label: 'Duplicadas' },
];

export default function InboxPage() {
    const [rows, setRows] = useState<InboxRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<string>('pending');
    const [search, setSearch] = useState<string>('');
    const [busyId, setBusyId] = useState<string | null>(null);
    const [bulkBusy, setBulkBusy] = useState<{ kind: 'approve' | 'discard', done: number, total: number } | null>(null);
    const [msg, setMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    const [dayDate, setDayDate] = useState<string>(() => {
        // Por defecto: ayer (CDMX aprox.)
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return d.toISOString().slice(0, 10);
    });
    const [daySyncing, setDaySyncing] = useState(false);

    const fetchRows = async (statusOverride?: string) => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('invoice_inbox')
                .select('*')
                .eq('status', statusOverride ?? filter)
                .order('email_date', { ascending: false })
                .limit(200);
            if (error) throw error;
            setRows((data as InboxRow[]) || []);
        } catch (e: any) {
            setMsg({ type: 'error', text: e.message });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchRows(); }, [filter]);

    const approve = async (id: string) => {
        setBusyId(id); setMsg(null);
        try {
            const res = await fetch('/api/invoice-inbox/approve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ inboxId: id }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error al aprobar');
            setMsg({ type: 'success', text: `Factura registrada como orden de compra.` });
            fetchRows();
        } catch (e: any) {
            setMsg({ type: 'error', text: e.message });
        } finally {
            setBusyId(null);
        }
    };

    const discard = async (id: string) => {
        if (!confirm('¿Descartar esta factura? No se creará registro en Compras.')) return;
        setBusyId(id); setMsg(null);
        try {
            const res = await fetch('/api/invoice-inbox/discard', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ inboxId: id }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error al descartar');
            fetchRows();
        } catch (e: any) {
            setMsg({ type: 'error', text: e.message });
        } finally {
            setBusyId(null);
        }
    };

    const searchDay = async () => {
        if (!dayDate) return;
        setDaySyncing(true); setMsg(null);
        try {
            const res = await fetch('/api/email-sync/day', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date: dayDate }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error al buscar facturas de ese día');

            const fechaLabel = new Date(dayDate + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
            const parts: string[] = [];
            parts.push(`${data.inserted} factura(s) nueva(s) detectada(s)`);
            if (data.duplicates > 0) parts.push(`${data.duplicates} duplicada(s) (ya registradas como PO)`);
            if (data.scanned === 0) parts.push('no se encontraron correos con factura ese día');

            setMsg({
                type: 'success',
                text: `Búsqueda del ${fechaLabel}: ${parts.join(' · ')}.${data.duplicates > 0 ? ' Revisa la pestaña "Duplicadas".' : ''}`,
            });

            // Lleva al filtro donde aparecerá lo nuevo
            const target = (data.inserted > 0 || data.pending > 0)
                ? 'pending'
                : (data.duplicates > 0 ? 'duplicate' : filter);
            setFilter(target);
            fetchRows(target);
        } catch (e: any) {
            setMsg({ type: 'error', text: e.message });
        } finally {
            setDaySyncing(false);
        }
    };

    const filteredRows = rows.filter(r => {
        if (!search.trim()) return true;
        const q = search.trim().toLowerCase();
        return (
            (r.supplier_name || '').toLowerCase().includes(q) ||
            (r.supplier_rfc || '').toLowerCase().includes(q) ||
            (r.invoice_folio || '').toLowerCase().includes(q) ||
            (r.email_from || '').toLowerCase().includes(q) ||
            (r.email_subject || '').toLowerCase().includes(q)
        );
    });

    const bulkApproveAll = async () => {
        const targets = filteredRows.filter(r => r.status === 'pending');
        if (targets.length === 0) return;
        if (!confirm(`¿Aprobar ${targets.length} factura(s) y registrarlas como órdenes de compra? Esto puede tardar unos segundos.`)) return;
        setMsg(null);
        let ok = 0, fail = 0;
        const errors: string[] = [];
        for (let i = 0; i < targets.length; i++) {
            setBulkBusy({ kind: 'approve', done: i, total: targets.length });
            try {
                const res = await fetch('/api/invoice-inbox/approve', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ inboxId: targets[i].id }),
                });
                const data = await res.json();
                if (!res.ok) { fail++; errors.push(`${targets[i].supplier_name || targets[i].id}: ${data.error}`); }
                else ok++;
            } catch (e: any) {
                fail++; errors.push(`${targets[i].supplier_name || targets[i].id}: ${e.message}`);
            }
        }
        setBulkBusy(null);
        setMsg({
            type: fail === 0 ? 'success' : 'error',
            text: fail === 0
                ? `${ok} factura(s) aprobadas y registradas en Compras.`
                : `Aprobadas: ${ok}. Fallaron: ${fail}. ${errors.slice(0, 3).join(' · ')}${errors.length > 3 ? '…' : ''}`,
        });
        fetchRows();
    };

    const bulkDiscardAll = async () => {
        const targets = filteredRows.filter(r => r.status === 'pending');
        if (targets.length === 0) return;
        if (!confirm(`¿Descartar ${targets.length} factura(s)? No se creará nada en Compras.`)) return;
        setMsg(null);
        let ok = 0, fail = 0;
        for (let i = 0; i < targets.length; i++) {
            setBulkBusy({ kind: 'discard', done: i, total: targets.length });
            try {
                const res = await fetch('/api/invoice-inbox/discard', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ inboxId: targets[i].id, reason: 'bulk_discard' }),
                });
                if (!res.ok) fail++; else ok++;
            } catch {
                fail++;
            }
        }
        setBulkBusy(null);
        setMsg({
            type: fail === 0 ? 'success' : 'error',
            text: fail === 0 ? `${ok} factura(s) descartadas.` : `Descartadas: ${ok}. Fallaron: ${fail}.`,
        });
        fetchRows();
    };

    const pendingInFilter = filteredRows.filter(r => r.status === 'pending').length;

    const fmt = (n: number | null) => n == null ? '—' : `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-3 sm:p-6 md:p-8 lg:p-10 font-[family-name:var(--font-sans)]">
            <div className="w-full space-y-8">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                        <Link href="/purchases" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors text-neutral-400 hover:text-white border border-neutral-700"><ArrowLeft className="w-5 h-5" /></Link>
                        <div>
                            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                                <Inbox className="w-8 h-8 text-orange-400" />
                                Bandeja IA · Facturas detectadas
                            </h1>
                            <p className="text-neutral-400 text-sm mt-1">Revisa las facturas que la IA detectó en tu correo y apruébalas para registrarlas en Compras.</p>
                        </div>
                    </div>
                    <button onClick={() => fetchRows()} className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium" disabled={loading}>
                        <RefreshCw className={cn("w-4 h-4", loading && "animate-spin text-orange-400")} /> Refresh
                    </button>
                </header>

                {/* Búsqueda por día específico */}
                <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl p-6 backdrop-blur-sm">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                        <div className="flex items-start gap-3">
                            <div className="bg-orange-500/10 p-2.5 rounded-xl border border-orange-500/20">
                                <CalendarSearch className="w-5 h-5 text-orange-400" />
                            </div>
                            <div>
                                <h3 className="text-base font-semibold text-white">Buscar facturas de un día específico</h3>
                                <p className="text-neutral-400 text-sm mt-0.5">Elige una fecha y la IA revisará tu correo de ese día. Si una factura ya existe como orden de compra, te lo avisaremos.</p>
                            </div>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                            <input
                                type="date"
                                value={dayDate}
                                max={new Date().toISOString().slice(0, 10)}
                                onChange={(e) => setDayDate(e.target.value)}
                                className="bg-neutral-900/60 border border-neutral-700/50 rounded-xl px-4 py-2.5 text-sm text-neutral-200 focus:outline-none focus:border-orange-500/50 focus:ring-2 focus:ring-orange-500/20 [color-scheme:dark]"
                            />
                            <button
                                onClick={searchDay}
                                disabled={daySyncing || !dayDate}
                                className="inline-flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-5 py-2.5 rounded-xl font-medium text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                            >
                                {daySyncing
                                    ? <><RefreshCw className="w-4 h-4 animate-spin" /> Buscando…</>
                                    : <><CalendarSearch className="w-4 h-4" /> Buscar facturas</>}
                            </button>
                        </div>
                    </div>
                </div>

                {msg && (
                    <div className={cn(
                        "p-4 rounded-xl border flex items-center gap-3",
                        msg.type === 'error' ? "bg-red-500/10 border-red-500/30 text-red-400" : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                    )}>
                        {msg.type === 'error' ? <AlertCircle className="w-5 h-5 flex-shrink-0" /> : <CheckCircle className="w-5 h-5 flex-shrink-0" />}
                        {msg.text}
                    </div>
                )}

                <div className="flex flex-col lg:flex-row lg:items-center gap-4 lg:justify-between">
                    <div className="flex items-center gap-2 flex-wrap">
                        <Filter className="w-4 h-4 text-neutral-500" />
                        {STATUS_FILTERS.map(f => (
                            <button key={f.key} onClick={() => setFilter(f.key)}
                                className={cn(
                                    "px-4 py-2 rounded-xl text-sm font-medium transition-all border",
                                    filter === f.key
                                        ? "bg-orange-500/20 border-orange-500/40 text-orange-300"
                                        : "bg-neutral-800/40 border-neutral-700/50 text-neutral-400 hover:text-white hover:bg-neutral-700/50"
                                )}>
                                {f.label}
                            </button>
                        ))}
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3 sm:items-center w-full lg:w-auto">
                        <div className="relative flex-1 min-w-0 min-w-[240px]">
                            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Buscar por proveedor, RFC, folio, asunto..."
                                className="w-full bg-neutral-800/40 border border-neutral-700/50 rounded-xl pl-10 pr-9 py-2 text-sm text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-orange-500/50 focus:ring-2 focus:ring-orange-500/20"
                            />
                            {search && (
                                <button onClick={() => setSearch('')}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white p-1 rounded-md hover:bg-neutral-700/50">
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>

                        {filter === 'pending' && pendingInFilter > 0 && (
                            <div className="flex gap-2">
                                <button onClick={bulkApproveAll} disabled={!!bulkBusy}
                                    className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 px-3 py-2 rounded-xl border border-emerald-500/30 disabled:opacity-50 whitespace-nowrap">
                                    {bulkBusy?.kind === 'approve'
                                        ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Aprobando {bulkBusy.done + 1}/{bulkBusy.total}…</>
                                        : <><CheckCheck className="w-3.5 h-3.5" /> Aprobar todas ({pendingInFilter})</>}
                                </button>
                                <button onClick={bulkDiscardAll} disabled={!!bulkBusy}
                                    className="inline-flex items-center gap-1.5 text-xs font-medium text-red-300 bg-red-500/10 hover:bg-red-500/20 px-3 py-2 rounded-xl border border-red-500/30 disabled:opacity-50 whitespace-nowrap">
                                    {bulkBusy?.kind === 'discard'
                                        ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Descartando {bulkBusy.done + 1}/{bulkBusy.total}…</>
                                        : <><XCircle className="w-3.5 h-3.5" /> Descartar todas ({pendingInFilter})</>}
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl overflow-hidden backdrop-blur-sm">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-neutral-900/50 text-neutral-400 uppercase text-xs font-semibold tracking-wider">
                                <tr>
                                    <th className="px-6 py-4">Fuente</th>
                                    <th className="px-6 py-4">Proveedor</th>
                                    <th className="px-6 py-4">RFC</th>
                                    <th className="px-6 py-4">Folio</th>
                                    <th className="px-6 py-4">Fecha Factura</th>
                                    <th className="px-6 py-4">Subtotal</th>
                                    <th className="px-6 py-4">IVA</th>
                                    <th className="px-6 py-4">Total</th>
                                    <th className="px-6 py-4">Adjuntos</th>
                                    <th className="px-6 py-4">Correo</th>
                                    <th className="px-6 py-4 text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-700/50">
                                {loading ? (
                                    <tr><td colSpan={11} className="px-6 py-12 text-center text-neutral-400"><RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-orange-500" />Cargando...</td></tr>
                                ) : filteredRows.length === 0 ? (
                                    <tr><td colSpan={11} className="px-6 py-12 text-center text-neutral-400">
                                        <div className="bg-neutral-800/50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border border-neutral-700"><Inbox className="w-8 h-8 text-neutral-500" /></div>
                                        {search ? (
                                            <>
                                                <p className="text-lg text-neutral-300 font-medium">Sin coincidencias para "{search}"</p>
                                                <p className="text-sm mt-1">Prueba con otro término o limpia la búsqueda.</p>
                                            </>
                                        ) : (
                                            <>
                                                <p className="text-lg text-neutral-300 font-medium">Nada en "{STATUS_FILTERS.find(s=>s.key===filter)?.label}"</p>
                                                <p className="text-sm mt-1">Conecta Gmail en Configuración y corre el backfill para empezar.</p>
                                            </>
                                        )}
                                    </td></tr>
                                ) : (
                                    filteredRows.map(r => (
                                        <tr key={r.id} className="hover:bg-neutral-800/80 transition-colors align-top">
                                            <td className="px-6 py-4">
                                                {r.detected_source === 'cfdi' ? (
                                                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-md border border-emerald-500/20">
                                                        <FileCode className="w-3 h-3" /> CFDI
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 text-xs font-medium text-orange-400 bg-orange-500/10 px-2 py-1 rounded-md border border-orange-500/20">
                                                        <Sparkles className="w-3 h-3" /> IA
                                                        {r.classification_confidence != null && (
                                                            <span className="text-orange-300/70">{Math.round(r.classification_confidence * 100)}%</span>
                                                        )}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-neutral-200 font-medium max-w-[200px] truncate">{r.supplier_name || '—'}</td>
                                            <td className="px-6 py-4 font-mono text-xs text-neutral-400">{r.supplier_rfc || '—'}</td>
                                            <td className="px-6 py-4 text-neutral-400">{r.invoice_folio || '—'}</td>
                                            <td className="px-6 py-4 text-neutral-400">{r.invoice_date ? new Date(r.invoice_date).toLocaleDateString() : '—'}</td>
                                            <td className="px-6 py-4 text-neutral-400">{fmt(r.subtotal)}</td>
                                            <td className="px-6 py-4 text-neutral-400">{fmt(r.vat_total)}</td>
                                            <td className="px-6 py-4 font-medium text-emerald-400">{fmt(r.total)}</td>
                                            <td className="px-6 py-4 space-x-1">
                                                {r.pdf_url && <a href={r.pdf_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300 bg-orange-500/10 px-2 py-1 rounded-md border border-orange-500/20"><FileText className="w-3 h-3" /> PDF</a>}
                                                {r.xml_url && <a href={r.xml_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 px-2 py-1 rounded-md border border-emerald-500/20"><FileCode className="w-3 h-3" /> XML</a>}
                                            </td>
                                            <td className="px-6 py-4 text-neutral-500 text-xs max-w-[260px]">
                                                <div className="truncate">{r.email_subject}</div>
                                                <div className="truncate text-neutral-600">{r.email_from}</div>
                                            </td>
                                            <td className="px-6 py-4 text-right space-x-2">
                                                {r.status === 'pending' ? (
                                                    <>
                                                        <button onClick={() => approve(r.id)} disabled={busyId === r.id}
                                                            className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 px-3 py-1.5 rounded-lg border border-emerald-500/20 disabled:opacity-50">
                                                            {busyId === r.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />} Aprobar
                                                        </button>
                                                        <button onClick={() => discard(r.id)} disabled={busyId === r.id}
                                                            className="inline-flex items-center gap-1.5 text-xs font-medium text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 px-3 py-1.5 rounded-lg border border-red-500/20 disabled:opacity-50">
                                                            <X className="w-3.5 h-3.5" /> Descartar
                                                        </button>
                                                    </>
                                                ) : r.status === 'approved' && r.purchase_order_id ? (
                                                    <Link href="/purchases" className="inline-flex items-center gap-1.5 text-xs font-medium text-orange-400 hover:text-orange-300 bg-orange-500/10 px-3 py-1.5 rounded-lg border border-orange-500/20">
                                                        Ver en Compras
                                                    </Link>
                                                ) : r.status === 'duplicate' ? (
                                                    r.duplicate_po_number ? (
                                                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 bg-amber-500/10 px-2.5 py-1.5 rounded-lg border border-amber-500/30">
                                                            <Link2 className="w-3.5 h-3.5" /> Factura igual a {r.duplicate_po_number}
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 bg-amber-500/10 px-2.5 py-1.5 rounded-lg border border-amber-500/30">
                                                            <AlertCircle className="w-3.5 h-3.5" /> Factura ya registrada
                                                        </span>
                                                    )
                                                ) : (
                                                    <span className="text-xs text-neutral-500">—</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
