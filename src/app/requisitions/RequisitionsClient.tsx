"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
    ArrowLeft, Plus, ClipboardList, Loader2, Eye, Package, Calendar, AlertCircle,
    Store, FileText, X
} from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

type ReqRow = {
    id: string;
    code: string;
    status: 'pending' | 'purchased' | 'cancelled';
    priority: 'low' | 'normal' | 'high' | 'urgent';
    needed_by: string | null;
    suggested_supplier_text: string | null;
    notes: string | null;
    created_at: string;
    purchased_at: string | null;
    invoice_url: string | null;
    invoice_photo_url: string | null;
    requested_by: string;
    items: { id: string }[];
    requester: { id: string; full_name: string; position: string | null; photo_url: string | null } | null;
};

const STATUS_STYLES: Record<string, { label: string; chip: string }> = {
    pending:   { label: "Pendiente",  chip: "bg-amber-500/20 text-amber-300 border-amber-500/30" },
    purchased: { label: "Comprada",   chip: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
    cancelled: { label: "Cancelada",  chip: "bg-neutral-700/40 text-neutral-400 border-neutral-600/30" },
};

const PRIORITY_STYLES: Record<string, { label: string; chip: string }> = {
    low:    { label: "Baja",    chip: "bg-slate-500/20 text-slate-300 border-slate-500/30" },
    normal: { label: "Normal",  chip: "bg-sky-500/20 text-sky-300 border-sky-500/30" },
    high:   { label: "Alta",    chip: "bg-orange-500/20 text-orange-300 border-orange-500/30" },
    urgent: { label: "Urgente", chip: "bg-rose-500/20 text-rose-300 border-rose-500/30" },
};

function fmtDate(iso: string | null) {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "2-digit" }); }
    catch { return iso; }
}

function fmtDateTime(iso: string | null) {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" }); }
    catch { return iso; }
}

function initials(name: string) {
    const parts = name.trim().split(/\s+/).slice(0, 2);
    return parts.map((p) => p[0]?.toUpperCase() || "").join("");
}

