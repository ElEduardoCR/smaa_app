"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
    ArrowLeft, History, RefreshCw, Filter, Edit, Trash2, ArrowRightLeft, Plus
} from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

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

const STATUS_LABEL: Record<string, string> = {
    draft: "Borrador",
    in_review: "En revisión",
    approved: "Vigente",
    obsolete: "Obsoleto",
    pending_obsolete: "Por obsolecer",
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
    document: "📋",
    document_version: "📚",
};

const SOURCE_STYLE: Record<string, string> = {
    app: "bg-sky-500/10 text-sky-300",
    trigger: "bg-violet-500/10 text-violet-300",
    system: "bg-neutral-700/40 text-neutral-300",
    manual: "bg-amber-500/10 text-amber-300",
};

export default function ChangesPage() {
    const [changes, setChanges] = useState<Change[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterEntity, setFilterEntity] = useState("all");
    const [filterAction, setFilterAction] = useState("all");
    const [search, setSearch] = useState("");

    const load = async () => {
        setLoading(true);
        try {
            // Solo cambios de la Información Documentada (ISO 9001:2015 cláusula 7.5):
            // documentos nuevos, versiones nuevas, cambios de status, firmas, eliminaciones.
            // Los commits de GitHub se sincronizan vía Configuración → GitHub Sync.
            const { data, error } = await supabase
                .from("change_log")
                .select("*")
                .in("entity_type", ["document", "document_version"])
                .order("changed_at", { ascending: false })
                .limit(300);
            if (error) throw error;
            setChanges(data || []);
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    };

    useEffect(() => { load(); }, []);

    const filtered = changes.filter(c => {
        if (filterEntity !== "all" && c.entity_type !== filterEntity) return false;
        if (filterAction !== "all" && c.action !== filterAction) return false;
        if (search) {
            const s = search.toLowerCase();
            return (c.description || "").toLowerCase().includes(s)
                || (c.changed_by || "").toLowerCase().includes(s)
                || c.entity_type.toLowerCase().includes(s);
        }
        return true;
    });

    const entityTypes = Array.from(new Set(changes.map(c => c.entity_type)));

    // El trigger no guarda el folio explícitamente — lo extrae de la
    // descripción cuando es posible, si no muestra el entity_id corto.
    const lookupField = (c: Change, _field: string): string | null => {
        // Para versiones, el new_value a veces trae el número de versión.
        if (c.field_name === 'version' && c.new_value) return `v${c.new_value}`;
        if (c.field_name === 'revision' && c.new_value) return `rev. ${c.new_value}`;
        if (c.field_name === 'status' && c.new_value) return STATUS_LABEL[c.new_value] || c.new_value;
        // Intenta extraer folio del description si lo incluye
        const m = (c.description || '').match(/\b(PRO|REG|FOR|MAN|POL|INS|PLA|EXT)-\d+/);
        if (m) return m[0];
        return null;
    };

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
                                <History className="w-8 h-8 text-sky-400" />
                                Control de Cambios — Información Documentada
                            </h1>
                            <p className="text-neutral-400 text-sm mt-1">
                                Bitácora de versiones, status y firmas de los documentos ISO 9001:2015 (cláusula 7.5).
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={load} className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg transition-colors flex items-center gap-2 text-sm" disabled={loading}>
                            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin text-sky-400")} /> Actualizar
                        </button>
                    </div>
                </header>

                {/* Stats */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-xl p-3">
                        <p className="text-xs text-neutral-500">Total eventos</p>
                        <p className="text-2xl font-bold text-white">{changes.length}</p>
                    </div>
                    <div className="bg-sky-500/5 border border-sky-500/30 rounded-xl p-3">
                        <p className="text-xs text-sky-300">Último cambio</p>
                        <p className="text-sm text-sky-200 mt-1">
                            {changes[0] ? new Date(changes[0].changed_at).toLocaleString() : '—'}
                        </p>
                    </div>
                    <div className="bg-violet-500/5 border border-violet-500/30 rounded-xl p-3">
                        <p className="text-xs text-violet-300">Documentos involucrados</p>
                        <p className="text-2xl font-bold text-violet-200">{new Set(changes.map(c => c.entity_id).filter(Boolean)).size}</p>
                    </div>
                </div>

                <div className="flex flex-col md:flex-row gap-3">
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Buscar por descripción, autor, folio…"
                        className="flex-1 min-w-0 bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500"
                    />
                    <select value={filterEntity} onChange={e => setFilterEntity(e.target.value)} className="bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500">
                        <option value="all">Todos los tipos</option>
                        <option value="document">Documento</option>
                        <option value="document_version">Versión</option>
                    </select>
                    <select value={filterAction} onChange={e => setFilterAction(e.target.value)} className="bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sky-500">
                        <option value="all">Todas las acciones</option>
                        <option value="create">Creado</option>
                        <option value="update">Modificado</option>
                        <option value="delete">Eliminado</option>
                        <option value="status_change">Cambio de status</option>
                        <option value="sign">Firma</option>
                    </select>
                </div>

                {/* Timeline */}
                <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl overflow-hidden">
                    {loading ? (
                        <div className="p-12 text-center text-neutral-400"><RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-sky-400" /> Cargando…</div>
                    ) : filtered.length === 0 ? (
                        <div className="p-12 text-center text-neutral-400">
                            <History className="w-10 h-10 mx-auto mb-3 opacity-40" />
                            <p>Sin cambios en Información Documentada.</p>
                            <p className="text-xs mt-2">Crea o edita un documento para ver su historial aquí.</p>
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
                                                ACTION_STYLE[c.action] || "bg-neutral-700"
                                            )}>
                                                <ActionIcon className="w-4 h-4" />
                                            </div>
                                            <div className="flex-1 min-w-0 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="text-sm text-white font-medium">
                                                        {ENTITY_ICON[c.entity_type] || "📝"}{' '}
                                                        {ACTION_LABEL[c.action] || c.action}
                                                        {c.entity_id && (
                                                            <> · <Link href={`/documents/${c.entity_id}`} className="text-violet-300 hover:text-violet-200 font-mono text-xs underline">{lookupField(c, 'folio') || c.entity_id.slice(0, 8)}</Link></>
                                                        )}
                                                    </span>
                                                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider", SOURCE_STYLE[c.source] || "bg-neutral-700 text-neutral-300")}>
                                                        {c.source}
                                                    </span>
                                                    <span className="text-[10px] text-neutral-500 ml-auto">{new Date(c.changed_at).toLocaleString()}</span>
                                                </div>
                                                <div className="mt-1">
                                                    <p className="text-sm text-neutral-200">{c.description || `${c.field_name}: ${c.old_value || '—'} → ${c.new_value || '—'}`}</p>
                                                    {c.changed_by && <p className="text-xs text-neutral-500 mt-0.5">por <span className="text-neutral-300">{c.changed_by}</span></p>}
                                                </div>
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
