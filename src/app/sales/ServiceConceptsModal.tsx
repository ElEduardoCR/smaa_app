"use client";

import { useState } from "react";
import { X, Plus, Trash2, Clock } from "lucide-react";
import clsx from "clsx";

export type ServiceConcept = { concept: string; rate: number; hours: number };

// Conceptos de servicio predefinidos (mano de obra por hora). "Otro" se agrega aparte.
export const PREDEFINED_CONCEPTS = [
    "Soldadura",
    "Diseño",
    "Maquinado",
    "Mano de obra",
    "Viáticos",
    "Instalación en planta",
];

type Row = { key: string; concept: string; rate: number | string; hours: number | string; custom: boolean };

function uid() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);

export default function ServiceConceptsModal({
    initialConcepts,
    onSave,
    onClose,
}: {
    initialConcepts: ServiceConcept[];
    onSave: (concepts: ServiceConcept[]) => void;
    onClose: () => void;
}) {
    const [rows, setRows] = useState<Row[]>(() =>
        (initialConcepts || []).map((c) => ({
            key: uid(),
            concept: c.concept,
            rate: c.rate,
            hours: c.hours,
            custom: !PREDEFINED_CONCEPTS.includes(c.concept),
        }))
    );

    const activePredefined = new Set(rows.filter((r) => !r.custom).map((r) => r.concept));

    const togglePredefined = (label: string) => {
        setRows((prev) =>
            activePredefined.has(label)
                ? prev.filter((r) => !(r.concept === label && !r.custom))
                : [...prev, { key: uid(), concept: label, rate: "", hours: "", custom: false }]
        );
    };

    const addCustom = () =>
        setRows((prev) => [...prev, { key: uid(), concept: "", rate: "", hours: "", custom: true }]);

    const updateRow = (key: string, field: "concept" | "rate" | "hours", value: string) =>
        setRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));

    const removeRow = (key: string) => setRows((prev) => prev.filter((r) => r.key !== key));

    const rowAmount = (r: Row) => (Number(r.rate) || 0) * (Number(r.hours) || 0);
    const total = rows.reduce((a, r) => a + rowAmount(r), 0);

    const handleSave = () => {
        const cleaned = rows
            .filter((r) => r.concept.trim() !== "")
            .map((r) => ({ concept: r.concept.trim(), rate: Number(r.rate) || 0, hours: Number(r.hours) || 0 }));
        onSave(cleaned);
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm font-[family-name:var(--font-sans)]"
            onClick={onClose}
        >
            <div
                className="bg-neutral-900 border border-neutral-700 rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-neutral-800 sticky top-0 bg-neutral-900 rounded-t-3xl z-10">
                    <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-2xl bg-emerald-500/15 flex items-center justify-center">
                            <Clock className="w-5 h-5 text-emerald-400" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-white">Conceptos del servicio</h3>
                            <p className="text-xs text-neutral-400">Selecciona conceptos y captura rate por hora × horas.</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    {/* Conceptos predefinidos */}
                    <div>
                        <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">Conceptos</p>
                        <div className="flex flex-wrap gap-2">
                            {PREDEFINED_CONCEPTS.map((label) => {
                                const active = activePredefined.has(label);
                                return (
                                    <button
                                        key={label}
                                        type="button"
                                        onClick={() => togglePredefined(label)}
                                        className={clsx(
                                            "px-3 py-2 rounded-lg text-sm font-medium border transition-colors",
                                            active
                                                ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-300"
                                                : "bg-neutral-800/60 border-neutral-700 text-neutral-300 hover:border-neutral-500"
                                        )}
                                    >
                                        {active ? "✓ " : "+ "}
                                        {label}
                                    </button>
                                );
                            })}
                            <button
                                type="button"
                                onClick={addCustom}
                                className="px-3 py-2 rounded-lg text-sm font-medium border border-dashed border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 transition-colors flex items-center gap-1"
                            >
                                <Plus className="w-4 h-4" /> Otro
                            </button>
                        </div>
                    </div>

                    {/* Filas seleccionadas */}
                    {rows.length === 0 ? (
                        <div className="text-center text-neutral-500 text-sm py-8 border border-dashed border-neutral-800 rounded-xl">
                            Selecciona un concepto o agrega uno con “Otro”.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className="hidden sm:grid grid-cols-12 gap-3 text-[11px] font-semibold text-neutral-500 uppercase tracking-wider px-1">
                                <div className="col-span-5">Concepto</div>
                                <div className="col-span-3">Rate / hora ($)</div>
                                <div className="col-span-2">Horas</div>
                                <div className="col-span-2 text-right">Importe</div>
                            </div>
                            {rows.map((r) => (
                                <div key={r.key} className="grid grid-cols-2 sm:grid-cols-12 gap-3 items-center bg-neutral-800/40 p-3 rounded-xl border border-neutral-700/40">
                                    <div className="col-span-2 sm:col-span-5">
                                        {r.custom ? (
                                            <input
                                                value={r.concept}
                                                onChange={(e) => updateRow(r.key, "concept", e.target.value)}
                                                placeholder="Concepto personalizado"
                                                className="w-full bg-neutral-900/80 border border-neutral-700 rounded-lg px-3 py-2 text-white placeholder-neutral-600 text-sm focus:outline-none focus:border-emerald-500"
                                            />
                                        ) : (
                                            <span className="text-white text-sm font-medium">{r.concept}</span>
                                        )}
                                    </div>
                                    <div className="col-span-1 sm:col-span-3">
                                        <input
                                            type="number"
                                            step="any"
                                            min="0"
                                            value={r.rate}
                                            onChange={(e) => updateRow(r.key, "rate", e.target.value)}
                                            placeholder="0.00"
                                            className="w-full bg-neutral-900/80 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
                                        />
                                    </div>
                                    <div className="col-span-1 sm:col-span-2">
                                        <input
                                            type="number"
                                            step="any"
                                            min="0"
                                            value={r.hours}
                                            onChange={(e) => updateRow(r.key, "hours", e.target.value)}
                                            placeholder="0"
                                            className="w-full bg-neutral-900/80 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
                                        />
                                    </div>
                                    <div className="col-span-2 sm:col-span-2 flex items-center justify-between sm:justify-end gap-2">
                                        <span className="text-sm font-semibold text-emerald-400">{fmt(rowAmount(r))}</span>
                                        <button
                                            type="button"
                                            onClick={() => removeRow(r.key)}
                                            className="text-neutral-500 hover:text-red-400 p-1 rounded transition-colors"
                                            title="Quitar"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between gap-4 p-6 border-t border-neutral-800 sticky bottom-0 bg-neutral-900 rounded-b-3xl">
                    <div className="text-sm text-neutral-400">
                        Total servicio: <span className="text-lg font-bold text-emerald-400">{fmt(total)}</span>
                    </div>
                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-5 py-2.5 rounded-xl border border-neutral-700 text-neutral-300 hover:bg-neutral-800 transition-colors text-sm font-medium"
                        >
                            Cancelar
                        </button>
                        <button
                            type="button"
                            onClick={handleSave}
                            className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold transition-colors text-sm"
                        >
                            Guardar conceptos
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
