"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, Inbox, RefreshCw, CheckCircle, X, FileText, FileCode, AlertCircle, Sparkles, Filter } from "lucide-react";
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
    const [busyId, setBusyId] = useState<string | null>(null);
    const [msg, setMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    const fetchRows = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('invoice_inbox')
                .select('*')
                .eq('status', filter)
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

    const fmt = (n: number | null) => n == null ? '—' : `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;

    return (
        <div className="min-h-screen bg-[#0B1120] text-slate-200 p-6 md:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-7xl mx-auto space-y-8">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-slate-800/40 p-6 rounded-3xl border border-slate-700/50 backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                        <Link href="/purchases" className="p-3 bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors text-slate-400 hover:text-white border border-slate-700"><ArrowLeft className="w-5 h-5" /></Link>
                        <div>
                            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                                <Inbox className="w-8 h-8 text-violet-400" />
                                Bandeja IA · Facturas detectadas
                            </h1>
                            <p className="text-slate-400 text-sm mt-1">Revisa las facturas que la IA detectó en tu correo y apruébalas para registrarlas en Compras.</p>
                        </div>
                    </div>
                    <button onClick={fetchRows} className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium" disabled={loading}>
                        <RefreshCw className={cn("w-4 h-4", loading && "animate-spin text-violet-400")} /> Refresh
                    </button>
                </header>

                {msg && (
                    <div className={cn(
                        "p-4 rounded-xl border flex items-center gap-3",
                        msg.type === 'error' ? "bg-red-500/10 border-red-500/30 text-red-400" : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                    )}>
                        {msg.type === 'error' ? <AlertCircle className="w-5 h-5 flex-shrink-0" /> : <CheckCircle className="w-5 h-5 flex-shrink-0" />}
                        {msg.text}
                    </div>
                )}

                <div className="flex items-center gap-2 flex-wrap">
                    <Filter className="w-4 h-4 text-slate-500" />
                    {STATUS_FILTERS.map(f => (
                        <button key={f.key} onClick={() => setFilter(f.key)}
                            className={cn(
                                "px-4 py-2 rounded-xl text-sm font-medium transition-all border",
                                filter === f.key
                                    ? "bg-violet-500/20 border-violet-500/40 text-violet-300"
                                    : "bg-slate-800/40 border-slate-700/50 text-slate-400 hover:text-white hover:bg-slate-700/50"
                            )}>
                            {f.label}
                        </button>
                    ))}
                </div>

                <div className="bg-slate-800/40 border border-slate-700/50 rounded-3xl overflow-hidden backdrop-blur-sm">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-slate-900/50 text-slate-400 uppercase text-xs font-semibold tracking-wider">
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
                            <tbody className="divide-y divide-slate-700/50">
                                {loading ? (
                                    <tr><td colSpan={11} className="px-6 py-12 text-center text-slate-400"><RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-violet-500" />Cargando...</td></tr>
                                ) : rows.length === 0 ? (
                                    <tr><td colSpan={11} className="px-6 py-12 text-center text-slate-400">
                                        <div className="bg-slate-800/50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-700"><Inbox className="w-8 h-8 text-slate-500" /></div>
                                        <p className="text-lg text-slate-300 font-medium">Nada en "{STATUS_FILTERS.find(s=>s.key===filter)?.label}"</p>
                                        <p className="text-sm mt-1">Conecta Gmail en Configuración y corre el backfill para empezar.</p>
                                    </td></tr>
                                ) : (
                                    rows.map(r => (
                                        <tr key={r.id} className="hover:bg-slate-800/80 transition-colors align-top">
                                            <td className="px-6 py-4">
                                                {r.detected_source === 'cfdi' ? (
                                                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-md border border-emerald-500/20">
                                                        <FileCode className="w-3 h-3" /> CFDI
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 text-xs font-medium text-violet-400 bg-violet-500/10 px-2 py-1 rounded-md border border-violet-500/20">
                                                        <Sparkles className="w-3 h-3" /> IA
                                                        {r.classification_confidence != null && (
                                                            <span className="text-violet-300/70">{Math.round(r.classification_confidence * 100)}%</span>
                                                        )}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-slate-200 font-medium max-w-[200px] truncate">{r.supplier_name || '—'}</td>
                                            <td className="px-6 py-4 font-mono text-xs text-slate-400">{r.supplier_rfc || '—'}</td>
                                            <td className="px-6 py-4 text-slate-400">{r.invoice_folio || '—'}</td>
                                            <td className="px-6 py-4 text-slate-400">{r.invoice_date ? new Date(r.invoice_date).toLocaleDateString() : '—'}</td>
                                            <td className="px-6 py-4 text-slate-400">{fmt(r.subtotal)}</td>
                                            <td className="px-6 py-4 text-slate-400">{fmt(r.vat_total)}</td>
                                            <td className="px-6 py-4 font-medium text-emerald-400">{fmt(r.total)}</td>
                                            <td className="px-6 py-4 space-x-1">
                                                {r.pdf_url && <a href={r.pdf_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 bg-cyan-500/10 px-2 py-1 rounded-md border border-cyan-500/20"><FileText className="w-3 h-3" /> PDF</a>}
                                                {r.xml_url && <a href={r.xml_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 px-2 py-1 rounded-md border border-emerald-500/20"><FileCode className="w-3 h-3" /> XML</a>}
                                            </td>
                                            <td className="px-6 py-4 text-slate-500 text-xs max-w-[260px]">
                                                <div className="truncate">{r.email_subject}</div>
                                                <div className="truncate text-slate-600">{r.email_from}</div>
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
                                                    <Link href="/purchases" className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-400 hover:text-violet-300 bg-violet-500/10 px-3 py-1.5 rounded-lg border border-violet-500/20">
                                                        Ver en Compras
                                                    </Link>
                                                ) : r.status === 'duplicate' ? (
                                                    <span className="text-xs text-amber-400">UUID ya registrado</span>
                                                ) : (
                                                    <span className="text-xs text-slate-500">—</span>
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
