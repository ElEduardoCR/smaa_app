"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import QuotationWorkflowPanel from "@/components/QuotationWorkflowPanel";
import EditHistory from "@/components/EditHistory";
import { supabase } from "@/lib/supabase";
import {
    ArrowLeft, Play, Pause, CheckCircle2, AlertCircle, RefreshCw, Paperclip, Flame, ShieldCheck, Image as ImageIcon, X,
    Trash2, FileText, Box, Lock, FileQuestion, Loader2, MapPin, ArrowRight, ListChecks, Users, UserPlus, Check,
    MessageSquarePlus, History, Sparkles, Edit2, Wrench, PackageCheck, Truck, ChevronUp, ChevronDown,
} from "lucide-react";
import PdfViewer from "@/components/manufacturing/PdfViewer";
import StepViewer from "@/components/manufacturing/StepViewer";
import SignaturePad from "@/components/manufacturing/SignaturePad";
import PhotoCapture from "@/components/manufacturing/PhotoCapture";
import AttachmentUploader, { AttachedFile, fileTypeFromName } from "@/components/manufacturing/AttachmentUploader";
import { uploadSignatureDataUrl, uploadFileToBucket } from "@/lib/uploadHelpers";
import { safeStorageName } from "@/lib/storageNames";
import {
    cancelWorkOrderAction, closeStageAction, decideClosureAction, listWarrantyRecordsAction, openWarrantyAction,
    pauseStageAction, resumeStageAction, startStageAction, updateWorkOrderAction, type WarrantyRecord,
} from "@/app/actions/manufacturing";
import {
    cn, KIND_LABEL, ProcessIcon, processColor, ProgressBar, qty, StagePicker, STAGE_STATUS_LABEL, STATUS_LABEL, STATUS_STYLE,
    type ModuleRow,
} from "../../shared";

const PAUSE_REASONS = [
    "Falta de materia prima",
    "Falta de documentación",
    "Falta de herramienta / equipo",
    "Mantenimiento programado",
    "Falta de personal",
    "Cambio de prioridad",
    "Otro",
];

type ProcessPermissions = { view: boolean; start: boolean; pause: boolean; complete: boolean; edit: boolean; delete: boolean; create: boolean };
export type DetailPermissions = {
    byProcess: Record<string, ProcessPermissions>;
    quality: { view: boolean; edit: boolean };
    canEditOrder: boolean;
    canCancelOrder: boolean;
    canWarranty: boolean;
    canCreateDelivery: boolean;
    canViewSales: boolean;
};

type WO = {
    id: string; order_number: string; status: string; work_title: string | null; priority: string | null;
    client_name: string | null; client_rfc: string | null; created_at: string; created_by_name: string | null;
    quotation_id: string | null; quantity: number; unit: string; order_kind: string; parent_work_order_id: string | null;
    warranty_count: number; cancel_reason: string | null; qc_reject_reason: string | null; operator_name: string | null;
    quotation?: { quotation_number: string; title?: string | null; client?: { name?: string | null; business_name: string } | null } | null;
};
type Stage = {
    stage_id: string; work_order_id: string; module_id: string; module_code: string; module_name: string; module_icon: string;
    sequence: number; status: string; started_at: string | null; paused_at: string | null; completed_at: string | null;
    is_final: boolean; qty_target: number; qty_done: number; qty_available: number;
};
type Closure = {
    id: string; stage_id: string; sequence_no: number; quantity: number; is_final: boolean; qc_status: string;
    qc_released_qty: number | null; qc_rejected_qty: number | null; operator_name: string; signature_url: string | null;
    notes: string | null; closed_at: string; qc_decided_at: string | null; qc_decided_by_name: string | null;
    qc_signature_url: string | null; qc_comments: string | null;
};
type Photo = { id: string; photo_url: string; label: string; lat: number | null; lng: number | null; captured_at: string; stage_id: string | null; closure_id: string | null };
type PauseRow = { id: string; stage_id: string | null; reason: string; custom_reason: string | null; paused_at: string; resumed_at: string | null; paused_by: string | null; notes: string | null };
type EmployeeOpt = { id: string; full_name: string; username: string; role: string; position: string | null; photo_url: string | null };
type OperatorAssignment = { id: string; employee_id: string; role: string; added_at: string; employee: EmployeeOpt | null };
type Note = { id: string; note: string; created_by_name: string | null; created_at: string };
type Wps = { id: string; code: string; name: string; joint_type: string | null; base_metal: string | null; filler_metal: string | null; position: string | null; shielding_gas: string | null; amperage: string | null; voltage: string | null; travel_speed: string | null; preheat_temp: string | null };
type Delivery = { id: string; delivery_number: string; quantity: number | null; stage: string; created_at: string; delivered_at: string | null; warranty_cycle: number };
type Child = { id: string; order_number: string; order_kind: string; status: string; quantity: number };

const one = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);

