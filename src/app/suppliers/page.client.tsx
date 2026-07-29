"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { supabase } from "@/lib/supabase";
import { extractAndParseCSF, type CsfData } from "@/lib/csfParser";
import { createSupplierAction, updateSupplierAction, deleteSupplierAction as obsoleteSupplierAction, restoreSupplierAction } from "@/app/actions/suppliers";
import { Truck, FileText, Hash, Mail, MapPin, Phone, RefreshCw, Plus, ArrowLeft, Users, Download, FileCheck, Edit2, Sparkles, CheckCircle2, AlertCircle, Loader2, X, Archive, ArchiveRestore } from "lucide-react";
import Link from "next/link";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

const supplierSchema = z.object({
    rfc: z.string().min(12, "RFC must be at least 12 characters").max(13, "RFC cannot exceed 13 characters").toUpperCase(),
    business_name: z.string().min(3, "Business Name is required"),
    fiscal_regime: z.string().optional().or(z.literal("")),
    fiscal_zip_code: z.string().optional().or(z.literal("")),
    email: z.string().email("Invalid email address").optional().or(z.literal("")),
    phone: z.string().optional(),
    address: z.string().optional(),
});

type SupplierFormValues = z.infer<typeof supplierSchema>;
type Supplier = SupplierFormValues & {
    id: string;
    constancia_pdf_url?: string;
    constancia_updated_at?: string;
    created_at: string;
    is_active?: boolean;
};

