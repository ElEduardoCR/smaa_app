"use client";

import { useEffect, useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, Save, Plus, Trash2, Zap, AlertCircle, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";
import CommissionersSection from "@/app/sales/CommissionersSection";
import { normalizeCommissioners, rememberCommissionAgents } from "@/lib/commissioners";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

// Cotización rápida: solo descripción + cantidad + precio de venta directo.
// Sin costos, sin margen, sin conceptos de servicio.
const quickItemSchema = z.object({
    description: z.string().min(1, "Descripción requerida"),
    quantity: z.coerce.number().min(1, "Mínimo 1"),
    unit_price: z.coerce.number().min(0, "Inválido"),
});

const commissionerSchema = z.object({
    name: z.string().optional().or(z.literal("")),
    amount: z.coerce.number().catch(0),
});

const quickSchema = z.object({
    client_id: z.string().min(1, "Selecciona un cliente"),
    seller: z.string().optional().or(z.literal("")),
    delivery_time: z.string().optional().or(z.literal("")),
    items: z.array(quickItemSchema).min(1, "Agrega al menos una partida"),
    commissioners: z.array(commissionerSchema).optional().default([]),
});

type QuickFormValues = z.infer<typeof quickSchema>;

const emptyItem = { description: "", quantity: 1, unit_price: 0 };

export default function QuickQuotationPage() {
    const router = useRouter();

    const [clients, setClients] = useState<{ id: string; business_name: string }[]>([]);
    const [isLoadingClients, setIsLoadingClients] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [defaultTerms, setDefaultTerms] = useState<string>("");

    const {
        register,
        control,
        handleSubmit,
        watch,
        formState: { errors },
    } = useForm<QuickFormValues>({
        resolver: zodResolver(quickSchema) as any,
        defaultValues: {
            client_id: "",
            seller: "",
            delivery_time: "",
            items: [{ ...emptyItem }],
            commissioners: [],
        },
    });

    const { fields, append, remove } = useFieldArray({ control, name: "items" });
    const watchItems = watch("items");

    const lineTotal = (item: any) => round2((Number(item?.quantity) || 0) * (Number(item?.unit_price) || 0));
    const subtotal = round2((watchItems || []).reduce((acc, item) => acc + lineTotal(item), 0));
    const vatTotal = round2(subtotal * 0.16);
    const total = round2(subtotal + vatTotal);

    const formatCurrency = (amount: number) =>
        new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount || 0);

    useEffect(() => {
        async function fetchClients() {
            try {
                const { data, error } = await supabase
                    .from("clients")
                    .select("id, business_name")
                    .order("business_name", { ascending: true });
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

    // Términos genéricos (Configuración) se guardan silenciosamente para el PDF.
    useEffect(() => {
        (async () => {
            const { data } = await supabase
                .from("company_settings")
                .select("default_quotation_terms")
                .limit(1)
                .maybeSingle();
            if (data?.default_quotation_terms) setDefaultTerms(data.default_quotation_terms);
        })();
    }, []);

    const onSubmit = async (data: QuickFormValues) => {
        setIsSubmitting(true);
        setErrorMsg(null);
        try {
            const cleanCommissioners = normalizeCommissioners(data.commissioners);

            const quoteData = {
                client_id: data.client_id,
                seller: data.seller || null,
                delivery_time: data.delivery_time || null,
                terms_conditions: defaultTerms || null,
                commissioners: cleanCommissioners,
                subtotal,
                vat_total: vatTotal,
                total,
                status: "Draft",
            };

            const { data: insertedQuote, error: quoteError } = await supabase
                .from("quotations")
                .insert([quoteData])
                .select()
                .single();

            if (quoteError) throw quoteError;

            // En cotización rápida el precio capturado ES el precio al cliente:
            // no hay margen (costo = precio, margin_pct = 0).
            const itemsToInsert = data.items.map((item) => {
                const qty = Number(item.quantity) || 1;
                const price = Number(item.unit_price) || 0;
                const line = round2(qty * price);
                return {
                    quotation_id: insertedQuote.id,
                    description: item.description,
                    quantity: qty,
                    unit_price: price,
                    line_total: line,
                    cost_unit_price: price,
                    cost_line_total: line,
                    margin_pct: 0,
                    item_type: "product",
                    service_concepts: null,
                };
            });

            const { error: itemsError } = await supabase.from("quotation_items").insert(itemsToInsert);
            if (itemsError) throw itemsError;

            await rememberCommissionAgents(cleanCommissioners.map((c) => c.name));

            router.push("/sales");
        } catch (error: any) {
            console.error("Error saving quick quotation:", error);
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
                            <Zap className="w-8 h-8 text-amber-400" />
                            Cotización Rápida
                        </h1>
                        <p className="text-neutral-400 text-sm mt-1">Solo descripción y precio — sin costos ni márgenes</p>
                    </div>
                </header>

                {errorMsg && (
                    <div className="p-4 rounded-xl border bg-red-500/10 border-red-500/30 text-red-400 flex items-center gap-3">
                        <AlertCircle className="w-5 h-5 flex-shrink-0" />
                        {errorMsg}
                    </div>
                )}

                <form onSubmit={handleSubmit(onSubmit as any)} className="space-y-8">
                    {/* Cliente + info básica */}
                    <div className="bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                        <h2 className="text-lg font-semibold text-white mb-4">Cliente</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2 md:col-span-2">
                                <label className="text-sm font-medium text-neutral-300 ml-1">Seleccionar Cliente *</label>
                                <div className="relative">
                                    <select
                                        {...register("client_id")}
                                        className={cn(
                                            "w-full bg-neutral-900/50 border rounded-xl px-4 py-3 text-white appearance-none focus:outline-none focus:ring-2 transition-all",
                                            errors.client_id ? "border-red-500/50 focus:border-red-500 focus:ring-red-500/20" : "border-neutral-700 focus:border-amber-500 focus:ring-amber-500/20"
                                        )}
                                        disabled={isLoadingClients}
                                    >
                                        <option value="" disabled>Elige un cliente...</option>
                                        {clients.map((c) => (
                                            <option key={c.id} value={c.id}>{c.business_name}</option>
                                        ))}
                                    </select>
                                    <div className="absolute inset-y-0 right-0 flex items-center px-4 pointer-events-none text-neutral-500">
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                                    </div>
                                </div>
                                {errors.client_id && <p className="text-red-400 text-xs ml-1">{errors.client_id.message}</p>}
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-neutral-300 ml-1">Vendedor</label>
                                <input
                                    {...register("seller")}
                                    className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-4 py-3 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 transition-all"
                                    placeholder="Nombre del vendedor"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-neutral-300 ml-1">Tiempo de Entrega</label>
                                <input
                                    {...register("delivery_time")}
                                    className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-4 py-3 text-white placeholder-neutral-500 focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 transition-all"
                                    placeholder="Ej: 5 días hábiles"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Partidas */}
                    <div className="bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                        <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
                            <h2 className="text-lg font-semibold text-white">Productos</h2>
                            <button
                                type="button"
                                onClick={() => append({ ...emptyItem })}
                                className="flex items-center gap-2 text-sm text-amber-300 hover:text-amber-200 font-medium bg-amber-500/10 hover:bg-amber-500/20 px-4 py-2 rounded-lg transition-colors border border-amber-500/20"
                            >
                                <Plus className="w-4 h-4" /> Agregar línea
                            </button>
                        </div>

                        <div className="space-y-4">
                            {fields.map((field, index) => {
                                const item = watchItems?.[index];
                                return (
                                    <div key={field.id} className="grid grid-cols-1 md:grid-cols-[1fr_110px_150px_150px_auto] gap-3 items-end bg-neutral-900/30 p-4 rounded-xl border border-neutral-700/40">
                                        <div className="space-y-1">
                                            <label className="text-xs text-neutral-400 ml-1">Descripción</label>
                                            <input
                                                {...register(`items.${index}.description` as const)}
                                                className={cn("w-full bg-neutral-900/80 border rounded-lg px-3 py-2 text-white placeholder-neutral-600 focus:outline-none focus:ring-1 transition-all",
                                                    errors.items?.[index]?.description ? "border-red-500 focus:border-red-500 focus:ring-red-500" : "border-neutral-700 focus:border-amber-500 focus:ring-amber-500")}
                                                placeholder="Descripción del producto..."
                                            />
                                            {errors.items?.[index]?.description && <p className="text-red-400 text-xs ml-1">{errors.items[index]?.description?.message as string}</p>}
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs text-neutral-400 ml-1">Cantidad</label>
                                            <input type="number" step="any"
                                                {...register(`items.${index}.quantity` as const, { valueAsNumber: true })}
                                                className={cn("w-full bg-neutral-900/80 border rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 transition-all",
                                                    errors.items?.[index]?.quantity ? "border-red-500 focus:border-red-500 focus:ring-red-500" : "border-neutral-700 focus:border-amber-500 focus:ring-amber-500")}
                                            />
                                            {errors.items?.[index]?.quantity && <p className="text-red-400 text-xs ml-1">{errors.items[index]?.quantity?.message as string}</p>}
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs text-neutral-400 ml-1">Precio unitario ($)</label>
                                            <input type="number" step="any"
                                                {...register(`items.${index}.unit_price` as const, { valueAsNumber: true })}
                                                className={cn("w-full bg-neutral-900/80 border rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 transition-all",
                                                    errors.items?.[index]?.unit_price ? "border-red-500 focus:border-red-500 focus:ring-red-500" : "border-neutral-700 focus:border-amber-500 focus:ring-amber-500")}
                                            />
                                            {errors.items?.[index]?.unit_price && <p className="text-red-400 text-xs ml-1">{errors.items[index]?.unit_price?.message as string}</p>}
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs text-amber-400 ml-1">Importe</label>
                                            <div className="w-full bg-amber-500/10 border border-amber-500/40 rounded-lg px-3 py-2 text-amber-300 font-bold">{formatCurrency(lineTotal(item))}</div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => remove(index)}
                                            disabled={fields.length === 1}
                                            className="text-neutral-500 hover:text-red-400 disabled:opacity-30 disabled:hover:text-neutral-500 transition-colors p-2 rounded-lg hover:bg-neutral-800 md:mb-0.5"
                                            title="Eliminar línea"
                                        >
                                            <Trash2 className="w-5 h-5" />
                                        </button>
                                    </div>
                                );
                            })}
                            {typeof errors.items?.message === "string" && <p className="text-red-400 text-xs ml-1">{errors.items.message}</p>}
                        </div>
                    </div>

                    {/* Comisionados */}
                    <CommissionersSection control={control} register={register} />

                    {/* Totals & Submit */}
                    <div className="flex flex-col md:flex-row justify-between items-end gap-6 bg-neutral-800/20 p-6 rounded-3xl border border-neutral-700/30">
                        <div className="w-full md:w-auto">
                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className="w-full md:w-auto bg-amber-500 hover:bg-amber-600 disabled:bg-amber-500/50 text-white px-10 py-4 rounded-xl font-bold transition-all shadow-[0_0_15px_rgba(245,158,11,0.2)] hover:shadow-[0_0_20px_rgba(245,158,11,0.4)] flex items-center justify-center gap-2 text-lg"
                            >
                                {isSubmitting ? (
                                    <><RefreshCw className="w-5 h-5 animate-spin" /> Guardando...</>
                                ) : (
                                    <><Save className="w-5 h-5" /> Guardar Cotización</>
                                )}
                            </button>
                        </div>

                        <div className="w-full md:w-80 space-y-3 bg-neutral-900/50 p-6 rounded-2xl border border-neutral-700/50">
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
                                <span className="text-amber-400">{formatCurrency(total)}</span>
                            </div>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
}
