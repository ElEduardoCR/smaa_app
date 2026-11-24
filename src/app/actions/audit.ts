'use server';

import { getSession, type Session } from '@/lib/session';
import { can } from '@/lib/permissions';
import { getServerSupabase } from '@/lib/supabaseServer';
import type { AuditRootTable, HistoryEntry } from '@/lib/auditLabels';

// ===========================================================================
// Lectura de la bitácora de ediciones (audit_log). La tabla sólo la escriben
// triggers de la base; aquí únicamente se lee, con el permiso del módulo al
// que pertenece cada registro.
// ===========================================================================

const ROOT_FOLIO: Record<AuditRootTable, { table: string; column: string }> = {
    quotations: { table: 'quotations', column: 'quotation_number' },
    purchase_orders: { table: 'purchase_orders', column: 'po_number' },
    work_orders: { table: 'work_orders', column: 'order_number' },
    ar_invoices: { table: 'ar_invoices', column: 'invoice_number' },
    vehicles: { table: 'vehicles', column: 'alias' },
};

function canViewRoot(session: Session, root: AuditRootTable): boolean {
    if (session.role === 'master') return true;
    switch (root) {
        case 'quotations': return can(session.role, session.permissions, 'sales', 'view');
        case 'purchase_orders': return can(session.role, session.permissions, 'purchases', 'view');
        case 'work_orders':
            return session.permissions.some((p) => p.module_code === 'manufacturing' && p.can_view)
                || can(session.role, session.permissions, 'quality', 'view');
        case 'ar_invoices': return can(session.role, session.permissions, 'finance', 'view', 'receivable');
        case 'vehicles': return can(session.role, session.permissions, 'vehicles', 'view');
    }
}

const COLUMNS = 'id, occurred_at, table_name, record_id, root_table, root_id, operation, changed_fields, old_data, new_data, actor_id, actor_name, source, reason, txid';

type AuditRow = {
    id: number; occurred_at: string; table_name: string; record_id: string; root_table: AuditRootTable; root_id: string;
    operation: HistoryEntry['operation']; changed_fields: string[] | null; old_data: Record<string, unknown> | null;
    new_data: Record<string, unknown> | null; actor_id: string | null; actor_name: string | null; source: string;
    reason: string | null; txid: number;
};

// Llaves foráneas que se muestran con su nombre en vez del id interno.
const REFERENCES: Record<string, { table: string; label: (row: Record<string, unknown>) => string; columns: string }> = {
    module_id: { table: 'manufacturing_modules', columns: 'id, name', label: (r) => String(r.name) },
    client_id: { table: 'clients', columns: 'id, name, business_name', label: (r) => String(r.name || r.business_name) },
    supplier_id: { table: 'suppliers', columns: 'id, name, business_name', label: (r) => String(r.name || r.business_name) },
    employee_id: { table: 'employees', columns: 'id, full_name', label: (r) => String(r.full_name) },
    responsible_employee_id: { table: 'employees', columns: 'id, full_name', label: (r) => String(r.full_name) },
    wps_id: { table: 'wps_procedures', columns: 'id, code, name', label: (r) => `${r.code} ${r.name}` },
    file_id: { table: 'vehicle_files', columns: 'id, file_name', label: (r) => String(r.file_name) },
    cover_file_id: { table: 'vehicle_files', columns: 'id, file_name', label: (r) => String(r.file_name) },
};

async function resolveReferences(rows: AuditRow[]): Promise<AuditRow[]> {
    const wanted = new Map<string, Set<string>>();
    for (const row of rows) {
        for (const data of [row.old_data, row.new_data]) {
            for (const field of Object.keys(data || {})) {
                const value = data?.[field];
                if (REFERENCES[field] && value !== null && value !== undefined && value !== '') {
                    const table = REFERENCES[field].table;
                    if (!wanted.has(table)) wanted.set(table, new Set());
                    wanted.get(table)!.add(String(value));
                }
            }
        }
    }
    if (!wanted.size) return rows;
    const names = new Map<string, string>();
    const db = getServerSupabase();
    await Promise.all(Array.from(wanted.entries()).map(async ([table, ids]) => {
        const ref = Object.values(REFERENCES).find((r) => r.table === table)!;
        const { data } = await db.from(table).select(ref.columns).in('id', Array.from(ids));
        ((data || []) as unknown as Record<string, unknown>[]).forEach((record) => names.set(`${table}:${record.id}`, ref.label(record)));
    }));
    const swap = (data: Record<string, unknown> | null) => {
        if (!data) return data;
        const out = { ...data };
        for (const field of Object.keys(out)) {
            const ref = REFERENCES[field];
            if (ref && out[field] !== null && out[field] !== undefined) out[field] = names.get(`${ref.table}:${out[field]}`) ?? out[field];
        }
        return out;
    };
    return rows.map((row) => ({ ...row, old_data: swap(row.old_data), new_data: swap(row.new_data) }));
}

