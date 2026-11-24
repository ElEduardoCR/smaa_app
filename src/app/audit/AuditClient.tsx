"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, ScrollText, ShieldAlert } from "lucide-react";
import { listAuditLogAction, type AuditFilters } from "@/app/actions/audit";
import { groupHistory, HistoryGroup } from "@/components/EditHistory";
import { ROOT_LABEL, type AuditRootTable, type HistoryEntry } from "@/lib/auditLabels";

const ROOT_LINK: Partial<Record<AuditRootTable, (entry: HistoryEntry) => string>> = {
    quotations: (e) => `/sales?q=${encodeURIComponent(e.rootFolio || "")}`,
    purchase_orders: (e) => `/purchases/${e.rootId}`,
    work_orders: (e) => `/manufacturing/ot/${e.rootId}`,
    vehicles: (e) => `/vehicles/${e.rootId}`,
};

export default function AuditClient() {
    const [filters, setFilters] = useState<AuditFilters>({ rootTable: "" });
    const [entries, setEntries] = useState<HistoryEntry[]>([]);
    const [actors, setActors] = useState<{ id: string; name: string }[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [hasMore, setHasMore] = useState(false);

    const load = useCallback(async (more = false) => {
        setLoading(true);
        setError("");
        try {
            const result = await listAuditLogAction({ ...filters, beforeId: more ? entries[entries.length - 1]?.id : undefined });
            setEntries((list) => (more ? [...list, ...result.entries] : result.entries));
            setActors(result.actors);
            setHasMore(result.entries.length === 300);
        } catch (e) {
            setError(e instanceof Error ? e.message : "No se pudo cargar la bitácora.");
        } finally {
            setLoading(false);
        }
    }, [filters, entries]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { load(false); }, [filters]);

    const groups = useMemo(() => groupHistory(entries), [entries]);
    const unverified = groups.filter((g) => g.unverified).length;
    const set = (patch: Partial<AuditFilters>) => setFilters((f) => ({ ...f, ...patch }));
    const field = "bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white";

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-3 sm:p-6 md:p-8 lg:p-10">
            <div className="max-w-[1200px] mx-auto space-y-6">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl text-neutral-400 hover:text-white border border-neutral-700"><ArrowLeft className="w-5 h-5" /></Link>
                        <div>
                            <h1 className="text-3xl font-bold text-white flex items-center gap-3"><ScrollText className="w-8 h-8 text-rose-400" /> Bitácora de ediciones</h1>
                            <p className="text-neutral-400 text-sm mt-1">Altas, cambios y bajas de cotizaciones, compras, OT, cuentas por cobrar y vehículos. No se puede editar ni borrar.</p>
                        </div>
                    </div>
                    <button onClick={() => load(false)} className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg" title="Actualizar"><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /></button>
                </header>

                <div className="flex flex-wrap items-end gap-3 bg-neutral-800/40 p-4 rounded-2xl border border-neutral-700/50">
                    <label className="text-xs text-neutral-400">Registro<br />
                        <select value={filters.rootTable || ""} onChange={(e) => set({ rootTable: e.target.value as AuditRootTable | "" })} className={field}>
                            <option value="">Todos</option>
                            {(Object.keys(ROOT_LABEL) as AuditRootTable[]).map((root) => <option key={root} value={root}>{ROOT_LABEL[root]}</option>)}
                        </select>
                    </label>
                    <label className="text-xs text-neutral-400">Usuario<br />
                        <select value={filters.actorId || ""} onChange={(e) => set({ actorId: e.target.value || undefined, onlyWithoutActor: false })} className={field}>
                            <option value="">Todos</option>
                            {actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                    </label>
                    <label className="text-xs text-neutral-400">Desde<br /><input type="date" value={filters.from || ""} onChange={(e) => set({ from: e.target.value || undefined })} className={field} /></label>
                    <label className="text-xs text-neutral-400">Hasta<br /><input type="date" value={filters.to || ""} onChange={(e) => set({ to: e.target.value || undefined })} className={field} /></label>
                    <label className="text-xs text-amber-300 flex items-center gap-2 pb-2"><input type="checkbox" checked={!!filters.onlyWithoutActor} onChange={(e) => set({ onlyWithoutActor: e.target.checked, actorId: undefined })} /> Sólo cambios sin usuario verificado</label>
                </div>

                {unverified > 0 && !filters.onlyWithoutActor && (
                    <p className="text-xs text-amber-300 flex items-center gap-1.5"><ShieldAlert className="w-3.5 h-3.5" /> {unverified} cambio(s) en esta vista se hicieron fuera de la app o sin sesión verificada.</p>
                )}
                {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}

                {!loading && groups.length === 0 ? <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl p-12 text-center text-neutral-400">Sin cambios con estos filtros.</div> : (
                    <ul className="space-y-2">
                        {groups.map((group) => {
                            const first = group.entries[0];
                            const link = ROOT_LINK[first.rootTable]?.(first);
                            return (
                                <HistoryGroup key={`${group.txid}-${group.occurredAt}-${first.id}`} group={group} showRoot link={link} />
                            );
                        })}
                    </ul>
                )}
                {hasMore && <button onClick={() => load(true)} disabled={loading} className="w-full text-sm text-neutral-300 border border-neutral-700 rounded-xl py-2.5 hover:bg-neutral-800">Cargar anteriores</button>}
            </div>
        </div>
    );
}
