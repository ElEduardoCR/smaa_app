"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Car, Plus, RefreshCw, AlertTriangle, Droplets, Gauge, X } from "lucide-react";
import { listVehiclesAction, saveVehicleAction, type VehicleSummary } from "@/app/actions/vehicles";
import { DOCUMENT_TYPES, FUEL_TYPES, labelOf } from "@/lib/vehicles/catalog";
import { matchesSearch } from "@/lib/search";

export const money = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
export const km = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n.toLocaleString("es-MX")} km`);
export const shortDate = (d: string | null | undefined) => {
    if (!d) return "—";
    const [y, m, day] = d.slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, day).toLocaleDateString("es-MX", { dateStyle: "medium" });
};

export const OIL_LABEL: Record<string, { text: string; className: string }> = {
    sin_registro: { text: "Sin registro de aceite", className: "border-neutral-600 text-neutral-400" },
    al_corriente: { text: "Aceite al corriente", className: "border-emerald-500/40 text-emerald-300" },
    proximo: { text: "Cambio de aceite próximo", className: "border-amber-500/40 text-amber-300" },
    vencido: { text: "Cambio de aceite vencido", className: "border-red-500/40 text-red-300" },
};

export default function VehiclesClient() {
    const router = useRouter();
    const [vehicles, setVehicles] = useState<VehicleSummary[]>([]);
    const [canCreate, setCanCreate] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [search, setSearch] = useState("");
    const [showInactive, setShowInactive] = useState(false);
    const [creating, setCreating] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const result = await listVehiclesAction();
            setVehicles(result.vehicles);
            setCanCreate(result.canCreate);
        } catch (e) {
            setError(e instanceof Error ? e.message : "No se pudieron cargar los vehículos.");
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { load(); }, [load]);

    const visible = useMemo(() => vehicles.filter((v) => (showInactive || v.is_active)
        && matchesSearch(search, v.alias, v.brand, v.model, v.plates, v.responsible, v.year)), [vehicles, search, showInactive]);
    const totalYear = vehicles.filter((v) => v.is_active).reduce((sum, v) => sum + v.spend.year, 0);
    const alerts = vehicles.filter((v) => v.is_active && (v.alerts.length > 0 || ["proximo", "vencido"].includes(v.oil.state))).length;

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-3 sm:p-6 md:p-8 lg:p-10">
            <div className="max-w-[1600px] mx-auto space-y-6">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl text-neutral-400 hover:text-white border border-neutral-700"><ArrowLeft className="w-5 h-5" /></Link>
                        <div>
                            <h1 className="text-3xl font-bold text-white flex items-center gap-3"><Car className="w-8 h-8 text-cyan-400" /> Vehículos</h1>
                            <p className="text-neutral-400 text-sm mt-1">Expediente de cada unidad: fotos, seguros y pólizas, tarjeta de circulación, servicios y gastos.</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={load} className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg" title="Actualizar"><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /></button>
                        {canCreate && <button onClick={() => setCreating(true)} className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-500 text-white px-5 py-2.5 rounded-xl font-medium"><Plus className="w-5 h-5" /> Nuevo vehículo</button>}
                    </div>
                </header>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-w-3xl">
                    <Tile label="Unidades activas" value={String(vehicles.filter((v) => v.is_active).length)} />
                    <Tile label="Gasto del año" value={money(totalYear)} />
                    <Tile label="Con pendientes" value={String(alerts)} tone={alerts ? "amber" : undefined} />
                </div>

                <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre, placas, marca o responsable…" className="flex-1 rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-white" />
                    <label className="text-sm text-neutral-400 flex items-center gap-2"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Mostrar dados de baja</label>
                </div>
                {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}

                {loading ? <div className="p-12 text-center text-neutral-400"><RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-cyan-400" /> Cargando…</div>
                    : visible.length === 0 ? <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl p-12 text-center text-neutral-400"><Car className="w-10 h-10 mx-auto mb-3 opacity-40" />{vehicles.length ? "Sin resultados." : "Aún no hay vehículos registrados."}</div>
                    : (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                            {visible.map((v) => (
                                <Link key={v.id} href={`/vehicles/${v.id}`} className={`group bg-neutral-800/40 border border-neutral-700/50 rounded-2xl overflow-hidden hover:border-cyan-500/50 transition-colors ${v.is_active ? "" : "opacity-60"}`}>
                                    <div className="h-40 bg-neutral-900/60 flex items-center justify-center overflow-hidden">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        {v.coverUrl ? <img src={v.coverUrl} alt={v.alias} className="w-full h-full object-cover" /> : <Car className="w-14 h-14 text-neutral-600" />}
                                    </div>
                                    <div className="p-4 space-y-2">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <p className="text-white font-semibold truncate">{v.alias}</p>
                                                <p className="text-xs text-neutral-400 truncate">{[v.brand, v.model, v.year].filter(Boolean).join(" · ") || "—"}</p>
                                            </div>
                                            {v.plates && <span className="font-mono text-xs text-cyan-200 bg-cyan-500/10 border border-cyan-500/30 px-2 py-0.5 rounded">{v.plates}</span>}
                                        </div>
                                        <p className="text-xs text-neutral-400 flex items-center gap-1.5"><Gauge className="w-3.5 h-3.5" /> {km(v.odometer_km)}{v.responsible ? ` · ${v.responsible}` : ""}</p>
                                        <div className="flex flex-wrap gap-1.5">
                                            <span className={`text-[10px] px-2 py-0.5 rounded-full border flex items-center gap-1 ${OIL_LABEL[v.oil.state].className}`}><Droplets className="w-3 h-3" /> {OIL_LABEL[v.oil.state].text}</span>
                                            {v.alerts.map((a) => (
                                                <span key={a.id} className={`text-[10px] px-2 py-0.5 rounded-full border flex items-center gap-1 ${a.state === "vencido" ? "border-red-500/40 text-red-300" : "border-amber-500/40 text-amber-300"}`}>
                                                    <AlertTriangle className="w-3 h-3" /> {labelOf(DOCUMENT_TYPES, a.docType)} {a.state === "vencido" ? "vencido" : `vence en ${a.days} d`}
                                                </span>
                                            ))}
                                        </div>
                                        <p className="text-xs text-neutral-500">Gasto: {money(v.spend.month)} este mes · {money(v.spend.year)} este año</p>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    )}
            </div>
            {creating && <VehicleFormModal onClose={() => setCreating(false)} onSaved={(id) => router.push(`/vehicles/${id}`)} />}
        </div>
    );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "amber" }) {
    return (
        <div className="bg-neutral-800/40 rounded-xl border border-neutral-700/50 p-3">
            <p className={`text-xl font-bold tabular-nums ${tone === "amber" ? "text-amber-300" : "text-white"}`}>{value}</p>
            <p className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</p>
        </div>
    );
}

export type VehicleFormValues = {
    id?: string; alias: string; brand: string; model: string; year: string; plates: string; vin: string; engine_number: string;
    color: string; fuel_type: string; odometer_km: string; responsible_employee_id: string; oil_interval_km: string; oil_interval_months: string; notes: string;
};

export function VehicleFormModal({ initial, employees = [], onClose, onSaved }: {
    initial?: Partial<VehicleFormValues>; employees?: { id: string; full_name: string }[]; onClose: () => void; onSaved: (id: string) => void;
}) {
    const [values, setValues] = useState<VehicleFormValues>({
        alias: "", brand: "", model: "", year: "", plates: "", vin: "", engine_number: "", color: "", fuel_type: "Gasolina",
        odometer_km: "", responsible_employee_id: "", oil_interval_km: "5000", oil_interval_months: "6", notes: "", ...initial,
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const set = (key: keyof VehicleFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setValues((v) => ({ ...v, [key]: e.target.value }));
    const input = "mt-1 w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm";
    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setError("");
        try {
            const { id } = await saveVehicleAction({ ...values, id: values.id || null, responsible_employee_id: values.responsible_employee_id || null });
            onSaved(id);
        } catch (err) {
            setError(err instanceof Error ? err.message : "No se pudo guardar.");
            setSaving(false);
        }
    };
    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="bg-neutral-900 border border-neutral-700 rounded-2xl p-6 max-w-2xl w-full max-h-[92vh] overflow-y-auto space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2"><Car className="w-5 h-5 text-cyan-400" /> {values.id ? "Editar vehículo" : "Nuevo vehículo"}</h3>
                    <button type="button" onClick={onClose} className="p-1 text-neutral-400 hover:text-white"><X className="w-5 h-5" /></button>
                </div>
                <label className="block text-sm text-neutral-300">Nombre para identificarlo *<input required value={values.alias} onChange={set("alias")} className={input} placeholder="Ej. NP300 blanca de entregas" /></label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <label className="text-sm text-neutral-300">Marca<input value={values.brand} onChange={set("brand")} className={input} /></label>
                    <label className="text-sm text-neutral-300">Modelo<input value={values.model} onChange={set("model")} className={input} /></label>
                    <label className="text-sm text-neutral-300">Año<input type="number" min="1950" max="2100" value={values.year} onChange={set("year")} className={input} /></label>
                    <label className="text-sm text-neutral-300">Placas<input value={values.plates} onChange={set("plates")} className={input} /></label>
                    <label className="text-sm text-neutral-300">Color<input value={values.color} onChange={set("color")} className={input} /></label>
                    <label className="text-sm text-neutral-300">Combustible
                        <select value={values.fuel_type} onChange={set("fuel_type")} className={input}>{FUEL_TYPES.map((f) => <option key={f}>{f}</option>)}</select>
                    </label>
                    <label className="text-sm text-neutral-300 col-span-2">No. de serie (VIN)<input value={values.vin} onChange={set("vin")} className={input} /></label>
                    <label className="text-sm text-neutral-300">No. de motor<input value={values.engine_number} onChange={set("engine_number")} className={input} /></label>
                    <label className="text-sm text-neutral-300">Kilometraje actual<input type="number" min="0" value={values.odometer_km} onChange={set("odometer_km")} className={input} /></label>
                    <label className="text-sm text-neutral-300">Aceite cada (km)<input type="number" min="1" value={values.oil_interval_km} onChange={set("oil_interval_km")} className={input} /></label>
                    <label className="text-sm text-neutral-300">Aceite cada (meses)<input type="number" min="1" value={values.oil_interval_months} onChange={set("oil_interval_months")} className={input} /></label>
                </div>
                {employees.length > 0 && (
                    <label className="block text-sm text-neutral-300">Responsable
                        <select value={values.responsible_employee_id} onChange={set("responsible_employee_id")} className={input}>
                            <option value="">Sin asignar</option>
                            {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                        </select>
                    </label>
                )}
                <label className="block text-sm text-neutral-300">Notas<textarea value={values.notes} onChange={set("notes")} rows={2} className={input} /></label>
                {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
                <div className="flex justify-end gap-2">
                    <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-neutral-300 hover:bg-neutral-800 text-sm">Cancelar</button>
                    <button disabled={saving} className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-sm disabled:opacity-40">{saving ? "Guardando…" : "Guardar"}</button>
                </div>
            </form>
        </div>
    );
}
