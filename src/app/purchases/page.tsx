"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { generatePurchaseOrderPDF } from "@/lib/generatePoPdf";
import { ShoppingCart, Plus, RefreshCw, ArrowLeft, Download, Eye, CheckCircle, Upload, FileText, Camera, Inbox } from "lucide-react";
import Link from "next/link";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

type PO = {
    id: string;
    po_number: string;
    status: string;
    subtotal: number;
    vat_total: number;
    total: number;
    supplier_quote_url: string | null;
    invoice_url: string | null;
    evidence_photo_url: string | null;
    created_at: string;
    supplier: { business_name: string; rfc: string; email?: string; address?: string; };
};

export default function PurchasesPage() {
    const [orders, setOrders] = useState<PO[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [receivingPO, setReceivingPO] = useState<string | null>(null);
    const [pendingInboxCount, setPendingInboxCount] = useState(0);

    const fetchOrders = async () => {
        setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('purchase_orders')
                .select('*, supplier:suppliers(business_name, rfc, email, address)')
                .order('created_at', { ascending: false });
            if (error) throw error;
            const formatted = (data as any[]).map(po => ({ ...po, supplier: Array.isArray(po.supplier) ? po.supplier[0] : po.supplier }));
            setOrders(formatted || []);
        } catch (error: any) {
            console.error("Error fetching purchase orders:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const fetchPendingInbox = async () => {
        const { count } = await supabase
            .from('invoice_inbox')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'pending');
        setPendingInboxCount(count || 0);
    };

    useEffect(() => { fetchOrders(); fetchPendingInbox(); }, []);

    const handleUploadPurchaseEvidence = async (poId: string, file: File) => {
        try {
            const fileExt = file.name.split('.').pop();
            const fileName = `po_photo_${poId}_${Date.now()}.${fileExt}`;
            const { error: uploadError } = await supabase.storage
                .from('purchase_files')
                .upload(`purchases/evidence_photos/${fileName}`, file, { cacheControl: '3600', upsert: false, contentType: file.type });
            if (uploadError) throw uploadError;

            const { data: publicUrlData } = supabase.storage
                .from('purchase_files')
                .getPublicUrl(`purchases/evidence_photos/${fileName}`);

            const { error: updateError } = await supabase
                .from('purchase_orders')
                .update({ evidence_photo_url: publicUrlData.publicUrl })
                .eq('id', poId);
            if (updateError) throw updateError;

            fetchOrders();
        } catch (error: any) {
            console.error('Error uploading purchase photo:', error);
            alert(`Error al subir el archivo: ${error.message}`);
        }
    };

    const handleDownloadPDF = async (po: PO) => {
        try {
            const { data: items, error } = await supabase
                .from('purchase_order_items')
                .select('*')
                .eq('purchase_order_id', po.id);
            if (error) throw error;

            await generatePurchaseOrderPDF({
                po_number: po.po_number,
                created_at: po.created_at,
                subtotal: po.subtotal,
                vat_total: po.vat_total,
                total: po.total,
                supplier: po.supplier,
                items: items || []
            });
        } catch (error: any) {
            console.error("PDF error:", error);
            alert("Error generating PDF: " + error.message);
        }
    };

    const getStatusStyle = (status: string) => {
        switch (status) {
            case 'Draft': return "bg-slate-500/10 text-slate-400 border-slate-500/20";
            case 'Sent': return "bg-blue-500/10 text-blue-400 border-blue-500/20";
            case 'Approved': return "bg-amber-500/10 text-amber-400 border-amber-500/20";
            case 'Received': return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
            default: return "bg-slate-500/10 text-slate-400 border-slate-500/20";
        }
    };

    const handleReceive = async (poId: string) => {
        if (!selectedFile) {
            alert("Por favor selecciona el archivo de la factura.");
            return;
        }

        setIsSubmitting(true);
        try {
            const fileExt = selectedFile.name.split('.').pop();
            const fileName = `${Date.now()}_invoice.${fileExt}`;
            const filePath = `invoices/${poId}/${fileName}`;

            const { error: uploadError } = await supabase.storage
                .from('purchase_files')
                .upload(filePath, selectedFile);
            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = supabase.storage
                .from('purchase_files')
                .getPublicUrl(filePath);

            const { error: updateError } = await supabase
                .from('purchase_orders')
                .update({ status: 'Received', invoice_url: publicUrl })
                .eq('id', poId);
            if (updateError) throw updateError;

            setReceivingPO(null);
            setSelectedFile(null);
            fetchOrders();
        } catch (error: any) {
            console.error("Error receiving PO:", error);
            alert("Error al recibir la compra: " + error.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const formatCurrency = (amt: number) => `$${Number(amt).toFixed(2)}`;

    return (
        <div className="min-h-screen bg-[#0B1120] text-slate-200 p-6 md:p-10 font-[family-name:var(--font-sans)]">
            <div className="w-full space-y-8">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-slate-800/40 p-6 rounded-3xl border border-slate-700/50 backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="p-3 bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors text-slate-400 hover:text-white border border-slate-700"><ArrowLeft className="w-5 h-5" /></Link>
                        <div>
                            <h1 className="text-3xl font-bold text-white flex items-center gap-3"><ShoppingCart className="w-8 h-8 text-violet-400" />Compras</h1>
                            <p className="text-slate-400 text-sm mt-1">Órdenes de compra a proveedores</p>
                        </div>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3">
                        <Link href="/purchases/inbox" className="relative flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-5 py-3 rounded-xl font-medium transition-all border border-slate-700">
                            <Inbox className="w-5 h-5 text-violet-400" /> Bandeja IA
                            {pendingInboxCount > 0 && (
                                <span className="ml-1 inline-flex items-center justify-center min-w-[1.5rem] h-6 px-2 text-xs font-bold rounded-full bg-violet-500 text-white">
                                    {pendingInboxCount}
                                </span>
                            )}
                        </Link>
                        <Link href="/purchases/new" className="flex items-center justify-center gap-2 bg-violet-500 hover:bg-violet-600 text-white px-6 py-3 rounded-xl font-medium transition-all hover:shadow-[0_0_20px_rgba(139,92,246,0.4)] active:scale-95">
                            <Plus className="w-5 h-5" /> Nueva Orden de Compra
                        </Link>
                    </div>
                </header>

                <div className="bg-slate-800/40 border border-slate-700/50 rounded-3xl overflow-hidden backdrop-blur-sm">
                    <div className="p-6 border-b border-slate-700/50 flex justify-between items-center bg-slate-800/20">
                        <h2 className="text-xl font-semibold text-white">Órdenes de Compra</h2>
                        <button onClick={fetchOrders} className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium" disabled={isLoading}>
                            <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin text-violet-400")} /> Refresh
                        </button>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-slate-900/50 text-slate-400 uppercase text-xs font-semibold tracking-wider">
                                <tr>
                                    <th className="px-6 py-4 rounded-tl-xl">PO #</th>
                                    <th className="px-6 py-4">Proveedor</th>
                                    <th className="px-6 py-4">Fecha</th>
                                    <th className="px-6 py-4">Total</th>
                                    <th className="px-6 py-4">Status</th>
                                    <th className="px-6 py-4">Cotización Prov.</th>
                                    <th className="px-6 py-4 text-center">Evidencia Recepción</th>
                                    <th className="px-6 py-4 rounded-tr-xl text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-700/50">
                                {isLoading ? (
                                    <tr><td colSpan={8} className="px-6 py-12 text-center text-slate-400"><RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-violet-500" />Loading...</td></tr>
                                ) : orders.length === 0 ? (
                                    <tr><td colSpan={8} className="px-6 py-12 text-center text-slate-400">
                                        <div className="bg-slate-800/50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-700"><ShoppingCart className="w-8 h-8 text-slate-500" /></div>
                                        <p className="text-lg text-slate-300 font-medium">No hay órdenes de compra</p>
                                        <p className="text-sm mt-1">Crea tu primera orden para verla aquí.</p>
                                    </td></tr>
                                ) : (
                                    orders.map((po) => (
                                        <tr key={po.id} className="hover:bg-slate-800/80 transition-colors">
                                            <td className="px-6 py-4"><span className="font-mono font-medium text-violet-300 bg-violet-500/10 px-2.5 py-1 rounded-md border border-violet-500/20">{po.po_number}</span></td>
                                            <td className="px-6 py-4 font-medium text-slate-200">{po.supplier?.business_name}</td>
                                            <td className="px-6 py-4 text-slate-400">{new Date(po.created_at).toLocaleDateString()}</td>
                                            <td className="px-6 py-4 font-medium text-emerald-400">{formatCurrency(po.total)}</td>
                                            <td className="px-6 py-4"><span className={cn("px-2.5 py-1 rounded-full text-xs font-semibold border", getStatusStyle(po.status))}>{po.status}</span></td>
                                            <td className="px-6 py-4">
                                                {po.supplier_quote_url ? (
                                                    <a href={po.supplier_quote_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 px-2.5 py-1.5 rounded-lg border border-emerald-500/20"><Eye className="w-3.5 h-3.5" /> Ver</a>
                                                ) : <span className="text-slate-600 text-xs">—</span>}
                                            </td>

                                            <td className="px-6 py-4 text-center">
                                                {po.evidence_photo_url ? (
                                                    <a href={po.evidence_photo_url} target="_blank" rel="noopener noreferrer"
                                                        className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-400 hover:text-sky-300 bg-sky-500/10 hover:bg-sky-500/20 px-2.5 py-1.5 rounded-lg border border-sky-500/20 transition-colors">
                                                        <Eye className="w-3.5 h-3.5" /> Ver Foto
                                                    </a>
                                                ) : (
                                                    <label className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-400 hover:text-violet-300 bg-violet-500/10 hover:bg-violet-500/20 px-2.5 py-1.5 rounded-lg border border-violet-500/20 cursor-pointer transition-colors">
                                                        <Camera className="w-3.5 h-3.5" /> Subir Foto
                                                        <input type="file" accept="image/*" className="hidden"
                                                            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadPurchaseEvidence(po.id, f); e.target.value = ''; }} />
                                                    </label>
                                                )}
                                            </td>

                                            <td className="px-6 py-4 text-right space-x-2">
                                                {po.status !== 'Received' ? (
                                                    <button onClick={() => setReceivingPO(po.id)} className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 px-3 py-1.5 rounded-lg border border-emerald-500/20 transition-colors">
                                                        <CheckCircle className="w-3.5 h-3.5" /> Recibir
                                                    </button>
                                                ) : po.invoice_url ? (
                                                    <a href={po.invoice_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-cyan-400 hover:text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 px-3 py-1.5 rounded-lg border border-cyan-500/20 transition-colors">
                                                        <FileText className="w-3.5 h-3.5" /> Factura
                                                    </a>
                                                ) : null}
                                                <button onClick={() => handleDownloadPDF(po)} className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-400 hover:text-violet-300 bg-violet-500/10 hover:bg-violet-500/20 px-3 py-1.5 rounded-lg border border-violet-500/20 transition-colors">
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

            {/* Receive Modal */}
            {receivingPO && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-slate-900 border border-slate-700/50 rounded-2xl p-6 w-full max-w-md shadow-2xl">
                        <h3 className="text-xl font-bold text-white mb-2">Recibir Orden de Compra</h3>
                        <p className="text-slate-400 text-sm mb-6">Sube la factura del proveedor para completar esta recepción.</p>

                        <div className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-300 ml-1">Factura (PDF o Imagen) *</label>
                                <div className="relative">
                                    <input type="file" onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                                        className="w-full bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-3 text-slate-300 text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-emerald-500/10 file:text-emerald-400 hover:file:bg-emerald-500/20 cursor-pointer"
                                        accept=".pdf,image/*" />
                                </div>
                            </div>
                            <div className="pt-4 flex justify-end gap-3">
                                <button onClick={() => { setReceivingPO(null); setSelectedFile(null); }} disabled={isSubmitting} className="px-5 py-2.5 text-sm font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors">Cancelar</button>
                                <button onClick={() => handleReceive(receivingPO)} disabled={!selectedFile || isSubmitting} className="px-5 py-2.5 text-sm font-medium text-white bg-emerald-500 hover:bg-emerald-600 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                                    {isSubmitting ? <><RefreshCw className="w-4 h-4 animate-spin" /> Procesando...</> : <><Upload className="w-4 h-4" /> Finalizar</>}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
