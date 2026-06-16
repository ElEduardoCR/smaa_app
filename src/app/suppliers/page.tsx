"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { supabase } from "@/lib/supabase";
import { Truck, FileText, Hash, Mail, MapPin, Phone, RefreshCw, Plus, ArrowLeft, Users, Download, FileCheck, Edit2, Trash2 } from "lucide-react";
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
type Supplier = SupplierFormValues & { id: string; constancia_pdf_url?: string; constancia_updated_at?: string; created_at: string; };

export default function SuppliersPage() {
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);

    const { register, handleSubmit, reset, formState: { errors } } = useForm<SupplierFormValues>({
        resolver: zodResolver(supplierSchema),
        defaultValues: { rfc: "", business_name: "", fiscal_regime: "", fiscal_zip_code: "", email: "", phone: "", address: "" }
    });

    const fetchSuppliers = async () => {
        setIsLoading(true);
        try {
            const { data, error } = await supabase.from('suppliers').select('*').order('created_at', { ascending: false });
            if (error) throw error;
            setSuppliers(data || []);
        } catch (error: any) {
            console.error("Error fetching suppliers:", error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => { fetchSuppliers(); }, []);

    const handleEditClick = (s: Supplier) => {
        setEditingId(s.id);
        reset({ rfc: s.rfc, business_name: s.business_name, fiscal_regime: s.fiscal_regime || "", fiscal_zip_code: s.fiscal_zip_code || "", email: s.email || "", phone: s.phone || "", address: s.address || "" });
        setSelectedFile(null);
        setIsFormOpen(true);
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    const handleDelete = async (id: string) => {
        if (!confirm("¿Estás seguro de que deseas eliminar este proveedor?")) return;
        try {
            const { error } = await supabase.from('suppliers').delete().eq('id', id);
            if (error) throw error;
            setMessage({ type: 'success', text: "Proveedor eliminado." });
            fetchSuppliers();
            setTimeout(() => setMessage(null), 3000);
        } catch (error: any) {
            setMessage({ type: 'error', text: error.message || "Error al eliminar." });
        }
    };

    const handleCloseForm = () => {
        setIsFormOpen(false);
        setEditingId(null);
        setSelectedFile(null);
        reset({ rfc: "", business_name: "", fiscal_regime: "", fiscal_zip_code: "", email: "", phone: "", address: "" });
    };

    const onSubmit = async (data: SupplierFormValues) => {
        setIsSubmitting(true);
        setMessage(null);
        try {
            let pdfUrl = null;
            let pdfUpdatedAt = null;

            if (selectedFile) {
                const fileExt = selectedFile.name.split('.').pop();
                const fileName = `${data.rfc}-${Date.now()}.${fileExt}`;
                const { error: uploadError } = await supabase.storage.from('purchase_files').upload(`constancias/${fileName}`, selectedFile, { cacheControl: '3600', upsert: true, contentType: selectedFile.type });
                if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);
                const { data: publicUrlData } = supabase.storage.from('purchase_files').getPublicUrl(`constancias/${fileName}`);
                pdfUrl = publicUrlData.publicUrl;
                pdfUpdatedAt = new Date().toISOString();
            }

            const recordData: any = { ...data };
            if (pdfUrl) { recordData.constancia_pdf_url = pdfUrl; recordData.constancia_updated_at = pdfUpdatedAt; }

            if (editingId) {
                const { error } = await supabase.from('suppliers').update(recordData).eq('id', editingId);
                if (error) throw error;
                setMessage({ type: 'success', text: "Proveedor actualizado." });
            } else {
                const { error } = await supabase.from('suppliers').insert([recordData]);
                if (error) throw error;
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
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-6 md:p-10 font-[family-name:var(--font-sans)]">
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
                                    <label className="text-sm font-medium text-neutral-300 ml-1">Constancia de Situación Fiscal (PDF)</label>
                                    <input type="file" accept=".pdf" onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-4 py-3 text-white file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-rose-500/20 file:text-rose-400 hover:file:bg-rose-500/30 transition-all focus:outline-none cursor-pointer" />
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
                    <div className="p-6 border-b border-neutral-700/50 flex justify-between items-center bg-neutral-800/20">
                        <h2 className="text-xl font-semibold text-white">Proveedores Registrados</h2>
                        <button onClick={fetchSuppliers} className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium" disabled={isLoading}>
                            <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin text-rose-400")} /> Refresh
                        </button>
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
                                    <th className="px-6 py-4 rounded-tr-xl text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-700/50">
                                {isLoading ? (
                                    <tr><td colSpan={6} className="px-6 py-12 text-center text-neutral-400"><RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-rose-500" />Loading...</td></tr>
                                ) : suppliers.length === 0 ? (
                                    <tr><td colSpan={6} className="px-6 py-12 text-center text-neutral-400">
                                        <div className="bg-neutral-800/50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border border-neutral-700"><Truck className="w-8 h-8 text-neutral-500" /></div>
                                        <p className="text-lg text-neutral-300 font-medium">No hay proveedores</p>
                                        <p className="text-sm mt-1">Agrega tu primer proveedor.</p>
                                    </td></tr>
                                ) : (
                                    suppliers.map((s) => (
                                        <tr key={s.id} className="hover:bg-neutral-800/80 transition-colors">
                                            <td className="px-6 py-4"><span className="font-mono font-medium text-rose-300 bg-rose-500/10 px-2 py-1 rounded-md border border-rose-500/20">{s.rfc}</span></td>
                                            <td className="px-6 py-4 font-medium text-neutral-200">{s.business_name}</td>
                                            <td className="px-6 py-4 text-neutral-400">{s.email || '—'}</td>
                                            <td className="px-6 py-4 text-neutral-400">{s.phone || '—'}</td>
                                            <td className="px-6 py-4">
                                                {s.constancia_pdf_url ? (
                                                    <a href={s.constancia_pdf_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 px-2.5 py-1.5 rounded-lg border border-emerald-500/20"><FileCheck className="w-3.5 h-3.5" /> Ver PDF</a>
                                                ) : <span className="text-neutral-600 text-xs italic">No subida</span>}
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    <button onClick={() => handleEditClick(s)} className="p-2 text-rose-400 hover:text-white bg-rose-500/10 hover:bg-rose-500 transition-colors rounded-lg border border-rose-500/20" title="Editar"><Edit2 className="w-4 h-4" /></button>
                                                    <button onClick={() => handleDelete(s.id)} className="p-2 text-neutral-500 hover:text-red-400 hover:bg-red-500/10 transition-colors rounded-lg border border-neutral-700" title="Eliminar"><Trash2 className="w-4 h-4" /></button>
                                                </div>
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
