"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { X, RefreshCw, Box } from "lucide-react";

type Item = {
    id: string;
    description: string;
    quantity: number;
    unit_price: number;
    total: number;
};

type QuotationDetailsModalProps = {
    quote: {
        id: string;
        quotation_number: string;
        client?: {
            business_name: string;
        };
        created_at: string;
        status: string;
        subtotal: number;
        vat_total: number;
        total: number;
    };
    onClose: () => void;
};

export default function QuotationDetailsModal({ quote, onClose }: QuotationDetailsModalProps) {
    const [items, setItems] = useState<Item[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const fetchItems = async () => {
        setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('quotation_items')
                .select('*')
                .eq('quotation_id', quote.id)
                .order('created_at', { ascending: true });

            if (error) throw error;
            setItems(data || []);
        } catch (error) {
            console.error("Error fetching items:", error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (quote.id) {
            fetchItems();
        }
    }, [quote.id]);

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
    };

    const getStatusStyle = (status: string) => {
        switch (status) {
            case 'Draft': return "bg-slate-500/10 text-slate-400 border-slate-500/20";
            case 'Sent': return "bg-blue-500/10 text-blue-400 border-blue-500/20";
            case 'Approved': return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
            case 'Rejected': return "bg-red-500/10 text-red-400 border-red-500/20";
            default: return "bg-slate-500/10 text-slate-400 border-slate-500/20";
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div 
                className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm transition-opacity"
                onClick={onClose}
            ></div>
            
            {/* Modal */}
            <div className="relative bg-[#0F172A] w-full max-w-4xl max-h-[90vh] rounded-2xl shadow-2xl border border-slate-700/50 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-slate-800 bg-slate-800/20">
                    <div>
                        <div className="flex items-center gap-3">
                            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                                <Box className="w-6 h-6 text-emerald-400" />
                                Detalle de Cotización
                            </h2>
                            <span className="font-mono font-medium text-emerald-300 bg-emerald-500/10 px-2.5 py-1 rounded-md border border-emerald-500/20">
                                {quote.quotation_number}
                            </span>
                            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${getStatusStyle(quote.status)}`}>
                                {quote.status}
                            </span>
                        </div>
                        <p className="text-slate-400 mt-1">
                            Cliente: <span className="text-slate-200 font-medium">{quote.client?.business_name || 'Desconocido'}</span>  |  Fecha: <span className="text-slate-200">{new Date(quote.created_at).toLocaleDateString()}</span>
                        </p>
                    </div>
                    
                    <button 
                        onClick={onClose}
                        className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg transition-colors border border-slate-700"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Body (Items Table) */}
                <div className="flex-1 overflow-y-auto p-6 bg-slate-900/50">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                            <RefreshCw className="w-8 h-8 animate-spin mb-4 text-emerald-400" />
                            <p>Cargando partidas...</p>
                        </div>
                    ) : items.length === 0 ? (
                        <div className="text-center py-12 text-slate-400">
                            <p>No se encontraron partidas en esta cotización.</p>
                        </div>
                    ) : (
                        <div className="border border-slate-700/50 rounded-xl overflow-hidden">
                            <table className="w-full text-left text-sm whitespace-nowrap">
                                <thead className="bg-slate-800 text-slate-300 uppercase text-xs font-semibold">
                                    <tr>
                                        <th className="px-6 py-4">Descripción</th>
                                        <th className="px-6 py-4 text-center">Cant.</th>
                                        <th className="px-6 py-4 text-right">Precio Unit.</th>
                                        <th className="px-6 py-4 text-right">Total</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-700/50 bg-slate-800/20">
                                    {items.map((item) => (
                                        <tr key={item.id} className="hover:bg-slate-800/40 transition-colors">
                                            <td className="px-6 py-4 whitespace-normal min-w-[300px] text-slate-200">
                                                {item.description}
                                            </td>
                                            <td className="px-6 py-4 text-center text-slate-300">
                                                {item.quantity}
                                            </td>
                                            <td className="px-6 py-4 text-right text-slate-300">
                                                {formatCurrency(item.unit_price)}
                                            </td>
                                            <td className="px-6 py-4 text-right font-medium text-emerald-400">
                                                {formatCurrency(item.total)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* Footer (Totals) */}
                <div className="p-6 border-t border-slate-800 bg-slate-800/40 flex justify-end">
                    <div className="w-full max-w-sm space-y-3">
                        <div className="flex justify-between text-slate-400">
                            <span>Subtotal</span>
                            <span className="text-slate-200">{formatCurrency(quote.subtotal)}</span>
                        </div>
                        <div className="flex justify-between text-slate-400">
                            <span>IVA (16%)</span>
                            <span className="text-slate-200">{formatCurrency(quote.vat_total)}</span>
                        </div>
                        <div className="flex justify-between items-center text-lg font-bold border-t border-slate-700/50 pt-3">
                            <span className="text-slate-300">Total</span>
                            <span className="text-emerald-400">{formatCurrency(quote.total)}</span>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}
