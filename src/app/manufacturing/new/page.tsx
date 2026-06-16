"use client";

import { useEffect, useState, Suspense } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, Save, Plus, Trash2, Factory, AlertCircle, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

const OPERATION_TYPES = [
    "Cortar", "Maquinar", "Soldar", "Doblar", "Pulir",
    "Pintar", "Ensamblar", "Inspección", "Embalaje", "Otro"
];

const operationSchema = z.object({
    operation_type: z.string().min(1, "Select an operation"),
    description: z.string().optional(),
});

const workOrderSchema = z.object({
    quotation_id: z.string().min(1, "Select a quotation"),
    notes: z.string().optional(),
    operations: z.array(operationSchema).min(1, "At least one operation is required"),
});

type WorkOrderFormValues = z.infer<typeof workOrderSchema>;

type Quotation = {
    id: string;
    quotation_number: string;
    client: { business_name: string };
};

function NewWorkOrderForm() {
    const router = useRouter();
    const [quotations, setQuotations] = useState<Quotation[]>([]);
    const [isLoadingQuotations, setIsLoadingQuotations] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const {
        register, control, handleSubmit, formState: { errors }
    } = useForm<WorkOrderFormValues>({
        resolver: zodResolver(workOrderSchema) as any,
        defaultValues: {
            quotation_id: "",
            notes: "",
            operations: [{ operation_type: "", description: "" }]
        }
    });

    const { fields, append, remove } = useFieldArray({ control, name: "operations" });

    useEffect(() => {
        async function fetchQuotations() {
            try {
                const { data, error } = await supabase
                    .from('quotations')
                    .select('id, quotation_number, client:clients(business_name)')
                    .eq('status', 'Approved')
                    .order('created_at', { ascending: false });
                if (error) throw error;
                const formatted = (data as any[]).map(q => ({
                    ...q,
                    client: Array.isArray(q.client) ? q.client[0] : q.client
                }));
                setQuotations(formatted || []);
            } catch (err) {
                console.error("Failed to load quotations", err);
            } finally {
                setIsLoadingQuotations(false);
            }
        }
        fetchQuotations();
    }, []);

    const onSubmit = async (data: WorkOrderFormValues) => {
        setIsSubmitting(true);
        setErrorMsg(null);
        try {
            // Find the quotation to derive the OT number
            const selectedQ = quotations.find(q => q.id === data.quotation_id);
            if (!selectedQ) throw new Error("Quotation not found");

            // Derive OT number: SMAA00001 -> OT00001
            const digits = selectedQ.quotation_number.replace('SMAA', '');
            const orderNumber = `OT${digits}`;

            // Insert Work Order
            const { data: insertedWO, error: woError } = await supabase
                .from('work_orders')
                .insert([{
                    order_number: orderNumber,
                    quotation_id: data.quotation_id,
                    notes: data.notes || null,
                    status: 'Open'
                }])
                .select()
                .single();

            if (woError) throw woError;

            // Insert Operations
            const opsToInsert = data.operations.map((op, idx) => ({
                work_order_id: insertedWO.id,
                sequence: idx + 1,
                operation_type: op.operation_type,
                description: op.description || null,
                status: 'Pending'
            }));

            const { error: opsError } = await supabase
                .from('work_order_operations')
                .insert(opsToInsert);

            if (opsError) throw opsError;

            router.push(`/manufacturing/${insertedWO.id}`);

        } catch (error: any) {
            console.error("Error creating work order:", error);
            setErrorMsg(error.message || "Failed to create work order.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-6 md:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-5xl mx-auto space-y-8">
                <header className="flex items-center gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <Link href="/manufacturing" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors text-neutral-400 hover:text-white border border-neutral-700">
                        <ArrowLeft className="w-5 h-5" />
                    </Link>
                    <div>
                        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                            <Factory className="w-8 h-8 text-orange-400" />
                            Nueva Orden de Trabajo
                        </h1>
                        <p className="text-neutral-400 text-sm mt-1">Create a work order linked to an approved quotation</p>
                    </div>
                </header>

                {errorMsg && (
                    <div className="p-4 rounded-xl border bg-red-500/10 border-red-500/30 text-red-400 flex items-center gap-3">
                        <AlertCircle className="w-5 h-5 flex-shrink-0" />
                        {errorMsg}
                    </div>
                )}

                <form onSubmit={handleSubmit(onSubmit as any)} className="space-y-8">
                    {/* Quotation Selection */}
                    <div className="bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                        <h2 className="text-lg font-semibold text-white mb-4">Cotización Asociada</h2>
                        <div className="space-y-2 max-w-xl">
                            <label className="text-sm font-medium text-neutral-300 ml-1">Seleccionar Cotización Aprobada *</label>
                            <select
                                {...register("quotation_id")}
                                className={cn(
                                    "w-full bg-neutral-900/50 border rounded-xl px-4 py-3 text-white appearance-none focus:outline-none focus:ring-2 transition-all",
                                    errors.quotation_id ? "border-red-500 focus:ring-red-500/20" : "border-neutral-700 focus:border-orange-500 focus:ring-orange-500/20"
                                )}
                                disabled={isLoadingQuotations}
                            >
                                <option value="" disabled>Elige una cotización...</option>
                                {quotations.map(q => (
                                    <option key={q.id} value={q.id}>
                                        {q.quotation_number} — {q.client?.business_name || 'Unknown'}
                                    </option>
                                ))}
                            </select>
                            {errors.quotation_id && <p className="text-red-400 text-xs ml-1">{errors.quotation_id.message}</p>}
                        </div>
                        <div className="mt-4 max-w-xl space-y-2">
                            <label className="text-sm font-medium text-neutral-300 ml-1">Notas (opcional)</label>
                            <textarea
                                {...register("notes")}
                                className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 transition-all min-h-[80px]"
                                placeholder="Notes about this work order..."
                            />
                        </div>
                    </div>

                    {/* Operations */}
                    <div className="bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-lg font-semibold text-white">Operaciones (Routing)</h2>
                            <button type="button"
                                onClick={() => append({ operation_type: "", description: "" })}
                                className="flex items-center gap-2 text-sm text-orange-400 hover:text-orange-300 font-medium bg-orange-500/10 hover:bg-orange-500/20 px-4 py-2 rounded-lg transition-colors border border-orange-500/20"
                            >
                                <Plus className="w-4 h-4" /> Agregar Operación
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div className="hidden md:grid grid-cols-12 gap-4 text-xs font-semibold text-neutral-400 uppercase tracking-wider px-2">
                                <div className="col-span-1">#</div>
                                <div className="col-span-4">Tipo de Operación</div>
                                <div className="col-span-6">Descripción</div>
                                <div className="col-span-1 text-center"></div>
                            </div>

                            {fields.map((field, index) => (
                                <div key={field.id} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start bg-neutral-900/30 p-4 md:p-3 rounded-xl border border-neutral-700/30 md:border-none focus-within:bg-neutral-800/60 transition-colors">
                                    <div className="md:col-span-1 flex items-center justify-center">
                                        <span className="text-neutral-500 font-mono text-sm bg-neutral-800/50 px-2 py-1 rounded">{index + 1}</span>
                                    </div>

                                    <div className="md:col-span-4 space-y-1">
                                        <label className="md:hidden text-xs text-neutral-400 ml-1">Tipo</label>
                                        <select
                                            {...register(`operations.${index}.operation_type` as const)}
                                            className={cn(
                                                "w-full bg-neutral-900/80 border rounded-lg px-3 py-2 text-white appearance-none focus:outline-none focus:ring-1 transition-all",
                                                errors.operations?.[index]?.operation_type ? "border-red-500 focus:ring-red-500" : "border-neutral-700 focus:border-orange-500 focus:ring-orange-500"
                                            )}
                                        >
                                            <option value="" disabled>Seleccionar...</option>
                                            {OPERATION_TYPES.map(op => (
                                                <option key={op} value={op}>{op}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="md:col-span-6 space-y-1">
                                        <label className="md:hidden text-xs text-neutral-400 ml-1">Descripción</label>
                                        <input
                                            {...register(`operations.${index}.description` as const)}
                                            className="w-full bg-neutral-900/80 border border-neutral-700 rounded-lg px-3 py-2 text-white placeholder-neutral-600 focus:outline-none focus:ring-1 focus:border-orange-500 focus:ring-orange-500 transition-all"
                                            placeholder="Details about this operation..."
                                        />
                                    </div>

                                    <div className="md:col-span-1 flex items-center justify-end md:justify-center">
                                        <button type="button" onClick={() => remove(index)} disabled={fields.length === 1}
                                            className="text-neutral-500 hover:text-red-400 disabled:opacity-30 transition-colors p-2 rounded-lg hover:bg-neutral-800"
                                        >
                                            <Trash2 className="w-5 h-5" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Submit */}
                    <div className="flex justify-end">
                        <button type="submit" disabled={isSubmitting}
                            className="w-full md:w-auto bg-orange-500 hover:bg-orange-600 disabled:bg-orange-500/50 text-white px-10 py-4 rounded-xl font-bold transition-all shadow-[0_0_15px_rgba(249,115,22,0.2)] hover:shadow-[0_0_20px_rgba(249,115,22,0.4)] flex items-center justify-center gap-2 text-lg"
                        >
                            {isSubmitting ? (
                                <><RefreshCw className="w-5 h-5 animate-spin" /> Creando...</>
                            ) : (
                                <><Save className="w-5 h-5" /> Crear Orden de Trabajo</>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default function NewWorkOrderPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
                <RefreshCw className="w-8 h-8 animate-spin text-orange-400" />
            </div>
        }>
            <NewWorkOrderForm />
        </Suspense>
    );
}
