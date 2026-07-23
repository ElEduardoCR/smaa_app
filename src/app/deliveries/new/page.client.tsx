"use client";

import { useEffect, useState, Suspense } from "react";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, PackageCheck, Save, AlertCircle, RefreshCw, Truck, MapPin, FileText, Hash } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

type WOOption = {
    id: string;
    order_number: string;
    notes: string | null;
    quotation?: { quotation_number: string; client?: { business_name: string } };
};

function NewDeliveryForm() {
    const router = useRouter();
    const [workOrders, setWorkOrders] = useState<WOOption[]>([]);
    const [isLoadingWOs, setIsLoadingWOs] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const [selectedWOId, setSelectedWOId] = useState("");
    const [observations, setObservations] = useState("");
    const [shippingMethod, setShippingMethod] = useState("");
    const [shippingAddress, setShippingAddress] = useState("");
    const [shippingCarrier, setShippingCarrier] = useState("");
    const [trackingNumber, setTrackingNumber] = useState("");

    useEffect(() => {
        async function fetchWOs() {
            try {
                // Only show WOs released by Quality
                const { data, error } = await supabase
                    .from('work_orders')
                    .select('id, order_number, notes, work_title, client_name, module_id, module:manufacturing_modules(code, name), quotation:quotations(quotation_number, client:clients(business_name, rfc, address, email))')
                    .eq('status', 'QC_Released')
                    .not('id', 'in', `(SELECT work_order_id FROM deliveries)`)
                    .order('qc_released_at', { ascending: false });
                if (error) throw error;

                const formatted = (data as any[]).map(wo => {
                    if (wo.module) wo.module = Array.isArray(wo.module) ? wo.module[0] : wo.module;
                    if (wo.quotation) wo.quotation = Array.isArray(wo.quotation) ? wo.quotation[0] : wo.quotation;
                    if (wo.quotation?.client) wo.quotation.client = Array.isArray(wo.quotation.client) ? wo.quotation.client[0] : wo.quotation.client;
                    return wo;
                });
                setWorkOrders(formatted || []);
            } catch (err) {
                console.error("Failed to load work orders", err);
            } finally {
                setIsLoadingWOs(false);
            }
        }
        fetchWOs();
    }, []);

    const selectedWO = workOrders.find(w => w.id === selectedWOId);

    // Derive delivery number from the OT number: OT-MAQ-00001 -> NE-00001
    const deriveDeliveryNumber = (orderNumber: string) => {
        const digits = orderNumber.replace(/\D/g, '');
        return `NE-${digits}`;
    };

    const onSubmit = async () => {
        if (!selectedWOId) {
            setErrorMsg("Selecciona una Orden de Trabajo.");
            return;
        }

        setIsSubmitting(true);
        setErrorMsg(null);

        try {
            const deliveryNumber = deriveDeliveryNumber(selectedWO!.order_number);

            // 1. Create delivery in stage = ready_for_packaging
            const { error: deliveryError } = await supabase.from('deliveries').insert([{
                delivery_number: deliveryNumber,
                work_order_id: selectedWOId,
                observations: observations || null,
                shipping_method: shippingMethod || null,
                shipping_address: shippingAddress || null,
                shipping_carrier: shippingCarrier || null,
                tracking_number: trackingNumber || null,
                stage: 'ready_for_packaging',
            }]);
            if (deliveryError) throw deliveryError;

            router.push('/deliveries');
        } catch (error: any) {
            console.error("Error creating delivery:", error);
            setErrorMsg(error.message || "Error al crear la entrega.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-6 md:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-4xl mx-auto space-y-8">
                <header className="flex items-center gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <Link href="/deliveries" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors text-neutral-400 hover:text-white border border-neutral-700"><ArrowLeft className="w-5 h-5" /></Link>
                    <div>
                        <h1 className="text-3xl font-bold text-white flex items-center gap-3"><PackageCheck className="w-8 h-8 text-emerald-400" />Nueva Entrega</h1>
                        <p className="text-neutral-400 text-sm mt-1">Selecciona una OT terminada para generar la nota de entrega</p>
                    </div>
                </header>

                {errorMsg && (
                    <div className="p-4 rounded-xl border bg-red-500/10 border-red-500/30 text-red-400 flex items-center gap-3"><AlertCircle className="w-5 h-5" />{errorMsg}</div>
                )}

                {/* WO Selection */}
                <div className="bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <h2 className="text-lg font-semibold text-white mb-4">Orden de Trabajo (ya liberada por Calidad)</h2>
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-neutral-300 ml-1">Seleccionar OT *</label>
                        <select value={selectedWOId} onChange={(e) => setSelectedWOId(e.target.value)}
                            className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-4 py-3 text-white appearance-none focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                            disabled={isLoadingWOs}>
                            <option value="" disabled>Elige una orden de trabajo...</option>
                            {workOrders.map(wo => (
                                <option key={wo.id} value={wo.id}>
                                    {wo.order_number} — {(wo as any).module?.name || ''} — {wo.quotation?.client?.business_name || wo.notes?.slice(0, 40) || ''} ({wo.quotation?.quotation_number || 'ad-hoc'})
                                </option>
                            ))}
                        </select>
                    </div>
                    {selectedWO && (
                        <div className="mt-4 bg-neutral-900/40 p-4 rounded-xl border border-neutral-700/30">
                            <div className="flex items-center gap-3 flex-wrap">
                                <span className="text-xs text-neutral-400">Folio Entrega:</span>
                                <span className="font-mono font-bold text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-lg border border-emerald-500/20 text-lg">
                                    {deriveDeliveryNumber(selectedWO.order_number)}
                                </span>
                                <span className="text-xs text-neutral-500">• Aparecerá en la sección "Listo para embalaje"</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Observations */}
                <div className="bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <h2 className="text-lg font-semibold text-white mb-4">Observaciones</h2>
                    <textarea value={observations} onChange={(e) => setObservations(e.target.value)}
                        className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-4 py-3 text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all min-h-[100px]"
                        placeholder="Observaciones sobre la entrega, condiciones del producto, etc." />
                </div>

                {/* Shipping Info */}
                <div className="bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2"><Truck className="w-5 h-5 text-orange-400" />Datos de Envío (opcional)</h2>
                    <p className="text-xs text-neutral-500 mb-4">Completa solo si el producto será enviado. Si es recolección, puedes dejarlo vacío.</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-neutral-300 ml-1">Método de Envío</label>
                            <select value={shippingMethod} onChange={(e) => setShippingMethod(e.target.value)}
                                className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-4 py-3 text-white appearance-none focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all">
                                <option value="">Ninguno / Recolección</option>
                                <option value="Paquetería">Paquetería</option>
                                <option value="Envío propio">Envío propio</option>
                                <option value="Flete">Flete</option>
                                <option value="Otro">Otro</option>
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-neutral-300 ml-1">Paquetería / Carrier</label>
                            <input value={shippingCarrier} onChange={(e) => setShippingCarrier(e.target.value)}
                                className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-4 py-3 text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                                placeholder="Ej: DHL, FedEx, Estafeta" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-neutral-300 ml-1">No. de Guía</label>
                            <input value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)}
                                className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-4 py-3 text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                                placeholder="Número de rastreo" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-neutral-300 ml-1">Dirección de Envío</label>
                            <input value={shippingAddress} onChange={(e) => setShippingAddress(e.target.value)}
                                className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-4 py-3 text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                                placeholder="Dirección completa del destinatario" />
                        </div>
                    </div>
                </div>

                {/* Submit */}
                <div className="flex justify-end">
                    <button onClick={onSubmit} disabled={isSubmitting || !selectedWOId}
                        className="w-full md:w-auto bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-500/50 text-white px-10 py-4 rounded-xl font-bold transition-all shadow-[0_0_15px_rgba(16,185,129,0.2)] hover:shadow-[0_0_20px_rgba(16,185,129,0.4)] flex items-center justify-center gap-2 text-lg disabled:cursor-not-allowed">
                        {isSubmitting ? <><RefreshCw className="w-5 h-5 animate-spin" /> Creando...</> : <><Save className="w-5 h-5" /> Crear Entrega y Cerrar OT</>}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function NewDeliveryPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center"><RefreshCw className="w-8 h-8 animate-spin text-emerald-400" /></div>}>
            <NewDeliveryForm />
        </Suspense>
    );
}
