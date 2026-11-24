"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
    ArrowLeft, Car, RefreshCw, Edit2, Camera, FileText, Wrench, Receipt, History, Plus, Trash2, Star, AlertTriangle,
    Droplets, Gauge, X, Paperclip, Power,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { storageErrorMessage } from "@/lib/storageErrors";
import EditHistory from "@/components/EditHistory";
import {
    deleteVehicleDocumentAction, deleteVehicleExpenseAction, deleteVehicleFileAction, deleteVehicleServiceAction, getVehicleAction,
    prepareVehicleUploadAction, registerVehicleFileAction, saveVehicleDocumentAction, saveVehicleExpenseAction, saveVehicleServiceAction,
    setVehicleActiveAction, setVehicleCoverAction, type VehicleFile,
} from "@/app/actions/vehicles";
import {
    DOCUMENT_TYPES, EXPENSE_CATEGORIES, SERVICE_ITEMS, TRACKED_SERVICE_ITEMS, labelOf, todayLocal, daysUntil,
} from "@/lib/vehicles/catalog";
import { km, money, OIL_LABEL, shortDate, VehicleFormModal } from "../VehiclesClient";

type Data = Awaited<ReturnType<typeof getVehicleAction>>;
type Tab = "resumen" | "fotos" | "documentos" | "servicios" | "gastos" | "historial";

const TABS: { id: Tab; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "resumen", label: "Resumen", Icon: Car },
    { id: "fotos", label: "Fotos", Icon: Camera },
    { id: "documentos", label: "Seguros y documentos", Icon: FileText },
    { id: "servicios", label: "Mantenimiento", Icon: Wrench },
    { id: "gastos", label: "Gastos", Icon: Receipt },
    { id: "historial", label: "Historial", Icon: History },
];

function contentTypeOf(file: File): string {
    if (file.type) return file.type;
    const ext = file.name.split(".").pop()?.toLowerCase();
    return ext === "heic" ? "image/heic" : ext === "heif" ? "image/heif" : ext === "pdf" ? "application/pdf" : "";
}

async function uploadVehicleFile(vehicleId: string, kind: "photo" | "document" | "receipt", file: File, caption?: string): Promise<string> {
    const contentType = contentTypeOf(file);
    const prep = await prepareVehicleUploadAction({ vehicleId, kind, fileName: file.name, contentType, size: file.size });
    const { error } = await supabase.storage.from("vehicle_files").uploadToSignedUrl(prep.path, prep.token, file, { contentType: prep.contentType });
    if (error) throw new Error(`No se pudo subir "${file.name}": ${storageErrorMessage(error.message)}`);
    const { id } = await registerVehicleFileAction({ vehicleId, kind, path: prep.path, fileName: file.name, contentType: prep.contentType, caption });
    return id;
}

