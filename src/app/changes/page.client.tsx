"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
    ArrowLeft, History, RefreshCw, Github, Filter, GitCommit, FileText,
    Plus, Edit, Trash2, ArrowRightLeft, CheckCircle2, X
} from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";
import { fetchGitHubCommits, GitHubCommit } from "@/lib/githubSync";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

type Change = {
    id: string;
    entity_type: string;
    entity_id: string | null;
    action: string;
    field_name: string | null;
    old_value: string | null;
    new_value: string | null;
    description: string | null;
    changed_by: string | null;
    source: string;
    commit_sha: string | null;
    commit_message: string | null;
    commit_author: string | null;
    commit_url: string | null;
    commit_date: string | null;
    changed_at: string;
};

const ACTION_LABEL: Record<string, string> = {
    create: "Creado",
    update: "Modificado",
    delete: "Eliminado",
    status_change: "Cambio de estado",
    sign: "Firmado",
    attach: "Adjunto",
    comment: "Comentario",
};

const ACTION_STYLE: Record<string, string> = {
    create: "bg-emerald-500/10 text-emerald-300",
    update: "bg-sky-500/10 text-sky-300",
    delete: "bg-rose-500/10 text-rose-300",
    status_change: "bg-amber-500/10 text-amber-300",
};

const ACTION_ICON: Record<string, any> = {
    create: Plus,
    update: Edit,
    delete: Trash2,
    status_change: ArrowRightLeft,
};

const ENTITY_ICON: Record<string, string> = {
    work_order: "🏭",
    employee: "👤",
    payroll_period: "💵",
    payroll_receipt: "🧾",
    declaration: "📊",
    document: "📋",
    document_version: "📚",
    manufacturing_module: "⚙️",
};

const SOURCE_STYLE: Record<string, string> = {
    app: "bg-sky-500/10 text-sky-300",
    github: "bg-neutral-700/40 text-neutral-200",
    trigger: "bg-violet-500/10 text-violet-300",
    system: "bg-neutral-700/40 text-neutral-300",
    manual: "bg-amber-500/10 text-amber-300",
};

