"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, Save, Upload, AlertCircle, Building, CheckCircle, RefreshCw, Hexagon } from "lucide-react";
import Link from "next/link";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";
import Image from "next/image";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

const settingsSchema = z.object({
    id: z.string().optional(),
    company_name: z.string().min(1, "Company Name is required"),
    email: z.string().email("Invalid email").optional().or(z.literal('')),
    phone: z.string().optional().or(z.literal('')),
    address: z.string().optional().or(z.literal('')),
    logo_file: z.any().optional(), // For the file input
    logo_url: z.string().optional()
});

type SettingsFormValues = z.infer<typeof settingsSchema>;

export default function SettingsPage() {
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [statusMsg, setStatusMsg] = useState<{ type: 'error' | 'success', text: string } | null>(null);
    const [previewLogo, setPreviewLogo] = useState<string | null>(null);

    const {
        register,
        handleSubmit,
        reset,
        watch,
        setValue,
        formState: { errors }
    } = useForm<SettingsFormValues>({
        resolver: zodResolver(settingsSchema)
    });

    const watchLogoFile = watch("logo_file");

    useEffect(() => {
        async function fetchSettings() {
            setIsLoading(true);
            try {
                const { data, error } = await supabase
                    .from('company_settings')
                    .select('*')
                    .limit(1)
                    .single();

                if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
                    throw error;
                }

                if (data) {
                    reset({
                        id: data.id,
                        company_name: data.company_name || "",
                        email: data.email || "",
                        phone: data.phone || "",
                        address: data.address || "",
                        logo_url: data.logo_url || ""
                    });
                    if (data.logo_url) {
                        setPreviewLogo(data.logo_url);
                    }
                }
            } catch (error) {
                console.error("Error fetching settings:", error);
                setStatusMsg({ type: 'error', text: "Failed to load settings." });
            } finally {
                setIsLoading(false);
            }
        }
        fetchSettings();
    }, [reset]);

    // Handle local preview of uploaded logo
    useEffect(() => {
        if (watchLogoFile && watchLogoFile.length > 0) {
            const file = watchLogoFile[0];
            const url = URL.createObjectURL(file);
            setPreviewLogo(url);
            return () => URL.revokeObjectURL(url);
        }
    }, [watchLogoFile]);

    const onSubmit = async (data: SettingsFormValues) => {
        setIsSubmitting(true);
        setStatusMsg(null);
        try {
            let finalLogoUrl = data.logo_url;

            // 1. Upload Logo if present
            if (data.logo_file && data.logo_file.length > 0) {
                const file = data.logo_file[0];
                const fileExt = file.name.split('.').pop();
                const fileName = `logo_${Date.now()}.${fileExt}`;
                const filePath = `logos/${fileName}`;

                const { error: uploadError } = await supabase.storage
                    .from('public_assets')
                    .upload(filePath, file, { upsert: true });

                if (uploadError) throw uploadError;

                const { data: publicUrlData } = supabase.storage
                    .from('public_assets')
                    .getPublicUrl(filePath);

                finalLogoUrl = publicUrlData.publicUrl;
            }

            // 2. Update DB row
            const updatePayload = {
                company_name: data.company_name,
                email: data.email,
                phone: data.phone,
                address: data.address,
                logo_url: finalLogoUrl,
                updated_at: new Date().toISOString()
            };

            let saveError;
            if (data.id) {
                // Update existing
                const { error } = await supabase
                    .from('company_settings')
                    .update(updatePayload)
                    .eq('id', data.id);
                saveError = error;
            } else {
                // Insert new (just in case default row was deleted)
                const { error } = await supabase
                    .from('company_settings')
                    .insert([updatePayload]);
                saveError = error;
            }

            if (saveError) throw saveError;

            // Re-fetch to normalize state
            const { data: refreshedData } = await supabase.from('company_settings').select('*').limit(1).single();
            if (refreshedData) {
                reset(refreshedData);
                setValue("logo_file", undefined); // clear file input
                setPreviewLogo(refreshedData.logo_url);
            }

            setStatusMsg({ type: 'success', text: "¡Configuración guardada exitosamente!" });

        } catch (error: any) {
            console.error("Error saving settings:", error);
            setStatusMsg({ type: 'error', text: error.message || "Failed to save settings." });
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-[#0B1120] flex items-center justify-center p-10 font-[family-name:var(--font-sans)]">
                <RefreshCw className="w-8 h-8 animate-spin text-emerald-400" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#0B1120] text-slate-200 p-6 md:p-10 font-[family-name:var(--font-sans)] relative overflow-hidden">
            {/* Background elements */}
            <div className="absolute top-0 right-0 -translate-y-12 translate-x-1/3 w-96 h-96 bg-amber-500/10 rounded-full blur-[100px] pointer-events-none"></div>
            <div className="absolute bottom-0 left-0 translate-y-1/3 -translate-x-1/3 w-96 h-96 bg-orange-500/10 rounded-full blur-[100px] pointer-events-none"></div>

            <div className="max-w-3xl mx-auto space-y-8 relative z-10">
                {/* Header */}
                <header className="flex items-center gap-4 bg-slate-800/40 p-6 rounded-3xl border border-slate-700/50 backdrop-blur-sm">
                    <Link href="/" className="p-3 bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors text-slate-400 hover:text-white border border-slate-700">
                        <ArrowLeft className="w-5 h-5" />
                    </Link>
                    <div>
                        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                            <Building className="w-8 h-8 text-amber-400" />
                            Configuración de la Empresa
                        </h1>
                        <p className="text-slate-400 text-sm mt-1">Manage details and logo for PDF quotations.</p>
                    </div>
                </header>

                {statusMsg && (
                    <div className={cn(
                        "p-4 rounded-xl border flex items-center gap-3",
                        statusMsg.type === 'error' ? "bg-red-500/10 border-red-500/30 text-red-400" : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                    )}>
                        {statusMsg.type === 'error' ? <AlertCircle className="w-5 h-5 flex-shrink-0" /> : <CheckCircle className="w-5 h-5 flex-shrink-0" />}
                        {statusMsg.text}
                    </div>
                )}

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                    <div className="bg-slate-800/40 p-6 md:p-8 rounded-3xl border border-slate-700/50 backdrop-blur-sm">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                            {/* Company Name */}
                            <div className="md:col-span-2 space-y-2">
                                <label className="text-sm font-medium text-slate-300 ml-1">Company Name (Nombre Empresa) *</label>
                                <input
                                    {...register("company_name")}
                                    className={cn(
                                        "w-full bg-slate-900/50 border rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 transition-all",
                                        errors.company_name ? "border-red-500 focus:border-red-500 focus:ring-red-500/20" : "border-slate-700 focus:border-amber-500 focus:ring-amber-500/20"
                                    )}
                                    placeholder="e.g. VOXA Systems"
                                />
                                {errors.company_name && <p className="text-red-400 text-xs ml-1">{errors.company_name.message}</p>}
                            </div>

                            {/* Email */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-300 ml-1">Email Contacto</label>
                                <input
                                    type="email"
                                    {...register("email")}
                                    className={cn(
                                        "w-full bg-slate-900/50 border rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 transition-all",
                                        errors.email ? "border-red-500 focus:border-red-500 focus:ring-red-500/20" : "border-slate-700 focus:border-amber-500 focus:ring-amber-500/20"
                                    )}
                                    placeholder="contacto@empresa.com"
                                />
                                {errors.email && <p className="text-red-400 text-xs ml-1">{errors.email.message}</p>}
                            </div>

                            {/* Phone */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-300 ml-1">Teléfono</label>
                                <input
                                    {...register("phone")}
                                    className="w-full bg-slate-900/50 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 transition-all"
                                    placeholder="555-123-4567"
                                />
                            </div>

                            {/* Address */}
                            <div className="md:col-span-2 space-y-2">
                                <label className="text-sm font-medium text-slate-300 ml-1">Dirección (Se mostrará en el PDF)</label>
                                <textarea
                                    {...register("address")}
                                    className="w-full bg-slate-900/50 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 transition-all min-h-[100px]"
                                    placeholder="Av. Principal 123, Ciudad, País"
                                />
                            </div>

                            {/* Logo Upload */}
                            <div className="md:col-span-2 space-y-4 pt-4 border-t border-slate-700/50">
                                <div>
                                    <h3 className="text-lg font-semibold text-white">Logo de la Empresa</h3>
                                    <p className="text-sm text-slate-400">Este logo reemplazará el texto en la cabecera de tus Cotizaciones PDF.</p>
                                </div>

                                <div className="flex flex-col sm:flex-row gap-6 items-start">
                                    <div className="w-full sm:w-1/3 flex flex-col items-center justify-center p-4 bg-slate-900/50 border border-slate-700 border-dashed rounded-2xl h-40 relative group">
                                        {previewLogo ? (
                                            <div className="relative w-full h-full">
                                                <Image
                                                    src={previewLogo}
                                                    alt="Company Logo Preview"
                                                    fill
                                                    className="object-contain"
                                                    unoptimized
                                                />
                                            </div>
                                        ) : (
                                            <div className="text-center text-slate-500">
                                                <Hexagon className="w-10 h-10 mx-auto mb-2 opacity-50" />
                                                <span className="text-sm font-medium">No Logo</span>
                                            </div>
                                        )}
                                        <div className="absolute inset-0 bg-slate-900/80 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-2xl">
                                            <label className="cursor-pointer bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-700 border border-slate-600 flex items-center gap-2">
                                                <Upload className="w-4 h-4" /> Cambiar
                                                <input
                                                    type="file"
                                                    accept="image/*"
                                                    className="hidden"
                                                    {...register("logo_file")}
                                                />
                                            </label>
                                        </div>
                                    </div>

                                    <div className="w-full sm:w-2/3 space-y-2">
                                        <label className="text-sm font-medium text-slate-300 ml-1">Subir Nuevo Logo</label>
                                        <input
                                            type="file"
                                            accept="image/*"
                                            className="w-full text-slate-400 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-amber-500/20 file:text-amber-400 hover:file:bg-amber-500/30 file:transition-colors bg-slate-900/50 border border-slate-700 rounded-xl"
                                            {...register("logo_file")}
                                        />
                                        <p className="text-xs text-slate-500 ml-1 mt-2">Recomendado: Imagen PNG o JPG con fondo transparente, max 2MB.</p>
                                    </div>
                                </div>
                            </div>

                        </div>
                    </div>

                    <div className="flex justify-end">
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="w-full md:w-auto bg-amber-500 hover:bg-amber-600 disabled:bg-amber-500/50 text-white px-8 py-3.5 rounded-xl font-bold transition-all shadow-[0_0_15px_rgba(245,158,11,0.2)] hover:shadow-[0_0_20px_rgba(245,158,11,0.4)] flex items-center justify-center gap-2"
                        >
                            {isSubmitting ? (
                                <><RefreshCw className="w-5 h-5 animate-spin" /> Guardando...</>
                            ) : (
                                <><Save className="w-5 h-5" /> Guardar Configuración</>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
