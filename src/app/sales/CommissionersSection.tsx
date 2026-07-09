"use client";

import { useEffect, useState } from "react";
import { useFieldArray, useWatch, type Control, type UseFormRegister } from "react-hook-form";
import { Plus, Trash2, Users } from "lucide-react";
import { fetchCommissionAgentNames } from "@/lib/commissioners";

// Sección reutilizable de "Comisionados" para la cotización normal y la rápida.
// Trabaja sobre el campo `commissioners` del formulario (arreglo de {name, amount}).
// El formulario que la incluye debe declarar ese campo en su schema/defaults.
export default function CommissionersSection({
    control,
    register,
}: {
    control: Control<any>;
    register: UseFormRegister<any>;
}) {
    const { fields, append, remove } = useFieldArray({ control, name: "commissioners" });
    const values = useWatch({ control, name: "commissioners" }) as
        | { name?: string; amount?: number }[]
        | undefined;
    const [agentNames, setAgentNames] = useState<string[]>([]);

    useEffect(() => {
        fetchCommissionAgentNames().then(setAgentNames);
    }, []);

    const total = (values || []).reduce((acc, c) => acc + (Number(c?.amount) || 0), 0);
    const formatCurrency = (n: number) =>
        new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);

    return (
        <div className="bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
            <div className="flex flex-wrap justify-between items-center gap-3 mb-2">
                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                    <Users className="w-5 h-5 text-purple-400" /> Comisionados
                    <span className="text-xs font-normal text-neutral-500">(opcional)</span>
                </h2>
                <button
                    type="button"
                    onClick={() => append({ name: "", amount: 0 })}
                    className="flex items-center gap-2 text-sm text-purple-300 hover:text-purple-200 font-medium bg-purple-500/10 hover:bg-purple-500/20 px-4 py-2 rounded-lg transition-colors border border-purple-500/20"
                >
                    <Plus className="w-4 h-4" /> Agregar comisionado
                </button>
            </div>
            <p className="text-xs text-neutral-500 mb-4">
                Agentes de ventas que se llevan parte de esta venta. Solo su nombre y el monto que le
                toca (uso interno — no aparece en el PDF del cliente).
            </p>

            {/* Nombres previamente usados para autocompletar */}
            <datalist id="commission-agents-list">
                {agentNames.map((n) => (
                    <option key={n} value={n} />
                ))}
            </datalist>

            {fields.length === 0 ? (
                <div className="text-sm text-neutral-500 bg-neutral-900/30 border border-dashed border-neutral-700/60 rounded-xl px-4 py-5 text-center">
                    Sin comisionados. Usa “Agregar comisionado” si esta cotización va comisionada.
                </div>
            ) : (
                <div className="space-y-3">
                    {fields.map((field, index) => (
                        <div
                            key={field.id}
                            className="grid grid-cols-1 md:grid-cols-[1fr_200px_auto] gap-3 items-end bg-neutral-900/30 p-3 rounded-xl border border-neutral-700/40"
                        >
                            <div className="space-y-1">
                                <label className="text-xs text-neutral-400 ml-1">Nombre del comisionado</label>
                                <input
                                    list="commission-agents-list"
                                    {...register(`commissioners.${index}.name` as const)}
                                    className="w-full bg-neutral-900/80 border border-neutral-700 rounded-lg px-3 py-2 text-white placeholder-neutral-600 focus:outline-none focus:ring-1 focus:border-purple-500 focus:ring-purple-500 transition-all"
                                    placeholder="Ej: Juan Pérez"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs text-purple-300 ml-1">Le toca ($)</label>
                                <input
                                    type="number"
                                    step="any"
                                    {...register(`commissioners.${index}.amount` as const, { valueAsNumber: true })}
                                    className="w-full bg-neutral-900/80 border border-purple-500/40 rounded-lg px-3 py-2 text-purple-200 focus:outline-none focus:ring-1 focus:border-purple-500 focus:ring-purple-500 transition-all"
                                    placeholder="0.00"
                                />
                            </div>
                            <button
                                type="button"
                                onClick={() => remove(index)}
                                className="text-neutral-500 hover:text-red-400 transition-colors p-2 rounded-lg hover:bg-neutral-800 md:mb-0.5"
                                title="Quitar comisionado"
                            >
                                <Trash2 className="w-5 h-5" />
                            </button>
                        </div>
                    ))}

                    <div className="flex justify-end items-center gap-3 pt-1 text-sm">
                        <span className="text-neutral-400">Total comisiones</span>
                        <span className="text-purple-300 font-bold">{formatCurrency(total)}</span>
                    </div>
                </div>
            )}
        </div>
    );
}
