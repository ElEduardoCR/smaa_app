"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { generateDeliveryPDF } from "@/lib/generateDeliveryPdf";
import { PackageCheck, Plus, RefreshCw, ArrowLeft, Download } from "lucide-react";
import Link from "next/link";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

type Delivery = {
    id: string;
    delivery_number: string;
    observations: string | null;
    shipping_method: string | null;
    shipping_address: string | null;
    shipping_carrier: string | null;
    tracking_number: string | null;
    created_at: string;
    work_order: {
        id: string;
        order_number: string;
        notes: string | null;
        quotation: {
            id: string;
            quotation_number: string;
            client: { business_name: string; rfc: string; email?: string; address?: string; };
        };
    };
};

export default function DeliveriesPage() {
    const [deliveries, setDeliveries] = useState<Delivery[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const fetchDeliveries = async () => {
        setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('deliveries')
                .select(`*, work_order:work_orders(id, order_number, notes, quotation:quotations(id, quotation_number, client:clients(business_name, rfc, email, address)))`)
                .order('created_at', { ascending: false });
            if (error) throw error;

            const formatted = (data as any[]).map(d => {
                const wo = Array.isArray(d.work_order) ? d.work_order[0] : d.work_order;
                if (wo?.quotation) wo.quotation = Array.isArray(wo.quotation) ? wo.quotation[0] : wo.quotation;
                if (wo?.quotation?.client) wo.quotation.client = Array.isArray(wo.quotation.client) ? wo.quotation.client[0] : wo.quotation.client;
                return { ...d, work_order: wo };
            });
            setDeliveries(formatted || []);
        } catch (error: any) {
            console.error("Error fetching deliveries:", error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => { fetchDeliveries(); }, []);

    const handleDownloadPDF = async (delivery: Delivery) => {
        try {
            // Fetch quotation items for this quotation
            const { data: items, error } = await supabase
                .from('quotation_items')
                .select('description, quantity')
                .eq('quotation_id', delivery.work_order.quotation.id);
            if (error) throw error;

            await generateDeliveryPDF({
                delivery_number: delivery.delivery_number,
                created_at: delivery.created_at,
                observations: delivery.observations,
                shipping_method: delivery.shipping_method,
                shipping_address: delivery.shipping_address,
                shipping_carrier: delivery.shipping_carrier,
                tracking_number: delivery.tracking_number,
                work_order: { order_number: delivery.work_order.order_number, notes: delivery.work_order.notes },
                quotation: { quotation_number: delivery.work_order.quotation.quotation_number },
                client: delivery.work_order.quotation.client,
                items: items || []
            });
        } catch (error: any) {
            console.error("PDF error:", error);
            alert("Error generating PDF: " + error.message);
        }
    };

    return (
        <div className="min-h-screen bg-[#0B1120] text-slate-200 p-6 md:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-7xl mx-auto space-y-8">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-slate-800/40 p-6 rounded-3xl border border-slate-700/50 backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="p-3 bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors text-slate-400 hover:text-white border border-slate-700"><ArrowLeft className="w-5 h-5" /></Link>
                        <div>
                            <h1 className="text-3xl font-bold text-white flex items-center gap-3"><PackageCheck className="w-8 h-8 text-emerald-400" />Entregas</h1>
                            <p className="text-slate-400 text-sm mt-1">Notas de entrega de órdenes de trabajo terminadas</p>
                        </div>
                    </div>
                    <Link href="/deliveries/new" className="flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-3 rounded-xl font-medium transition-all hover:shadow-[0_0_20px_rgba(16,185,129,0.4)] active:scale-95">
                        <Plus className="w-5 h-5" /> Nueva Entrega
                    </Link>
                </header>

                <div className="bg-slate-800/40 border border-slate-700/50 rounded-3xl overflow-hidden backdrop-blur-sm">
                    <div className="p-6 border-b border-slate-700/50 flex justify-between items-center bg-slate-800/20">
                        <h2 className="text-xl font-semibold text-white">Entregas Realizadas</h2>
                        <button onClick={fetchDeliveries} className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium" disabled={isLoading}>
                            <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin text-emerald-400")} /> Refresh
                        </button>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-slate-900/50 text-slate-400 uppercase text-xs font-semibold tracking-wider">
                                <tr>
                                    <th className="px-6 py-4 rounded-tl-xl">Folio Entrega</th>
                                    <th className="px-6 py-4">OT</th>
                                    <th className="px-6 py-4">Cliente</th>
                                    <th className="px-6 py-4">Envío</th>
                                    <th className="px-6 py-4">Fecha</th>
                                    <th className="px-6 py-4 rounded-tr-xl text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-700/50">
                                {isLoading ? (
                                    <tr><td colSpan={6} className="px-6 py-12 text-center text-slate-400"><RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-emerald-500" />Cargando...</td></tr>
                                ) : deliveries.length === 0 ? (
                                    <tr><td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                                        <div className="bg-slate-800/50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-700"><PackageCheck className="w-8 h-8 text-slate-500" /></div>
                                        <p className="text-lg text-slate-300 font-medium">No hay entregas realizadas</p>
                                        <p className="text-sm mt-1">Crea una nueva entrega para una OT terminada.</p>
                                    </td></tr>
                                ) : (
                                    deliveries.map((d) => (
                                        <tr key={d.id} className="hover:bg-slate-800/80 transition-colors">
                                            <td className="px-6 py-4"><span className="font-mono font-medium text-emerald-300 bg-emerald-500/10 px-2.5 py-1 rounded-md border border-emerald-500/20">{d.delivery_number}</span></td>
                                            <td className="px-6 py-4"><span className="font-mono text-cyan-300 text-xs bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">{d.work_order?.order_number}</span></td>
                                            <td className="px-6 py-4 font-medium text-slate-200">{d.work_order?.quotation?.client?.business_name}</td>
                                            <td className="px-6 py-4 text-slate-400">{d.shipping_method || '—'}</td>
                                            <td className="px-6 py-4 text-slate-400">{new Date(d.created_at).toLocaleDateString()}</td>
                                            <td className="px-6 py-4 text-right">
                                                <button onClick={() => handleDownloadPDF(d)}
                                                    className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 px-3 py-1.5 rounded-lg border border-emerald-500/20 transition-colors">
                                                    <Download className="w-3.5 h-3.5" /> PDF
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