export default function RequisitionsClient({
    currentUserId,
    canCreate,
    canPurchase,
    canViewAll,
    initialTab,
    counts,
    initialRows,
}: {
    currentUserId: string;
    canCreate: boolean;
    canPurchase: boolean;
    canViewAll: boolean;
    initialTab: 'mine' | 'pending' | 'all';
    counts: { mineTotal: number; minePending: number; allPending: number; allTotal: number };
    initialRows: ReqRow[];
}) {
    const router = useRouter();
    const search = useSearchParams();
    const [tab, setTab] = useState<'mine' | 'pending' | 'all'>(initialTab);

    const changeTab = (t: 'mine' | 'pending' | 'all') => {
        setTab(t);
        const params = new URLSearchParams(search?.toString() || "");
        params.set('tab', t);
        router.push(`/requisitions?${params.toString()}`);
    };

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 font-[family-name:var(--font-sans)]">
            <div className="max-w-[1400px] mx-auto p-3 md:p-6 space-y-4">
                {/* Header */}
                <header className="bg-neutral-800/40 p-4 rounded-2xl border border-neutral-700/50 flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3">
                        <Link href="/" className="p-2.5 bg-neutral-800 hover:bg-neutral-700 rounded-xl border border-neutral-700">
                            <ArrowLeft className="w-4 h-4" />
                        </Link>
                        <div>
                            <h1 className="text-xl font-bold text-white flex items-center gap-2">
                                <ClipboardList className="w-5 h-5 text-amber-400" />
                                Requisiciones
                            </h1>
                            <p className="text-xs text-neutral-400">Solicitudes de insumos — operador → compras</p>
                        </div>
                    </div>
                    {canCreate && (
                        <Link
                            href="/requisitions/new"
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white text-xs font-semibold"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            Nueva requisición
                        </Link>
                    )}
                </header>

                {/* Tabs */}
                <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-1.5 flex gap-1 flex-wrap">
                    <TabButton active={tab === 'mine'} onClick={() => changeTab('mine')} label="Mis requisiciones" count={counts.mineTotal} pending={counts.minePending} />
                    {canViewAll && (
                        <TabButton active={tab === 'pending'} onClick={() => changeTab('pending')} label="Pendientes (todas)" count={counts.allPending} pending={counts.allPending} />
                    )}
                    {canViewAll && (
                        <TabButton active={tab === 'all'} onClick={() => changeTab('all')} label="Todas" count={counts.allTotal} pending={null} />
                    )}
                </div>

                {/* Lista */}
                {initialRows.length === 0 ? (
                    <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-12 text-center">
                        <ClipboardList className="w-12 h-12 text-neutral-600 mx-auto mb-3" />
                        <h2 className="text-lg font-bold text-white mb-2">No hay requisiciones</h2>
                        <p className="text-sm text-neutral-400">
                            {tab === 'mine' && "Aún no has solicitado nada. Crea tu primera requisición."}
                            {tab === 'pending' && "No hay requisiciones pendientes en este momento."}
                            {tab === 'all' && "El sistema aún no tiene requisiciones registradas."}
                        </p>
                        {canCreate && tab === 'mine' && (
                            <Link
                                href="/requisitions/new"
                                className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold"
                            >
                                <Plus className="w-4 h-4" />
                                Crear requisición
                            </Link>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {initialRows.map((r) => (
                            <ReqCard key={r.id} req={r} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function TabButton({ active, onClick, label, count, pending }: { active: boolean; onClick: () => void; label: string; count: number; pending: number | null }) {
    return (
        <button
            onClick={onClick}
            className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors",
                active ? "bg-orange-500/20 text-orange-200 border border-orange-500/30" : "text-neutral-400 hover:bg-neutral-800/60 border border-transparent"
            )}
        >
            {label}
            <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded", active ? "bg-orange-500/30 text-orange-100" : "bg-neutral-700/60 text-neutral-300")}>
                {count}
            </span>
            {pending !== null && pending > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/30 text-amber-200 border border-amber-500/30">
                    {pending} pend.
                </span>
            )}
        </button>
    );
}

function ReqCard({ req }: { req: ReqRow }) {
    const status = STATUS_STYLES[req.status] || STATUS_STYLES.pending;
    const prio = PRIORITY_STYLES[req.priority] || PRIORITY_STYLES.normal;
    const requester = req.requester;

    return (
        <Link
            href={`/requisitions/${req.id}`}
            className="bg-neutral-800/40 border border-neutral-700/50 hover:border-orange-500/40 rounded-2xl p-4 transition-colors group"
        >
            <div className="flex items-start justify-between mb-3">
                <div>
                    <p className="text-[10px] font-mono text-neutral-500 uppercase tracking-wider">{req.code}</p>
                    <p className="text-base font-bold text-white mt-0.5 flex items-center gap-1.5">
                        <Package className="w-4 h-4 text-amber-400" />
                        {req.items.length} artículo{req.items.length === 1 ? "" : "s"}
                    </p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                    <span className={cn("text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border", status.chip)}>
                        {status.label}
                    </span>
                    <span className={cn("text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full border", prio.chip)}>
                        {prio.label}
                    </span>
                </div>
            </div>

            {req.suggested_supplier_text && (
                <div className="flex items-center gap-1.5 text-[11px] text-neutral-300 mb-1.5">
                    <Store className="w-3 h-3 text-neutral-500" />
                    <span className="truncate">Sugerencia: <span className="text-neutral-200">{req.suggested_supplier_text}</span></span>
                </div>
            )}

            {req.needed_by && (
                <div className="flex items-center gap-1.5 text-[11px] text-neutral-400 mb-2">
                    <Calendar className="w-3 h-3" />
                    Necesario para: <span className="text-neutral-200">{fmtDate(req.needed_by)}</span>
                </div>
            )}

            <div className="border-t border-neutral-700/40 pt-2.5 mt-2.5 flex items-center justify-between text-[10px] text-neutral-500">
                <div className="flex items-center gap-1.5 min-w-0">
                    {requester?.photo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={requester.photo_url} alt={requester.full_name} className="w-5 h-5 rounded-md object-cover" />
                    ) : (
                        <div className="w-5 h-5 rounded-md bg-gradient-to-br from-orange-500/30 to-amber-500/30 flex items-center justify-center text-[8px] font-bold text-orange-200">
                            {initials(requester?.full_name || "?")}
                        </div>
                    )}
                    <span className="truncate">{requester?.full_name || "—"}</span>
                </div>
                <span>{fmtDateTime(req.created_at)}</span>
            </div>
        </Link>
    );
}
