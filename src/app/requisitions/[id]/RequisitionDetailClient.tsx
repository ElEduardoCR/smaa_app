"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    ArrowLeft, Loader2, Save, Upload, X, FileText, Package, Store, Calendar,
    User as UserIcon, CheckCircle2, XCircle, Receipt, Image as ImageIcon, ExternalLink
} from "lucide-react";
import { cancelRequisitionAction, completePurchaseAction, uploadRequisitionFileAction } from "@/app/actions/requisitions";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

type Requisition = {
    id: string;
    code: string;
    status: 'pending' | 'purchased' | 'cancelled';
    priority: 'low' | 'normal' | 'high' | 'urgent';
    needed_by: string | null;
    suggested_supplier_id: string | null;
    suggested_supplier_text: string | null;
    notes: string | null;
    purchased_at: string | null;
    purchased_by: string | null;
    invoice_url: string | null;
    invoice_photo_url: string | null;
    created_at: string;
    updated_at: string;
    requester: { id: string; full_name: string; position: string | null; photo_url: string | null; username: string } | null;
    purchaser: { id: string; full_name: string; position: string | null; photo_url: string | null } | null;
    items: { id: string; description: string; quantity: number; unit: string; notes: string | null }[];
    quotations: { id: string; file_url: string; file_name: string; uploaded_at: string }[];
    suggested_supplier: { id: string; business_name: string } | null;
};

const STATUS_STYLES: Record<string, { label: string; chip: string }> = {
    pending:   { label: "Pendiente",  chip: "bg-amber-500/20 text-amber-300 border-amber-500/30" },
    purchased: { label: "Comprada",   chip: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
    cancelled: { label: "Cancelada",  chip: "bg-neutral-700/40 text-neutral-400 border-neutral-600/30" },
};

const PRIORITY_STYLES: Record<string, { label: string; chip: string }> = {
    low:    { label: "Baja",    chip: "bg-slate-500/20 text-slate-300 border-slate-500/30" },
    normal: { label: "Normal",  chip: "bg-sky-500/20 text-sky-300 border-sky-500/30" },
    high:   { label: "Alta",    chip: "bg-orange-500/20 text-orange-300 border-orange-500/30" },
    urgent: { label: "Urgente", chip: "bg-rose-500/20 text-rose-300 border-rose-500/30" },
};

function fmtDate(iso: string | null) {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }); }
    catch { return iso; }
}

function fmtDateTime(iso: string | null) {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }); }
    catch { return iso; }
}

function initials(name: string) {
    const parts = name.trim().split(/\s+/).slice(0, 2);
    return parts.map((p) => p[0]?.toUpperCase() || "").join("");
}

