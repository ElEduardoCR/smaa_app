"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, Factory, Upload, Download, Trash2, FileText, RefreshCw, CheckCircle, AlertCircle, Paperclip } from "lucide-react";
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
        client?: { business_name: string; rfc: string };
    };
};

type Operation = {
    id: string;
    sequence: number;
    operation_type: string;
    description: string | null;
    status: string;
};

type WOFile = {
    id: string;
    file_name: string;
    file_url: string;
    file_size: number | null;
    uploaded_by: string;
    created_at: string;
};

export default function WorkOrderDetailPage() {
    const params = useParams();
    const router = useRouter();
    const woId = params.id as string;

    const [workOrder, setWorkOrder] = useState<WorkOrder | null>(null);
    const [operations, setOperations] = useState<Operation[]>([]);
    const [files, setFiles] = useState<WOFile[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isUploading, setIsUploading] = useState(false);
    const [statusMsg, setStatusMsg] = useState<{ type: 'error' | 'success', text: string } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const fetchAll = async () => {
        setIsLoading(true);
        try {
            // Fetch Work Order
            const { data: woData, error: woError } = await supabase
                .from('work_orders')
                .select(`*, quotation:quotations(quotation_number, client:clients(business_name, rfc))`)
                .eq('id', woId)
                .single();

            if (woError) throw woError;
            const formattedWO = {
                ...woData,
                quotation: Array.isArray(woData.quotation) ? woData.quotation[0] : woData.quotation
            };
            if (formattedWO.quotation?.client && Array.isArray(formattedWO.quotation.client)) {
                formattedWO.quotation.client = formattedWO.quotation.client[0];
            }
            setWorkOrder(formattedWO);

            // Fetch Operations
            const { data: opsData, error: opsError } = await supabase
                .from('work_order_operations')
                .select('*')
                .eq('work_order_id', woId)
                .order('sequence', { ascending: true });
            if (opsError) throw opsError;
            setOperations(opsData || []);

            // Fetch Files
            const { data: filesData, error: filesError } = await supabase
                .from('work_order_files')
                .select('*')
                .eq('work_order_id', woId)
                .order('created_at', { ascending: false });
            if (filesError) throw filesError;
            setFiles(filesData || []);

        } catch (error: any) {
            console.error("Error loading work order:", error);
            setStatusMsg({ type: 'error', text: "Error loading work order details." });
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => { fetchAll(); }, [woId]);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFiles = e.target.files;
        if (!selectedFiles || selectedFiles.length === 0) return;

        setIsUploading(true);
        setStatusMsg(null);

        try {
            for (let i = 0; i < selectedFiles.length; i++) {
                const file = selectedFiles[i];

                // Check 100MB limit
                if (file.size > 100 * 1024 * 1024) {
                    setStatusMsg({ type: 'error', text: `El archivo "${file.name}" excede el límite de 100MB.` });
                    continue;
                }

                const filePath = `${woId}/${Date.now()}_${file.name}`;

                const { error: uploadError } = await supabase.storage
                    .from('work_order_files')
                    .upload(filePath, file, { cacheControl: '3600', upsert: false, contentType: file.type });

                if (uploadError) throw uploadError;

                const { data: publicUrlData } = supabase.storage
                    .from('work_order_files')
                    .getPublicUrl(filePath);

                // Insert file record
                const { error: insertError } = await supabase
                    .from('work_order_files')
                    .insert([{
                        work_order_id: woId,
                        file_name: file.name,
                        file_url: publicUrlData.publicUrl,
                        file_size: file.size,
                        uploaded_by: 'company'
                    }]);

                if (insertError) throw insertError;
            }

            setStatusMsg({ type: 'success', text: "¡Archivos subidos exitosamente!" });
            fetchAll();
        } catch (error: any) {
            console.error("Upload error:", error);
            setStatusMsg({ type: 'error', text: error.message || "Error al subir archivo." });
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleDeleteFile = async (fileId: string, fileUrl: string) => {
        if (!confirm("¿Eliminar este archivo?")) return;
        try {
            // Extract path from URL
            const urlParts = fileUrl.split('/work_order_files/');
            if (urlParts.length > 1) {
                const storagePath = decodeURIComponent(urlParts[1]);
                await supabase.storage.from('work_order_files').remove([storagePath]);
            }
            await supabase.from('work_order_files').delete().eq('id', fileId);
            fetchAll();
        } catch (error: any) {
            console.error("Delete error:", error);
        }
    };

    const handleToggleOpStatus = async (op: Operation) => {
        const newStatus = op.status === 'Pending' ? 'Done' : 'Pending';
        await supabase.from('work_order_operations').update({ status: newStatus }).eq('id', op.id);
        fetchAll();
    };

    const formatFileSize = (bytes: number | null) => {
        if (!bytes) return '—';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    const getOpStatusStyle = (status: string) => {
        return status === 'Done'
            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
            : "bg-slate-500/10 text-slate-400 border-slate-500/20";
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
                <RefreshCw className="w-8 h-8 animate-spin text-cyan-400" />
            </div>
        );
    }

    if (!workOrder) {
        return (
            <div className="min-h-screen bg-[#0B1120] flex items-center justify-center text-slate-400">
                <p>Work order not found.</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#0B1120] text-slate-200 p-6 md:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-5xl mx-auto space-y-8">
                {/* Header */}
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-slate-800/40 p-6 rounded-3xl border border-slate-700/50 backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                        <Link href="/manufacturing" className="p-3 bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors text-slate-400 hover:text-white border border-slate-700">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div>
                            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                                <Factory className="w-8 h-8 text-cyan-400" />
                                {workOrder.order_number}
                            </h1>
                            <div className="flex items-center gap-3 mt-1">
                                <span className="text-slate-400 text-sm">Cotización:</span>
                                <span className="font-mono text-emerald-300 text-xs bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                                    {workOrder.quotation?.quotation_number}
                                </span>
                                <span className="text-slate-400 text-sm">• {workOrder.quotation?.client?.business_name}</span>
                            </div>
                        </div>
                    </div>
                    <div className={cn("px-4 py-2 rounded-full text-sm font-semibold border",
                        workOrder.status === 'Open' ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
                            workOrder.status === 'In Progress' ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                                workOrder.status === 'Completed' ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                                    "bg-slate-500/10 text-slate-400 border-slate-500/20"
                    )}>
                        {workOrder.status}
                    </div>
                </header>

                {statusMsg && (
                    <div className={cn("p-4 rounded-xl border flex items-center gap-3",
                        statusMsg.type === 'error' ? "bg-red-500/10 border-red-500/30 text-red-400" : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                    )}>
                        {statusMsg.type === 'error' ? <AlertCircle className="w-5 h-5 flex-shrink-0" /> : <CheckCircle className="w-5 h-5 flex-shrink-0" />}
                        {statusMsg.text}
                    </div>
                )}

                {workOrder.notes && (
                    <div className="bg-slate-800/40 p-5 rounded-2xl border border-slate-700/50">
                        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">Notas</h3>
                        <p className="text-slate-200">{workOrder.notes}</p>
                    </div>
                )}

                {/* Operations */}
                <div className="bg-slate-800/40 border border-slate-700/50 rounded-3xl overflow-hidden backdrop-blur-sm">
                    <div className="p-6 border-b border-slate-700/50 bg-slate-800/20">
                        <h2 className="text-xl font-semibold text-white">Operaciones (Routing)</h2>
                    </div>
                    <div className="p-6 space-y-3">
                        {operations.length === 0 ? (
                            <p className="text-slate-500 text-center py-4">No operations defined.</p>
                        ) : (
                            operations.map((op) => (
                                <div key={op.id} className="flex items-center gap-4 bg-slate-900/40 p-4 rounded-xl border border-slate-700/30 hover:bg-slate-800/60 transition-colors">
                                    <button
                                        onClick={() => handleToggleOpStatus(op)}
                                        className={cn("w-8 h-8 rounded-lg border-2 flex items-center justify-center transition-all flex-shrink-0",
                                            op.status === 'Done' ? "border-emerald-500 bg-emerald-500/20 text-emerald-400" : "border-slate-600 hover:border-cyan-500"
                                        )}
                                    >
                                        {op.status === 'Done' && <CheckCircle className="w-5 h-5" />}
                                    </button>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-mono text-slate-500">#{op.sequence}</span>
                                            <span className="font-semibold text-white">{op.operation_type}</span>
                                            <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-semibold border", getOpStatusStyle(op.status))}>
                                                {op.status}
                                            </span>
                                        </div>
                                        {op.description && <p className="text-sm text-slate-400 mt-0.5 truncate">{op.description}</p>}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Files */}
                <div className="bg-slate-800/40 border border-slate-700/50 rounded-3xl overflow-hidden backdrop-blur-sm">
                    <div className="p-6 border-b border-slate-700/50 bg-slate-800/20 flex justify-between items-center">
                        <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                            <Paperclip className="w-5 h-5 text-cyan-400" /> Archivos Adjuntos
                        </h2>
                        <label className={cn(
                            "flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg border transition-colors cursor-pointer",
                            isUploading
                                ? "bg-slate-700 text-slate-400 border-slate-600 cursor-wait"
                                : "bg-cyan-500/10 text-cyan-400 border-cyan-500/20 hover:bg-cyan-500/20"
                        )}>
                            {isUploading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                            {isUploading ? "Subiendo..." : "Subir Archivos"}
                            <input
                                ref={fileInputRef}
                                type="file"
                                multiple
                                className="hidden"
                                onChange={handleFileUpload}
                                disabled={isUploading}
                            />
                        </label>
                    </div>
                    <div className="p-6">
                        <p className="text-xs text-slate-500 mb-4">Máximo 100MB por archivo. Se pueden subir planos, modelos 3D, PDFs del cliente, etc.</p>
                        {files.length === 0 ? (
                            <div className="text-center py-8 text-slate-500">
                                <FileText className="w-10 h-10 mx-auto mb-3 opacity-50" />
                                <p>No hay archivos adjuntos todavía.</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {files.map((file) => (
                                    <div key={file.id} className="flex items-center justify-between bg-slate-900/40 p-3 rounded-xl border border-slate-700/30 hover:bg-slate-800/60 transition-colors">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <FileText className="w-5 h-5 text-cyan-400 flex-shrink-0" />
                                            <div className="min-w-0">
                                                <p className="text-sm font-medium text-white truncate">{file.file_name}</p>
                                                <p className="text-xs text-slate-500">{formatFileSize(file.file_size)} • {new Date(file.created_at).toLocaleDateString()}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            <a
                                                href={file.file_url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="p-2 text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 rounded-lg transition-colors"
                                                title="Download"
                                            >
                                                <Download className="w-4 h-4" />
                                            </a>
                                            <button
                                                onClick={() => handleDeleteFile(file.id, file.file_url)}
                                                className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                                                title="Delete"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
