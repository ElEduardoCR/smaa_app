"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
    PackageCheck, ArrowLeft, RefreshCw, Package, Truck, Camera, MapPin, AlertTriangle,
    Download, X, Loader2, FileText, Cog, Flame, Cpu, Plus, FileSignature
} from "lucide-react";
import Link from "next/link";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";
import PhotoCapture from "@/components/manufacturing/PhotoCapture";
import SignaturePad from "@/components/manufacturing/SignaturePad";
import { generateDeliveryPDF } from "@/lib/generateDeliveryPdf";
import { uploadFileToBucket, uploadSignatureDataUrl } from "@/lib/uploadHelpers";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

const ICONS: Record<string, any> = { Cog, Flame, Cpu };
const COLORS: Record<string, string> = { orange: "text-orange-400", amber: "text-amber-400", cyan: "text-cyan-400" };

type DeliveryPhoto = {
    id: string;
    delivery_id: string;
    kind: string;
    photo_url: string;
    lat: number | null;
    lng: number | null;
    location_source: string | null;
    captured_at: string;
    captured_by: string | null;
};

type Delivery = {
    id: string;
    delivery_number: string;
    observations: string | null;
    shipping_method: string | null;
    shipping_address: string | null;
    shipping_carrier: string | null;
    tracking_number: string | null;
    created_at: string;
    stage: string;
    packaged_at: string | null;
    packaged_by: string | null;
    packaging_signature_url?: string | null;
    packaging_photo_url?: string | null;
    delivered_at: string | null;
    delivered_by: string | null;
    delivery_signature_url?: string | null;
    delivery_lat: number | null;
    delivery_lng: number | null;
    delivery_location_source: string | null;
    evidence_photo_url?: string | null;
    evidence_signed_url?: string | null;
    work_order: {
        id: string;
        order_number: string;
        work_title: string | null;
        notes: string | null;
        module?: { code: string; name: string; color: string; icon: string };
        quotation: {
            id: string;
            quotation_number: string;
            client: { business_name: string; rfc: string; email?: string; address?: string };
        } | null;
    };
};

