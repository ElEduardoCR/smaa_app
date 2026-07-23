"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
    ArrowLeft, BookOpen, Save, RefreshCw, Edit2, CheckCircle2, X, Lock, History,
    Shield, ShieldCheck, FileText, Loader2, AlertCircle, ChevronDown, ChevronUp
} from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";
import SignaturePad from "@/components/manufacturing/SignaturePad";
import { uploadSignatureDataUrl } from "@/lib/uploadHelpers";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

const STATUS_STYLES: Record<string, string> = {
    draft: "bg-neutral-500/10 text-neutral-300 border-neutral-500/30",
    in_review: "bg-amber-500/10 text-amber-300 border-amber-500/30",
    approved: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
    obsolete: "bg-rose-500/10 text-rose-300 border-rose-500/30",
    pending_obsolete: "bg-violet-500/10 text-violet-300 border-violet-500/30",
};
const STATUS_LABEL: Record<string, string> = {
    draft: "Borrador", in_review: "En revisión", approved: "Vigente",
    obsolete: "Obsoleto", pending_obsolete: "Por obsolescer",
};

type Document = {
    id: string; folio: string; type_id: string; title: string;
    objective: string | null; scope: string | null; definitions: string | null;
    responsibilities: string | null; content: string; document_references: string | null;
    records: string | null; keywords: string | null;
    version: string; revision: number; status: string;
    effective_date: string | null; next_review_date: string | null;
    approval_name: string | null; approval_role: string | null;
    approval_signature_url: string | null; approval_signed_at: string | null;
    created_by: string | null; created_at: string; updated_at: string;
    type?: { code: string; name: string; prefix: string };
};
type Version = { id: string; version: string; revision: number; title: string; change_summary: string | null; changed_by: string | null; changed_at: string };
type Sig = { id: string; version: string; signer_name: string; signer_role: string | null; signature_url: string; signed_at: string; purpose: string };