export default function VehicleDetail({ vehicleId }: { vehicleId: string }) {
    const [data, setData] = useState<Data | null>(null);
    const [tab, setTab] = useState<Tab>("resumen");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [editing, setEditing] = useState(false);
    const [historyKey, setHistoryKey] = useState(0);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setData(await getVehicleAction(vehicleId));
            setError("");
        } catch (e) {
            setError(e instanceof Error ? e.message : "No se pudo cargar el vehículo.");
        } finally {
            setLoading(false);
            setHistoryKey((k) => k + 1);
        }
    }, [vehicleId]);
    useEffect(() => { load(); }, [load]);

    if (loading && !data) return <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center"><RefreshCw className="w-8 h-8 animate-spin text-cyan-400" /></div>;
    if (!data) return <div className="min-h-screen bg-[#0a0a0a] text-neutral-300 p-10">{error || "Vehículo no encontrado."}</div>;

    const { vehicle, summary, permissions } = data;
    const cover = data.files.find((f) => f.id === vehicle.cover_file_id) || data.files.find((f) => f.kind === "photo");
    const fileById = new Map(data.files.map((f) => [f.id, f]));
    const canWrite = permissions.edit || permissions.create;

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-3 sm:p-6 md:p-8">
            <div className="max-w-[1400px] mx-auto space-y-5">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-neutral-800/40 p-5 rounded-2xl border border-neutral-700/50">
                    <div className="flex items-center gap-4 min-w-0">
                        <Link href="/vehicles" className="p-2.5 bg-neutral-800 hover:bg-neutral-700 rounded-xl text-neutral-400 hover:text-white border border-neutral-700"><ArrowLeft className="w-5 h-5" /></Link>
                        <div className="w-16 h-16 rounded-xl overflow-hidden bg-neutral-900 border border-neutral-700 flex items-center justify-center shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {cover?.url ? <img src={cover.url} alt="" className="w-full h-full object-cover" /> : <Car className="w-8 h-8 text-neutral-600" />}
                        </div>
                        <div className="min-w-0">
                            <h1 className="text-2xl font-bold text-white truncate">{vehicle.alias} {!vehicle.is_active && <span className="text-xs text-red-300 font-normal">(dado de baja)</span>}</h1>
                            <p className="text-sm text-neutral-400">{[vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" · ")}{vehicle.plates ? ` · Placas ${vehicle.plates}` : ""}</p>
                            <p className="text-xs text-neutral-500 flex items-center gap-1.5"><Gauge className="w-3.5 h-3.5" /> {km(vehicle.odometer_km)}{vehicle.odometer_updated_at ? ` (actualizado ${new Date(vehicle.odometer_updated_at).toLocaleDateString("es-MX")})` : ""}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={load} className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg" title="Actualizar"><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /></button>
                        {permissions.edit && <button onClick={() => setEditing(true)} className="text-sm text-cyan-200 bg-cyan-500/10 border border-cyan-500/30 px-3 py-2 rounded-lg flex items-center gap-1.5"><Edit2 className="w-4 h-4" /> Editar datos</button>}
                        {(vehicle.is_active ? permissions.delete : permissions.edit) && (
                            <button onClick={async () => {
                                if (!confirm(vehicle.is_active ? "¿Dar de baja este vehículo? Su expediente se conserva." : "¿Reactivar este vehículo?")) return;
                                try { await setVehicleActiveAction(vehicle.id, !vehicle.is_active); await load(); } catch (e) { setError(e instanceof Error ? e.message : "No se pudo."); }
                            }} className="text-sm text-neutral-300 border border-neutral-600 px-3 py-2 rounded-lg flex items-center gap-1.5"><Power className="w-4 h-4" /> {vehicle.is_active ? "Dar de baja" : "Reactivar"}</button>
                        )}
                    </div>
                </header>

                {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}

                <nav className="flex flex-wrap gap-2">
                    {TABS.map(({ id, label, Icon }) => (
                        <button key={id} onClick={() => setTab(id)} className={`px-3 py-2 rounded-xl text-sm border flex items-center gap-2 ${tab === id ? "bg-cyan-500/15 text-cyan-200 border-cyan-500/40" : "bg-neutral-800/40 text-neutral-400 border-neutral-700/50 hover:bg-neutral-800"}`}>
                            <Icon className="w-4 h-4" /> {label}
                            {id === "documentos" && summary.alerts.length > 0 && <span className="text-[10px] bg-amber-500/20 text-amber-300 rounded px-1">{summary.alerts.length}</span>}
                        </button>
                    ))}
                </nav>

                {tab === "resumen" && <Summary data={data} />}
                {tab === "fotos" && <Photos data={data} canWrite={canWrite} canDelete={permissions.delete} canEdit={permissions.edit} onChanged={load} onError={setError} />}
                {tab === "documentos" && <Documents data={data} fileById={fileById} canWrite={canWrite} canDelete={permissions.delete} onChanged={load} />}
                {tab === "servicios" && <Services data={data} fileById={fileById} canWrite={canWrite} canDelete={permissions.delete} onChanged={load} />}
                {tab === "gastos" && <Expenses data={data} fileById={fileById} canWrite={canWrite} canDelete={permissions.delete} onChanged={load} />}
                {tab === "historial" && <EditHistory rootTable="vehicles" rootId={vehicle.id} title="Historial de cambios del expediente" defaultOpen refreshKey={historyKey} />}
            </div>
            {editing && (
                <VehicleFormModal
                    employees={data.employees}
                    initial={{
                        id: vehicle.id, alias: vehicle.alias, brand: vehicle.brand || "", model: vehicle.model || "", year: vehicle.year ? String(vehicle.year) : "",
                        plates: vehicle.plates || "", vin: vehicle.vin || "", engine_number: vehicle.engine_number || "", color: vehicle.color || "",
                        fuel_type: vehicle.fuel_type || "Gasolina", odometer_km: vehicle.odometer_km !== null ? String(vehicle.odometer_km) : "",
                        responsible_employee_id: vehicle.responsible_employee_id || "", oil_interval_km: String(vehicle.oil_interval_km),
                        oil_interval_months: String(vehicle.oil_interval_months), notes: vehicle.notes || "",
                    }}
                    onClose={() => setEditing(false)}
                    onSaved={async () => { setEditing(false); await load(); }}
                />
            )}
        </div>
    );
}

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
    return (
        <section className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold text-white">{title}</h2>{action}</div>
            {children}
        </section>
    );
}

