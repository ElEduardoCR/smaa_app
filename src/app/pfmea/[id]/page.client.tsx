"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
    ArrowLeft, RefreshCw, Save, AlertCircle, Trash2, CheckCircle2, ShieldAlert, Info
} from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";
import { updatePfmeaRiskAction, softDeletePfmeaRiskAction, closePfmeaRiskAction } from "@/app/actions/pfmea";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

type Risk = {
    id: string;
    process: string;
    failure_mode: string;
    effect: string;
    cause: string;
    severity: number;
    occurrence: number;
    detection: number;
    rpn: number;
    current_controls: string | null;
    recommended_actions: string | null;
    responsible: string | null;
    target_date: string | null;
    status: 'open' | 'in_progress' | 'closed';
    notes: string | null;
    created_at: string;
    updated_at: string;
};

type Scale = { id: string; scale_type: string; level: number; label: string; description: string };

function rpnClass(rpn: number) {
    if (rpn >= 50) return { label: 'Crítico', chip: 'bg-rose-500/20 text-rose-200 border-rose-500/50' };
    if (rpn >= 25) return { label: 'Alto',    chip: 'bg-orange-500/20 text-orange-200 border-orange-500/50' };
    if (rpn >= 10) return { label: 'Medio',   chip: 'bg-amber-500/20 text-amber-200 border-amber-500/50' };
    return                  { label: 'Bajo',    chip: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/50' };
}

export default function RiskDetailPage({ id }: { id: string }) {
    const router = useRouter();
    const [risk, setRisk] = useState<Risk | null>(null);
    const [scales, setScales] = useState<Scale[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [ok, setOk] = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        try {
            const [{ data }, { data: sc }] = await Promise.all([
                supabase.from('pfmea_risks').select('*').eq('id', id).single(),
                supabase.from('pfmea_scales').select('*').order('scale_type').order('level'),
            ]);
            if (!data) throw new Error('Riesgo no encontrado');
            setRisk(data as any);
            setScales((sc || []) as any);
        } catch (e: any) { setErr(e?.message || 'Error'); }
        finally { setLoading(false); }
    };
    useEffect(() => { load(); }, [id]);

    const update = async (patch: Record<string, any>) => {
        if (!risk) return;
        // Convert null to undefined for the action type
        const cleaned: Record<string, any> = {};
        for (const [k, v] of Object.entries(patch)) {
            cleaned[k] = v === null ? undefined : v;
        }
        setBusy(true);
        setErr(null); setOk(null);
        try {
            await updatePfmeaRiskAction(id, cleaned as any);
            setOk('Guardado.');
            await load();
        } catch (e: any) { setErr(e?.message || 'Error'); }
        finally { setBusy(false); }
    };

    const doClose = async () => {
        if (!confirm('¿Marcar este riesgo como CERRADO? Puedes reabrirlo cambiando el estado después.')) return;
        setBusy(true);
        try {
            await closePfmeaRiskAction(id);
            await load();
        } catch (e: any) { setErr(e?.message || 'Error'); }
        finally { setBusy(false); }
    };

    const doDelete = async () => {
        if (!confirm('¿Eliminar este riesgo? (soft-delete, queda en el historial)')) return;
        setBusy(true);
        try {
            await softDeletePfmeaRiskAction(id);
            router.push('/pfmea');
        } catch (e: any) { setErr(e?.message || 'Error'); }
        finally { setBusy(false); }
    };

    if (loading) return <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center"><RefreshCw className="w-8 h-8 animate-spin text-orange-400" /></div>;
    if (!risk) return <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 flex items-center justify-center">Riesgo no encontrado.</div>;

    const rc = rpnClass(risk.rpn);
    const sevDesc = scales.find(s => s.scale_type === 'severity' && s.level === risk.severity);
    const occDesc = scales.find(s => s.scale_type === 'occurrence' && s.level === risk.occurrence);
    const detDesc = scales.find(s => s.scale_type === 'detection' && s.level === risk.detection);

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-3 sm:p-6 md:p-8 lg:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-4xl mx-auto space-y-6">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50">
                    <div className="flex items-center gap-4">
                        <Link href="/pfmea" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl text-neutral-400 hover:text-white border border-neutral-700">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div>
                            <h1 className="text-2xl font-bold text-white">{risk.process}</h1>
                            <p className="text-sm text-neutral-400 mt-1">{risk.failure_mode}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <select value={risk.status} onChange={e => update({ status: e.target.value as any })} disabled={busy}
                            className="bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500">
                            <option value="open">Abierto</option>
                            <option value="in_progress">En progreso</option>
                            <option value="closed">Cerrado</option>
                        </select>
                        {risk.status !== 'closed' && (
                            <button onClick={doClose} disabled={busy} className="text-sm bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-2 rounded-lg font-semibold inline-flex items-center gap-1.5">
                                <CheckCircle2 className="w-4 h-4" /> Cerrar
                            </button>
                        )}
                        <button onClick={doDelete} disabled={busy} className="text-sm bg-rose-500/10 hover:bg-rose-500/20 text-rose-200 border border-rose-500/30 px-3 py-2 rounded-lg inline-flex items-center gap-1.5">
                            <Trash2 className="w-4 h-4" /> Eliminar
                        </button>
                    </div>
                </header>

                {err && <div className="p-3 rounded-xl border bg-red-500/10 border-red-500/30 text-red-400 flex items-center gap-3"><AlertCircle className="w-5 h-5" /> {err}</div>}
                {ok && <div className="p-3 rounded-xl border bg-emerald-500/10 border-emerald-500/30 text-emerald-300 flex items-center gap-3"><CheckCircle2 className="w-5 h-5" /> {ok}</div>}

                {/* RPN destacado */}
                <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-5 text-center">
                    <p className="text-[10px] uppercase font-semibold text-neutral-500 tracking-wider">RPN actual</p>
                    <p className="text-6xl font-bold font-mono text-orange-300 mt-1">{risk.rpn}</p>
                    <p className={cn("text-sm font-semibold mt-1 px-2 py-0.5 rounded inline-block border", rc.chip)}>{rc.label}</p>
                    <p className="text-xs text-neutral-400 mt-2">{risk.severity} × {risk.occurrence} × {risk.detection}</p>
                </div>

                <div className="bg-neutral-800/40 p-5 rounded-2xl border border-neutral-700/50 space-y-3">
                    <h2 className="text-sm font-semibold text-white">Descripción</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                        <div><p className="text-neutral-500 text-xs">Modo de falla</p><p className="text-neutral-200">{risk.failure_mode}</p></div>
                        <div><p className="text-neutral-500 text-xs">Efecto</p><p className="text-neutral-200">{risk.effect}</p></div>
                        <div className="md:col-span-2"><p className="text-neutral-500 text-xs">Causa potencial</p><p className="text-neutral-200">{risk.cause}</p></div>
                    </div>
                </div>

                <div className="bg-neutral-800/40 p-5 rounded-2xl border border-neutral-700/50 space-y-4">
                    <h2 className="text-sm font-semibold text-white">Evaluación</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <ScaleBox title="Severidad"   color="rose"  value={risk.severity}   desc={sevDesc?.description} />
                        <ScaleBox title="Ocurrencia"  color="amber" value={risk.occurrence} desc={occDesc?.description} />
                        <ScaleBox title="Detección"   color="cyan"  value={risk.detection}  desc={detDesc?.description} />
                    </div>
                    <p className="text-[10px] text-neutral-500 italic flex items-start gap-1">
                        <Info className="w-3 h-3 mt-0.5" /> Para cambiar las escalas, edita el riesgo desde el botón Editar (próximamente) o créalo de nuevo con la nueva evaluación.
                    </p>
                </div>

                <div className="bg-neutral-800/40 p-5 rounded-2xl border border-neutral-700/50 space-y-3">
                    <h2 className="text-sm font-semibold text-white">Plan de acción</h2>
                    <Editable label="Controles actuales" value={risk.current_controls || ''} onSave={v => update({ current_controls: v })} multiline />
                    <Editable label="Acciones recomendadas" value={risk.recommended_actions || ''} onSave={v => update({ recommended_actions: v })} multiline />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <Editable label="Responsable" value={risk.responsible || ''} onSave={v => update({ responsible: v })} />
                        <Editable label="Fecha objetivo" value={risk.target_date || ''} onSave={v => update({ target_date: v || null })} type="date" />
                    </div>
                </div>

                {risk.notes && (
                    <div className="bg-neutral-800/40 p-5 rounded-2xl border border-neutral-700/50">
                        <h2 className="text-sm font-semibold text-white mb-2">Notas</h2>
                        <pre className="text-sm text-neutral-300 whitespace-pre-wrap font-sans">{risk.notes}</pre>
                    </div>
                )}
            </div>
        </div>
    );
}

