"use client";

import { useEffect, useState, Suspense } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, Save, Plus, Trash2, Calculator, AlertCircle, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

// Zod Schema
const itemSchema = z.object({
    description: z.string().min(1, "Description is required"),
    quantity: z.coerce.number().min(1, "Min 1"),
    unit_price: z.coerce.number().min(0, "Invalid price"),
});

const quotationSchema = z.object({
    client_id: z.string().min(1, "Please select a client"),
    seller: z.string().optional().or(z.literal('')),
    delivery_time: z.string().optional().or(z.literal('')),
    terms_conditions: z.string().optional().or(z.literal('')),
    items: z.array(itemSchema).min(1, "At least one item is required"),
});

type QuotationFormValues = z.infer<typeof quotationSchema>;

function QuotationForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const editId = searchParams.get('id');
    const isEditing = !!editId;

    const [clients, setClients] = useState<{ id: string, business_name: string }[]>([]);
    const [isLoadingClients, setIsLoadingClients] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const {
        register,
        control,
        handleSubmit,
        watch,
        reset,
        formState: { errors }
    } = useForm<QuotationFormValues>({
        resolver: zodResolver(quotationSchema) as any,
        defaultValues: {
            client_id: "",
            seller: "",
            delivery_time: "",
            terms_conditions: "",
            items: [{ description: "", quantity: 1, unit_price: 0 }]
        }
    });

    const { fields, append, remove } = useFieldArray({
        control,
        name: "items"
    });

    const watchItems = watch("items");

    // Calculations
    const subtotal = watchItems.reduce((acc, item) => acc + ((item.quantity || 0) * (item.unit_price || 0)), 0);
    const vatTotal = subtotal * 0.16; // 16% IVA
    const total = subtotal + vatTotal;

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);
    };

    useEffect(() => {
        async function fetchClients() {
            try {
                const { data, error } = await supabase
                    .from('clients')
                    .select('id, business_name')
                    .order('business_name', { ascending: true });

                if (error) throw error;
                setClients(data || []);
            } catch (err) {
                console.error("Failed to load clients", err);
            } finally {
                setIsLoadingClients(false);
            }
        }
        fetchClients();
    }, []);

    useEffect(() => {
        async function fetchQuote() {
            if (!editId) return;
            try {
                const { data: quote, error: quoteError } = await supabase
                    .from('quotations')
                    .select('*')
                    .eq('id', editId)
                    .single();

                if (quoteError) throw quoteError;

                const { data: items, error: itemsError } = await supabase
                    .from('quotation_items')
                    .select('*')
                    .eq('quotation_id', editId);

                if (itemsError) throw itemsError;

                // Reset form with fetched data
                reset({
                    client_id: quote.client_id,
                    seller: quote.seller || "",
                    delivery_time: quote.delivery_time || "",
                    terms_conditions: quote.terms_conditions || "",
                    items: items.map((i: any) => ({
                        description: i.description,
                        quantity: i.quantity,
                        unit_price: i.unit_price
                    }))
                });
            } catch (err) {
                console.error("Failed to load quotation for editing", err);
                setErrorMsg("Error loading quotation data.");
            }
        }
        fetchQuote();
    }, [editId, reset]);

    const onSubmit = async (data: QuotationFormValues) => {
        setIsSubmitting(true);
        setErrorMsg(null);
        try {
            let currentQuoteId = editId;

            if (isEditing) {
                // Update existing quote
                const { error: quoteError } = await supabase
                    .from('quotations')
                    .update({
                        client_id: data.client_id,
                        seller: data.seller || null,
                        delivery_time: data.delivery_time || null,
                        terms_conditions: data.terms_conditions || null,
                        subtotal,
                        vat_total: vatTotal,
                        total,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', editId);

                if (quoteError) throw quoteError;

                // Delete old items
                const { error: delError } = await supabase
                    .from('quotation_items')
                    .delete()
                    .eq('quotation_id', editId);

                if (delError) throw delError;

            } else {
                // Insert new quote
                const quoteData = {
                    client_id: data.client_id,
                    seller: data.seller || null,
                    delivery_time: data.delivery_time || null,
                    terms_conditions: data.terms_conditions || null,
                    subtotal,
                    vat_total: vatTotal,
                    total,
                    status: 'Draft'
                };

                const { data: insertedQuote, error: quoteError } = await supabase
                    .from('quotations')
                    .insert([quoteData])
                    .select()
                    .single();

                if (quoteError) throw quoteError;
                currentQuoteId = insertedQuote.id;
            }

            // Insert new or replaced items
            const itemsToInsert = data.items.map(item => ({
                quotation_id: currentQuoteId,
                description: item.description,
                quantity: item.quantity,
                unit_price: item.unit_price,
                line_total: item.quantity * item.unit_price
            }));

            const { error: itemsError } = await supabase
                .from('quotation_items')
                .insert(itemsToInsert);

            if (itemsError) throw itemsError;

            // Navigate back to sales list on success
            router.push('/sales');

        } catch (error: any) {
            console.error("Error saving quotation:", error);
            setErrorMsg(error.message || "Failed to save quotation");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-6 md:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-5xl mx-auto space-y-8">
                {/* Header */}
                <header className="flex items-center gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <Link href="/sales" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors text-neutral-400 hover:text-white border border-neutral-700">
                        <ArrowLeft className="w-5 h-5" />
                    </Link>
                    <div>
                        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                            <Calculator className="w-8 h-8 text-emerald-400" />
                            {isEditing ? "Editar Cotización" : "Nueva Cotización"}
                        </h1>
                        <p className="text-neutral-400 text-sm mt-1">{isEditing ? "Modify an existing draft quotation" : "Create a new sales quotation with auto-calculated totals"}</p>
                    </div>
                </header>

                {errorMsg && (
                    <div className="p-4 rounded-xl border bg-red-500/10 border-red-500/30 text-red-400 flex items-center gap-3">
                        <AlertCircle className="w-5 h-5 flex-shrink-0" />
                        {errorMsg}
                    </div>
                )}

                <form onSubmit={handleSubmit(onSubmit as any)} className="space-y-8">
                    {/* Client Selection */}
                    <div className="bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                        <h2 className="text-lg font-semibold text-white mb-4">Client Details</h2>
                        <div className="space-y-2 max-w-xl">
                            <label className="text-sm font-medium text-neutral-300 ml-1">Select Client *</label>
                            <div className="relative">
                                <select
                                    {...register("client_id")}
                                    className={cn(
                                        "w-full bg-neutral-900/50 border rounded-xl px-4 py-3 text-white appearance-none focus:outline-none focus:ring-2 transition-all",
                                        errors.client_id ? "border-red-500/50 focus:border-red-500 focus:ring-red-500/20" : "border-neutral-700 focus:border-emerald-500 focus:ring-emerald-500/20"
                                    )}
                                    disabled={isLoadingClients}
                                >
                                    <option value="" disabled>Choose a client...</option>
                                    {clients.map(c => (
                                        <option key={c.id} value={c.id}>{c.business_name}</option>
                                    ))}
                                </select>
                                <div className="absolute inset-y-0 right-0 flex items-center px-4 pointer-events-none text-neutral-500">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                                </div>
                            </div>
                            {errors.client_id && <p className="text-red-400 text-xs ml-1">{errors.client_id.message}</p>}
                        </div>
                    </div>

                    {/* Seller & Delivery */}
                    <div className="bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                        <h2 className="text-lg font-semibold text-white mb-4">Información Adicional</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-neutral-300 ml-1">Vendedor</label>
                                <input
                                    {...register("seller")}
                                    className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-4 py-3 text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                                    placeholder="Nombre del vendedor"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-neutral-300 ml-1">Tiempo de Entrega</label>
                                <input
                                    {...register("delivery_time")}
                                    className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-4 py-3 text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                                    placeholder="Ej: 5 días hábiles, 2 semanas"
                                />
                            </div>
                            <div className="space-y-2 md:col-span-2">
                                <label className="text-sm font-medium text-neutral-300 ml-1">Términos y Condiciones</label>
                                <textarea
                                    {...register("terms_conditions")}
                                    className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-4 py-3 text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all min-h-[120px]"
                                    placeholder="Ej: Precios en MXN, validez 30 días, pago 50% anticipo..."
                                />
                            </div>
                        </div>
                    </div>

                    {/* Items Array */}
                    <div className="bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-lg font-semibold text-white">Products / Services</h2>
                            <button
                                type="button"
                                onClick={() => append({ description: "", quantity: 1, unit_price: 0 })}
                                className="flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300 font-medium bg-emerald-500/10 hover:bg-emerald-500/20 px-4 py-2 rounded-lg transition-colors border border-emerald-500/20"
                            >
                                <Plus className="w-4 h-4" /> Add Line
                            </button>
                        </div>

                        <div className="space-y-4">
                            {/* Desktop Headers */}
                            <div className="hidden md:grid grid-cols-12 gap-4 text-xs font-semibold text-neutral-400 uppercase tracking-wider px-2">
                                <div className="col-span-6">Description</div>
                                <div className="col-span-2">Quantity</div>
                                <div className="col-span-3">Unit Price</div>
                                <div className="col-span-1 text-center"></div>
                            </div>

                            {fields.map((field, index) => (
                                <div key={field.id} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start bg-neutral-900/30 p-4 md:p-2 rounded-xl border border-neutral-700/30 md:border-none focus-within:bg-neutral-800/60 transition-colors">
                                    <div className="md:col-span-6 space-y-1">
                                        <label className="md:hidden text-xs text-neutral-400 ml-1">Description</label>
                                        <input
                                            {...register(`items.${index}.description` as const)}
                                            className={cn(
                                                "w-full bg-neutral-900/80 border rounded-lg px-3 py-2 text-white placeholder-neutral-600 focus:outline-none focus:ring-1 transition-all",
                                                errors.items?.[index]?.description ? "border-red-500 focus:border-red-500 focus:ring-red-500" : "border-neutral-700 focus:border-emerald-500 focus:ring-emerald-500"
                                            )}
                                            placeholder="Item description..."
                                        />
                                        {errors.items?.[index]?.description && <p className="text-red-400 text-xs ml-1">{errors.items[index]?.description?.message}</p>}
                                    </div>

                                    <div className="grid grid-cols-2 md:grid-cols-5 md:col-span-5 gap-4">
                                        <div className="md:col-span-2 space-y-1">
                                            <label className="md:hidden text-xs text-neutral-400 ml-1">Quantity</label>
                                            <input
                                                type="number"
                                                step="any"
                                                {...register(`items.${index}.quantity` as const, { valueAsNumber: true })}
                                                className={cn(
                                                    "w-full bg-neutral-900/80 border rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 transition-all",
                                                    errors.items?.[index]?.quantity ? "border-red-500 focus:border-red-500 focus:ring-red-500" : "border-neutral-700 focus:border-emerald-500 focus:ring-emerald-500"
                                                )}
                                            />
                                            {errors.items?.[index]?.quantity && <p className="text-red-400 text-xs ml-1">{errors.items[index]?.quantity?.message}</p>}
                                        </div>

                                        <div className="md:col-span-3 space-y-1">
                                            <label className="md:hidden text-xs text-neutral-400 ml-1">Unit Price ($)</label>
                                            <input
                                                type="number"
                                                step="any"
                                                {...register(`items.${index}.unit_price` as const, { valueAsNumber: true })}
                                                className={cn(
                                                    "w-full bg-neutral-900/80 border rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 transition-all",
                                                    errors.items?.[index]?.unit_price ? "border-red-500 focus:border-red-500 focus:ring-red-500" : "border-neutral-700 focus:border-emerald-500 focus:ring-emerald-500"
                                                )}
                                            />
                                            {errors.items?.[index]?.unit_price && <p className="text-red-400 text-xs ml-1">{errors.items[index]?.unit_price?.message}</p>}
                                        </div>
                                    </div>

                                    <div className="md:col-span-1 flex items-center justify-end md:justify-center md:h-[40px] pt-2 md:pt-0">
                                        <button
                                            type="button"
                                            onClick={() => remove(index)}
                                            disabled={fields.length === 1}
                                            className="text-neutral-500 hover:text-red-400 disabled:opacity-30 disabled:hover:text-neutral-500 transition-colors p-2 rounded-lg hover:bg-neutral-800"
                                            title="Remove line"
                                        >
                                            <Trash2 className="w-5 h-5" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Totals & Submit */}
                    <div className="flex flex-col md:flex-row justify-between items-end gap-6 bg-neutral-800/20 p-6 rounded-3xl border border-neutral-700/30">
                        <div className="w-full md:w-auto">
                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className="w-full md:w-auto bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-500/50 text-white px-10 py-4 rounded-xl font-bold transition-all shadow-[0_0_15px_rgba(16,185,129,0.2)] hover:shadow-[0_0_20px_rgba(16,185,129,0.4)] flex items-center justify-center gap-2 text-lg"
                            >
                                {isSubmitting ? (
                                    <><RefreshCw className="w-5 h-5 animate-spin" /> Guardando...</>
                                ) : (
                                    <><Save className="w-5 h-5" /> {isEditing ? "Actualizar Cotización" : "Guardar Cotización"}</>
                                )}
                            </button>
                        </div>

                        <div className="w-full md:w-72 space-y-3 bg-neutral-900/50 p-6 rounded-2xl border border-neutral-700/50">
                            <div className="flex justify-between items-center text-sm text-neutral-400 font-medium">
                                <span>Subtotal</span>
                                <span>{formatCurrency(subtotal)}</span>
                            </div>
                            <div className="flex justify-between items-center text-sm text-neutral-400 font-medium pb-3 border-b border-neutral-700/50">
                                <span>IVA (16%)</span>
                                <span>{formatCurrency(vatTotal)}</span>
                            </div>
                            <div className="flex justify-between items-end text-lg text-white font-bold pt-1">
                                <span>Total Neto</span>
                                <span className="text-emerald-400">{formatCurrency(total)}</span>
                            </div>
                        </div>
                    </div>

                </form>
            </div>
        </div>
    );
}

export default function NewQuotationPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-10 font-[family-name:var(--font-sans)]">
                <RefreshCw className="w-8 h-8 animate-spin text-emerald-400" />
            </div>
        }>
            <QuotationForm />
        </Suspense>
    );
}
