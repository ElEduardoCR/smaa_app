"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Factory, Plus, RefreshCw, ArrowLeft, FileText, Eye } from "lucide-react";
import Link from "next/link";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

type WorkOrder = {
    id: string;
    order_number: string;
    quotation_id: string;
    status: string;
    notes: string | null;
    created_at: string;
    quotation?: {
        quotation_number: string;
        client: {
            business_name: string;
        };
    };
};

export default function ManufacturingPage() {
    const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const fetchWorkOrders = async () => {
        setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('work_orders')
                .select(`
                    id,
                    order_number,
                    quotation_id,
                    status,
                    notes,
                    created_at,
                    quotation:quotations(quotation_number, client:clients(business_name))
                `)
                .order('created_at', { ascending: false });

            if (error) throw error;

            const formatted = (data as any[]).map(wo => ({
                ...wo,
                quotation: Array.isArray(wo.quotation) ? wo.quotation[0] : wo.quotation,
            }));
            // Flatten nested client
            formatted.forEach(wo => {
                if (wo.quotation?.client && Array.isArray(wo.quotation.client)) {
                    wo.quotation.client = wo.quotation.client[0];
                }
            });

            setWorkOrders(formatted || []);
        } catch (error: any) {
            console.error("Error fetching work orders:", error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => { fetchWorkOrders(); }, []);

    const getStatusStyle = (status: string) => {
        switch (status) {
            case 'Open': return "bg-orange-500/10 text-orange-400 border-orange-500/20";
            case 'In Progress': return "bg-amber-500/10 text-amber-400 border-amber-500/20";
            case 'Completed': return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
            case 'Cancelled': return "bg-red-500/10 text-red-400 border-red-500/20";
            default: return "bg-neutral-500/10 text-neutral-400 border-neutral-500/20";
        }
    };

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-6 md:p-10 font-[family-name:var(--font-sans)]">
            <div className="w-full space-y-8">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors text-neutral-400 hover:text-white border border-neutral-700">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div>
                            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                                <Factory className="w-8 h-8 text-orange-400" />
                                Fabricación (Órdenes de Trabajo)
                            </h1>
                            <p className="text-neutral-400 text-sm mt-1">Manage work orders linked to your quotations</p>
                        </div>
                    </div>

                    <Link
                        href="/manufacturing/new"
                        className="flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-6 py-3 rounded-xl font-medium transition-all hover:shadow-[0_0_20px_rgba(249,115,22,0.4)] active:scale-95"
                    >
                        <Plus className="w-5 h-5" /> Nueva Orden de Trabajo
                    </Link>
                </header>

                <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl overflow-hidden backdrop-blur-sm">
                    <div className="p-6 border-b border-neutral-700/50 flex justify-between items-center bg-neutral-800/20">
                        <h2 className="text-xl font-semibold text-white">Órdenes de Trabajo</h2>
                        <button onClick={fetchWorkOrders} className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium" disabled={isLoading}>
                            <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin text-orange-400")} /> Refresh
                        </button>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-neutral-900/50 text-neutral-400 uppercase text-xs font-semibold tracking-wider">
                                <tr>
                                    <th className="px-6 py-4 rounded-tl-xl">OT #</th>
                                    <th className="px-6 py-4">Cotización</th>
                                    <th className="px-6 py-4">Cliente</th>
                                    <th className="px-6 py-4">Fecha</th>
                                    <th className="px-6 py-4">Status</th>
                                    <th className="px-6 py-4 rounded-tr-xl text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-700/50">
                                {isLoading ? (
                                    <tr>
                                        <td colSpan={6} className="px-6 py-12 text-center text-neutral-400">
                                            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-orange-500" />
                                            Loading work orders...
                                        </td>
                                    </tr>
                                ) : workOrders.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="px-6 py-12 text-center text-neutral-400">
                                            <div className="bg-neutral-800/50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border border-neutral-700">
                                                <Factory className="w-8 h-8 text-neutral-500" />
                                            </div>
                                            <p className="text-lg text-neutral-300 font-medium">No hay órdenes de trabajo</p>
                                            <p className="text-sm mt-1">Crea tu primera orden para verla aquí.</p>
                                        </td>
                                    </tr>
                                ) : (
                                    workOrders.map((wo) => (
                                        <tr key={wo.id} className="hover:bg-neutral-800/80 transition-colors group">
                                            <td className="px-6 py-4">
                                                <span className="font-mono font-medium text-orange-300 bg-orange-500/10 px-2.5 py-1 rounded-md border border-orange-500/20">
                                                    {wo.order_number}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="font-mono text-emerald-300 text-xs bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                                                    {wo.quotation?.quotation_number || '—'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 font-medium text-neutral-200">
                                                {wo.quotation?.client?.business_name || 'Unknown'}
                                            </td>
                                            <td className="px-6 py-4 text-neutral-400">
                                                {new Date(wo.created_at).toLocaleDateString()}
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={cn("px-2.5 py-1 rounded-full text-xs font-semibold border", getStatusStyle(wo.status))}>
                                                    {wo.status}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <Link
                                                    href={`/manufacturing/${wo.id}`}
                                                    className="inline-flex items-center gap-1.5 text-xs font-medium text-orange-400 hover:text-orange-300 transition-colors bg-orange-500/10 hover:bg-orange-500/20 px-3 py-1.5 rounded-lg border border-orange-500/20"
                                                >
                                                    <Eye className="w-3.5 h-3.5" /> Ver Detalle
                                                </Link>
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