export default function WorkOrderDetail({ woId, permissions, me }: { woId: string; permissions: DetailPermissions; me: { id: string; fullName: string } }) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [wo, setWo] = useState<WO | null>(null);
    const [parentNumber, setParentNumber] = useState<string | null>(null);
    const [stages, setStages] = useState<Stage[]>([]);
    const [closures, setClosures] = useState<Closure[]>([]);
    const [photos, setPhotos] = useState<Photo[]>([]);
    const [pauses, setPauses] = useState<PauseRow[]>([]);
    const [notes, setNotes] = useState<Note[]>([]);
    const [operators, setOperators] = useState<OperatorAssignment[]>([]);
    const [employees, setEmployees] = useState<EmployeeOpt[]>([]);
    const [attachments, setAttachments] = useState<AttachedFile[]>([]);
    const [wpsList, setWpsList] = useState<Wps[]>([]);
    const [deliveries, setDeliveries] = useState<Delivery[]>([]);
    const [children, setChildren] = useState<Child[]>([]);
    const [warranties, setWarranties] = useState<WarrantyRecord[]>([]);
    const [modules, setModules] = useState<ModuleRow[]>([]);
    const [activeFile, setActiveFile] = useState<AttachedFile | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [statusMsg, setStatusMsg] = useState<{ type: "error" | "success" | "info"; text: string } | null>(null);
    const [historyKey, setHistoryKey] = useState(0);

    const [closing, setClosing] = useState<Stage | null>(null);
    const [pausing, setPausing] = useState<Stage | null>(null);
    const [editing, setEditing] = useState(false);
    const [warrantyOpen, setWarrantyOpen] = useState(false);
    const [operatorPickerOpen, setOperatorPickerOpen] = useState(false);
    const [newNote, setNewNote] = useState("");

    const flash = (type: "error" | "success" | "info", text: string) => {
        setStatusMsg({ type, text });
        if (type !== "error") setTimeout(() => setStatusMsg(null), 5000);
    };

    const load = useCallback(async () => {
        try {
            const { data: order, error } = await supabase.from("work_orders").select(`
                id, order_number, status, work_title, priority, client_name, client_rfc, created_at, created_by_name, quotation_id,
                quantity, unit, order_kind, parent_work_order_id, warranty_count, cancel_reason, qc_reject_reason, operator_name,
                quotation:quotations(quotation_number, title, client:clients(name, business_name))
            `).eq("id", woId).single();
            if (error) throw error;
            const quotation = one(order.quotation as any) as WO["quotation"];
            const formatted = { ...order, quantity: Number(order.quantity), quotation: quotation ? { ...quotation, client: one(quotation.client as any) } : null } as WO;
            setWo(formatted);

            const [st, cl, ph, ps, nt, ops, files, wps, dv, ch, mods] = await Promise.all([
                supabase.from("v_work_order_stage_progress").select("*").eq("work_order_id", woId).order("sequence"),
                supabase.from("work_order_closures").select("*").eq("work_order_id", woId).order("closed_at"),
                supabase.from("work_order_completion_photos").select("*").eq("work_order_id", woId).order("captured_at"),
                supabase.from("work_order_pauses").select("*").eq("work_order_id", woId).order("paused_at", { ascending: false }),
                supabase.from("work_order_notes").select("id, note, created_by_name, created_at").eq("work_order_id", woId).order("created_at", { ascending: false }),
                // work_order_operators tiene dos FK a employees: se combinan a mano.
                supabase.from("work_order_operators").select("id, employee_id, role, added_at").eq("work_order_id", woId).order("added_at"),
                supabase.from("work_order_files").select("*").eq("work_order_id", woId).order("created_at", { ascending: false }),
                supabase.from("work_order_wps").select("wps:wps_procedures(*)").eq("work_order_id", woId),
                supabase.from("deliveries").select("id, delivery_number, quantity, stage, created_at, delivered_at, warranty_cycle").eq("work_order_id", woId).order("created_at"),
                supabase.from("work_orders").select("id, order_number, order_kind, status, quantity").eq("parent_work_order_id", woId).order("created_at"),
                supabase.from("manufacturing_modules").select("id, code, name, icon").eq("is_active", true).order("sort_order"),
            ]);
            setStages((st.data || []).map((s: any) => ({ ...s, qty_target: Number(s.qty_target), qty_done: Number(s.qty_done), qty_available: Number(s.qty_available) })));
            setClosures((cl.data || []).map((c: any) => ({ ...c, quantity: Number(c.quantity) })));
            setPhotos(ph.data || []);
            setPauses(ps.data || []);
            setNotes(nt.data || []);
            setAttachments(files.data || []);
            setWpsList((wps.data || []).map((w: any) => one(w.wps)).filter(Boolean) as Wps[]);
            setDeliveries(dv.data || []);
            setChildren(ch.data || []);
            setModules(mods.data || []);
            const employeeIds = Array.from(new Set((ops.data || []).map((o: any) => o.employee_id)));
            const { data: emps } = await supabase.from("employees").select("id, full_name, username, role, position, photo_url").eq("is_active", true).order("full_name");
            setEmployees(emps || []);
            const byId = new Map((emps || []).map((e) => [e.id, e]));
            setOperators((ops.data || []).map((o: any) => ({ ...o, employee: byId.get(o.employee_id) || null })));
            if (employeeIds.some((idValue) => !byId.has(idValue as string))) {
                const { data: inactive } = await supabase.from("employees").select("id, full_name, username, role, position, photo_url").in("id", employeeIds);
                const all = new Map((inactive || []).map((e) => [e.id, e]));
                setOperators((ops.data || []).map((o: any) => ({ ...o, employee: all.get(o.employee_id) || null })));
            }
            if (formatted.parent_work_order_id) {
                const { data: parent } = await supabase.from("work_orders").select("order_number").eq("id", formatted.parent_work_order_id).single();
                setParentNumber(parent?.order_number || null);
            }
            try { setWarranties(await listWarrantyRecordsAction(woId)); } catch { setWarranties([]); }
        } catch (e) {
            flash("error", e instanceof Error ? e.message : "No se pudo cargar la OT.");
        } finally {
            setLoading(false);
            setHistoryKey((k) => k + 1);
        }
    }, [woId]);
    useEffect(() => { load(); }, [load]);
    // Desde «Garantías y reparaciones» se llega con ?garantia=1.
    useEffect(() => {
        if (searchParams?.get("garantia") === "1" && permissions.canWarranty) setWarrantyOpen(true);
    }, [searchParams, permissions.canWarranty]);

    useEffect(() => {
        if (activeFile || attachments.length === 0) return;
        const viewables = attachments.filter((a) => ["pdf", "step"].includes(fileTypeFromName(a.file_name)));
        const target = viewables.find((a) => a.is_current) || viewables[0];
        if (target) setActiveFile(target);
    }, [attachments, activeFile]);

    const run = async (task: () => Promise<unknown>, success: string) => {
        setBusy(true);
        try {
            await task();
            await load();
            flash("success", success);
            return true;
        } catch (e) {
            flash("error", e instanceof Error ? e.message : "No se pudo completar la acción.");
            return false;
        } finally {
            setBusy(false);
        }
    };

    const permsFor = (code: string) => permissions.byProcess[code] || { view: false, start: false, pause: false, complete: false, edit: false, delete: false, create: false };
    const pendingLots = closures.filter((c) => c.is_final && c.qc_status === "pending");
    const released = closures.filter((c) => c.is_final).reduce((sum, c) => sum + Number(c.qc_released_qty || 0), 0);
    const pendingQc = pendingLots.reduce((sum, c) => sum + c.quantity, 0);
    const currentCycleDeliveries = deliveries.filter((d) => d.warranty_cycle === (wo?.warranty_count || 0));
    const delivered = currentCycleDeliveries.filter((d) => d.stage === "delivered").reduce((sum, d) => sum + Number(d.quantity ?? wo?.quantity ?? 0), 0);
    const inDelivery = currentCycleDeliveries.filter((d) => d.stage !== "delivered").reduce((sum, d) => sum + Number(d.quantity ?? wo?.quantity ?? 0), 0);
    const deliverable = Math.max(released - delivered - inDelivery, 0);
    const active = wo?.status !== "Cancelled";
    const hasWelding = stages.some((s) => s.module_code === "soldadura");

    const handleAddOperator = (employeeId: string) => run(async () => {
        const { error } = await supabase.from("work_order_operators").insert({ work_order_id: woId, employee_id: employeeId, role: "operator", added_by: me.id });
        if (error && error.code !== "23505") throw error;
        setOperatorPickerOpen(false);
    }, "Operador asignado.");
    const handleRemoveOperator = (assignmentId: string) => {
        if (!confirm("¿Quitar a este operador de la OT?")) return;
        run(async () => {
            const { error } = await supabase.from("work_order_operators").delete().eq("id", assignmentId);
            if (error) throw error;
        }, "Operador removido.");
    };
    const handleAddNote = () => {
        const trimmed = newNote.trim();
        if (!trimmed) return;
        run(async () => {
            const { error } = await supabase.from("work_order_notes").insert({ work_order_id: woId, note: trimmed, created_by: me.id, created_by_name: me.fullName });
            if (error) throw error;
            setNewNote("");
        }, "Nota agregada al historial.");
    };
    const handleCancel = () => {
        const reason = prompt("Motivo de la cancelación (queda en el historial):");
        if (!reason?.trim()) return;
        run(() => cancelWorkOrderAction(woId, reason), "OT cancelada.");
    };

    if (loading) {
        return <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center"><RefreshCw className="w-8 h-8 animate-spin text-orange-400" /></div>;
    }
    if (!wo) {
        return <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 flex items-center justify-center"><p>OT no encontrada.</p></div>;
    }

    const clientLabel = wo.quotation?.client ? [wo.quotation.client.name, wo.quotation.client.business_name].filter(Boolean).join(" · ") : wo.client_name || "—";

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 font-[family-name:var(--font-sans)]">
            <div className="p-4 md:p-6 max-w-[1800px] mx-auto">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-neutral-800/40 p-5 rounded-2xl border border-neutral-700/50 mb-5">
                    <div className="flex items-center gap-3 min-w-0">
                        <Link href="/manufacturing" className="p-2.5 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors text-neutral-400 hover:text-white border border-neutral-700 flex-shrink-0">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <h1 className="text-2xl font-bold text-white">{wo.order_number}</h1>
                                <span className={cn("text-xs font-semibold px-2.5 py-1 rounded-full border", STATUS_STYLE[wo.status])}>{STATUS_LABEL[wo.status] || wo.status}</span>
                                {wo.order_kind !== "normal" && <span className="text-xs font-semibold px-2.5 py-1 rounded-full border border-amber-500/40 text-amber-300">{KIND_LABEL[wo.order_kind]}</span>}
                                {wo.warranty_count > 0 && <span className="text-xs font-semibold px-2.5 py-1 rounded-full border border-amber-500/40 text-amber-300">Garantía #{wo.warranty_count} (flujo anterior)</span>}
                            </div>
                            {wo.work_title && <p className="text-sm text-neutral-200 mt-0.5 truncate">{wo.work_title}</p>}
                            <p className="text-xs text-neutral-500 mt-0.5">
                                {clientLabel}
                                {wo.quotation?.quotation_number ? ` · Cot. ${wo.quotation.quotation_number}${wo.quotation.title ? ` — ${wo.quotation.title}` : ""}` : ""}
                                {` · ${qty(wo.quantity)} ${wo.unit} · Prioridad ${wo.priority || "Normal"}`}
                                {wo.created_by_name ? ` · Creada por ${wo.created_by_name}` : ""}
                            </p>
                            {wo.parent_work_order_id && (
                                <Link href={`/manufacturing/ot/${wo.parent_work_order_id}`} className="text-xs text-amber-300 hover:text-amber-200 underline">
                                    {KIND_LABEL[wo.order_kind]} de {parentNumber || "la OT original"}
                                </Link>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                        {permissions.canEditOrder && active && (
                            <button onClick={() => setEditing(true)} className="text-sm text-sky-300 hover:text-white bg-sky-500/10 hover:bg-sky-500/20 px-3 py-2 rounded-lg border border-sky-500/30 flex items-center gap-1.5">
                                <Edit2 className="w-4 h-4" /> Editar
                            </button>
                        )}
                        <button onClick={load} className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg" title="Actualizar">
                            <RefreshCw className={cn("w-4 h-4 text-orange-400", busy && "animate-spin")} />
                        </button>
                    </div>
                </header>

                {wo.quotation_id && permissions.canViewSales && <QuotationWorkflowPanel key={`${wo.quotation_id}-${wo.status}`} quotationId={wo.quotation_id} />}
                {statusMsg && (
                    <div role={statusMsg.type === "error" ? "alert" : "status"} className={cn("p-3 rounded-xl border flex items-center gap-3 mb-4",
                        statusMsg.type === "error" ? "bg-red-500/10 border-red-500/30 text-red-300" :
                        statusMsg.type === "success" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" : "bg-sky-500/10 border-sky-500/30 text-sky-300")}>
                        {statusMsg.type === "error" ? <AlertCircle className="w-5 h-5" /> : statusMsg.type === "success" ? <CheckCircle2 className="w-5 h-5" /> : <ArrowRight className="w-5 h-5" />}
                        <span className="flex-1">{statusMsg.text}</span>
                        <button onClick={() => setStatusMsg(null)} className="p-1 opacity-70 hover:opacity-100"><X className="w-4 h-4" /></button>
                    </div>
                )}
                {wo.status === "Cancelled" && (
                    <div className="mb-4 p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-200 text-sm">OT cancelada{wo.cancel_reason ? `: ${wo.cancel_reason}` : "."}</div>
                )}

                <div className="grid grid-cols-1 xl:grid-cols-[1fr_600px] gap-5">
                    <div className="space-y-5 min-w-0">
                        {/* Avance general */}
                        <section className="bg-neutral-800/40 p-5 rounded-2xl border border-neutral-700/50 space-y-3">
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                <Metric label="Piezas de la OT" value={`${qty(wo.quantity)} ${wo.unit}`} />
                                <Metric label="En Calidad" value={qty(pendingQc)} tone={pendingQc > 0 ? "yellow" : undefined} />
                                <Metric label="Liberadas" value={`${qty(released)} / ${qty(wo.quantity)}`} tone="emerald" />
                                <Metric label="Entregadas" value={`${qty(delivered)}${inDelivery > 0 ? ` (+${qty(inDelivery)} en nota)` : ""}`} tone="sky" />
                            </div>
                            <ProgressBar value={released} total={wo.quantity} />
                            {wo.qc_reject_reason && wo.status !== "QC_Released" && closures.some((c) => Number(c.qc_rejected_qty) > 0) && (
                                <p className="text-xs text-red-300">Último rechazo de Calidad: {wo.qc_reject_reason}</p>
                            )}
                        </section>

                        {/* Etapas */}
                        <section className="space-y-3">
                            <h2 className="text-xs text-neutral-400 uppercase tracking-wider flex items-center gap-1.5"><ListChecks className="w-3.5 h-3.5" /> Etapas del proceso</h2>
                            {stages.length === 0 && <p className="text-sm text-neutral-500">Esta OT no tiene etapas. {permissions.canEditOrder ? "Agrégalas con Editar." : ""}</p>}
                            {stages.map((stage, index) => (
                                <StageCard
                                    key={stage.stage_id}
                                    stage={stage}
                                    previous={stages[index - 1] || null}
                                    unit={wo.unit}
                                    perms={permsFor(stage.module_code)}
                                    disabled={!active || busy}
                                    pause={pauses.find((p) => p.stage_id === stage.stage_id && !p.resumed_at) || null}
                                    onStart={() => run(() => startStageAction(stage.stage_id), `${stage.module_name} iniciada.`)}
                                    onPause={() => setPausing(stage)}
                                    onResume={() => run(() => resumeStageAction(stage.stage_id), `${stage.module_name} reanudada.`)}
                                    onClose={() => setClosing(stage)}
                                />
                            ))}
                        </section>

                        {/* Calidad: lotes pendientes */}
                        {pendingLots.length > 0 && (
                            <section className="bg-sky-500/5 border border-sky-500/30 p-5 rounded-2xl space-y-4">
                                <h3 className="text-base font-bold text-sky-200 flex items-center gap-2"><ShieldCheck className="w-5 h-5" /> Calidad: {pendingLots.length} lote{pendingLots.length === 1 ? "" : "s"} por revisar</h3>
                                {!permissions.quality.edit && (
                                    <p className="text-sm text-neutral-400 flex items-center gap-2"><Lock className="w-4 h-4" /> Solo personal de Calidad puede liberarlos o rechazarlos.</p>
                                )}
                                {pendingLots.map((lot) => (
                                    <QcLotCard key={lot.id} lot={lot} unit={wo.unit} photos={photos.filter((p) => p.closure_id === lot.id)}
                                        canDecide={permissions.quality.edit && active} busy={busy} inspectorDefault={me.fullName}
                                        onDecide={async (input) => {
                                            await decideClosureAction({ closureId: lot.id, ...input });
                                            await load();
                                            flash("success", input.releasedQty > 0 ? `${qty(input.releasedQty)} ${wo.unit} liberada(s).` : "Lote rechazado y regresado a la última etapa.");
                                        }} />
                                ))}
                            </section>
                        )}

                        {/* Entregas */}
                        {(released > 0 || deliveries.length > 0) && (
                            <section className="bg-emerald-500/5 border border-emerald-500/30 p-5 rounded-2xl space-y-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <h3 className="text-sm font-semibold text-emerald-200 flex items-center gap-2"><PackageCheck className="w-4 h-4" /> Entregas</h3>
                                    {deliverable > 0 && permissions.canCreateDelivery && active && (
                                        <Link href={`/deliveries/new?ot=${wo.id}`} className="text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                                            <Truck className="w-3.5 h-3.5" /> Nota de entrega ({qty(deliverable)} {wo.unit} disponibles)
                                        </Link>
                                    )}
                                </div>
                                {deliveries.length === 0 ? <p className="text-xs text-neutral-400">Todavía no hay notas de entrega.</p> : (
                                    <ul className="space-y-1.5 text-sm">
                                        {deliveries.map((d) => (
                                            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 bg-neutral-900/40 rounded-lg px-3 py-2 border border-neutral-700/40">
                                                <span className="font-mono text-emerald-300">{d.delivery_number}</span>
                                                <span className="text-neutral-300">{d.quantity !== null ? `${qty(d.quantity)} ${wo.unit}` : ""}</span>
                                                <span className={cn("text-xs", d.stage === "delivered" ? "text-emerald-300" : "text-amber-300")}>
                                                    {d.stage === "delivered" ? `Entregada${d.delivered_at ? ` ${new Date(d.delivered_at).toLocaleDateString("es-MX")}` : ""}` : "Lista para embalaje"}
                                                    {d.warranty_cycle !== wo.warranty_count ? " · ciclo anterior" : ""}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </section>
                        )}

                        {/* Garantías y reparaciones */}
                        {(released > 0 || children.length > 0 || warranties.length > 0) && (
                            <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 space-y-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <h3 className="text-sm font-semibold text-amber-200 flex items-center gap-2"><Wrench className="w-4 h-4" /> Garantías y reparaciones</h3>
                                    {permissions.canWarranty && released > 0 && active && wo.order_kind === "normal" && (
                                        <button onClick={() => setWarrantyOpen(true)} className="text-xs font-semibold border border-amber-500/40 text-amber-200 hover:bg-amber-500/10 px-3 py-1.5 rounded-lg">
                                            Abrir garantía o reparación
                                        </button>
                                    )}
                                </div>
                                {warranties.length === 0 && children.length === 0 && <p className="text-xs text-neutral-400">Sin registros. Si una pieza regresa, ábrela aquí: se crea una OT ligada con su propio seguimiento.</p>}
                                <ul className="space-y-2">
                                    {warranties.map((w) => (
                                        <li key={w.id} className="text-sm text-neutral-200 border-t border-neutral-700/50 pt-2 first:border-0 first:pt-0">
                                            <p>
                                                <span className="font-semibold text-amber-200">{w.kind === "garantia" ? "Garantía" : "Reparación"}</span>
                                                {w.child ? <> · <Link className="underline text-amber-300" href={`/manufacturing/ot/${w.child.id}`}>{w.child.orderNumber}</Link> <span className="text-xs text-neutral-400">({STATUS_LABEL[w.child.status] || w.child.status})</span></> : " · reabierta en la misma OT (flujo anterior)"}
                                                {w.quantity !== null && <span className="text-xs text-neutral-400"> · {qty(w.quantity)} {wo.unit}</span>}
                                            </p>
                                            <p className="text-neutral-300">{w.reason}</p>
                                            <p className="text-xs text-neutral-500">{w.openedBy} · {new Date(w.openedAt).toLocaleString("es-MX")}</p>
                                            {w.legacy?.previousReleasedAt && <p className="text-xs text-neutral-500">Liberación anterior: {w.legacy.previousReleasedBy || "Calidad"} · {new Date(w.legacy.previousReleasedAt).toLocaleString("es-MX")}</p>}
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}

                        {/* Cierres registrados */}
                        {closures.length > 0 && <ClosureHistory closures={closures} stages={stages} photos={photos} unit={wo.unit} />}

                        {/* Operadores */}
                        {active && (
                            <section className="bg-neutral-800/40 p-4 rounded-2xl border border-neutral-700/50">
                                <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                                    <h3 className="text-xs text-neutral-400 uppercase tracking-wider flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Operadores asignados <span className="text-neutral-600 normal-case">({operators.length})</span></h3>
                                    <button onClick={() => setOperatorPickerOpen(!operatorPickerOpen)} className="text-xs text-cyan-300 hover:text-white bg-cyan-500/10 hover:bg-cyan-500/20 px-2.5 py-1 rounded-lg border border-cyan-500/20 inline-flex items-center gap-1.5">
                                        <UserPlus className="w-3 h-3" /> {operatorPickerOpen ? "Cerrar" : "Asignar"}
                                    </button>
                                </div>
                                {operators.length === 0 ? <p className="text-xs text-neutral-500">Sin operadores asignados.</p> : (
                                    <div className="flex flex-wrap gap-2">
                                        {operators.map((op) => (
                                            <div key={op.id} className="inline-flex items-center gap-2 bg-cyan-500/10 border border-cyan-500/30 rounded-full pl-2 pr-2 py-1">
                                                <div className="text-xs leading-tight">
                                                    <p className="text-white font-semibold">{op.employee?.full_name || "—"}</p>
                                                    <p className="text-cyan-300/70 text-[10px]">{op.employee?.position || op.employee?.role || ""}</p>
                                                </div>
                                                <button onClick={() => handleRemoveOperator(op.id)} disabled={busy} className="ml-1 p-0.5 text-cyan-300 hover:text-rose-300 disabled:opacity-30" title="Quitar"><X className="w-3.5 h-3.5" /></button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {operatorPickerOpen && (
                                    <div className="mt-3 border-t border-neutral-700/50 pt-3 max-h-56 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                        {employees.map((emp) => {
                                            const assigned = operators.some((o) => o.employee_id === emp.id);
                                            return (
                                                <button key={emp.id} onClick={() => handleAddOperator(emp.id)} disabled={busy || assigned}
                                                    className={cn("text-left px-2.5 py-1.5 rounded-lg border text-xs flex items-center gap-2",
                                                        assigned ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200 cursor-not-allowed" : "bg-neutral-900/50 border-neutral-700/50 hover:border-cyan-500/40 text-neutral-200")}>
                                                    <div className="flex-1 min-w-0"><p className="font-semibold truncate">{emp.full_name}</p><p className="text-[10px] text-neutral-500 truncate">{emp.position || emp.role}</p></div>
                                                    {assigned && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </section>
                        )}

                        {/* WPS */}
                        {hasWelding && (
                            <section className="bg-amber-500/5 border border-amber-500/30 rounded-2xl p-5 space-y-3">
                                <h3 className="text-sm font-bold text-amber-200 uppercase tracking-wider flex items-center gap-2"><Flame className="w-4 h-4" /> WPS asignado</h3>
                                {wpsList.length === 0 ? <p className="text-xs text-amber-300/80">Esta OT no tiene WPS asignados.</p> : wpsList.map((w) => (
                                    <div key={w.id} className="bg-neutral-900/50 rounded-xl p-3 border border-neutral-700/50">
                                        <div className="flex items-center gap-2"><span className="font-mono text-amber-300 text-xs">{w.code}</span><span className="text-sm text-white font-medium">{w.name}</span></div>
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
                            </section>
                        )}

                        {/* Notas */}
                        <section className="bg-neutral-800/40 p-5 rounded-2xl border border-neutral-700/50">
                            <h3 className="text-xs text-neutral-400 uppercase tracking-wider mb-3 flex items-center gap-1.5"><History className="w-3.5 h-3.5" /> Historial de notas <span className="text-neutral-600 normal-case">({notes.length})</span></h3>
                            {notes.length === 0 ? <p className="text-xs text-neutral-500 italic">Aún no hay notas.</p> : (
                                <ul className="space-y-2.5 mb-4">
                                    {notes.map((n) => (
                                        <li key={n.id} className="bg-neutral-900/40 border border-neutral-800/60 rounded-lg p-3">
                                            <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
                                                <p className="text-[10px] uppercase tracking-wider text-neutral-400">{n.created_by_name || "Anónimo"}</p>
                                                <p className="text-[10px] text-neutral-500 font-mono">{new Date(n.created_at).toLocaleString("es-MX")}</p>
                                            </div>
                                            <p className="text-sm text-neutral-200 whitespace-pre-wrap">{n.note}</p>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {active && (
                                <div className="border-t border-neutral-700/50 pt-3 space-y-2">
                                    <textarea value={newNote} onChange={(e) => setNewNote(e.target.value)} rows={3}
                                        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleAddNote(); } }}
                                        placeholder="Escribe una nota o actualización. No se borrará lo anterior."
                                        className="w-full bg-neutral-900/60 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-500" />
                                    <div className="flex justify-between items-center">
                                        <p className="text-[10px] text-neutral-500">Ctrl+Enter para enviar · Se atribuye a {me.fullName}</p>
                                        <button onClick={handleAddNote} disabled={busy || !newNote.trim()} className="text-xs text-white bg-cyan-500 hover:bg-cyan-600 px-3 py-1.5 rounded-lg font-semibold disabled:opacity-40 inline-flex items-center gap-1.5">
                                            <MessageSquarePlus className="w-3.5 h-3.5" /> Agregar
                                        </button>
                                    </div>
                                </div>
                            )}
                        </section>

                        {/* Pausas */}
                        {pauses.length > 0 && (
                            <section className="bg-neutral-800/40 p-5 rounded-2xl border border-neutral-700/50">
                                <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-3"><Pause className="w-4 h-4 text-amber-400" /> Historial de pausas</h3>
                                <ul className="space-y-2 text-xs">
                                    {pauses.map((p) => (
                                        <li key={p.id} className="bg-neutral-900/40 p-2.5 rounded-lg border border-neutral-700/30">
                                            <p className="text-amber-200">{stages.find((s) => s.stage_id === p.stage_id)?.module_name || "Etapa"} · {p.reason}{p.custom_reason ? ` (${p.custom_reason})` : ""}</p>
                                            <p className="text-neutral-500">{new Date(p.paused_at).toLocaleString("es-MX")}{p.paused_by ? ` · ${p.paused_by}` : ""}{p.resumed_at ? ` → ${new Date(p.resumed_at).toLocaleString("es-MX")}` : " · (abierta)"}</p>
                                            {p.notes && <p className="text-neutral-400 mt-0.5">{p.notes}</p>}
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}

                        <EditHistory rootTable="work_orders" rootId={wo.id} title="Historial de cambios de la OT" refreshKey={historyKey} />

                        {active && permissions.canCancelOrder && wo.status !== "QC_Released" && (
                            <div className="flex justify-end">
                                <button onClick={handleCancel} className="text-xs text-neutral-500 hover:text-red-400">Cancelar OT</button>
                            </div>
                        )}
                    </div>

                    {/* Archivos y visor */}
                    <aside className="space-y-3 min-w-0">
                        <div className="bg-neutral-800/40 p-4 rounded-2xl border border-neutral-700/50 space-y-3 min-w-0">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-semibold text-white flex items-center gap-2"><Paperclip className="w-4 h-4 text-orange-400" /> Archivos</h3>
                                <span className="text-xs text-neutral-500">{attachments.length} adjunto{attachments.length === 1 ? "" : "s"}</span>
                            </div>
                            <AttachmentUploader workOrderId={wo.id} attachments={attachments} onChange={load} />
                        </div>
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
                            <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-6 text-center text-neutral-500 text-sm"><Box className="w-8 h-8 mx-auto mb-2 opacity-50" />Selecciona un PDF o STEP para previsualizar.</div>
                        ) : null}
                        {attachments.length > 0 && (
                            <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-3">
                                <p className="text-xs uppercase tracking-wider text-neutral-400 mb-2 px-1 flex items-center gap-1.5"><Sparkles className="w-3 h-3" /> Archivos</p>
                                <ul className="space-y-1 max-h-44 overflow-y-auto">
                                    {attachments.map((a) => {
                                        const type = fileTypeFromName(a.file_name);
                                        return (
                                            <li key={a.id || a.file_url}>
                                                <button onClick={() => setActiveFile(a)} className={cn("w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm",
                                                    activeFile?.id === a.id ? "bg-orange-500/10 text-orange-200" : "text-neutral-300 hover:bg-neutral-700/50")}>
                                                    {type === "pdf" && <FileText className="w-4 h-4 text-rose-400" />}
                                                    {type === "step" && <Box className="w-4 h-4 text-cyan-400" />}
                                                    {type === "image" && <ImageIcon className="w-4 h-4 text-emerald-400" />}
                                                    {type === "other" && <FileQuestion className="w-4 h-4 text-neutral-400" />}
                                                    <span className="truncate flex-1">{a.file_name}</span>
                                                    {a.is_current && a.file_kind && a.file_kind !== "other" && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">Actual</span>}
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

            {closing && (
                <CloseStageModal
                    stage={closing}
                    unit={wo.unit}
                    workOrder={wo}
                    defaultOperator={me.fullName}
                    photos={photos.filter((p) => p.stage_id === closing.stage_id && !p.closure_id)}
                    onPhotosChanged={load}
                    onClose={() => setClosing(null)}
                    onSubmit={async (input) => {
                        await closeStageAction({ stageId: closing.stage_id, ...input });
                        const message = closing.is_final ? `${qty(input.quantity)} ${wo.unit} enviada(s) a Calidad.` : `${qty(input.quantity)} ${wo.unit} cerrada(s) en ${closing.module_name}; ya puede trabajarlas la siguiente etapa.`;
                        setClosing(null);
                        await load();
                        flash("success", message);
                    }}
                />
            )}
            {pausing && (
                <PauseModal stage={pausing} busy={busy} onCancel={() => setPausing(null)}
                    onSubmit={async (reason, custom, notesText) => {
                        await pauseStageAction(pausing.stage_id, reason, custom, notesText);
                        const name = pausing.module_name;
                        setPausing(null);
                        await load();
                        flash("info", `${name} pausada.`);
                    }} />
            )}
            {editing && (
                <EditOrderModal wo={wo} stages={stages} modules={modules} hasWps={wpsList.length > 0} busy={busy}
                    onCancel={() => setEditing(false)}
                    onSubmit={async (input) => {
                        await updateWorkOrderAction({ workOrderId: wo.id, ...input });
                        setEditing(false);
                        await load();
                        flash("success", "Cambios guardados. Quedaron en el historial de la OT.");
                    }} />
            )}
            {warrantyOpen && (
                <WarrantyModal wo={wo} stages={stages} modules={modules} released={released} busy={busy}
                    onCancel={() => setWarrantyOpen(false)}
                    onSubmit={async (input) => {
                        const { id } = await openWarrantyAction({ parentId: wo.id, ...input });
                        setWarrantyOpen(false);
                        router.push(`/manufacturing/ot/${id}`);
                    }} />
            )}
        </div>
    );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "yellow" | "emerald" | "sky" }) {
    const color = tone === "yellow" ? "text-yellow-300" : tone === "emerald" ? "text-emerald-300" : tone === "sky" ? "text-sky-300" : "text-white";
    return (
        <div className="bg-neutral-900/50 rounded-xl border border-neutral-700/40 p-3">
            <p className={cn("text-lg font-bold tabular-nums", color)}>{value}</p>
            <p className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</p>
        </div>
    );
}

function StageCard({ stage, previous, unit, perms, disabled, pause, onStart, onPause, onResume, onClose }: {
    stage: Stage; previous: Stage | null; unit: string; perms: ProcessPermissions; disabled: boolean; pause: PauseRow | null;
    onStart: () => void; onPause: () => void; onResume: () => void; onClose: () => void;
}) {
    const color = processColor(stage.module_code);
    const waiting = previous && stage.qty_available === 0 && stage.status !== "Done";
    return (
        <div className={cn("rounded-2xl border p-4 bg-neutral-800/40", stage.status === "Done" ? "border-emerald-500/30" : "border-neutral-700/50")}>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    <div className={cn("w-10 h-10 rounded-xl border flex items-center justify-center", color.pill)}><ProcessIcon icon={stage.module_icon} className="w-5 h-5" /></div>
                    <div>
                        <p className="text-white font-semibold">{stage.sequence}. {stage.module_name} {stage.is_final && <span className="text-[10px] font-normal text-sky-300 ml-1">(última: va a Calidad)</span>}</p>
                        <p className="text-xs text-neutral-400">
                            {STAGE_STATUS_LABEL[stage.status] || stage.status} · {qty(stage.qty_done)} de {qty(stage.qty_target)} {unit} cerradas
                            {stage.status !== "Done" && ` · ${qty(stage.qty_available)} disponibles para cerrar`}
                        </p>
                        {stage.started_at && <p className="text-[11px] text-neutral-500">Inicio {new Date(stage.started_at).toLocaleString("es-MX")}{stage.completed_at ? ` · Terminada ${new Date(stage.completed_at).toLocaleString("es-MX")}` : ""}</p>}
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    {stage.status === "Pending" && (
                        <ActionButton enabled={perms.start} disabled={disabled} onClick={onStart} icon={Play} tone="orange">Iniciar</ActionButton>
                    )}
                    {stage.status === "In Progress" && (
                        <ActionButton enabled={perms.pause} disabled={disabled} onClick={onPause} icon={Pause} tone="amber">Pausar</ActionButton>
                    )}
                    {stage.status === "Paused" && (
                        <ActionButton enabled={perms.start} disabled={disabled} onClick={onResume} icon={Play} tone="emerald">Reanudar</ActionButton>
                    )}
                    {stage.status !== "Done" && (
                        <ActionButton enabled={perms.complete} disabled={disabled || stage.qty_available <= 0} onClick={onClose} icon={CheckCircle2} tone="sky">
                            {stage.is_final ? "Cerrar piezas → Calidad" : "Cerrar piezas"}
                        </ActionButton>
                    )}
                </div>
            </div>
            <div className="mt-3"><ProgressBar value={stage.qty_done} total={stage.qty_target} className={color.bar} /></div>
            {pause && <p className="mt-2 text-xs text-amber-200">Pausada: {pause.reason}{pause.custom_reason ? ` (${pause.custom_reason})` : ""} · {new Date(pause.paused_at).toLocaleString("es-MX")}{pause.notes ? ` · ${pause.notes}` : ""}</p>}
            {waiting && <p className="mt-2 text-xs text-neutral-500">Esperando piezas de {previous!.module_name}. Puedes iniciar para preparar, pero solo se cierran las que ya cerró la etapa anterior.</p>}
            {!perms.complete && !perms.start && stage.status !== "Done" && <p className="mt-2 text-[11px] text-neutral-500 flex items-center gap-1"><Lock className="w-3 h-3" /> No tienes asignado el proceso {stage.module_name}.</p>}
        </div>
    );
}

function ActionButton({ enabled, disabled, onClick, icon: Icon, tone, children }: {
    enabled: boolean; disabled: boolean; onClick: () => void; icon: React.ComponentType<{ className?: string }>; tone: "orange" | "amber" | "emerald" | "sky"; children: React.ReactNode;
}) {
    const tones = { orange: "bg-orange-500 hover:bg-orange-600", amber: "bg-amber-500 hover:bg-amber-600", emerald: "bg-emerald-500 hover:bg-emerald-600", sky: "bg-sky-500 hover:bg-sky-600" };
    if (!enabled) return null;
    return (
        <button onClick={onClick} disabled={disabled} className={cn("text-sm text-white px-3 py-2 rounded-lg font-semibold flex items-center gap-1.5 disabled:opacity-40", tones[tone])}>
            <Icon className="w-4 h-4" /> {children}
        </button>
    );
}

function CloseStageModal({ stage, unit, workOrder, defaultOperator, photos, onPhotosChanged, onClose, onSubmit }: {
    stage: Stage; unit: string; workOrder: WO; defaultOperator: string; photos: Photo[];
    onPhotosChanged: () => void; onClose: () => void;
    onSubmit: (input: { quantity: number; operatorName: string; signatureUrl: string; notes: string }) => Promise<void>;
}) {
    const [quantity, setQuantity] = useState(String(stage.qty_available));
    const [operatorName, setOperatorName] = useState(defaultOperator);
    const [notes, setNotes] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const value = Number(quantity);
    const valid = Number.isFinite(value) && value > 0 && value <= stage.qty_available;
    const partial = valid && value < stage.qty_available;

    const addPhoto = async (file: File, geo: { lat: number; lng: number; source: string } | null) => {
        try {
            const path = `completion/${workOrder.id}/${Date.now()}_${safeStorageName(file.name)}`;
            const url = await uploadFileToBucket(file, "work_order_files", path);
            const { error: insertError } = await supabase.from("work_order_completion_photos").insert({
                work_order_id: workOrder.id, stage_id: stage.stage_id, photo_url: url, label: `${stage.module_name} terminado`,
                lat: geo?.lat ?? null, lng: geo?.lng ?? null, location_source: geo?.source ?? null, captured_by: operatorName || null,
            });
            if (insertError) throw insertError;
            onPhotosChanged();
        } catch (e) {
            setError(e instanceof Error ? e.message : "No se pudo subir la foto.");
        }
    };
    const removePhoto = async (id: string) => {
        await supabase.from("work_order_completion_photos").delete().eq("id", id);
        onPhotosChanged();
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-neutral-900 border border-neutral-700 rounded-2xl p-6 max-w-2xl w-full max-h-[92vh] overflow-y-auto space-y-4" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-lg font-bold text-white flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-emerald-400" /> Cerrar piezas en {stage.module_name}</h3>
                <p className="text-sm text-neutral-400">
                    Hay {qty(stage.qty_available)} {unit} disponibles en esta etapa. Si cierras menos, la etapa sigue abierta para el resto
                    {stage.is_final ? " y las piezas cerradas pasan a Calidad como un lote." : " y las piezas cerradas pasan a la siguiente etapa."}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="text-sm text-neutral-300">Piezas que cierras ahora
                        <input type="number" min="0.01" step="any" max={stage.qty_available} value={quantity} onChange={(e) => setQuantity(e.target.value)}
                            className="mt-1 w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2.5 text-white text-lg font-semibold" />
                    </label>
                    <label className="text-sm text-neutral-300">Nombre de quien firma
                        <input value={operatorName} onChange={(e) => setOperatorName(e.target.value)} className="mt-1 w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2.5 text-white" />
                    </label>
                </div>
                {partial && <p className="text-xs text-amber-300">Cierre parcial: quedarán {qty(stage.qty_available - value)} {unit} pendientes en {stage.module_name}.</p>}
                {!valid && quantity !== "" && <p className="text-xs text-red-300">La cantidad debe ser mayor a cero y no más de {qty(stage.qty_available)}.</p>}
                <label className="block text-sm text-neutral-300">Notas (opcional)
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mt-1 w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm" placeholder="Ej. se mandan 2 al cliente hoy" />
                </label>
                <div>
                    <p className="text-xs uppercase tracking-wider text-neutral-400 mb-2">Fotos del trabajo (opcional)</p>
                    {photos.length > 0 && (
                        <div className="grid grid-cols-3 gap-2 mb-2">
                            {photos.map((p) => (
                                <div key={p.id} className="relative group">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={p.photo_url} alt="" className="rounded-lg w-full h-24 object-cover border border-neutral-700/50" />
                                    {p.lat && p.lng && <div className="absolute bottom-1 left-1 right-1 bg-black/60 text-[10px] text-emerald-300 px-1.5 py-0.5 rounded flex items-center gap-1"><MapPin className="w-2.5 h-2.5" /> {p.lat.toFixed(4)}, {p.lng.toFixed(4)}</div>}
                                    <button onClick={() => removePhoto(p.id)} className="absolute top-1 right-1 p-1 rounded bg-black/60 text-neutral-300 hover:text-red-300"><Trash2 className="w-3 h-3" /></button>
                                </div>
                            ))}
                        </div>
                    )}
                    <PhotoCapture onCapture={addPhoto} label="Foto del terminado" />
                </div>
                {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
                <div className="border-t border-neutral-700/50 pt-4">
                    <p className="text-xs uppercase tracking-wider text-neutral-400 mb-2">Firma</p>
                    <SignaturePad
                        saving={saving}
                        disabled={!valid || !operatorName.trim()}
                        saveLabel={stage.is_final ? `Firmar y enviar ${valid ? qty(value) : ""} a Calidad` : `Firmar y cerrar ${valid ? qty(value) : ""}`}
                        savingLabel="Guardando…"
                        onSave={async (dataUrl) => {
                            setSaving(true);
                            setError("");
                            try {
                                const signatureUrl = await uploadSignatureDataUrl(dataUrl, `wo_${workOrder.order_number}`);
                                await onSubmit({ quantity: value, operatorName: operatorName.trim(), signatureUrl, notes });
                            } catch (e) {
                                setError(e instanceof Error ? e.message : "No se pudo guardar.");
                            } finally {
                                setSaving(false);
                            }
                        }}
                    />
                </div>
                <div className="flex justify-end"><button onClick={onClose} className="px-4 py-2 rounded-lg text-neutral-300 hover:text-white hover:bg-neutral-800 text-sm">Cancelar</button></div>
            </div>
        </div>
    );
}

function QcLotCard({ lot, unit, photos, canDecide, busy, inspectorDefault, onDecide }: {
    lot: Closure; unit: string; photos: Photo[]; canDecide: boolean; busy: boolean; inspectorDefault: string;
    onDecide: (input: { releasedQty: number; inspectorName: string; signatureUrl: string | null; comments: string }) => Promise<void>;
}) {
    const [releasedQty, setReleasedQty] = useState(String(lot.quantity));
    const [inspector, setInspector] = useState(inspectorDefault);
    const [comments, setComments] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const value = Number(releasedQty);
    const valid = Number.isFinite(value) && value >= 0 && value <= lot.quantity;
    const rejected = valid ? lot.quantity - value : 0;

    const submit = async (signatureUrl: string | null, release: number) => {
        setSaving(true);
        setError("");
        try {
            await onDecide({ releasedQty: release, inspectorName: inspector.trim(), signatureUrl, comments });
        } catch (e) {
            setError(e instanceof Error ? e.message : "No se pudo guardar.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="bg-neutral-900/50 rounded-xl border border-sky-500/20 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-white font-semibold">Lote #{lot.sequence_no}: {qty(lot.quantity)} {unit}</p>
                <p className="text-xs text-neutral-400">Cerrado por {lot.operator_name} · {new Date(lot.closed_at).toLocaleString("es-MX")}</p>
            </div>
            {lot.notes && <p className="text-xs text-neutral-300">Nota: {lot.notes}</p>}
            <div className="flex flex-wrap items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {lot.signature_url && <img src={lot.signature_url} alt="firma del operador" className="h-12 bg-neutral-900/50 rounded-lg p-1 border border-neutral-700" />}
                {photos.map((p) => (
                    <a key={p.id} href={p.photo_url} target="_blank" rel="noopener noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.photo_url} alt="" className="h-16 w-20 object-cover rounded-lg border border-neutral-700/50" />
                    </a>
                ))}
            </div>
            {canDecide && (
                <div className="space-y-3 border-t border-sky-500/20 pt-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className="text-sm text-sky-200">Piezas que se liberan
                            <input type="number" min="0" step="any" max={lot.quantity} value={releasedQty} onChange={(e) => setReleasedQty(e.target.value)}
                                className="mt-1 w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-white font-semibold" />
                        </label>
                        <label className="text-sm text-sky-200">Inspector
                            <input value={inspector} onChange={(e) => setInspector(e.target.value)} className="mt-1 w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-white" />
                        </label>
                    </div>
                    {rejected > 0 && <p className="text-xs text-amber-300">{qty(rejected)} {unit} se rechazan y regresan a la última etapa. Escribe el motivo.</p>}
                    <textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={2} placeholder={rejected > 0 ? "Motivo del rechazo (obligatorio)" : "Comentarios (opcional)"}
                        className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm" />
                    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
                    {value > 0 ? (
                        <SignaturePad color="#38bdf8" saving={saving || busy} savingLabel="Guardando…"
                            disabled={!valid || !inspector.trim() || (rejected > 0 && !comments.trim())}
                            saveLabel={rejected > 0 ? `Firmar: liberar ${qty(value)} y rechazar ${qty(rejected)}` : `Firmar y liberar ${qty(value)}`}
                            onSave={async (dataUrl) => {
                                const signatureUrl = await uploadSignatureDataUrl(dataUrl, `qc_lote_${lot.id.slice(0, 8)}`);
                                await submit(signatureUrl, value);
                            }} />
                    ) : (
                        <button onClick={() => submit(null, 0)} disabled={saving || busy || !comments.trim()}
                            className="text-sm text-red-200 bg-red-500/10 hover:bg-red-500/20 px-4 py-2 rounded-lg border border-red-500/30 flex items-center gap-1.5 disabled:opacity-40">
                            <X className="w-4 h-4" /> Rechazar el lote completo
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

function ClosureHistory({ closures, stages, photos, unit }: { closures: Closure[]; stages: Stage[]; photos: Photo[]; unit: string }) {
    const [open, setOpen] = useState(false);
    const stageName = (id: string) => stages.find((s) => s.stage_id === id)?.module_name || "Etapa";
    const sorted = useMemo(() => [...closures].sort((a, b) => b.closed_at.localeCompare(a.closed_at)), [closures]);
    return (
        <section className="bg-neutral-800/40 p-4 rounded-2xl border border-neutral-700/50">
            <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between text-left">
                <span className="text-sm font-semibold text-white flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400" /> Cierres de piezas ({closures.length})</span>
                {open ? <ChevronUp className="w-4 h-4 text-neutral-400" /> : <ChevronDown className="w-4 h-4 text-neutral-400" />}
            </button>
            {open && (
                <ul className="mt-3 space-y-2">
                    {sorted.map((c) => (
                        <li key={c.id} className="bg-neutral-900/40 border border-neutral-800/60 rounded-lg p-3 text-xs space-y-1">
                            <div className="flex flex-wrap justify-between gap-2">
                                <p className="text-neutral-100 font-semibold">{stageName(c.stage_id)} · {qty(c.quantity)} {unit} {c.is_final && <span className="text-sky-300 font-normal">(lote #{c.sequence_no})</span>}</p>
                                <p className="text-neutral-500">{new Date(c.closed_at).toLocaleString("es-MX")}</p>
                            </div>
                            <p className="text-neutral-400">Firmó {c.operator_name}{c.notes ? ` · ${c.notes}` : ""}</p>
                            {c.is_final && c.qc_status !== "pending" && (
                                <p className={cn(c.qc_status === "released" ? "text-emerald-300" : "text-red-300")}>
                                    Calidad: {qty(c.qc_released_qty || 0)} liberadas{Number(c.qc_rejected_qty) > 0 ? ` · ${qty(c.qc_rejected_qty || 0)} rechazadas` : ""}
                                    {c.qc_decided_by_name ? ` · ${c.qc_decided_by_name}` : ""}{c.qc_decided_at ? ` · ${new Date(c.qc_decided_at).toLocaleString("es-MX")}` : ""}
                                    {c.qc_comments ? ` · ${c.qc_comments}` : ""}
                                </p>
                            )}
                            {c.is_final && c.qc_status === "pending" && <p className="text-yellow-300">En revisión de Calidad</p>}
                            <div className="flex flex-wrap gap-2 pt-1">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                {c.signature_url && <img src={c.signature_url} alt="firma" className="h-10 bg-neutral-900/50 rounded p-0.5 border border-neutral-700" />}
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                {c.qc_signature_url && <img src={c.qc_signature_url} alt="firma de Calidad" className="h-10 bg-neutral-900/50 rounded p-0.5 border border-sky-700" />}
                                {photos.filter((p) => p.closure_id === c.id).map((p) => (
                                    <a key={p.id} href={p.photo_url} target="_blank" rel="noopener noreferrer">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={p.photo_url} alt="" className="h-10 w-14 object-cover rounded border border-neutral-700/50" />
                                    </a>
                                ))}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

function PauseModal({ stage, busy, onCancel, onSubmit }: { stage: Stage; busy: boolean; onCancel: () => void; onSubmit: (reason: string, custom: string, notes: string) => Promise<void> }) {
    const [reason, setReason] = useState(PAUSE_REASONS[0]);
    const [custom, setCustom] = useState("");
    const [notes, setNotes] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const submit = async () => {
        setSaving(true);
        setError("");
        try { await onSubmit(reason, custom, notes); } catch (e) { setError(e instanceof Error ? e.message : "No se pudo pausar."); } finally { setSaving(false); }
    };
    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onCancel}>
            <div className="bg-neutral-900 border border-neutral-700 rounded-2xl p-6 max-w-md w-full space-y-3" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-lg font-bold text-white flex items-center gap-2"><Pause className="w-5 h-5 text-amber-400" /> Pausar {stage.module_name}</h3>
                <select value={reason} onChange={(e) => setReason(e.target.value)} className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2.5 text-white text-sm">
                    {PAUSE_REASONS.map((r) => <option key={r}>{r}</option>)}
                </select>
                {reason === "Otro" && <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Especifica el motivo…" className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2.5 text-white text-sm" />}
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notas adicionales (opcional)…" className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2.5 text-white text-sm min-h-[60px]" />
                {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
                <div className="flex justify-end gap-2">
                    <button onClick={onCancel} className="px-4 py-2 rounded-lg text-neutral-300 hover:text-white hover:bg-neutral-800 text-sm">Cancelar</button>
                    <button onClick={submit} disabled={busy || saving || (reason === "Otro" && !custom.trim())} className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-semibold text-sm flex items-center gap-1.5 disabled:opacity-50">
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pause className="w-4 h-4" />} Pausar
                    </button>
                </div>
            </div>
        </div>
    );
}

function EditOrderModal({ wo, stages, modules, hasWps, busy, onCancel, onSubmit }: {
    wo: WO; stages: Stage[]; modules: ModuleRow[]; hasWps: boolean; busy: boolean; onCancel: () => void;
    onSubmit: (input: { changes: Record<string, string | number>; stageModuleIds: string[] | null; wpsIds: string[] | null; reason: string }) => Promise<void>;
}) {
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [title, setTitle] = useState(wo.work_title || "");
    const [priority, setPriority] = useState(wo.priority || "Normal");
    const [quantity, setQuantity] = useState(String(wo.quantity));
    const [unit, setUnit] = useState(wo.unit);
    const [clientName, setClientName] = useState(wo.client_name || "");
    const [clientRfc, setClientRfc] = useState(wo.client_rfc || "");
    const [stageIds, setStageIds] = useState(stages.map((s) => s.module_id));
    const [reason, setReason] = useState("");
    const [wpsCatalog, setWpsCatalog] = useState<{ id: string; code: string; name: string }[]>([]);
    const [wpsIds, setWpsIds] = useState<string[]>([]);
    const lastActive = stages.reduce((max, s) => (s.started_at || s.status !== "Pending" || s.qty_done > 0 ? Math.max(max, stages.indexOf(s) + 1) : max), 0);
    const weldingId = modules.find((m) => m.code === "soldadura")?.id;
    const needsWps = !!weldingId && stageIds.includes(weldingId) && !hasWps;
    useEffect(() => {
        if (!needsWps) return;
        supabase.from("wps_procedures").select("id, code, name").eq("is_active", true).order("code").then(({ data }) => setWpsCatalog(data || []));
    }, [needsWps]);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        const changes: Record<string, string | number> = {};
        if (title.trim() !== (wo.work_title || "")) changes.work_title = title.trim();
        if (priority !== (wo.priority || "Normal")) changes.priority = priority;
        if (Number(quantity) !== Number(wo.quantity)) changes.quantity = Number(quantity);
        if (unit.trim() !== wo.unit) changes.unit = unit.trim();
        if (!wo.quotation_id && clientName.trim() !== (wo.client_name || "")) changes.client_name = clientName.trim();
        if (!wo.quotation_id && clientRfc.trim().toUpperCase() !== (wo.client_rfc || "")) changes.client_rfc = clientRfc.trim().toUpperCase();
        const stagesChanged = stageIds.join() !== stages.map((s) => s.module_id).join();
        setSaving(true);
        setError("");
        try {
            await onSubmit({ changes, stageModuleIds: stagesChanged ? stageIds : null, wpsIds: needsWps ? wpsIds : null, reason });
        } catch (err) {
            setError(err instanceof Error ? err.message : "No se pudo guardar.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onCancel}>
            <form onSubmit={submit} className="bg-neutral-900 border border-neutral-700 rounded-2xl p-6 max-w-2xl w-full max-h-[92vh] overflow-y-auto space-y-4" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-lg font-bold text-white flex items-center gap-2"><Edit2 className="w-5 h-5 text-sky-400" /> Editar {wo.order_number}</h3>
                <p className="text-xs text-neutral-400">Cada cambio queda en el historial de la OT con tu nombre, la fecha y el valor anterior.</p>
                <label className="block text-sm text-neutral-300">Título<input required value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-white" /></label>
                <div className="grid grid-cols-3 gap-3">
                    <label className="text-sm text-neutral-300">Piezas<input type="number" min="0.01" step="any" required value={quantity} onChange={(e) => setQuantity(e.target.value)} className="mt-1 w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-white" /></label>
                    <label className="text-sm text-neutral-300">Unidad<input value={unit} onChange={(e) => setUnit(e.target.value)} className="mt-1 w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-white" /></label>
                    <label className="text-sm text-neutral-300">Prioridad
                        <select value={priority} onChange={(e) => setPriority(e.target.value)} className="mt-1 w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-white">
                            {["Baja", "Normal", "Alta", "Urgente"].map((p) => <option key={p}>{p}</option>)}
                        </select>
                    </label>
                </div>
                {!wo.quotation_id && (
                    <div className="grid grid-cols-2 gap-3">
                        <label className="text-sm text-neutral-300">Cliente<input required value={clientName} onChange={(e) => setClientName(e.target.value)} className="mt-1 w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-white" /></label>
                        <label className="text-sm text-neutral-300">RFC<input value={clientRfc} maxLength={13} onChange={(e) => setClientRfc(e.target.value)} className="mt-1 w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-white" /></label>
                    </div>
                )}
                <div>
                    <p className="text-sm text-neutral-300 mb-2">Etapas (en orden)</p>
                    <StagePicker modules={modules} value={stageIds} onChange={setStageIds} lockedCount={lastActive} />
                </div>
                {needsWps && (
                    <div className="space-y-2">
                        <p className="text-sm text-amber-200">Soldadura requiere WPS:</p>
                        <div className="flex flex-wrap gap-2">
                            {wpsCatalog.map((w) => (
                                <button type="button" key={w.id} onClick={() => setWpsIds((ids) => ids.includes(w.id) ? ids.filter((x) => x !== w.id) : [...ids, w.id])}
                                    className={cn("text-xs px-3 py-1.5 rounded-lg border", wpsIds.includes(w.id) ? "bg-amber-500/20 border-amber-500/50 text-amber-200" : "border-neutral-600 text-neutral-300")}>
                                    {w.code} · {w.name}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                <label className="block text-sm text-neutral-300">Motivo del cambio (queda en el historial)
                    <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1 w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm" placeholder="Ej. el cliente pidió 2 piezas más" />
                </label>
                {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
                <div className="flex justify-end gap-2">
                    <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-neutral-300 hover:text-white hover:bg-neutral-800 text-sm">Cancelar</button>
                    <button type="submit" disabled={busy || saving || stageIds.length === 0 || (needsWps && wpsIds.length === 0)} className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold text-sm disabled:opacity-40">{saving ? "Guardando…" : "Guardar cambios"}</button>
                </div>
            </form>
        </div>
    );
}

function WarrantyModal({ wo, stages, modules, released, busy, onCancel, onSubmit }: {
    wo: WO; stages: Stage[]; modules: ModuleRow[]; released: number; busy: boolean; onCancel: () => void;
    onSubmit: (input: { kind: "garantia" | "reparacion"; reason: string; quantity: number; stageModuleIds: string[]; priority: string }) => Promise<void>;
}) {
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [kind, setKind] = useState<"garantia" | "reparacion">("garantia");
    const [reason, setReason] = useState("");
    const [quantity, setQuantity] = useState(String(released || wo.quantity));
    const [priority, setPriority] = useState("Alta");
    const [stageIds, setStageIds] = useState(stages.map((s) => s.module_id));
    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onCancel}>
            <form onSubmit={async (e) => {
                e.preventDefault();
                setSaving(true);
                setError("");
                try { await onSubmit({ kind, reason, quantity: Number(quantity), stageModuleIds: stageIds, priority }); }
                catch (err) { setError(err instanceof Error ? err.message : "No se pudo abrir."); }
                finally { setSaving(false); }
            }}
                className="bg-neutral-900 border border-neutral-700 rounded-2xl p-6 max-w-2xl w-full max-h-[92vh] overflow-y-auto space-y-4" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-lg font-bold text-white flex items-center gap-2"><Wrench className="w-5 h-5 text-amber-400" /> Garantía o reparación de {wo.order_number}</h3>
                <p className="text-xs text-neutral-400">Se crea una OT ligada ({wo.order_number}-G1, -R1…) que pasa otra vez por sus etapas, Calidad y entrega. La OT original no cambia y queda el registro.</p>
                <div className="grid grid-cols-2 gap-2">
                    {([["garantia", "Garantía", "Defecto atribuible al trabajo; sin costo para el cliente."], ["reparacion", "Reparación", "Daño o desgaste; puede cotizarse aparte."]] as const).map(([value, label, desc]) => (
                        <button type="button" key={value} onClick={() => setKind(value)} className={cn("text-left rounded-xl border p-3", kind === value ? "border-amber-500/60 bg-amber-500/10" : "border-neutral-700 bg-neutral-800/40")}>
                            <p className="text-sm font-semibold text-white">{label}</p>
                            <p className="text-[11px] text-neutral-400">{desc}</p>
                        </button>
                    ))}
                </div>
                <label className="block text-sm text-neutral-300">Motivo
                    <textarea required maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="mt-1 w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm" placeholder="Qué falló o qué se va a reparar" />
                </label>
                <div className="grid grid-cols-2 gap-3">
                    <label className="text-sm text-neutral-300">Piezas
                        <input type="number" min="0.01" step="any" max={wo.quantity} required value={quantity} onChange={(e) => setQuantity(e.target.value)} className="mt-1 w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-white" />
                    </label>
                    <label className="text-sm text-neutral-300">Prioridad
                        <select value={priority} onChange={(e) => setPriority(e.target.value)} className="mt-1 w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-white">
                            {["Baja", "Normal", "Alta", "Urgente"].map((p) => <option key={p}>{p}</option>)}
                        </select>
                    </label>
                </div>
                <div>
                    <p className="text-sm text-neutral-300 mb-2">Etapas que se repiten</p>
                    <StagePicker modules={modules} value={stageIds} onChange={setStageIds} />
                </div>
                {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
                <div className="flex justify-end gap-2">
                    <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-neutral-300 hover:text-white hover:bg-neutral-800 text-sm">Cancelar</button>
                    <button type="submit" disabled={busy || saving || !reason.trim() || stageIds.length === 0} className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold text-sm disabled:opacity-40">{saving ? "Abriendo…" : `Abrir ${kind === "garantia" ? "garantía" : "reparación"}`}</button>
                </div>
            </form>
        </div>
    );
}