function Summary({ data }: { data: Data }) {
    const { vehicle, summary } = data;
    const responsible = data.employees.find((e) => e.id === vehicle.responsible_employee_id)?.full_name;
    const oil = summary.oil;
    const categories = Object.entries(summary.spend.byCategory).sort((a, b) => b[1] - a[1]);
    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <Card title="Mantenimiento">
                <div className={`rounded-xl border p-3 ${OIL_LABEL[oil.state].className}`}>
                    <p className="text-sm font-semibold flex items-center gap-1.5"><Droplets className="w-4 h-4" /> {OIL_LABEL[oil.state].text}</p>
                    <p className="text-xs mt-1 text-neutral-300">Último cambio: {oil.last ? `${shortDate(oil.last.date)}${oil.last.odometer !== null ? ` a ${km(oil.last.odometer)}` : ""}` : "sin registro"}</p>
                    {oil.nextDate && <p className="text-xs text-neutral-300">Próximo: {shortDate(oil.nextDate)}{oil.nextKm !== null ? ` o ${km(oil.nextKm)}` : ""} (lo que llegue primero)</p>}
                </div>
                <ul className="text-sm divide-y divide-neutral-700/40">
                    {TRACKED_SERVICE_ITEMS.filter((code) => code !== "aceite").map((code) => {
                        const last = summary.last[code];
                        return (
                            <li key={code} className="flex justify-between gap-3 py-1.5">
                                <span className="text-neutral-300">{labelOf(SERVICE_ITEMS, code)}</span>
                                <span className="text-neutral-400 text-xs text-right">{last ? `${shortDate(last.date)}${last.odometer !== null ? ` · ${km(last.odometer)}` : ""}` : "—"}</span>
                            </li>
                        );
                    })}
                </ul>
            </Card>
            <Card title="Vencimientos">
                {summary.alerts.length === 0 ? <p className="text-sm text-emerald-300">Sin documentos vencidos ni por vencer en 30 días.</p> : (
                    <ul className="space-y-2">
                        {summary.alerts.map((a) => (
                            <li key={a.id} className={`rounded-lg border p-2.5 text-sm flex items-center gap-2 ${a.state === "vencido" ? "border-red-500/40 text-red-200" : "border-amber-500/40 text-amber-200"}`}>
                                <AlertTriangle className="w-4 h-4 shrink-0" /> {labelOf(DOCUMENT_TYPES, a.docType)}: {a.state === "vencido" ? `venció el ${shortDate(a.expiresAt)}` : `vence el ${shortDate(a.expiresAt)} (${a.days} días)`}
                            </li>
                        ))}
                    </ul>
                )}
                <ul className="text-sm divide-y divide-neutral-700/40">
                    {DOCUMENT_TYPES.filter((t) => ["seguro", "tarjeta_circulacion", "verificacion", "tenencia"].includes(t.code)).map((type) => {
                        const latest = data.documents.filter((d) => d.doc_type === type.code).sort((a, b) => (b.expires_at || "").localeCompare(a.expires_at || ""))[0];
                        return (
                            <li key={type.code} className="flex justify-between gap-3 py-1.5">
                                <span className="text-neutral-300">{type.label}</span>
                                <span className="text-xs text-neutral-400 text-right">{latest ? `${latest.provider || latest.document_number || "registrado"}${latest.expires_at ? ` · vence ${shortDate(latest.expires_at)}` : ""}` : "sin registro"}</span>
                            </li>
                        );
                    })}
                </ul>
            </Card>
            <Card title="Gasto">
                <div className="grid grid-cols-3 gap-2 text-center">
                    {[["Este mes", summary.spend.month], ["Este año", summary.spend.year], ["Total", summary.spend.total]].map(([label, value]) => (
                        <div key={label as string} className="bg-neutral-900/50 rounded-lg border border-neutral-700/40 p-2">
                            <p className="text-sm font-bold text-white tabular-nums">{money(value as number)}</p>
                            <p className="text-[10px] uppercase text-neutral-500">{label}</p>
                        </div>
                    ))}
                </div>
                <ul className="text-sm divide-y divide-neutral-700/40">
                    {categories.length === 0 && <li className="text-neutral-500 text-xs py-1.5">Sin gastos registrados.</li>}
                    {categories.map(([category, amount]) => (
                        <li key={category} className="flex justify-between py-1.5">
                            <span className="text-neutral-300">{category === "mantenimiento" ? "Mantenimiento" : labelOf(DOCUMENT_TYPES, category) !== category ? labelOf(DOCUMENT_TYPES, category) : labelOf(EXPENSE_CATEGORIES, category)}</span>
                            <span className="text-neutral-200 tabular-nums">{money(amount)}</span>
                        </li>
                    ))}
                </ul>
            </Card>
            <Card title="Datos del vehículo">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    {([["Marca", vehicle.brand], ["Modelo", vehicle.model], ["Año", vehicle.year], ["Color", vehicle.color], ["Placas", vehicle.plates],
                        ["Combustible", vehicle.fuel_type], ["Serie (VIN)", vehicle.vin], ["Motor", vehicle.engine_number], ["Responsable", responsible],
                        ["Aceite cada", `${vehicle.oil_interval_km.toLocaleString("es-MX")} km o ${vehicle.oil_interval_months} meses`]] as const).map(([label, value]) => (
                        <div key={label}><dt className="text-[11px] uppercase text-neutral-500">{label}</dt><dd className="text-neutral-200 break-words">{value || "—"}</dd></div>
                    ))}
                </dl>
                {vehicle.notes && <p className="text-sm text-neutral-300 whitespace-pre-wrap border-t border-neutral-700/40 pt-2">{vehicle.notes}</p>}
            </Card>
        </div>
    );
}