export default function SuppliersPage() {
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [csfParsing, setCsfParsing] = useState(false);
    const [csfExtracted, setCsfExtracted] = useState<CsfData | null>(null);
    const [showObsolete, setShowObsolete] = useState(false);
    const [search, setSearch] = useState("");

    const { register, handleSubmit, reset, formState: { errors } } = useForm<SupplierFormValues>({
        resolver: zodResolver(supplierSchema),
        defaultValues: { rfc: "", business_name: "", fiscal_regime: "", fiscal_zip_code: "", email: "", phone: "", address: "" }
    });

    const fetchSuppliers = async () => {
        setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('suppliers')
                .select('*')
                .order('is_active', { ascending: false })
                .order('created_at', { ascending: false });
            if (error) throw error;
            setSuppliers(data || []);
        } catch (error: any) {
            console.error("Error fetching suppliers:", error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => { fetchSuppliers(); }, []);

    const visibleSuppliers = useMemo(() => {
        let list = suppliers;
        if (!showObsolete) {
            list = list.filter((s) => s.is_active !== false);
        }
        if (search.trim()) {
            const q = search.trim().toLowerCase();
            list = list.filter((s) =>
                (s.rfc || "").toLowerCase().includes(q) ||
                (s.business_name || "").toLowerCase().includes(q) ||
                (s.email || "").toLowerCase().includes(q)
            );
        }
        return list;
    }, [suppliers, showObsolete, search]);

    const obsoleteCount = useMemo(() => suppliers.filter((s) => s.is_active === false).length, [suppliers]);

    const handleObsolete = async (s: Supplier) => {
        if (!confirm(`¿Obsoletar al proveedor "${s.business_name}"?\n\nNo se borrará, solo se ocultará de las listas. Las POs existentes siguen vinculadas.`)) return;
        setMessage(null);
        try {
            await obsoleteSupplierAction(s.id);
            setMessage({ type: 'success', text: `Proveedor "${s.business_name}" obsoletado.` });
            fetchSuppliers();
            setTimeout(() => setMessage(null), 3000);
        } catch (e: any) {
            setMessage({ type: 'error', text: e.message || "Error al obsoletar." });
        }
    };

    const handleRestore = async (s: Supplier) => {
        if (!confirm(`¿Restaurar al proveedor "${s.business_name}"?`)) return;
        setMessage(null);
        try {
            await restoreSupplierAction(s.id);
            setMessage({ type: 'success', text: `Proveedor "${s.business_name}" restaurado.` });
            fetchSuppliers();
            setTimeout(() => setMessage(null), 3000);
        } catch (e: any) {
            setMessage({ type: 'error', text: e.message || "Error al restaurar." });
        }
    };

    const handleEditClick = (s: Supplier) => {
        setEditingId(s.id);
        reset({ rfc: s.rfc, business_name: s.business_name, fiscal_regime: s.fiscal_regime || "", fiscal_zip_code: s.fiscal_zip_code || "", email: s.email || "", phone: s.phone || "", address: s.address || "" });
        setSelectedFile(null);
        setCsfExtracted(null);
        setIsFormOpen(true);
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    const handleCloseForm = () => {
        setIsFormOpen(false);
        setEditingId(null);
        setSelectedFile(null);
        setCsfExtracted(null);
        reset({ rfc: "", business_name: "", fiscal_regime: "", fiscal_zip_code: "", email: "", phone: "", address: "" });
    };

    /**
     * Maneja la subida de una CSF: extrae texto del PDF, parsea con csfParser,
     * y rellena los campos del formulario. El archivo queda en `selectedFile`
     * para que se suba al guardar.
     */
    const handleCsfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = "";  // permitir re-subir el mismo archivo
        if (!file) return;
        setSelectedFile(file);
        setCsfParsing(true);
        setCsfExtracted(null);
        setMessage(null);
        try {
            const data = await extractAndParseCSF(file);
            setCsfExtracted(data);
            const patch: Partial<SupplierFormValues> = {};
            if (data.rfc) patch.rfc = data.rfc;
            if (data.business_name) patch.business_name = data.business_name;
            if (data.fiscal_regime) patch.fiscal_regime = data.fiscal_regime;
            if (data.fiscal_zip_code) patch.fiscal_zip_code = data.fiscal_zip_code;
            if (data.email) patch.email = data.email;
            if (data.phone) patch.phone = data.phone;
            if (data.address) patch.address = data.address;
            // Solo aplicar si hay al menos un campo extraído
            if (Object.keys(patch).length > 0) {
                reset({ ...patch } as SupplierFormValues);
                setMessage({
                    type: 'success',
                    text: `✓ Datos extraídos de la CSF: ${Object.keys(patch).join(', ')}. Verifica y edita lo que necesites.`
                });
                setTimeout(() => setMessage(null), 5000);
            } else {
                setMessage({
                    type: 'error',
                    text: "No se pudieron extraer datos de la CSF. Verifica que sea un PDF válido del SAT, o llena el formulario manualmente."
                });
            }
        } catch (ex: any) {
            console.error("Error parsing CSF:", ex);
            setMessage({
                type: 'error',
                text: `No pude leer la CSF (${ex.message || 'PDF inválido o protegido'}). El archivo se guardará igual; llena los datos manualmente.`
            });
        } finally {
            setCsfParsing(false);
        }
    };

    const onSubmit = async (data: SupplierFormValues) => {
        setIsSubmitting(true);
        setMessage(null);
        try {
            let pdfUrl: string | null = null;

            if (selectedFile) {
                const fileExt = selectedFile.name.split('.').pop();
                const fileName = `${data.rfc}-${Date.now()}.${fileExt}`;
                const { error: uploadError } = await supabase.storage.from('purchase_files').upload(`constancias/${fileName}`, selectedFile, { cacheControl: '3600', upsert: true, contentType: selectedFile.type });
                if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);
                const { data: publicUrlData } = supabase.storage.from('purchase_files').getPublicUrl(`constancias/${fileName}`);
                pdfUrl = publicUrlData.publicUrl;
            }

            if (editingId) {
                await updateSupplierAction({
                    id: editingId,
                    rfc: data.rfc,
                    business_name: data.business_name,
                    fiscal_regime: data.fiscal_regime || null,
                    fiscal_zip_code: data.fiscal_zip_code || null,
                    email: data.email || null,
                    phone: data.phone || null,
                    address: data.address || null,
                    constancia_pdf_url: pdfUrl,
                });
                setMessage({ type: 'success', text: "Proveedor actualizado." });
            } else {
                await createSupplierAction({
                    rfc: data.rfc,
                    business_name: data.business_name,
                    fiscal_regime: data.fiscal_regime || null,
                    fiscal_zip_code: data.fiscal_zip_code || null,
                    email: data.email || null,
                    phone: data.phone || null,
                    address: data.address || null,
                    constancia_pdf_url: pdfUrl,
                });
                setMessage({ type: 'success', text: "Proveedor agregado." });
            }

            handleCloseForm();
            fetchSuppliers();
            setTimeout(() => setMessage(null), 3000);
        } catch (error: any) {
            setMessage({ type: 'error', text: error.message || "Error." });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-3 sm:p-6 md:p-8 lg:p-10 font-[family-name:var(--font-sans)]">
            <div className="w-full space-y-8">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors text-neutral-400 hover:text-white border border-neutral-700"><ArrowLeft className="w-5 h-5" /></Link>
                        <div>
                            <h1 className="text-3xl font-bold text-white flex items-center gap-3"><Truck className="w-8 h-8 text-rose-400" />Proveedores</h1>
                            <p className="text-neutral-400 text-sm mt-1">Administra tus proveedores y sus datos fiscales</p>
                        </div>
                    </div>
                    <button onClick={isFormOpen ? handleCloseForm : () => setIsFormOpen(true)} className="flex items-center justify-center gap-2 bg-rose-500 hover:bg-rose-600 text-white px-6 py-3 rounded-xl font-medium transition-all hover:shadow-[0_0_20px_rgba(244,63,94,0.4)] active:scale-95">
                        {isFormOpen ? "Cancelar" : <><Plus className="w-5 h-5" /> Agregar Proveedor</>}
                    </button>
                </header>

                {message && (
                    <div className={cn("p-4 rounded-xl border flex items-center gap-3", message.type === 'success' ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-red-500/10 border-red-500/30 text-red-400")}>
                        <div className={cn("w-2 h-2 rounded-full", message.type === 'success' ? "bg-emerald-500" : "bg-red-500")} />
                        {message.text}
                    </div>
                )}

                {isFormOpen && (
                    <div className="bg-neutral-800/60 border border-neutral-700 shadow-xl rounded-3xl p-6 md:p-8">
                        <h2 className="text-xl font-semibold text-white mb-6 flex items-center gap-2 border-b border-neutral-700 pb-4">
                            <FileText className="w-5 h-5 text-rose-400" />{editingId ? "Editar Proveedor" : "Nuevo Proveedor"}
                        </h2>

                        {/* Banner de CSF: dos opciones — subir CSF (auto-rellenar) o capturar manual */}
                        {!editingId && (
                            <div className="mb-6 bg-gradient-to-br from-rose-500/10 to-amber-500/10 border border-rose-500/30 rounded-2xl p-5">
                                <div className="flex items-start gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-rose-500/20 flex items-center justify-center flex-shrink-0">
                                        <Sparkles className="w-5 h-5 text-rose-300" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h3 className="text-sm font-bold text-white mb-1">¿Tienes la Constancia de Situación Fiscal?</h3>
                                        <p className="text-xs text-neutral-300 mb-3">
                                            Sube el PDF del SAT y autollenamos los datos fiscales por ti. Si no la tienes, llena los campos manualmente abajo.
                                        </p>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <label className={cn("inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium cursor-pointer transition-all",
                                                csfParsing
                                                    ? "bg-rose-500/30 text-rose-200 cursor-wait"
                                                    : "bg-rose-500 hover:bg-rose-600 text-white hover:shadow-[0_0_15px_rgba(244,63,94,0.4)]"
                                            )}>
                                                {csfParsing ? (
                                                    <><Loader2 className="w-4 h-4 animate-spin" /> Extrayendo datos…</>
                                                ) : (
                                                    <><Sparkles className="w-4 h-4" /> Subir CSF (auto-rellenar)</>
                                                )}
                                                <input
                                                    type="file"
                                                    accept=".pdf,image/*"
                                                    className="hidden"
                                                    disabled={csfParsing}
                                                    onChange={handleCsfUpload}
                                                />
                                            </label>
                                            <span className="text-[11px] text-neutral-400">o llena el formulario manualmente ↓</span>
                                        </div>
                                        {selectedFile && (
                                            <div className="mt-3 flex items-center gap-2 text-xs text-neutral-300">
                                                <FileCheck className="w-3.5 h-3.5 text-emerald-400" />
                                                <span className="truncate flex-1">{selectedFile.name}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => { setSelectedFile(null); setCsfExtracted(null); }}
                                                    className="p-1 text-neutral-500 hover:text-rose-300"
                                                >
                                                    <X className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        )}
                                        {csfExtracted && (
                                            <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2 text-[11px]">
                                                {csfExtracted.rfc && <Chip label="RFC" value={csfExtracted.rfc} ok />}
                                                {csfExtracted.business_name && <Chip label="Razón Social" value={csfExtracted.business_name} ok />}
                                                {csfExtracted.fiscal_regime && <Chip label="Régimen" value={`${csfExtracted.fiscal_regime}${csfExtracted.fiscal_regime_label ? ' — ' + csfExtracted.fiscal_regime_label : ''}`} ok />}
                                                {csfExtracted.fiscal_zip_code && <Chip label="CP Fiscal" value={csfExtracted.fiscal_zip_code} ok />}
                                                {csfExtracted.email && <Chip label="Email" value={csfExtracted.email} ok />}
                                                {csfExtracted.phone && <Chip label="Teléfono" value={csfExtracted.phone} ok />}
                                                {csfExtracted.address && <Chip label="Dirección" value={csfExtracted.address} ok />}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-neutral-300 ml-1">RFC *</label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none"><Hash className="h-4 w-4 text-neutral-500" /></div>
                                        <input {...register("rfc")} className={cn("w-full bg-neutral-900/50 border rounded-xl pl-11 pr-4 py-3 text-white placeholder-neutral-500 focus:outline-none focus:ring-2 transition-all uppercase", errors.rfc ? "border-red-500/50 focus:ring-red-500/20" : "border-neutral-700 focus:border-rose-500 focus:ring-rose-500/20")} placeholder="XAXX010101000" maxLength={13} />
                                    </div>
                                    {errors.rfc && <p className="text-red-400 text-xs ml-1">{errors.rfc.message}</p>}
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-neutral-300 ml-1">Razón Social *</label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none"><Truck className="h-4 w-4 text-neutral-500" /></div>
                                        <input {...register("business_name")} className={cn("w-full bg-neutral-900/50 border rounded-xl pl-11 pr-4 py-3 text-white placeholder-neutral-500 focus:outline-none focus:ring-2 transition-all", errors.business_name ? "border-red-500/50 focus:ring-red-500/20" : "border-neutral-700 focus:border-rose-500 focus:ring-rose-500/20")} placeholder="PROVEEDOR S.A. DE C.V." />
                                    </div>
                                    {errors.business_name && <p className="text-red-400 text-xs ml-1">{errors.business_name.message}</p>}
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-neutral-300 ml-1">Régimen Fiscal</label>
                                    <input {...register("fiscal_regime")} className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-4 py-3 text-white placeholder-neutral-500 focus:outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 transition-all" placeholder="601" />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-neutral-300 ml-1">C.P. Fiscal</label>
                                    <input {...register("fiscal_zip_code")} className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-4 py-3 text-white placeholder-neutral-500 focus:outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 transition-all" placeholder="00000" maxLength={5} />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-neutral-300 ml-1">Email</label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none"><Mail className="h-4 w-4 text-neutral-500" /></div>
                                        <input type="email" {...register("email")} className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl pl-11 pr-4 py-3 text-white placeholder-neutral-500 focus:outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 transition-all" placeholder="proveedor@email.com" />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-neutral-300 ml-1">Teléfono</label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none"><Phone className="h-4 w-4 text-neutral-500" /></div>
                                        <input {...register("phone")} className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl pl-11 pr-4 py-3 text-white placeholder-neutral-500 focus:outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 transition-all" placeholder="55 1234 5678" />
                                    </div>
                                </div>
                                <div className="space-y-2 md:col-span-2 lg:col-span-3">
                                    <label className="text-sm font-medium text-neutral-300 ml-1">Dirección</label>
                                    <textarea {...register("address")} className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-4 py-3 text-white placeholder-neutral-500 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 transition-all min-h-[80px] focus:outline-none" placeholder="Calle, Ciudad, Estado..." />
                                </div>
                            </div>
                            <div className="flex justify-end gap-3 pt-4 border-t border-neutral-700">
                                <button type="button" onClick={handleCloseForm} className="px-6 py-3 rounded-xl font-medium text-neutral-300 hover:text-white hover:bg-neutral-700 transition-colors">Cancelar</button>
                                <button type="submit" disabled={isSubmitting} className="bg-rose-500 hover:bg-rose-600 disabled:bg-rose-500/50 text-white px-8 py-3 rounded-xl font-medium transition-all shadow-[0_0_15px_rgba(244,63,94,0.2)] hover:shadow-[0_0_20px_rgba(244,63,94,0.4)] flex items-center gap-2">
                                    {isSubmitting ? <><RefreshCw className="w-5 h-5 animate-spin" /> Guardando...</> : editingId ? "Actualizar" : "Guardar"}
                                </button>
                            </div>
                        </form>
                    </div>
                )}

                <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl overflow-hidden backdrop-blur-sm">
                    <div className="p-6 border-b border-neutral-700/50 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-neutral-800/20">
                        <div className="flex items-center gap-3 flex-wrap">
                            <h2 className="text-xl font-semibold text-white">Proveedores Registrados</h2>
                            <span className="text-xs text-neutral-500">({visibleSuppliers.length} de {suppliers.length})</span>
                            {obsoleteCount > 0 && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                    {obsoleteCount} obsoleto{obsoleteCount !== 1 ? "s" : ""}
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Buscar RFC o razón social..."
                                className="bg-neutral-900/60 border border-neutral-700/50 rounded-lg px-3 py-1.5 text-sm text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-rose-500/50 w-56"
                            />
                            <label className="flex items-center gap-1.5 text-xs text-neutral-300 cursor-pointer select-none">
                                <input type="checkbox" checked={showObsolete} onChange={(e) => setShowObsolete(e.target.checked)} className="w-4 h-4 accent-rose-500" />
                                <Archive className="w-3.5 h-3.5" /> Mostrar obsoletos
                            </label>
                            <button onClick={fetchSuppliers} className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium" disabled={isLoading}>
                                <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin text-rose-400")} /> Refresh
                            </button>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-neutral-900/50 text-neutral-400 uppercase text-xs font-semibold tracking-wider">
                                <tr>
                                    <th className="px-6 py-4 rounded-tl-xl">RFC</th>
                                    <th className="px-6 py-4">Razón Social</th>
                                    <th className="px-6 py-4">Email</th>
                                    <th className="px-6 py-4">Teléfono</th>
                                    <th className="px-6 py-4">Constancia</th>
                                    <th className="px-6 py-4">Estado</th>
                                    <th className="px-6 py-4 rounded-tr-xl text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-700/50">
                                {isLoading ? (
                                    <tr><td colSpan={7} className="px-6 py-12 text-center text-neutral-400"><RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-rose-500" />Cargando...</td></tr>
                                ) : visibleSuppliers.length === 0 ? (
                                    <tr><td colSpan={7} className="px-6 py-12 text-center text-neutral-400">
                                        <div className="bg-neutral-800/50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border border-neutral-700"><Truck className="w-8 h-8 text-neutral-500" /></div>
                                        <p className="text-lg text-neutral-300 font-medium">
                                            {search.trim() ? "Sin resultados para esa búsqueda" : showObsolete ? "No hay proveedores obsoletos" : "No hay proveedores"}
                                        </p>
                                        {!search.trim() && !showObsolete && <p className="text-sm mt-1">Agrega tu primer proveedor.</p>}
                                    </td></tr>
                                ) : (
                                    visibleSuppliers.map((s) => {
                                        const isObsolete = s.is_active === false;
                                        return (
                                            <tr key={s.id} className={cn(
                                                "transition-colors group",
                                                isObsolete
                                                    ? "bg-neutral-900/30 text-neutral-500 hover:bg-neutral-800/40"
                                                    : "hover:bg-neutral-800/80"
                                            )}>
                                                <td className="px-6 py-4">
                                                    <span className={cn(
                                                        "font-mono font-medium px-2 py-1 rounded-md border",
                                                        isObsolete
                                                            ? "text-neutral-500 line-through bg-neutral-700/20 border-neutral-700/30"
                                                            : "text-rose-300 bg-rose-500/10 border-rose-500/20"
                                                    )}>
                                                        {s.rfc}
                                                    </span>
                                                </td>
                                                <td className={cn("px-6 py-4 font-medium", isObsolete ? "text-neutral-500 line-through" : "text-neutral-200")}>
                                                    {s.business_name}
                                                </td>
                                                <td className="px-6 py-4 text-neutral-400">{s.email || '—'}</td>
                                                <td className="px-6 py-4 text-neutral-400">{s.phone || '—'}</td>
                                                <td className="px-6 py-4">
                                                    {s.constancia_pdf_url ? (
                                                        <a href={s.constancia_pdf_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 px-2.5 py-1.5 rounded-lg border border-emerald-500/20"><FileCheck className="w-3.5 h-3.5" /> Ver PDF</a>
                                                    ) : <span className="text-neutral-600 text-xs italic">No</span>}
                                                </td>
                                                <td className="px-6 py-4">
                                                    {isObsolete ? (
                                                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                                            <Archive className="w-3 h-3" /> Obsoleto
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                                                            Activo
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <div className="flex items-center justify-end gap-1">
                                                        <button onClick={() => handleEditClick(s)} className="p-2 text-rose-400 hover:text-white bg-rose-500/10 hover:bg-rose-500 transition-colors rounded-lg border border-rose-500/20" title="Editar"><Edit2 className="w-4 h-4" /></button>
                                                        {isObsolete ? (
                                                            <button onClick={() => handleRestore(s)} className="p-2 text-emerald-400 hover:text-white bg-emerald-500/10 hover:bg-emerald-500 transition-colors rounded-lg border border-emerald-500/20" title="Restaurar"><ArchiveRestore className="w-4 h-4" /></button>
                                                        ) : (
                                                            <button onClick={() => handleObsolete(s)} className="p-2 text-amber-400 hover:text-white bg-amber-500/10 hover:bg-amber-500 transition-colors rounded-lg border border-amber-500/20" title="Obsoletar"><Archive className="w-4 h-4" /></button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}

function Chip({ label, value, ok }: { label: string; value: string; ok: boolean }) {
    return (
        <div className="flex items-center gap-1.5 bg-neutral-900/60 border border-neutral-700/50 rounded-lg px-2 py-1">
            {ok && <CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />}
            <span className="text-neutral-500">{label}:</span>
            <span className="text-neutral-200 truncate font-mono">{value}</span>
        </div>
    );
}
