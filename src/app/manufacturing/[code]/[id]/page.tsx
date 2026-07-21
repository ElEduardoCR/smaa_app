"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
    ArrowLeft, Factory, Play, Pause, CheckCircle2, AlertCircle, RefreshCw,
    Paperclip, Cog, Flame, Cpu, ShieldCheck, Camera, Image as ImageIcon, X,
    Plus, Trash2, FileText, Box, Save, Lock, ChevronRight, FileQuestion,
    Edit2, Send, Loader2, MapPin, ArrowRight, Upload, ListChecks
} from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";
import PdfViewer from "@/components/manufacturing/PdfViewer";
import StepViewer from "@/components/manufacturing/StepViewer";
import SignaturePad from "@/components/manufacturing/SignaturePad";
import PhotoCapture from "@/components/manufacturing/PhotoCapture";
import AttachmentUploader, { AttachedFile, fileTypeFromName } from "@/components/manufacturing/AttachmentUploader";
import { uploadSignatureDataUrl, uploadFileToBucket } from "@/lib/uploadHelpers";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

const ICONS: Record<string, any> = { Cog, Flame, Cpu };
const COLORS: Record<string, string> = { orange: "text-orange-400", amber: "text-amber-400", cyan: "text-cyan-400" };
const COLOR_BG: Record<string, string> = { orange: "bg-orange-500/10 border-orange-500/20 text-orange-300", amber: "bg-amber-500/10 border-amber-500/20 text-amber-300", cyan: "bg-cyan-500/10 border-cyan-500/20 text-cyan-300" };

const STATUS_LABEL: Record<string, string> = {
    "Open": "Abierta",
    "In Progress": "En curso",
    "Paused": "Pausada",
    "Completed": "Terminada",
    "QC": "En calidad",
    "QC_Released": "Liberada",
    "Cancelled": "Cancelada",
};
const STATUS_STYLE: Record<string, string> = {
    "Open": "bg-orange-500/10 text-orange-300 border-orange-500/30",
    "In Progress": "bg-sky-500/10 text-sky-300 border-sky-500/30",
    "Paused": "bg-amber-500/10 text-amber-300 border-amber-500/30",
    "Completed": "bg-violet-500/10 text-violet-300 border-violet-500/30",
    "QC": "bg-yellow-500/10 text-yellow-300 border-yellow-500/30",
    "QC_Released": "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
    "Cancelled": "bg-red-500/10 text-red-300 border-red-500/30",
};

const PAUSE_REASONS = [
    "Falta de materia prima",
    "Falta de documentación",
    "Falta de herramienta / equipo",
    "Mantenimiento programado",
    "Falta de personal",
    "Cambio de prioridad",
    "Otro",
];

type WO = {
    id: string;
    order_number: string;
    status: string;
    notes: string | null;
    work_title: string | null;
    priority: string | null;
    client_name: string | null;
    client_rfc: string | null;
    started_at: string | null;
    paused_at: string | null;
    completed_at: string | null;
    operator_name: string | null;
    operator_signature_url: string | null;
    qc_released_at: string | null;
    qc_released_by: string | null;
    qc_reject_reason: string | null;
    created_at: string;
    module_id: string;
    quotation_id: string | null;
    quotation?: {
        quotation_number: string;
        client?: { business_name: string; rfc?: string; address?: string; email?: string };
    } | null;
    module?: Module;
};
type Module = { id: string; code: string; name: string; color: string; icon: string };
type Wps = { id: string; code: string; name: string; joint_type: string | null; base_metal: string | null; filler_metal: string | null; position: string | null; shielding_gas: string | null; amperage: string | null; voltage: string | null; travel_speed: string | null; preheat_temp: string | null; notes: string | null };
type Pause = { id: string; reason: string; custom_reason: string | null; paused_at: string; resumed_at: string | null; paused_by: string | null; notes: string | null };
type CompletionPhoto = { id: string; photo_url: string; label: string; lat: number | null; lng: number | null; captured_at: string };

