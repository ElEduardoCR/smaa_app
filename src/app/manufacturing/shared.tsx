"use client";

// Piezas de presentación compartidas por la lista, el detalle, el alta y
// garantías de fabricación.

import { Cog, Flame, Cpu, Factory, Lock, ChevronUp, ChevronDown, X, Plus } from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

export const PROCESS_ICONS: Record<string, React.ComponentType<{ className?: string }>> = { Cog, Flame, Cpu };
export function ProcessIcon({ icon, className }: { icon?: string | null; className?: string }) {
    const Icon = (icon && PROCESS_ICONS[icon]) || Factory;
    return <Icon className={className} />;
}

export const PROCESS_COLOR: Record<string, { text: string; pill: string; bar: string }> = {
    maquinado: { text: "text-orange-300", pill: "bg-orange-500/10 text-orange-300 border-orange-500/30", bar: "bg-orange-500" },
    soldadura: { text: "text-amber-300", pill: "bg-amber-500/10 text-amber-300 border-amber-500/30", bar: "bg-amber-500" },
    automatizacion: { text: "text-cyan-300", pill: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30", bar: "bg-cyan-500" },
};
export const processColor = (code: string) => PROCESS_COLOR[code] || PROCESS_COLOR.maquinado;

export const STATUS_LABEL: Record<string, string> = {
    "Open": "Abierta",
    "In Progress": "En curso",
    "Paused": "Pausada",
    "Completed": "Terminada",
    "QC": "En calidad",
    "QC_Released": "Liberada",
    "Cancelled": "Cancelada",
};
export const STATUS_STYLE: Record<string, string> = {
    "Open": "bg-orange-500/10 text-orange-300 border-orange-500/30",
    "In Progress": "bg-sky-500/10 text-sky-300 border-sky-500/30",
    "Paused": "bg-amber-500/10 text-amber-300 border-amber-500/30",
    "Completed": "bg-violet-500/10 text-violet-300 border-violet-500/30",
    "QC": "bg-yellow-500/10 text-yellow-300 border-yellow-500/30",
    "QC_Released": "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
    "Cancelled": "bg-red-500/10 text-red-300 border-red-500/30",
};
export const STAGE_STATUS_LABEL: Record<string, string> = {
    "Pending": "Pendiente",
    "In Progress": "En curso",
    "Paused": "Pausada",
    "Done": "Terminada",
};
export const KIND_LABEL: Record<string, string> = { normal: "", garantia: "Garantía", reparacion: "Reparación" };

/** 2.00 → "2", 2.50 → "2.5" */
export function qty(value: number | string | null | undefined): string {
    const n = Number(value) || 0;
    return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export type StageSummary = {
    stage_id: string; module_code: string; module_name: string; sequence: number; status: string;
    qty_done: number; qty_available: number; is_final: boolean;
};

export type OrderProgress = {
    work_order_id: string; qty_target: number; qty_fabricated: number; qty_pending_qc: number; qty_released: number;
    qty_rejected: number; qty_delivered: number; qty_in_delivery: number; qty_deliverable: number; stage_count: number;
    stages: StageSummary[];
};

export function StageChain({ stages, target, compact = false }: { stages: StageSummary[]; target: number; compact?: boolean }) {
    if (!stages.length) return <span className="text-xs text-neutral-500 italic">Sin etapas</span>;
    return (
        <div className="flex flex-wrap items-center gap-1">
            {stages.map((stage, index) => {
                const color = processColor(stage.module_code);
                return (
                    <span key={stage.stage_id} className="inline-flex items-center gap-1">
                        {index > 0 && <span className="text-neutral-600 text-[10px]">→</span>}
                        <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded border whitespace-nowrap", color.pill, stage.status === "Done" && "opacity-70")}
                            title={`${stage.module_name}: ${qty(stage.qty_done)} de ${qty(target)} · ${STAGE_STATUS_LABEL[stage.status] || stage.status}`}>
                            {compact ? stage.module_name.slice(0, 4) : stage.module_name} {qty(stage.qty_done)}/{qty(target)}
                        </span>
                    </span>
                );
            })}
        </div>
    );
}

export function ProgressBar({ value, total, className }: { value: number; total: number; className?: string }) {
    const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
    return (
        <div className="h-1.5 w-full rounded-full bg-neutral-700/60 overflow-hidden">
            <div className={cn("h-full rounded-full bg-emerald-500 transition-all", className)} style={{ width: `${pct}%` }} />
        </div>
    );
}

export type ModuleRow = { id: string; code: string; name: string; icon: string };

/** Lista ordenada de etapas: agregar, quitar y reordenar (las primeras `lockedCount` no se tocan). */
export function StagePicker({ modules, value, onChange, lockedCount = 0 }: { modules: ModuleRow[]; value: string[]; onChange: (ids: string[]) => void; lockedCount?: number }) {
    const byId = new Map(modules.map((m) => [m.id, m]));
    const move = (index: number, delta: number) => {
        const next = [...value];
        const target = index + delta;
        if (target < lockedCount || target >= next.length) return;
        [next[index], next[target]] = [next[target], next[index]];
        onChange(next);
    };
    return (
        <div className="space-y-2">
            <ol className="space-y-1.5">
                {value.map((id, index) => {
                    const m = byId.get(id);
                    const locked = index < lockedCount;
                    return (
                        <li key={`${id}-${index}`} className={cn("flex items-center gap-2 rounded-lg border px-3 py-2", processColor(m?.code || "").pill)}>
                            <span className="text-xs font-bold w-5">{index + 1}.</span>
                            <ProcessIcon icon={m?.icon} className="w-4 h-4" />
                            <span className="flex-1 text-sm">{m?.name || "Etapa"}</span>
                            {locked ? <span className="text-[10px] text-neutral-400 flex items-center gap-1"><Lock className="w-3 h-3" /> con actividad</span> : (
                                <>
                                    <button type="button" onClick={() => move(index, -1)} disabled={index <= lockedCount} className="p-1 disabled:opacity-30" title="Subir"><ChevronUp className="w-4 h-4" /></button>
                                    <button type="button" onClick={() => move(index, 1)} disabled={index === value.length - 1} className="p-1 disabled:opacity-30" title="Bajar"><ChevronDown className="w-4 h-4" /></button>
                                    <button type="button" onClick={() => onChange(value.filter((_, i) => i !== index))} className="p-1 hover:text-red-300" title="Quitar"><X className="w-4 h-4" /></button>
                                </>
                            )}
                        </li>
                    );
                })}
            </ol>
            <div className="flex flex-wrap gap-2">
                {modules.map((m) => (
                    <button key={m.id} type="button" onClick={() => onChange([...value, m.id])} className="text-xs px-3 py-1.5 rounded-lg border border-neutral-600 text-neutral-200 hover:bg-neutral-800 flex items-center gap-1.5">
                        <Plus className="w-3.5 h-3.5" /> {m.name}
                    </button>
                ))}
            </div>
        </div>
    );
}
