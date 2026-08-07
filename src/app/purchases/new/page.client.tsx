"use client";

import { useEffect, useState, Suspense, useRef } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { supabase } from "@/lib/supabase";
import {
    ArrowLeft, Plus, Trash2, ShoppingCart, Save, AlertCircle, RefreshCw,
    Upload, Layers, FileText, ChevronDown, ChevronUp
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

// =============================================================================
// Schemas
// =============================================================================
const itemSchema = z.object({
    description: z.string().min(1, "Description required"),
    quantity: z.coerce.number().min(0.01, "Qty > 0"),
    unit_price: z.coerce.number().min(0, "Price >= 0"),
});

const groupSchema = z.object({
    supplier_id: z.string().min(1, "Select a supplier"),
    supplier_quote_file: z.any().optional(),
    items: z.array(itemSchema).min(1, "Add at least one item"),
});

const poSchema = z.object({
    notes: z.string().optional().nullable(),
    groups: z.array(groupSchema).min(1, "Add at least one supplier group"),
});

type POFormValues = z.infer<typeof poSchema>;

type Supplier = {
    id: string;
    business_name: string;
    rfc: string;
    is_active?: boolean;
};

// =============================================================================
// Component
// =============================================================================
function NewPOForm() {
    const router = useRouter();
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [isLoadingSuppliers, setIsLoadingSuppliers] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [collapsedGroups, setCollapsedGroups] = useState<Record<number, boolean>>({});
    const [createdGroup, setCreatedGroup] = useState<{ group_id: string; pos: { id: string; po_number: string }[] } | null>(null);

    const { register, control, handleSubmit, watch, formState: { errors } } = useForm<POFormValues>({
        resolver: zodResolver(poSchema) as any,
        defaultValues: {
            notes: "",
            groups: [
                { supplier_id: "", items: [{ description: "", quantity: 1, unit_price: 0 }] },
                { supplier_id: "", items: [{ description: "", quantity: 1, unit_price: 0 }] },
            ],
        }
    });

    const { fields: groupFields, append: appendGroup, remove: removeGroup } = useFieldArray({ control, name: "groups" });
    const watchedGroups = watch("groups");
    const isMulti = groupFields.length >= 2;

    useEffect(() => {
        async function fetch() {
            try {
                const { data, error } = await supabase
                    .from('suppliers')
                    .select('id, business_name, rfc, is_active')
                    .order('is_active', { ascending: false })
                    .order('business_name', { ascending: true });
                if (error) throw error;
                setSuppliers(data || []);
            } catch (err) {
                console.error("Failed to load suppliers", err);
            } finally {
                setIsLoadingSuppliers(false);
            }
        }
        fetch();
    }, []);

    const calculateLineTotal = (qty: number, price: number) => (qty || 0) * (price || 0);
    const groupSubtotal = (items: any[]) => items?.reduce((sum, it) => sum + calculateLineTotal(it.quantity, it.unit_price), 0) || 0;
    const formatCurrency = (amt: number) => `$${(amt || 0).toFixed(2)}`;

    // Totales globales
    const totalGlobal = watchedGroups?.reduce((s, g) => s + groupSubtotal(g.items), 0) || 0;
    const totalVat = totalGlobal * 0.16;
    const totalGrand = totalGlobal + totalVat;

    const onSubmit = async (data: POFormValues) => {
        setIsSubmitting(true);
        setErrorMsg(null);
        try {
            // Si solo hay un grupo Y el usuario no pidió multicompra,
            // creamos una sola PO (camino legacy).
            if (data.groups.length === 1) {
                const g = data.groups[0];
                const subtotal = groupSubtotal(g.items);
                const vatTotal = subtotal * 0.16;
                const total = subtotal + vatTotal;

                // Subir cotización del proveedor si hay
                let supplierQuoteUrl: string | null = null;
                const fileList: File[] = (g as any).supplier_quote_file;
                const f = Array.isArray(fileList) ? fileList[0] : (fileList as any);
                if (f) {
                    const fileExt = (f as File).name.split('.').pop();
                    const fileName = `quote_${Date.now()}.${fileExt}`;
                    const filePath = `supplier_quotes/${fileName}`;
                    const { error: uploadError } = await supabase.storage
                        .from('purchase_files')
                        .upload(filePath, f as File, {
                            cacheControl: '3600',
                            upsert: false,
                            contentType: (f as File).type,
                        });
                    if (uploadError) throw uploadError;
                    const { data: publicUrlData } = supabase.storage.from('purchase_files').getPublicUrl(filePath);
                    supplierQuoteUrl = publicUrlData.publicUrl;
                }

                const { data: insertedPO, error: poError } = await supabase.from('purchase_orders').insert([{
                    supplier_id: g.supplier_id,
                    subtotal,
                    vat_total: vatTotal,
                    total,
                    supplier_quote_url: supplierQuoteUrl,
                    status: 'Draft',
                    notes: data.notes?.trim() || null,
                }]).select().single();
                if (poError) throw poError;

                const itemsToInsert = g.items.map(item => ({
                    purchase_order_id: insertedPO.id,
                    description: item.description,
                    quantity: item.quantity,
                    unit_price: item.unit_price,
                    line_total: calculateLineTotal(item.quantity, item.unit_price),
                }));
                const { error: itemsError } = await supabase.from('purchase_order_items').insert(itemsToInsert);
                if (itemsError) throw itemsError;

                router.push('/purchases');
                return;
            }

            // Modo multicompra: subir cotizaciones por grupo, luego crear N POs.
            const groupId = (await import('crypto')).randomUUID();
            const createdPOs: { id: string; po_number: string }[] = [];

            for (let i = 0; i < data.groups.length; i++) {
                const g = data.groups[i];
                const subtotal = groupSubtotal(g.items);
                const vatTotal = subtotal * 0.16;
                const total = subtotal + vatTotal;

                let supplierQuoteUrl: string | null = null;
                const fileList: any = (g as any).supplier_quote_file;
                const f = Array.isArray(fileList) ? fileList[0] : fileList;
                if (f) {
                    const fileExt = (f as File).name.split('.').pop();
                    const fileName = `quote_g${i}_${Date.now()}.${fileExt}`;
                    const filePath = `supplier_quotes/${fileName}`;
                    const { error: uploadError } = await supabase.storage
                        .from('purchase_files')
                        .upload(filePath, f as File, {
                            cacheControl: '3600',
                            upsert: false,
                            contentType: (f as File).type,
                        });
                    if (uploadError) throw uploadError;
                    const { data: publicUrlData } = supabase.storage.from('purchase_files').getPublicUrl(filePath);
                    supplierQuoteUrl = publicUrlData.publicUrl;
                }

                const { data: insertedPO, error: poError } = await supabase.from('purchase_orders').insert([{
                    supplier_id: g.supplier_id,
                    subtotal,
                    vat_total: vatTotal,
                    total,
                    supplier_quote_url: supplierQuoteUrl,
                    status: 'Draft',
                    notes: data.notes?.trim() || null,
                    purchase_group_id: groupId,
                }]).select().single();
                if (poError) {
                    // Rollback: borrar las POs anteriores
                    for (const p of createdPOs) {
                        await supabase.from('purchase_orders').delete().eq('id', p.id);
                    }
                    throw poError;
                }

                const itemsToInsert = g.items.map(item => ({
                    purchase_order_id: insertedPO.id,
                    description: item.description,
                    quantity: item.quantity,
                    unit_price: item.unit_price,
                    line_total: calculateLineTotal(item.quantity, item.unit_price),
                }));
                const { error: itemsError } = await supabase.from('purchase_order_items').insert(itemsToInsert);
                if (itemsError) {
                    for (const p of createdPOs) {
                        await supabase.from('purchase_orders').delete().eq('id', p.id);
                    }
                    throw itemsError;
                }

                createdPOs.push({ id: insertedPO.id, po_number: insertedPO.po_number });
            }

            setCreatedGroup({ group_id: groupId, pos: createdPOs });
        } catch (error: any) {
            console.error("Error creating PO:", error);
            setErrorMsg(error.message || "Failed to create purchase order.");
        } finally {
            setIsSubmitting(false);
        }
    };

    // =============================================================================
    // Success view (multicompra)
    // =============================================================================
    if (createdGroup) {
        return (
            <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-3 sm:p-6 md:p-8 lg:p-10 font-[family-name:var(--font-sans)]">
                <div className="max-w-3xl mx-auto space-y-6">
                    <header className="flex items-center gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-emerald-500/40">
                        <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center">
                            <Layers className="w-6 h-6 text-emerald-300" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-white">Multicompra creada</h1>
                            <p className="text-sm text-neutral-400 mt-0.5">
                                Se generaron {createdGroup.pos.length} órdenes de compra, una por proveedor.
                            </p>
                        </div>
                    </header>
                    <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl divide-y divide-neutral-700/40">
                        {createdGroup.pos.map((p, idx) => (
                            <div key={p.id} className="p-4 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <span className="text-[10px] font-bold text-neutral-500">PO #{idx + 1}</span>
                                    <span className="font-mono font-medium text-orange-300 bg-orange-500/10 border border-orange-500/20 px-2.5 py-1 rounded-md">
                                        {p.po_number}
                                    </span>
                                </div>
                                <Link
                                    href={`/purchases/${p.id}`}
                                    className="inline-flex items-center gap-1.5 text-xs font-medium text-cyan-400 hover:text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 px-3 py-1.5 rounded-lg border border-cyan-500/20"
                                >
                                    Abrir PO
                                </Link>
                            </div>
                        ))}
                    </div>
                    <div className="flex items-center justify-between">
                        <p className="text-xs text-neutral-500">
                            ID de grupo: <code className="font-mono text-neutral-300">{createdGroup.group_id.slice(0, 8)}…</code>
                        </p>
                        <Link
                            href="/purchases"
                            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white text-sm font-semibold"
                        >
                            Ir a Compras
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    // =============================================================================
    // Form view
    // =============================================================================
    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-3 sm:p-6 md:p-8 lg:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-5xl mx-auto space-y-8">
                <header className="flex items-center gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <Link href="/purchases" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors text-neutral-400 hover:text-white border border-neutral-700"><ArrowLeft className="w-5 h-5" /></Link>
                    <div>
                        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                            <ShoppingCart className="w-8 h-8 text-orange-400" />
                            {isMulti ? "Multicompra" : "Nueva Orden de Compra"}
                        </h1>
                        <p className="text-neutral-400 text-sm mt-1">
                            {isMulti
                                ? "Una PO por proveedor — todas agrupadas en una sola compra."
                                : "Selecciona un proveedor y agrega los artículos."}
                        </p>
                    </div>
                </header>

                {errorMsg && (
                    <div className="p-4 rounded-xl border bg-red-500/10 border-red-500/30 text-red-400 flex items-center gap-3">
                        <AlertCircle className="w-5 h-5 flex-shrink-0" />
                        <span>{errorMsg}</span>
                    </div>
                )}

                <form onSubmit={handleSubmit(onSubmit as any)} className="space-y-6">
                    {/* Toggle / acciones globales */}
                    <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-4 flex items-center justify-between flex-wrap gap-3">
                        <div className="flex items-center gap-2 text-sm text-neutral-300">
                            <Layers className="w-4 h-4 text-orange-400" />
                            <span>
                                Modo: <strong className="text-white">{isMulti ? "Multicompra" : "Compra única"}</strong>
                                {isMulti && <span className="ml-2 text-xs text-neutral-500">({groupFields.length} proveedores)</span>}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            {isMulti ? (
                                <button
                                    type="button"
                                    onClick={() => {
                                        // Quitar todos los grupos extra; dejar 1
                                        for (let i = groupFields.length - 1; i >= 1; i--) {
                                            removeGroup(i);
                                        }
                                        setCollapsedGroups({});
                                    }}
                                    className="inline-flex items-center gap-1.5 text-xs text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700 px-3 py-1.5 rounded-lg border border-neutral-700"
                                >
                                    Cambiar a compra única
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => appendGroup({ supplier_id: "", items: [{ description: "", quantity: 1, unit_price: 0 }] } as any)}
                                    className="inline-flex items-center gap-1.5 text-xs text-orange-300 hover:text-orange-200 bg-orange-500/10 hover:bg-orange-500/20 px-3 py-1.5 rounded-lg border border-orange-500/30"
                                >
                                    <Layers className="w-3.5 h-3.5" /> Activar multicompra
                                </button>
                            )}
                        </div>
                    </div>

                    {/* GRUPOS (proveedor + sus items) */}
                    {groupFields.map((groupField, gIdx) => (
                        <GroupCard
                            key={groupField.id}
                            gIdx={gIdx}
                            register={register}
                            control={control}
                            errors={errors}
                            suppliers={suppliers}
                            isLoadingSuppliers={isLoadingSuppliers}
                            canRemove={groupFields.length > 1}
                            onRemove={() => {
                                if (groupFields.length > 1) removeGroup(gIdx);
                            }}
                            isCollapsed={!!collapsedGroups[gIdx]}
                            onToggleCollapse={() => setCollapsedGroups((p) => ({ ...p, [gIdx]: !p[gIdx] }))}
                            watchedGroup={watchedGroups?.[gIdx]}
                            groupSubtotal={groupSubtotal}
                            formatCurrency={formatCurrency}
                            calculateLineTotal={calculateLineTotal}
                        />
                    ))}

                    {/* Botón agregar proveedor (solo multicompra) */}
                    {isMulti && (
                        <button
                            type="button"
                            onClick={() => appendGroup({ supplier_id: "", items: [{ description: "", quantity: 1, unit_price: 0 }] } as any)}
                            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed border-orange-500/30 hover:border-orange-500/50 bg-orange-500/5 hover:bg-orange-500/10 text-orange-200 text-sm font-medium transition-colors"
                        >
                            <Plus className="w-4 h-4" /> Agregar otro proveedor
                        </button>
                    )}

                    {/* Notas globales */}
                    <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-4">
                        <label className="block text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">
                            Notas {isMulti ? "(se aplican a todas las POs del grupo)" : "(opcional)"}
                        </label>
                        <textarea
                            {...register("notes")}
                            rows={3}
                            className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                            placeholder="Condiciones de pago, observaciones, referencia…"
                        />
                    </div>

                    {/* Totales globales */}
                    <div className="bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                        <div className="max-w-xs ml-auto space-y-3">
                            {isMulti && watchedGroups?.length > 1 && (
                                <div className="text-[11px] text-neutral-400 space-y-0.5">
                                    {watchedGroups.map((g, idx) => (
                                        <div key={idx} className="flex justify-between">
                                            <span className="truncate">Grupo {idx + 1}:</span>
                                            <span className="font-mono">{formatCurrency(groupSubtotal(g.items))}</span>
                                        </div>
                                    ))}
                                    <div className="border-t border-neutral-700/40 pt-1" />
                                </div>
                            )}
                            <div className="flex justify-between text-sm">
                                <span className="text-neutral-400">Subtotal {isMulti && "total"}</span>
                                <span className="text-white font-medium">{formatCurrency(totalGlobal)}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-neutral-400">IVA (16%)</span>
                                <span className="text-white font-medium">{formatCurrency(totalVat)}</span>
                            </div>
                            <div className="border-t border-neutral-700 pt-3 flex justify-between">
                                <span className="text-lg font-bold text-white">Total {isMulti && "global"}</span>
                                <span className="text-lg font-bold text-emerald-400">{formatCurrency(totalGrand)}</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-end">
                        <button type="submit" disabled={isSubmitting}
                            className="w-full md:w-auto bg-orange-500 hover:bg-orange-600 disabled:bg-orange-500/50 text-white px-10 py-4 rounded-xl font-bold transition-all shadow-[0_0_15px_rgba(249,115,22,0.2)] hover:shadow-[0_0_20px_rgba(249,115,22,0.4)] flex items-center justify-center gap-2 text-lg">
                            {isSubmitting
                                ? <><RefreshCw className="w-5 h-5 animate-spin" /> Creando…</>
                                : <><Save className="w-5 h-5" /> {isMulti ? `Crear ${groupFields.length} POs` : "Crear Orden de Compra"}</>}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// =============================================================================
// GroupCard (un proveedor + sus items). Usado tanto en single como en multi.
// =============================================================================
type GroupCardProps = {
    gIdx: number;
    register: any;
    control: any;
    errors: any;
    suppliers: Supplier[];
    isLoadingSuppliers: boolean;
    canRemove: boolean;
    onRemove: () => void;
    isCollapsed: boolean;
    onToggleCollapse: () => void;
    watchedGroup: any;
    groupSubtotal: (items: any[]) => number;
    formatCurrency: (n: number) => string;
    calculateLineTotal: (qty: number, price: number) => number;
};

function GroupCard({
    gIdx, register, control, errors, suppliers, isLoadingSuppliers,
    canRemove, onRemove, isCollapsed, onToggleCollapse,
    watchedGroup, groupSubtotal, formatCurrency, calculateLineTotal,
}: GroupCardProps) {
    const { fields, append, remove } = useFieldArray({ control, name: `groups.${gIdx}.items` as const });
    const watchedItems = watchedGroup?.items || [];
    // Header summary cuando está colapsado
    const subtotal = groupSubtotal(watchedItems);
    const vat = subtotal * 0.16;
    const total = subtotal + vat;
    const selectedSupplier = suppliers.find((s) => s.id === watchedGroup?.supplier_id);

    return (
        <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl backdrop-blur-sm overflow-hidden">
            {/* Header del grupo */}
            <div className="px-5 py-3 border-b border-neutral-700/50 flex items-center justify-between gap-3 flex-wrap bg-neutral-800/20">
                <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-orange-300 bg-orange-500/10 border border-orange-500/20 px-2 py-0.5 rounded">
                        Proveedor #{gIdx + 1}
                    </span>
                    {selectedSupplier && (
                        <span className="text-sm text-neutral-200 truncate">
                            {selectedSupplier.business_name}
                            <span className="text-neutral-500 ml-1.5">({selectedSupplier.rfc})</span>
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-neutral-400 tabular-nums">{formatCurrency(total)}</span>
                    <button
                        type="button"
                        onClick={onToggleCollapse}
                        className="p-1.5 text-neutral-400 hover:text-white rounded-md hover:bg-neutral-700/50"
                        title={isCollapsed ? "Expandir" : "Colapsar"}
                    >
                        {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                    </button>
                    {canRemove && (
                        <button
                            type="button"
                            onClick={onRemove}
                            className="p-1.5 text-neutral-400 hover:text-rose-300 rounded-md hover:bg-rose-500/10"
                            title="Quitar este proveedor"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>

            {!isCollapsed && (
                <div className="p-5 space-y-5">
                    {/* Selector de proveedor + cotización */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-sm font-medium text-neutral-300 ml-1">Proveedor *</label>
                            <select
                                {...register(`groups.${gIdx}.supplier_id` as const)}
                                className={cn(
                                    "w-full bg-neutral-900/50 border rounded-xl px-4 py-3 text-white appearance-none focus:outline-none focus:ring-2 transition-all",
                                    errors?.groups?.[gIdx]?.supplier_id
                                        ? "border-red-500 focus:ring-red-500/20"
                                        : "border-neutral-700 focus:border-orange-500 focus:ring-orange-500/20"
                                )}
                                disabled={isLoadingSuppliers}
                            >
                                <option value="" disabled>Elige un proveedor…</option>
                                {suppliers.map((s) => (
                                    <option key={s.id} value={s.id} className={cn(s.is_active === false && "text-neutral-500 line-through")}>
                                        {s.business_name} ({s.rfc}){s.is_active === false ? " — Obsoleto" : ""}
                                    </option>
                                ))}
                            </select>
                            {errors?.groups?.[gIdx]?.supplier_id && (
                                <p className="text-red-400 text-xs ml-1">{errors.groups[gIdx].supplier_id.message}</p>
                            )}
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-sm font-medium text-neutral-300 ml-1">
                                Cotización del proveedor (opcional)
                            </label>
                            <input
                                type="file"
                                accept=".pdf,image/*"
                                {...register(`groups.${gIdx}.supplier_quote_file` as const)}
                                className="w-full text-neutral-400 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-orange-500/20 file:text-orange-400 hover:file:bg-orange-500/30 file:transition-colors bg-neutral-900/50 border border-neutral-700 rounded-xl"
                            />
                        </div>
                    </div>

                    {/* Items del grupo */}
                    <div>
                        <div className="flex justify-between items-center mb-3">
                            <h3 className="text-sm font-semibold text-white">Artículos de este proveedor</h3>
                            <button
                                type="button"
                                onClick={() => append({ description: "", quantity: 1, unit_price: 0 })}
                                className="flex items-center gap-1.5 text-xs text-orange-300 hover:text-orange-200 bg-orange-500/10 hover:bg-orange-500/20 px-3 py-1.5 rounded-lg border border-orange-500/20"
                            >
                                <Plus className="w-3.5 h-3.5" /> Agregar línea
                            </button>
                        </div>
                        <div className="space-y-2">
                            <div className="hidden md:grid grid-cols-12 gap-3 text-[10px] font-semibold text-neutral-400 uppercase tracking-wider px-2">
                                <div className="col-span-5">Descripción</div>
                                <div className="col-span-2">Cantidad</div>
                                <div className="col-span-2">Precio Unit.</div>
                                <div className="col-span-2 text-right">Importe</div>
                                <div className="col-span-1"></div>
                            </div>
                            {fields.map((field, idx) => {
                                const qty = watchedItems?.[idx]?.quantity || 0;
                                const price = watchedItems?.[idx]?.unit_price || 0;
                                const lineTotal = calculateLineTotal(qty, price);
                                return (
                                    <div key={field.id} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start bg-neutral-900/30 p-3 rounded-xl border border-neutral-700/30 md:border-none">
                                        <div className="md:col-span-5 space-y-1">
                                            <label className="md:hidden text-xs text-neutral-400 ml-1">Descripción</label>
                                            <input
                                                {...register(`groups.${gIdx}.items.${idx}.description` as const)}
                                                className={cn(
                                                    "w-full bg-neutral-900/80 border rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 transition-all",
                                                    errors?.groups?.[gIdx]?.items?.[idx]?.description
                                                        ? "border-red-500 focus:ring-red-500"
                                                        : "border-neutral-700 focus:border-orange-500 focus:ring-orange-500"
                                                )}
                                                placeholder="Descripción del artículo"
                                            />
                                        </div>
                                        <div className="md:col-span-2 space-y-1">
                                            <label className="md:hidden text-xs text-neutral-400 ml-1">Cantidad</label>
                                            <input
                                                type="number" step="0.01"
                                                {...register(`groups.${gIdx}.items.${idx}.quantity` as const)}
                                                className="w-full bg-neutral-900/80 border border-neutral-700 rounded-lg px-3 py-2 text-white text-center focus:outline-none focus:ring-1 focus:border-orange-500 focus:ring-orange-500 transition-all"
                                            />
                                        </div>
                                        <div className="md:col-span-2 space-y-1">
                                            <label className="md:hidden text-xs text-neutral-400 ml-1">Precio Unit.</label>
                                            <input
                                                type="number" step="0.01"
                                                {...register(`groups.${gIdx}.items.${idx}.unit_price` as const)}
                                                className="w-full bg-neutral-900/80 border border-neutral-700 rounded-lg px-3 py-2 text-white text-right focus:outline-none focus:ring-1 focus:border-orange-500 focus:ring-orange-500 transition-all"
                                            />
                                        </div>
                                        <div className="md:col-span-2 flex items-center justify-end">
                                            <span className="font-medium text-emerald-400 tabular-nums">{formatCurrency(lineTotal)}</span>
                                        </div>
                                        <div className="md:col-span-1 flex items-center justify-end md:justify-center">
                                            <button
                                                type="button"
                                                onClick={() => remove(idx)}
                                                disabled={fields.length === 1}
                                                className="text-neutral-500 hover:text-red-400 disabled:opacity-30 transition-colors p-2 rounded-lg hover:bg-neutral-800"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default function NewPurchasePage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
                <RefreshCw className="w-8 h-8 animate-spin text-orange-400" />
            </div>
        }>
            <NewPOForm />
        </Suspense>
    );
}
