"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
    ArrowLeft, FileText, RefreshCw, Clock, CheckCircle2, XCircle, ShieldCheck, X,
    AlertCircle, History, User, ChevronRight, Send
} from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";
import {
    reviewByDocumentControllerAction, approveByTopManagementAction,
    publishDocumentRequestAction, cancelDocumentRequestAction, resubmitDocumentRequestAction
} from "@/app/actions/documentRequests";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

type ReqStatus = 'pending_doc_control' | 'rejected_by_doc_control' | 'pending_top_mgmt'
    | 'rejected' | 'approved' | 'published' | 'cancelled';

const STATUS_META: Record<ReqStatus, { label: string; chip: string; icon: any; description: string }> = {
    pending_doc_control:     { label: "Pendiente Controlador", chip: "bg-amber-500/10 text-amber-300 border-amber-500/30",   icon: Clock,        description: "Esperando revisión del Controlador de Documentos." },
    rejected_by_doc_control: { label: "Rechazada por Controlador", chip: "bg-rose-500/10 text-rose-300 border-rose-500/30",  icon: XCircle,      description: "El controlador rechazó la solicitud. Revisa las notas, corrige y reenvía." },
    pending_top_mgmt:        { label: "Pendiente Alta Dirección", chip: "bg-violet-500/10 text-violet-300 border-violet-500/30", icon: ShieldCheck,  description: "Aprobada por el controlador. Esperando firma de Alta Dirección." },
    rejected:                { label: "Rechazada por Alta Dir.", chip: "bg-rose-500/10 text-rose-300 border-rose-500/30",   icon: XCircle,      description: "Alta Dirección rechazó. Puedes corregir según las notas y reenviar." },
    approved:                { label: "Aprobada (por publicar)", chip: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",   icon: CheckCircle2, description: "Aprobada por Alta Dirección. Lista para publicar." },
    published:               { label: "Publicada",               chip: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30", icon: CheckCircle2, description: "Documento publicado." },
    cancelled:               { label: "Cancelada",               chip: "bg-neutral-500/10 text-neutral-400 border-neutral-500/30", icon: X,             description: "Cancelada por el solicitante." },
};

type Request = {
    id: string;
    type: 'new' | 'change';
    title: string;
    change_summary: string | null;
    reason: string;
    payload: any;
    status: ReqStatus;
    requested_by: string;
    requested_at: string;
    doc_control_reviewer: string | null;
    doc_control_reviewed_at: string | null;
    doc_control_notes: string | null;
    top_mgmt_approver: string | null;
    top_mgmt_approved_at: string | null;
    top_mgmt_notes: string | null;
    revision_count: number;
    resulting_document_id: string | null;
    target_document_id: string | null;
    published_at: string | null;
};

type LogEntry = {
    id: string;
    action: string;
    description: string;
    changed_by: string;
    changed_at: string;
    metadata: any;
};

export default function RequestDetailPage({ id }: { id: string }) {
    const router = useRouter();
    const [req, setReq] = useState<Request | null>(null);
    const [targetDoc, setTargetDoc] = useState<any>(null);
    const [resultingDoc, setResultingDoc] = useState<any>(null);
    const [log, setLog] = useState<LogEntry[]>([]);
    const [employees, setEmployees] = useState<Record<string, { full_name: string; role: string }>>({});
    const [session, setSession] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [ok, setOk] = useState<string | null>(null);

    const [notes, setNotes] = useState("");
    const [showApproveModal, setShowApproveModal] = useState<null | 'doc_control' | 'top_mgmt'>(null);
    const [showRejectModal, setShowRejectModal] = useState<null | 'doc_control' | 'top_mgmt'>(null);

    const load = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase.from("document_requests").select("*").eq("id", id).single();
            if (error) throw error;
            setReq(data as any);

            // Cargar documentos relacionados
            const ids = [data.target_document_id, data.resulting_document_id].filter(Boolean);
            if (ids.length) {
                const { data: docs } = await supabase.from("documents").select("id, folio, title, version, status").in("id", ids);
                if (docs) {
                    setTargetDoc((docs as any).find((d: any) => d.id === data.target_document_id) || null);
                    setResultingDoc((docs as any).find((d: any) => d.id === data.resulting_document_id) || null);
                }
            }

            // Log de cambios
            const { data: logData } = await supabase
                .from("change_log")
                .select("*")
                .eq("entity_type", "document_request")
                .eq("entity_id", id)
                .order("changed_at", { ascending: false });
            setLog((logData || []) as any);

            // Empleados referenciados
            const empIds = Array.from(new Set([
                data.requested_by, data.doc_control_reviewer, data.top_mgmt_approver,
                ...(logData || []).map((l: any) => l.changed_by)
            ].filter(Boolean)));
            if (empIds.length) {
                const { data: emps } = await supabase.from("employees").select("id, full_name, role").in("id", empIds);
                const map: any = {};
                for (const e of (emps || []) as any[]) map[e.id] = e;
                setEmployees(map);
            }
        } catch (e: any) {
            setErr(e?.message || "Error");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, [id]);

    // Determinar rol del usuario actual
    const myId = session?.user?.id || null;
    const myRole = session?.user?.role || null;
    const isRequester = req && myId && req.requested_by === myId;
    const isDocController = myRole === 'document_controller' || myRole === 'master';
    const isTopMgmt = myRole === 'top_management' || myRole === 'master';

    const doReview = async (decision: 'approve' | 'reject', reviewer: 'doc_control' | 'top_mgmt') => {
        if (decision === 'reject' && !notes.trim()) {
            setErr("Para rechazar, debes indicar las notas con lo que el solicitante debe corregir.");
            return;
        }
        setBusy(true);
        setErr(null);
        setOk(null);
        try {
            if (reviewer === 'doc_control') {
                await reviewByDocumentControllerAction({ requestId: id, decision, notes });
            } else {
                await approveByTopManagementAction({ requestId: id, decision, notes });
            }
            setNotes("");
            setShowApproveModal(null);
            setShowRejectModal(null);
            setOk(decision === 'approve' ? 'Aprobada. La requisición pasó al siguiente paso.' : 'Rechazada. El solicitante fue notificado.');
            await load();
        } catch (e: any) {
            setErr(e?.message || "Error");
        } finally {
            setBusy(false);
        }
    };

    const doPublish = async () => {
        setBusy(true);
        setErr(null);
        setOk(null);
        try {
            const { document_id } = await publishDocumentRequestAction(id);
            setOk("Requisición publicada. Documento creado.");
            await load();
            if (document_id) router.push(`/documents/${document_id}`);
        } catch (e: any) {
            setErr(e?.message || "Error");
        } finally {
            setBusy(false);
        }
    };

    const doCancel = async () => {
        if (!confirm("¿Cancelar esta requisición?")) return;
        setBusy(true);
        try {
            await cancelDocumentRequestAction(id);
            await load();
        } catch (e: any) { setErr(e?.message || "Error"); }
        finally { setBusy(false); }
    };

    if (loading) return <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center"><RefreshCw className="w-8 h-8 animate-spin text-violet-400" /></div>;
    if (!req) return <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 flex items-center justify-center">Requisición no encontrada.</div>;

    const meta = STATUS_META[req.status];
    const Icon = meta.icon;
    const payload = req.payload || {};

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-3 sm:p-6 md:p-8 lg:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-5xl mx-auto space-y-6">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50">
                    <div className="flex items-center gap-4">
                        <Link href="/documents/requests" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl text-neutral-400 hover:text-white border border-neutral-700">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div>
                            <div className="flex items-center gap-2 flex-wrap">
                                <h1 className="text-2xl font-bold text-white">{req.title}</h1>
                                <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border inline-flex items-center gap-1", meta.chip)}>
                                    <Icon className="w-3 h-3" /> {meta.label}
                                </span>
                                <span className={cn("text-[10px] font-bold uppercase px-2 py-0.5 rounded border",
                                    req.type === 'new' ? "bg-sky-500/10 text-sky-300 border-sky-500/30" : "bg-amber-500/10 text-amber-300 border-amber-500/30")}>
                                    {req.type === 'new' ? 'Nuevo' : 'Cambio'}
                                </span>
                                {req.revision_count > 0 && (
                                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-700 text-neutral-300">
                                        rev. {req.revision_count}
                                    </span>
                                )}
                            </div>
                            <p className="text-xs text-neutral-500 mt-0.5">
                                {meta.description}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        {/* Acciones del solicitante */}
                        {isRequester && ['rejected_by_doc_control', 'rejected'].includes(req.status) && (
                            <Link href={`/documents/requests/new?target=${req.target_document_id || ''}&edit=${req.id}`}
                                className="text-sm bg-amber-500 hover:bg-amber-600 text-white px-3 py-2 rounded-lg font-semibold flex items-center gap-1.5">
                                <Send className="w-4 h-4" /> Modificar y reenviar
                            </Link>
                        )}
                        {isRequester && !['published', 'cancelled', 'approved'].includes(req.status) && (
                            <button onClick={doCancel} disabled={busy}
                                className="text-sm bg-rose-500/10 hover:bg-rose-500/20 text-rose-200 border border-rose-500/30 px-3 py-2 rounded-lg flex items-center gap-1.5">
                                <X className="w-4 h-4" /> Cancelar
                            </button>
                        )}

                        {/* Acciones del controlador */}
                        {isDocController && req.status === 'pending_doc_control' && (
                            <>
                                <button onClick={() => setShowApproveModal('doc_control')} disabled={busy}
                                    className="text-sm bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-2 rounded-lg font-semibold flex items-center gap-1.5">
                                    <CheckCircle2 className="w-4 h-4" /> Aprobar
                                </button>
                                <button onClick={() => setShowRejectModal('doc_control')} disabled={busy}
                                    className="text-sm bg-rose-500/10 hover:bg-rose-500/20 text-rose-200 border border-rose-500/30 px-3 py-2 rounded-lg flex items-center gap-1.5">
                                    <XCircle className="w-4 h-4" /> Rechazar
                                </button>
                            </>
                        )}

                        {/* Acciones de Alta Dirección */}
                        {isTopMgmt && req.status === 'pending_top_mgmt' && (
                            <>
                                <button onClick={() => setShowApproveModal('top_mgmt')} disabled={busy}
                                    className="text-sm bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-2 rounded-lg font-semibold flex items-center gap-1.5">
                                    <CheckCircle2 className="w-4 h-4" /> Aprobar
                                </button>
                                <button onClick={() => setShowRejectModal('top_mgmt')} disabled={busy}
                                    className="text-sm bg-rose-500/10 hover:bg-rose-500/20 text-rose-200 border border-rose-500/30 px-3 py-2 rounded-lg flex items-center gap-1.5">
                                    <XCircle className="w-4 h-4" /> Rechazar
                                </button>
                            </>
                        )}

                        {/* Publicar (Alta Dirección) */}
                        {isTopMgmt && req.status === 'approved' && (
                            <button onClick={doPublish} disabled={busy}
                                className="text-sm bg-cyan-500 hover:bg-cyan-600 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-1.5">
                                <FileText className="w-4 h-4" /> Publicar documento
                            </button>
                        )}
                    </div>
                </header>

                {err && <div className="p-3 rounded-xl border bg-red-500/10 border-red-500/30 text-red-400 flex items-center gap-3"><AlertCircle className="w-5 h-5" /> {err}</div>}
                {ok && <div className="p-3 rounded-xl border bg-emerald-500/10 border-emerald-500/30 text-emerald-300 flex items-center gap-3"><CheckCircle2 className="w-5 h-5" /> {ok}</div>}

                {/* Documento resultante (si fue publicada) */}
                {resultingDoc && (
                    <div className="p-4 rounded-2xl border bg-emerald-500/10 border-emerald-500/30 flex items-center gap-3">
                        <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                        <div className="flex-1">
                            <p className="text-sm text-emerald-200 font-medium">Documento publicado</p>
                            <p className="text-xs text-emerald-300/80">
                                <span className="font-mono">{resultingDoc.folio}</span> v{resultingDoc.version} — {resultingDoc.title}
                            </p>
                        </div>
                        <Link href={`/documents/${resultingDoc.id}`} className="text-xs text-emerald-300 hover:text-emerald-200 underline">
                            Abrir
                        </Link>
                    </div>
                )}

                {/* Documento objetivo (cambios) */}
                {req.type === 'change' && targetDoc && (
                    <div className="p-4 rounded-2xl border bg-amber-500/10 border-amber-500/30 flex items-center gap-3">
                        <FileText className="w-5 h-5 text-amber-400" />
                        <div className="flex-1">
                            <p className="text-sm text-amber-200 font-medium">Documento a modificar</p>
                            <p className="text-xs text-amber-300/80">
                                <span className="font-mono">{targetDoc.folio}</span> v{targetDoc.version} — {targetDoc.title}
                            </p>
                        </div>
                        <Link href={`/documents/${targetDoc.id}`} className="text-xs text-amber-300 hover:text-amber-200 underline">
                            Ver actual
                        </Link>
                    </div>
                )}

                {/* Notas de rechazo */}
                {req.doc_control_notes && (req.status === 'rejected_by_doc_control') && (
                    <div className="p-4 rounded-2xl border bg-rose-500/10 border-rose-500/30">
                        <p className="text-sm font-semibold text-rose-200 mb-1 flex items-center gap-1.5">
                            <XCircle className="w-4 h-4" /> El Controlador rechazó con estas notas:
                        </p>
                        <p className="text-sm text-rose-100 whitespace-pre-wrap">{req.doc_control_notes}</p>
                    </div>
                )}
                {req.top_mgmt_notes && req.status === 'rejected' && (
                    <div className="p-4 rounded-2xl border bg-rose-500/10 border-rose-500/30">
                        <p className="text-sm font-semibold text-rose-200 mb-1 flex items-center gap-1.5">
                            <XCircle className="w-4 h-4" /> Alta Dirección rechazó con estas notas:
                        </p>
                        <p className="text-sm text-rose-100 whitespace-pre-wrap">{req.top_mgmt_notes}</p>
                    </div>
                )}

                {/* Justificación */}
                <div className="bg-neutral-800/40 p-5 rounded-2xl border border-neutral-700/50 space-y-2">
                    <h2 className="text-sm font-semibold text-white">Justificación del solicitante</h2>
                    <p className="text-sm text-neutral-300 whitespace-pre-wrap">{req.reason}</p>
                    {req.change_summary && (
                        <>
                            <h2 className="text-sm font-semibold text-white mt-3">Resumen del cambio</h2>
                            <p className="text-sm text-neutral-300 whitespace-pre-wrap">{req.change_summary}</p>
                        </>
                    )}
                </div>

                {/* Contenido propuesto del documento */}
                <div className="bg-neutral-800/40 p-5 rounded-2xl border border-neutral-700/50 space-y-3">
                    <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                        <FileText className="w-4 h-4 text-violet-400" /> Contenido propuesto del documento
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                        {payload.objective && <div><span className="text-neutral-500">Objetivo:</span> <span className="text-neutral-200">{payload.objective}</span></div>}
                        {payload.scope && <div><span className="text-neutral-500">Alcance:</span> <span className="text-neutral-200">{payload.scope}</span></div>}
                        {payload.definitions && <div><span className="text-neutral-500">Definiciones:</span> <span className="text-neutral-200">{payload.definitions}</span></div>}
                        {payload.responsibilities && <div><span className="text-neutral-500">Responsabilidades:</span> <span className="text-neutral-200">{payload.responsibilities}</span></div>}
                    </div>
                    <div className="bg-neutral-900/60 border border-violet-500/30 rounded-xl p-3">
                        <p className="text-[10px] uppercase font-bold text-violet-300 mb-1">Desarrollo / Procedimiento</p>
                        <pre className="whitespace-pre-wrap text-sm text-neutral-200 font-mono">{payload.content}</pre>
                    </div>
                    {payload.document_references && <p className="text-sm"><span className="text-neutral-500">Referencias:</span> <span className="text-neutral-200">{payload.document_references}</span></p>}
                    {payload.records && <p className="text-sm"><span className="text-neutral-500">Registros:</span> <span className="text-neutral-200">{payload.records}</span></p>}
                </div>

                {/* Historial (change_log) */}
                <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-5">
                    <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
                        <History className="w-4 h-4 text-violet-400" /> Historial de decisiones
                    </h2>
                    {log.length === 0 ? (
                        <p className="text-sm text-neutral-500 text-center py-4">Sin movimientos aún.</p>
                    ) : (
                        <ol className="space-y-2 relative border-l border-neutral-700/50 pl-4 ml-2">
                            {log.map(l => {
                                const emp = employees[l.changed_by];
                                return (
                                    <li key={l.id} className="relative">
                                        <span className="absolute -left-[19px] top-1.5 w-3 h-3 rounded-full bg-violet-500 border-2 border-neutral-900" />
                                        <p className="text-sm text-neutral-200">{l.description}</p>
                                        <p className="text-[10px] text-neutral-500">
                                            {emp ? `${emp.full_name} (${emp.role})` : l.changed_by.slice(0, 8) + '…'}
                                            {' · '}
                                            {new Date(l.changed_at).toLocaleString()}
                                        </p>
                                        {l.metadata?.notes && (
                                            <p className="text-xs text-neutral-400 mt-1 italic bg-neutral-900/40 px-2 py-1 rounded">"{l.metadata.notes}"</p>
                                        )}
                                    </li>
                                );
                            })}
                        </ol>
                    )}
                </div>
            </div>

            {/* Modal de aprobación */}
            {showApproveModal && (
                <Modal title={showApproveModal === 'doc_control' ? 'Aprobar como Controlador' : 'Aprobar como Alta Dirección'} onClose={() => setShowApproveModal(null)}>
                    <p className="text-sm text-neutral-300 mb-3">¿Confirmas que esta requisición cumple con los requisitos y debe pasar al siguiente paso?</p>
                    <label className="text-xs text-neutral-400">Notas (opcional)</label>
                    <textarea value={notes} onChange={e => setNotes(e.target.value)}
                        className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500 min-h-[80px]"
                        placeholder="Comentarios, condiciones, etc." />
                    <div className="flex justify-end gap-2 mt-4">
                        <button onClick={() => setShowApproveModal(null)} className="px-4 py-2 text-sm text-neutral-300 hover:text-white">Cancelar</button>
                        <button onClick={() => doReview('approve', showApproveModal)} disabled={busy}
                            className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5">
                            <CheckCircle2 className="w-4 h-4" /> Aprobar
                        </button>
                    </div>
                </Modal>
            )}

            {/* Modal de rechazo */}
            {showRejectModal && (
                <Modal title={showRejectModal === 'doc_control' ? 'Rechazar como Controlador' : 'Rechazar como Alta Dirección'} onClose={() => setShowRejectModal(null)}>
                    <p className="text-sm text-neutral-300 mb-3">Indica las notas para que el solicitante sepa qué corregir.</p>
                    <label className="text-xs text-neutral-400">Motivo del rechazo *</label>
                    <textarea value={notes} onChange={e => setNotes(e.target.value)}
                        className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-rose-500 min-h-[120px]"
                        placeholder="Detalla qué debe cambiar para que sea aprobada." />
                    <div className="flex justify-end gap-2 mt-4">
                        <button onClick={() => setShowRejectModal(null)} className="px-4 py-2 text-sm text-neutral-300 hover:text-white">Cancelar</button>
                        <button onClick={() => doReview('reject', showRejectModal)} disabled={busy || !notes.trim()}
                            className="bg-rose-500 hover:bg-rose-600 text-white px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50">
                            <XCircle className="w-4 h-4" /> Rechazar
                        </button>
                    </div>
                </Modal>
            )}
        </div>
    );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-neutral-900 border border-neutral-700 rounded-2xl p-6 max-w-lg w-full" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-bold text-white mb-3">{title}</h3>
                {children}
            </div>
        </div>
    );
}
