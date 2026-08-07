"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { updatePurchaseOrderAction, deletePurchaseOrderAction, addPurchaseAttachmentAction, deletePurchaseAttachmentAction } from "@/app/actions/purchases";
import { ArrowLeft, Save, Trash2, Loader2, AlertCircle, CheckCircle2, ExternalLink, Plus, ShoppingCart, Truck, Calendar, FileText, Receipt, FileCheck, Paperclip, X, Upload, Layers, Camera, FilePlus } from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

type PO = {
    id: string;
    po_number: string;
    status: string;
    subtotal: number;
    vat_total: number;
    total: number;
    supplier_id: string | null;
    supplier_quote_url: string | null;
    invoice_url: string | null;
    evidence_photo_url: string | null;
    invoice_date: string | null;
    notes: string | null;
    requisition_id: string | null;
    created_at: string;
    updated_at: string;
    supplier: { id: string; business_name: string; rfc: string } | null;
};

type Item = {
    id: string;
    description: string;
    quantity: number;
    unit_price: number;
    line_total: number;
};

const STATUS_OPTIONS = [
    { value: "Draft", label: "Draft", color: "bg-neutral-500/20 text-neutral-300 border-neutral-500/30" },
    { value: "Sent", label: "Sent", color: "bg-orange-500/20 text-orange-300 border-orange-500/30" },
    { value: "Approved", label: "Approved", color: "bg-amber-500/20 text-amber-300 border-amber-500/30" },
    { value: "Received", label: "Received", color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
] as const;

type StatusValue = (typeof STATUS_OPTIONS)[number]['value'];

export default function PurchaseOrderEditClient({
    po,
    items: initialItems,
    suppliers,
    canEdit,
    canDelete,
    currentUser,
}: {
    po: PO;
    items: Item[];
    suppliers: { id: string; business_name: string; rfc: string; is_active?: boolean }[];
    canEdit: boolean;
    canDelete: boolean;
    currentUser: { id: string; fullName: string; role: string };
}) {
    const router = useRouter();

    const [supplierId, setSupplierId] = useState<string>(po.supplier_id || "");
    const [status, setStatus] = useState<StatusValue>(po.status as StatusValue);
    const [notes, setNotes] = useState<string>(po.notes || "");
    const [items, setItems] = useState<Item[]>(initialItems.length > 0 ? initialItems : [{ id: "_new", description: "", quantity: 1, unit_price: 0, line_total: 0 }]);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [msg, setMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    // Adjuntos múltiples (facturas, evidencia)
    type Attachment = { id: string; kind: 'invoice' | 'evidence' | 'other'; file_url: string; file_name: string; content_type: string | null; uploaded_at: string };
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [loadingAttachments, setLoadingAttachments] = useState(true);
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const [pendingKind, setPendingKind] = useState<'invoice' | 'evidence' | 'other'>('invoice');
    const [uploadingAtt, setUploadingAtt] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const loadAttachments = async () => {
        setLoadingAttachments(true);
        const { data, error } = await supabase
            .from('purchase_order_attachments')
            .select('id, kind, file_url, file_name, content_type, uploaded_at')
            .eq('purchase_order_id', po.id)
            .order('uploaded_at', { ascending: true });
        if (error) {
            console.warn('No se pudieron cargar adjuntos:', error);
            setAttachments([]);
        } else {
            setAttachments((data || []) as any);
        }
        setLoadingAttachments(false);
    };

    useEffect(() => { loadAttachments(); }, [po.id]);

    const handleUploadAttachments = async () => {
        if (pendingFiles.length === 0) return;
        setUploadingAtt(true);
        try {
            const toBase64 = (file: File): Promise<string> =>
                new Promise((res, rej) => {
                    const reader = new FileReader();
                    reader.onload = () => res(String(reader.result || "").split(",")[1] || "");
                    reader.onerror = rej;
                    reader.readAsDataURL(file);
                });
            const files = await Promise.all(pendingFiles.map(async (f) => ({
                base64: await toBase64(f),
                fileName: f.name,
                contentType: f.type || "application/octet-stream",
            })));
            await addPurchaseAttachmentAction(po.id, files, pendingKind);
            setPendingFiles([]);
            await loadAttachments();
        } catch (e: any) {
            setMsg({ type: 'error', text: e.message || "Error al subir adjuntos." });
        } finally {
            setUploadingAtt(false);
        }
    };

    const handleDeleteAttachment = async (id: string) => {
        if (!confirm("¿Eliminar este adjunto?")) return;
        try {
            await deletePurchaseAttachmentAction(id);
            await loadAttachments();
        } catch (e: any) {
            setMsg({ type: 'error', text: e.message || "Error al eliminar." });
        }
    };

    const invoiceCount = attachments.filter((a) => a.kind === 'invoice').length;
    const evidenceCount = attachments.filter((a) => a.kind === 'evidence').length;
    const otherCount = attachments.filter((a) => a.kind === 'other').length;

    // Recalcular totales cuando cambian items
    const subtotal = items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0);
    const vatTotal = subtotal * 0.16;
    const total = subtotal + vatTotal;

    const updateItem = (idx: number, patch: Partial<Item>) => {
        setItems((prev) => prev.map((it, i) => {
            if (i !== idx) return it;
            const merged = { ...it, ...patch };
            merged.line_total = (Number(merged.quantity) || 0) * (Number(merged.unit_price) || 0);
            return merged;
        }));
    };

    const removeItem = (idx: number) => {
        setItems((prev) => prev.filter((_, i) => i !== idx));
    };

    const addItem = () => {
        setItems((prev) => [...prev, { id: "_new_" + Date.now(), description: "", quantity: 1, unit_price: 0, line_total: 0 }]);
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canEdit) {
            setMsg({ type: 'error', text: "No tienes permisos para editar esta orden." });
            return;
        }
        if (!supplierId) {
            setMsg({ type: 'error', text: "Selecciona un proveedor." });
            return;
        }
        const cleanItems = items.filter((it) => it.description.trim());
        if (cleanItems.length === 0) {
            setMsg({ type: 'error', text: "Agrega al menos un artículo con descripción." });
            return;
        }
        setSaving(true);
        setMsg(null);
        try {
            // Llama al server action con permission gate (edit)
            await updatePurchaseOrderAction({
                id: po.id,
                supplier_id: supplierId,
                status,
                notes,
                items: cleanItems.map((it) => ({
                    description: it.description.trim(),
                    quantity: Number(it.quantity) || 0,
                    unit_price: Number(it.unit_price) || 0,
                    line_total: (Number(it.quantity) || 0) * (Number(it.unit_price) || 0),
                })),
            });
            setMsg({ type: 'success', text: "Orden actualizada." });
            router.refresh();
        } catch (ex: any) {
            setMsg({ type: 'error', text: ex.message || "Error al guardar." });
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!canDelete) return;
        if (!confirm(`¿Eliminar la orden ${po.po_number}? Esta acción no se puede deshacer.`)) return;
        setDeleting(true);
        setMsg(null);
        try {
            // Llama al server action con permission gate (delete)
            await deletePurchaseOrderAction(po.id);
            router.push('/purchases');
        } catch (ex: any) {
            setMsg({ type: 'error', text: ex.message || "Error al eliminar." });
            setDeleting(false);
        }
    };

    const statusStyle = STATUS_OPTIONS.find(s => s.value === status)?.color || STATUS_OPTIONS[0].color;

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-3 sm:p-6 md:p-8 lg:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-5xl mx-auto space-y-6">
                <header className="flex items-center justify-between gap-4 bg-neutral-800/40 p-5 rounded-2xl border border-neutral-700/50 flex-wrap">
                    <div className="flex items-center gap-3">
                        <Link href="/purchases" className="p-2.5 bg-neutral-800 hover:bg-neutral-700 rounded-xl border border-neutral-700">
                            <ArrowLeft className="w-4 h-4" />
                        </Link>
                        <div>
                            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                                <ShoppingCart className="w-6 h-6 text-orange-400" />
                                <span className="font-mono">{po.po_number}</span>
                                <span className={cn("text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border", statusStyle)}>
                                    {status}
                                </span>
                            </h1>
                            <p className="text-xs text-neutral-400 mt-0.5">
                                Creada {new Date(po.created_at).toLocaleDateString('es-MX', { dateStyle: 'medium' })}
                                {po.requisition_id && (
                                    <span className="ml-2">
                                        · Origen: <Link href={`/requisitions/${po.requisition_id}`} className="text-orange-300 hover:text-orange-200">requisición</Link>
                                    </span>
                                )}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {canEdit && (
                            <button
                                type="submit"
                                form="po-form"
                                disabled={saving}
                                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white text-sm font-semibold disabled:opacity-50"
                            >
                                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                Guardar
                            </button>
                        )}
                        {canDelete && (
                            <button
                                type="button"
                                onClick={handleDelete}
                                disabled={deleting}
                                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-sm font-medium disabled:opacity-50"
                                title="Eliminar"
                            >
                                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                            </button>
                        )}
                    </div>
                </header>

                {msg && (
                    <div className={cn(
                        "p-4 rounded-xl border flex items-center gap-3",
                        msg.type === 'success' ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" : "bg-rose-500/10 border-rose-500/30 text-rose-300"
                    )}>
                        {msg.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                        {msg.text}
                    </div>
                )}

                {!canEdit && (
                    <div className="p-3 rounded-xl border bg-amber-500/10 border-amber-500/30 text-amber-200 text-sm flex items-center gap-2">
                        <AlertCircle className="w-4 h-4" />
                        Estás viendo esta orden en modo solo lectura. Pide al admin que te asigne el permiso <code className="font-mono">purchases:edit</code> para modificarla.
                    </div>
                )}

                <form id="po-form" onSubmit={handleSave} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-4">
                            <label className="block text-[11px] font-bold text-neutral-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                                <Truck className="w-3 h-3" /> Proveedor *
                            </label>
                            {po.supplier_id === null && !supplierId && (
                                <p className="text-[11px] text-amber-300 mb-2">⚠️ Esta orden fue creada sin proveedor. Asígnale uno antes de procesarla.</p>
                            )}
                            <select
                                value={supplierId}
                                onChange={(e) => setSupplierId(e.target.value)}
                                disabled={!canEdit}
                                className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500 disabled:opacity-60"
                            >
                                <option value="">— Seleccionar proveedor —</option>
                                {suppliers.map(s => (
                                    <option key={s.id} value={s.id} className={s.is_active === false ? "text-neutral-500 line-through" : undefined}>
                                        {s.business_name} ({s.rfc}){s.is_active === false ? " — Obsoleto" : ""}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-4">
                            <label className="block text-[11px] font-bold text-neutral-500 uppercase tracking-wider mb-1.5">Status</label>
                            <select
                                value={status}
                                onChange={(e) => setStatus(e.target.value as StatusValue)}
                                disabled={!canEdit}
                                className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500 disabled:opacity-60"
                            >
                                {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                            </select>
                        </div>
                    </div>

                    {/* Evidencia adjunta (multi-archivo) */}
                    <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-4">
                        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                            <div>
                                <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                                    <Paperclip className="w-3.5 h-3.5" /> Archivos adjuntos
                                </p>
                                <div className="flex items-center gap-2 text-[11px] text-neutral-400">
                                    <span className="inline-flex items-center gap-1"><Receipt className="w-3 h-3 text-emerald-400" /> {invoiceCount} factura{invoiceCount === 1 ? "" : "s"}</span>
                                    <span className="text-neutral-700">·</span>
                                    <span className="inline-flex items-center gap-1"><Camera className="w-3 h-3 text-orange-400" /> {evidenceCount} foto{evidenceCount === 1 ? "" : "s"}</span>
                                    {otherCount > 0 && (
                                        <>
                                            <span className="text-neutral-700">·</span>
                                            <span className="inline-flex items-center gap-1"><FileText className="w-3 h-3 text-violet-400" /> {otherCount} otro{otherCount === 1 ? "" : "s"}</span>
                                        </>
                                    )}
                                </div>
                            </div>
                            {canEdit && (
                                <div className="flex items-center gap-2">
                                    <select
                                        value={pendingKind}
                                        onChange={(e) => setPendingKind(e.target.value as any)}
                                        className="text-xs bg-neutral-900/60 border border-neutral-700 rounded-lg px-2 py-1.5 text-neutral-200 focus:outline-none focus:border-orange-500"
                                    >
                                        <option value="invoice">Factura</option>
                                        <option value="evidence">Foto del material</option>
                                        <option value="other">Otro documento</option>
                                    </select>
                                    <button
                                        type="button"
                                        onClick={() => fileInputRef.current?.click()}
                                        className="inline-flex items-center gap-1.5 text-xs text-orange-300 hover:text-orange-200 bg-orange-500/10 hover:bg-orange-500/20 px-3 py-1.5 rounded-lg border border-orange-500/30"
                                    >
                                        <FilePlus className="w-3.5 h-3.5" /> Agregar archivo(s)
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Cotización del proveedor (de la requisición, no modificable aquí) */}
                        {po.supplier_quote_url && (
                            <div className="flex flex-wrap gap-2 mb-2">
                                <a href={po.supplier_quote_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs bg-neutral-900/60 hover:bg-neutral-800 border border-neutral-700 px-3 py-1.5 rounded-lg text-neutral-200">
                                    <FileText className="w-3.5 h-3.5 text-amber-400" /> Cotización del proveedor <ExternalLink className="w-3 h-3 text-neutral-500" />
                                </a>
                            </div>
                        )}

                        {/* Lista de adjuntos */}
                        {loadingAttachments ? (
                            <p className="text-[11px] text-neutral-500">Cargando adjuntos…</p>
                        ) : attachments.length === 0 ? (
                            <p className="text-[11px] text-neutral-500">
                                Sin adjuntos todavía. {canEdit ? 'Usa "Agregar archivo(s)" arriba.' : ''}
                            </p>
                        ) : (
                            <ul className="space-y-1.5">
                                {attachments.map((a) => {
                                    const kindStyle =
                                        a.kind === 'invoice'
                                            ? { Icon: Receipt, color: 'text-emerald-400', label: 'Factura' }
                                            : a.kind === 'evidence'
                                            ? { Icon: Camera, color: 'text-orange-400', label: 'Foto' }
                                            : { Icon: FileText, color: 'text-violet-400', label: 'Otro' };
                                    const { Icon, color, label } = kindStyle;
                                    return (
                                        <li
                                            key={a.id}
                                            className="flex items-center gap-2 bg-neutral-900/40 border border-neutral-700/50 rounded-lg px-3 py-2 text-sm"
                                        >
                                            <Icon className={cn("w-4 h-4 flex-shrink-0", color)} />
                                            <div className="flex-1 min-w-0">
                                                <a
                                                    href={a.file_url}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="text-neutral-200 hover:text-emerald-300 truncate block"
                                                >
                                                    {a.file_name}
                                                </a>
                                                <p className="text-[10px] text-neutral-500">
                                                    {label} · {new Date(a.uploaded_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: '2-digit' })}
                                                </p>
                                            </div>
                                            <a
                                                href={a.file_url}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="p-1.5 text-neutral-500 hover:text-emerald-300"
                                                title="Abrir"
                                            >
                                                <ExternalLink className="w-3.5 h-3.5" />
                                            </a>
                                            {canEdit && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleDeleteAttachment(a.id)}
                                                    className="p-1.5 text-neutral-500 hover:text-rose-300"
                                                    title="Eliminar"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}

                        {/* Drop zone / preview de archivos pendientes */}
                        {canEdit && pendingFiles.length > 0 && (
                            <div className="mt-3 p-3 bg-orange-500/5 border border-orange-500/20 rounded-lg">
                                <p className="text-[11px] text-neutral-300 mb-2">
                                    {pendingFiles.length} archivo{pendingFiles.length === 1 ? "" : "s"} listo{pendingFiles.length === 1 ? "" : "s"} para subir como <strong className="text-white">{pendingKind === 'invoice' ? 'Factura' : pendingKind === 'evidence' ? 'Foto' : 'Otro'}</strong>:
                                </p>
                                <ul className="space-y-1 mb-3">
                                    {pendingFiles.map((f, idx) => (
                                        <li key={idx} className="flex items-center gap-2 text-xs text-neutral-300">
                                            <FileText className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />
                                            <span className="truncate flex-1">{f.name}</span>
                                            <span className="text-neutral-500">{(f.size / 1024).toFixed(1)} KB</span>
                                            <button
                                                type="button"
                                                onClick={() => setPendingFiles((p) => p.filter((_, i) => i !== idx))}
                                                className="text-neutral-500 hover:text-rose-300"
                                            >
                                                <X className="w-3.5 h-3.5" />
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                                <button
                                    type="button"
                                    onClick={handleUploadAttachments}
                                    disabled={uploadingAtt}
                                    className="w-full inline-flex items-center justify-center gap-1.5 text-xs text-white bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 px-3 py-2 rounded-lg border border-emerald-500/30"
                                >
                                    {uploadingAtt ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                                    Subir {pendingFiles.length} archivo{pendingFiles.length === 1 ? "" : "s"}
                                </button>
                            </div>
                        )}

                        {/* Input oculto para adjuntar */}
                        {canEdit && (
                            <input
                                ref={fileInputRef}
                                type="file"
                                multiple
                                accept={pendingKind === 'evidence' ? 'image/*' : '.pdf,image/*,.doc,.docx,.xls,.xlsx'}
                                className="hidden"
                                onChange={(e) => {
                                    if (!e.target.files) return;
                                    setPendingFiles(Array.from(e.target.files));
                                    e.target.value = "";
                                }}
                            />
                        )}

                        {po.invoice_date && (
                            <p className="text-[10px] text-neutral-500 mt-2 flex items-center gap-1.5">
                                <Calendar className="w-3 h-3" /> Fecha factura: {new Date(po.invoice_date).toLocaleDateString('es-MX', { dateStyle: 'medium' })}
                            </p>
                        )}
                    </div>

                    {/* Items */}
                    <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-4">
                        <div className="flex items-center justify-between mb-3">
                            <h2 className="text-sm font-bold text-white">Artículos</h2>
                            {canEdit && (
                                <button type="button" onClick={addItem} className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-orange-500/15 text-orange-300 hover:bg-orange-500/25 border border-orange-500/30">
                                    <Plus className="w-3.5 h-3.5" /> Agregar línea
                                </button>
                            )}
                        </div>
                        <div className="space-y-2">
                            <div className="hidden md:grid grid-cols-12 gap-3 text-[10px] font-bold text-neutral-500 uppercase tracking-wider px-2">
                                <div className="col-span-6">Descripción</div>
                                <div className="col-span-2 text-right">Cantidad</div>
                                <div className="col-span-2 text-right">P. Unit.</div>
                                <div className="col-span-1 text-right">Importe</div>
                                <div className="col-span-1"></div>
                            </div>
                            {items.map((it, idx) => (
                                <div key={it.id} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-start bg-neutral-900/30 p-3 rounded-xl border border-neutral-700/30">
                                    <input
                                        type="text"
                                        value={it.description}
                                        onChange={(e) => updateItem(idx, { description: e.target.value })}
                                        disabled={!canEdit}
                                        placeholder="Descripción"
                                        className="md:col-span-6 bg-neutral-900/80 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-orange-500 disabled:opacity-60"
                                    />
                                    <input
                                        type="number" step="0.01" min="0"
                                        value={it.quantity}
                                        onChange={(e) => updateItem(idx, { quantity: parseFloat(e.target.value) || 0 })}
                                        disabled={!canEdit}
                                        className="md:col-span-2 bg-neutral-900/80 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-white text-right focus:outline-none focus:border-orange-500 disabled:opacity-60"
                                    />
                                    <input
                                        type="number" step="0.01" min="0"
                                        value={it.unit_price}
                                        onChange={(e) => updateItem(idx, { unit_price: parseFloat(e.target.value) || 0 })}
                                        disabled={!canEdit}
                                        className="md:col-span-2 bg-neutral-900/80 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-white text-right focus:outline-none focus:border-orange-500 disabled:opacity-60"
                                    />
                                    <div className="md:col-span-1 flex items-center justify-end text-sm font-medium text-emerald-400 tabular-nums">
                                        ${(Number(it.quantity) * Number(it.unit_price)).toFixed(2)}
                                    </div>
                                    <div className="md:col-span-1 flex items-center justify-end">
                                        {canEdit && (
                                            <button type="button" onClick={() => removeItem(idx)} className="p-1.5 text-neutral-500 hover:text-rose-300 rounded-lg">
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Totales */}
                    <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-4">
                        <div className="max-w-xs ml-auto space-y-2 text-sm">
                            <div className="flex justify-between"><span className="text-neutral-400">Subtotal</span><span className="text-white font-medium tabular-nums">${subtotal.toFixed(2)}</span></div>
                            <div className="flex justify-between"><span className="text-neutral-400">IVA (16%)</span><span className="text-white font-medium tabular-nums">${vatTotal.toFixed(2)}</span></div>
                            <div className="border-t border-neutral-700 pt-2 flex justify-between text-base"><span className="text-white font-bold">Total</span><span className="text-emerald-400 font-bold tabular-nums">${total.toFixed(2)}</span></div>
                        </div>
                    </div>

                    {/* Notas */}
                    <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-4">
                        <label className="block text-[11px] font-bold text-neutral-500 uppercase tracking-wider mb-1.5">Notas</label>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            disabled={!canEdit}
                            rows={3}
                            className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500 disabled:opacity-60"
                        />
                    </div>
                </form>
            </div>
        </div>
    );
}