const STAGE_LABELS: Record<string, { label: string; color: string }> = {
    ready_for_packaging: { label: "Listo para embalaje", color: "bg-amber-500/10 text-amber-300 border-amber-500/30" },
    delivered: { label: "Entregado", color: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" },
};

export default function DeliveriesPage() {
    const [deliveries, setDeliveries] = useState<Delivery[]>([]);
    const [photosByDelivery, setPhotosByDelivery] = useState<Record<string, DeliveryPhoto[]>>({});
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<"ready" | "delivered">("ready");
    const [busyId, setBusyId] = useState<string | null>(null);
    const [actionMsg, setActionMsg] = useState<{ type: "error" | "success" | "info"; text: string } | null>(null);

    const load = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from("deliveries")
                .select(`
                    id, delivery_number, observations, shipping_method, shipping_address, shipping_carrier,
                    tracking_number, created_at, stage, packaged_at, packaged_by, delivered_at, delivered_by,
                    delivery_lat, delivery_lng, delivery_location_source,
                    work_order:work_orders(
                        id, order_number, work_title, notes,
                        module:manufacturing_modules(code, name, color, icon),
                        quotation:quotations(id, quotation_number, client:clients(business_name, rfc, email, address))
                    )
                `)
                .order("created_at", { ascending: false });
            if (error) throw error;
            const formatted = (data || []).map((d: any) => {
                const wo = Array.isArray(d.work_order) ? d.work_order[0] : d.work_order;
                if (wo) {
                    if (wo.module) wo.module = Array.isArray(wo.module) ? wo.module[0] : wo.module;
                    if (wo.quotation) {
                        wo.quotation = Array.isArray(wo.quotation) ? wo.quotation[0] : wo.quotation;
                        if (wo.quotation?.client) wo.quotation.client = Array.isArray(wo.quotation.client) ? wo.quotation.client[0] : wo.quotation.client;
                    }
                }
                return { ...d, work_order: wo };
            });
            setDeliveries(formatted);

            // Photos
            const { data: ph } = await supabase.from("delivery_photos").select("*").order("captured_at", { ascending: true });
            const grouped: Record<string, DeliveryPhoto[]> = {};
            (ph || []).forEach((p: any) => {
                grouped[p.delivery_id] = grouped[p.delivery_id] || [];
                grouped[p.delivery_id].push(p);
            });
            setPhotosByDelivery(grouped);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { load(); }, []);

    const flash = (type: "error" | "success" | "info", text: string) => {
        setActionMsg({ type, text });
        setTimeout(() => setActionMsg(null), 4000);
    };

    const handleMarkPackaged = async (d: Delivery) => {
        if (!confirm("¿Marcar esta OT como empaquetada / lista para entrega?")) return;
        setBusyId(d.id);
        try {
            await supabase.from("deliveries").update({
                stage: "ready_for_packaging",
                packaged_at: new Date().toISOString(),
            }).eq("id", d.id);
            flash("success", "Marcada como lista para embalaje.");
            await load();
        } catch (e: any) { flash("error", e?.message || "Error."); }
        finally { setBusyId(null); }
    };

    const handleMarkDelivered = async (d: Delivery, signatureDataUrl: string) => {
        setBusyId(d.id);
        try {
            const sigUrl = await uploadSignatureDataUrl(signatureDataUrl, `deliv_${d.delivery_number}`);
            await supabase.from("deliveries").update({
                stage: "delivered",
                delivered_at: new Date().toISOString(),
                delivery_signature_url: sigUrl,
            }).eq("id", d.id);
            flash("success", "Entrega confirmada.");
            await load();
        } catch (e: any) { flash("error", e?.message || "Error al firmar."); }
        finally { setBusyId(null); }
    };

    const handleAddDeliveryPhoto = async (
        d: Delivery, file: File, geo: { lat: number; lng: number; source: string } | null, kind: "invoice" | "packaging" | "other"
    ) => {
        try {
            const path = `deliveries/${kind}/${d.id}/${Date.now()}_${file.name}`;
            const url = await uploadFileToBucket(file, "work_order_files", path);
            await supabase.from("delivery_photos").insert([{
                delivery_id: d.id,
                kind,
                photo_url: url,
                lat: geo?.lat || null,
                lng: geo?.lng || null,
                location_source: geo?.source || null,
                captured_by: d.delivered_by || d.packaged_by || null,
            }]);
            if (kind === "invoice" && geo) {
                await supabase.from("deliveries").update({
                    delivery_lat: geo.lat,
                    delivery_lng: geo.lng,
                    delivery_location_source: geo.source,
                }).eq("id", d.id);
            }
            flash("success", "Foto agregada.");
            await load();
        } catch (e: any) { flash("error", e?.message || "Error."); }
    };

    const handleDownloadPDF = async (d: Delivery) => {
        try {
            const items = d.work_order.quotation
                ? (await supabase.from("quotation_items").select("description, quantity").eq("quotation_id", d.work_order.quotation.id)).data || []
                : [];
            await generateDeliveryPDF({
                delivery_number: d.delivery_number,
                created_at: d.created_at,
                observations: d.observations,
                shipping_method: d.shipping_method,
                shipping_address: d.shipping_address,
                shipping_carrier: d.shipping_carrier,
                tracking_number: d.tracking_number,
                work_order: { order_number: d.work_order.order_number, notes: d.work_order.notes },
                quotation: { quotation_number: d.work_order.quotation?.quotation_number || "—" },
                client: d.work_order.quotation?.client || { business_name: d.work_order.work_title || "—", rfc: "" },
                items: items as any,
            });
        } catch (e: any) {
            flash("error", "Error al generar PDF: " + e.message);
        }
    };

    const visible = deliveries.filter(d => tab === "ready" ? d.stage === "ready_for_packaging" : d.stage === "delivered");

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-3 sm:p-6 md:p-8 lg:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-6xl mx-auto space-y-6">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors text-neutral-400 hover:text-white border border-neutral-700">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div>
                            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                                <PackageCheck className="w-8 h-8 text-emerald-400" />
                                Entregas
                            </h1>
                            <p className="text-neutral-400 text-sm mt-1">OTs liberadas por Calidad, listas para embalar y entregar.</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={load} className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg transition-colors flex items-center gap-2 text-sm" disabled={loading}>
                            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin text-emerald-400")} /> Actualizar
                        </button>
                        <Link href="/deliveries/new" className="flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-5 py-3 rounded-xl font-medium transition-all hover:shadow-[0_0_20px_rgba(16,185,129,0.4)] active:scale-95">
                            <Plus className="w-5 h-5" /> Nueva entrega
                        </Link>
                    </div>
                </header>

                {actionMsg && (
                    <div className={cn(
                        "p-3 rounded-xl border flex items-center gap-3",
                        actionMsg.type === "error" ? "bg-red-500/10 border-red-500/30 text-red-300" :
                        actionMsg.type === "success" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" :
                        "bg-sky-500/10 border-sky-500/30 text-sky-300"
                    )}>
                        {actionMsg.type === "error" ? <AlertTriangle className="w-5 h-5" /> : <PackageCheck className="w-5 h-5" />}
                        {actionMsg.text}
                    </div>
                )}

                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setTab("ready")}
                        className={cn(
                            "px-4 py-2 rounded-xl text-sm font-medium border transition-colors flex items-center gap-2",
                            tab === "ready"
                                ? "bg-amber-500/15 text-amber-300 border-amber-500/40"
                                : "bg-neutral-800/40 text-neutral-400 border-neutral-700/50 hover:bg-neutral-800"
                        )}
                    >
                        <Package className="w-4 h-4" /> Listo para embalaje ({deliveries.filter(d => d.stage === "ready_for_packaging").length})
                    </button>
                    <button
                        onClick={() => setTab("delivered")}
                        className={cn(
                            "px-4 py-2 rounded-xl text-sm font-medium border transition-colors flex items-center gap-2",
                            tab === "delivered"
                                ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                                : "bg-neutral-800/40 text-neutral-400 border-neutral-700/50 hover:bg-neutral-800"
                        )}
                    >
                        <Truck className="w-4 h-4" /> Entregados ({deliveries.filter(d => d.stage === "delivered").length})
                    </button>
                </div>

                {loading ? (
                    <div className="p-12 text-center text-neutral-400">
                        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-emerald-400" /> Cargando…
                    </div>
                ) : visible.length === 0 ? (
                    <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl p-12 text-center text-neutral-400">
                        <PackageCheck className="w-10 h-10 mx-auto mb-3 opacity-40" />
                        <p>{tab === "ready" ? "No hay OTs pendientes de embalaje." : "Aún no hay entregas confirmadas."}</p>
                        <p className="text-sm mt-1 text-neutral-500">Las OTs aparecen aquí cuando Calidad las libera.</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {visible.map(d => {
                            const Icon = d.work_order.module ? (ICONS[d.work_order.module.icon] || Package) : Package;
                            const colorCls = d.work_order.module ? (COLORS[d.work_order.module.color] || "text-emerald-400") : "text-emerald-400";
                            const photos = photosByDelivery[d.id] || [];
                            const invoicePhotos = photos.filter(p => p.kind === "invoice");
                            const packagingPhotos = photos.filter(p => p.kind === "packaging");
                            return (
                                <DeliveryCard
                                    key={d.id}
                                    d={d}
                                    Icon={Icon}
                                    colorCls={colorCls}
                                    photos={photos}
                                    invoicePhotos={invoicePhotos}
                                    packagingPhotos={packagingPhotos}
                                    busy={busyId === d.id}
                                    onMarkPackaged={() => handleMarkPackaged(d)}
                                    onMarkDelivered={(sig) => handleMarkDelivered(d, sig)}
                                    onAddPhoto={(f, g, k) => handleAddDeliveryPhoto(d, f, g, k)}
                                    onDownload={() => handleDownloadPDF(d)}
                                />
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

function DeliveryCard({
    d, Icon, colorCls, photos, invoicePhotos, packagingPhotos, busy,
    onMarkPackaged, onMarkDelivered, onAddPhoto, onDownload,
}: {
    d: Delivery;
    Icon: any; colorCls: string;
    photos: DeliveryPhoto[]; invoicePhotos: DeliveryPhoto[]; packagingPhotos: DeliveryPhoto[];
    busy: boolean;
    onMarkPackaged: () => void;
    onMarkDelivered: (sig: string) => void;
    onAddPhoto: (file: File, geo: { lat: number; lng: number; source: string } | null, kind: "invoice" | "packaging" | "other") => void;
    onDownload: () => void;
}) {
    const [openInvoice, setOpenInvoice] = useState(false);
    const [openPackaging, setOpenPackaging] = useState(false);
    const [openSign, setOpenSign] = useState(false);

    return (
        <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-5 space-y-3">
            <div className="flex items-start gap-3 flex-wrap">
                <Icon className={cn("w-6 h-6", colorCls)} />
                <div className="flex-1 min-w-0 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-emerald-300 text-xs bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">{d.delivery_number}</span>
                        <span className="text-white font-semibold">{d.work_order.order_number}</span>
                        {d.work_order.module && <span className="text-[10px] uppercase tracking-wider text-neutral-500">{d.work_order.module.name}</span>}
                        <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border uppercase", STAGE_LABELS[d.stage]?.color)}>
                            {STAGE_LABELS[d.stage]?.label}
                        </span>
                    </div>
                    <p className="text-sm text-neutral-300 mt-0.5 truncate">{d.work_order.quotation?.client?.business_name || d.work_order.work_title || "—"}</p>
                    <p className="text-[11px] text-neutral-500 mt-0.5">
                        {d.shipping_method ? `${d.shipping_method} · ` : ""}{d.shipping_address || ""}
                        {d.tracking_number ? ` · Tracking: ${d.tracking_number}` : ""}
                    </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={onDownload} className="text-xs text-emerald-300 hover:text-white bg-emerald-500/10 hover:bg-emerald-500/20 px-3 py-1.5 rounded-lg border border-emerald-500/20 flex items-center gap-1.5">
                        <Download className="w-3.5 h-3.5" /> PDF
                    </button>
                </div>
            </div>

            {/* Stage-specific actions */}
            {d.stage === "ready_for_packaging" && (
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 space-y-3">
                    <p className="text-sm text-amber-200 flex items-center gap-2"><Package className="w-4 h-4" /> Pendiente de empacar y entregar.</p>

                    {/* Packaging photos */}
                    <div>
                        <p className="text-xs uppercase tracking-wider text-amber-200/80 mb-1">Foto del embalaje (opcional)</p>
                        {packagingPhotos.length > 0 && (
                            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-2">
                                {packagingPhotos.map(p => (
                                    <a key={p.id} href={p.photo_url} target="_blank" rel="noopener noreferrer" className="block">
                                        <img src={p.photo_url} className="rounded-lg w-full h-20 object-cover border border-neutral-700/50" />
                                    </a>
                                ))}
                            </div>
                        )}
                        {openPackaging ? (
                            <div className="space-y-2">
                                <PhotoCapture onCapture={(f, g) => { onAddPhoto(f, g, "packaging"); setOpenPackaging(false); }} label="Foto del empaque" />
                                <button onClick={() => setOpenPackaging(false)} className="text-xs text-neutral-400 hover:text-white">Cancelar</button>
                            </div>
                        ) : (
                            <button onClick={() => setOpenPackaging(true)} className="text-xs text-amber-300 hover:text-white bg-amber-500/10 hover:bg-amber-500/20 px-3 py-1.5 rounded-lg border border-amber-500/20 flex items-center gap-1.5">
                                <Camera className="w-3.5 h-3.5" /> Subir foto del embalaje
                            </button>
                        )}
                    </div>

                    <div className="flex justify-end">
                        <button
                            onClick={onMarkPackaged}
                            disabled={busy}
                            className="text-sm font-semibold bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg flex items-center gap-1.5 disabled:opacity-50"
                        >
                            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
                            Marcar como empacado
                        </button>
                    </div>
                </div>
            )}

            {d.stage === "delivered" && (
                <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3 space-y-3">
                    <p className="text-sm text-emerald-200 flex items-center gap-2"><Truck className="w-4 h-4" /> Entregada {d.delivered_at ? `· ${new Date(d.delivered_at).toLocaleString()}` : ""}</p>
                    {d.delivery_lat && d.delivery_lng && (
                        <p className="text-xs text-emerald-300/80 flex items-center gap-1.5">
                            <MapPin className="w-3.5 h-3.5" /> GPS: {d.delivery_lat.toFixed(6)}, {d.delivery_lng.toFixed(6)} (fuente: {d.delivery_location_source})
                        </p>
                    )}
                    {d.delivery_signature_url && (
                        <div className="flex items-center gap-2">
                            <img src={d.delivery_signature_url} className="h-12 bg-neutral-900/50 rounded-lg p-1 border border-neutral-700" alt="firma" />
                            <p className="text-xs text-neutral-400">Firma de quien recibe</p>
                        </div>
                    )}
                </div>
            )}

            {/* Evidence section: invoice (CFDI received) */}
            <div className="border-t border-neutral-700/40 pt-3 space-y-2">
                <p className="text-xs uppercase tracking-wider text-neutral-400 flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5" /> Evidencia de entrega
                </p>
                {invoicePhotos.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {invoicePhotos.map(p => (
                            <a key={p.id} href={p.photo_url} target="_blank" rel="noopener noreferrer" className="block relative group">
                                <img src={p.photo_url} className="rounded-lg w-full h-28 object-cover border border-neutral-700/50" />
                                {p.lat && p.lng && (
                                    <div className="absolute bottom-1 left-1 right-1 bg-black/70 text-[10px] text-emerald-300 px-1.5 py-0.5 rounded flex items-center gap-1">
                                        <MapPin className="w-2.5 h-2.5" /> {p.lat.toFixed(4)}, {p.lng.toFixed(4)}
                                    </div>
                                )}
                            </a>
                        ))}
                    </div>
                ) : (
                    <p className="text-xs text-neutral-500">Sin evidencia fotográfica de la factura firmada o del paquete.</p>
                )}

                {openInvoice ? (
                    <div className="space-y-2">
                        <PhotoCapture
                            onCapture={(f, g) => { onAddPhoto(f, g, "invoice"); setOpenInvoice(false); }}
                            label="Factura firmada / evidencia del paquete"
                        />
                        <button onClick={() => setOpenInvoice(false)} className="text-xs text-neutral-400 hover:text-white">Cancelar</button>
                    </div>
                ) : (
                    <div className="flex flex-wrap items-center gap-2">
                        <button onClick={() => setOpenInvoice(true)} className="text-xs text-orange-300 hover:text-white bg-orange-500/10 hover:bg-orange-500/20 px-3 py-1.5 rounded-lg border border-orange-500/20 flex items-center gap-1.5">
                            <Camera className="w-3.5 h-3.5" /> {invoicePhotos.length > 0 ? "Agregar otra" : "Subir foto de factura / paquete"}
                        </button>

                        {d.stage !== "delivered" && (
                            <button onClick={() => setOpenSign(true)} className="text-xs text-sky-300 hover:text-white bg-sky-500/10 hover:bg-sky-500/20 px-3 py-1.5 rounded-lg border border-sky-500/20 flex items-center gap-1.5">
                                <FileSignature className="w-3.5 h-3.5" /> Firmar entrega
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Signature modal */}
            {openSign && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setOpenSign(false)}>
                    <div className="bg-neutral-900 border border-neutral-700 rounded-2xl p-6 max-w-2xl w-full" onClick={e => e.stopPropagation()}>
                        <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
                            <FileSignature className="w-5 h-5 text-sky-400" /> Firma de quien recibe
                        </h3>
                        <p className="text-sm text-neutral-400 mb-3">
                            La firma confirma que la OT <strong>{d.work_order.order_number}</strong> fue recibida.
                        </p>
                        <SignaturePad
                            onSave={async (sig) => { setOpenSign(false); await onMarkDelivered(sig); }}
                            saving={busy}
                            color="#38bdf8"
                            savingLabel="Confirmando…"
                            saveLabel="Confirmar entrega"
                        />
                        <button onClick={() => setOpenSign(false)} className="text-xs text-neutral-500 hover:text-white mt-3">Cancelar</button>
                    </div>
                </div>
            )}
        </div>
    );
}
