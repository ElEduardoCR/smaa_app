"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
    ArrowLeft, Save, BookOpen, AlertCircle, RefreshCw, FileText, ChevronRight, ChevronLeft, Layers
} from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";
import { createDocumentRequestAction } from "@/app/actions/documentRequests";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

const STEPS = [
    { num: 1, label: "Tipo y objetivo" },
    { num: 2, label: "Contenido del documento" },
    { num: 3, label: "Justificación" },
];

function NewRequestForm() {
    const router = useRouter();
    const search = useSearchParams();
    const targetDocId = search?.get("target") || null;

    const [step, setStep] = useState(1);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [types, setTypes] = useState<any[]>([]);
    const [targetDoc, setTargetDoc] = useState<any>(null);

    // Step 1
    const [type, setType] = useState<'new' | 'change'>(targetDocId ? 'change' : 'new');
    const [typeId, setTypeId] = useState<string>("");
    const [title, setTitle] = useState("");
    const [changeSummary, setChangeSummary] = useState("");

    // Step 2 (contenido del documento propuesto)
    const [keywords, setKeywords] = useState("");
    const [objective, setObjective] = useState("");
    const [scope, setScope] = useState("");
    const [definitions, setDefinitions] = useState("");
    const [responsibilities, setResponsibilities] = useState("");
    const [content, setContent] = useState("");
    const [documentReferences, setDocumentReferences] = useState("");
    const [records, setRecords] = useState("");
    const [effectiveDate, setEffectiveDate] = useState("");
    const [nextReviewDate, setNextReviewDate] = useState("");
    const [version, setVersion] = useState("1.0");

    // Step 3
    const [reason, setReason] = useState("");

    useEffect(() => {
        (async () => {
            const { data } = await supabase.from("document_types").select("*").eq("is_active", true).order("sort_order");
            setTypes(data || []);
            if (data && data.length > 0 && !typeId) setTypeId(data[0].id);
        })();
    }, []);

    useEffect(() => {
        if (targetDocId) {
            (async () => {
                const { data } = await supabase.from("documents").select("*").eq("id", targetDocId).single();
                if (data) {
                    setTargetDoc(data);
                    setTitle(data.title);
                    setTypeId(data.type_id || "");
                    setKeywords(data.keywords || "");
                    setObjective(data.objective || "");
                    setScope(data.scope || "");
                    setDefinitions(data.definitions || "");
                    setResponsibilities(data.responsibilities || "");
                    setContent(data.content || "");
                    setDocumentReferences(data.document_references || "");
                    setRecords(data.records || "");
                    setEffectiveDate(data.effective_date || "");
                    setNextReviewDate(data.next_review_date || "");
                    setVersion(bumpVersion(data.version || "1.0"));
                }
            })();
        }
    }, [targetDocId]);

    const submit = async () => {
        setErr(null);
        if (!type) { setErr("Selecciona el tipo de requisición."); return; }
        if (!title.trim()) { setErr("El título es obligatorio."); return; }
        if (!content.trim()) { setErr("El contenido es obligatorio."); return; }
        if (!reason.trim()) { setErr("La justificación es obligatoria."); return; }
        if (type === 'change' && !targetDocId) { setErr("Falta el documento objetivo."); return; }

        setBusy(true);
        try {
            const { id } = await createDocumentRequestAction({
                type,
                target_document_id: type === 'change' ? targetDocId : null,
                title: title.trim(),
                change_summary: changeSummary.trim() || undefined,
                reason: reason.trim(),
                payload: {
                    type_id: typeId || undefined,
                    title: title.trim(),
                    keywords: keywords.trim() || undefined,
                    objective: objective.trim() || undefined,
                    scope: scope.trim() || undefined,
                    definitions: definitions.trim() || undefined,
                    responsibilities: responsibilities.trim() || undefined,
                    content: content.trim(),
                    document_references: documentReferences.trim() || undefined,
                    records: records.trim() || undefined,
                    effective_date: effectiveDate || null,
                    next_review_date: nextReviewDate || null,
                    version: version.trim() || undefined,
                },
            });
            router.push(`/documents/requests/${id}`);
        } catch (e: any) {
            setErr(e?.message || "Error al crear la requisición.");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-3 sm:p-6 md:p-8 lg:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-4xl mx-auto space-y-6">
                <header className="flex items-center gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <Link href="/documents/requests" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl text-neutral-400 hover:text-white border border-neutral-700">
                        <ArrowLeft className="w-5 h-5" />
                    </Link>
                    <div>
                        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                            <BookOpen className="w-8 h-8 text-violet-400" />
                            Nueva requisición
                        </h1>
                        <p className="text-neutral-400 text-sm mt-1">
                            Tu solicitud será revisada por el Controlador de Documentos antes de pasar a Alta Dirección.
                        </p>
                    </div>
                </header>

                {targetDoc && (
                    <div className="p-4 rounded-xl border bg-violet-500/10 border-violet-500/30 text-violet-200 text-sm flex items-start gap-3">
                        <Layers className="w-5 h-5 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="font-semibold">Estás proponiendo un cambio al documento <span className="font-mono">{targetDoc.folio}</span> v{targetDoc.version}</p>
                            <p className="text-violet-300/80 mt-1">"{targetDoc.title}" — al publicar, la versión actual se marcará como obsoleta y se creará una nueva.</p>
                        </div>
                    </div>
                )}

                {/* Stepper */}
                <div className="flex items-center gap-2">
                    {STEPS.map(s => (
                        <div key={s.num} className="flex items-center gap-2 flex-1">
                            <div className={cn(
                                "w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm border",
                                step === s.num ? "bg-violet-500 text-white border-violet-500" :
                                step > s.num ? "bg-violet-500/20 text-violet-300 border-violet-500/30" :
                                "bg-neutral-800 text-neutral-500 border-neutral-700"
                            )}>{s.num}</div>
                            <span className={cn("text-sm", step === s.num ? "text-white font-medium" : "text-neutral-500")}>{s.label}</span>
                            {s.num < STEPS.length && <ChevronRight className="w-4 h-4 text-neutral-600" />}
                        </div>
                    ))}
                </div>

                {err && (
                    <div className="p-3 rounded-xl border bg-red-500/10 border-red-500/30 text-red-400 flex items-center gap-3">
                        <AlertCircle className="w-5 h-5 flex-shrink-0" /> {err}
                    </div>
                )}

                <div className="bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm space-y-4">
                    {step === 1 && (
                        <div className="space-y-4">
                            <h2 className="text-lg font-semibold text-white">1) Tipo y objetivo</h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs text-neutral-400 ml-1">Tipo de requisición *</label>
                                    <select value={type} onChange={e => setType(e.target.value as any)} disabled={!!targetDocId}
                                        className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500 disabled:opacity-50">
                                        <option value="new">Documento nuevo</option>
                                        <option value="change">Cambio a documento existente</option>
                                    </select>
                                </div>
                                {type === 'new' && (
                                    <div>
                                        <label className="text-xs text-neutral-400 ml-1">Tipo de documento *</label>
                                        <select value={typeId} onChange={e => setTypeId(e.target.value)}
                                            className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500">
                                            {types.map(t => <option key={t.id} value={t.id}>{t.name} ({t.prefix})</option>)}
                                        </select>
                                    </div>
                                )}
                            </div>
                            <div>
                                <label className="text-xs text-neutral-400 ml-1">Título propuesto *</label>
                                <input value={title} onChange={e => setTitle(e.target.value)}
                                    className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500"
                                    placeholder="Ej. Procedimiento de control de calidad" />
                            </div>
                            {type === 'change' && (
                                <div>
                                    <label className="text-xs text-neutral-400 ml-1">Resumen del cambio</label>
                                    <textarea value={changeSummary} onChange={e => setChangeSummary(e.target.value)}
                                        className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500 min-h-[80px]"
                                        placeholder="¿Qué se cambia y por qué? (aparece en la requisición para el revisor)" />
                                </div>
                            )}
                            <div>
                                <label className="text-xs text-neutral-400 ml-1">Versión propuesta</label>
                                <input value={version} onChange={e => setVersion(e.target.value)}
                                    className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-violet-500"
                                    placeholder="1.0" />
                            </div>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="space-y-4">
                            <h2 className="text-lg font-semibold text-white">2) Contenido del documento (ISO 9001:2015)</h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs text-neutral-400 ml-1">Objetivo</label>
                                    <textarea value={objective} onChange={e => setObjective(e.target.value)}
                                        className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500 min-h-[70px]" />
                                </div>
                                <div>
                                    <label className="text-xs text-neutral-400 ml-1">Alcance</label>
                                    <textarea value={scope} onChange={e => setScope(e.target.value)}
                                        className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500 min-h-[70px]" />
                                </div>
                                <div>
                                    <label className="text-xs text-neutral-400 ml-1">Definiciones</label>
                                    <textarea value={definitions} onChange={e => setDefinitions(e.target.value)}
                                        className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500 min-h-[70px]" />
                                </div>
                                <div>
                                    <label className="text-xs text-neutral-400 ml-1">Responsabilidades</label>
                                    <textarea value={responsibilities} onChange={e => setResponsibilities(e.target.value)}
                                        className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500 min-h-[70px]" />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs text-neutral-400 ml-1">Desarrollo / Procedimiento *</label>
                                <textarea value={content} onChange={e => setContent(e.target.value)}
                                    className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-violet-500 min-h-[200px]"
                                    placeholder="Procedimiento paso a paso..." />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs text-neutral-400 ml-1">Referencias documentales</label>
                                    <textarea value={documentReferences} onChange={e => setDocumentReferences(e.target.value)}
                                        className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500 min-h-[60px]" />
                                </div>
                                <div>
                                    <label className="text-xs text-neutral-400 ml-1">Registros asociados</label>
                                    <textarea value={records} onChange={e => setRecords(e.target.value)}
                                        className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500 min-h-[60px]" />
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div>
                                    <label className="text-xs text-neutral-400 ml-1">Palabras clave</label>
                                    <input value={keywords} onChange={e => setKeywords(e.target.value)}
                                        className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500" />
                                </div>
                                <div>
                                    <label className="text-xs text-neutral-400 ml-1">Vigencia</label>
                                    <input type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)}
                                        className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500" />
                                </div>
                                <div>
                                    <label className="text-xs text-neutral-400 ml-1">Próxima revisión</label>
                                    <input type="date" value={nextReviewDate} onChange={e => setNextReviewDate(e.target.value)}
                                        className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500" />
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 3 && (
                        <div className="space-y-4">
                            <h2 className="text-lg font-semibold text-white">3) Justificación</h2>
                            <div>
                                <label className="text-xs text-neutral-400 ml-1">¿Por qué se necesita este documento o cambio? *</label>
                                <textarea value={reason} onChange={e => setReason(e.target.value)}
                                    className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500 min-h-[150px]"
                                    placeholder="Describe la necesidad, el problema que resuelve, o el requisito que cumple. El controlador usará esta justificación para decidir." />
                            </div>
                            <div className="bg-violet-500/5 border border-violet-500/30 rounded-xl p-4 text-sm text-violet-200 space-y-1">
                                <p className="font-semibold">Lo que sigue después de enviar:</p>
                                <ol className="list-decimal list-inside text-violet-300/90 space-y-0.5">
                                    <li>El <strong>Controlador de Documentos</strong> revisa tu solicitud y puede aprobarla o rechazarte con notas.</li>
                                    <li>Si la aprueban, pasa a <strong>Alta Dirección</strong> para firma.</li>
                                    <li>Al publicarse, el documento queda disponible y la versión anterior (si es un cambio) se marca como obsoleta.</li>
                                    <li>Si te rechazan, puedes corregir según las notas y reenviar.</li>
                                </ol>
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex justify-between">
                    <button onClick={() => setStep(s => Math.max(1, s - 1))} disabled={step === 1}
                        className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors text-sm font-medium disabled:opacity-30">
                        <ChevronLeft className="w-4 h-4" /> Atrás
                    </button>
                    {step < 3 ? (
                        <button onClick={() => setStep(s => Math.min(3, s + 1))}
                            className="flex items-center gap-1.5 bg-violet-500 hover:bg-violet-600 text-white px-5 py-2.5 rounded-xl font-medium text-sm">
                            Siguiente <ChevronRight className="w-4 h-4" />
                        </button>
                    ) : (
                        <button onClick={submit} disabled={busy}
                            className="flex items-center gap-1.5 bg-violet-500 hover:bg-violet-600 text-white px-6 py-2.5 rounded-xl font-bold text-sm disabled:opacity-50">
                            {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            Enviar requisición
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

function bumpVersion(v: string): string {
    const parts = v.split('.').map(n => parseInt(n, 10));
    if (parts.length === 1) return `${parts[0]}.1`;
    if (parts.length >= 2) { parts[1] = (parts[1] ?? 0) + 1; return parts.slice(0, 2).join('.'); }
    return v;
}

export default function NewRequestPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center"><RefreshCw className="w-8 h-8 animate-spin text-violet-400" /></div>}>
            <NewRequestForm />
        </Suspense>
    );
}
