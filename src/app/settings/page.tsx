"use client";

import { useEffect, useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, Save, Upload, AlertCircle, Building, CheckCircle, RefreshCw, Hexagon, Mail, Inbox, Zap, Github, ChevronRight } from "lucide-react";
import Link from "next/link";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

const settingsSchema = z.object({
    id: z.string().optional(),
    company_name: z.string().min(1, "Company Name is required"),
    email: z.string().email("Invalid email").optional().or(z.literal('')),
    phone: z.string().optional().or(z.literal('')),
    address: z.string().optional().or(z.literal('')),
    logo_url: z.string().optional(),
    default_quotation_terms: z.string().optional().or(z.literal(''))
});

type SettingsFormValues = z.infer<typeof settingsSchema>;

type EmailIntegration = {
    id: string;
    provider: string;
    email: string;
    last_sync_at: string | null;
    last_sync_status: string | null;
    last_sync_error: string | null;
    last_sync_processed: number | null;
    backfill_completed_at: string | null;
    backfill_months: number | null;
};

function GmailIntegrationSection() {
    const [integ, setInteg] = useState<EmailIntegration | null>(null);
    const [pendingCount, setPendingCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [backfilling, setBackfilling] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [msg, setMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    const refresh = async () => {
        setLoading(true);
        try {
            const { data } = await supabase
                .from('email_integrations')
                .select('*')
                .eq('provider', 'gmail')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            setInteg(data as EmailIntegration | null);

            if (data) {
                const { count } = await supabase
                    .from('invoice_inbox')
                    .select('id', { count: 'exact', head: true })
                    .eq('integration_id', (data as EmailIntegration).id)
                    .eq('status', 'pending');
                setPendingCount(count || 0);
            }
        } catch (e: any) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        refresh();
        const url = new URL(window.location.href);
        if (url.searchParams.get('gmail_connected')) {
            setMsg({ type: 'success', text: '¡Gmail conectado exitosamente!' });
            window.history.replaceState({}, '', '/settings');
        } else if (url.searchParams.get('gmail_error')) {
            setMsg({ type: 'error', text: `Error: ${url.searchParams.get('gmail_error')}` });
            window.history.replaceState({}, '', '/settings');
        }
    }, []);

    const handleBackfill = async () => {
        if (!integ) return;
        if (!confirm('Esto escaneará los últimos 5 meses de tu correo. Puede tomar varios minutos. ¿Continuar?')) return;
        setBackfilling(true);
        setMsg(null);
        try {
            const res = await fetch('/api/email-sync/backfill', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ integrationId: integ.id, months: 5 }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Backfill falló');
            setMsg({ type: 'success', text: `Backfill completo. Escaneados: ${data.scanned}, agregados a bandeja: ${data.inserted}, ignorados: ${data.skipped}.` });
            await refresh();
        } catch (e: any) {
            setMsg({ type: 'error', text: e.message });
        } finally {
            setBackfilling(false);
        }
    };

    const handleSyncNow = async () => {
        if (!integ) return;
        setSyncing(true);
        setMsg(null);
        try {
            const res = await fetch('/api/email-sync/backfill', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ integrationId: integ.id, months: 1 }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Sync falló');
            setMsg({ type: 'success', text: `Sync OK. Escaneados: ${data.scanned}, agregados: ${data.inserted}.` });
            await refresh();
        } catch (e: any) {
            setMsg({ type: 'error', text: e.message });
        } finally {
            setSyncing(false);
        }
    };

    return (
        <div className="bg-neutral-800/40 p-6 md:p-8 rounded-3xl border border-neutral-700/50 backdrop-blur-sm space-y-6">
            <div className="flex items-center gap-3">
                <Mail className="w-7 h-7 text-orange-400" />
                <div>
                    <h2 className="text-xl font-bold text-white">Integración de Correo (Facturas IA)</h2>
                    <p className="text-sm text-neutral-400">Conecta Gmail. La IA detecta facturas con PDF/XML una vez al día y las manda a tu bandeja de revisión.</p>
                </div>
            </div>

            {msg && (
                <div className={cn(
                    "p-3 rounded-xl border flex items-start gap-2 text-sm",
                    msg.type === 'error' ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                )}>
                    {msg.type === 'error' ? <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> : <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
                    <span>{msg.text}</span>
                </div>
            )}

            {loading ? (
                <div className="text-neutral-400 text-sm flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" /> Cargando...</div>
            ) : !integ ? (
                <div className="flex flex-col items-start gap-4">
                    <p className="text-sm text-neutral-400">No hay correo conectado.</p>
                    <a href="/api/auth/google/start"
                        className="inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-5 py-3 rounded-xl font-medium transition-all">
                        <Mail className="w-4 h-4" /> Conectar Gmail
                    </a>
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-neutral-900/50 border border-neutral-700/50 rounded-xl p-4">
                            <div className="text-xs text-neutral-500 uppercase tracking-wider">Correo conectado</div>
                            <div className="text-white font-medium mt-1">{integ.email}</div>
                        </div>
                        <div className="bg-neutral-900/50 border border-neutral-700/50 rounded-xl p-4">
                            <div className="text-xs text-neutral-500 uppercase tracking-wider">Última sincronización</div>
                            <div className="text-white font-medium mt-1">
                                {integ.last_sync_at ? new Date(integ.last_sync_at).toLocaleString() : 'Nunca'}
                                {integ.last_sync_status && (
                                    <span className={cn("ml-2 text-xs px-2 py-0.5 rounded-full",
                                        integ.last_sync_status === 'ok' ? "bg-emerald-500/10 text-emerald-400" :
                                        integ.last_sync_status === 'error' ? "bg-red-500/10 text-red-400" :
                                        "bg-amber-500/10 text-amber-400"
                                    )}>{integ.last_sync_status}</span>
                                )}
                            </div>
                        </div>
                        <div className="bg-neutral-900/50 border border-neutral-700/50 rounded-xl p-4">
                            <div className="text-xs text-neutral-500 uppercase tracking-wider">Backfill de 5 meses</div>
                            <div className="text-white font-medium mt-1">
                                {integ.backfill_completed_at
                                    ? `Completado el ${new Date(integ.backfill_completed_at).toLocaleDateString()}`
                                    : 'Pendiente'}
                            </div>
                        </div>
                        <div className="bg-neutral-900/50 border border-neutral-700/50 rounded-xl p-4">
                            <div className="text-xs text-neutral-500 uppercase tracking-wider">Facturas pendientes</div>
                            <div className="text-white font-medium mt-1 flex items-center gap-2">
                                {pendingCount}
                                {pendingCount > 0 && (
                                    <Link href="/purchases/inbox" className="text-xs text-orange-400 hover:text-orange-300 underline">
                                        Ir a bandeja
                                    </Link>
                                )}
                            </div>
                        </div>
                    </div>

                    {integ.last_sync_error && (
                        <div className="text-xs text-red-400 bg-red-500/5 border border-red-500/20 rounded-lg p-3">
                            Error último sync: {integ.last_sync_error}
                        </div>
                    )}

                    <div className="flex flex-wrap gap-3">
                        {!integ.backfill_completed_at && (
                            <button onClick={handleBackfill} disabled={backfilling}
                                className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl font-medium transition-all">
                                {backfilling ? <><RefreshCw className="w-4 h-4 animate-spin" /> Procesando 5 meses...</> : <><Zap className="w-4 h-4" /> Sincronizar últimos 5 meses</>}
                            </button>
                        )}
                        <button onClick={handleSyncNow} disabled={syncing}
                            className="inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl font-medium transition-all">
                            {syncing ? <><RefreshCw className="w-4 h-4 animate-spin" /> Sincronizando...</> : <><RefreshCw className="w-4 h-4" /> Sincronizar ahora (último mes)</>}
                        </button>
                        <Link href="/purchases/inbox"
                            className="inline-flex items-center gap-2 bg-neutral-800 hover:bg-neutral-700 text-white px-5 py-2.5 rounded-xl font-medium transition-all border border-neutral-700">
                            <Inbox className="w-4 h-4" /> Bandeja de revisión
                        </Link>
                        <a href="/api/auth/google/start"
                            className="inline-flex items-center gap-2 text-xs text-neutral-400 hover:text-white px-3 py-2 transition-all">
                            Reconectar Gmail
                        </a>
                    </div>
                </div>
            )}
        </div>
    );
}

export default function SettingsPage() {
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [statusMsg, setStatusMsg] = useState<{ type: 'error' | 'success', text: string } | null>(null);
    const [previewLogo, setPreviewLogo] = useState<string | null>(null);
    const [logoFile, setLogoFile] = useState<File | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const {
        register,
        handleSubmit,
        reset,
        formState: { errors }
    } = useForm<SettingsFormValues>({
        resolver: zodResolver(settingsSchema)
    });

    useEffect(() => {
        async function fetchSettings() {
            setIsLoading(true);
            try {
                const { data, error } = await supabase
                    .from('company_settings')
                    .select('*')
                    .limit(1)
                    .single();

                if (error && error.code !== 'PGRST116') throw error;

                if (data) {
                    reset({
                        id: data.id,
                        company_name: data.company_name || "",
                        email: data.email || "",
                        phone: data.phone || "",
                        address: data.address || "",
                        logo_url: data.logo_url || "",
                        default_quotation_terms: data.default_quotation_terms || ""
                    });
                    if (data.logo_url) setPreviewLogo(data.logo_url);
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

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setLogoFile(file);
            const url = URL.createObjectURL(file);
            setPreviewLogo(url);
        }
    };

    const onSubmit = async (data: SettingsFormValues) => {
        setIsSubmitting(true);
        setStatusMsg(null);
        try {
            let finalLogoUrl = data.logo_url;

            // 1. Upload Logo if a file was selected
            if (logoFile) {
                const fileExt = logoFile.name.split('.').pop();
                const fileName = `logo_${Date.now()}.${fileExt}`;
                const filePath = `logos/${fileName}`;

                const { error: uploadError } = await supabase.storage
                    .from('public_assets')
                    .upload(filePath, logoFile, {
                        cacheControl: '3600',
                        upsert: true,
                        contentType: logoFile.type,
                    });

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
                default_quotation_terms: data.default_quotation_terms || null,
                updated_at: new Date().toISOString()
            };

            let saveError;
            if (data.id) {
                const { error } = await supabase
                    .from('company_settings')
                    .update(updatePayload)
                    .eq('id', data.id);
                saveError = error;
            } else {
                const { error } = await supabase
                    .from('company_settings')
                    .insert([updatePayload]);
                saveError = error;
            }

            if (saveError) throw saveError;

            // Re-fetch
            const { data: refreshedData } = await supabase.from('company_settings').select('*').limit(1).single();
            if (refreshedData) {
                reset({
                    id: refreshedData.id,
                    company_name: refreshedData.company_name || "",
                    email: refreshedData.email || "",
                    phone: refreshedData.phone || "",
                    address: refreshedData.address || "",
                    logo_url: refreshedData.logo_url || ""
                });
                setPreviewLogo(refreshedData.logo_url);
                setLogoFile(null);
                if (fileInputRef.current) fileInputRef.current.value = '';
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
            <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-10 font-[family-name:var(--font-sans)]">
                <RefreshCw className="w-8 h-8 animate-spin text-emerald-400" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-3 sm:p-6 md:p-8 lg:p-10 font-[family-name:var(--font-sans)] relative overflow-hidden">
            <div className="absolute top-0 right-0 -translate-y-12 translate-x-1/3 w-96 h-96 bg-amber-500/10 rounded-full blur-[100px] pointer-events-none"></div>
            <div className="absolute bottom-0 left-0 translate-y-1/3 -translate-x-1/3 w-96 h-96 bg-orange-500/10 rounded-full blur-[100px] pointer-events-none"></div>

            <div className="max-w-3xl mx-auto space-y-8 relative z-10">
                <header className="flex items-center gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <Link href="/" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors text-neutral-400 hover:text-white border border-neutral-700">
                        <ArrowLeft className="w-5 h-5" />
                    </Link>
                    <div>
                        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                            <Building className="w-8 h-8 text-amber-400" />
                            Configuración de la Empresa
                        </h1>
                        <p className="text-neutral-400 text-sm mt-1">Administra los datos de la empresa y logo para las cotizaciones PDF.</p>
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
                    <div className="bg-neutral-800/40 p-6 md:p-8 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                            <div className="md:col-span-2 space-y-2">
                                <label className="text-sm font-medium text-neutral-300 ml-1">Nombre de la Empresa *</label>
                                <input
                                    {...register("company_name")}
                                    className={cn(
                                        "w-full bg-neutral-900/50 border rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 transition-all",
                                        errors.company_name ? "border-red-500 focus:ring-red-500/20" : "border-neutral-700 focus:border-amber-500 focus:ring-amber-500/20"
                                    )}
                                    placeholder="e.g. SMAA Systems"
                                />
                                {errors.company_name && <p className="text-red-400 text-xs ml-1">{errors.company_name.message}</p>}
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium text-neutral-300 ml-1">Email de Contacto</label>
                                <input type="email" {...register("email")}
                                    className={cn("w-full bg-neutral-900/50 border rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 transition-all",
                                        errors.email ? "border-red-500 focus:ring-red-500/20" : "border-neutral-700 focus:border-amber-500 focus:ring-amber-500/20"
                                    )}
                                    placeholder="contacto@empresa.com"
                                />
                                {errors.email && <p className="text-red-400 text-xs ml-1">{errors.email.message}</p>}
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium text-neutral-300 ml-1">Teléfono</label>
                                <input {...register("phone")}
                                    className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 transition-all"
                                    placeholder="555-123-4567"
                                />
                            </div>

                            <div className="md:col-span-2 space-y-2">
                                <label className="text-sm font-medium text-neutral-300 ml-1">Dirección (Se mostrará en el PDF)</label>
                                <textarea {...register("address")}
                                    className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 transition-all min-h-[100px]"
                                    placeholder="Av. Principal 123, Ciudad, País"
                                />
                            </div>

                            <div className="md:col-span-2 space-y-2 pt-4 border-t border-neutral-700/50">
                                <label className="text-sm font-medium text-neutral-300 ml-1">Términos y Condiciones (Cotizaciones)</label>
                                <p className="text-xs text-neutral-500 ml-1 -mt-1">Este texto se cargará automáticamente en cada nueva cotización (puedes editarlo por cotización).</p>
                                <textarea {...register("default_quotation_terms")}
                                    className="w-full bg-neutral-900/50 border border-neutral-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 transition-all min-h-[140px]"
                                    placeholder={"Ej:\n• Precios en MXN, IVA incluido.\n• Validez de la cotización: 30 días.\n• Pago: 50% anticipo, 50% contra entrega.\n• Tiempo de entrega sujeto a confirmación."}
                                />
                            </div>

                            {/* Logo Upload – using direct state management instead of RHF */}
                            <div className="md:col-span-2 space-y-4 pt-4 border-t border-neutral-700/50">
                                <div>
                                    <h3 className="text-lg font-semibold text-white">Logo de la Empresa</h3>
                                    <p className="text-sm text-neutral-400">Este logo reemplazará el texto en la cabecera de tus Cotizaciones PDF. Usa formato <strong>PNG o JPG</strong>.</p>
                                </div>

                                <div className="flex flex-col sm:flex-row gap-6 items-start">
                                    <div className="w-full sm:w-1/3 flex flex-col items-center justify-center p-4 bg-neutral-900/50 border border-neutral-700 border-dashed rounded-2xl h-40 relative group">
                                        {previewLogo ? (
                                            <img
                                                src={previewLogo}
                                                alt="Company Logo Preview"
                                                className="max-w-full max-h-full object-contain"
                                            />
                                        ) : (
                                            <div className="text-center text-neutral-500">
                                                <Hexagon className="w-10 h-10 mx-auto mb-2 opacity-50" />
                                                <span className="text-sm font-medium">No Logo</span>
                                            </div>
                                        )}
                                        <div className="absolute inset-0 bg-neutral-900/80 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-2xl">
                                            <label className="cursor-pointer bg-neutral-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-neutral-700 border border-neutral-600 flex items-center gap-2">
                                                <Upload className="w-4 h-4" /> Cambiar
                                                <input
                                                    type="file"
                                                    accept="image/png,image/jpeg,image/jpg,image/webp"
                                                    className="hidden"
                                                    onChange={handleFileChange}
                                                />
                                            </label>
                                        </div>
                                    </div>

                                    <div className="w-full sm:w-2/3 space-y-2">
                                        <label className="text-sm font-medium text-neutral-300 ml-1">Subir Nuevo Logo</label>
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept="image/png,image/jpeg,image/jpg,image/webp"
                                            onChange={handleFileChange}
                                            className="w-full text-neutral-400 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-amber-500/20 file:text-amber-400 hover:file:bg-amber-500/30 file:transition-colors bg-neutral-900/50 border border-neutral-700 rounded-xl"
                                        />
                                        <p className="text-xs text-neutral-500 ml-1 mt-2">Recomendado: Imagen PNG o JPG, max 2MB. <strong>No SVG</strong>.</p>
                                        {logoFile && (
                                            <p className="text-xs text-emerald-400 ml-1">✓ Archivo seleccionado: {logoFile.name}</p>
                                        )}
                                    </div>
                                </div>
                            </div>

                        </div>
                    </div>

                    <div className="flex justify-end">
                        <button type="submit" disabled={isSubmitting}
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

                <GmailIntegrationSection />

                {/* Links a configuraciones relacionadas */}
                <div className="bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm space-y-3">
                    <h2 className="text-sm font-bold text-white flex items-center gap-2">
                        <Github className="w-4 h-4 text-neutral-300" />
                        Integraciones externas
                    </h2>
                    <p className="text-xs text-neutral-500">
                        Configuraciones que viven en su propia página por la cantidad de campos.
                    </p>
                    <Link
                        href="/changes/settings"
                        className="flex items-center justify-between gap-3 p-4 rounded-xl bg-neutral-900/50 border border-neutral-700/50 hover:border-neutral-600 hover:bg-neutral-800/40 transition-colors"
                    >
                        <div className="flex items-center gap-3">
                            <Github className="w-5 h-5 text-neutral-300" />
                            <div>
                                <p className="text-sm text-white font-medium">GitHub Sync</p>
                                <p className="text-[11px] text-neutral-500">Configurar repo y sincronizar commits al control de cambios</p>
                            </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-neutral-500" />
                    </Link>
                </div>
            </div>
        </div>
    );
}
