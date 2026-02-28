"use client";

import { useEffect, useState, Suspense, useRef } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, Plus, Trash2, ShoppingCart, Save, AlertCircle, RefreshCw, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

const itemSchema = z.object({
    description: z.string().min(1, "Description required"),
    quantity: z.coerce.number().min(0.01, "Qty > 0"),
    unit_price: z.coerce.number().min(0, "Price >= 0"),
});

const poSchema = z.object({
    supplier_id: z.string().min(1, "Select a supplier"),
    items: z.array(itemSchema).min(1, "Add at least one item"),
});

type POFormValues = z.infer<typeof poSchema>;

type Supplier = {
    id: string;
    business_name: string;
    rfc: string;
};

function NewPOForm() {
    const router = useRouter();
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [isLoadingSuppliers, setIsLoadingSuppliers] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [supplierQuoteFile, setSupplierQuoteFile] = useState<File | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    const { register, control, handleSubmit, watch, formState: { errors } } = useForm<POFormValues>({
        resolver: zodResolver(poSchema) as any,
        defaultValues: {
            supplier_id: "",
            items: [{ description: "", quantity: 1, unit_price: 0 }],
        }
    });

    const { fields, append, remove } = useFieldArray({ control, name: "items" });
    const watchedItems = watch("items");

    useEffect(() => {
        async function fetch() {
            try {
                const { data, error } = await supabase.from('suppliers').select('id, business_name, rfc').order('business_name');
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
    const subtotal = watchedItems?.reduce((sum, item) => sum + calculateLineTotal(item.quantity, item.unit_price), 0) || 0;
    const vatTotal = subtotal * 0.16;
    const total = subtotal + vatTotal;
    const formatCurrency = (amt: number) => `$${amt.toFixed(2)}`;

    const onSubmit = async (data: POFormValues) => {
        setIsSubmitting(true);
        setErrorMsg(null);
        try {
            let supplierQuoteUrl: string | null = null;

            // Upload supplier quote file
            if (supplierQuoteFile) {
                const fileExt = supplierQuoteFile.name.split('.').pop();
                const fileName = `quote_${Date.now()}.${fileExt}`;
                const filePath = `supplier_quotes/${fileName}`;
                const { error: uploadError } = await supabase.storage.from('purchase_files').upload(filePath, supplierQuoteFile, { cacheControl: '3600', upsert: false, contentType: supplierQuoteFile.type });
                if (uploadError) throw uploadError;
                const { data: publicUrlData } = supabase.storage.from('purchase_files').getPublicUrl(filePath);
                supplierQuoteUrl = publicUrlData.publicUrl;
            }

            // Insert PO
            const { data: insertedPO, error: poError } = await supabase.from('purchase_orders').insert([{
                supplier_id: data.supplier_id,
                subtotal: subtotal,
                vat_total: vatTotal,
                total: total,
                supplier_quote_url: supplierQuoteUrl,
                status: 'Draft'
            }]).select().single();

            if (poError) throw poError;

            // Insert items
            const itemsToInsert = data.items.map(item => ({
                purchase_order_id: insertedPO.id,
                description: item.description,
                quantity: item.quantity,
                unit_price: item.unit_price,
                line_total: calculateLineTotal(item.quantity, item.unit_price)
            }));

            const { error: itemsError } = await supabase.from('purchase_order_items').insert(itemsToInsert);
            if (itemsError) throw itemsError;

            router.push('/purchases');
        } catch (error: any) {
            console.error("Error creating PO:", error);
            setErrorMsg(error.message || "Failed to create purchase order.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#0B1120] text-slate-200 p-6 md:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-5xl mx-auto space-y-8">
                <header className="flex items-center gap-4 bg-slate-800/40 p-6 rounded-3xl border border-slate-700/50 backdrop-blur-sm">
                    <Link href="/purchases" className="p-3 bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors text-slate-400 hover:text-white border border-slate-700"><ArrowLeft className="w-5 h-5" /></Link>
                    <div>
                        <h1 className="text-3xl font-bold text-white flex items-center gap-3"><ShoppingCart className="w-8 h-8 text-violet-400" />Nueva Orden de Compra</h1>
                        <p className="text-slate-400 text-sm mt-1">Selecciona un proveedor y agrega los artículos</p>
                    </div>
                </header>

                {errorMsg && (
                    <div className="p-4 rounded-xl border bg-red-500/10 border-red-500/30 text-red-400 flex items-center gap-3"><AlertCircle className="w-5 h-5" />{errorMsg}</div>
                )}

                <form onSubmit={handleSubmit(onSubmit as any)} className="space-y-8">
                    {/* Supplier Selection */}
                    <div className="bg-slate-800/40 p-6 rounded-3xl border border-slate-700/50 backdrop-blur-sm">
                        <h2 className="text-lg font-semibold text-white mb-4">Proveedor</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-300 ml-1">Seleccionar Proveedor *</label>
                                <select {...register("supplier_id")}
                                    className={cn("w-full bg-slate-900/50 border rounded-xl px-4 py-3 text-white appearance-none focus:outline-none focus:ring-2 transition-all",
                                        errors.supplier_id ? "border-red-500 focus:ring-red-500/20" : "border-slate-700 focus:border-violet-500 focus:ring-violet-500/20"
                                    )} disabled={isLoadingSuppliers}>
                                    <option value="" disabled>Elige un proveedor...</option>
                                    {suppliers.map(s => (<option key={s.id} value={s.id}>{s.business_name} ({s.rfc})</option>))}
                                </select>
                                {errors.supplier_id && <p className="text-red-400 text-xs ml-1">{errors.supplier_id.message}</p>}
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-300 ml-1">Cotización del Proveedor (archivo)</label>
                                <input ref={fileRef} type="file" accept=".pdf,image/*"
                                    onChange={(e) => setSupplierQuoteFile(e.target.files?.[0] || null)}
                                    className="w-full text-slate-400 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-violet-500/20 file:text-violet-400 hover:file:bg-violet-500/30 file:transition-colors bg-slate-900/50 border border-slate-700 rounded-xl"
                                />
                                {supplierQuoteFile && <p className="text-xs text-emerald-400 ml-1">✓ {supplierQuoteFile.name}</p>}
                            </div>
                        </div>
                    </div>

                    {/* Line Items */}
                    <div className="bg-slate-800/40 p-6 rounded-3xl border border-slate-700/50 backdrop-blur-sm">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-lg font-semibold text-white">Artículos</h2>
                            <button type="button" onClick={() => append({ description: "", quantity: 1, unit_price: 0 })}
                                className="flex items-center gap-2 text-sm text-violet-400 hover:text-violet-300 font-medium bg-violet-500/10 hover:bg-violet-500/20 px-4 py-2 rounded-lg transition-colors border border-violet-500/20">
                                <Plus className="w-4 h-4" /> Agregar Línea
                            </button>
                        </div>

                        <div className="space-y-3">
                            <div className="hidden md:grid grid-cols-12 gap-4 text-xs font-semibold text-slate-400 uppercase tracking-wider px-2">
                                <div className="col-span-5">Descripción</div>
                                <div className="col-span-2">Cantidad</div>
                                <div className="col-span-2">Precio Unit.</div>
                                <div className="col-span-2 text-right">Importe</div>
                                <div className="col-span-1"></div>
                            </div>

                            {fields.map((field, index) => {
                                const qty = watchedItems?.[index]?.quantity || 0;
                                const price = watchedItems?.[index]?.unit_price || 0;
                                const lineTotal = calculateLineTotal(qty, price);
                                return (
                                    <div key={field.id} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start bg-slate-900/30 p-4 md:p-3 rounded-xl border border-slate-700/30 md:border-none">
                                        <div className="md:col-span-5 space-y-1">
                                            <label className="md:hidden text-xs text-slate-400 ml-1">Descripción</label>
                                            <input {...register(`items.${index}.description` as const)}
                                                className={cn("w-full bg-slate-900/80 border rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 transition-all",
                                                    errors.items?.[index]?.description ? "border-red-500 focus:ring-red-500" : "border-slate-700 focus:border-violet-500 focus:ring-violet-500"
                                                )} placeholder="Descripción del artículo" />
                                        </div>
                                        <div className="md:col-span-2 space-y-1">
                                            <label className="md:hidden text-xs text-slate-400 ml-1">Cantidad</label>
                                            <input type="number" step="0.01" {...register(`items.${index}.quantity` as const)}
                                                className="w-full bg-slate-900/80 border border-slate-700 rounded-lg px-3 py-2 text-white text-center focus:outline-none focus:ring-1 focus:border-violet-500 focus:ring-violet-500 transition-all" />
                                        </div>
                                        <div className="md:col-span-2 space-y-1">
                                            <label className="md:hidden text-xs text-slate-400 ml-1">Precio Unit.</label>
                                            <input type="number" step="0.01" {...register(`items.${index}.unit_price` as const)}
                                                className="w-full bg-slate-900/80 border border-slate-700 rounded-lg px-3 py-2 text-white text-right focus:outline-none focus:ring-1 focus:border-violet-500 focus:ring-violet-500 transition-all" />
                                        </div>
                                        <div className="md:col-span-2 flex items-center justify-end">
                                            <span className="font-medium text-emerald-400">{formatCurrency(lineTotal)}</span>
                                        </div>
                                        <div className="md:col-span-1 flex items-center justify-end md:justify-center">
                                            <button type="button" onClick={() => remove(index)} disabled={fields.length === 1}
                                                className="text-slate-500 hover:text-red-400 disabled:opacity-30 transition-colors p-2 rounded-lg hover:bg-slate-800">
                                                <Trash2 className="w-5 h-5" />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Totals */}
                    <div className="bg-slate-800/40 p-6 rounded-3xl border border-slate-700/50 backdrop-blur-sm">
                        <div className="max-w-xs ml-auto space-y-3">
                            <div className="flex justify-between text-sm"><span className="text-slate-400">Subtotal</span><span className="text-white font-medium">{formatCurrency(subtotal)}</span></div>
                            <div className="flex justify-between text-sm"><span className="text-slate-400">IVA (16%)</span><span className="text-white font-medium">{formatCurrency(vatTotal)}</span></div>
                            <div className="border-t border-slate-700 pt-3 flex justify-between"><span className="text-lg font-bold text-white">Total</span><span className="text-lg font-bold text-emerald-400">{formatCurrency(total)}</span></div>
                        </div>
                    </div>

                    <div className="flex justify-end">
                        <button type="submit" disabled={isSubmitting}
                            className="w-full md:w-auto bg-violet-500 hover:bg-violet-600 disabled:bg-violet-500/50 text-white px-10 py-4 rounded-xl font-bold transition-all shadow-[0_0_15px_rgba(139,92,246,0.2)] hover:shadow-[0_0_20px_rgba(139,92,246,0.4)] flex items-center justify-center gap-2 text-lg">
                            {isSubmitting ? <><RefreshCw className="w-5 h-5 animate-spin" /> Creando...</> : <><Save className="w-5 h-5" /> Crear Orden de Compra</>}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default function NewPurchasePage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-[#0B1120] flex items-center justify-center"><RefreshCw className="w-8 h-8 animate-spin text-violet-400" /></div>}>
            <NewPOForm />
        </Suspense>
    );
}
