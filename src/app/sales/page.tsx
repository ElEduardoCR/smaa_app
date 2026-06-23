"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { FileText, Plus, RefreshCw, ArrowLeft, Download, FileSpreadsheet, Edit3, CheckCircle, Upload, Eye, Link2 } from "lucide-react";
import Link from "next/link";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";
import { generateQuotationPDF } from "@/lib/generatePdf";
import QuotationDetailsModal from "./QuotationDetailsModal";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

// Minimal type for listing
type Quotation = {
    id: string;
    quotation_number: string;
    client_id: string;
    status: string;
    subtotal: number;
    vat_total: number;
    total: number;
    seller: string | null;
    delivery_time: string | null;
    terms_conditions: string | null;
    client_po_url: string | null;
    created_at: string;
    client?: {
        business_name: string;
        rfc: string;
        email?: string;
        address?: string;
        payment_days?: number | null;
        requires_advance?: boolean | null;
        advance_pct?: number | null;
    };
};

export default function SalesPage() {
    const [quotations, setQuotations] = useState<Quotation[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedQuote, setSelectedQuote] = useState<Quotation | null>(null);
    const [pendingMatches, setPendingMatches] = useState(0);

    const fetchPendingMatches = async () => {
        const { count } = await supabase
            .from('quotation_billing_matches')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'pending');
        setPendingMatches(count || 0);
    };

    const fetchQuotations = async () => {
        setIsLoading(true);
        try {
            // Fetch quotations with inner join on clients to get the business name
            const { data, error } = await supabase
                .from('quotations')
                .select(`
                    id,
                    quotation_number,
                    client_id,
                    status,
                    subtotal,
                    vat_total,
                    total,
                    seller,
                    delivery_time,
                    terms_conditions,
                    client_po_url,
                    created_at,
                    client:clients(business_name, rfc, email, address, payment_days, requires_advance, advance_pct)
                `)
                .order('created_at', { ascending: false });

            if (error) throw error;

            // Format data to match type
            const formattedData = (data as any[]).map(q => ({
                ...q,
                client: Array.isArray(q.client) ? q.client[0] : q.client
            }));

            setQuotations(formattedData || []);
        } catch (error: any) {
            console.error("Error fetching quotations:", error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchQuotations();
        fetchPendingMatches();
    }, []);

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
    };

    const getStatusStyle = (status: string) => {
        switch (status) {
            case 'Draft': return "bg-neutral-500/10 text-neutral-400 border-neutral-500/20";
            case 'Sent': return "bg-orange-500/10 text-orange-400 border-orange-500/20";
            case 'Approved': return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
            case 'Rejected': return "bg-red-500/10 text-red-400 border-red-500/20";
            default: return "bg-neutral-500/10 text-neutral-400 border-neutral-500/20";
        }
    };

    const handleDownloadPDF = async (quote: Quotation) => {
        setIsLoading(true);
        try {
            // Fetch quotation items for this quote
            const { data: items, error } = await supabase
                .from('quotation_items')
                .select('*')
                .eq('quotation_id', quote.id);

            if (error) throw error;

            if (!quote.client) {
                console.error("Client data missing for quotation PDF");
                return;
            }

            // Fetch company settings
            const { data: companySettings, error: companyError } = await supabase
                .from('company_settings')
                .select('*')
                .limit(1)
                .single();

            if (companyError && companyError.code !== 'PGRST116') {
                console.warn("Could not fetch company settings:", companyError);
            }

            // Construct the complete QuotationData
            const pdfData = {
                quotation_number: quote.quotation_number,
                created_at: quote.created_at,
                subtotal: quote.subtotal,
                vat_total: quote.vat_total,
                total: quote.total,
                seller: quote.seller || undefined,
                delivery_time: quote.delivery_time || undefined,
                terms_conditions: quote.terms_conditions || undefined,
                company: companySettings ? {
                    company_name: companySettings.company_name,
                    email: companySettings.email,
                    phone: companySettings.phone,
                    address: companySettings.address,
                    logo_url: companySettings.logo_url
                } : undefined,
                client: {
                    business_name: quote.client.business_name,
                    rfc: quote.client.rfc,
                    email: quote.client.email,
                    address: quote.client.address,
                    payment_days: quote.client.payment_days,
                    requires_advance: quote.client.requires_advance,
                    advance_pct: quote.client.advance_pct
                },
                items: items || []
            };

            await generateQuotationPDF(pdfData);

        } catch (error: any) {
            console.error("Error generating PDF:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleConfirmQuote = async (quote: Quotation) => {
        if (!confirm(`¿Estás seguro de que deseas aprobar la cotización ${quote.quotation_number}?`)) return;

        setIsLoading(true);
        try {
            const { error } = await supabase
                .from('quotations')
                .update({ status: 'Approved' })
                .eq('id', quote.id);

            if (error) throw error;

            // Re-fetch to update list
            fetchQuotations();
        } catch (error: any) {
            console.error("Error approving quotation:", error);
            alert("Error al aprobar la cotización.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleUploadClientPO = async (quoteId: string, file: File) => {
        try {
            const fileExt = file.name.split('.').pop();
            const fileName = `client_po_${quoteId}_${Date.now()}.${fileExt}`;
            const { error: uploadError } = await supabase.storage.from('purchase_files').upload(`client_pos/${fileName}`, file, { cacheControl: '3600', upsert: false, contentType: file.type });
            if (uploadError) throw uploadError;
            const { data: publicUrlData } = supabase.storage.from('purchase_files').getPublicUrl(`client_pos/${fileName}`);
            const { error: updateError } = await supabase.from('quotations').update({ client_po_url: publicUrlData.publicUrl }).eq('id', quoteId);
            if (updateError) throw updateError;
            fetchQuotations();
        } catch (error: any) {
            console.error("Error uploading client PO:", error);
            alert("Error al subir la OC del cliente.");
        }
    };

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-6 md:p-10 font-[family-name:var(--font-sans)]">
            <div className="w-full space-y-8">
                {/* Header */}
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors text-neutral-400 hover:text-white border border-neutral-700">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div>
                            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                                <FileSpreadsheet className="w-8 h-8 text-emerald-400" />
                                Ventas (Cotizaciones)
                            </h1>
                            <p className="text-neutral-400 text-sm mt-1">Manage quotations and generate PDF proposals</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <Link
                            href="/sales/billing-inbox"
                            className="relative flex items-center justify-center gap-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 px-5 py-3 rounded-xl font-medium transition-all border border-neutral-700 active:scale-95"
                        >
                            <Link2 className="w-5 h-5 text-orange-400" /> Facturación IA
                            {pendingMatches > 0 && (
                                <span className="absolute -top-2 -right-2 bg-orange-500 text-white text-xs font-bold rounded-full min-w-[20px] h-5 px-1.5 flex items-center justify-center">
                                    {pendingMatches}
                                </span>
                            )}
                        </Link>
                        <Link
                            href="/sales/new"
                            className="flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-3 rounded-xl font-medium transition-all hover:shadow-[0_0_20px_rgba(16,185,129,0.4)] active:scale-95"
                        >
                            <Plus className="w-5 h-5" /> Nueva Cotización
                        </Link>
                    </div>
                </header>

                {/* Quotations Table */}
                <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl overflow-hidden backdrop-blur-sm">
                    <div className="p-6 border-b border-neutral-700/50 flex justify-between items-center bg-neutral-800/20">
                        <h2 className="text-xl font-semibold text-white">Recent Quotations</h2>
                        <button
                            onClick={fetchQuotations}
                            className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium"
                            disabled={isLoading}
                        >
                            <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin text-emerald-400")} />
                            Refresh
                        </button>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-neutral-900/50 text-neutral-400 uppercase text-xs font-semibold tracking-wider">
                                <tr>
                                    <th className="px-6 py-4 rounded-tl-xl">Folio</th>
                                    <th className="px-6 py-4">Cliente</th>
                                    <th className="px-6 py-4">Vendedor</th>
                                    <th className="px-6 py-4">Entrega</th>
                                    <th className="px-6 py-4">Fecha</th>
                                    <th className="px-6 py-4 text-right">Total</th>
                                    <th className="px-6 py-4">Status</th>
                                    <th className="px-6 py-4">OC Cliente</th>
                                    <th className="px-6 py-4 rounded-tr-xl text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-700/50">
                                {isLoading ? (
                                    <tr>
                                        <td colSpan={9} className="px-6 py-12 text-center text-neutral-400">
                                            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-emerald-500" />
                                            Cargando...
                                        </td>
                                    </tr>
                                ) : quotations.length === 0 ? (
                                    <tr>
                                        <td colSpan={9} className="px-6 py-12 text-center text-neutral-400">
                                            <div className="bg-neutral-800/50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border border-neutral-700">
                                                <FileText className="w-8 h-8 text-neutral-500" />
                                            </div>
                                            <p className="text-lg text-neutral-300 font-medium">No quotations found</p>
                                            <p className="text-sm mt-1">Create your first quote to see it here.</p>
                                        </td>
                                    </tr>
                                ) : (
                                    quotations.map((quote) => (
                                        <tr 
                                            key={quote.id} 
                                            className="hover:bg-neutral-800/80 transition-colors group cursor-pointer"
                                            onClick={() => setSelectedQuote(quote)}
                                        >
                                            <td className="px-6 py-4">
                                                <span className="font-mono font-medium text-emerald-300 bg-emerald-500/10 px-2.5 py-1 rounded-md border border-emerald-500/20">
                                                    {quote.quotation_number}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 font-medium text-neutral-200">
                                                {quote.client?.business_name || 'Unknown'}
                                            </td>
                                            <td className="px-6 py-4 text-neutral-400">{quote.seller || '—'}</td>
                                            <td className="px-6 py-4 text-neutral-400 text-xs">{quote.delivery_time || '—'}</td>
                                            <td className="px-6 py-4 text-neutral-400">
                                                {new Date(quote.created_at).toLocaleDateString()}
                                            </td>
                                            <td className="px-6 py-4 text-right font-semibold text-neutral-200">
                                                {formatCurrency(quote.total)}
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={cn("px-2.5 py-1 rounded-full text-xs font-semibold border", getStatusStyle(quote.status))}>
                                                    {quote.status}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                {quote.status === 'Approved' ? (
                                                    quote.client_po_url ? (
                                                        <a href={quote.client_po_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 px-2.5 py-1.5 rounded-lg border border-emerald-500/20">
                                                            <Eye className="w-3.5 h-3.5" /> Ver OC
                                                        </a>
                                                    ) : (
                                                        <label 
                                                            className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 px-2.5 py-1.5 rounded-lg border border-amber-500/20 cursor-pointer transition-colors"
                                                            onClick={(e) => e.stopPropagation()}
                                                        >
                                                            <Upload className="w-3.5 h-3.5" /> Subir OC
                                                            <input type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadClientPO(quote.id, f); e.target.value = ''; }} />
                                                        </label>
                                                    )
                                                ) : <span className="text-neutral-600 text-xs">—</span>}
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    {quote.status === 'Draft' && (
                                                        <>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handleConfirmQuote(quote); }}
                                                                className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 transition-colors bg-emerald-500/10 hover:bg-emerald-500/20 px-3 py-1.5 rounded-lg border border-emerald-500/20"
                                                                title="Confirm Quote"
                                                            >
                                                                <CheckCircle className="w-3.5 h-3.5" /> Confirmar
                                                            </button>
                                                            <Link
                                                                href={`/sales/new?id=${quote.id}`}
                                                                className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 hover:text-amber-300 transition-colors bg-amber-500/10 hover:bg-amber-500/20 px-3 py-1.5 rounded-lg border border-amber-500/20"
                                                                title="Edit Quote"
                                                                onClick={(e) => e.stopPropagation()}
                                                            >
                                                                <Edit3 className="w-3.5 h-3.5" /> Editar
                                                            </Link>
                                                        </>
                                                    )}
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleDownloadPDF(quote); }}
                                                        className="inline-flex items-center gap-1.5 text-xs font-medium text-orange-400 hover:text-orange-300 transition-colors bg-orange-500/10 hover:bg-orange-500/20 px-3 py-1.5 rounded-lg border border-orange-500/20"
                                                        title="Download PDF"
                                                    >
                                                        <Download className="w-3.5 h-3.5" /> PDF
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Modal de Detalle */}
            {selectedQuote && (
                <QuotationDetailsModal 
                    quote={selectedQuote} 
                    onClose={() => setSelectedQuote(null)} 
                />
            )}
        </div>
    );
}
