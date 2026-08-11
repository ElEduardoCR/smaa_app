"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
    ArrowLeft, Save, RefreshCw, AlertCircle, ShieldAlert, Info
} from "lucide-react";
import { createPfmeaRiskAction } from "@/app/actions/pfmea";
import { twMerge } from "tailwind-merge";
import clsx from "clsx";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

type ScaleRow = { id: string; scale_type: string; level: number; label: string; description: string };

export default function NewRiskPage() {
    const router = useRouter();
    const search = useSearchParams();
    const editId = search?.get('edit') || null;

    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [scales, setScales] = useState<ScaleRow[]>([]);

    const [process, setProcess] = useState("");
    const [failureMode, setFailureMode] = useState("");
    const [effect, setEffect] = useState("");
    const [cause, setCause] = useState("");
    const [severity, setSeverity] = useState(3);
    const [occurrence, setOccurrence] = useState(3);
    const [detection, setDetection] = useState(3);
    const [currentControls, setCurrentControls] = useState("");
    const [recommendedActions, setRecommendedActions] = useState("");
    const [responsible, setResponsible] = useState("");
    const [targetDate, setTargetDate] = useState("");
    const [notes, setNotes] = useState("");

    useEffect(() => {
        (async () => {
            const { data } = await supabase.from('pfmea_scales').select('*').order('scale_type').order('level');
            setScales((data || []) as any);
        })();
    }, []);

    const rpn = severity * occurrence * detection;
    const sevDesc = scales.find(s => s.scale_type === 'severity' && s.level === severity);
    const occDesc = scales.find(s => s.scale_type === 'occurrence' && s.level === occurrence);
    const detDesc = scales.find(s => s.scale_type === 'detection' && s.level === detection);

    const submit = async () => {
        setErr(null);
        if (!process.trim()) return setErr("Indica el proceso / etapa.");
        if (!failureMode.trim()) return setErr("Indica el modo de falla.");
        if (!effect.trim()) return setErr("Indica el efecto.");
        if (!cause.trim()) return setErr("Indica la causa potencial.");

        setBusy(true);
        try {
            const { id } = await createPfmeaRiskAction({
                process: process.trim(),
                failure_mode: failureMode.trim(),
                effect: effect.trim(),
                cause: cause.trim(),
                severity, occurrence, detection,
                current_controls: currentControls.trim() || undefined,
                recommended_actions: recommendedActions.trim() || undefined,
                responsible: responsible.trim() || undefined,
                target_date: targetDate || null,
                notes: notes.trim() || undefined,
            });
            router.push(`/pfmea/${id}`);
        } catch (e: any) {
            setErr(e?.message || "Error al crear el riesgo.");
        } finally { setBusy(false); }
    };

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-3 sm:p-6 md:p-8 lg:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-4xl mx-auto space-y-6">
                <header className="flex items-center gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <Link href="/pfmea" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl text-neutral-400 hover:text-white border border-neutral-700">
                        <ArrowLeft className="w-5 h-5" />
                    </Link>
                    <div>
                        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                            <ShieldAlert className="w-8 h-8 text-orange-400" />
                            Nuevo riesgo PFMEA
                        </h1>
                        <p className="text-neutral-400 text-sm mt-1">
                            Calcula el RPN automáticamente. Las escalas se pueden consultar abajo.
                        </p>
                    </div>
                </header>

                {err && <div className="p-3 rounded-xl border bg-red-500/10 border-red-500/30 text-red-400 flex items-center gap-3"><AlertCircle className="w-5 h-5" /> {err}</div>}

                <div className="bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 space-y-4">
                    <h2 className="text-lg font-semibold text-white">Identificación</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs text-neutral-400 ml-1">Proceso / Etapa *</label>
                            <input value={process} onChange={e => setProcess(e.target.value)}
                                className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
                                placeholder="Ej. Maquinado CNC — Torneado" />
                        </div>
                        <div>
                            <label className="text-xs text-neutral-400 ml-1">Responsable</label>
                            <input value={responsible} onChange={e => setResponsible(e.target.value)}
                                className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
                                placeholder="Nombre o puesto" />
                        </div>
                    </div>
                    <div>
                        <label className="text-xs text-neutral-400 ml-1">Modo de falla potencial *</label>
                        <input value={failureMode} onChange={e => setFailureMode(e.target.value)}
                            className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
                            placeholder="¿Cómo puede fallar el proceso?" />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs text-neutral-400 ml-1">Efecto *</label>
                            <textarea value={effect} onChange={e => setEffect(e.target.value)}
                                className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500 min-h-[80px]"
                                placeholder="¿Qué consecuencia tiene en el cliente / proceso siguiente?" />
                        </div>
                        <div>
                            <label className="text-xs text-neutral-400 ml-1">Causa potencial *</label>
                            <textarea value={cause} onChange={e => setCause(e.target.value)}
                                className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500 min-h-[80px]"
                                placeholder="¿Por qué podría ocurrir?" />
                        </div>
                    </div>
                </div>

                {/* Escalas */}
                <div className="bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 space-y-4">
                    <h2 className="text-lg font-semibold text-white">Evaluación del riesgo</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <ScalePicker
                            title="Severidad" type="severity" color="rose"
                            value={severity} onChange={setSeverity} scales={scales} desc={sevDesc?.description}
                        />
                        <ScalePicker
                            title="Ocurrencia" type="occurrence" color="amber"
                            value={occurrence} onChange={setOccurrence} scales={scales} desc={occDesc?.description}
                        />
                        <ScalePicker
                            title="Detección" type="detection" color="cyan"
                            value={detection} onChange={setDetection} scales={scales} desc={detDesc?.description}
                        />
                    </div>

                    <div className="bg-neutral-900/60 border-2 border-orange-500/30 rounded-2xl p-5 mt-4 text-center">
                        <p className="text-[10px] uppercase font-semibold text-neutral-500 tracking-wider">Risk Priority Number</p>
                        <p className="text-5xl font-bold font-mono text-orange-300 mt-1">{rpn}</p>
                        <p className="text-xs text-neutral-400 mt-1">
                            {severity} × {occurrence} × {detection}
                            {rpn >= 50 && <span className="ml-2 text-rose-300 font-semibold">— Crítico</span>}
                            {rpn >= 25 && rpn < 50 && <span className="ml-2 text-orange-300 font-semibold">— Alto</span>}
                            {rpn >= 10 && rpn < 25 && <span className="ml-2 text-amber-300 font-semibold">— Medio</span>}
                            {rpn < 10 && <span className="ml-2 text-emerald-300 font-semibold">— Bajo</span>}
                        </p>
                    </div>
                </div>

                <div className="bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 space-y-4">
                    <h2 className="text-lg font-semibold text-white">Plan de acción</h2>
                    <div>
                        <label className="text-xs text-neutral-400 ml-1">Controles actuales</label>
                        <textarea value={currentControls} onChange={e => setCurrentControls(e.target.value)}
                            className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500 min-h-[70px]"
                            placeholder="¿Qué controles existen hoy? (si los hay)" />
                    </div>
                    <div>
                        <label className="text-xs text-neutral-400 ml-1">Acciones recomendadas</label>
                        <textarea value={recommendedActions} onChange={e => setRecommendedActions(e.target.value)}
                            className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500 min-h-[100px]"
                            placeholder="¿Qué se debería hacer para reducir el RPN?" />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs text-neutral-400 ml-1">Fecha objetivo</label>
                            <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)}
                                className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500" />
                        </div>
                    </div>
                    <div>
                        <label className="text-xs text-neutral-400 ml-1">Notas</label>
                        <textarea value={notes} onChange={e => setNotes(e.target.value)}
                            className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500 min-h-[60px]" />
                    </div>
                </div>

                <div className="flex justify-end gap-2">
                    <Link href="/pfmea" className="px-4 py-2 text-sm text-neutral-300 hover:text-white">Cancelar</Link>
                    <button onClick={submit} disabled={busy}
                        className="bg-orange-500 hover:bg-orange-600 text-white px-6 py-2.5 rounded-xl font-bold text-sm disabled:opacity-50 inline-flex items-center gap-1.5">
                        {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Crear riesgo
                    </button>
                </div>
            </div>
        </div>
    );
}

