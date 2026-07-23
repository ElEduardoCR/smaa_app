"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
    ArrowLeft, FileText, Plus, RefreshCw, Eye, Search, Filter, BookOpen
} from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

type Document = {
    id: string; folio: string; title: string; version: string;
    status: string; effective_date: string | null; next_review_date: string | null;
    created_at: string; updated_at: string;
    type?: { code: string; name: string; prefix: string };
};

const STATUS_STYLES: Record<string, string> = {
    draft: "bg-neutral-500/10 text-neutral-300 border-neutral-500/30",
    in_review: "bg-amber-500/10 text-amber-300 border-amber-500/30",
    approved: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
    obsolete: "bg-rose-500/10 text-rose-300 border-rose-500/30",
    pending_obsolete: "bg-violet-500/10 text-violet-300 border-violet-500/30",
};
const STATUS_LABEL: Record<string, string> = {
    draft: "Borrador", in_review: "En revisión", approved: "Vigente",
    obsolete: "Obsoleto", pending_obsolete: "Por obsolescer",
};

export default function DocumentsIndex() {
    const [docs, setDocs] = useState<Document[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [filterType, setFilterType] = useState("all");
    const [filterStatus, setFilterStatus] = useState("all");

    const load = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from("documents")
                .select("id, folio, title, version, status, effective_date, next_review_date, created_at, updated_at, type:document_types(code, name, prefix)")
                .order("created_at", { ascending: false });
            if (error) throw error;
            const fmt = (data || []).map((d: any) => ({ ...d, type: Array.isArray(d.type) ? d.type[0] : d.type }));
            setDocs(fmt);
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);

    const filtered = docs.filter(d => {
        if (filterType !== "all" && d.type?.code !== filterType) return false;
        if (filterStatus !== "all" && d.status !== filterStatus) return false;
        if (search) {
            const s = search.toLowerCase();
            return d.title.toLowerCase().includes(s)
                || d.folio.toLowerCase().includes(s)
                || (d.type?.name || "").toLowerCase().includes(s);
        }
        return true;
    });

    const types = Array.from(new Set(docs.map(d => d.type?.code).filter(Boolean))) as string[];

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
                                <BookOpen className="w-8 h-8 text-violet-400" />
                                Control de Documentos
                            </h1>
                            <p className="text-neutral-400 text-sm mt-1">Procedimientos, formatos, manuales, políticas — ISO 9001:2015.</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={load} className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg transition-colors flex items-center gap-2 text-sm" disabled={loading}>
                            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin text-violet-400")} /> Actualizar
                        </button>
                        <Link href="/documents/new" className="flex items-center justify-center gap-2 bg-violet-500 hover:bg-violet-600 text-white px-5 py-3 rounded-xl font-medium transition-all hover:shadow-[0_0_20px_rgba(139,92,246,0.4)] active:scale-95">
                            <Plus className="w-5 h-5" /> Nuevo documento
                        </Link>
                    </div>
                </header>

                <div className="flex flex-col md:flex-row gap-3">
                    <div className="relative flex-1">
                        <Search className="w-4 h-4 absolute left-3 top-3.5 text-neutral-500" />
                        <input
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Buscar por folio, título o tipo…"
                            className="w-full pl-9 pr-3 py-2.5 bg-neutral-900/50 border border-neutral-700 rounded-lg text-white text-sm focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
                        />
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <Filter className="w-4 h-4 text-neutral-500" />
                        <select value={filterType} onChange={e => setFilterType(e.target.value)} className="bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-violet-500">
                            <option value="all">Todos los tipos</option>
                            {types.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-violet-500">
                            <option value="all">Todos los estatus</option>
                            <option value="draft">Borrador</option>
                            <option value="in_review">En revisión</option>
                            <option value="approved">Vigente</option>
                            <option value="pending_obsolete">Por obsolescer</option>
                            <option value="obsolete">Obsoleto</option>
                        </select>
                    </div>
                </div>

                <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-neutral-900/50 text-neutral-400 uppercase text-xs font-semibold tracking-wider">
                                <tr>
                                    <th className="px-6 py-4 rounded-tl-xl">Folio</th>
                                    <th className="px-6 py-4">Tipo</th>
                                    <th className="px-6 py-4">Título</th>
                                    <th className="px-6 py-4">Versión</th>
                                    <th className="px-6 py-4">Vigencia</th>
                                    <th className="px-6 py-4">Próxima revisión</th>
                                    <th className="px-6 py-4">Estatus</th>
                                    <th className="px-6 py-4 rounded-tr-xl text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-700/50">
                                {loading ? (
                                    <tr><td colSpan={8} className="px-6 py-12 text-center text-neutral-400"><RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-violet-500" /> Cargando…</td></tr>
                                ) : filtered.length === 0 ? (
                                    <tr><td colSpan={8} className="px-6 py-12 text-center text-neutral-400">
                                        <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
                                        <p className="text-lg text-neutral-300 font-medium">No hay documentos</p>
                                        <p className="text-sm mt-1">Crea el primero con el botón de arriba.</p>
                                    </td></tr>
                                ) : filtered.map(d => (
                                    <tr key={d.id} className="hover:bg-neutral-800/80 transition-colors group">
                                        <td className="px-6 py-4">
                                            <span className="font-mono font-medium text-violet-300 bg-violet-500/10 px-2.5 py-1 rounded-md border border-violet-500/20">
                                                {d.folio}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-xs text-neutral-300">
                                            <div>{d.type?.name || "—"}</div>
                                            <div className="text-[10px] text-neutral-500 uppercase">{d.type?.code}</div>
                                        </td>
                                        <td className="px-6 py-4 text-neutral-200 max-w-md truncate" title={d.title}>{d.title}</td>
                                        <td className="px-6 py-4 text-neutral-300 font-mono">v{d.version}</td>
                                        <td className="px-6 py-4 text-neutral-400 text-xs">{d.effective_date ? new Date(d.effective_date).toLocaleDateString() : "—"}</td>
                                        <td className="px-6 py-4 text-neutral-400 text-xs">{d.next_review_date ? new Date(d.next_review_date).toLocaleDateString() : "—"}</td>
                                        <td className="px-6 py-4">
                                            <span className={cn("px-2.5 py-1 rounded-full text-xs font-semibold border", STATUS_STYLES[d.status])}>
                                                {STATUS_LABEL[d.status] || d.status}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <Link href={`/documents/${d.id}`} className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-400 hover:text-violet-300 bg-violet-500/10 hover:bg-violet-500/20 px-3 py-1.5 rounded-lg border border-violet-500/20">
                                                <Eye className="w-3.5 h-3.5" /> Ver
                                            </Link>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
