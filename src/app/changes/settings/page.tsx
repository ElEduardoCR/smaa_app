"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
    ArrowLeft, Github, Save, RefreshCw, AlertCircle, CheckCircle2, Eye, EyeOff
} from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

export default function ChangesSettingsPage() {
    const [settings, setSettings] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [showToken, setShowToken] = useState(false);
    const [msg, setMsg] = useState<{ type: "error" | "success"; text: string } | null>(null);

    const [repoOwner, setRepoOwner] = useState("ElEduardoCR");
    const [repoName, setRepoName] = useState("smaa_app");
    const [branch, setBranch] = useState("main");
    const [token, setToken] = useState("");

    useEffect(() => {
        (async () => {
            const { data } = await supabase.from("github_sync_settings").select("*").limit(1).maybeSingle();
            if (data) {
                setSettings(data);
                setRepoOwner(data.repo_owner);
                setRepoName(data.repo_name);
                setBranch(data.branch);
                // don't show token in input by default
            }
            setLoading(false);
        })();
    }, []);

    const save = async () => {
        setBusy(true);
        setMsg(null);
        try {
            const patch: any = { repo_owner: repoOwner, repo_name: repoName, branch, updated_at: new Date().toISOString() };
            if (token.trim()) patch.token = token.trim();
            if (settings?.id) {
                const { error } = await supabase.from("github_sync_settings").update(patch).eq("id", settings.id);
                if (error) throw error;
            } else {
                const { data, error } = await supabase.from("github_sync_settings").insert([{ ...patch, enabled: true }]).select().single();
                if (error) throw error;
                setSettings(data);
            }
            setMsg({ type: "success", text: "Configuración guardada." });
            setToken("");
        } catch (e: any) {
            setMsg({ type: "error", text: e.message || "Error." });
        } finally { setBusy(false); }
    };

    if (loading) return <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center"><RefreshCw className="w-8 h-8 animate-spin text-sky-400" /></div>;

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-6 md:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-3xl mx-auto space-y-6">
                <header className="flex items-center gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50">
                    <Link href="/changes" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl text-neutral-400 hover:text-white border border-neutral-700">
                        <ArrowLeft className="w-5 h-5" />
                    </Link>
                    <div>
                        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                            <Github className="w-6 h-6 text-neutral-200" />
                            Configuración de GitHub
                        </h1>
                        <p className="text-xs text-neutral-500 mt-0.5">Sincroniza los commits de tu repo con la bitácora de cambios.</p>
                    </div>
                </header>

                {msg && (
                    <div className={cn("p-3 rounded-xl border flex items-center gap-2",
                        msg.type === "error" ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                    )}>
                        {msg.type === "error" ? <AlertCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />} {msg.text}
                    </div>
                )}

                <div className="bg-neutral-800/40 p-6 rounded-2xl border border-neutral-700/50 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                            <label className="text-xs text-neutral-400 ml-1">Owner</label>
                            <input value={repoOwner} onChange={e => setRepoOwner(e.target.value)} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-sky-500" />
                        </div>
                        <div>
                            <label className="text-xs text-neutral-400 ml-1">Repositorio</label>
                            <input value={repoName} onChange={e => setRepoName(e.target.value)} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-sky-500" />
                        </div>
                        <div>
                            <label className="text-xs text-neutral-400 ml-1">Rama</label>
                            <input value={branch} onChange={e => setBranch(e.target.value)} className="w-full mt-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-sky-500" />
                        </div>
                    </div>

                    <div>
                        <label className="text-xs text-neutral-400 ml-1">Personal Access Token (opcional)</label>
                        <div className="relative mt-1">
                            <input
                                type={showToken ? "text" : "password"}
                                value={token}
                                onChange={e => setToken(e.target.value)}
                                placeholder={settings?.token ? "•••••• (deja vacío para mantener el actual)" : "ghp_xxxxxxxxxxxx"}
                                className="w-full bg-neutral-900/50 border border-neutral-700 rounded-lg pl-3 pr-10 py-2 text-white text-sm font-mono focus:outline-none focus:border-sky-500"
                            />
                            <button
                                type="button"
                                onClick={() => setShowToken(s => !s)}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-neutral-400 hover:text-white"
                            >
                                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                        </div>
                        <p className="text-[10px] text-neutral-500 mt-1">
                            Para repos públicos no se necesita token. Para privados o mayor rate limit, genera un PAT en
                            <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:text-sky-300 ml-1">github.com/settings/tokens</a>
                            con scope <code className="text-violet-300">repo:read</code>.
                        </p>
                    </div>

                    <div className="flex justify-end">
                        <button onClick={save} disabled={busy} className="bg-sky-500 hover:bg-sky-600 text-white px-5 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50">
                            {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar
                        </button>
                    </div>
                </div>

                {settings?.last_sync_at && (
                    <div className="bg-neutral-800/40 p-4 rounded-2xl border border-neutral-700/50 text-sm text-neutral-400">
                        <p>Última sync: <span className="text-white">{new Date(settings.last_sync_at).toLocaleString()}</span></p>
                        {settings.last_sync_count > 0 && <p>Importados: <span className="text-emerald-300">{settings.last_sync_count}</span> commits</p>}
                    </div>
                )}
            </div>
        </div>
    );
}