function Photos({ data, canWrite, canDelete, canEdit, onChanged, onError }: {
    data: Data; canWrite: boolean; canDelete: boolean; canEdit: boolean; onChanged: () => void; onError: (m: string) => void;
}) {
    const [uploading, setUploading] = useState(false);
    const photos = data.files.filter((f) => f.kind === "photo");
    const upload = async (files: FileList | null) => {
        if (!files?.length) return;
        setUploading(true);
        try {
            for (const file of Array.from(files)) await uploadVehicleFile(data.vehicle.id, "photo", file);
            await onChanged();
        } catch (e) {
            onError(e instanceof Error ? e.message : "No se pudo subir la foto.");
        } finally {
            setUploading(false);
        }
    };
    return (
        <Card title={`Fotos (${photos.length})`} action={canWrite && (
            <label className="text-xs text-cyan-200 bg-cyan-500/10 border border-cyan-500/30 px-3 py-1.5 rounded-lg cursor-pointer flex items-center gap-1.5">
                <Camera className="w-3.5 h-3.5" /> {uploading ? "Subiendo…" : "Subir fotos"}
                <input type="file" accept="image/*" multiple className="hidden" disabled={uploading} onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
            </label>
        )}>
            {photos.length === 0 ? <p className="text-sm text-neutral-500">Sin fotos. Sube fotos de los cuatro lados, tablero e interior para tener evidencia del estado.</p> : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {photos.map((photo) => (
                        <div key={photo.id} className="relative group rounded-xl overflow-hidden border border-neutral-700/50 bg-neutral-900">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {photo.url && <a href={photo.url} target="_blank" rel="noopener noreferrer"><img src={photo.url} alt={photo.file_name} className="w-full h-40 object-cover" /></a>}
                            <div className="absolute top-1.5 right-1.5 flex gap-1">
                                {canEdit && data.vehicle.cover_file_id !== photo.id && (
                                    <button title="Usar como portada" onClick={async () => { await setVehicleCoverAction(data.vehicle.id, photo.id); onChanged(); }} className="p-1.5 rounded bg-black/60 text-amber-300"><Star className="w-3.5 h-3.5" /></button>
                                )}
                                {canDelete && (
                                    <button title="Eliminar" onClick={async () => { if (!confirm("¿Eliminar esta foto?")) return; await deleteVehicleFileAction(photo.id); onChanged(); }} className="p-1.5 rounded bg-black/60 text-red-300"><Trash2 className="w-3.5 h-3.5" /></button>
                                )}
                            </div>
                            {data.vehicle.cover_file_id === photo.id && <span className="absolute bottom-1.5 left-1.5 text-[10px] bg-amber-500/80 text-white px-1.5 py-0.5 rounded">Portada</span>}
                            <p className="text-[10px] text-neutral-400 px-2 py-1 truncate">{new Date(photo.created_at).toLocaleDateString("es-MX")} · {photo.uploaded_by_name || ""}</p>
                        </div>
                    ))}
                </div>
            )}
        </Card>
    );
}

function FileLink({ file }: { file?: VehicleFile }) {
    if (!file?.url) return null;
    return <a href={file.url} target="_blank" rel="noopener noreferrer" className="text-xs text-cyan-300 hover:underline inline-flex items-center gap-1"><Paperclip className="w-3 h-3" /> {file.file_name}</a>;
}

function RowActions({ onEdit, onDelete, canEdit, canDelete }: { onEdit: () => void; onDelete: () => void; canEdit: boolean; canDelete: boolean }) {
    return (
        <div className="flex gap-1 shrink-0">
            {canEdit && <button onClick={onEdit} className="p-1.5 text-neutral-400 hover:text-white rounded-lg" title="Editar"><Edit2 className="w-3.5 h-3.5" /></button>}
            {canDelete && <button onClick={onDelete} className="p-1.5 text-neutral-400 hover:text-red-300 rounded-lg" title="Eliminar"><Trash2 className="w-3.5 h-3.5" /></button>}
        </div>
    );
}

