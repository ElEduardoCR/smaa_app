"use client";

// ===========================================================================
// Historial de cambios de un registro (cotización, compra, OT, cuenta por
// cobrar, vehículo). Lee la bitácora inalterable que llenan los triggers de la
// base y agrupa por operación (una edición = una transacción).
// ===========================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { History, RefreshCw, ShieldAlert, ChevronDown, ChevronUp } from "lucide-react";
import { getRecordHistoryAction } from "@/app/actions/audit";
import {
    changeLines, isUnverified, operationLabel, rowLabel, ROOT_LABEL,
    type AuditRootTable, type HistoryEntry,
} from "@/lib/auditLabels";

type Group = { txid: number; occurredAt: string; actorName: string | null; unverified: boolean; source: string; reason: string | null; entries: HistoryEntry[] };

export function groupHistory(entries: HistoryEntry[]): Group[] {
    // Una edición = una transacción. Las acciones que guardan en varias
    // peticiones (encabezado y luego artículos) se juntan si son del mismo
    // autor, con el mismo motivo y con segundos de diferencia.
    const sorted = [...entries].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id - a.id);
    const groups: Group[] = [];
    for (const entry of sorted) {
        const last = groups[groups.length - 1];
        const sameTx = last && last.txid === entry.txid && last.entries[0].actorId === entry.actorId;
        const sameEdit = last && entry.actorId && last.entries[0].actorId === entry.actorId
            && (last.reason || null) === (entry.reason || null) && last.entries[0].rootId === entry.rootId
            && Math.abs(new Date(last.occurredAt).getTime() - new Date(entry.occurredAt).getTime()) < 15000;
        if (last && (sameTx || sameEdit)) {
            last.entries.push(entry);
            if (!last.reason && entry.reason) last.reason = entry.reason;
        } else {
            groups.push({
                txid: entry.txid, occurredAt: entry.occurredAt, actorName: entry.actorName, unverified: isUnverified(entry),
                source: entry.source, reason: entry.reason, entries: [entry],
            });
        }
    }
    return groups;
}

export function HistoryGroup({ group, showRoot = false, link }: { group: Group; showRoot?: boolean; link?: string }) {
    const first = group.entries[0];
    return (
        <li className="bg-neutral-900/40 border border-neutral-800/60 rounded-xl p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-neutral-300">
                    <span className="font-semibold text-white">{group.actorName || "Sin usuario identificado"}</span>
                    {showRoot && <span className="text-neutral-400"> · {ROOT_LABEL[first.rootTable]} {first.rootFolio || ""}</span>}
                    {link && <Link href={link} className="ml-2 text-sky-300 hover:underline">Abrir</Link>}
                </p>
                <p className="text-[11px] text-neutral-500 font-mono">{new Date(group.occurredAt).toLocaleString("es-MX")}</p>
            </div>
            {group.unverified && (
                <p className="text-[11px] text-amber-300 flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5" /> Cambio hecho fuera de la app ({group.source}); no hay usuario verificado.
                </p>
            )}
            {group.reason && <p className="text-xs text-sky-200">Motivo: {group.reason}</p>}
            <ul className="space-y-1.5">
                {group.entries.map((entry) => {
                    const lines = changeLines(entry);
                    const label = rowLabel(entry);
                    return (
                        <li key={entry.id} className="text-xs">
                            <p className="text-neutral-200 font-medium">
                                {operationLabel(entry)}{label && entry.table !== first.rootTable ? <span className="text-neutral-400 font-normal"> · {label}</span> : null}
                            </p>
                            {lines.length > 0 && (
                                <ul className="mt-0.5 space-y-0.5 pl-3 border-l border-neutral-700/60">
                                    {lines.map((line) => (
                                        <li key={line.field} className="text-neutral-400">
                                            <span className="text-neutral-500">{line.label}:</span>{" "}
                                            {entry.operation === "UPDATE" ? (
                                                <><span className="line-through decoration-rose-400/70">{line.before}</span> → <span className="text-emerald-300">{line.after}</span></>
                                            ) : entry.operation === "INSERT" ? (
                                                <span className="text-emerald-300">{line.after}</span>
                                            ) : (
                                                <span className="line-through decoration-rose-400/70">{line.before}</span>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </li>
                    );
                })}
            </ul>
        </li>
    );
}

export default function EditHistory({ rootTable, rootId, title = "Historial de cambios", defaultOpen = false, refreshKey }: {
    rootTable: AuditRootTable;
    rootId: string;
    title?: string;
    defaultOpen?: boolean;
    /** Cambiarlo vuelve a cargar el historial (p. ej. después de guardar). */
    refreshKey?: unknown;
}) {
    const [open, setOpen] = useState(defaultOpen);
    const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            setEntries(await getRecordHistoryAction(rootTable, rootId));
        } catch (e) {
            setError(e instanceof Error ? e.message : "No se pudo cargar el historial.");
        } finally {
            setLoading(false);
        }
    }, [rootTable, rootId]);

    useEffect(() => { if (open) load(); }, [open, load, refreshKey]);
    const groups = useMemo(() => groupHistory(entries || []), [entries]);

    return (
        <section className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-4">
            <button type="button" onClick={() => setOpen(!open)} className="w-full flex items-center justify-between gap-2 text-left">
                <span className="text-sm font-semibold text-white flex items-center gap-2">
                    <History className="w-4 h-4 text-sky-400" /> {title}
                    {entries && <span className="text-xs font-normal text-neutral-500">({groups.length})</span>}
                </span>
                {open ? <ChevronUp className="w-4 h-4 text-neutral-400" /> : <ChevronDown className="w-4 h-4 text-neutral-400" />}
            </button>
            {open && (
                <div className="mt-3 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] text-neutral-500">Cada alta, edición o baja queda registrada con usuario, fecha y valor anterior. No se puede modificar.</p>
                        <button type="button" onClick={load} disabled={loading} className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-700/50" title="Actualizar">
                            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                        </button>
                    </div>
                    {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
                    {!error && entries && groups.length === 0 && <p className="text-xs text-neutral-500">Sin cambios registrados todavía.</p>}
                    {groups.length > 0 && <ul className="space-y-2 max-h-[480px] overflow-y-auto pr-1">{groups.map((g) => <HistoryGroup key={`${g.txid}-${g.occurredAt}`} group={g} />)}</ul>}
                </div>
            )}
        </section>
    );
}
