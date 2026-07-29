"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { supabase } from "@/lib/supabase";
import { createClientAction, updateClientAction, deleteClientAction as obsoleteClientAction, restoreClientAction } from "@/app/actions/clients";
import { Building2, FileText, Hash, Mail, MapPin, Phone, RefreshCw, Plus, ArrowLeft, Users, Download, FileCheck, Edit2, Eye, EyeOff, Archive, ArchiveRestore } from "lucide-react";
import Link from "next/link";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

const clientSchema = z.object({
    rfc: z.string().min(12, "RFC must be at least 12 characters").max(13, "RFC cannot exceed 13 characters").toUpperCase(),
    business_name: z.string().min(3, "Business Name is required"),
    fiscal_regime: z.string().min(3, "Fiscal Regime is required"),
    fiscal_zip_code: z.string().length(5, "Zip Code must be exactly 5 digits").regex(/^\d+$/, "Must be numbers only"),
    email: z.string().email("Invalid email address").optional().or(z.literal("")),
    phone: z.string().optional(),
    address: z.string().optional(),
    payment_days: z.coerce.number().catch(0),
    requires_advance: z.boolean().optional(),
    advance_pct: z.coerce.number().catch(0),
});

type ClientFormValues = z.infer<typeof clientSchema>;

type Client = ClientFormValues & {
    id: string;
    constancia_pdf_url?: string;
    constancia_updated_at?: string;
    created_at: string;
    is_active?: boolean;
};