type DocumentRow = Data["documents"][number];
function Documents({ data, fileById, canWrite, canDelete, onChanged }: { data: Data; fileById: Map<string, VehicleFile>; canWrite: boolean; canDelete: boolean; onChanged: () => void }) {
    const [editing, setEditing] = useState<Partial<DocumentRow> | null>(null);
    const today = todayLocal();
    return (
        <Card title="Seguros, pólizas y documentos" action={canWrite && <button onClick={() => setEditing({ doc_type: "seguro" })} className="text-xs text-cyan-200 bg-cyan-500/10 border border-cyan-500/30 px-3 py-1.5 rounded-lg flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Agregar</button>}>
            {data.documents.length === 0 ? <p className="text-sm text-neutral-500">Registra la póliza de seguro, tarjeta de circulación, verificación y tenencia con su vigencia; el sistema avisa 30 días antes de que venzan.</p> : (
                <ul className="divide-y divide-neutral-700/40">
                    {data.documents.map((doc) => {
                        const days = doc.expires_at ? daysUntil(doc.expires_at, today) : null;
                        return (
                            <li key={doc.id} className="py-3 flex gap-3 items-start">
                                <FileText className="w-5 h-5 text-cyan-400 mt-0.5 shrink-0" />
                                <div className="flex-1 min-w-0 space-y-0.5">
                                    <p className="text-sm text-white">{labelOf(DOCUMENT_TYPES, doc.doc_type)}{doc.title ? ` — ${doc.title}` : ""}</p>
                                    <p className="text-xs text-neutral-400">{[doc.provider, doc.document_number && `No. ${doc.document_number}`, doc.coverage].filter(Boolean).join(" · ") || "—"}</p>
                                    <p className="text-xs text-neutral-400">
                                        Vigencia: {shortDate(doc.issued_at)} → {shortDate(doc.expires_at)}
                                        {days !== null && <span className={days < 0 ? "text-red-300" : days <= 30 ? "text-amber-300" : "text-emerald-300"}> · {days < 0 ? `vencido hace ${-days} d` : `${days} d restantes`}</span>}
                                        {doc.cost !== null && ` · ${money(Number(doc.cost))}`}
                                    </p>
                                    {doc.notes && <p className="text-xs text-neutral-500">{doc.notes}</p>}
                                    <FileLink file={doc.file_id ? fileById.get(doc.file_id) : undefined} />
                                </div>
                                <RowActions canEdit={canWrite} canDelete={canDelete} onEdit={() => setEditing(doc)}
                                    onDelete={async () => { if (!confirm("¿Eliminar este documento?")) return; await deleteVehicleDocumentAction(doc.id); onChanged(); }} />
                            </li>
                        );
                    })}
                </ul>
            )}
            {editing && <DocumentModal vehicleId={data.vehicle.id} initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />}
        </Card>
    );
}

function ModalShell({ title, children, onClose, onSubmit, saving, error }: { title: string; children: React.ReactNode; onClose: () => void; onSubmit: () => void; saving: boolean; error: string }) {
    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} onClick={(e) => e.stopPropagation()} className="bg-neutral-900 border border-neutral-700 rounded-2xl p-6 max-w-xl w-full max-h-[92vh] overflow-y-auto space-y-3">
                <div className="flex items-center justify-between"><h3 className="text-lg font-bold text-white">{title}</h3><button type="button" onClick={onClose} className="p-1 text-neutral-400 hover:text-white"><X className="w-5 h-5" /></button></div>
                {children}
                {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
                <div className="flex justify-end gap-2 pt-1">
                    <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-neutral-300 hover:bg-neutral-800 text-sm">Cancelar</button>
                    <button disabled={saving} className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-sm disabled:opacity-40">{saving ? "Guardando…" : "Guardar"}</button>
                </div>
            </form>
        </div>
    );
}

const inputClass = "mt-1 w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm";

function useSaver(vehicleId: string, kind: "document" | "receipt", onSaved: () => void) {
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [file, setFile] = useState<File | null>(null);
    const run = async (save: (fileId: string | null) => Promise<void>, currentFileId?: string | null) => {
        setSaving(true);
        setError("");
        try {
            const fileId = file ? await uploadVehicleFile(vehicleId, kind, file) : currentFileId || null;
            await save(fileId);
            onSaved();
        } catch (e) {
            setError(e instanceof Error ? e.message : "No se pudo guardar.");
            setSaving(false);
        }
    };
    return { saving, error, file, setFile, run };
}

