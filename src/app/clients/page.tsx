"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { supabase } from "@/lib/supabase";
import { Building2, FileText, Hash, Mail, MapPin, Phone, RefreshCw, Plus, ArrowLeft, Users, Download, FileCheck, Edit2 } from "lucide-react";
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
});

type ClientFormValues = z.infer<typeof clientSchema>;

type Client = ClientFormValues & {
    id: string;
    constancia_pdf_url?: string;
    constancia_updated_at?: string;
    created_at: string;
};

export default function ClientsPage() {
    const [clients, setClients] = useState<Client[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingClientId, setEditingClientId] = useState<string | null>(null);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);

    const {
        register,
        handleSubmit,
        reset,
        formState: { errors }
    } = useForm<ClientFormValues>({
        resolver: zodResolver(clientSchema) as any,
        defaultValues: {
            rfc: "",
            business_name: "",
            fiscal_regime: "",
            fiscal_zip_code: "",
            email: "",
            phone: "",
            address: "",
            payment_days: 0,
            requires_advance: false,
        }
    });

    const fetchClients = async () => {
        setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('clients')
                .select('*')
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
        });
        setSelectedFile(null); // Clear selected file when editing
        setIsFormOpen(true);
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    const handleCloseForm = () => {
        setIsFormOpen(false);
        setEditingClientId(null);
        setSelectedFile(null);
        reset({
            rfc: "",
            business_name: "",
            fiscal_regime: "",
            fiscal_zip_code: "",
            email: "",
            phone: "",
            address: "",
            payment_days: 0,
            requires_advance: false,
        });
    };

    const onSubmit = async (data: ClientFormValues) => {
        setIsSubmitting(true);
        setMessage(null);
        try {
            let pdfUrl = null;
            let pdfUpdatedAt = null;

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

                // Get public URL
                const { data: publicUrlData } = supabase.storage
                    .from('client_documents')
                    .getPublicUrl(filePath);

                pdfUrl = publicUrlData.publicUrl;
                pdfUpdatedAt = new Date().toISOString();
            }

            // 2. Insert or Update Client Record
            const recordData: any = {
                ...data,
            };

            // Only override URL/Date if a physical file was actually uploaded.
            // If not selected, it inherits whatever the db has.
            if (pdfUrl) {
                recordData.constancia_pdf_url = pdfUrl;
                recordData.constancia_updated_at = pdfUpdatedAt;
            }

            if (editingClientId) {
                const { error } = await supabase.from('clients').update(recordData).eq('id', editingClientId);
                if (error) {
                    if (error.code === '23505') throw new Error(`RFC ${data.rfc} is already registered to another client.`);
                    throw error;
                }
                setMessage({ type: 'success', text: "Client updated successfully!" });
            } else {
                const { error } = await supabase.from('clients').insert([recordData]);
                if (error) {
                    if (error.code === '23505') throw new Error(`RFC ${data.rfc} is already registered.`);
                    throw error;
                }
                setMessage({ type: 'success', text: "Client added successfully!" });
            }

            handleCloseForm();
            fetchClients();

            // Clear success message after 3 seconds
            setTimeout(() => setMessage(null), 3000);
        } catch (error: any) {
            console.error("Error inserting client:", error);
            setMessage({ type: 'error', text: error.message || "Failed to add client." });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-6 md:p-10 font-[family-name:var(--font-sans)]">
            <div className="w-full space-y-8">

                {/* Header */}
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors text-neutral-400 hover:text-white border border-neutral-700">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div>
                            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                                <Building2 className="w-8 h-8 text-orange-400" />
                                Clients
                            </h1>
                            <p className="text-neutral-400 text-sm mt-1">Manage CFDI 4.0 Compliant Records</p>
                        </div>
                    </div>

                    <button
                        onClick={isFormOpen ? handleCloseForm : () => setIsFormOpen(true)}
                        className="flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-6 py-3 rounded-xl font-medium transition-all hover:shadow-[0_0_20px_rgba(99,102,241,0.4)] active:scale-95"
                    >
                        {isFormOpen ? "Cancel" : <><Plus className="w-5 h-5" /> Add Client</>}
                    </button>
                </header>

                {/* Global Messages */}
                {message && (
                    <div className={cn(
                        "p-4 rounded-xl border flex items-center gap-3 animate-in fade-in slide-in-from-top-4",
                        message.type === 'success' ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-red-500/10 border-red-500/30 text-red-400"
                    )}>
                        <div className={cn(
                            "w-2 h-2 rounded-full",
                            message.type === 'success' ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" : "bg-red-500"
                        )} />
                        {message.text}
                    </div>
                )}

                {/* Form Panel */}
                {isFormOpen && (
                    <div className="bg-neutral-800/60 border border-neutral-700 shadow-xl rounded-3xl p-6 md:p-8 animate-in slide-in-from-top-8 fade-in duration-300">
                        <h2 className="text-xl font-semibold text-white mb-6 flex items-center gap-2 border-b border-neutral-700 pb-4">
                            <FileText className="w-5 h-5 text-orange-400" />
                            {editingClientId ? "Edit Client Details (SAT)" : "New Client Details (SAT)"}
                        </h2>

                        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

                                {/* RFC */}
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-neutral-300 ml-1">RFC *</label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                            <Hash className="h-4 w-4 text-neutral-500" />
                                        </div>
                                        <input
                                            {...register("rfc")}
                                            className={cn(
                                                "w-full bg-neutral-900/50 border rounded-xl pl-11 pr-4 py-3 text-white placeholder-neutral-500 focus:outline-none focus:ring-2 transition-all uppercase",
                                                errors.rfc ? "border-red-500/50 focus:border-red-500 focus:ring-red-500/20" : "border-neutral-700 focus:border-orange-500 focus:ring-orange-500/20"
                                            )}
                                            placeholder="XAXX010101000"
                                            maxLength={13}
                                        />
                                    </div>
                                    {errors.rfc && <p className="text-red-400 text-xs ml-1">{errors.rfc.message}</p>}
                                </div>

                                {/* Business Name */}
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-neutral-300 ml-1">Business Name *</label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                            <Building2 className="h-4 w-4 text-neutral-500" />
                                        </div>
                                        <input
                                            {...register("business_name")}
                                            className={cn(
                                                "w-full bg-neutral-900/50 border rounded-xl pl-11 pr-4 py-3 text-white placeholder-neutral-500 focus:outline-none focus:ring-2 transition-all",
                                                errors.business_name ? "border-red-500/50 focus:border-red-500 focus:ring-red-500/20" : "border-neutral-700 focus:border-orange-500 focus:ring-orange-500/20"
                                            )}
                                            placeholder="RAZON SOCIAL S.A. DE C.V."
                                        />
                                    </div>
                                    {errors.business_name && <p className="text-red-400 text-xs ml-1">{errors.business_name.message}</p>}
                                </div>

                                {/* Fiscal Regime */}
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-neutral-300 ml-1">Fiscal Regime Code *</label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                            <FileText className="h-4 w-4 text-neutral-500" />
                                        </div>
                                        <select
                                            {...register("fiscal_regime")}
                                            className={cn(
                                                "w-full bg-neutral-900/50 border rounded-xl pl-11 pr-4 py-3 text-white placeholder-neutral-500 appearance-none focus:outline-none focus:ring-2 transition-all",
                                                errors.fiscal_regime ? "border-red-500/50 focus:border-red-500 focus:ring-red-500/20" : "border-neutral-700 focus:border-orange-500 focus:ring-orange-500/20"
                                            )}
                                        >
                                            <option value="" disabled className="text-neutral-500">Select a regime</option>

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
                                        {/* Select indicator icon */}
                                        <div className="absolute inset-y-0 right-0 flex items-center px-4 pointer-events-none text-neutral-500">
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                                        </div>
                                    </div>
                                    {errors.fiscal_regime && <p className="text-red-400 text-xs ml-1">{errors.fiscal_regime.message}</p>}
                                </div>

                                {/* Fiscal Zip Code */}
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-neutral-300 ml-1">Fiscal Zip Code *</label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                            <MapPin className="h-4 w-4 text-neutral-500" />
                                        </div>
                                        <input
                                            {...register("fiscal_zip_code")}
                                            className={cn(
                                                "w-full bg-neutral-900/50 border rounded-xl pl-11 pr-4 py-3 text-white placeholder-neutral-500 focus:outline-none focus:ring-2 transition-all",
                                                errors.fiscal_zip_code ? "border-red-500/50 focus:border-red-500 focus:ring-red-500/20" : "border-neutral-700 focus:border-orange-500 focus:ring-orange-500/20"
                                            )}
                                            placeholder="00000"
                                            maxLength={5}
                                        />
                                    </div>
                                    {errors.fiscal_zip_code && <p className="text-red-400 text-xs ml-1">{errors.fiscal_zip_code.message}</p>}
                                </div>

                                {/* Email */}
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-neutral-300 ml-1">Email</label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                            <Mail className="h-4 w-4 text-neutral-500" />
                                        </div>
                                        <input
                                            type="email"
                                            {...register("email")}
                                            className={cn(
                                                "w-full bg-neutral-900/50 border rounded-xl pl-11 pr-4 py-3 text-white placeholder-neutral-500 focus:outline-none focus:ring-2 transition-all",
                                                errors.email ? "border-red-500/50 focus:border-red-500 focus:ring-red-500/20" : "border-neutral-700 focus:border-orange-500 focus:ring-orange-500/20"
                                            )}
                                            placeholder="contacto@empresa.com"
                                        />
                                    </div>
                                    {errors.email && <p className="text-red-400 text-xs ml-1">{errors.email.message}</p>}
                                </div>

                                {/* Phone */}
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-neutral-300 ml-1">Phone</label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                            <Phone className="h-4 w-4 text-neutral-500" />
                                        </div>
                                        <input
                                            {...register("phone")}
                                            className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl pl-11 pr-4 py-3 text-white placeholder-neutral-500 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 transition-all focus:outline-none"
                                            placeholder="55 1234 5678"
                                        />
                                    </div>
                                </div>

                                {/* Constancia PDF */}
                                <div className="space-y-2 md:col-span-2 lg:col-span-3">
                                    <label className="text-sm font-medium text-neutral-300 ml-1">Constancia de Situación Fiscal (PDF)</label>
                                    <div className="relative">
                                        <input
                                            type="file"
                                            accept=".pdf"
                                            onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                                            className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-4 py-3 text-white file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-orange-500/20 file:text-orange-400 hover:file:bg-orange-500/30 transition-all focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 cursor-pointer"
                                        />
                                    </div>
                                    <p className="text-xs text-neutral-500 ml-1 font-light">
                                        {editingClientId ? "Optional. Upload a new PDF to replace the current Constancia." : "Optional. Upload the latest SAT PDF document."}
                                    </p>
                                </div>

                                {/* Address */}
                                <div className="space-y-2 md:col-span-2 lg:col-span-3">
                                    <label className="text-sm font-medium text-neutral-300 ml-1">Address</label>
                                    <div className="relative">
                                        <div className="absolute top-4 left-4 pointer-events-none">
                                            <MapPin className="h-4 w-4 text-neutral-500" />
                                        </div>
                                        <textarea
                                            {...register("address")}
                                            className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl pl-11 pr-4 py-3 text-white placeholder-neutral-500 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 transition-all min-h-[100px] resize-y focus:outline-none"
                                            placeholder="Street, City, State..."
                                        />
                                    </div>
                                </div>

                                {/* Condiciones de pago */}
                                <div className="space-y-3 md:col-span-2 lg:col-span-3 pt-4 mt-2 border-t border-neutral-700/50">
                                    <h3 className="text-sm font-semibold text-orange-400 ml-1">Condiciones de pago</h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium text-neutral-300 ml-1">Días de pago (crédito)</label>
                                            <input
                                                type="number"
                                                min="0"
                                                step="1"
                                                {...register("payment_days", { valueAsNumber: true })}
                                                className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-4 py-3 text-white placeholder-neutral-500 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 transition-all focus:outline-none"
                                                placeholder="0 = contado, 30, 60..."
                                            />
                                            <p className="text-xs text-neutral-500 ml-1 font-light">0 = pago de contado.</p>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium text-neutral-300 ml-1">Anticipo</label>
                                            <label className="flex items-center gap-3 w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-4 py-3 cursor-pointer hover:border-orange-500/50 transition-colors">
                                                <input type="checkbox" {...register("requires_advance")} className="w-5 h-5 accent-orange-500" />
                                                <span className="text-sm text-neutral-200">Requiere anticipo</span>
                                            </label>
                                            <p className="text-xs text-neutral-500 ml-1 font-light">Marca si el cliente debe dar anticipo.</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="flex justify-end gap-3 pt-4 border-t border-neutral-700">
                                <button
                                    type="button"
                                    onClick={handleCloseForm}
                                    className="px-6 py-3 rounded-xl font-medium text-neutral-300 hover:text-white hover:bg-neutral-700 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="bg-orange-500 hover:bg-orange-600 disabled:bg-orange-500/50 text-white px-8 py-3 rounded-xl font-medium transition-all shadow-[0_0_15px_rgba(99,102,241,0.2)] hover:shadow-[0_0_20px_rgba(99,102,241,0.4)] flex items-center gap-2"
                                >
                                    {isSubmitting ? (
                                        <><RefreshCw className="w-5 h-5 animate-spin" /> {editingClientId ? "Updating..." : "Saving..."}</>
                                    ) : (
                                        editingClientId ? "Update Client" : "Save Client"
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                )}

                {/* Clients Table */}
                <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl overflow-hidden backdrop-blur-sm">
                    <div className="p-6 border-b border-neutral-700/50 flex justify-between items-center bg-neutral-800/20">
                        <h2 className="text-xl font-semibold text-white">Registered Clients</h2>
                        <button
                            onClick={fetchClients}
                            className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium"
                            disabled={isLoading}
                        >
                            <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin text-orange-400")} />
                            Refresh
                        </button>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-neutral-900/50 text-neutral-400 uppercase text-xs font-semibold tracking-wider">
                                <tr>
                                    <th className="px-6 py-4 rounded-tl-xl">RFC</th>
                                    <th className="px-6 py-4">Business Name</th>
                                    <th className="px-6 py-4">Regime</th>
                                    <th className="px-6 py-4">Zip Code</th>
                                    <th className="px-6 py-4">Email</th>
                                    <th className="px-6 py-4">Constancia</th>
                                    <th className="px-6 py-4">Enrolled</th>
                                    <th className="px-6 py-4 rounded-tr-xl text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-700/50">
                                {isLoading ? (
                                    <tr>
                                        <td colSpan={8} className="px-6 py-12 text-center text-neutral-400">
                                            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-orange-500" />
                                            Loading clients...
                                        </td>
                                    </tr>
                                ) : clients.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} className="px-6 py-12 text-center text-neutral-400">
                                            <div className="bg-neutral-800/50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border border-neutral-700">
                                                <Users className="w-8 h-8 text-neutral-500" />
                                            </div>
                                            <p className="text-lg text-neutral-300 font-medium">No clients found</p>
                                            <p className="text-sm mt-1">Add a new client to see them listed here.</p>
                                        </td>
                                    </tr>
                                ) : (
                                    clients.map((client) => (
                                        <tr key={client.id} className="hover:bg-neutral-800/80 transition-colors group">
                                            <td className="px-6 py-4">
                                                <span className="font-mono font-medium text-orange-300 bg-orange-500/10 px-2 py-1 rounded-md border border-orange-500/20">
                                                    {client.rfc}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 font-medium text-neutral-200">{client.business_name}</td>
                                            <td className="px-6 py-4 text-neutral-400">{client.fiscal_regime}</td>
                                            <td className="px-6 py-4 text-neutral-400">{client.fiscal_zip_code}</td>
                                            <td className="px-6 py-4 text-neutral-400">{client.email || '-'}</td>
                                            <td className="px-6 py-4">
                                                {client.constancia_pdf_url ? (
                                                    <div className="flex flex-col gap-1">
                                                        <a
                                                            href={client.constancia_pdf_url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 transition-colors bg-emerald-500/10 hover:bg-emerald-500/20 px-2.5 py-1.5 rounded-lg border border-emerald-500/20 w-max"
                                                        >
                                                            <FileCheck className="w-3.5 h-3.5" />
                                                            View PDF
                                                            <Download className="w-3 h-3 ml-0.5 opacity-70" />
                                                        </a>
                                                        <span className="text-[10px] text-neutral-500 pl-1">
                                                            Uploaded: {new Date(client.constancia_updated_at!).toLocaleDateString()}
                                                        </span>
                                                    </div>
                                                ) : (
                                                    <span className="text-neutral-600 text-xs italic">Not uploaded</span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-neutral-500 text-xs">
                                                {new Date(client.created_at).toLocaleDateString()}
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <button
                                                    onClick={() => handleEditClick(client)}
                                                    className="p-2 text-orange-400 hover:text-white bg-orange-500/10 hover:bg-orange-500 transition-colors rounded-lg border border-orange-500/20"
                                                    title="Edit Client"
                                                >
                                                    <Edit2 className="w-4 h-4" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

            </div>
        </div>
    );
}
