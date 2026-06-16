"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, Factory, Upload, Download, Trash2, FileText, RefreshCw, CheckCircle, AlertCircle, Paperclip, Plus, Edit2, Save, X, GripVertical, ShieldCheck, Camera, Lock, ImageIcon } from "lucide-react";
import Link from "next/link";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

const OPERATION_TYPES = ["Cortar", "Maquinar", "Soldar", "Doblar", "Pulir", "Pintar", "Ensamblar", "Inspección", "Embalaje", "Otro"];

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

type QCPhoto = {
    id: string;
    photo_url: string;
    photo_label: string;
    created_at: string;
};

const QC_PHOTO_LABELS = ["Primera Pieza", "Plano", "Medidas", "Detalle", "Otro"];

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

    // QC First Piece state
    const [qcPhotos, setQcPhotos] = useState<QCPhoto[]>([]);
    const [qcApproved, setQcApproved] = useState(false);
    const [qcApprovedAt, setQcApprovedAt] = useState<string | null>(null);
    const [qcPassword, setQcPassword] = useState("");
    const [isSigningQC, setIsSigningQC] = useState(false);
    const [isUploadingQCPhoto, setIsUploadingQCPhoto] = useState(false);
    const [qcLabel, setQcLabel] = useState("Primera Pieza");
    const [qcStatusMsg, setQcStatusMsg] = useState<{ type: 'error' | 'success', text: string } | null>(null);

    // Editing state
    const [editingOpId, setEditingOpId] = useState<string | null>(null);
    const [editOpType, setEditOpType] = useState("");
    const [editOpDesc, setEditOpDesc] = useState("");

    // Add new operation state
    const [isAddingOp, setIsAddingOp] = useState(false);
    const [newOpType, setNewOpType] = useState("Cortar");
    const [newOpDesc, setNewOpDesc] = useState("");
    const [isSavingOp, setIsSavingOp] = useState(false);

    const fetchAll = async () => {
        setIsLoading(true);
        try {
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
            setQcApproved(formattedWO.qc_approved || false);
            setQcApprovedAt(formattedWO.qc_approved_at || null);

            const { data: opsData, error: opsError } = await supabase
                .from('work_order_operations')
                .select('*')
                .eq('work_order_id', woId)
                .order('sequence', { ascending: true });
            if (opsError) throw opsError;
            setOperations(opsData || []);

            const { data: filesData, error: filesError } = await supabase
                .from('work_order_files')
                .select('*')
                .eq('work_order_id', woId)
                .order('created_at', { ascending: false });
            if (filesError) throw filesError;
            setFiles(filesData || []);

            const { data: qcData, error: qcError } = await supabase
                .from('work_order_qc_photos')
                .select('*')
                .eq('work_order_id', woId)
                .order('created_at', { ascending: true });
            if (qcError) throw qcError;
            setQcPhotos(qcData || []);
        } catch (error: any) {
            console.error("Error loading work order:", error);
            setStatusMsg({ type: 'error', text: "Error loading work order details." });
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => { fetchAll(); }, [woId]);

    // --- Operations CRUD ---
    const handleAddOperation = async () => {
        if (!newOpType) return;
        setIsSavingOp(true);
        try {
            const nextSeq = operations.length > 0 ? Math.max(...operations.map(o => o.sequence)) + 1 : 1;
            const { error } = await supabase.from('work_order_operations').insert([{
                work_order_id: woId,
                sequence: nextSeq,
                operation_type: newOpType,
                description: newOpDesc || null,
                status: 'Pending'
            }]);
            if (error) throw error;
            setNewOpType("Cortar");
            setNewOpDesc("");
            setIsAddingOp(false);
            setStatusMsg({ type: 'success', text: "Operación agregada." });
            fetchAll();
            setTimeout(() => setStatusMsg(null), 2000);
        } catch (error: any) {
            setStatusMsg({ type: 'error', text: error.message });
        } finally {
            setIsSavingOp(false);
        }
    };

    const handleStartEdit = (op: Operation) => {
        setEditingOpId(op.id);
        setEditOpType(op.operation_type);
        setEditOpDesc(op.description || "");
    };

    const handleCancelEdit = () => {
        setEditingOpId(null);
        setEditOpType("");
        setEditOpDesc("");
    };

    const handleSaveEdit = async () => {
        if (!editingOpId) return;
        setIsSavingOp(true);
        try {
            const { error } = await supabase.from('work_order_operations').update({
                operation_type: editOpType,
                description: editOpDesc || null,
            }).eq('id', editingOpId);
            if (error) throw error;
            setEditingOpId(null);
            setStatusMsg({ type: 'success', text: "Operación actualizada." });
            fetchAll();
            setTimeout(() => setStatusMsg(null), 2000);
        } catch (error: any) {
            setStatusMsg({ type: 'error', text: error.message });
        } finally {
            setIsSavingOp(false);
        }
    };

    const handleDeleteOp = async (opId: string) => {
        if (!confirm("¿Eliminar esta operación?")) return;
        try {
            const { error } = await supabase.from('work_order_operations').delete().eq('id', opId);
            if (error) throw error;
            setStatusMsg({ type: 'success', text: "Operación eliminada." });
            fetchAll();
            setTimeout(() => setStatusMsg(null), 2000);
        } catch (error: any) {
            setStatusMsg({ type: 'error', text: error.message });
        }
    };

    const handleToggleOpStatus = async (op: Operation) => {
        const newStatus = op.status === 'Pending' ? 'Done' : 'Pending';
        await supabase.from('work_order_operations').update({ status: newStatus }).eq('id', op.id);
        fetchAll();
    };

    // --- File handlers ---
    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFiles = e.target.files;
        if (!selectedFiles || selectedFiles.length === 0) return;
        setIsUploading(true);
        setStatusMsg(null);
        try {
            for (let i = 0; i < selectedFiles.length; i++) {
                const file = selectedFiles[i];
                if (file.size > 100 * 1024 * 1024) {
                    setStatusMsg({ type: 'error', text: `El archivo "${file.name}" excede el límite de 100MB.` });
                    continue;
                }
                const filePath = `${woId}/${Date.now()}_${file.name}`;
                const { error: uploadError } = await supabase.storage.from('work_order_files').upload(filePath, file, { cacheControl: '3600', upsert: false, contentType: file.type });
                if (uploadError) throw uploadError;
                const { data: publicUrlData } = supabase.storage.from('work_order_files').getPublicUrl(filePath);
                const { error: insertError } = await supabase.from('work_order_files').insert([{
                    work_order_id: woId, file_name: file.name, file_url: publicUrlData.publicUrl, file_size: file.size, uploaded_by: 'company'
                }]);
                if (insertError) throw insertError;
            }
            setStatusMsg({ type: 'success', text: "¡Archivos subidos exitosamente!" });
            fetchAll();
        } catch (error: any) {
            setStatusMsg({ type: 'error', text: error.message || "Error al subir archivo." });
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleDeleteFile = async (fileId: string, fileUrl: string) => {
        if (!confirm("¿Eliminar este archivo?")) return;
        try {
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


    // --- QC Handlers ---
    const handleUploadQCPhoto = async (file: File) => {
        setIsUploadingQCPhoto(true);
        setQcStatusMsg(null);
        try {
            const filePath = `qc/${woId}/${Date.now()}_${file.name}`;
            const { error: uploadError } = await supabase.storage
                .from('work_order_files')
                .upload(filePath, file, { cacheControl: '3600', upsert: false, contentType: file.type });
            if (uploadError) throw uploadError;

            const { data: publicUrlData } = supabase.storage.from('work_order_files').getPublicUrl(filePath);

            const { error: insertError } = await supabase.from('work_order_qc_photos').insert([{
                work_order_id: woId,
                photo_url: publicUrlData.publicUrl,
                photo_label: qcLabel,
            }]);
            if (insertError) throw insertError;

            setQcStatusMsg({ type: 'success', text: "Foto agregada." });
            setTimeout(() => setQcStatusMsg(null), 2000);
            fetchAll();
        } catch (err: any) {
            setQcStatusMsg({ type: 'error', text: err.message || "Error al subir foto." });
        } finally {
            setIsUploadingQCPhoto(false);
        }
    };

    const handleDeleteQCPhoto = async (photoId: string, photoUrl: string) => {
        if (!confirm("¿Eliminar esta foto de evidencia?")) return;
        try {
            const urlParts = photoUrl.split('/work_order_files/');
            if (urlParts.length > 1) {
                await supabase.storage.from('work_order_files').remove([decodeURIComponent(urlParts[1])]);
            }
            await supabase.from('work_order_qc_photos').delete().eq('id', photoId);
            fetchAll();
        } catch (err: any) {
            console.error("Delete QC photo error:", err);
        }
    };

    const handleQCSign = async () => {
        if (!qcPassword) {
            setQcStatusMsg({ type: 'error', text: "Ingresa la contraseña de Calidad." });
            return;
        }
        setIsSigningQC(true);
        setQcStatusMsg(null);
        try {
            const res = await fetch('/api/qc-sign', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: qcPassword, work_order_id: woId }),
            });
            const json = await res.json();
            if (!json.ok) {
                setQcStatusMsg({ type: 'error', text: json.error || "Contraseña incorrecta." });
            } else {
                setQcStatusMsg({ type: 'success', text: "¡Primera pieza liberada exitosamente!" });
                setQcPassword("");
                fetchAll();
            }
        } catch (err: any) {
            setQcStatusMsg({ type: 'error', text: "Error de conexión." });
        } finally {
            setIsSigningQC(false);
        }
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
            : "bg-neutral-500/10 text-neutral-400 border-neutral-500/20";
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
                <RefreshCw className="w-8 h-8 animate-spin text-orange-400" />
            </div>
        );
    }

    if (!workOrder) {
        return (
            <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center text-neutral-400">
                <p>Work order not found.</p>
            </div>
        );
    }

    const isClosed = workOrder.status === 'Closed';

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-6 md:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-5xl mx-auto space-y-8">
                {/* Header */}
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                        <Link href="/manufacturing" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors text-neutral-400 hover:text-white border border-neutral-700">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div>
                            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                                <Factory className="w-8 h-8 text-orange-400" />
                                {workOrder.order_number}
                            </h1>
                            <div className="flex items-center gap-3 mt-1">
                                <span className="text-neutral-400 text-sm">Cotización:</span>
                                <span className="font-mono text-emerald-300 text-xs bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                                    {workOrder.quotation?.quotation_number}
                                </span>
                                <span className="text-neutral-400 text-sm">• {workOrder.quotation?.client?.business_name}</span>
                            </div>
                        </div>
                    </div>
                    <div className={cn("px-4 py-2 rounded-full text-sm font-semibold border",
                        workOrder.status === 'Open' ? "bg-orange-500/10 text-orange-400 border-orange-500/20" :
                            workOrder.status === 'In Progress' ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                                workOrder.status === 'Completed' ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                                    "bg-neutral-500/10 text-neutral-400 border-neutral-500/20"
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
                    <div className="bg-neutral-800/40 p-5 rounded-2xl border border-neutral-700/50">
                        <h3 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider mb-2">Notas</h3>
                        <p className="text-neutral-200">{workOrder.notes}</p>
                    </div>
                )}

                {/* Operations — Editable */}
                <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl overflow-hidden backdrop-blur-sm">
                    <div className="p-6 border-b border-neutral-700/50 bg-neutral-800/20 flex justify-between items-center">
                        <h2 className="text-xl font-semibold text-white">Operaciones (Routing)</h2>
                        {!isAddingOp && !isClosed && (
                            <button onClick={() => setIsAddingOp(true)}
                                className="flex items-center gap-2 text-sm text-orange-400 hover:text-orange-300 font-medium bg-orange-500/10 hover:bg-orange-500/20 px-4 py-2 rounded-lg transition-colors border border-orange-500/20">
                                <Plus className="w-4 h-4" /> Agregar Operación
                            </button>
                        )}
                        {isClosed && (
                            <span className="text-xs font-medium text-neutral-500 bg-neutral-500/10 px-3 py-1 rounded-lg border border-neutral-500/20 flex items-center gap-2">
                                <AlertCircle className="w-3.5 h-3.5" /> Lectura (Cerrada)
                            </span>
                        )}
                    </div>
                    <div className="p-6 space-y-3">
                        {/* Add New Operation Form */}
                        {isAddingOp && (
                            <div className="bg-orange-500/5 border border-orange-500/20 p-4 rounded-xl space-y-3">
                                <p className="text-sm font-semibold text-orange-400">Nueva Operación</p>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    <select value={newOpType} onChange={(e) => setNewOpType(e.target.value)}
                                        className="bg-neutral-900/80 border border-neutral-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-orange-500 transition-all appearance-none">
                                        {OPERATION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                    <input value={newOpDesc} onChange={(e) => setNewOpDesc(e.target.value)}
                                        className="bg-neutral-900/80 border border-neutral-700 rounded-lg px-3 py-2 text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500 transition-all md:col-span-2"
                                        placeholder="Descripción (opcional)" />
                                </div>
                                <div className="flex items-center gap-2 justify-end">
                                    <button onClick={() => { setIsAddingOp(false); setNewOpDesc(""); }}
                                        className="text-sm text-neutral-400 hover:text-white px-3 py-1.5 rounded-lg hover:bg-neutral-700 transition-colors">
                                        Cancelar
                                    </button>
                                    <button onClick={handleAddOperation} disabled={isSavingOp}
                                        className="text-sm text-orange-400 hover:text-white bg-orange-500/10 hover:bg-orange-500 px-4 py-1.5 rounded-lg border border-orange-500/20 transition-all flex items-center gap-1.5 font-medium disabled:opacity-50">
                                        {isSavingOp ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Guardar
                                    </button>
                                </div>
                            </div>
                        )}

                        {operations.length === 0 && !isAddingOp ? (
                            <p className="text-neutral-500 text-center py-4">No hay operaciones definidas. Agrega una con el botón de arriba.</p>
                        ) : (
                            operations.map((op) => (
                                <div key={op.id} className="flex items-center gap-3 bg-neutral-900/40 p-4 rounded-xl border border-neutral-700/30 hover:bg-neutral-800/60 transition-colors">
                                    {/* Toggle Done */}
                                    <button
                                        onClick={() => !isClosed && handleToggleOpStatus(op)}
                                        disabled={isClosed}
                                        className={cn("w-8 h-8 rounded-lg border-2 flex items-center justify-center transition-all flex-shrink-0",
                                            op.status === 'Done' ? "border-emerald-500 bg-emerald-500/20 text-emerald-400" : "border-neutral-600",
                                            !isClosed && "hover:border-orange-500",
                                            isClosed && "cursor-not-allowed opacity-70"
                                        )}
                                    >
                                        {op.status === 'Done' && <CheckCircle className="w-5 h-5" />}
                                    </button>

                                    {/* Content — view or edit mode */}
                                    {editingOpId === op.id ? (
                                        <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-2">
                                            <select value={editOpType} onChange={(e) => setEditOpType(e.target.value)}
                                                className="bg-neutral-900/80 border border-orange-500/30 rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-orange-500 transition-all appearance-none text-sm">
                                                {OPERATION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                            </select>
                                            <input value={editOpDesc} onChange={(e) => setEditOpDesc(e.target.value)}
                                                className="bg-neutral-900/80 border border-orange-500/30 rounded-lg px-3 py-1.5 text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500 transition-all text-sm md:col-span-2"
                                                placeholder="Descripción" />
                                        </div>
                                    ) : (
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-mono text-neutral-500">#{op.sequence}</span>
                                                <span className="font-semibold text-white">{op.operation_type}</span>
                                                <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-semibold border", getOpStatusStyle(op.status))}>
                                                    {op.status}
                                                </span>
                                            </div>
                                            {op.description && <p className="text-sm text-neutral-400 mt-0.5 truncate">{op.description}</p>}
                                        </div>
                                    )}

                                    {/* Action buttons */}
                                    <div className="flex items-center gap-1 flex-shrink-0">
                                        {!isClosed && (
                                            editingOpId === op.id ? (
                                                <>
                                                    <button onClick={handleSaveEdit} disabled={isSavingOp}
                                                        className="p-2 text-orange-400 hover:text-white hover:bg-orange-500/20 rounded-lg transition-colors" title="Guardar">
                                                        {isSavingOp ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                                    </button>
                                                    <button onClick={handleCancelEdit}
                                                        className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg transition-colors" title="Cancelar">
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                </>
                                            ) : (
                                                <>
                                                    <button onClick={() => handleStartEdit(op)}
                                                        className="p-2 text-neutral-500 hover:text-orange-400 hover:bg-orange-500/10 rounded-lg transition-colors" title="Editar">
                                                        <Edit2 className="w-4 h-4" />
                                                    </button>
                                                    <button onClick={() => handleDeleteOp(op.id)}
                                                        className="p-2 text-neutral-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors" title="Eliminar">
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </>
                                            )
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* QC First Piece Release Section */}
                <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl overflow-hidden backdrop-blur-sm">
                    <div className="p-6 border-b border-neutral-700/50 bg-neutral-800/20 flex justify-between items-center">
                        <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                            <ShieldCheck className="w-5 h-5 text-orange-400" />
                            Liberación de Primera Pieza
                        </h2>
                        {qcApproved && (
                            <span className="flex items-center gap-2 text-xs font-semibold text-emerald-400 bg-emerald-500/10 px-3 py-1.5 rounded-full border border-emerald-500/20">
                                <CheckCircle className="w-3.5 h-3.5" />
                                Liberada {qcApprovedAt ? `• ${new Date(qcApprovedAt).toLocaleString()}` : ''}
                            </span>
                        )}
                    </div>

                    <div className="p-6 space-y-6">
                        {/* Photo grid */}
                        {qcPhotos.length === 0 && !qcApproved && (
                            <div className="text-center py-6 text-neutral-500">
                                <Camera className="w-10 h-10 mx-auto mb-3 opacity-40" />
                                <p className="text-sm">No hay fotos de evidencia aún. Agrega al menos una antes de firmar.</p>
                            </div>
                        )}

                        {qcPhotos.length > 0 && (
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                                {qcPhotos.map((photo) => (
                                    <div key={photo.id} className="relative group rounded-xl overflow-hidden border border-neutral-700/50 bg-neutral-900/50">
                                        <a href={photo.photo_url} target="_blank" rel="noopener noreferrer">
                                            <img
                                                src={photo.photo_url}
                                                alt={photo.photo_label}
                                                className="w-full h-32 object-cover hover:opacity-90 transition-opacity"
                                                onError={(e) => { (e.target as HTMLImageElement).style.display='none'; }}
                                            />
                                        </a>
                                        <div className="p-2 flex items-center justify-between">
                                            <span className="text-xs text-neutral-400 truncate">{photo.photo_label}</span>
                                            {!qcApproved && (
                                                <button onClick={() => handleDeleteQCPhoto(photo.id, photo.photo_url)}
                                                    className="p-1 text-neutral-600 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors flex-shrink-0">
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Upload controls — hidden if already approved */}
                        {!qcApproved && (
                            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 bg-neutral-900/30 p-4 rounded-xl border border-neutral-700/30">
                                <select
                                    value={qcLabel}
                                    onChange={(e) => setQcLabel(e.target.value)}
                                    className="bg-neutral-900/80 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500 transition-all appearance-none"
                                >
                                    {QC_PHOTO_LABELS.map(l => <option key={l} value={l}>{l}</option>)}
                                </select>
                                <label className={cn(
                                    "flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg border transition-colors cursor-pointer",
                                    isUploadingQCPhoto
                                        ? "bg-neutral-700 text-neutral-400 border-neutral-600 cursor-wait"
                                        : "bg-orange-500/10 text-orange-400 border-orange-500/20 hover:bg-orange-500/20"
                                )}>
                                    {isUploadingQCPhoto ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                                    {isUploadingQCPhoto ? "Subiendo..." : "Agregar Foto"}
                                    <input type="file" accept="image/*" className="hidden" disabled={isUploadingQCPhoto}
                                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadQCPhoto(f); e.target.value = ''; }} />
                                </label>
                            </div>
                        )}

                        {/* QC status message */}
                        {qcStatusMsg && (
                            <div className={cn("p-3 rounded-xl border flex items-center gap-2 text-sm",
                                qcStatusMsg.type === 'error'
                                    ? "bg-red-500/10 border-red-500/30 text-red-400"
                                    : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                            )}>
                                {qcStatusMsg.type === 'error' ? <AlertCircle className="w-4 h-4 flex-shrink-0" /> : <CheckCircle className="w-4 h-4 flex-shrink-0" />}
                                {qcStatusMsg.text}
                            </div>
                        )}

                        {/* Sign section — hidden if already approved */}
                        {!qcApproved && (
                            <div className="border-t border-neutral-700/50 pt-5">
                                <p className="text-sm font-semibold text-neutral-300 mb-3 flex items-center gap-2">
                                    <Lock className="w-4 h-4 text-orange-400" />
                                    Firma de Calidad
                                </p>
                                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                                    <input
                                        type="password"
                                        value={qcPassword}
                                        onChange={(e) => setQcPassword(e.target.value)}
                                        placeholder="Contraseña de Calidad"
                                        className="flex-1 bg-neutral-900/50 border border-neutral-700 rounded-xl px-4 py-3 text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 transition-all text-sm"
                                        onKeyDown={(e) => { if (e.key === 'Enter' && qcPhotos.length > 0) handleQCSign(); }}
                                    />
                                    <button
                                        onClick={handleQCSign}
                                        disabled={isSigningQC || qcPhotos.length === 0}
                                        className="flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-500/40 disabled:cursor-not-allowed text-white px-6 py-3 rounded-xl font-semibold transition-all hover:shadow-[0_0_20px_rgba(249,115,22,0.4)] text-sm"
                                    >
                                        {isSigningQC ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                                        {isSigningQC ? "Firmando..." : "Firmar Liberación"}
                                    </button>
                                </div>
                                {qcPhotos.length === 0 && (
                                    <p className="text-xs text-neutral-600 mt-2">Debes agregar al menos una foto antes de poder firmar.</p>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Files */}
                <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl overflow-hidden backdrop-blur-sm">
                    <div className="p-6 border-b border-neutral-700/50 bg-neutral-800/20 flex justify-between items-center">
                        <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                            <Paperclip className="w-5 h-5 text-orange-400" /> Archivos Adjuntos
                        </h2>
                        {!isClosed && (
                            <label className={cn(
                                "flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg border transition-colors cursor-pointer",
                                isUploading
                                    ? "bg-neutral-700 text-neutral-400 border-neutral-600 cursor-wait"
                                    : "bg-orange-500/10 text-orange-400 border-orange-500/20 hover:bg-orange-500/20"
                            )}>
                                {isUploading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                                {isUploading ? "Subiendo..." : "Subir Archivos"}
                                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileUpload} disabled={isUploading} />
                            </label>
                        )}
                    </div>
                    <div className="p-6">
                        <p className="text-xs text-neutral-500 mb-4">Máximo 100MB por archivo.</p>
                        {files.length === 0 ? (
                            <div className="text-center py-8 text-neutral-500">
                                <FileText className="w-10 h-10 mx-auto mb-3 opacity-50" />
                                <p>No hay archivos adjuntos todavía.</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {files.map((file) => (
                                    <div key={file.id} className="flex items-center justify-between bg-neutral-900/40 p-3 rounded-xl border border-neutral-700/30 hover:bg-neutral-800/60 transition-colors">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <FileText className="w-5 h-5 text-orange-400 flex-shrink-0" />
                                            <div className="min-w-0">
                                                <p className="text-sm font-medium text-white truncate">{file.file_name}</p>
                                                <p className="text-xs text-neutral-500">{formatFileSize(file.file_size)} • {new Date(file.created_at).toLocaleDateString()}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            <a href={file.file_url} target="_blank" rel="noopener noreferrer"
                                                className="p-2 text-orange-400 hover:text-orange-300 hover:bg-orange-500/10 rounded-lg transition-colors" title="Download">
                                                <Download className="w-4 h-4" />
                                            </a>
                                            {!isClosed && (
                                                <button onClick={() => handleDeleteFile(file.id, file.file_url)}
                                                    className="p-2 text-neutral-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors" title="Delete">
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            )}
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