function DocumentModal({ vehicleId, initial, onClose, onSaved }: { vehicleId: string; initial: Partial<DocumentRow>; onClose: () => void; onSaved: () => void }) {
    const [v, setV] = useState({
        doc_type: initial.doc_type || "seguro", title: initial.title || "", provider: initial.provider || "", document_number: initial.document_number || "",
        coverage: initial.coverage || "", issued_at: initial.issued_at || "", expires_at: initial.expires_at || "",
        cost: initial.cost !== undefined && initial.cost !== null ? String(initial.cost) : "", notes: initial.notes || "",
    });
    const saver = useSaver(vehicleId, "document", onSaved);
    const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV((x) => ({ ...x, [k]: e.target.value }));
    return (
        <ModalShell title={initial.id ? "Editar documento" : "Nuevo documento"} onClose={onClose} saving={saver.saving} error={saver.error}
            onSubmit={() => saver.run((fileId) => saveVehicleDocumentAction({ id: initial.id || null, vehicle_id: vehicleId, ...v, file_id: fileId }), initial.file_id)}>
            <label className="block text-sm text-neutral-300">Tipo<select value={v.doc_type} onChange={set("doc_type")} className={inputClass}>{DOCUMENT_TYPES.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}</select></label>
            <div className="grid grid-cols-2 gap-3">
                <label className="text-sm text-neutral-300">{v.doc_type === "seguro" ? "Aseguradora" : "Emisor / entidad"}<input value={v.provider} onChange={set("provider")} className={inputClass} /></label>
                <label className="text-sm text-neutral-300">{v.doc_type === "seguro" ? "No. de póliza" : "Folio / número"}<input value={v.document_number} onChange={set("document_number")} className={inputClass} /></label>
                <label className="text-sm text-neutral-300">Inicio de vigencia<input type="date" value={v.issued_at} onChange={set("issued_at")} className={inputClass} /></label>
                <label className="text-sm text-neutral-300">Vence<input type="date" value={v.expires_at} onChange={set("expires_at")} className={inputClass} /></label>
                <label className="text-sm text-neutral-300">Costo<input type="number" min="0" step="0.01" value={v.cost} onChange={set("cost")} className={inputClass} /></label>
                <label className="text-sm text-neutral-300">Descripción<input value={v.title} onChange={set("title")} className={inputClass} placeholder="Ej. cobertura amplia" /></label>
            </div>
            {v.doc_type === "seguro" && <label className="block text-sm text-neutral-300">Cobertura<input value={v.coverage} onChange={set("coverage")} className={inputClass} placeholder="Amplia, limitada, RC…" /></label>}
            <label className="block text-sm text-neutral-300">Notas<textarea value={v.notes} onChange={set("notes")} rows={2} className={inputClass} /></label>
            <label className="block text-sm text-neutral-300">Archivo (PDF o foto){initial.file_id ? " — deja vacío para conservar el actual" : ""}
                <input type="file" accept=".pdf,image/*" onChange={(e) => saver.setFile(e.target.files?.[0] || null)} className="mt-1 block text-sm text-neutral-400" />
            </label>
        </ModalShell>
    );
}