export default function ClientsPage() {
    const [clients, setClients] = useState<Client[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingClientId, setEditingClientId] = useState<string | null>(null);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [showObsolete, setShowObsolete] = useState(false);
    const [search, setSearch] = useState("");

    const {
        register,
        handleSubmit,
        reset,
        formState: { errors }
    } = useForm<ClientFormValues>({
        resolver: zodResolver(clientSchema) as any,
        defaultValues: {
            rfc: "", business_name: "", fiscal_regime: "", fiscal_zip_code: "",
            email: "", phone: "", address: "", payment_days: 0,
            requires_advance: false, advance_pct: 50,
        }
    });

    const fetchClients = async () => {
        setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('clients')
                .select('*')
                .order('is_active', { ascending: false })  // activos primero
                .order('created_at', { ascending: false });

            if (error) throw error;
            setClients(data || []);
        } catch (error: any) {
            console.error("Error fetching clients:", error);
            setMessage({ type: 'error', text: "Failed to load clients." });
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchClients();
    }, []);

    // Filtrar por texto + toggle de obsoletos
    const visibleClients = useMemo(() => {
        let list = clients;
        if (!showObsolete) {
            list = list.filter((c) => c.is_active !== false);
        }
        if (search.trim()) {
            const q = search.trim().toLowerCase();
            list = list.filter((c) =>
                (c.rfc || "").toLowerCase().includes(q) ||
                (c.business_name || "").toLowerCase().includes(q) ||
                (c.email || "").toLowerCase().includes(q)
            );
        }
        return list;
    }, [clients, showObsolete, search]);

    const obsoleteCount = useMemo(() => clients.filter((c) => c.is_active === false).length, [clients]);

    const handleEditClick = (client: Client) => {
        setEditingClientId(client.id);
        reset({
            rfc: client.rfc,
            business_name: client.business_name,
            fiscal_regime: client.fiscal_regime,
            fiscal_zip_code: client.fiscal_zip_code,
            email: client.email || "",
            phone: client.phone || "",
            address: client.address || "",
            payment_days: (client as any).payment_days ?? 0,
            requires_advance: (client as any).requires_advance ?? false,
            advance_pct: (client as any).advance_pct ?? 50,
        });
        setSelectedFile(null);
        setIsFormOpen(true);
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    const handleCloseForm = () => {
        setIsFormOpen(false);
        setEditingClientId(null);
        setSelectedFile(null);
        reset({
            rfc: "", business_name: "", fiscal_regime: "", fiscal_zip_code: "",
            email: "", phone: "", address: "", payment_days: 0,
            requires_advance: false, advance_pct: 50,
        });
    };

    const onSubmit = async (data: ClientFormValues) => {
        setIsSubmitting(true);
        setMessage(null);
        try {
            let pdfUrl: string | null = null;
            let pdfUpdatedAt: string | null = null;

            // 1. Upload File if selected
            if (selectedFile) {
                const fileExt = selectedFile.name.split('.').pop();
                const fileName = `${data.rfc}-${Date.now()}.${fileExt}`;
                const filePath = `${fileName}`;

                const { error: uploadError, data: uploadData } = await supabase.storage
                    .from('client_documents')
                    .upload(filePath, selectedFile, {
                        cacheControl: '3600',
                        upsert: true,
                    });

                if (uploadError) throw new Error(`File upload failed: ${uploadError.message}`);

                const { data: publicUrlData } = supabase.storage
                    .from('client_documents')
                    .getPublicUrl(filePath);

                pdfUrl = publicUrlData.publicUrl;
                pdfUpdatedAt = new Date().toISOString();
            }

            // 2. Crear o actualizar via server action (gateado)
            if (editingClientId) {
                await updateClientAction({
                    id: editingClientId,
                    rfc: data.rfc,
                    business_name: data.business_name,
                    fiscal_regime: data.fiscal_regime,
                    fiscal_zip_code: data.fiscal_zip_code,
                    email: data.email || null,
                    phone: data.phone || null,
                    address: data.address || null,
                    payment_days: data.payment_days,
                    requires_advance: data.requires_advance ?? false,
                    advance_pct: data.requires_advance ? data.advance_pct : null,
                    constancia_pdf_url: pdfUrl,
                });
                setMessage({ type: 'success', text: "Cliente actualizado." });
            } else {
                await createClientAction({
                    rfc: data.rfc,
                    business_name: data.business_name,
                    fiscal_regime: data.fiscal_regime,
                    fiscal_zip_code: data.fiscal_zip_code,
                    email: data.email || null,
                    phone: data.phone || null,
                    address: data.address || null,
                    payment_days: data.payment_days,
                    requires_advance: data.requires_advance ?? false,
                    advance_pct: data.requires_advance ? data.advance_pct : null,
                    constancia_pdf_url: pdfUrl,
                });
                setMessage({ type: 'success', text: "Cliente agregado." });
            }

            handleCloseForm();
            fetchClients();
            setTimeout(() => setMessage(null), 3000);
        } catch (error: any) {
            console.error("Error saving client:", error);
            setMessage({ type: 'error', text: error.message || "Error al guardar." });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleObsolete = async (client: Client) => {
        if (!confirm(`¿Obsoletar al cliente "${client.business_name}"?\n\nNo se borrará, solo se ocultará de las listas. Se puede restaurar después.`)) return;
        setMessage(null);
        try {
            await obsoleteClientAction(client.id);
            setMessage({ type: 'success', text: `Cliente "${client.business_name}" obsoletado.` });
            fetchClients();
            setTimeout(() => setMessage(null), 3000);
        } catch (e: any) {
            setMessage({ type: 'error', text: e.message || "Error al obsoletar." });
        }
    };

    const handleRestore = async (client: Client) => {
        if (!confirm(`¿Restaurar al cliente "${client.business_name}"?`)) return;
        setMessage(null);
        try {
            await restoreClientAction(client.id);
            setMessage({ type: 'success', text: `Cliente "${client.business_name}" restaurado.` });
            fetchClients();
            setTimeout(() => setMessage(null), 3000);
        } catch (e: any) {
            setMessage({ type: 'error', text: e.message || "Error al restaurar." });
        }
    };

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-3 sm:p-6 md:p-8 lg:p-10 font-[family-name:var(--font-sans)]">
            <div className="w-full space-y-8">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors text-neutral-400 hover:text-white border border-neutral-700"><ArrowLeft className="w-5 h-5" /></Link>
                        <div>
                            <h1 className="text-3xl font-bold text-white flex items-center gap-3"><Building2 className="w-8 h-8 text-orange-400" />Clientes</h1>
                            <p className="text-neutral-400 text-sm mt-1">Administra tus clientes y sus datos fiscales</p>
                        </div>
                    </div>
                    <button onClick={isFormOpen ? handleCloseForm : () => setIsFormOpen(true)} className="flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-6 py-3 rounded-xl font-medium transition-all hover:shadow-[0_0_20px_rgba(249,115,22,0.4)] active:scale-95">
                        {isFormOpen ? "Cancelar" : <><Plus className="w-5 h-5" /> Agregar Cliente</>}
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
                            <FileText className="w-5 h-5 text-orange-400" />{editingClientId ? "Editar Cliente" : "Nuevo Cliente"}
                        </h2>
                        <form onSubmit={handleSubmit(onSubmit as any)} className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-neutral-300 ml-1">RFC *</label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none"><Hash className="h-4 w-4 text-neutral-500" /></div>
                                        <input {...register("rfc")} className={cn("w-full bg-neutral-900/50 border rounded-xl pl-11 pr-4 py-3 text-white placeholder-neutral-500 focus:outline-none focus:ring-2 transition-all uppercase", errors.rfc ? "border-red-500/50 focus:ring-red-500/20" : "border-neutral-700 focus:border-orange-500 focus:ring-orange-500/20")} placeholder="XAXX010101000" maxLength={13} />
                                    </div>
                                    {errors.rfc && <p className="text-red-400 text-xs ml-1">{errors.rfc.message}</p>}
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-neutral-300 ml-1">Razón Social *</label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none"><Building2 className="h-4 w-4 text-neutral-500" /></div>
                                        <input {...register("business_name")} className={cn("w-full bg-neutral-900/50 border rounded-xl pl-11 pr-4 py-3 text-white placeholder-neutral-500 focus:outline-none focus:ring-2 transition-all", errors.business_name ? "border-red-500/50 focus:ring-red-500/20" : "border-neutral-700 focus:border-orange-500 focus:ring-orange-500/20")} placeholder="RAZON SOCIAL S.A. DE C.V." />
                                    </div>
                                    {errors.business_name && <p className="text-red-400 text-xs ml-1">{errors.business_name.message}</p>}
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-neutral-300 ml-1">Régimen Fiscal *</label>
                                    <select {...register("fiscal_regime")} className={cn("w-full bg-neutral-900/50 border rounded-xl pl-4 pr-4 py-3 text-white focus:outline-none focus:ring-2 transition-all appearance-none", errors.fiscal_regime ? "border-red-500/50 focus:ring-red-500/20" : "border-neutral-700 focus:border-orange-500 focus:ring-orange-500/20")}>
                                        <option value="" disabled>Selecciona un régimen</option>
                                        <optgroup label="Régimen Fiscal – Personas Morales" className="bg-neutral-900 text-neutral-300 font-semibold">
                                            <option value="601">601 - General de Ley Personas Morales</option>
                                            <option value="603">603 - Personas Morales con Fines no Lucrativos</option>
                                            <option value="610">610 - Residentes en el Extranjero sin Establecimiento Permanente en México</option>
                                            <option value="620">620 - Sociedades Cooperativas de Producción que optan por diferir sus ingresos</option>
                                            <option value="622">622 - Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras</option>
                                            <option value="623">623 - Opcional para Grupos de Sociedades</option>
                                            <option value="624">624 - Coordinados</option>
                                            <option value="626">626 - Régimen Simplificado de Confianza (RESICO PM)</option>
                                        </optgroup>
                                        <optgroup label="Régimen Fiscal – Personas Físicas" className="bg-neutral-900 text-neutral-300 font-semibold">
                                            <option value="605">605 - Sueldos y Salarios e Ingresos Asimilados a Salarios</option>
                                            <option value="606">606 - Arrendamiento</option>
                                            <option value="607">607 - Régimen de Enajenación o Adquisición de Bienes</option>
                                            <option value="608">608 - Demás ingresos</option>
                                            <option value="611">611 - Ingresos por Dividendos (socios y accionistas)</option>
                                            <option value="612">612 - Personas Físicas con Actividades Empresariales y Profesionales</option>
                                            <option value="614">614 - Ingresos por intereses</option>
                                            <option value="615">615 - Régimen de los ingresos por obtención de premios</option>
                                            <option value="616">616 - Sin obligaciones fiscales</option>
                                            <option value="621">621 - Incorporación Fiscal (RIF)</option>
                                            <option value="625">625 - Actividades Empresariales con ingresos a través de Plataformas Tecnológicas</option>
                                            <option value="626">626 - Régimen Simplificado de Confianza (RESICO PF)</option>
                                        </optgroup>
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-neutral-300 ml-1">C.P. Fiscal *</label>
                                    <input {...register("fiscal_zip_code")} className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-4 py-3 text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 transition-all" placeholder="00000" maxLength={5} />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-neutral-300 ml-1">Email</label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none"><Mail className="h-4 w-4 text-neutral-500" /></div>
                                        <input type="email" {...register("email")} className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl pl-11 pr-4 py-3 text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 transition-all" placeholder="cliente@email.com" />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-neutral-300 ml-1">Teléfono</label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none"><Phone className="h-4 w-4 text-neutral-500" /></div>
                                        <input {...register("phone")} className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl pl-11 pr-4 py-3 text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 transition-all" placeholder="55 1234 5678" />
                                    </div>
                                </div>
                                <div className="space-y-2 md:col-span-2 lg:col-span-3">
                                    <label className="text-sm font-medium text-neutral-300 ml-1">Dirección</label>
                                    <textarea {...register("address")} className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-4 py-3 text-white placeholder-neutral-500 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 transition-all min-h-[80px] focus:outline-none" placeholder="Calle, Ciudad, Estado..." />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-neutral-300 ml-1">Días de crédito (payment_days)</label>
                                    <input type="number" min="0" max="365" {...register("payment_days", { valueAsNumber: true })} className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 transition-all" placeholder="0" />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-neutral-300 ml-1">¿Requiere anticipo?</label>
                                    <label className="flex items-center gap-3 w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-4 py-3 cursor-pointer hover:border-orange-500/50 transition-colors">
                                        <input type="checkbox" {...register("requires_advance")} className="w-5 h-5 accent-orange-500" />
                                        <span className="text-sm text-neutral-200">Requiere anticipo</span>
                                    </label>
                                </div>
                                <div className="space-y-2 md:col-span-2">
                                    <label className="text-sm font-medium text-neutral-300 ml-1">Subir Constancia de Situación Fiscal (PDF)</label>
                                    <input type="file" accept=".pdf" onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-4 py-3 text-white file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-orange-500/20 file:text-orange-400 hover:file:bg-orange-500/30 transition-all focus:outline-none cursor-pointer" />
                                </div>
                            </div>

                            <div className="flex justify-end gap-3 pt-4 border-t border-neutral-700">
                                <button type="button" onClick={handleCloseForm} className="px-6 py-3 rounded-xl font-medium text-neutral-300 hover:text-white hover:bg-neutral-700 transition-colors">Cancelar</button>
                                <button type="submit" disabled={isSubmitting} className="bg-orange-500 hover:bg-orange-600 disabled:bg-orange-500/50 text-white px-8 py-3 rounded-xl font-medium transition-all shadow-[0_0_15px_rgba(249,115,22,0.2)] hover:shadow-[0_0_20px_rgba(249,115,22,0.4)] flex items-center gap-2">
                                    {isSubmitting ? <><RefreshCw className="w-5 h-5 animate-spin" /> {editingClientId ? "Actualizando..." : "Guardando..."}</> : editingClientId ? "Actualizar" : "Guardar"}
                                </button>
                            </div>
                        </form>
                    </div>
                )}

                {/* Tabla de clientes con filtro de obsoletos */}
                <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl overflow-hidden backdrop-blur-sm">
                    <div className="p-6 border-b border-neutral-700/50 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-neutral-800/20">
                        <div className="flex items-center gap-3 flex-wrap">
                            <h2 className="text-xl font-semibold text-white">Clientes Registrados</h2>
                            <span className="text-xs text-neutral-500">({visibleClients.length} de {clients.length})</span>
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
                                className="bg-neutral-900/60 border border-neutral-700/50 rounded-lg px-3 py-1.5 text-sm text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-orange-500/50 w-56"
                            />
                            <label className="flex items-center gap-1.5 text-xs text-neutral-300 cursor-pointer select-none">
                                <input type="checkbox" checked={showObsolete} onChange={(e) => setShowObsolete(e.target.checked)} className="w-4 h-4 accent-orange-500" />
                                <Archive className="w-3.5 h-3.5" /> Mostrar obsoletos
                            </label>
                            <button onClick={fetchClients} className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium" disabled={isLoading}>
                                <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin text-orange-400")} /> Refresh
                            </button>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-neutral-900/50 text-neutral-400 uppercase text-xs font-semibold tracking-wider">
                                <tr>
                                    <th className="px-6 py-4 rounded-tl-xl">RFC</th>
                                    <th className="px-6 py-4">Razón Social</th>
                                    <th className="px-6 py-4">Régimen</th>
                                    <th className="px-6 py-4">C.P.</th>
                                    <th className="px-6 py-4">Email</th>
                                    <th className="px-6 py-4">Constancia</th>
                                    <th className="px-6 py-4">Estado</th>
                                    <th className="px-6 py-4 rounded-tr-xl text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-700/50">
                                {isLoading ? (
                                    <tr><td colSpan={8} className="px-6 py-12 text-center text-neutral-400"><RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-orange-500" />Cargando clientes...</td></tr>
                                ) : visibleClients.length === 0 ? (
                                    <tr><td colSpan={8} className="px-6 py-12 text-center text-neutral-400">
                                        <div className="bg-neutral-800/50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border border-neutral-700"><Users className="w-8 h-8 text-neutral-500" /></div>
                                        <p className="text-lg text-neutral-300 font-medium">
                                            {search.trim() ? "Sin resultados para esa búsqueda" : showObsolete ? "No hay clientes obsoletos" : "No hay clientes"}
                                        </p>
                                        {!search.trim() && !showObsolete && <p className="text-sm mt-1">Agrega tu primer cliente.</p>}
                                    </td></tr>
                                ) : (
                                    visibleClients.map((client) => {
                                        const isObsolete = client.is_active === false;
                                        return (
                                            <tr key={client.id} className={cn(
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
                                                            : "text-orange-300 bg-orange-500/10 border-orange-500/20"
                                                    )}>
                                                        {client.rfc}
                                                    </span>
                                                </td>
                                                <td className={cn("px-6 py-4 font-medium", isObsolete ? "text-neutral-500 line-through" : "text-neutral-200")}>
                                                    {client.business_name}
                                                </td>
                                                <td className="px-6 py-4 text-neutral-400">{client.fiscal_regime}</td>
                                                <td className="px-6 py-4 text-neutral-400">{client.fiscal_zip_code}</td>
                                                <td className="px-6 py-4 text-neutral-400">{client.email || '-'}</td>
                                                <td className="px-6 py-4">
                                                    {client.constancia_pdf_url ? (
                                                        <a href={client.constancia_pdf_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 transition-colors bg-emerald-500/10 hover:bg-emerald-500/20 px-2.5 py-1.5 rounded-lg border border-emerald-500/20">
                                                            <FileCheck className="w-3.5 h-3.5" /> Ver PDF
                                                        </a>
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
                                                        <button onClick={() => handleEditClick(client)} className="p-2 text-orange-400 hover:text-white bg-orange-500/10 hover:bg-orange-500 transition-colors rounded-lg border border-orange-500/20" title="Editar">
                                                            <Edit2 className="w-4 h-4" />
                                                        </button>
                                                        {isObsolete ? (
                                                            <button onClick={() => handleRestore(client)} className="p-2 text-emerald-400 hover:text-white bg-emerald-500/10 hover:bg-emerald-500 transition-colors rounded-lg border border-emerald-500/20" title="Restaurar">
                                                                <ArchiveRestore className="w-4 h-4" />
                                                            </button>
                                                        ) : (
                                                            <button onClick={() => handleObsolete(client)} className="p-2 text-amber-400 hover:text-white bg-amber-500/10 hover:bg-amber-500 transition-colors rounded-lg border border-amber-500/20" title="Obsoletar">
                                                                <Archive className="w-4 h-4" />
                                                            </button>
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