function ScalePicker({ title, type, color, value, onChange, scales, desc }: {
    title: string; type: string; color: 'rose' | 'amber' | 'cyan';
    value: number; onChange: (v: number) => void; scales: ScaleRow[]; desc?: string;
}) {
    const items = scales.filter(s => s.scale_type === type);
    const colorMap = {
        rose:  { bg: 'bg-rose-500/20',  text: 'text-rose-300',  border: 'border-rose-500/50',  active: 'border-rose-500 bg-rose-500/30' },
        amber: { bg: 'bg-amber-500/20', text: 'text-amber-300', border: 'border-amber-500/50', active: 'border-amber-500 bg-amber-500/30' },
        cyan:  { bg: 'bg-cyan-500/20',  text: 'text-cyan-300',  border: 'border-cyan-500/50',  active: 'border-cyan-500 bg-cyan-500/30' },
    }[color];

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <h3 className={cn("text-sm font-semibold", colorMap.text)}>{title}</h3>
                <span className={cn("text-2xl font-bold font-mono", colorMap.text)}>{value}</span>
            </div>
            <div className="space-y-1">
                {items.map(s => (
                    <button key={s.id} type="button" onClick={() => onChange(s.level)}
                        className={cn("w-full text-left p-2 rounded-lg border transition-all text-xs",
                            value === s.level
                                ? colorMap.active
                                : "bg-neutral-900/40 border-neutral-700/40 hover:border-neutral-600 text-neutral-300"
                        )}>
                        <span className="font-bold text-sm">{s.level}. {s.label}</span>
                        <p className="text-[10px] text-neutral-500 mt-0.5">{s.description}</p>
                    </button>
                ))}
            </div>
            {desc && <p className="text-[10px] text-neutral-500 italic flex items-start gap-1"><Info className="w-3 h-3 mt-0.5" /> {desc}</p>}
        </div>
    );
}