export default function ChangesPage() {
    const [changes, setChanges] = useState<Change[]>([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [syncMsg, setSyncMsg] = useState<string | null>(null);
    const [filterEntity, setFilterEntity] = useState("all");
    const [filterSource, setFilterSource] = useState("all");
    const [filterAction, setFilterAction] = useState("all");
    const [search, setSearch] = useState("");
    const [settings, setSettings] = useState<any>(null);

    const load = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from("change_log")
                .select("*")
                .order("changed_at", { ascending: false })
                .limit(300);
            if (error) throw error;
            setChanges(data || []);
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    };

    const loadSettings = async () => {
        const { data } = await supabase.from("github_sync_settings").select("*").limit(1).maybeSingle();
        setSettings(data);
    };

    useEffect(() => { load(); loadSettings(); }, []);

    const syncGitHub = async () => {
        if (!settings) { setSyncMsg("No hay configuración."); return; }
        setSyncing(true);
        setSyncMsg(null);
        try {
            const since = settings.last_sync_at || new Date(Date.now() - 90 * 86400000).toISOString();
            const commits: GitHubCommit[] = await fetchGitHubCommits({
                owner: settings.repo_owner,
                repo: settings.repo_name,
                branch: settings.branch,
                token: settings.token || null,
                perPage: 100,
                since,
            });

            // Insert commits that we haven't already stored
            const { data: existing } = await supabase.from("change_log").select("commit_sha").not("commit_sha", "is", null);
            const existingShas = new Set((existing || []).map((e: any) => e.commit_sha));
            const newOnes = commits.filter(c => !existingShas.has(c.sha));

            if (newOnes.length === 0) {
                setSyncMsg(`Sin commits nuevos desde ${new Date(since).toLocaleDateString()}.`);
            } else {
                const rows = newOnes.map(c => ({
                    entity_type: "github_commit",
                    entity_id: c.sha,
                    action: "commit",
                    description: c.message,
                    commit_sha: c.sha,
                    commit_message: c.message,
                    commit_author: c.author.name,
                    commit_url: c.url,
                    commit_date: c.author.date || new Date().toISOString(),
                    changed_by: c.author.name,
                    source: "github",
                    changed_at: c.author.date || new Date().toISOString(),
                }));
                const { error: insErr } = await supabase.from("change_log").insert(rows);
                if (insErr) throw insErr;
                setSyncMsg(`Importados ${rows.length} commits de GitHub.`);
            }

            await supabase.from("github_sync_settings").update({
                last_sync_at: new Date().toISOString(),
                last_sync_count: newOnes.length,
                last_error: null,
            }).eq("id", settings.id);
            await load();
            await loadSettings();
        } catch (e: any) {
            setSyncMsg("Error: " + e.message);
            if (settings?.id) {
                await supabase.from("github_sync_settings").update({ last_error: e.message }).eq("id", settings.id);
            }
        } finally {
            setSyncing(false);
            setTimeout(() => setSyncMsg(null), 5000);
        }
    };

    const filtered = changes.filter(c => {
        if (filterEntity !== "all" && c.entity_type !== filterEntity) return false;
        if (filterSource !== "all" && c.source !== filterSource) return false;
        if (filterAction !== "all" && c.action !== filterAction) return false;
        if (search) {
            const s = search.toLowerCase();
            return (c.description || "").toLowerCase().includes(s)
                || (c.commit_message || "").toLowerCase().includes(s)
                || (c.changed_by || "").toLowerCase().includes(s)
                || c.entity_type.toLowerCase().includes(s);
        }
        return true;
    });

    const entityTypes = Array.from(new Set(changes.map(c => c.entity_type)));
    const githubCount = changes.filter(c => c.source === "github").length;
    const appCount = changes.filter(c => c.source !== "github").length;

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-6 md:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-6xl mx-auto space-y-6">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors text-neutral-400 hover:text-white border border-neutral-700">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div>
                            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                                <History className="w-8 h-8 text-sky-400" />
                                Control de Cambios
                            </h1>
                            <p className="text-neutral-400 text-sm mt-1">Bitácora de todo lo que se modifica en la app + historial de GitHub.</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={load} className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg transition-colors flex items-center gap-2 text-sm" disabled={loading}>
                            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin text-sky-400")} /> Actualizar
                        </button>
                        <button onClick={syncGitHub} disabled={syncing} className="flex items-center gap-2 bg-neutral-800 hover:bg-neutral-700 text-white px-4 py-2 rounded-lg border border-neutral-700 transition-colors disabled:opacity-50">
                            {syncing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Github className="w-4 h-4" />}
                            {syncing ? "Sincronizando…" : "Sync desde GitHub"}
                        </button>
                        <Link href="/changes/settings" className="text-sm text-sky-300 hover:text-white bg-sky-500/10 hover:bg-sky-500/20 px-3 py-2 rounded-lg border border-sky-500/20">
                            ⚙ Configurar
                        </Link>
                    </div>
                </header>

                {/* Stats */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-xl p-3">
                        <p className="text-xs text-neutral-500">Total eventos</p>
                        <p className="text-2xl font-bold text-white">{changes.length}</p>
                    </div>
                    <div className="bg-sky-500/5 border border-sky-500/30 rounded-xl p-3">
                        <p className="text-xs text-sky-300">Eventos app</p>
                        <p className="text-2xl font-bold text-sky-200">{appCount}</p>
                    </div>
                    <div className="bg-neutral-700/20 border border-neutral-600/30 rounded-xl p-3">
                        <p className="text-xs text-neutral-300 flex items-center gap-1"><Github className="w-3 h-3" /> Commits GitHub</p>
                        <p className="text-2xl font-bold text-neutral-100">{githubCount}</p>
                    </div>
                </div>

                {settings && (
                    <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-xl p-3 text-xs text-neutral-400 flex flex-wrap items-center gap-3">
                        <Github className="w-3.5 h-3.5" />
                        <span>GitHub: <span className="text-neutral-200 font-mono">{settings.repo_owner}/{settings.repo_name}</span> ({settings.branch})</span>
                        {settings.last_sync_at && <span>· Última sync: {new Date(settings.last_sync_at).toLocaleString()}</span>}
                        {settings.last_sync_count !== null && <span>· {settings.last_sync_count} importados en la última</span>}
                        {settings.last_error && <span className="text-rose-300">· Error: {settings.last_error.slice(0, 100)}</span>}
                    </div>
                )}

                {syncMsg && (
                    <div className="p-3 rounded-xl border border-sky-500/30 bg-sky-500/10 text-sky-200 text-sm">{syncMsg}</div>
                )}

                <div className="flex flex-col md:flex-row gap-3">
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Buscar por descripción, autor, mensaje…"
                        className="flex-1 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500"
                    />
                    <select value={filterEntity} onChange={e => setFilterEntity(e.target.value)} className="bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500">
                        <option value="all">Todas las entidades</option>
                        {entityTypes.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <select value={filterSource} onChange={e => setFilterSource(e.target.value)} className="bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500">
                        <option value="all">Todas las fuentes</option>
                        <option value="trigger">Trigger (app)</option>
                        <option value="github">GitHub</option>
                        <option value="manual">Manual</option>
                    </select>
                    <select value={filterAction} onChange={e => setFilterAction(e.target.value)} className="bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500">
                        <option value="all">Todas las acciones</option>
                        <option value="create">Creado</option>
                        <option value="update">Modificado</option>
                        <option value="delete">Eliminado</option>
                        <option value="status_change">Cambio de estado</option>
                        <option value="commit">Commit</option>
                    </select>
                </div>

                {/* Timeline */}
                <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl overflow-hidden">
                    {loading ? (
                        <div className="p-12 text-center text-neutral-400"><RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-sky-400" /> Cargando…</div>
                    ) : filtered.length === 0 ? (
                        <div className="p-12 text-center text-neutral-400">
                            <History className="w-10 h-10 mx-auto mb-3 opacity-40" />
                            <p>Sin cambios que mostrar.</p>
                            <p className="text-xs mt-2">Si acabas de crear el módulo, los triggers solo registrarán a partir de ahora. Para llenar el histórico, sincroniza desde GitHub.</p>
                        </div>
                    ) : (
                        <ul className="divide-y divide-neutral-700/50">
                            {filtered.map(c => {
                                const ActionIcon = ACTION_ICON[c.action] || Edit;
                                return (
                                    <li key={c.id} className="p-4 hover:bg-neutral-800/60 transition-colors">
                                        <div className="flex items-start gap-3">
                                            <div className={cn(
                                                "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-base",
                                                c.source === "github" ? "bg-neutral-700" : ACTION_STYLE[c.action] || "bg-neutral-700"
                                            )}>
                                                {c.source === "github" ? <Github className="w-4 h-4" /> : <ActionIcon className="w-4 h-4" />}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    {c.source !== "github" && (
                                                        <span className="text-sm text-white font-medium">{ENTITY_ICON[c.entity_type] || "📝"} {ACTION_LABEL[c.action] || c.action} en <span className="text-violet-300 font-mono text-xs">{c.entity_type}</span></span>
                                                    )}
                                                    {c.source === "github" && (
                                                        <span className="text-sm text-white font-medium">Commit: <span className="font-mono text-violet-300 text-xs">{c.commit_sha?.slice(0, 7)}</span></span>
                                                    )}
                                                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider", SOURCE_STYLE[c.source])}>
                                                        {c.source}
                                                    </span>
                                                    <span className="text-[10px] text-neutral-500 ml-auto">{new Date(c.changed_at).toLocaleString()}</span>
                                                </div>
                                                {c.source === "github" ? (
                                                    <div className="mt-1">
                                                        <p className="text-sm text-neutral-200">{c.commit_message || c.description}</p>
                                                        <p className="text-xs text-neutral-500 mt-0.5">por <span className="text-neutral-300">{c.commit_author}</span></p>
                                                        {c.commit_url && (
                                                            <a href={c.commit_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-sky-400 hover:text-sky-300 inline-flex items-center gap-1 mt-1">
                                                                Ver en GitHub ↗
                                                            </a>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <div className="mt-1">
                                                        <p className="text-sm text-neutral-200">{c.description || `${c.field_name}: ${c.old_value} → ${c.new_value}`}</p>
                                                        {c.changed_by && <p className="text-xs text-neutral-500 mt-0.5">por <span className="text-neutral-300">{c.changed_by}</span></p>}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
}
