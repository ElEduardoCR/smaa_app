"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
    ArrowLeft, FileText, RefreshCw, Plus, Filter, X, Inbox, CheckCircle2,
    XCircle, Clock, ShieldCheck, AlertCircle, Search
} from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

type ReqStatus = 'pending_doc_control' | 'rejected_by_doc_control' | 'pending_top_mgmt'
    | 'rejected' | 'approved' | 'published' | 'cancelled';

const STATUS_META: Record<ReqStatus, { label: string; chip: string; icon: any }> = {
    pending_doc_control:     { label: "Pendiente Controlador", chip: "bg-amber-500/10 text-amber-300 border-amber-500/30",   icon: Clock },
    rejected_by_doc_control: { label: "Rechazada por Controlador", chip: "bg-rose-500/10 text-rose-300 border-rose-500/30",  icon: XCircle },
    pending_top_mgmt:        { label: "Pendiente Alta Dirección", chip: "bg-violet-500/10 text-violet-300 border-violet-500/30", icon: ShieldCheck },
    rejected:                { label: "Rechazada por Alta Dir.", chip: "bg-rose-500/10 text-rose-300 border-rose-500/30",   icon: XCircle },
    approved:                { label: "Aprobada (por publicar)", chip: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",   icon: CheckCircle2 },
    published:               { label: "Publicada",               chip: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30", icon: CheckCircle2 },
    cancelled:               { label: "Cancelada",               chip: "bg-neutral-500/10 text-neutral-400 border-neutral-500/30", icon: X },
};

const TYPE_LABEL = { new: "Nuevo", change: "Cambio" } as const;
const TYPE_CHIP = {
    new: "bg-sky-500/10 text-sky-300 border-sky-500/30",
    change: "bg-amber-500/10 text-amber-300 border-amber-500/30",
};

type Request = {
    id: string;
    type: 'new' | 'change';
    title: string;
    change_summary: string | null;
    reason: string;
    status: ReqStatus;
    requested_at: string;
    requested_by: string;
    doc_control_notes: string | null;
    top_mgmt_notes: string | null;
    revision_count: number;
    resulting_document_id: string | null;
    target_document_id: string | null;
};

type EmployeeLite = { id: string; full_name: string; role: string };

export default function RequestsListPage() {
    const [requests, setRequests] = useState<Request[]>([]);
    const [employees, setEmployees] = useState<Record<string, EmployeeLite>>({});
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    const [statusFilter, setStatusFilter] = useState<string>("active");
    const [typeFilter, setTypeFilter] = useState<string>("all");
    const [search, setSearch] = useState("");

    const load = async () => {
        setLoading(true);
        setErr(null);
        try {
            const { data, error } = await supabase
                .from('document_requests')
                .select('*')
                .order('requested_at', { ascending: false });
            if (error) throw error;
            setRequests((data || []) as any);

            const ids = Array.from(new Set((data || []).map((r: any) => r.requested_by).filter(Boolean)));
            if (ids.length) {
                const { data: emps } = await supabase
                    .from('employees')
                    .select('id, full_name, role')
                    .in('id', ids);
                const map: Record<string, EmployeeLite> = {};
                for (const e of (emps || []) as any[]) map[e.id] = e;
                setEmployees(map);
            }
        } catch (e: any) {
            setErr(e?.message || 'Error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const filtered = useMemo(() => {
        let list = requests;
        if (statusFilter === 'active') {
            list = list.filter(r => !['published', 'cancelled', 'rejected'].includes(r.status));
        } else if (statusFilter !== 'all') {
            list = list.filter(r => r.status === statusFilter);
        }
        if (typeFilter !== 'all') list = list.filter(r => r.type === typeFilter);
        if (search.trim()) {
            const q = search.trim().toLowerCase();
            list = list.filter(r =>
                r.title.toLowerCase().includes(q) ||
                (r.reason || '').toLowerCase().includes(q) ||
                (r.change_summary || '').toLowerCase().includes(q)
            );
        }
        return list;
    }, [requests, statusFilter, typeFilter, search]);

    const STATUS_OPTIONS = [
        { value: "active", label: "Activas (pendientes)" },
        { value: "all", label: "Todas" },
        ...Object.entries(STATUS_META).map(([v, m]) => ({ value: v, label: m.label })),
    ];

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-3 sm:p-6 md:p-8 lg:p-10 font-[family-name:var(--font-sans)]">
            <div className="w-full space-y-8">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                        <Link href="/documents" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl text-neutral-400 hover:text-white border border-neutral-700">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div>
                            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                                <FileText className="w-8 h-8 text-violet-400" /> Requisiciones de Documentos
                            </h1>
                            <p className="text-neutral-400 text-sm mt-1">
                                Cualquiera crea la solicitud → Controlador revisa → Alta Dirección aprueba y firma → se publica.
                            </p>
                        </div>
                    </div>
                    <Link href="/documents/requests/new"
                        className="flex items-center justify-center gap-2 bg-violet-500 hover:bg-violet-600 text-white px-6 py-3 rounded-xl font-medium transition-all hover:shadow-[0_0_20px_rgba(167,139,250,0.4)] active:scale-95">
                        <Plus className="w-5 h-5" /> Nueva requisición
                    </Link>
                </header>

                {err && (
                    <div className="p-3 rounded-xl border bg-red-500/10 border-red-500/30 text-red-400 flex items-center gap-3">
                        <AlertCircle className="w-5 h-5" /> {err}
                    </div>
                )}

                {/* Filtros */}
                <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl p-5 flex flex-wrap items-center gap-3">
                    <Filter className="w-4 h-4 text-neutral-400" />
                    <div className="relative flex-1 min-w-[200px]">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
                        <input
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Buscar por título, motivo o cambio..."
                            className="w-full bg-neutral-900/60 border border-neutral-700/50 rounded-xl pl-10 pr-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-violet-500/50"
                        />
                    </div>
                    <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
                        className="bg-neutral-900/60 border border-neutral-700/50 rounded-xl px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-violet-500/50">
                        <option value="all">Todos los tipos</option>
                        <option value="new">Nuevo</option>
                        <option value="change">Cambio</option>
                    </select>
                    <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                        className="bg-neutral-900/60 border border-neutral-700/50 rounded-xl px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-violet-500/50">
                        {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <button onClick={load} className="p-2 text-neutral-400 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded-lg border border-neutral-700" title="Refrescar">
                        <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
                    </button>
                </div>

                {/* Lista */}
                {loading ? (
                    <div className="flex items-center justify-center py-16 text-neutral-500 gap-2">
                        <RefreshCw className="w-5 h-5 animate-spin" /> Cargando requisiciones...
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-10 text-center">
                        <Inbox className="w-10 h-10 text-neutral-600 mx-auto mb-3" />
                        <p className="text-neutral-400">No hay requisiciones con esos filtros.</p>
                        <Link href="/documents/requests/new" className="inline-block mt-3 text-violet-400 hover:text-violet-300 text-sm">
                            Crear la primera →
                        </Link>
                    </div>
                ) : (
                    <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl divide-y divide-neutral-700/40">
                        {filtered.map(r => {
                            const meta = STATUS_META[r.status];
                            const Icon = meta.icon;
                            const emp = employees[r.requested_by];
                            return (
                                <Link key={r.id} href={`/documents/requests/${r.id}`}
                                    className="block p-4 hover:bg-neutral-800/60 transition-colors">
                                    <div className="flex items-start gap-3 flex-wrap">
                                        <span className={cn("text-[10px] font-bold uppercase px-2 py-0.5 rounded border", TYPE_CHIP[r.type])}>
                                            {TYPE_LABEL[r.type]}
                                        </span>
                                        <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border inline-flex items-center gap-1", meta.chip)}>
                                            <Icon className="w-3 h-3" /> {meta.label}
                                        </span>
                                        {r.revision_count > 0 && (
                                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-700 text-neutral-300">
                                                rev. {r.revision_count}
                                            </span>
                                        )}
                                        <span className="ml-auto text-[10px] text-neutral-500 font-mono">
                                            {new Date(r.requested_at).toLocaleString()}
                                        </span>
                                    </div>
                                    <h3 className="text-white font-semibold mt-2">{r.title}</h3>
                                    <p className="text-sm text-neutral-400 mt-0.5 line-clamp-2">{r.reason}</p>
                                    <p className="text-[10px] text-neutral-500 mt-2">
                                        Solicitante: {emp?.full_name ?? r.requested_by.slice(0, 8) + '…'}
                                        {emp?.role && <span className="ml-1 text-neutral-600">({emp.role})</span>}
                                    </p>
                                    {(r.doc_control_notes || r.top_mgmt_notes) && (
                                        <p className="text-[10px] mt-1.5 text-amber-300/80 inline-flex items-center gap-1">
                                            <AlertCircle className="w-3 h-3" /> Tiene notas del revisor
                                        </p>
                                    )}
                                </Link>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
