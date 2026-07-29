"use client";

import { useState, useMemo, useEffect } from "react";
import {
    Wallet, Send, Download, CheckCircle, AlertCircle, FileText, Calendar,
    Building2, Hash, MapPin, Mail, Phone, ArrowLeft, Receipt, History
} from "lucide-react";
import { generateARStatementPDF } from "@/lib/generateArStatementPdf";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

const fmtMoney = (n: number | null | undefined) =>
    `$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (iso: string | null) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch { return iso; }
};

const METHOD_LABELS: Record<string, string> = {
    transfer: 'Transferencia',
    cash: 'Efectivo',
    check: 'Cheque',
    card: 'Tarjeta',
    other: 'Otro',
};

export default function PublicView({ data, error }: { data: any; error: string | null }) {
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [amounts, setAmounts] = useState<Record<string, string>>({});
    const [clientNotes, setClientNotes] = useState('');
    const [expectedDate, setExpectedDate] = useState('');
    const [busy, setBusy] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    useEffect(() => {
        if (data?.invoices) {
            // Por defecto, todas seleccionadas
            setSelected(new Set(data.invoices.map((i: any) => i.id)));
        }
    }, [data?.invoices]);

    const totals = useMemo(() => {
        if (!data?.invoices) return { gross: 0, vat: 0, net: 0, count: 0 };
        let gross = 0, vat = 0, net = 0, count = 0;
        for (const inv of data.invoices) {
            if (selected.has(inv.id)) {
                const commitAmount = Number(amounts[inv.id] || inv.balance);
                const ratio = Number(inv.balance) > 0 ? commitAmount / Number(inv.balance) : 1;
                gross += Number(inv.gross_amount) * ratio;
                vat += Number(inv.vat_amount) * ratio;
                net += commitAmount;
                count += 1;
            }
        }
        return { gross, vat, net, count };
    }, [data?.invoices, selected, amounts]);

    const toggleAll = (on: boolean) => {
        if (on) {
            setSelected(new Set(data.invoices.map((i: any) => i.id)));
            // Limpiar amounts parciales
            const reset: Record<string, string> = {};
            setAmounts(reset);
        } else {
            setSelected(new Set());
        }
    };

    const toggleOne = (id: string) => {
        const next = new Set(selected);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelected(next);
    };

    const setPartial = (id: string, balance: number, val: string) => {
        const num = Math.min(Number(val) || 0, balance);
        setAmounts({ ...amounts, [id]: String(num) });
        if (num > 0) {
            const next = new Set(selected);
            next.add(id);
            setSelected(next);
        }
    };

    const handleSubmit = async () => {
        if (selected.size === 0) {
            setSubmitError('Selecciona al menos una factura.');
            return;
        }
        setBusy(true);
        setSubmitError(null);
        try {
            const selected_invoices = Array.from(selected).map((id) => {
                const inv = data.invoices.find((i: any) => i.id === id);
                const amount = Number(amounts[id] || inv.balance);
                return { invoice_id: id, amount_committed: amount };
            });
            const res = await fetch('/api/ar/promise', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token: data.token,
                    selected_invoices,
                    client_notes: clientNotes.trim() || null,
                    expected_payment_date: expectedDate || null,
                }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Error al enviar la promesa.');
            setSubmitted(true);
        } catch (e: any) {
            setSubmitError(e.message);
        } finally {
            setBusy(false);
        }
    };

    const handleDownloadPDF = () => {
        const list = data.invoices.filter((i: any) => selected.has(i.id));
        if (list.length === 0) {
            alert('Selecciona al menos una factura para descargar.');
            return;
        }
        generateARStatementPDF({
            title: 'Estado de Cuenta',
            issue_date: new Date().toISOString().slice(0, 10),
            client: {
                business_name: data.client.business_name,
                rfc: data.client.rfc,
                email: data.client.email,
                phone: data.client.phone,
                address: data.client.address,
                fiscal_zip_code: data.client.fiscal_zip_code,
            },
            company: { business_name: 'SMAA Manufactura' },
            invoices: list.map((i: any) => ({
                id: i.id,
                invoice_number: i.invoice_number,
                concept: i.concept,
                work_date: null,
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

    if (error) {
        return (
            <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 flex items-center justify-center p-6 font-[family-name:var(--font-sans)]">
                <div className="max-w-md text-center">
                    <AlertCircle className="w-16 h-16 mx-auto mb-4 text-rose-400" />
                    <h1 className="text-2xl font-bold text-white mb-2">Link no disponible</h1>
                    <p className="text-neutral-400">{error}</p>
                    <p className="text-xs text-neutral-600 mt-4">Si crees que es un error, contacta al equipo que te envió este link.</p>
                </div>
            </div>
        );
    }

    if (submitted) {
        return (
            <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 flex items-center justify-center p-6 font-[family-name:var(--font-sans)]">
                <div className="max-w-md text-center">
                    <CheckCircle className="w-16 h-16 mx-auto mb-4 text-emerald-400" />
                    <h1 className="text-2xl font-bold text-white mb-2">¡Promesa enviada!</h1>
                    <p className="text-neutral-400 mb-6">
                        Tu promesa de pago por <strong className="text-amber-300">{fmtMoney(totals.net)}</strong> fue registrada. El equipo de SMAA la revisará y se pondrá en contacto contigo.
                    </p>
                    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 text-sm text-emerald-200">
                        Comprometiste pagar <strong>{totals.count}</strong> {totals.count === 1 ? 'factura' : 'facturas'} por un total de <strong>{fmtMoney(totals.net)}</strong>.
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-3 sm:p-6 md:p-8 lg:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-[1100px] mx-auto space-y-6">
                {/* Header empresa */}
                <header className="bg-gradient-to-br from-neutral-800/80 to-neutral-900/60 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <div className="flex items-center justify-between flex-wrap gap-4">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-500 to-cyan-700 flex items-center justify-center">
                                <Building2 className="w-6 h-6 text-white" />
                            </div>
                            <div>
                                <h1 className="text-xl font-bold text-white">SMAA Manufactura</h1>
                                <p className="text-neutral-400 text-xs">Estado de cuenta</p>
                            </div>
                        </div>
                        <button onClick={handleDownloadPDF} className="text-xs text-amber-300 hover:text-white bg-amber-500/10 hover:bg-amber-500/20 px-3 py-2 rounded-lg border border-amber-500/20 inline-flex items-center gap-1.5">
                            <Download className="w-3.5 h-3.5" /> Descargar PDF
                        </button>
                    </div>
                </header>

                {/* Datos del cliente */}
                <section className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl p-6">
                    <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-3">Tu información</h2>
                    <p className="text-xl font-bold text-white mb-2">{data.client.business_name}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-neutral-400">
                        {data.client.rfc && <div className="flex items-center gap-1.5"><Hash className="w-3 h-3" /> {data.client.rfc}</div>}
                        {data.client.email && <div className="flex items-center gap-1.5"><Mail className="w-3 h-3" /> {data.client.email}</div>}
                        {data.client.phone && <div className="flex items-center gap-1.5"><Phone className="w-3 h-3" /> {data.client.phone}</div>}
                        {data.client.address && <div className="flex items-center gap-1.5 sm:col-span-2"><MapPin className="w-3 h-3" /> {data.client.address}</div>}
                    </div>
                </section>

                {/* Resumen en vivo (sticky-ish) */}
                <section className="bg-gradient-to-br from-cyan-500/10 to-cyan-600/5 border border-cyan-500/30 rounded-3xl p-5 sticky top-3 z-10 backdrop-blur-md">
                    <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
                        <h3 className="text-sm font-bold text-cyan-200 uppercase tracking-wider">Tu selección</h3>
                        <span className="text-xs text-cyan-300">{totals.count} de {data.invoices.length} facturas</span>
                    </div>
                    <div className="grid grid-cols-3 gap-3 text-center">
                        <div>
                            <p className="text-[10px] uppercase tracking-wider text-cyan-300/70">Subtotal</p>
                            <p className="text-lg font-bold font-mono text-white">{fmtMoney(totals.gross)}</p>
                        </div>
                        <div>
                            <p className="text-[10px] uppercase tracking-wider text-cyan-300/70">IVA 16%</p>
                            <p className="text-lg font-bold font-mono text-white">{fmtMoney(totals.vat)}</p>
                        </div>
                        <div>
                            <p className="text-[10px] uppercase tracking-wider text-cyan-300/70">Total</p>
                            <p className="text-2xl font-bold font-mono text-amber-300">{fmtMoney(totals.net)}</p>
                        </div>
                    </div>
                </section>

                {/* Tabla de facturas pendientes */}
                <section className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl overflow-hidden">
                    <div className="p-5 border-b border-neutral-700/50 bg-neutral-800/20 flex items-center justify-between">
                        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                            <Receipt className="w-5 h-5 text-amber-400" /> Facturas pendientes
                        </h2>
                        <div className="flex items-center gap-2 text-xs">
                            <button onClick={() => toggleAll(true)} className="text-cyan-300 hover:text-white">Todas</button>
                            <span className="text-neutral-600">/</span>
                            <button onClick={() => toggleAll(false)} className="text-neutral-400 hover:text-white">Ninguna</button>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-neutral-900/50 text-[10px] uppercase tracking-wider text-neutral-400">
                                <tr>
                                    <th className="p-3 w-10"></th>
                                    <th className="text-left p-3"># / Concepto</th>
                                    <th className="text-left p-3">F. Factura</th>
                                    <th className="text-right p-3">Subtotal</th>
                                    <th className="text-right p-3">IVA</th>
                                    <th className="text-right p-3">Total</th>
                                    <th className="text-right p-3">Saldo</th>
                                    <th className="text-right p-3">A pagar</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.invoices.length === 0 ? (
                                    <tr><td colSpan={8} className="p-10 text-center text-neutral-500">
                                        <CheckCircle className="w-12 h-12 mx-auto mb-3 text-emerald-500" />
                                        <p>¡No tienes facturas pendientes!</p>
                                    </td></tr>
                                ) : data.invoices.map((inv: any) => {
                                    const isSel = selected.has(inv.id);
                                    const partialAmt = amounts[inv.id];
                                    return (
                                        <tr key={inv.id} className={cn("border-t border-neutral-800/60 transition-colors", isSel ? "bg-cyan-500/5 hover:bg-cyan-500/10" : "hover:bg-neutral-800/40")}>
                                            <td className="p-3 text-center">
                                                <input
                                                    type="checkbox"
                                                    checked={isSel}
                                                    onChange={() => toggleOne(inv.id)}
                                                    className="w-4 h-4 accent-cyan-500 cursor-pointer"
                                                />
                                            </td>
                                            <td className="p-3">
                                                <p className="text-white font-medium text-sm">{inv.invoice_number || "—"}</p>
                                                <p className="text-[11px] text-neutral-400 line-clamp-1">{inv.concept}</p>
                                            </td>
                                            <td className="p-3 text-neutral-300 text-xs">{fmtDate(inv.invoice_date)}</td>
                                            <td className="p-3 text-right text-neutral-200 font-mono text-xs">{fmtMoney(inv.gross_amount)}</td>
                                            <td className="p-3 text-right text-neutral-200 font-mono text-xs">{fmtMoney(inv.vat_amount)}</td>
                                            <td className="p-3 text-right text-white font-mono text-sm">{fmtMoney(inv.net_amount)}</td>
                                            <td className="p-3 text-right text-rose-300 font-mono font-semibold text-sm">{fmtMoney(inv.balance)}</td>
                                            <td className="p-3 text-right">
                                                <input
                                                    type="number"
                                                    inputMode="decimal"
                                                    step="0.01"
                                                    min={0}
                                                    max={Number(inv.balance)}
                                                    value={partialAmt !== undefined ? partialAmt : (isSel ? inv.balance : 0)}
                                                    onChange={(e) => setPartial(inv.id, Number(inv.balance), e.target.value)}
                                                    onFocus={() => {
                                                        if (!isSel) toggleOne(inv.id);
                                                        if (amounts[inv.id] === undefined) setAmounts({ ...amounts, [inv.id]: String(inv.balance) });
                                                    }}
                                                    disabled={!isSel}
                                                    placeholder="0.00"
                                                    className="w-28 bg-neutral-900/60 border border-neutral-700 rounded-lg px-2 py-1 text-sm text-white text-right focus:outline-none focus:border-cyan-500 disabled:opacity-30"
                                                />
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </section>

                {/* Historial de pagos */}
                {data.payments.length > 0 && (
                    <section className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl overflow-hidden">
                        <div className="p-5 border-b border-neutral-700/50 bg-neutral-800/20">
                            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                                <History className="w-5 h-5 text-emerald-400" /> Tu historial de pagos
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
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.payments.map((p: any) => (
                                        <tr key={p.id} className="border-t border-neutral-800/60">
                                            <td className="p-3 text-neutral-300 text-xs">{fmtDate(p.payment_date)}</td>
                                            <td className="p-3 text-xs">
                                                <span className="font-bold uppercase px-2 py-0.5 rounded bg-neutral-700/40 text-neutral-300 border border-neutral-700">
                                                    {METHOD_LABELS[p.payment_method] || p.payment_method}
                                                </span>
                                            </td>
                                            <td className="p-3 text-neutral-400 text-xs font-mono">{p.reference || "—"}</td>
                                            <td className="p-3 text-right text-emerald-300 font-mono font-semibold">{fmtMoney(p.amount)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </section>
                )}

                {/* Notas + promesa */}
                <section className="bg-gradient-to-br from-violet-500/10 to-cyan-500/5 border border-violet-500/30 rounded-3xl p-6">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-3">
                        <Send className="w-5 h-5 text-violet-300" /> Enviar promesa de pago
                    </h3>
                    <p className="text-sm text-neutral-300 mb-4">
                        Selecciona las facturas de arriba, agrega una fecha tentativa de pago y notas si lo necesitas. Al enviar, el equipo de SMAA recibirá tu compromiso y se pondrá en contacto.
                    </p>
                    <div className="space-y-3">
                        <div>
                            <label className="text-xs font-medium text-neutral-300">¿Cuándo planeas pagar?</label>
                            <input
                                type="date"
                                value={expectedDate}
                                onChange={(e) => setExpectedDate(e.target.value)}
                                className="w-full md:w-auto bg-neutral-900/50 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white mt-1 focus:outline-none focus:border-violet-500 [color-scheme:dark]"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-neutral-300">Notas (opcional)</label>
                            <textarea
                                value={clientNotes}
                                onChange={(e) => setClientNotes(e.target.value)}
                                rows={3}
                                placeholder="Ej. Pagaré la próxima quincena..."
                                className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white mt-1 focus:outline-none focus:border-violet-500"
                            />
                        </div>
                        {submitError && (
                            <div className="bg-rose-500/10 border border-rose-500/30 text-rose-200 text-sm rounded-xl p-3">{submitError}</div>
                        )}
                        <button
                            onClick={handleSubmit}
                            disabled={busy || selected.size === 0}
                            className="w-full md:w-auto px-8 py-3 bg-gradient-to-r from-violet-500 to-cyan-500 hover:from-violet-600 hover:to-cyan-600 text-white font-semibold rounded-xl disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                        >
                            {busy ? 'Enviando...' : (<><Send className="w-4 h-4" /> Enviar promesa ({fmtMoney(totals.net)})</>)}
                        </button>
                    </div>
                </section>

                <footer className="text-center text-xs text-neutral-600 py-4">
                    Estado de cuenta generado el {new Date().toLocaleString('es-MX')} — SMAA Manufactura
                </footer>
            </div>
        </div>
    );
}