export default function DocumentDetailPage() {
    const params = useParams();
    const router = useRouter();
    const id = params?.id as string;

    const [doc, setDoc] = useState<Document | null>(null);
    const [versions, setVersions] = useState<Version[]>([]);
    const [signatures, setSignatures] = useState<Sig[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState<{ type: "error" | "success" | "info"; text: string } | null>(null);
    const [tab, setTab] = useState<"content" | "history" | "signatures">("content");
    const [showSignModal, setShowSignModal] = useState(false);
    const [signerName, setSignerName] = useState("");
    const [signerRole, setSignerRole] = useState("");

    const load = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase.from("documents").select("*, type:document_types(code, name, prefix)").eq("id", id).single();
            if (error) throw error;
            const fmt: any = { ...data, type: Array.isArray(data.type) ? data.type[0] : data.type };
            setDoc(fmt);
            const [{ data: vs }, { data: ss }] = await Promise.all([
                supabase.from("document_versions").select("id, version, revision, title, change_summary, changed_by, changed_at").eq("document_id", id).order("changed_at", { ascending: false }),
                supabase.from("document_signatures").select("id, version, signer_name, signer_role, signature_url, signed_at, purpose").eq("document_id", id).order("signed_at", { ascending: false }),
            ]);
            setVersions(vs || []);
            setSignatures(ss || []);
        } catch (e: any) { setMsg({ type: "error", text: e?.message || "Error" }); }
        finally { setLoading(false); }
    };
    useEffect(() => { if (id) load(); }, [id]);

    const flash = (type: "error" | "success" | "info", text: string) => {
        setMsg({ type, text });
        setTimeout(() => setMsg(null), 4000);
    };

    const changeStatus = async (newStatus: string) => {
        if (!doc) return;
        setBusy(true);
        try {
            const { error } = await supabase.from("documents").update({ status: newStatus }).eq("id", doc.id);
            if (error) throw error;
            flash("success", `Estatus cambiado a ${STATUS_LABEL[newStatus]}.`);
            load();
        } catch (e: any) { flash("error", e?.message || "Error."); }
        finally { setBusy(false); }
    };

    const obsolete = async () => {
        if (!doc) return;
        const reason = prompt("Motivo de obsolescencia:");
        if (reason === null) return;
        setBusy(true);
        try {
            await supabase.from("documents").update({
                status: "obsolete",
                obsoleted_at: new Date().toISOString(),
                obsoleted_reason: reason || null,
            }).eq("id", doc.id);
            flash("info", "Documento marcado como obsoleto.");
            load();
        } catch (e: any) { flash("error", e?.message || "Error."); }
        finally { setBusy(false); }
    };

    const handleSign = async (signatureDataUrl: string) => {
        if (!doc) return;
        if (!signerName.trim()) { flash("error", "Captura el nombre del firmante."); return; }
        setBusy(true);
        try {
            const sigUrl = await uploadSignatureDataUrl(signatureDataUrl, `doc_${doc.folio}_v${doc.version}`);
            const { error } = await supabase.from("document_signatures").insert([{
                document_id: doc.id, version: doc.version, signer_name: signerName, signer_role: signerRole || null,
                signature_url: sigUrl, purpose: "approval",
            }]);
            if (error) throw error;
            // If first signature and document is draft/in_review, mark as approved
            if (doc.status === "draft" || doc.status === "in_review") {
                await supabase.from("documents").update({
                    status: "approved",
                    approval_name: signerName,
                    approval_role: signerRole || null,
                    approval_signature_url: sigUrl,
                    approval_signed_at: new Date().toISOString(),
                    effective_date: doc.effective_date || new Date().toISOString().slice(0, 10),
                }).eq("id", doc.id);
            }
            setShowSignModal(false);
            setSignerName(""); setSignerRole("");
            flash("success", "Firma registrada. Documento ahora vigente.");
            load();
        } catch (e: any) { flash("error", e?.message || "Error al firmar."); }
        finally { setBusy(false); }
    };

    const del = async () => {
        if (!doc) return;
        if (!confirm("¿Eliminar este documento y todo su historial? Esta acción no se puede deshacer.")) return;
        await supabase.from("documents").delete().eq("id", doc.id);
        router.push("/documents");
    };

    if (loading) return <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center"><RefreshCw className="w-8 h-8 animate-spin text-violet-400" /></div>;
    if (!doc) return <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 flex items-center justify-center">Documento no encontrado.</div>;

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-6 md:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-5xl mx-auto space-y-6">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50">
                    <div className="flex items-center gap-4">
                        <Link href="/documents" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl text-neutral-400 hover:text-white border border-neutral-700">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div>
                            <div className="flex items-center gap-2 flex-wrap">
                                <h1 className="text-2xl font-bold text-white">{doc.title}</h1>
                                <span className="font-mono text-violet-300 text-xs bg-violet-500/10 px-2 py-0.5 rounded border border-violet-500/20">{doc.folio}</span>
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-neutral-700 text-neutral-300 font-mono">v{doc.version}</span>
                                <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border uppercase", STATUS_STYLES[doc.status])}>{STATUS_LABEL[doc.status]}</span>
                            </div>
                            <p className="text-xs text-neutral-500 mt-0.5">{doc.type?.name} · rev. {doc.revision} · autor: {doc.created_by || "—"}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <Link href={`/documents/new?id=${doc.id}`} className="text-sm flex items-center gap-1.5 bg-neutral-800 hover:bg-neutral-700 text-white px-3 py-2 rounded-lg border border-neutral-700">
                            <Edit2 className="w-4 h-4" /> Editar
                        </Link>
                        {doc.status === "draft" && (
                            <button onClick={() => changeStatus("in_review")} disabled={busy} className="text-sm bg-amber-500 hover:bg-amber-600 text-white px-3 py-2 rounded-lg font-semibold flex items-center gap-1.5">
                                Pasar a revisión
                            </button>
                        )}
                        {(doc.status === "draft" || doc.status === "in_review") && (
                            <button onClick={() => setShowSignModal(true)} className="text-sm bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-2 rounded-lg font-semibold flex items-center gap-1.5">
                                <ShieldCheck className="w-4 h-4" /> Firmar y aprobar
                            </button>
                        )}
                        {doc.status === "approved" && (
                            <>
                                <button onClick={() => changeStatus("pending_obsolete")} className="text-sm bg-violet-500 hover:bg-violet-600 text-white px-3 py-2 rounded-lg font-semibold flex items-center gap-1.5">
                                    Marcar como a obsolescer
                                </button>
                                <button onClick={obsolete} className="text-sm bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 hover:text-white px-3 py-2 rounded-lg border border-rose-500/30 flex items-center gap-1.5">
                                    <X className="w-4 h-4" /> Obsoletar
                                </button>
                            </>
                        )}
                        <button onClick={del} className="text-sm text-red-300 hover:text-white bg-red-500/10 hover:bg-red-500/30 px-3 py-2 rounded-lg border border-red-500/30">
                            Eliminar
                        </button>
                    </div>
                </header>

                {msg && (
                    <div className={cn("p-3 rounded-xl border flex items-center gap-2",
                        msg.type === "error" ? "bg-red-500/10 border-red-500/30 text-red-300" :
                        msg.type === "success" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" :
                        "bg-sky-500/10 border-sky-500/30 text-sky-300"
                    )}>
                        {msg.type === "error" ? <AlertCircle className="w-4 h-4" /> : msg.type === "success" ? <CheckCircle2 className="w-4 h-4" /> : <History className="w-4 h-4" />} {msg.text}
                    </div>
                )}

                {/* Approval banner */}
                {doc.status === "approved" && doc.approval_signature_url && (
                    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4 flex items-center gap-4">
                        <img src={doc.approval_signature_url} alt="firma" className="h-14 bg-neutral-900/50 rounded-lg p-1 border border-emerald-500/30" />
                        <div className="flex-1">
                            <p className="text-sm text-emerald-200 font-medium flex items-center gap-1.5">
                                <ShieldCheck className="w-4 h-4" /> Aprobado por {doc.approval_name} {doc.approval_role && `(${doc.approval_role})`}
                            </p>
                            <p className="text-xs text-emerald-300/80">Vigente desde {doc.effective_date ? new Date(doc.effective_date).toLocaleDateString() : "—"} {doc.next_review_date && `· próxima revisión: ${new Date(doc.next_review_date).toLocaleDateString()}`}</p>
                        </div>
                    </div>
                )}

                {/* Tabs */}
                <div className="flex flex-wrap gap-2">
                    {[
                        { k: "content", label: "Contenido" },
                        { k: "history", label: `Historial (${versions.length})` },
                        { k: "signatures", label: `Firmas (${signatures.length})` },
                    ].map(t => (
                        <button key={t.k} onClick={() => setTab(t.k as any)}
                            className={cn("text-sm px-4 py-2 rounded-xl border transition-colors",
                                tab === t.k ? "bg-violet-500/15 text-violet-300 border-violet-500/40" :
                                "bg-neutral-800/40 text-neutral-400 border-neutral-700/50 hover:bg-neutral-800"
                            )}>
                            {t.label}
                        </button>
                    ))}
                </div>

                {tab === "content" && (
                    <div className="space-y-3">
                        <DocSection title="Objetivo" content={doc.objective} />
                        <DocSection title="Alcance" content={doc.scope} />
                        <DocSection title="Definiciones" content={doc.definitions} />
                        <DocSection title="Responsabilidades" content={doc.responsibilities} />
                        <div className="bg-neutral-800/40 p-5 rounded-2xl border-2 border-violet-500/30">
                            <h3 className="text-sm font-bold text-violet-200 mb-2 flex items-center gap-2"><FileText className="w-4 h-4" /> Desarrollo / Procedimiento</h3>
                            <pre className="whitespace-pre-wrap text-sm text-neutral-200 font-mono">{doc.content}</pre>
                        </div>
                        <DocSection title="Referencias documentales" content={doc.document_references} />
                        <DocSection title="Registros asociados" content={doc.records} />
                    </div>
                )}

                {tab === "history" && (
                    <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-5">
                        <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
                            <History className="w-4 h-4 text-violet-400" /> Historial de versiones
                        </h3>
                        {versions.length === 0 ? (
                            <p className="text-sm text-neutral-500 text-center py-6">Sin versiones anteriores. Las versiones se guardan automáticamente cuando editas un documento aprobado.</p>
                        ) : (
                            <ul className="space-y-2">
                                {versions.map(v => (
                                    <li key={v.id} className="bg-neutral-900/40 p-3 rounded-xl border border-neutral-700/30">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-mono text-violet-300 text-xs">v{v.version}</span>
                                            <span className="text-sm text-white font-medium">{v.title}</span>
                                            <span className="text-[10px] text-neutral-500 ml-auto">{new Date(v.changed_at).toLocaleString()}</span>
                                        </div>
                                        {v.change_summary && <p className="text-xs text-neutral-400 mt-1">{v.change_summary}</p>}
                                        {v.changed_by && <p className="text-[10px] text-neutral-500">por {v.changed_by}</p>}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}

                {tab === "signatures" && (
                    <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-5">
                        <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
                            <ShieldCheck className="w-4 h-4 text-emerald-400" /> Firmas registradas
                        </h3>
                        {signatures.length === 0 ? (
                            <p className="text-sm text-neutral-500 text-center py-6">Sin firmas aún. Cambia el documento a "En revisión" o "Borrador" y firma desde los botones de arriba.</p>
                        ) : (
                            <ul className="space-y-3">
                                {signatures.map(s => (
                                    <li key={s.id} className="bg-neutral-900/40 p-3 rounded-xl border border-neutral-700/30 flex items-center gap-3">
                                        <img src={s.signature_url} alt="firma" className="h-12 bg-neutral-900 rounded-lg p-1 border border-neutral-700" />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm text-white font-medium">{s.signer_name} {s.signer_role && <span className="text-neutral-500">· {s.signer_role}</span>}</p>
                                            <p className="text-[10px] text-neutral-500">v{s.version} · {new Date(s.signed_at).toLocaleString()} · {s.purpose}</p>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}
            </div>

            {showSignModal && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowSignModal(false)}>
                    <div className="bg-neutral-900 border border-neutral-700 rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-3">
                            <ShieldCheck className="w-5 h-5 text-emerald-400" /> Firmar y aprobar
                        </h3>
                        <p className="text-sm text-neutral-400 mb-3">
                            Vas a firmar <strong>{doc.folio} v{doc.version}</strong>: {doc.title}
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                            <div>
                                <label className="text-xs text-neutral-400">Nombre del firmante *</label>
                                <input value={signerName} onChange={e => setSignerName(e.target.value)} placeholder="Tu nombre completo" className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500" />
                            </div>
                            <div>
                                <label className="text-xs text-neutral-400">Cargo / Rol</label>
                                <input value={signerRole} onChange={e => setSignerRole(e.target.value)} placeholder="Ej. Director de Calidad" className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500" />
                            </div>
                        </div>
                        <SignaturePad
                            onSave={handleSign}
                            saving={busy}
                            color="#10b981"
                            savingLabel="Firmando…"
                            saveLabel="Firmar y aprobar"
                        />
                        <button onClick={() => setShowSignModal(false)} className="text-xs text-neutral-500 hover:text-white mt-3">Cancelar</button>
                    </div>
                </div>
            )}
        </div>
    );
}

function DocSection({ title, content }: { title: string; content: string | null | undefined }) {
    if (!content) return null;
    return (
        <div className="bg-neutral-800/40 p-4 rounded-2xl border border-neutral-700/50">
            <h3 className="text-xs uppercase tracking-wider text-violet-300 mb-1.5 font-semibold">{title}</h3>
            <p className="text-sm text-neutral-200 whitespace-pre-wrap">{content}</p>
        </div>
    );
}
