"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { X, RefreshCw, Box, Check, RotateCcw, Sparkles, Wallet } from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

type Item = {
    id: string;
    description: string | null;
    quantity: number | null;
    unit_price: number | null;
    line_total: number | null;
};

type Props = {
    quote: { id: string; number: string; client: string | null };
    confirmedItemIds: Set<string>;
    manuallyBilled: boolean;
    marking: boolean;
    onToggleBilled: (value: boolean) => void;
    onClose: () => void;
};

const fmtMoney = (n: number | null) =>
    n == null ? "—" : `$${Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2 })}`;

export default function QuotationItemsModal({ quote, confirmedItemIds, manuallyBilled, marking, onToggleBilled, onClose }: Props) {
    const [items, setItems] = useState<Item[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;
        (async () => {
            setLoading(true);
            const { data } = await supabase
                .from("quotation_items")
                .select("id, description, quantity, unit_price, line_total")
                .eq("quotation_id", quote.id);
            if (active) {
                setItems((data as Item[]) || []);
                setLoading(false);
            }
        })();
        return () => { active = false; };
    }, [quote.id]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    const statusOf = (itemId: string): "manual" | "ia" | "pending" =>
        manuallyBilled ? "manual" : confirmedItemIds.has(itemId) ? "ia" : "pending";

    const total = items.reduce((a, it) => a + (Number(it.line_total) || 0), 0);
    const facturado = manuallyBilled
        ? total
        : items.filter(it => confirmedItemIds.has(it.id)).reduce((a, it) => a + (Number(it.line_total) || 0), 0);
    const porFacturar = total - facturado;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm" onClick={onClose} />

            <div className="relative bg-[#0F172A] w-full max-w-4xl max-h-[90vh] rounded-2xl shadow-2xl border border-slate-700/50 flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-start justify-between p-6 border-b border-slate-800 bg-slate-800/20">
                    <div>
                        <div className="flex items-center gap-3 flex-wrap">
                            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                                <Box className="w-6 h-6 text-fuchsia-400" />
                                Partidas de la cotización
                            </h2>
                            <span className="font-mono font-medium text-emerald-300 bg-emerald-500/10 px-2.5 py-1 rounded-md border border-emerald-500/20">
                                {quote.number}
                            </span>
                            {manuallyBilled && (
                                <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-300 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
                                    <Check className="w-3.5 h-3.5" /> Marcada como facturada
                                </span>
                            )}
                        </div>
                        <p className="text-slate-400 mt-1">
                            Cliente: <span className="text-slate-200 font-medium">{quote.client || "Desconocido"}</span>
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg transition-colors border border-slate-700">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-6 bg-slate-900/50">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                            <RefreshCw className="w-8 h-8 animate-spin mb-4 text-fuchsia-400" />
                            <p>Cargando partidas...</p>
                        </div>
                    ) : items.length === 0 ? (
                        <div className="text-center py-12 text-slate-400">
                            <p>No se encontraron partidas en esta cotización.</p>
                        </div>
                    ) : (
                        <div className="border border-slate-700/50 rounded-xl overflow-hidden">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-slate-800 text-slate-300 uppercase text-xs font-semibold">
                                    <tr>
                                        <th className="px-5 py-3.5">Descripción</th>
                                        <th className="px-5 py-3.5 text-center">Cant.</th>
                                        <th className="px-5 py-3.5 text-right">P. Unit.</th>
                                        <th className="px-5 py-3.5 text-right">Total</th>
                                        <th className="px-5 py-3.5 text-center">Estado</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-700/50 bg-slate-800/20">
                                    {items.map((item) => {
                                        const st = statusOf(item.id);
                                        return (
                                            <tr key={item.id} className="hover:bg-slate-800/40 transition-colors align-top">
                                                <td className="px-5 py-3.5 whitespace-normal min-w-[280px] text-slate-200">{item.description || "—"}</td>
                                                <td className="px-5 py-3.5 text-center text-slate-300">{item.quantity ?? "—"}</td>
                                                <td className="px-5 py-3.5 text-right text-slate-300">{fmtMoney(item.unit_price)}</td>
                                                <td className="px-5 py-3.5 text-right font-medium text-slate-100">{fmtMoney(item.line_total)}</td>
                                                <td className="px-5 py-3.5 text-center">
                                                    {st === "pending" ? (
                                                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-300 bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/20">
                                                            <Wallet className="w-3 h-3" /> Por facturar
                                                        </span>
                                                    ) : st === "ia" ? (
                                                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-300 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
                                                            <Sparkles className="w-3 h-3" /> Facturada (IA)
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-300 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
                                                            <Check className="w-3 h-3" /> Facturada (manual)
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-slate-800 bg-slate-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                        <span className="text-slate-400">Total: <span className="text-slate-100 font-semibold">{fmtMoney(total)}</span></span>
                        <span className="text-slate-400">Facturado: <span className="text-emerald-300 font-semibold">{fmtMoney(facturado)}</span></span>
                        <span className="text-slate-400">Por facturar: <span className="text-amber-300 font-semibold">{fmtMoney(porFacturar)}</span></span>
                    </div>
                    {manuallyBilled ? (
                        <button
                            onClick={() => onToggleBilled(false)}
                            disabled={marking}
                            className="inline-flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 px-5 py-2.5 rounded-xl font-medium text-sm transition-all border border-slate-700 disabled:opacity-50 whitespace-nowrap"
                        >
                            {marking ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />} Deshacer "facturada"
                        </button>
                    ) : (
                        <button
                            onClick={() => onToggleBilled(true)}
                            disabled={marking}
                            className="inline-flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-medium text-sm transition-all disabled:opacity-50 whitespace-nowrap"
                        >
                            {marking ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Marcar como ya facturada
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