type ServiceRow = Data["services"][number];
function Services({ data, fileById, canWrite, canDelete, onChanged }: { data: Data; fileById: Map<string, VehicleFile>; canWrite: boolean; canDelete: boolean; onChanged: () => void }) {
    const [editing, setEditing] = useState<Partial<ServiceRow> | null>(null);
    return (
        <Card title="Servicios y mantenimiento" action={canWrite && <button onClick={() => setEditing({ service_date: todayLocal(), items: ["aceite", "filtro_aceite"] })} className="text-xs text-cyan-200 bg-cyan-500/10 border border-cyan-500/30 px-3 py-1.5 rounded-lg flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Registrar servicio</button>}>
            {data.services.length === 0 ? <p className="text-sm text-neutral-500">Registra cada cambio de aceite, filtros, frenos, llantas… con fecha, kilometraje y costo.</p> : (
                <ul className="divide-y divide-neutral-700/40">
                    {data.services.map((s) => (
                        <li key={s.id} className="py-3 flex gap-3 items-start">
                            <Wrench className="w-5 h-5 text-orange-400 mt-0.5 shrink-0" />
                            <div className="flex-1 min-w-0 space-y-0.5">
                                <p className="text-sm text-white">{shortDate(s.service_date)}{s.odometer_km !== null ? ` · ${km(s.odometer_km)}` : ""} · <span className="text-emerald-300">{money(Number(s.cost))}</span></p>
                                <div className="flex flex-wrap gap-1">{(s.items || []).map((code: string) => <span key={code} className="text-[10px] px-1.5 py-0.5 rounded border border-neutral-600 text-neutral-300">{labelOf(SERVICE_ITEMS, code)}</span>)}</div>
                                {(s.description || s.workshop) && <p className="text-xs text-neutral-400">{[s.workshop, s.description].filter(Boolean).join(" · ")}</p>}
                                {(s.next_service_date || s.next_service_km) && <p className="text-xs text-neutral-500">Próximo servicio: {s.next_service_date ? shortDate(s.next_service_date) : ""}{s.next_service_km ? ` ${km(s.next_service_km)}` : ""}</p>}
                                <p className="text-[11px] text-neutral-500">{s.created_by_name || ""}</p>
                                <FileLink file={s.file_id ? fileById.get(s.file_id) : undefined} />
                            </div>
                            <RowActions canEdit={canWrite} canDelete={canDelete} onEdit={() => setEditing(s)}
                                onDelete={async () => { if (!confirm("¿Eliminar este servicio?")) return; await deleteVehicleServiceAction(s.id); onChanged(); }} />
                        </li>
                    ))}
                </ul>
            )}
            {editing && <ServiceModal vehicleId={data.vehicle.id} odometer={data.vehicle.odometer_km} initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />}
        </Card>
    );
}

function ServiceModal({ vehicleId, odometer, initial, onClose, onSaved }: { vehicleId: string; odometer: number | null; initial: Partial<ServiceRow>; onClose: () => void; onSaved: () => void }) {
    const [v, setV] = useState({
        service_date: initial.service_date || todayLocal(), odometer_km: initial.odometer_km !== undefined && initial.odometer_km !== null ? String(initial.odometer_km) : (odometer !== null ? String(odometer) : ""),
        items: (initial.items as string[]) || [], description: initial.description || "", workshop: initial.workshop || "",
        cost: initial.cost !== undefined && initial.cost !== null ? String(initial.cost) : "", next_service_date: initial.next_service_date || "",
        next_service_km: initial.next_service_km !== undefined && initial.next_service_km !== null ? String(initial.next_service_km) : "",
    });
    const saver = useSaver(vehicleId, "receipt", onSaved);
    const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV((x) => ({ ...x, [k]: e.target.value }));
    const toggle = (code: string) => setV((x) => ({ ...x, items: x.items.includes(code) ? x.items.filter((c) => c !== code) : [...x.items, code] }));
    return (
        <ModalShell title={initial.id ? "Editar servicio" : "Registrar servicio"} onClose={onClose} saving={saver.saving} error={saver.error}
            onSubmit={() => saver.run((fileId) => saveVehicleServiceAction({ id: initial.id || null, vehicle_id: vehicleId, ...v, file_id: fileId }), initial.file_id)}>
            <div className="grid grid-cols-3 gap-3">
                <label className="text-sm text-neutral-300">Fecha<input type="date" required value={v.service_date} onChange={set("service_date")} className={inputClass} /></label>
                <label className="text-sm text-neutral-300">Kilometraje<input type="number" min="0" value={v.odometer_km} onChange={set("odometer_km")} className={inputClass} /></label>
                <label className="text-sm text-neutral-300">Costo<input type="number" min="0" step="0.01" value={v.cost} onChange={set("cost")} className={inputClass} /></label>
            </div>
            <div>
                <p className="text-sm text-neutral-300 mb-1.5">Qué se hizo</p>
                <div className="flex flex-wrap gap-1.5">
                    {SERVICE_ITEMS.map((item) => (
                        <button type="button" key={item.code} onClick={() => toggle(item.code)} className={`text-xs px-2.5 py-1.5 rounded-lg border ${v.items.includes(item.code) ? "bg-orange-500/20 border-orange-500/50 text-orange-200" : "border-neutral-600 text-neutral-300"}`}>{item.label}</button>
                    ))}
                </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
                <label className="text-sm text-neutral-300">Taller<input value={v.workshop} onChange={set("workshop")} className={inputClass} /></label>
                <label className="text-sm text-neutral-300">Detalle<input value={v.description} onChange={set("description")} className={inputClass} placeholder="Ej. aceite 5W-30 sintético" /></label>
                <label className="text-sm text-neutral-300">Próximo servicio (fecha)<input type="date" value={v.next_service_date} onChange={set("next_service_date")} className={inputClass} /></label>
                <label className="text-sm text-neutral-300">Próximo servicio (km)<input type="number" min="0" value={v.next_service_km} onChange={set("next_service_km")} className={inputClass} /></label>
            </div>
            <p className="text-[11px] text-neutral-500">Si no indicas el próximo servicio, para el aceite se usa el intervalo del vehículo.</p>
            <label className="block text-sm text-neutral-300">Comprobante (PDF o foto){initial.file_id ? " — deja vacío para conservar el actual" : ""}
                <input type="file" accept=".pdf,image/*" onChange={(e) => saver.setFile(e.target.files?.[0] || null)} className="mt-1 block text-sm text-neutral-400" />
            </label>
        </ModalShell>
    );
}

type ExpenseRow = Data["expenses"][number];
function Expenses({ data, fileById, canWrite, canDelete, onChanged }: { data: Data; fileById: Map<string, VehicleFile>; canWrite: boolean; canDelete: boolean; onChanged: () => void }) {
    const [editing, setEditing] = useState<Partial<ExpenseRow> | null>(null);
    const [month, setMonth] = useState("");
    const months = useMemo(() => Array.from(new Set(data.expenses.map((e) => e.expense_date.slice(0, 7)))).sort().reverse(), [data.expenses]);
    const visible = data.expenses.filter((e) => !month || e.expense_date.startsWith(month));
    const total = visible.reduce((sum, e) => sum + Number(e.amount), 0);
    return (
        <Card title="Gastos" action={canWrite && <button onClick={() => setEditing({ expense_date: todayLocal(), category: "combustible" })} className="text-xs text-cyan-200 bg-cyan-500/10 border border-cyan-500/30 px-3 py-1.5 rounded-lg flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Registrar gasto</button>}>
            <div className="flex flex-wrap items-center gap-3 text-sm">
                <select value={month} onChange={(e) => setMonth(e.target.value)} className="bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-1.5 text-white text-sm">
                    <option value="">Todos los meses</option>
                    {months.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <span className="text-neutral-400">Total: <span className="text-white font-semibold">{money(total)}</span></span>
                <span className="text-xs text-neutral-500">Los servicios y seguros se suman al gasto del resumen.</span>
            </div>
            {visible.length === 0 ? <p className="text-sm text-neutral-500">Sin gastos registrados.</p> : (
                <ul className="divide-y divide-neutral-700/40">
                    {visible.map((e) => (
                        <li key={e.id} className="py-2.5 flex gap-3 items-start">
                            <Receipt className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm text-white">{labelOf(EXPENSE_CATEGORIES, e.category)} · <span className="text-emerald-300">{money(Number(e.amount))}</span></p>
                                <p className="text-xs text-neutral-400">{shortDate(e.expense_date)}{e.odometer_km !== null ? ` · ${km(e.odometer_km)}` : ""}{e.liters ? ` · ${e.liters} L` : ""}{e.description ? ` · ${e.description}` : ""}{e.created_by_name ? ` · ${e.created_by_name}` : ""}</p>
                                <FileLink file={e.file_id ? fileById.get(e.file_id) : undefined} />
                            </div>
                            <RowActions canEdit={canWrite} canDelete={canDelete} onEdit={() => setEditing(e)}
                                onDelete={async () => { if (!confirm("¿Eliminar este gasto?")) return; await deleteVehicleExpenseAction(e.id); onChanged(); }} />
                        </li>
                    ))}
                </ul>
            )}
            {editing && <ExpenseModal vehicleId={data.vehicle.id} initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />}
        </Card>
    );
}

function ExpenseModal({ vehicleId, initial, onClose, onSaved }: { vehicleId: string; initial: Partial<ExpenseRow>; onClose: () => void; onSaved: () => void }) {
    const [v, setV] = useState({
        expense_date: initial.expense_date || todayLocal(), category: initial.category || "combustible",
        amount: initial.amount !== undefined && initial.amount !== null ? String(initial.amount) : "",
        odometer_km: initial.odometer_km !== undefined && initial.odometer_km !== null ? String(initial.odometer_km) : "",
        liters: initial.liters !== undefined && initial.liters !== null ? String(initial.liters) : "", description: initial.description || "",
    });
    const saver = useSaver(vehicleId, "receipt", onSaved);
    const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((x) => ({ ...x, [k]: e.target.value }));
    return (
        <ModalShell title={initial.id ? "Editar gasto" : "Registrar gasto"} onClose={onClose} saving={saver.saving} error={saver.error}
            onSubmit={() => saver.run((fileId) => saveVehicleExpenseAction({ id: initial.id || null, vehicle_id: vehicleId, ...v, file_id: fileId }), initial.file_id)}>
            <div className="grid grid-cols-2 gap-3">
                <label className="text-sm text-neutral-300">Fecha<input type="date" required value={v.expense_date} onChange={set("expense_date")} className={inputClass} /></label>
                <label className="text-sm text-neutral-300">Categoría<select value={v.category} onChange={set("category")} className={inputClass}>{EXPENSE_CATEGORIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}</select></label>
                <label className="text-sm text-neutral-300">Importe<input type="number" min="0.01" step="0.01" required value={v.amount} onChange={set("amount")} className={inputClass} /></label>
                <label className="text-sm text-neutral-300">Kilometraje<input type="number" min="0" value={v.odometer_km} onChange={set("odometer_km")} className={inputClass} /></label>
                {v.category === "combustible" && <label className="text-sm text-neutral-300">Litros<input type="number" min="0" step="0.01" value={v.liters} onChange={set("liters")} className={inputClass} /></label>}
                <label className="text-sm text-neutral-300 col-span-2">Descripción<input value={v.description} onChange={set("description")} className={inputClass} /></label>
            </div>
            <label className="block text-sm text-neutral-300">Comprobante (PDF o foto){initial.file_id ? " — deja vacío para conservar el actual" : ""}
                <input type="file" accept=".pdf,image/*" onChange={(e) => saver.setFile(e.target.files?.[0] || null)} className="mt-1 block text-sm text-neutral-400" />
            </label>
        </ModalShell>
    );
}