export default function RequisitionDetailClient({
    currentUserId,
    canPurchase,
    canCancel,
    req,
}: {
    currentUserId: string;
    canPurchase: boolean;
    canCancel: boolean;
    req: Requisition;
}) {
    const router = useRouter();
    const status = STATUS_STYLES[req.status] || STATUS_STYLES.pending;
    const prio = PRIORITY_STYLES[req.priority] || PRIORITY_STYLES.normal;

    const [showPurchaseModal, setShowPurchaseModal] = useState(false);
    const [cancelling, setCancelling] = useState(false);

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 font-[family-name:var(--font-sans)]">
            <div className="max-w-4xl mx-auto p-3 md:p-6 space-y-4">
                {/* Header */}
                <header className="bg-neutral-800/40 p-4 rounded-2xl border border-neutral-700/50 flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3">
                        <Link href="/requisitions" className="p-2.5 bg-neutral-800 hover:bg-neutral-700 rounded-xl border border-neutral-700">
                            <ArrowLeft className="w-4 h-4" />
                        </Link>
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-xl font-bold text-white font-mono">{req.code}</h1>
                                <span className={cn("text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border", status.chip)}>
                                    {status.label}
                                </span>
                                <span className={cn("text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full border", prio.chip)}>
                                    {prio.label}
                                </span>
                            </div>
                            <p className="text-xs text-neutral-400">Creada {fmtDateTime(req.created_at)}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {canPurchase && (
                            <button
                                onClick={() => setShowPurchaseModal(true)}
                                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white text-xs font-semibold"
                            >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Marcar como comprada
                            </button>
                        )}
                        {canCancel && (
                            <button
                                onClick={async () => {
                                    if (!confirm("¿Cancelar esta requisición?")) return;
                                    setCancelling(true);
                                    try {
                                        await cancelRequisitionAction(req.id);
                                        router.refresh();
                                    } catch (e: any) {
                                        alert(e.message);
                                    } finally {
                                        setCancelling(false);
                                    }
                                }}
                                disabled={cancelling}
                                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-neutral-800/60 hover:bg-rose-500/20 text-neutral-300 hover:text-rose-300 border border-neutral-700/50 hover:border-rose-500/40 text-xs font-medium disabled:opacity-50"
                            >
                                {cancelling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                                Cancelar
                            </button>
                        )}
                    </div>
                </header>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Solicitante */}
                    <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-4">
                        <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-2">Solicitante</p>
                        <div className="flex items-center gap-2.5">
                            {req.requester?.photo_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={req.requester.photo_url} alt={req.requester.full_name} className="w-10 h-10 rounded-xl object-cover" />
                            ) : (
                                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500/30 to-amber-500/30 flex items-center justify-center text-sm font-bold text-orange-200">
                                    {initials(req.requester?.full_name || "?")}
                                </div>
                            )}
                            <div className="min-w-0">
                                <p className="text-sm font-semibold text-white truncate">{req.requester?.full_name}</p>
                                <p className="text-[11px] text-neutral-400 truncate">{req.requester?.position || "—"}</p>
                            </div>
                        </div>
                    </div>

                    {/* Necesario para */}
                    <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-4">
                        <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-2">Necesario para</p>
                        <div className="flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-amber-400" />
                            <p className="text-sm text-white">{fmtDate(req.needed_by)}</p>
                        </div>
                    </div>

                    {/* Proveedor sugerido */}
                    <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-4">
                        <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-2">Proveedor sugerido</p>
                        <div className="flex items-center gap-2">
                            <Store className="w-4 h-4 text-amber-400" />
                            <p className="text-sm text-white truncate">
                                {req.suggested_supplier?.business_name || req.suggested_supplier_text || "—"}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Items */}
                <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl overflow-hidden">
                    <div className="p-4 border-b border-neutral-800/60 flex items-center gap-2">
                        <Package className="w-4 h-4 text-amber-400" />
                        <h2 className="text-sm font-bold text-white">Artículos solicitados</h2>
                        <span className="text-[10px] text-neutral-500">· {req.items.length}</span>
                    </div>
                    <table className="w-full text-sm">
                        <thead className="bg-neutral-900/40 text-[10px] uppercase tracking-wider text-neutral-400">
                            <tr>
                                <th className="text-left p-3">Descripción</th>
                                <th className="text-right p-3 w-24">Cantidad</th>
                                <th className="text-left p-3 w-20">Unidad</th>
                                <th className="text-left p-3">Notas</th>
                            </tr>
                        </thead>
                        <tbody>
                            {req.items.map((it) => (
                                <tr key={it.id} className="border-t border-neutral-800/40">
                                    <td className="p-3 text-white">{it.description}</td>
                                    <td className="p-3 text-right tabular-nums text-neutral-200 font-semibold">{it.quantity}</td>
                                    <td className="p-3 text-neutral-400 text-xs">{it.unit}</td>
                                    <td className="p-3 text-neutral-400 text-xs">{it.notes || "—"}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Notas */}
                {req.notes && (
                    <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-4">
                        <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1.5">Notas</p>
                        <p className="text-sm text-neutral-200 whitespace-pre-wrap">{req.notes}</p>
                    </div>
                )}

                {/* Cotizaciones */}
                {req.quotations.length > 0 && (
                    <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-4">
                        <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                            <FileText className="w-3.5 h-3.5" /> Cotizaciones adjuntas
                        </p>
                        <div className="space-y-1.5">
                            {req.quotations.map((q) => (
                                <a
                                    key={q.id}
                                    href={q.file_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex items-center gap-2 text-sm text-neutral-200 bg-neutral-900/40 px-3 py-2 rounded-lg hover:bg-neutral-800/60"
                                >
                                    <FileText className="w-4 h-4 text-amber-400" />
                                    <span className="truncate flex-1">{q.file_name}</span>
                                    <ExternalLink className="w-3.5 h-3.5 text-neutral-500" />
                                </a>
                            ))}
                        </div>
                    </div>
                )}

                {/* Evidencia de compra (si ya está purchased) */}
                {req.status === 'purchased' && (req.invoice_url || req.invoice_photo_url) && (
                    <div className="bg-emerald-500/5 border border-emerald-500/30 rounded-2xl p-4 space-y-3">
                        <div className="flex items-center gap-2">
                            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                            <h2 className="text-sm font-bold text-emerald-300">Compra realizada</h2>
                        </div>
                        {req.purchaser && (
                            <p className="text-xs text-neutral-300">
                                Comprado por <strong className="text-white">{req.purchaser.full_name}</strong> el {fmtDateTime(req.purchased_at)}
                            </p>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {req.invoice_url && (
                                <a
                                    href={req.invoice_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex items-center gap-2 bg-neutral-900/40 border border-neutral-700/50 hover:border-emerald-500/40 rounded-lg p-2.5 text-sm text-neutral-200"
                                >
                                    <Receipt className="w-4 h-4 text-emerald-400" />
                                    <span className="truncate flex-1">Factura</span>
                                    <ExternalLink className="w-3.5 h-3.5 text-neutral-500" />
                                </a>
                            )}
                            {req.invoice_photo_url && (
                                <a
                                    href={req.invoice_photo_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex items-center gap-2 bg-neutral-900/40 border border-neutral-700/50 hover:border-emerald-500/40 rounded-lg p-2.5 text-sm text-neutral-200"
                                >
                                    <ImageIcon className="w-4 h-4 text-emerald-400" />
                                    <span className="truncate flex-1">Foto</span>
                                    <ExternalLink className="w-3.5 h-3.5 text-neutral-500" />
                                </a>
                            )}
                        </div>
                    </div>
                )}

                {showPurchaseModal && (
                    <PurchaseModal reqId={req.id} onClose={() => setShowPurchaseModal(false)} onDone={() => { setShowPurchaseModal(false); router.refresh(); }} />
                )}
            </div>
        </div>
    );
}

function PurchaseModal({ reqId, onClose, onDone }: { reqId: string; onClose: () => void; onDone: () => void }) {
    const [invoiceUrl, setInvoiceUrl] = useState('');
    const [photoUrl, setPhotoUrl] = useState('');
    const [finalNotes, setFinalNotes] = useState('');
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState<'invoice' | 'photo' | null>(null);
    const [err, setErr] = useState<string | null>(null);

    const upload = async (file: File, kind: 'invoice' | 'photo') => {
        setUploading(kind);
        setErr(null);
        try {
            const reader = new FileReader();
            const dataUrl: string = await new Promise((res, rej) => {
                reader.onload = () => res(String(reader.result || ""));
                reader.onerror = rej;
                reader.readAsDataURL(file);
            });
            const b64 = dataUrl.split(",")[1] || "";
            const url = await uploadRequisitionFileAction(b64, file.name, file.type || "application/octet-stream");
            if (kind === 'invoice') setInvoiceUrl(url);
            else setPhotoUrl(url);
        } catch (e: any) {
            setErr(e.message || "Error al subir.");
        } finally {
            setUploading(null);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErr(null);
        if (!invoiceUrl) {
            setErr("La factura es obligatoria para cerrar la compra.");
            return;
        }
        setSaving(true);
        try {
            await completePurchaseAction(reqId, invoiceUrl, photoUrl || null, finalNotes);
            onDone();
        } catch (ex: any) {
            setErr(ex.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-neutral-900 border border-neutral-700/60 rounded-3xl w-full max-w-lg shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <form onSubmit={handleSubmit}>
                    <div className="p-5 border-b border-neutral-800 flex items-center justify-between">
                        <div>
                            <h2 className="text-lg font-bold text-white flex items-center gap-2">
                                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                                Cerrar compra
                            </h2>
                            <p className="text-[11px] text-neutral-500">Sube la factura y opcionalmente una foto del material.</p>
                        </div>
                        <button type="button" onClick={onClose} className="p-2 text-neutral-500 hover:text-white">
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    <div className="p-5 space-y-4">
                        {err && (
                            <div className="bg-rose-500/10 border border-rose-500/30 text-rose-200 text-sm rounded-xl p-3">{err}</div>
                        )}

                        <FileField
                            label="Factura (PDF o imagen) *"
                            accept=".pdf,image/*"
                            onFile={(f) => upload(f, 'invoice')}
                            uploading={uploading === 'invoice'}
                            url={invoiceUrl}
                            onClear={() => setInvoiceUrl('')}
                            icon={<Receipt className="w-4 h-4 text-emerald-400" />}
                        />

                        <FileField
                            label="Foto del material / factura (opcional)"
                            accept="image/*"
                            onFile={(f) => upload(f, 'photo')}
                            uploading={uploading === 'photo'}
                            url={photoUrl}
                            onClear={() => setPhotoUrl('')}
                            icon={<ImageIcon className="w-4 h-4 text-emerald-400" />}
                        />

                        <div>
                            <label className="block text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">Notas finales (opcional)</label>
                            <textarea
                                value={finalNotes}
                                onChange={(e) => setFinalNotes(e.target.value)}
                                rows={2}
                                placeholder="Proveedor real, fecha, observaciones…"
                                className="w-full bg-neutral-800/60 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                            />
                        </div>
                    </div>

                    <div className="p-4 border-t border-neutral-800 flex items-center justify-end gap-2">
                        <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-neutral-300 hover:bg-neutral-800">
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={saving || uploading !== null || !invoiceUrl}
                            className="px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-1.5"
                        >
                            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                            Confirmar compra
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

function FileField({ label, accept, onFile, uploading, url, onClear, icon }: {
    label: string; accept: string; onFile: (f: File) => void; uploading: boolean; url: string; onClear: () => void; icon: React.ReactNode;
}) {
    return (
        <div>
            <label className="block text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">{label}</label>
            {!url ? (
                <label className="flex items-center justify-center gap-2 w-full bg-neutral-800/60 hover:bg-neutral-800 border-2 border-dashed border-neutral-700 hover:border-orange-500/40 rounded-xl px-3 py-4 text-sm text-neutral-300 cursor-pointer transition-colors">
                    <Upload className="w-4 h-4" />
                    {uploading ? "Subiendo…" : "Subir archivo"}
                    <input
                        type="file"
                        accept={accept}
                        className="hidden"
                        disabled={uploading}
                        onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) onFile(f);
                            e.target.value = "";
                        }}
                    />
                </label>
            ) : (
                <div className="flex items-center gap-2 bg-neutral-900/40 border border-emerald-500/30 rounded-xl px-3 py-2 text-sm text-neutral-200">
                    {icon}
                    <a href={url} target="_blank" rel="noreferrer" className="truncate flex-1 hover:text-emerald-300">
                        {url.split('/').pop()}
                    </a>
                    <button type="button" onClick={onClear} className="p-1 text-neutral-500 hover:text-rose-300">
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
            )}
        </div>
    );
}
