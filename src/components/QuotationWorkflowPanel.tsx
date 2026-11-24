"use client";

import { useCallback, useEffect, useState } from 'react';
import PriceTaxToggle from '@/components/PriceTaxToggle';
import { priceWithoutVat, priceLine } from '@/lib/pricing';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { partyLabel } from '@/lib/search';
import { addQuotationExtraAction, quotationToReceivableAction, type SaleOrigin } from '@/app/actions/quotationWorkflow';

const ORIGINS: { value: SaleOrigin; label: string; hint: string }[] = [
    { value: 'fabricacion', label: 'Trabajo fabricado', hint: 'Tiene (o tendrá) OT. Se puede cobrar antes de terminarla.' },
    { value: 'venta_directa', label: 'Venta directa', hint: 'Se compró y se entregó tal cual; no necesita OT.' },
    { value: 'trabajo_previo', label: 'Trabajo ya realizado', hint: 'Se hizo antes y apenas se da de alta; usa la fecha real de la venta.' },
];

function todayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(date: string, days: number) {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d + days).toLocaleDateString('es-MX', { dateStyle: 'medium' });
}

type Summary = { clientId: number; client: string; days: number; total: number; inManufacturing: boolean; arId?: string; arActive: boolean; extras: { id: string; description: string; extra_note: string | null }[] };
export default function QuotationWorkflowPanel({ quotationId, onChanged }: { quotationId: string; onChanged?: () => void }) {
    const [permissions, setPermissions] = useState<{ view: boolean; edit: boolean; createAR: boolean; viewAR: boolean } | null>(null);
    const [summary, setSummary] = useState<Summary | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [showExtra, setShowExtra] = useState(false);
    const [description, setDescription] = useState('');
    const [quantity, setQuantity] = useState('1');
    const [price, setPrice] = useState('');
    const [priceIncludesVat, setPriceIncludesVat] = useState(false);
    const [note, setNote] = useState('');
    const [showAR, setShowAR] = useState(false);
    const [origin, setOrigin] = useState<SaleOrigin>('fabricacion');
    const [saleDate, setSaleDate] = useState(todayIso());
    const [arNotes, setArNotes] = useState('');
    const load = useCallback(async () => {
        if (!permissions?.view) return;
        const [quote, orders, ar, extras] = await Promise.all([
            supabase.from('quotations').select('client_id,total,client:clients(name,business_name,payment_days)').eq('id', quotationId).single(),
            supabase.from('work_orders').select('status').eq('quotation_id', quotationId).neq('status', 'Cancelled'),
            permissions.viewAR || permissions.createAR ? supabase.from('ar_invoices').select('id,status,is_active').eq('quotation_id', quotationId).maybeSingle() : Promise.resolve({ data: null, error: null }),
            supabase.from('quotation_items').select('id,description,extra_note').eq('quotation_id', quotationId).eq('is_extra', true),
        ]);
        const failure = quote.error || orders.error || ar.error || extras.error;
        if (failure) throw new Error(failure.message);
        const client = Array.isArray(quote.data!.client) ? quote.data!.client[0] : quote.data!.client;
        setSummary({ clientId: quote.data!.client_id, client: partyLabel(client), days: client?.payment_days || 0,
            total: quote.data!.total, inManufacturing: !!orders.data?.length,
            arId: ar.data?.id, arActive: !ar.data || (ar.data.is_active && ar.data.status !== 'cancelled'), extras: extras.data || [] });
    }, [quotationId, permissions]);
    useEffect(() => {
        let cancelled = false;
        Promise.all(['/api/me/permissions?module=sales', '/api/me/permissions?module=finance&sub=receivable'].map(async url => {
            const response = await fetch(url);
            if (!response.ok) throw new Error('No se pudieron cargar tus permisos.');
            return response.json();
        })).then(([sales, finance]) => {
            if (!cancelled) setPermissions({ view: sales.permissions.can_view, edit: sales.permissions.can_edit, createAR: finance.permissions.can_create, viewAR: finance.permissions.can_view });
        }).catch(e => { if (!cancelled) setError(e.message); });
        return () => { cancelled = true; };
    }, []);
    useEffect(() => { load().catch(e => setError(e.message)); }, [load]);
    async function addExtra(e: React.FormEvent) {
        e.preventDefault(); setBusy(true); setError(''); setMessage('');
        try {
            await addQuotationExtraAction({ quotationId, description, quantity: Number(quantity), unitPrice: priceWithoutVat(Number(price), priceIncludesVat), note });
            setDescription(''); setQuantity('1'); setPrice(''); setPriceIncludesVat(false); setNote(''); setShowExtra(false);
            await load(); onChanged?.(); setMessage('Extra agregado. Se actualizaron los importes de la cotización y su cuenta por cobrar, si ya existe.');
        } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo agregar el extra.'); }
        finally { setBusy(false); }
    }
    function openAR() {
        setOrigin(summary?.inManufacturing ? 'fabricacion' : 'venta_directa');
        setSaleDate(todayIso());
        setArNotes('');
        setShowAR(true);
    }
    async function sendToAR(e: React.FormEvent) {
        e.preventDefault(); setBusy(true); setError(''); setMessage('');
        try {
            await quotationToReceivableAction(quotationId, { origin, invoiceDate: saleDate, notes: arNotes });
            setShowAR(false); await load(); onChanged?.();
            setMessage(origin === 'fabricacion' ? 'Cotización enviada a cuentas por cobrar. Las OT conservan su estado actual.' : 'Venta registrada en cuentas por cobrar.');
        }
        catch (e) { setError(e instanceof Error ? e.message : 'No se pudo enviar.'); }
        finally { setBusy(false); }
    }
    if (!permissions?.view) return null;
    return <section className="my-4 space-y-3 rounded-xl border border-neutral-700 bg-neutral-900/60 p-4">
        <h3 className="font-semibold text-white">Fabricación y cobro</h3>
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        {message && <p role="status" className="text-sm text-emerald-300">{message}</p>}
        {summary && <>
            <p className="text-sm text-neutral-300">Cliente: {summary.client} · Total: ${Number(summary.total).toLocaleString('es-MX', { minimumFractionDigits: 2 })} · Crédito: {summary.days} días</p>
            <div className="flex flex-wrap gap-3">
                {permissions.edit && summary.inManufacturing && summary.arActive && <button type="button" disabled={busy} onClick={() => setShowExtra(!showExtra)} className="rounded-lg border border-amber-500/40 px-3 py-2 text-sm text-amber-300">Agregar extra</button>}
                {summary.arId && permissions.viewAR ? <Link href={`/finance/receivable/${summary.clientId}`} className="rounded-lg border border-emerald-500/40 px-3 py-2 text-sm text-emerald-300">Ver cuenta por cobrar{!summary.arActive ? ' (inactiva)' : ''}</Link>
                    : permissions.createAR && !summary.arId && <button type="button" disabled={busy} onClick={() => (showAR ? setShowAR(false) : openAR())} className="rounded-lg border border-emerald-500/40 px-3 py-2 text-sm text-emerald-300 disabled:opacity-40">Enviar a cuentas por cobrar</button>}
            </div>
            {!summary.arId && !showAR && <p className="text-xs text-neutral-400">{summary.inManufacturing ? 'Puedes enviarla a cobro sin terminar ni liberar las OT.' : 'No necesita OT: sirve para ventas directas y para trabajos ya realizados.'} El vencimiento se calcula con los días de crédito del cliente.</p>}
            {showAR && !summary.arId && <form onSubmit={sendToAR} className="space-y-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                <div className="grid gap-2 sm:grid-cols-3">
                    {ORIGINS.map(option => <label key={option.value} className={`cursor-pointer rounded-lg border p-2 text-sm ${origin === option.value ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-200' : 'border-neutral-700 text-neutral-300'}`}>
                        <input type="radio" name="sale-origin" value={option.value} checked={origin === option.value} onChange={() => setOrigin(option.value)} className="sr-only" />
                        <span className="block font-semibold">{option.label}</span>
                        <span className="block text-xs text-neutral-400">{option.hint}</span>
                    </label>)}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm text-neutral-300">Fecha de venta<input type="date" required max={todayIso()} value={saleDate} onChange={e => setSaleDate(e.target.value)} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800 p-2 text-white" /></label>
                    <p className="self-end text-xs text-neutral-400">Vence el {saleDate ? addDays(saleDate, summary.days) : '—'} ({summary.days} días de crédito).</p>
                </div>
                <label className="block text-sm text-neutral-300">Notas (opcional)<input value={arNotes} onChange={e => setArNotes(e.target.value)} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800 p-2 text-white" placeholder="Ej. factura A-123, entregado el lunes" /></label>
                <div className="flex gap-2">
                    <button disabled={busy || !saleDate} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? 'Enviando…' : 'Confirmar envío a cobro'}</button>
                    <button type="button" onClick={() => setShowAR(false)} className="rounded-lg border border-neutral-600 px-3 py-2 text-sm text-neutral-200">Cancelar</button>
                </div>
            </form>}
            {summary.extras.map(extra => <p key={extra.id} className="text-sm text-amber-200">{extra.description}{extra.extra_note && ` — ${extra.extra_note}`}</p>)}
            {showExtra && <form onSubmit={addExtra} className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm text-neutral-300 sm:col-span-2">Descripción del extra<input required value={description} onChange={e => setDescription(e.target.value)} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800 p-2 text-white" /></label>
                <label className="text-sm text-neutral-300">Cantidad<input required type="number" min="0.01" step="0.01" value={quantity} onChange={e => setQuantity(e.target.value)} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800 p-2 text-white" /></label>
                <label className="text-sm text-neutral-300">Precio unitario de venta<input required type="number" min="0" step="0.01" value={price} onChange={e => setPrice(e.target.value)} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800 p-2 text-white" /></label>
                <div className="space-y-2"><PriceTaxToggle includesVat={priceIncludesVat} onChange={setPriceIncludesVat} />
                    <p className="text-xs text-neutral-400">Subtotal sin IVA: ${priceLine({ quantity: Number(quantity), unit_price: Number(price), price_includes_vat: priceIncludesVat }).subtotal.toFixed(2)}</p>
                </div>
                <label className="text-sm text-neutral-300 sm:col-span-2">Nota del extra<textarea value={note} onChange={e => setNote(e.target.value)} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800 p-2 text-white" /></label>
                <p className="text-xs text-neutral-400 sm:col-span-2">Se agrega como una partida “Extra”, con subtotal e IVA del 16% separados. Si ya existe una cuenta por cobrar, su importe también se actualiza.</p>
                <button disabled={busy} className="rounded-lg bg-amber-600 px-3 py-2 text-white disabled:opacity-40">{busy ? 'Guardando…' : 'Guardar extra'}</button>
            </form>}
        </>}
    </section>;
}