function toEntry(row: AuditRow, folio?: string | null): HistoryEntry {
    return {
        id: row.id, occurredAt: row.occurred_at, table: row.table_name, recordId: row.record_id,
        rootTable: row.root_table, rootId: row.root_id, rootFolio: folio ?? null,
        operation: row.operation, changedFields: row.changed_fields, oldData: row.old_data, newData: row.new_data,
        actorId: row.actor_id, actorName: row.actor_name, source: row.source, reason: row.reason, txid: Number(row.txid),
    };
}

/** Historial de un registro (cotización, compra, OT, cuenta por cobrar o vehículo). */
export async function getRecordHistoryAction(rootTable: AuditRootTable, rootId: string): Promise<HistoryEntry[]> {
    const session = await getSession();
    if (!session) throw new Error('No autenticado.');
    if (!ROOT_FOLIO[rootTable]) throw new Error('Registro no válido.');
    if (!canViewRoot(session, rootTable)) throw new Error('Sin permiso para ver este historial.');
    const { data, error } = await getServerSupabase().from('audit_log').select(COLUMNS)
        .eq('root_table', rootTable).eq('root_id', rootId).order('id', { ascending: false }).limit(500);
    if (error) throw new Error(error.message);
    return (await resolveReferences((data || []) as AuditRow[])).map((row) => toEntry(row));
}

export type AuditFilters = {
    rootTable?: AuditRootTable | '';
    actorId?: string;
    onlyWithoutActor?: boolean;
    from?: string;
    to?: string;
    beforeId?: number;
};

/** Bitácora general (módulo «Bitácora de ediciones»). */
export async function listAuditLogAction(filters: AuditFilters): Promise<{ entries: HistoryEntry[]; actors: { id: string; name: string }[] }> {
    const session = await getSession();
    if (!session) throw new Error('No autenticado.');
    if (!can(session.role, session.permissions, 'audit', 'view')) throw new Error('Sin permiso para ver la bitácora.');
    const db = getServerSupabase();
    let query = db.from('audit_log').select(COLUMNS).order('id', { ascending: false }).limit(300);
    if (filters.rootTable) query = query.eq('root_table', filters.rootTable);
    if (filters.actorId) query = query.eq('actor_id', filters.actorId);
    if (filters.onlyWithoutActor) query = query.is('actor_id', null);
    if (filters.from) query = query.gte('occurred_at', `${filters.from}T00:00:00`);
    if (filters.to) query = query.lte('occurred_at', `${filters.to}T23:59:59.999`);
    if (filters.beforeId) query = query.lt('id', filters.beforeId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const rows = await resolveReferences((data || []) as AuditRow[]);

    const folios = new Map<string, string>();
    await Promise.all((Object.keys(ROOT_FOLIO) as AuditRootTable[]).map(async (root) => {
        const ids = Array.from(new Set(rows.filter((r) => r.root_table === root).map((r) => r.root_id)));
        if (!ids.length) return;
        const { table, column } = ROOT_FOLIO[root];
        const { data: records } = await db.from(table).select(`id, ${column}`).in('id', ids);
        ((records || []) as unknown as Record<string, string>[]).forEach((record) => folios.set(`${root}:${record.id}`, record[column]));
    }));

    const { data: employees } = await db.from('employees').select('id, full_name').order('full_name');
    return {
        entries: rows.map((row) => toEntry(row, folios.get(`${row.root_table}:${row.root_id}`))),
        actors: (employees || []).map((e) => ({ id: e.id, name: e.full_name })),
    };
}
