"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    ArrowLeft, Plus, Trash2, Loader2, Save, Package, Store, Calendar, FileText, Upload, X, AlertCircle
} from "lucide-react";
import { createRequisitionAction, uploadRequisitionFileAction } from "@/app/actions/requisitions";

type Item = { description: string; quantity: number; unit: string; notes: string };
type UploadedFile = { name: string; url: string };

function emptyItem(): Item {
    return { description: "", quantity: 1, unit: "pza", notes: "" };
}

export default function NewRequisitionClient({ suppliers }: { suppliers: { id: string; name: string }[] }) {
    const router = useRouter();

    const [priority, setPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal');
    const [neededBy, setNeededBy] = useState('');
    const [supplierId, setSupplierId] = useState('');
    const [supplierText, setSupplierText] = useState('');
    const [notes, setNotes] = useState('');
    const [items, setItems] = useState<Item[]>([emptyItem()]);
    const [files, setFiles] = useState<UploadedFile[]>([]);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        if (!f) return;
        setUploading(true);
        setErr(null);
        try {
            const reader = new FileReader();
            const dataUrl: string = await new Promise((res, rej) => {
                reader.onload = () => res(String(reader.result || ""));
                reader.onerror = rej;
                reader.readAsDataURL(f);
            });
            const b64 = dataUrl.split(",")[1] || "";
            const url = await uploadRequisitionFileAction(b64, f.name, f.type || "application/octet-stream");
            setFiles((prev) => [...prev, { name: f.name, url }]);
        } catch (ex: any) {
            setErr(ex.message || "Error al subir archivo.");
        } finally {
            setUploading(false);
            e.target.value = "";
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErr(null);

        // Validaciones
        if (items.length === 0) {
            setErr("Agrega al menos un artículo.");
            return;
        }
        const cleanItems = items.filter((i) => i.description.trim());
        if (cleanItems.length === 0) {
            setErr("Agrega al menos un artículo con descripción.");
            return;
        }
        for (const it of cleanItems) {
            if (!it.quantity || it.quantity <= 0) {
                setErr(`"${it.description}" debe tener cantidad mayor a 0.`);
                return;
            }
        }

        setSaving(true);
        try {
            const result = await createRequisitionAction({
                priority,
                needed_by: neededBy || null,
                suggested_supplier_id: supplierId || null,
                suggested_supplier_text: supplierText,
                notes,
                items: cleanItems,
                quotation_urls: files.map((f) => f.url),
            });
            router.push(`/requisitions/${result.id}`);
        } catch (ex: any) {
            setErr(ex.message || "Error al crear la requisición.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 font-[family-name:var(--font-sans)]">
            <div className="max-w-3xl mx-auto p-3 md:p-6 space-y-4">
                <header className="bg-neutral-800/40 p-4 rounded-2xl border border-neutral-700/50 flex items-center gap-3">
                    <Link href="/requisitions" className="p-2.5 bg-neutral-800 hover:bg-neutral-700 rounded-xl border border-neutral-700">
                        <ArrowLeft className="w-4 h-4" />
                    </Link>
                    <div>
                        <h1 className="text-xl font-bold text-white">Nueva requisición</h1>
                        <p className="text-xs text-neutral-400">Solicita los insumos que necesitas para trabajar</p>
                    </div>
                </header>

                {err && (
                    <div className="bg-rose-500/10 border border-rose-500/30 text-rose-200 text-sm rounded-xl p-3 flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <span>{err}</span>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Datos generales */}
                    <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-4 space-y-4">
                        <h2 className="text-sm font-bold text-white flex items-center gap-2">
                            <Package className="w-4 h-4 text-amber-400" /> Datos generales
                        </h2>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                                <label className="block text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">Prioridad</label>
                                <select
                                    value={priority}
                                    onChange={(e) => setPriority(e.target.value as any)}
                                    className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                                >
                                    <option value="low">Baja</option>
                                    <option value="normal">Normal</option>
                                    <option value="high">Alta</option>
                                    <option value="urgent">Urgente</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">Necesario para (opcional)</label>
                                <input
                                    type="date"
                                    value={neededBy}
                                    onChange={(e) => setNeededBy(e.target.value)}
                                    className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">
                                <Store className="w-3 h-3 inline mr-1" /> Proveedor sugerido
                            </label>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                <select
                                    value={supplierId}
                                    onChange={(e) => setSupplierId(e.target.value)}
                                    className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                                >
                                    <option value="">— Seleccionar del catálogo —</option>
                                    {suppliers.map((s) => (
                                        <option key={s.id} value={s.id}>{s.name}</option>
                                    ))}
                                </select>
                                <input
                                    type="text"
                                    value={supplierText}
                                    onChange={(e) => setSupplierText(e.target.value)}
                                    placeholder="O escribe uno libre (ej. 'Materiales del Sur')"
                                    className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                                />
                            </div>
                            <p className="text-[10px] text-neutral-500 mt-1">Si ya tienes un proveedor en mente, selecciónalo del catálogo o escríbelo.</p>
                        </div>

                        <div>
                            <label className="block text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">Notas (opcional)</label>
                            <textarea
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                rows={3}
                                placeholder="Para qué es el material, especificaciones adicionales, etc."
                                className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                            />
                        </div>
                    </div>

                    {/* Items */}
                    <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-4 space-y-3">
                        <div className="flex items-center justify-between">
                            <h2 className="text-sm font-bold text-white flex items-center gap-2">
                                <FileText className="w-4 h-4 text-amber-400" /> Artículos a solicitar
                            </h2>
                            <button
                                type="button"
                                onClick={() => setItems((p) => [...p, emptyItem()])}
                                className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 border border-amber-500/30"
                            >
                                <Plus className="w-3.5 h-3.5" />
                                Agregar
                            </button>
                        </div>

                        <div className="space-y-2">
                            {items.map((it, idx) => (
                                <div key={idx} className="bg-neutral-900/40 border border-neutral-700/40 rounded-xl p-3 flex items-start gap-2">
                                    <span className="text-[10px] font-bold text-neutral-500 mt-2 w-6 flex-shrink-0">#{idx + 1}</span>
                                    <div className="flex-1 grid grid-cols-12 gap-2">
                                        <input
                                            type="text"
                                            value={it.description}
                                            onChange={(e) => setItems((p) => p.map((x, i) => i === idx ? { ...x, description: e.target.value } : x))}
                                            placeholder="Descripción (ej. Electrodo E7018 3/32)"
                                            className="col-span-12 md:col-span-7 bg-neutral-800/60 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-orange-500"
                                        />
                                        <input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            value={it.quantity}
                                            onChange={(e) => setItems((p) => p.map((x, i) => i === idx ? { ...x, quantity: parseFloat(e.target.value) || 0 } : x))}
                                            className="col-span-5 md:col-span-2 bg-neutral-800/60 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-orange-500"
                                        />
                                        <input
                                            type="text"
                                            value={it.unit}
                                            onChange={(e) => setItems((p) => p.map((x, i) => i === idx ? { ...x, unit: e.target.value } : x))}
                                            placeholder="pza"
                                            className="col-span-5 md:col-span-1 bg-neutral-800/60 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-orange-500"
                                        />
                                        <input
                                            type="text"
                                            value={it.notes}
                                            onChange={(e) => setItems((p) => p.map((x, i) => i === idx ? { ...x, notes: e.target.value } : x))}
                                            placeholder="Notas"
                                            className="col-span-12 md:col-span-2 bg-neutral-800/60 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-orange-500"
                                        />
                                    </div>
                                    {items.length > 1 && (
                                        <button
                                            type="button"
                                            onClick={() => setItems((p) => p.filter((_, i) => i !== idx))}
                                            className="p-1.5 text-neutral-500 hover:text-rose-300 rounded-lg mt-0.5"
                                            title="Quitar"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Cotizaciones */}
                    <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-4 space-y-3">
                        <h2 className="text-sm font-bold text-white flex items-center gap-2">
                            <FileText className="w-4 h-4 text-amber-400" /> Cotizaciones (opcional)
                        </h2>
                        <p className="text-[11px] text-neutral-400">
                            Si ya te adelantaste y conseguiste cotizaciones de proveedores, adjúntalas aquí para acelerar la compra.
                        </p>

                        <div>
                            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-xs font-medium text-neutral-300 cursor-pointer">
                                <Upload className="w-3.5 h-3.5" />
                                {uploading ? "Subiendo…" : "Adjuntar cotización"}
                                <input
                                    type="file"
                                    accept=".pdf,image/*,.doc,.docx,.xls,.xlsx"
                                    className="hidden"
                                    onChange={handleFile}
                                    disabled={uploading}
                                />
                            </label>
                        </div>

                        {files.length > 0 && (
                            <div className="space-y-1.5">
                                {files.map((f, i) => (
                                    <div key={i} className="flex items-center gap-2 text-[11px] text-neutral-300 bg-neutral-900/40 px-2.5 py-1.5 rounded-lg">
                                        <FileText className="w-3.5 h-3.5 text-amber-400" />
                                        <a href={f.url} target="_blank" rel="noreferrer" className="truncate hover:text-orange-300 flex-1">
                                            {f.name}
                                        </a>
                                        <button
                                            type="button"
                                            onClick={() => setFiles((p) => p.filter((_, x) => x !== i))}
                                            className="text-neutral-500 hover:text-rose-300"
                                        >
                                            <X className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-end gap-2">
                        <Link
                            href="/requisitions"
                            className="px-4 py-2 rounded-xl text-sm text-neutral-300 hover:bg-neutral-800"
                        >
                            Cancelar
                        </Link>
                        <button
                            type="submit"
                            disabled={saving || uploading}
                            className="px-5 py-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-1.5"
                        >
                            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            Crear requisición
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