function ScaleBox({ title, color, value, desc }: { title: string; color: 'rose' | 'amber' | 'cyan'; value: number; desc?: string }) {
    const colorMap = {
        rose:  'text-rose-300',
        amber: 'text-amber-300',
        cyan:  'text-cyan-300',
    }[color];
    return (
        <div className="bg-neutral-900/40 border border-neutral-700/30 rounded-xl p-3">
            <p className="text-xs text-neutral-500">{title}</p>
            <p className={cn("text-3xl font-bold font-mono", colorMap)}>{value}</p>
            {desc && <p className="text-[10px] text-neutral-500 mt-1">{desc}</p>}
        </div>
    );
}

function Editable({ label, value, onSave, multiline, type }: { label: string; value: string; onSave: (v: string) => void | Promise<void>; multiline?: boolean; type?: string }) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value);
    const [saving, setSaving] = useState(false);

    const save = async () => {
        setSaving(true);
        try { await onSave(draft); setEditing(false); }
        finally { setSaving(false); }
    };

    if (editing) {
        return (
            <div>
                <label className="text-xs text-neutral-400 ml-1">{label}</label>
                {multiline ? (
                    <textarea value={draft} onChange={e => setDraft(e.target.value)}
                        className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500 min-h-[80px]" />
                ) : (
                    <input type={type || 'text'} value={draft} onChange={e => setDraft(e.target.value)}
                        className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500" />
                )}
                <div className="flex justify-end gap-2 mt-2">
                    <button onClick={() => { setEditing(false); setDraft(value); }} className="text-xs px-3 py-1.5 text-neutral-300 hover:text-white">Cancelar</button>
                    <button onClick={save} disabled={saving}
                        className="text-xs bg-orange-500 hover:bg-orange-600 text-white px-3 py-1.5 rounded-md font-semibold inline-flex items-center gap-1">
                        <Save className="w-3 h-3" /> Guardar
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div>
            <p className="text-xs text-neutral-500">{label}</p>
            <div className="flex items-start gap-2">
                <p className="text-sm text-neutral-200 flex-1 whitespace-pre-wrap">{value || <em className="text-neutral-500">sin definir</em>}</p>
                <button onClick={() => { setDraft(value); setEditing(true); }}
                    className="text-[10px] text-orange-400 hover:text-orange-300">editar</button>
            </div>
        </div>
    );
}
