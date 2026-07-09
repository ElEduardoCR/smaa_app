"use client";

import { useEffect, useState, Suspense } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, Save, Plus, Trash2, Calculator, AlertCircle, RefreshCw, Clock, Package, Wrench } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";
import ServiceConceptsModal, { ServiceConcept } from "@/app/sales/ServiceConceptsModal";
import CommissionersSection from "@/app/sales/CommissionersSection";
import { normalizeCommissioners, rememberCommissionAgents } from "@/lib/commissioners";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

// Zod Schema
const conceptSchema = z.object({
    concept: z.string(),
    rate: z.coerce.number(),
    hours: z.coerce.number(),
});

const itemSchema = z
    .object({
        item_type: z.enum(["product", "service"]).default("product"),
        description: z.string().optional().or(z.literal("")),
        quantity: z.coerce.number().optional(),
        unit_price: z.coerce.number().optional(),
        margin_pct: z.coerce.number().catch(38),
        service_concepts: z.array(conceptSchema).optional().default([]),
    })
    .superRefine((val, ctx) => {
        // Cantidad aplica a productos y servicios
        if (val.quantity === undefined || isNaN(val.quantity) || val.quantity < 1) {
            ctx.addIssue({ code: "custom", path: ["quantity"], message: "Mínimo 1" });
        }
        if (val.item_type === "service") {
            if (!val.service_concepts || val.service_concepts.length === 0) {
                ctx.addIssue({ code: "custom", path: ["service_concepts"], message: "Agrega al menos un concepto" });
            }
        } else {
            if (!val.description || val.description.trim() === "") {
                ctx.addIssue({ code: "custom", path: ["description"], message: "Descripción requerida" });
            }
            if (val.unit_price === undefined || isNaN(val.unit_price) || val.unit_price < 0) {
                ctx.addIssue({ code: "custom", path: ["unit_price"], message: "Inválido" });
            }
        }
    });

const commissionerSchema = z.object({
    name: z.string().optional().or(z.literal("")),
    amount: z.coerce.number().catch(0),
});

const quotationSchema = z.object({
    client_id: z.string().min(1, "Please select a client"),
    seller: z.string().optional().or(z.literal("")),
    delivery_time: z.string().optional().or(z.literal("")),
    terms_conditions: z.string().optional().or(z.literal("")),
    items: z.array(itemSchema).min(1, "At least one item is required"),
    commissioners: z.array(commissionerSchema).optional().default([]),
});

type QuotationFormValues = z.infer<typeof quotationSchema>;

const DEFAULT_MARGIN = 38; // utilidad por defecto (%)
const emptyProduct = { item_type: "product" as const, description: "", quantity: 1, unit_price: 0, margin_pct: DEFAULT_MARGIN, service_concepts: [] as ServiceConcept[] };

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

function qtyOf(item: any): number {
    const q = Number(item?.quantity);
    return isNaN(q) || q <= 0 ? 1 : q;
}

// Costo de una línea (cantidad-aware) según su tipo. Servicios y productos usan cantidad.
function lineAmount(item: any): number {
    if (item?.item_type === "service") {
        const unit = (item.service_concepts || []).reduce(
            (acc: number, c: any) => acc + (Number(c.rate) || 0) * (Number(c.hours) || 0),
            0
        );
        return qtyOf(item) * unit;
    }
    return qtyOf(item) * (Number(item?.unit_price) || 0);
}

function marginOf(item: any): number {
    const m = Number(item?.margin_pct);
    return isNaN(m) ? DEFAULT_MARGIN : m;
}

function QuotationForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const editId = searchParams.get("id");
    const isEditing = !!editId;

    const [clients, setClients] = useState<{ id: string; business_name: string }[]>([]);
    const [isLoadingClients, setIsLoadingClients] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [serviceModalIndex, setServiceModalIndex] = useState<number | null>(null);
    const [marginMode, setMarginMode] = useState<"general" | "specific">("general");
    const [generalMargin, setGeneralMargin] = useState<number>(DEFAULT_MARGIN);

    const {
        register,
        control,
        handleSubmit,
        watch,
        reset,
        setValue,
        formState: { errors },
    } = useForm<QuotationFormValues>({
        resolver: zodResolver(quotationSchema) as any,
        defaultValues: {
            client_id: "",
            seller: "",
            delivery_time: "",
            terms_conditions: "",
            items: [{ ...emptyProduct }],
            commissioners: [],
        },
    });

    const { fields, append, remove } = useFieldArray({ control, name: "items" });

    const watchItems = watch("items");

    // Utilidad efectiva por línea: general (una para todas) o específica por línea
    const effectiveMargin = (item: any) =>
        marginMode === "general" ? (Number.isFinite(generalMargin) ? generalMargin : 0) : marginOf(item);
    const lineSelling = (item: any) => round2(lineAmount(item) * (1 + effectiveMargin(item) / 100));

    const applyMarginMode = (mode: "general" | "specific") => {
        if (mode === "specific") {
            // arranca cada línea desde la utilidad general
            const n = (watchItems || []).length;
            for (let i = 0; i < n; i++) setValue(`items.${i}.margin_pct`, generalMargin, { shouldDirty: true });
        }
        setMarginMode(mode);
    };

    // Calculations — el subtotal/IVA/total de la cotización son el PRECIO al cliente (con utilidad)
    const costSubtotal = round2((watchItems || []).reduce((acc, item) => acc + lineAmount(item), 0));
    const subtotal = round2((watchItems || []).reduce((acc, item) => acc + lineSelling(item), 0));
    const profitTotal = round2(subtotal - costSubtotal);
    const vatTotal = round2(subtotal * 0.16); // 16% IVA
    const total = round2(subtotal + vatTotal);

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount || 0);
    };

    const setItemType = (index: number, type: "product" | "service") => {
        setValue(`items.${index}.item_type`, type, { shouldDirty: true, shouldValidate: false });
        if (type === "service" && !watchItems?.[index]?.service_concepts) {
            setValue(`items.${index}.service_concepts`, [], { shouldDirty: true });
        }
    };

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

    // Precarga los términos y condiciones genéricos (Configuración) en una cotización nueva
    useEffect(() => {
        if (isEditing) return;
        (async () => {
            const { data } = await supabase
                .from("company_settings")
                .select("default_quotation_terms")
                .limit(1)
                .maybeSingle();
            if (data?.default_quotation_terms) {
                setValue("terms_conditions", data.default_quotation_terms);
            }
        })();
    }, [isEditing, setValue]);

    useEffect(() => {
        async function fetchQuote() {
            if (!editId) return;
            try {
                const { data: quote, error: quoteError } = await supabase
                    .from("quotations")
                    .select("*")
                    .eq("id", editId)
                    .single();

                if (quoteError) throw quoteError;

                const { data: items, error: itemsError } = await supabase
                    .from("quotation_items")
                    .select("*")
                    .eq("quotation_id", editId);

                if (itemsError) throw itemsError;

                reset({
                    client_id: quote.client_id,
                    seller: quote.seller || "",
                    delivery_time: quote.delivery_time || "",
                    terms_conditions: quote.terms_conditions || "",
                    items: (items || []).map((i: any) => ({
                        item_type: i.item_type === "service" ? "service" : "product",
                        description: i.description || "",
                        quantity: i.quantity,
                        // El form trabaja con COSTOS: usa cost_unit_price (fallback a unit_price para filas viejas)
                        unit_price: i.cost_unit_price != null ? i.cost_unit_price : i.unit_price,
                        margin_pct: i.margin_pct != null ? i.margin_pct : DEFAULT_MARGIN,
                        service_concepts: Array.isArray(i.service_concepts) ? i.service_concepts : [],
                    })),
                    commissioners: normalizeCommissioners(quote.commissioners),
                });

                // Reconstruye el modo de utilidad: si todas las líneas comparten el mismo % => general
                const margins = (items || []).map((i: any) => Number(i.margin_pct ?? DEFAULT_MARGIN));
                if (margins.length > 0 && margins.every((m: number) => m === margins[0])) {
                    setMarginMode("general");
                    setGeneralMargin(margins[0]);
                } else {
                    setMarginMode("specific");
                }
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
            const cleanCommissioners = normalizeCommissioners(data.commissioners);

            if (isEditing) {
                const { error: quoteError } = await supabase
                    .from("quotations")
                    .update({
                        client_id: data.client_id,
                        seller: data.seller || null,
                        delivery_time: data.delivery_time || null,
                        terms_conditions: data.terms_conditions || null,
                        commissioners: cleanCommissioners,
                        subtotal,
                        vat_total: vatTotal,
                        total,
                        updated_at: new Date().toISOString(),
                    })
                    .eq("id", editId);

                if (quoteError) throw quoteError;

                const { error: delError } = await supabase
                    .from("quotation_items")
                    .delete()
                    .eq("quotation_id", editId);

                if (delError) throw delError;
            } else {
                const quoteData = {
                    client_id: data.client_id,
                    seller: data.seller || null,
                    delivery_time: data.delivery_time || null,
                    terms_conditions: data.terms_conditions || null,
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
                currentQuoteId = insertedQuote.id;
            }

            // Map form items to DB rows.
            // unit_price / line_total = PRECIO al cliente (costo + utilidad).
            // cost_unit_price / cost_line_total = costo interno. margin_pct = utilidad %.
            const itemsToInsert = data.items.map((item) => {
                const margin = effectiveMargin(item);
                const factor = 1 + margin / 100;
                if (item.item_type === "service") {
                    const concepts = (item.service_concepts || []).map((c) => ({
                        concept: c.concept,
                        rate: Number(c.rate) || 0,
                        hours: Number(c.hours) || 0,
                    }));
                    const qty = Number(item.quantity) || 1;
                    const unitCost = round2(concepts.reduce((a, c) => a + c.rate * c.hours, 0));
                    const saleUnit = round2(unitCost * factor);
                    const name = item.description && item.description.trim() ? item.description.trim() : "";
                    const description = name || `Servicio: ${concepts.map((c) => c.concept).join(", ")}` || "Servicio";
                    return {
                        quotation_id: currentQuoteId,
                        description,
                        quantity: qty,
                        unit_price: saleUnit,
                        line_total: round2(qty * saleUnit),
                        cost_unit_price: unitCost,
                        cost_line_total: round2(qty * unitCost),
                        margin_pct: margin,
                        item_type: "service",
                        service_concepts: concepts,
                    };
                }
                const qty = Number(item.quantity) || 0;
                const costUnit = Number(item.unit_price) || 0;
                const saleUnit = round2(costUnit * factor);
                return {
                    quotation_id: currentQuoteId,
                    description: item.description || "",
                    quantity: qty,
                    unit_price: saleUnit,
                    line_total: round2(qty * saleUnit),
                    cost_unit_price: costUnit,
                    cost_line_total: round2(qty * costUnit),
                    margin_pct: margin,
                    item_type: "product",
                    service_concepts: null,
                };
            });

            const { error: itemsError } = await supabase.from("quotation_items").insert(itemsToInsert);

            if (itemsError) throw itemsError;

            // Recuerda los nombres de comisionados para reusarlos (no bloquea el guardado)
            await rememberCommissionAgents(cleanCommissioners.map((c) => c.name));

            router.push("/sales");
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
                        <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
                            <h2 className="text-lg font-semibold text-white">Productos / Servicios</h2>
                            <div className="flex flex-wrap items-center gap-3">
                                {/* Switch: utilidad general vs específica */}
                                <div className="inline-flex rounded-lg border border-neutral-700 overflow-hidden text-xs">
                                    <button
                                        type="button"
                                        onClick={() => applyMarginMode("general")}
                                        className={cn("px-3 py-1.5 font-medium transition-colors", marginMode === "general" ? "bg-orange-500/20 text-orange-300" : "text-neutral-400 hover:text-white")}
                                    >
                                        Utilidad general
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => applyMarginMode("specific")}
                                        className={cn("px-3 py-1.5 font-medium transition-colors border-l border-neutral-700", marginMode === "specific" ? "bg-orange-500/20 text-orange-300" : "text-neutral-400 hover:text-white")}
                                    >
                                        Específica por línea
                                    </button>
                                </div>
                                {marginMode === "general" && (
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-orange-400 font-medium">Utilidad %</span>
                                        <input
                                            type="number"
                                            step="any"
                                            value={Number.isFinite(generalMargin) ? generalMargin : ""}
                                            onChange={(e) => setGeneralMargin(e.target.value === "" ? NaN : Number(e.target.value))}
                                            className="w-20 bg-neutral-900/80 border border-orange-500/40 rounded-lg px-3 py-1.5 text-orange-300 text-sm focus:outline-none focus:border-orange-500"
                                        />
                                    </div>
                                )}
                                <button
                                    type="button"
                                    onClick={() => append({ ...emptyProduct })}
                                    className="flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300 font-medium bg-emerald-500/10 hover:bg-emerald-500/20 px-4 py-2 rounded-lg transition-colors border border-emerald-500/20"
                                >
                                    <Plus className="w-4 h-4" /> Agregar línea
                                </button>
                            </div>
                        </div>

                        <div className="space-y-4">
                            {fields.map((field, index) => {
                                const item = watchItems?.[index];
                                const isService = item?.item_type === "service";
                                const concepts: ServiceConcept[] = (item?.service_concepts as ServiceConcept[]) || [];
                                const amount = lineAmount(item);
                                const sale = lineSelling(item);

                                return (
                                    <div key={field.id} className="bg-neutral-900/30 p-4 rounded-xl border border-neutral-700/40 space-y-4">
                                        {/* Tipo + eliminar */}
                                        <div className="flex justify-between items-center gap-4">
                                            <div className="inline-flex rounded-lg border border-neutral-700 overflow-hidden text-sm">
                                                <button
                                                    type="button"
                                                    onClick={() => setItemType(index, "product")}
                                                    className={cn(
                                                        "flex items-center gap-1.5 px-3 py-1.5 font-medium transition-colors",
                                                        !isService ? "bg-emerald-500/20 text-emerald-300" : "text-neutral-400 hover:text-white"
                                                    )}
                                                >
                                                    <Package className="w-4 h-4" /> Producto
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setItemType(index, "service")}
                                                    className={cn(
                                                        "flex items-center gap-1.5 px-3 py-1.5 font-medium transition-colors border-l border-neutral-700",
                                                        isService ? "bg-emerald-500/20 text-emerald-300" : "text-neutral-400 hover:text-white"
                                                    )}
                                                >
                                                    <Wrench className="w-4 h-4" /> Servicio
                                                </button>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => remove(index)}
                                                disabled={fields.length === 1}
                                                className="text-neutral-500 hover:text-red-400 disabled:opacity-30 disabled:hover:text-neutral-500 transition-colors p-2 rounded-lg hover:bg-neutral-800"
                                                title="Eliminar línea"
                                            >
                                                <Trash2 className="w-5 h-5" />
                                            </button>
                                        </div>

                                        {!isService ? (
                                            /* PRODUCTO */
                                            <div className="space-y-4">
                                                <div className="space-y-1">
                                                    <label className="text-xs text-neutral-400 ml-1">Descripción</label>
                                                    <input
                                                        {...register(`items.${index}.description` as const)}
                                                        className={cn(
                                                            "w-full bg-neutral-900/80 border rounded-lg px-3 py-2 text-white placeholder-neutral-600 focus:outline-none focus:ring-1 transition-all",
                                                            errors.items?.[index]?.description ? "border-red-500 focus:border-red-500 focus:ring-red-500" : "border-neutral-700 focus:border-emerald-500 focus:ring-emerald-500"
                                                        )}
                                                        placeholder="Descripción del producto..."
                                                    />
                                                    {errors.items?.[index]?.description && <p className="text-red-400 text-xs ml-1">{errors.items[index]?.description?.message as string}</p>}
                                                </div>
                                                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                                                    <div className="space-y-1">
                                                        <label className="text-xs text-neutral-400 ml-1">Cantidad</label>
                                                        <input type="number" step="any"
                                                            {...register(`items.${index}.quantity` as const, { valueAsNumber: true })}
                                                            className={cn("w-full bg-neutral-900/80 border rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 transition-all",
                                                                errors.items?.[index]?.quantity ? "border-red-500 focus:border-red-500 focus:ring-red-500" : "border-neutral-700 focus:border-emerald-500 focus:ring-emerald-500")}
                                                        />
                                                        {errors.items?.[index]?.quantity && <p className="text-red-400 text-xs ml-1">{errors.items[index]?.quantity?.message as string}</p>}
                                                    </div>
                                                    <div className="space-y-1">
                                                        <label className="text-xs text-neutral-400 ml-1">Costo unitario ($)</label>
                                                        <input type="number" step="any"
                                                            {...register(`items.${index}.unit_price` as const, { valueAsNumber: true })}
                                                            className={cn("w-full bg-neutral-900/80 border rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 transition-all",
                                                                errors.items?.[index]?.unit_price ? "border-red-500 focus:border-red-500 focus:ring-red-500" : "border-neutral-700 focus:border-emerald-500 focus:ring-emerald-500")}
                                                        />
                                                        {errors.items?.[index]?.unit_price && <p className="text-red-400 text-xs ml-1">{errors.items[index]?.unit_price?.message as string}</p>}
                                                    </div>
                                                    <div className="space-y-1">
                                                        <label className="text-xs text-neutral-400 ml-1">Mi costo</label>
                                                        <div className="w-full bg-neutral-900/40 border border-neutral-800 rounded-lg px-3 py-2 text-neutral-300 font-medium">{formatCurrency(amount)}</div>
                                                    </div>
                                                    <div className="space-y-1">
                                                        <label className="text-xs text-orange-400 ml-1">Utilidad %</label>
                                                        {marginMode === "specific" ? (
                                                            <input type="number" step="any"
                                                                {...register(`items.${index}.margin_pct` as const, { valueAsNumber: true })}
                                                                className="w-full bg-neutral-900/80 border border-orange-500/40 rounded-lg px-3 py-2 text-orange-300 focus:outline-none focus:ring-1 focus:border-orange-500 focus:ring-orange-500 transition-all"
                                                            />
                                                        ) : (
                                                            <div className="w-full bg-neutral-900/40 border border-neutral-800 rounded-lg px-3 py-2 text-neutral-500" title="Definida por la utilidad general">
                                                                {Number.isFinite(generalMargin) ? generalMargin : 0}%
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="space-y-1">
                                                        <label className="text-xs text-orange-400 ml-1">Precio</label>
                                                        <div className="w-full bg-orange-500/10 border border-orange-500/40 rounded-lg px-3 py-2 text-orange-300 font-bold">{formatCurrency(sale)}</div>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            /* SERVICIO */
                                            <div className="space-y-4">
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                    <div className="space-y-1">
                                                        <label className="text-xs text-neutral-400 ml-1">Nombre del servicio (opcional)</label>
                                                        <input
                                                            {...register(`items.${index}.description` as const)}
                                                            className="w-full bg-neutral-900/80 border border-neutral-700 rounded-lg px-3 py-2 text-white placeholder-neutral-600 focus:outline-none focus:ring-1 focus:border-emerald-500 focus:ring-emerald-500 transition-all"
                                                            placeholder="Ej: Fabricación de estructura"
                                                        />
                                                    </div>
                                                    <div className="space-y-1">
                                                        <label className="text-xs text-neutral-400 ml-1">Conceptos / horas</label>
                                                        <button
                                                            type="button"
                                                            onClick={() => setServiceModalIndex(index)}
                                                            className={cn(
                                                                "w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border font-medium transition-colors",
                                                                concepts.length > 0
                                                                    ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/20"
                                                                    : "bg-neutral-900/80 border-neutral-700 text-neutral-300 hover:border-emerald-500"
                                                            )}
                                                        >
                                                            <Clock className="w-4 h-4" />
                                                            {concepts.length > 0 ? `${concepts.length} concepto${concepts.length > 1 ? "s" : ""}` : "Agregar conceptos"}
                                                        </button>
                                                        {errors.items?.[index]?.service_concepts && (
                                                            <p className="text-red-400 text-xs ml-1">{(errors.items[index]?.service_concepts as any)?.message || "Agrega al menos un concepto"}</p>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                                    <div className="space-y-1">
                                                        <label className="text-xs text-neutral-400 ml-1">Cantidad</label>
                                                        <input type="number" step="any"
                                                            {...register(`items.${index}.quantity` as const, { valueAsNumber: true })}
                                                            className={cn("w-full bg-neutral-900/80 border rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 transition-all",
                                                                errors.items?.[index]?.quantity ? "border-red-500 focus:border-red-500 focus:ring-red-500" : "border-neutral-700 focus:border-emerald-500 focus:ring-emerald-500")}
                                                        />
                                                        {errors.items?.[index]?.quantity && <p className="text-red-400 text-xs ml-1">{errors.items[index]?.quantity?.message as string}</p>}
                                                    </div>
                                                    <div className="space-y-1">
                                                        <label className="text-xs text-neutral-400 ml-1">Mi costo</label>
                                                        <div className="w-full bg-neutral-900/40 border border-neutral-800 rounded-lg px-3 py-2 text-neutral-300 font-medium">{formatCurrency(amount)}</div>
                                                    </div>
                                                    <div className="space-y-1">
                                                        <label className="text-xs text-orange-400 ml-1">Utilidad %</label>
                                                        {marginMode === "specific" ? (
                                                            <input type="number" step="any"
                                                                {...register(`items.${index}.margin_pct` as const, { valueAsNumber: true })}
                                                                className="w-full bg-neutral-900/80 border border-orange-500/40 rounded-lg px-3 py-2 text-orange-300 focus:outline-none focus:ring-1 focus:border-orange-500 focus:ring-orange-500 transition-all"
                                                            />
                                                        ) : (
                                                            <div className="w-full bg-neutral-900/40 border border-neutral-800 rounded-lg px-3 py-2 text-neutral-500" title="Definida por la utilidad general">
                                                                {Number.isFinite(generalMargin) ? generalMargin : 0}%
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="space-y-1">
                                                        <label className="text-xs text-orange-400 ml-1">Precio</label>
                                                        <div className="w-full bg-orange-500/10 border border-orange-500/40 rounded-lg px-3 py-2 text-orange-300 font-bold">{formatCurrency(sale)}</div>
                                                    </div>
                                                </div>

                                                {concepts.length > 0 && (
                                                    <div className="flex flex-wrap gap-2 pt-1">
                                                        {concepts.map((c, ci) => (
                                                            <span key={ci} className="text-xs bg-neutral-800/70 border border-neutral-700 rounded-md px-2 py-1 text-neutral-300">
                                                                {c.concept}: {Number(c.hours) || 0} h × {formatCurrency(Number(c.rate) || 0)}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )}
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
                                className="w-full md:w-auto bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-500/50 text-white px-10 py-4 rounded-xl font-bold transition-all shadow-[0_0_15px_rgba(16,185,129,0.2)] hover:shadow-[0_0_20px_rgba(16,185,129,0.4)] flex items-center justify-center gap-2 text-lg"
                            >
                                {isSubmitting ? (
                                    <><RefreshCw className="w-5 h-5 animate-spin" /> Guardando...</>
                                ) : (
                                    <><Save className="w-5 h-5" /> {isEditing ? "Actualizar Cotización" : "Guardar Cotización"}</>
                                )}
                            </button>
                        </div>

                        <div className="w-full md:w-80 space-y-3 bg-neutral-900/50 p-6 rounded-2xl border border-neutral-700/50">
                            <div className="flex justify-between items-center text-xs text-neutral-500">
                                <span>Tu costo total</span>
                                <span>{formatCurrency(costSubtotal)}</span>
                            </div>
                            <div className="flex justify-between items-center text-xs text-orange-400/80 font-medium pb-3 border-b border-neutral-700/50">
                                <span>Utilidad</span>
                                <span>{formatCurrency(profitTotal)}</span>
                            </div>
                            <div className="flex justify-between items-center text-sm text-neutral-400 font-medium">
                                <span>Subtotal (cliente)</span>
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

            {serviceModalIndex !== null && (
                <ServiceConceptsModal
                    initialConcepts={(watchItems?.[serviceModalIndex]?.service_concepts as ServiceConcept[]) || []}
                    onClose={() => setServiceModalIndex(null)}
                    onSave={(concepts) => {
                        setValue(`items.${serviceModalIndex}.service_concepts`, concepts, { shouldDirty: true, shouldValidate: true });
                        setServiceModalIndex(null);
                    }}
                />
            )}
        </div>
    );
}

export default function NewQuotationPage() {
    return (
        <Suspense
            fallback={
                <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-10 font-[family-name:var(--font-sans)]">
                    <RefreshCw className="w-8 h-8 animate-spin text-emerald-400" />
                </div>
            }
        >
            <QuotationForm />
        </Suspense>
    );
}
