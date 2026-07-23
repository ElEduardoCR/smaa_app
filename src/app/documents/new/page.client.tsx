"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
    ArrowLeft, Save, BookOpen, AlertCircle, RefreshCw, FileText, Tag, ChevronRight, ChevronLeft
} from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

const STEPS = [
    { num: 1, label: "Identificación" },
    { num: 2, label: "Contenido ISO 9001" },
    { num: 3, label: "Vigencia y responsable" },
];

function NewDocumentForm() {
    const router = useRouter();
    const search = useSearchParams();
    const editId = search?.get("id") || null;

    const [step, setStep] = useState(1);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [types, setTypes] = useState<any[]>([]);

    // 1) Identification
    const [typeId, setTypeId] = useState<string>("");
    const [title, setTitle] = useState("");
    const [keywords, setKeywords] = useState("");
    const [createdBy, setCreatedBy] = useState("");

    // 2) ISO content
    const [objective, setObjective] = useState("");
    const [scope, setScope] = useState("");
    const [definitions, setDefinitions] = useState("");
    const [responsibilities, setResponsibilities] = useState("");
    const [content, setContent] = useState("");
    const [documentReferences, setDocumentReferences] = useState("");
    const [records, setRecords] = useState("");

    // 3) Validity
    const [effectiveDate, setEffectiveDate] = useState("");
    const [nextReviewDate, setNextReviewDate] = useState("");
    const [version, setVersion] = useState("1.0");

    useEffect(() => {
        (async () => {
            const { data } = await supabase.from("document_types").select("*").eq("is_active", true).order("sort_order");
            setTypes(data || []);
            if (data && data.length > 0 && !typeId) setTypeId(data[0].id);
        })();
    }, []);

    useEffect(() => {
        if (editId) {
            (async () => {
                const { data, error } = await supabase.from("documents").select("*").eq("id", editId).single();
                if (error) { setErr(error.message); return; }
                if (data) {
                    setTypeId(data.type_id);
                    setTitle(data.title);
                    setKeywords(data.keywords || "");
                    setCreatedBy(data.created_by || "");
                    setObjective(data.objective || "");
                    setScope(data.scope || "");
                    setDefinitions(data.definitions || "");
                    setResponsibilities(data.responsibilities || "");
                    setContent(data.content);
                    setDocumentReferences(data.document_references || "");
                    setRecords(data.records || "");
                    setEffectiveDate(data.effective_date || "");
                    setNextReviewDate(data.next_review_date || "");
                    setVersion(data.version);
                }
            })();
        }
    }, [editId]);

    const save = async () => {
        setErr(null);
        if (!typeId) { setErr("Selecciona un tipo de documento."); return; }
        if (!title.trim()) { setErr("El título es obligatorio."); return; }
        if (!content.trim()) { setErr("El contenido / procedimiento es obligatorio."); return; }
        if (!createdBy.trim()) { setErr("Indica quién es el autor."); return; }

        setBusy(true);
        try {
            if (editId) {
                // Update with version snapshot
                const { data: current } = await supabase.from("documents").select("*").eq("id", editId).single();
                if (current) {
                    // Save current as version snapshot
                    await supabase.from("document_versions").insert([{
                        document_id: editId,
                        version: current.version,
                        revision: current.revision,
                        title: current.title,
                        objective: current.objective,
                        scope: current.scope,
                        definitions: current.definitions,
                        responsibilities: current.responsibilities,
                        content: current.content,
                        document_references: current.document_references,
                        records: current.records,
                        keywords: current.keywords,
                        change_summary: "Versión anterior guardada automáticamente",
                        changed_by: createdBy,
                    }]);
                }
                const { error } = await supabase.from("documents").update({
                    type_id: typeId, title, keywords, objective, scope, definitions, responsibilities,
                    content, document_references: documentReferences, records,
                    effective_date: effectiveDate || null, next_review_date: nextReviewDate || null,
                    version, created_by: createdBy,
                }).eq("id", editId);
                if (error) throw error;
                router.push(`/documents/${editId}`);
            } else {
                // Auto-folio: call SQL function via RPC
                const selType = types.find(t => t.id === typeId);
                if (!selType) throw new Error("Tipo no válido");
                const { data: folioData, error: folioErr } = await supabase.rpc("next_document_folio", { type_prefix: selType.prefix });
                if (folioErr) throw folioErr;
                const folio = (folioData as string) || `${selType.prefix}-001`;

                const { data, error } = await supabase.from("documents").insert([{
                    folio, type_id: typeId, title, keywords, objective, scope, definitions, responsibilities,
                    content, document_references: documentReferences, records,
                    effective_date: effectiveDate || null, next_review_date: nextReviewDate || null,
                    version, created_by: createdBy, status: "draft",
                }]).select().single();
                if (error) throw error;
                router.push(`/documents/${data.id}`);
            }
        } catch (e: any) {
            setErr(e?.message || "Error al guardar.");
        } finally { setBusy(false); }
    };

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-3 sm:p-6 md:p-8 lg:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-4xl mx-auto space-y-6">
                <header className="flex items-center gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <Link href="/documents" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors text-neutral-400 hover:text-white border border-neutral-700">
                        <ArrowLeft className="w-5 h-5" />
                    </Link>
                    <div>
                        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                            <BookOpen className="w-8 h-8 text-violet-400" />
                            {editId ? "Editar documento" : "Nuevo documento"}
                        </h1>
                        <p className="text-neutral-400 text-sm mt-1">Documento controlado según ISO 9001:2015 — sección 7.5.</p>
                    </div>
                </header>

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
                            <h2 className="text-lg font-semibold text-white">1) Identificación del documento</h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs text-neutral-400 ml-1">Tipo de documento *</label>
                                    <select value={typeId} onChange={e => setTypeId(e.target.value)} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500">
                                        {types.map(t => <option key={t.id} value={t.id}>{t.name} ({t.prefix})</option>)}
                                    </select>
                                    <p className="text-[10px] text-neutral-500 mt-1">El folio se genera automáticamente: {types.find(t => t.id === typeId)?.prefix || "—"}-XXX</p>
                                </div>
                                <div>
                                    <label className="text-xs text-neutral-400 ml-1">Versión inicial</label>
                                    <input value={version} onChange={e => setVersion(e.target.value)} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-violet-500" placeholder="1.0" />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs text-neutral-400 ml-1">Título *</label>
                                <input value={title} onChange={e => setTitle(e.target.value)} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500" placeholder="Ej. Procedimiento de control de calidad" />
                            </div>
                            <div>
                                <label className="text-xs text-neutral-400 ml-1">Autor / Creado por *</label>
                                <input value={createdBy} onChange={e => setCreatedBy(e.target.value)} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500" placeholder="Tu nombre" />
                            </div>
                            <div>
                                <label className="text-xs text-neutral-400 ml-1">Palabras clave (búsqueda)</label>
                                <input value={keywords} onChange={e => setKeywords(e.target.value)} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500" placeholder="calidad, soldadura, inspección..." />
                            </div>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="space-y-4">
                            <h2 className="text-lg font-semibold text-white">2) Contenido del documento (ISO 9001:2015)</h2>
                            <div>
                                <label className="text-xs text-neutral-400 ml-1">Objetivo</label>
                                <textarea value={objective} onChange={e => setObjective(e.target.value)} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500 min-h-[70px]" placeholder="¿Qué busca lograr este documento? Propósito principal." />
                            </div>
                            <div>
                                <label className="text-xs text-neutral-400 ml-1">Alcance</label>
                                <textarea value={scope} onChange={e => setScope(e.target.value)} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500 min-h-[70px]" placeholder="¿A qué aplica y a qué no? Límites del documento." />
                            </div>
                            <div>
                                <label className="text-xs text-neutral-400 ml-1">Definiciones / Glosario</label>
                                <textarea value={definitions} onChange={e => setDefinitions(e.target.value)} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500 min-h-[70px]" placeholder="Términos, acrónimos, definiciones clave." />
                            </div>
                            <div>
                                <label className="text-xs text-neutral-400 ml-1">Responsabilidades</label>
                                <textarea value={responsibilities} onChange={e => setResponsibilities(e.target.value)} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500 min-h-[70px]" placeholder="¿Quién hace qué? Roles y responsabilidades." />
                            </div>
                            <div>
                                <label className="text-xs text-neutral-400 ml-1">Desarrollo / Procedimiento *</label>
                                <textarea value={content} onChange={e => setContent(e.target.value)} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500 min-h-[200px] font-mono" placeholder="Describe paso a paso el procedimiento.&#10;&#10;1. ...&#10;2. ..." />
                                <p className="text-[10px] text-neutral-500 mt-1">Soporta texto plano con saltos de línea. Cada vez que edites este campo se guardará la versión anterior como snapshot.</p>
                            </div>
                            <div>
                                <label className="text-xs text-neutral-400 ml-1">Referencias documentales</label>
                                <textarea value={documentReferences} onChange={e => setDocumentReferences(e.target.value)} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500 min-h-[60px]" placeholder="Normas, otros documentos, legislación aplicable." />
                            </div>
                            <div>
                                <label className="text-xs text-neutral-400 ml-1">Registros asociados</label>
                                <textarea value={records} onChange={e => setRecords(e.target.value)} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500 min-h-[60px]" placeholder="Formularios, bitácoras, evidencias que genera este procedimiento." />
                            </div>
                        </div>
                    )}

                    {step === 3 && (
                        <div className="space-y-4">
                            <h2 className="text-lg font-semibold text-white">3) Vigencia y siguiente revisión</h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs text-neutral-400 ml-1">Fecha de vigencia (effective date)</label>
                                    <input value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} type="date" className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500" />
                                </div>
                                <div>
                                    <label className="text-xs text-neutral-400 ml-1">Próxima revisión</label>
                                    <input value={nextReviewDate} onChange={e => setNextReviewDate(e.target.value)} type="date" className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500" />
                                </div>
                            </div>
                            <div className="bg-violet-500/5 border border-violet-500/30 rounded-xl p-4 text-sm text-violet-200 space-y-2">
                                <p className="font-semibold">Resumen del documento</p>
                                <p><span className="text-violet-300/80">Folio:</span> {types.find(t => t.id === typeId)?.prefix}-XXX (auto)</p>
                                <p><span className="text-violet-300/80">Título:</span> {title || <em className="text-neutral-500">sin título</em>}</p>
                                <p><span className="text-violet-300/80">Versión:</span> {version}</p>
                                <p><span className="text-violet-300/80">Autor:</span> {createdBy || <em className="text-neutral-500">sin autor</em>}</p>
                                <p><span className="text-violet-300/80">Estatus inicial:</span> Borrador — se firmará después para pasar a Vigente.</p>
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
                        <button onClick={() => setStep(s => Math.min(3, s + 1))} className="flex items-center gap-1.5 bg-violet-500 hover:bg-violet-600 text-white px-5 py-2.5 rounded-xl font-medium text-sm">
                            Siguiente <ChevronRight className="w-4 h-4" />
                        </button>
                    ) : (
                        <button onClick={save} disabled={busy} className="flex items-center gap-1.5 bg-violet-500 hover:bg-violet-600 text-white px-6 py-2.5 rounded-xl font-bold text-sm disabled:opacity-50">
                            {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            {editId ? "Guardar cambios" : "Crear documento"}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function NewDocumentPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center"><RefreshCw className="w-8 h-8 animate-spin text-violet-400" /></div>}>
            <NewDocumentForm />
        </Suspense>
    );
}