export default function WorkOrderDetailPage() {
    const params = useParams();
    const router = useRouter();
    const code = params?.code as string;
    const woId = params?.id as string;

    const [wo, setWo] = useState<WO | null>(null);
    const [module, setModule] = useState<Module | null>(null);
    const [wpsList, setWpsList] = useState<Wps[]>([]);
    const [pauses, setPauses] = useState<Pause[]>([]);
    const [attachments, setAttachments] = useState<AttachedFile[]>([]);
    const [completionPhotos, setCompletionPhotos] = useState<CompletionPhoto[]>([]);
    const [activeFile, setActiveFile] = useState<AttachedFile | null>(null);
    const [loading, setLoading] = useState(true);
    const [statusMsg, setStatusMsg] = useState<{ type: "error" | "success" | "info"; text: string } | null>(null);

    // Operator flow
    const [operatorName, setOperatorName] = useState("");
    const [pauseModalOpen, setPauseModalOpen] = useState(false);
    const [pauseReason, setPauseReason] = useState(PAUSE_REASONS[0]);
    const [pauseCustom, setPauseCustom] = useState("");
    const [pauseNotes, setPauseNotes] = useState("");
    const [finishing, setFinishing] = useState(false);

    // Inline status-update helpers
    const [busy, setBusy] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const { data: woData, error: woErr } = await supabase
                .from("work_orders")
                .select(`
                    id, order_number, status, notes, work_title, priority, client_name, client_rfc,
                    started_at, paused_at, completed_at, operator_name, operator_signature_url,
                    qc_released_at, qc_released_by, qc_reject_reason, created_at, module_id, quotation_id,
                    quotation:quotations(quotation_number, client:clients(business_name, rfc, address, email)),
                    module:manufacturing_modules(id, code, name, color, icon)
                `)
                .eq("id", woId)
                .single();
            if (woErr) throw woErr;
            const q: any = Array.isArray(woData.quotation) ? woData.quotation[0] : woData.quotation;
            if (q?.client && Array.isArray(q.client)) q.client = q.client[0];
            const m: any = Array.isArray(woData.module) ? woData.module[0] : woData.module;
            const formatted: WO = {
                ...woData,
                quotation: q || null,
                module: m || null,
            } as WO;
            setWo(formatted);
            setModule(m || null);

            const [{ data: atts }, { data: ps }, { data: cps }] = await Promise.all([
                supabase.from("work_order_files").select("*").eq("work_order_id", woId).order("created_at", { ascending: false }),
                supabase.from("work_order_pauses").select("*").eq("work_order_id", woId).order("paused_at", { ascending: false }),
                supabase.from("work_order_completion_photos").select("*").eq("work_order_id", woId).order("captured_at", { ascending: true }),
            ]);
            setAttachments(atts || []);
            setPauses(ps || []);
            setCompletionPhotos(cps || []);

            if (formatted.module?.code === "soldadura") {
                const { data: wps } = await supabase
                    .from("work_order_wps")
                    .select("wps_id, wps:wps_procedures(*)")
                    .eq("work_order_id", woId);
                setWpsList((wps || []).map((w: any) => Array.isArray(w.wps) ? w.wps[0] : w.wps).filter(Boolean));
            }
        } catch (e) {
            console.error(e);
            setStatusMsg({ type: "error", text: "No se pudo cargar la OT." });
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { if (woId) load(); }, [woId]);

    // Auto-select first PDF / STEP to show in viewer
    useEffect(() => {
        if (activeFile || attachments.length === 0) return;
        const firstViewable = attachments.find(a =>
            fileTypeFromName(a.file_name) === "pdf" || fileTypeFromName(a.file_name) === "step"
        );
        if (firstViewable) setActiveFile(firstViewable);
    }, [attachments, activeFile]);

    const flash = (type: "error" | "success" | "info", text: string) => {
        setStatusMsg({ type, text });
        setTimeout(() => setStatusMsg(null), 4000);
    };

    // --- Operator actions ---
    const handleStart = async () => {
        if (!wo) return;
        setBusy(true);
        try {
            const { error } = await supabase
                .from("work_orders")
                .update({ status: "In Progress", started_at: wo.started_at || new Date().toISOString(), paused_at: null })
                .eq("id", wo.id);
            if (error) throw error;
            flash("success", "OT iniciada. A trabajar 💪");
            await load();
        } catch (e: any) { flash("error", e?.message || "Error al iniciar."); }
        finally { setBusy(false); }
    };

    const handlePause = async () => {
        if (!wo) return;
        if (pauseReason === "Otro" && !pauseCustom.trim()) {
            flash("error", "Especifica el motivo de la pausa.");
            return;
        }
        setBusy(true);
        try {
            await supabase.from("work_order_pauses").insert([{
                work_order_id: wo.id,
                reason: pauseReason,
                custom_reason: pauseReason === "Otro" ? pauseCustom : null,
                notes: pauseNotes || null,
                paused_at: new Date().toISOString(),
                paused_by: operatorName || wo.operator_name || null,
            }]);
            await supabase.from("work_orders")
                .update({ status: "Paused", paused_at: new Date().toISOString() })
                .eq("id", wo.id);
            setPauseModalOpen(false);
            setPauseCustom(""); setPauseNotes(""); setPauseReason(PAUSE_REASONS[0]);
            flash("info", "OT pausada.");
            await load();
        } catch (e: any) { flash("error", e?.message || "Error al pausar."); }
        finally { setBusy(false); }
    };

    const handleResume = async () => {
        if (!wo) return;
        setBusy(true);
        try {
            const lastPause = pauses.find(p => !p.resumed_at);
            if (lastPause) {
                await supabase.from("work_order_pauses")
                    .update({ resumed_at: new Date().toISOString() })
                    .eq("id", lastPause.id);
            }
            await supabase.from("work_orders")
                .update({ status: "In Progress", paused_at: null })
                .eq("id", wo.id);
            flash("success", "OT reanudada.");
            await load();
        } catch (e: any) { flash("error", e?.message || "Error al reanudar."); }
        finally { setBusy(false); }
    };

    const handleFinish = async (signatureDataUrl: string) => {
        if (!wo) return;
        if (!operatorName.trim()) {
            flash("error", "Captura tu nombre antes de firmar.");
            return;
        }
        setFinishing(true);
        try {
            const sigUrl = await uploadSignatureDataUrl(signatureDataUrl, `wo_${wo.order_number}`);
            await supabase.from("work_orders").update({
                status: "QC",
                completed_at: new Date().toISOString(),
                operator_name: operatorName,
                operator_signature_url: sigUrl,
            }).eq("id", wo.id);
            flash("success", "OT terminada. Enviada a Calidad ✅");
            await load();
        } catch (e: any) {
            flash("error", e?.message || "No se pudo guardar la firma.");
        } finally {
            setFinishing(false);
        }
    };

    const handleCancel = async () => {
        if (!wo) return;
        if (!confirm("¿Cancelar esta OT? Esta acción no se puede deshacer.")) return;
        setBusy(true);
        try {
            await supabase.from("work_orders").update({ status: "Cancelled" }).eq("id", wo.id);
            flash("info", "OT cancelada.");
            await load();
        } catch (e: any) { flash("error", e?.message || "Error."); }
        finally { setBusy(false); }
    };

    // --- Photo upload (operator) ---
    const handleAddCompletionPhoto = async (file: File, geo: { lat: number; lng: number; source: string } | null) => {
        if (!wo) return;
        try {
            const path = `completion/${wo.id}/${Date.now()}_${file.name}`;
            const url = await uploadFileToBucket(file, "work_order_files", path);
            await supabase.from("work_order_completion_photos").insert([{
                work_order_id: wo.id,
                photo_url: url,
                label: "Pieza terminada",
                lat: geo?.lat || null,
                lng: geo?.lng || null,
                location_source: geo?.source || null,
                captured_by: operatorName || null,
            }]);
            flash("success", "Foto agregada.");
            await load();
        } catch (e: any) { flash("error", e?.message || "Error al subir."); }
    };

    const handleDeleteCompletionPhoto = async (id: string) => {
        if (!confirm("¿Eliminar esta foto?")) return;
        try {
            await supabase.from("work_order_completion_photos").delete().eq("id", id);
            await load();
        } catch (e: any) { flash("error", e?.message || "Error."); }
    };

    // --- QC actions (when status = QC and not yet released) ---
    const handleQCRelease = async (signatureDataUrl: string) => {
        if (!wo) return;
        setFinishing(true);
        try {
            const sigUrl = await uploadSignatureDataUrl(signatureDataUrl, `qc_${wo.order_number}`);
            await supabase.from("work_order_qc_records").insert([{
                work_order_id: wo.id,
                decision: "released",
                inspector_name: operatorName || "Calidad",
                signature_url: sigUrl,
            }]);
            await supabase.from("work_orders").update({
                status: "QC_Released",
                qc_released_at: new Date().toISOString(),
                qc_released_by: operatorName || "Calidad",
            }).eq("id", wo.id);
            flash("success", "OT liberada por Calidad ✅");
            await load();
        } catch (e: any) { flash("error", e?.message || "Error al liberar."); }
        finally { setFinishing(false); }
    };

    const handleQCReject = async () => {
        if (!wo) return;
        const reason = prompt("Motivo de rechazo:");
        if (!reason) return;
        try {
            await supabase.from("work_order_qc_records").insert([{
                work_order_id: wo.id,
                decision: "rejected",
                comments: reason,
                inspector_name: operatorName || "Calidad",
            }]);
            await supabase.from("work_orders").update({
                status: "In Progress",  // back to operator
                qc_rejected_at: new Date().toISOString(),
                qc_reject_reason: reason,
            }).eq("id", wo.id);
            flash("info", "OT regresada al operador.");
            await load();
        } catch (e: any) { flash("error", e?.message || "Error."); }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
                <RefreshCw className="w-8 h-8 animate-spin text-orange-400" />
            </div>
        );
    }
    if (!wo) {
        return (
            <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 flex items-center justify-center">
                <p>OT no encontrada.</p>
            </div>
        );
    }

    const Icon = module ? (ICONS[module.icon] || Factory) : Factory;
    const colorCls = module ? (COLORS[module.color] || "text-orange-400") : "text-orange-400";
    const colorPill = module ? (COLOR_BG[module.color] || COLOR_BG.orange) : COLOR_BG.orange;
    const lastPause = pauses.find(p => !p.resumed_at);

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 font-[family-name:var(--font-sans)]">
            <div className="p-4 md:p-6 max-w-[1800px] mx-auto">
                {/* Header */}
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-neutral-800/40 p-5 rounded-2xl border border-neutral-700/50 mb-5">
                    <div className="flex items-center gap-3 min-w-0">
                        <Link href={`/manufacturing/${code}`} className="p-2.5 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors text-neutral-400 hover:text-white border border-neutral-700 flex-shrink-0">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <Icon className={cn("w-6 h-6", colorCls)} />
                                <h1 className="text-2xl font-bold text-white">{wo.order_number}</h1>
                                <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border uppercase", colorPill)}>
                                    {module?.name}
                                </span>
                                <span className={cn("text-xs font-semibold px-2.5 py-1 rounded-full border", STATUS_STYLE[wo.status])}>
                                    {STATUS_LABEL[wo.status] || wo.status}
                                </span>
                            </div>
                            {wo.work_title && <p className="text-sm text-neutral-200 mt-0.5 truncate">{wo.work_title}</p>}
                            <p className="text-xs text-neutral-500 mt-0.5">
                                {wo.quotation?.client?.business_name || wo.client_name || "—"}
                                {wo.quotation?.quotation_number ? ` · Cot. ${wo.quotation.quotation_number}` : ""}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                        <button onClick={load} className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg transition-colors flex items-center gap-2 text-sm" disabled={loading}>
                            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin", colorCls)} />
                        </button>
                    </div>
                </header>

                {statusMsg && (
                    <div className={cn(
                        "p-3 rounded-xl border flex items-center gap-3 mb-4",
                        statusMsg.type === "error" ? "bg-red-500/10 border-red-500/30 text-red-300" :
                        statusMsg.type === "success" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" :
                        "bg-sky-500/10 border-sky-500/30 text-sky-300"
                    )}>
                        {statusMsg.type === "error" ? <AlertCircle className="w-5 h-5" /> : statusMsg.type === "success" ? <CheckCircle2 className="w-5 h-5" /> : <ArrowRight className="w-5 h-5" />}
                        {statusMsg.text}
                    </div>
                )}

                {/* Two-column layout */}
                <div className="grid grid-cols-1 xl:grid-cols-[1fr_640px] gap-5">
                    {/* LEFT: actions */}
                    <div className="space-y-5 min-w-0">
                        {/* Operator name */}
                        {wo.status !== "Cancelled" && wo.status !== "QC_Released" && (
                            <div className="bg-neutral-800/40 p-4 rounded-2xl border border-neutral-700/50 flex flex-col sm:flex-row sm:items-center gap-3">
                                <label className="text-xs text-neutral-400 whitespace-nowrap">Operador responsable</label>
                                <input
                                    value={operatorName}
                                    onChange={e => setOperatorName(e.target.value)}
                                    className="flex-1 bg-neutral-900/60 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
                                    placeholder="Tu nombre completo"
                                />
                            </div>
                        )}

                        {/* Action panel by status */}
                        {wo.status === "Open" && (
                            <ActionCard
                                color="orange"
                                title="Lista para iniciar"
                                desc="Cuando arranques, el cronómetro empieza a contar."
                                primaryLabel="Iniciar trabajo"
                                onPrimary={handleStart}
                                busy={busy}
                                Icon={Play}
                            />
                        )}

                        {wo.status === "In Progress" && (
                            <div className="space-y-3">
                                <ActionCard
                                    color="sky"
                                    title="En curso"
                                    desc="Puedes pausar si te falta algo, o terminar si ya está lista."
                                    primaryLabel="Pausar"
                                    onPrimary={() => setPauseModalOpen(true)}
                                    secondaryLabel="Marcar como terminada"
                                    onSecondary={() => {/* opens signature via separate section */}}
                                    busy={busy}
                                    Icon={Pause}
                                    onCompleteShortcut
                                    openCompleteTrigger={() => document.getElementById("complete-section")?.scrollIntoView({ behavior: "smooth" })}
                                />
                                {wo.started_at && (
                                    <p className="text-xs text-neutral-500 text-center">
                                        Iniciada {new Date(wo.started_at).toLocaleString()}
                                    </p>
                                )}
                            </div>
                        )}

                        {wo.status === "Paused" && (
                            <div className="space-y-3">
                                <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4">
                                    <p className="text-sm text-amber-200 font-medium flex items-center gap-2">
                                        <Pause className="w-4 h-4" /> Pausada
                                    </p>
                                    {lastPause && (
                                        <p className="text-xs text-amber-100/80 mt-1">
                                            Motivo: {lastPause.reason}{lastPause.custom_reason ? ` (${lastPause.custom_reason})` : ""} · {new Date(lastPause.paused_at).toLocaleString()}
                                            {lastPause.notes ? ` · ${lastPause.notes}` : ""}
                                        </p>
                                    )}
                                </div>
                                <ActionCard
                                    color="emerald"
                                    title="Reanudar trabajo"
                                    desc="Volver a 'En curso' y cerrar la pausa actual."
                                    primaryLabel="Reanudar"
                                    onPrimary={handleResume}
                                    busy={busy}
                                    Icon={Play}
                                />
                            </div>
                        )}

                        {wo.status === "Completed" && (
                            <div className="bg-violet-500/10 border border-violet-500/30 rounded-2xl p-4 text-violet-200 text-sm flex items-center gap-2">
                                <CheckCircle2 className="w-5 h-5" /> Esperando entrada a Calidad.
                            </div>
                        )}

                        {wo.status === "QC" && (
                            <div className="space-y-3">
                                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-4 text-yellow-200 text-sm flex items-center gap-2">
                                    <ShieldCheck className="w-5 h-5" /> Esta OT está en el módulo de Calidad para revisión final.
                                </div>
                                {wo.operator_signature_url && (
                                    <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-4">
                                        <p className="text-xs text-neutral-400 uppercase tracking-wider mb-2">Firma del operador</p>
                                        <div className="flex items-center gap-3">
                                            <img src={wo.operator_signature_url} alt="firma operador" className="h-16 bg-neutral-900/50 rounded-lg p-1 border border-neutral-700" />
                                            <div className="text-sm">
                                                <p className="text-white">{wo.operator_name}</p>
                                                <p className="text-neutral-500 text-xs">{wo.completed_at ? new Date(wo.completed_at).toLocaleString() : ""}</p>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {wo.status === "QC_Released" && (
                            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4 text-emerald-200 text-sm">
                                <p className="font-medium flex items-center gap-2"><ShieldCheck className="w-5 h-5" /> Liberada por Calidad</p>
                                <p className="text-emerald-300/80 mt-1 text-xs">
                                    {wo.qc_released_by} · {wo.qc_released_at ? new Date(wo.qc_released_at).toLocaleString() : ""}
                                </p>
                                <Link
                                    href="/deliveries"
                                    className="inline-flex items-center gap-1.5 mt-2 text-emerald-300 hover:text-white text-xs font-medium"
                                >
                                    Ir a Entregas <ArrowRight className="w-3.5 h-3.5" />
                                </Link>
                            </div>
                        )}

                        {/* WPS for soldadura */}
                        {module?.code === "soldadura" && (
                            <div className="bg-amber-500/5 border border-amber-500/30 rounded-2xl p-5 space-y-3">
                                <h3 className="text-sm font-bold text-amber-200 uppercase tracking-wider flex items-center gap-2">
                                    <Flame className="w-4 h-4" /> WPS Asignado
                                </h3>
                                {wpsList.length === 0 ? (
                                    <p className="text-xs text-amber-100/60">Esta OT no tiene WPS asignados.</p>
                                ) : wpsList.map(w => (
                                    <div key={w.id} className="bg-neutral-900/50 rounded-xl p-3 border border-neutral-700/50">
                                        <div className="flex items-center gap-2">
                                            <span className="font-mono text-amber-300 text-xs">{w.code}</span>
                                            <span className="text-sm text-white font-medium">{w.name}</span>
                                        </div>
                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 mt-2 text-[11px] text-neutral-300">
                                            {w.joint_type && <div><span className="text-neutral-500">Tipo:</span> {w.joint_type}</div>}
                                            {w.base_metal && <div><span className="text-neutral-500">Metal base:</span> {w.base_metal}</div>}
                                            {w.filler_metal && <div><span className="text-neutral-500">Consumible:</span> {w.filler_metal}</div>}
                                            {w.shielding_gas && <div><span className="text-neutral-500">Gas:</span> {w.shielding_gas}</div>}
                                            {w.position && <div><span className="text-neutral-500">Posición:</span> {w.position}</div>}
                                            {w.amperage && <div><span className="text-neutral-500">Amperaje:</span> {w.amperage}</div>}
                                            {w.voltage && <div><span className="text-neutral-500">Voltaje:</span> {w.voltage}</div>}
                                            {w.travel_speed && <div><span className="text-neutral-500">Velocidad:</span> {w.travel_speed}</div>}
                                            {w.preheat_temp && <div><span className="text-neutral-500">Precalentamiento:</span> {w.preheat_temp}</div>}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Notes */}
                        {wo.notes && (
                            <div className="bg-neutral-800/40 p-5 rounded-2xl border border-neutral-700/50">
                                <h3 className="text-xs text-neutral-400 uppercase tracking-wider mb-2">Notas de la OT</h3>
                                <p className="text-sm text-neutral-200 whitespace-pre-wrap">{wo.notes}</p>
                            </div>
                        )}

                        {/* Pause history */}
                        {pauses.length > 0 && (
                            <div className="bg-neutral-800/40 p-5 rounded-2xl border border-neutral-700/50">
                                <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
                                    <ListChecks className="w-4 h-4 text-amber-400" /> Historial de pausas
                                </h3>
                                <ul className="space-y-2 text-xs">
                                    {pauses.map(p => (
                                        <li key={p.id} className="flex items-start gap-3 bg-neutral-900/40 p-2.5 rounded-lg border border-neutral-700/30">
                                            <Pause className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                                            <div className="flex-1">
                                                <p className="text-amber-200">{p.reason}{p.custom_reason ? ` (${p.custom_reason})` : ""}</p>
                                                <p className="text-neutral-500">
                                                    {new Date(p.paused_at).toLocaleString()} {p.paused_by ? `· ${p.paused_by}` : ""}
                                                    {p.resumed_at ? ` → ${new Date(p.resumed_at).toLocaleString()}` : " · (abierta)"}
                                                </p>
                                                {p.notes && <p className="text-neutral-400 mt-0.5">{p.notes}</p>}
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {/* Completion (operator) */}
                        {wo.status === "In Progress" && (
                            <div id="complete-section" className="bg-neutral-800/40 p-5 rounded-2xl border border-neutral-700/50 space-y-4">
                                <h3 className="text-base font-bold text-white flex items-center gap-2">
                                    <CheckCircle2 className="w-5 h-5 text-emerald-400" /> Terminar trabajo
                                </h3>
                                <p className="text-sm text-neutral-400">
                                    Sube fotos de evidencia (con o sin GPS) y firma al final para enviar la OT a Calidad.
                                </p>

                                {/* Completion photos */}
                                <div>
                                    <p className="text-xs uppercase tracking-wider text-neutral-400 mb-2">Fotos de la pieza terminada</p>
                                    {completionPhotos.length > 0 && (
                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-2">
                                            {completionPhotos.map(p => (
                                                <div key={p.id} className="relative group">
                                                    <img src={p.photo_url} alt="" className="rounded-lg w-full h-24 object-cover border border-neutral-700/50" />
                                                    {p.lat && p.lng && (
                                                        <div className="absolute bottom-1 left-1 right-1 bg-black/60 text-[10px] text-emerald-300 px-1.5 py-0.5 rounded flex items-center gap-1">
                                                            <MapPin className="w-2.5 h-2.5" /> {p.lat.toFixed(4)}, {p.lng.toFixed(4)}
                                                        </div>
                                                    )}
                                                    <button onClick={() => handleDeleteCompletionPhoto(p.id)} className="absolute top-1 right-1 p-1 rounded bg-black/60 text-neutral-300 hover:text-red-300 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <Trash2 className="w-3 h-3" />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    <PhotoCapture onCapture={handleAddCompletionPhoto} label="Foto del terminado" />
                                </div>

                                {/* Signature */}
                                <div className="border-t border-neutral-700/50 pt-4">
                                    <p className="text-xs uppercase tracking-wider text-neutral-400 mb-2">Firma del operador</p>
                                    <SignaturePad
                                        onSave={handleFinish}
                                        saving={finishing}
                                        savingLabel="Enviando a Calidad…"
                                        saveLabel="Firmar y enviar a Calidad"
                                    />
                                </div>
                            </div>
                        )}

                        {/* QC release (calidad) */}
                        {wo.status === "QC" && (
                            <div className="bg-sky-500/5 border border-sky-500/30 p-5 rounded-2xl space-y-4">
                                <h3 className="text-base font-bold text-sky-200 flex items-center gap-2">
                                    <ShieldCheck className="w-5 h-5" /> Revisión de Calidad
                                </h3>
                                <p className="text-sm text-sky-100/80">
                                    Revisa las fotos del operador y la firma. Si todo está correcto, firma como calidad para liberar la OT a entregas.
                                </p>

                                {completionPhotos.length > 0 && (
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                        {completionPhotos.map(p => (
                                            <a key={p.id} href={p.photo_url} target="_blank" rel="noopener noreferrer" className="block">
                                                <img src={p.photo_url} className="rounded-lg w-full h-28 object-cover border border-neutral-700/50 hover:opacity-90" />
                                            </a>
                                        ))}
                                    </div>
                                )}

                                <div className="border-t border-sky-500/20 pt-4">
                                    <p className="text-xs uppercase tracking-wider text-sky-200 mb-2">Firma de Calidad (liberación)</p>
                                    <SignaturePad
                                        onSave={handleQCRelease}
                                        saving={finishing}
                                        color="#38bdf8"
                                        savingLabel="Liberando…"
                                        saveLabel="Firmar y liberar"
                                    />
                                </div>

                                <div className="flex justify-end">
                                    <button onClick={handleQCReject} className="text-sm text-red-300 hover:text-white bg-red-500/10 hover:bg-red-500/30 px-4 py-2 rounded-lg border border-red-500/30 flex items-center gap-1.5">
                                        <X className="w-4 h-4" /> Rechazar y devolver al operador
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Cancel action */}
                        {wo.status !== "Cancelled" && wo.status !== "QC_Released" && (
                            <div className="flex justify-end">
                                <button onClick={handleCancel} className="text-xs text-neutral-500 hover:text-red-400 transition-colors">
                                    Cancelar OT
                                </button>
                            </div>
                        )}
                    </div>

                    {/* RIGHT: viewer column (PDF / 3D / image) */}
                    <aside className="space-y-3 min-w-0">
                        <div className="bg-neutral-800/40 p-4 rounded-2xl border border-neutral-700/50 space-y-3 min-w-0">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                                    <Paperclip className="w-4 h-4 text-orange-400" /> Archivos
                                </h3>
                                <span className="text-xs text-neutral-500">{attachments.length} adjunto{attachments.length === 1 ? "" : "s"}</span>
                            </div>
                            <AttachmentUploader
                                workOrderId={wo.id}
                                attachments={attachments}
                                onChange={load}
                            />
                        </div>

                        {/* Active viewer */}
                        {activeFile ? (
                            <div className="h-[640px] min-w-0">
                                {fileTypeFromName(activeFile.file_name) === "pdf" ? (
                                    <PdfViewer url={activeFile.file_url} fileName={activeFile.file_name} onClose={() => setActiveFile(null)} />
                                ) : fileTypeFromName(activeFile.file_name) === "step" ? (
                                    <StepViewer fileUrl={activeFile.file_url} fileName={activeFile.file_name} onClose={() => setActiveFile(null)} />
                                ) : (
                                    <div className="bg-neutral-900/60 rounded-2xl border border-neutral-700/50 p-4 h-full flex flex-col">
                                        <p className="text-sm font-medium text-white truncate flex-1">{activeFile.file_name}</p>
                                        <a href={activeFile.file_url} target="_blank" rel="noopener noreferrer" className="text-orange-400 text-xs underline self-end">Abrir en nueva pestaña</a>
                                    </div>
                                )}
                            </div>
                        ) : attachments.length > 0 ? (
                            <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-6 text-center text-neutral-500 text-sm">
                                <Box className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                Selecciona un PDF o STEP arriba para previsualizar.
                            </div>
                        ) : null}

                        {/* File list / quick switch */}
                        {attachments.length > 0 && (
                            <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-3">
                                <p className="text-xs uppercase tracking-wider text-neutral-400 mb-2 px-1">Cambiar de archivo</p>
                                <ul className="space-y-1 max-h-44 overflow-y-auto">
                                    {attachments.map(a => {
                                        const type = fileTypeFromName(a.file_name);
                                        const isOn = activeFile?.id === a.id;
                                        return (
                                            <li key={a.id || a.file_url}>
                                                <button
                                                    onClick={() => setActiveFile(a)}
                                                    className={cn(
                                                        "w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors",
                                                        isOn ? "bg-orange-500/10 text-orange-200" : "text-neutral-300 hover:bg-neutral-700/50"
                                                    )}
                                                >
                                                    {type === "pdf" && <FileText className="w-4 h-4 text-rose-400" />}
                                                    {type === "step" && <Box className="w-4 h-4 text-cyan-400" />}
                                                    {type === "image" && <ImageIcon className="w-4 h-4 text-emerald-400" />}
                                                    {type === "other" && <FileQuestion className="w-4 h-4 text-neutral-400" />}
                                                    <span className="truncate flex-1">{a.file_name}</span>
                                                    {type === "pdf" && <span className="text-[10px] text-rose-300/80">PDF</span>}
                                                    {type === "step" && <span className="text-[10px] text-cyan-300/80">3D</span>}
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        )}
                    </aside>
                </div>
            </div>

            {/* Pause modal */}
            {pauseModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setPauseModalOpen(false)}>
                    <div className="bg-neutral-900 border border-neutral-700 rounded-2xl p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
                        <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-3">
                            <Pause className="w-5 h-5 text-amber-400" /> Pausar OT
                        </h3>
                        <p className="text-sm text-neutral-400 mb-4">¿Por qué pausas este trabajo?</p>
                        <div className="space-y-3">
                            <select
                                value={pauseReason}
                                onChange={e => setPauseReason(e.target.value)}
                                className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500"
                            >
                                {PAUSE_REASONS.map(r => <option key={r}>{r}</option>)}
                            </select>
                            {pauseReason === "Otro" && (
                                <input
                                    value={pauseCustom}
                                    onChange={e => setPauseCustom(e.target.value)}
                                    placeholder="Especifica el motivo…"
                                    className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500"
                                />
                            )}
                            <textarea
                                value={pauseNotes}
                                onChange={e => setPauseNotes(e.target.value)}
                                placeholder="Notas adicionales (opcional)…"
                                className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500 min-h-[60px]"
                            />
                        </div>
                        <div className="flex justify-end gap-2 mt-5">
                            <button onClick={() => setPauseModalOpen(false)} className="px-4 py-2 rounded-lg text-neutral-300 hover:text-white hover:bg-neutral-800 text-sm">
                                Cancelar
                            </button>
                            <button onClick={handlePause} disabled={busy} className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-semibold text-sm flex items-center gap-1.5 disabled:opacity-50">
                                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pause className="w-4 h-4" />}
                                Pausar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function ActionCard({
    color, title, desc, primaryLabel, onPrimary, secondaryLabel, onSecondary, busy, Icon, onCompleteShortcut, openCompleteTrigger,
}: {
    color: "orange" | "sky" | "emerald" | "amber";
    title: string; desc: string;
    primaryLabel: string; onPrimary: () => void;
    secondaryLabel?: string; onSecondary?: () => void;
    busy: boolean;
    Icon: any;
    onCompleteShortcut?: boolean;
    openCompleteTrigger?: () => void;
}) {
    const palette: Record<string, string> = {
        orange:  "border-orange-500/30 bg-orange-500/5 text-orange-200",
        sky:     "border-sky-500/30 bg-sky-500/5 text-sky-200",
        emerald: "border-emerald-500/30 bg-emerald-500/5 text-emerald-200",
        amber:   "border-amber-500/30 bg-amber-500/5 text-amber-200",
    };
    const btn: Record<string, string> = {
        orange:  "bg-orange-500 hover:bg-orange-600",
        sky:     "bg-sky-500 hover:bg-sky-600",
        emerald: "bg-emerald-500 hover:bg-emerald-600",
        amber:   "bg-amber-500 hover:bg-amber-600",
    };
    return (
        <div className={cn("rounded-2xl border p-5 flex flex-col sm:flex-row sm:items-center gap-3", palette[color])}>
            <Icon className="w-7 h-7 flex-shrink-0" />
            <div className="flex-1">
                <p className="font-bold">{title}</p>
                <p className="text-sm opacity-80">{desc}</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
                {onCompleteShortcut && (
                    <button onClick={openCompleteTrigger} className="text-sm bg-neutral-800/70 hover:bg-neutral-700 text-white px-4 py-2 rounded-lg flex items-center gap-1.5 font-medium">
                        <CheckCircle2 className="w-4 h-4" /> Terminar trabajo
                    </button>
                )}
                <button
                    onClick={onPrimary}
                    disabled={busy}
                    className={cn("text-sm text-white px-4 py-2 rounded-lg font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50", btn[color])}
                >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}
                    {primaryLabel}
                </button>
                {secondaryLabel && onSecondary && (
                    <button onClick={onSecondary} className="text-sm text-neutral-200 hover:text-white bg-neutral-800/70 hover:bg-neutral-700 px-4 py-2 rounded-lg">
                        {secondaryLabel}
                    </button>
                )}
            </div>
        </div>
    );
}
