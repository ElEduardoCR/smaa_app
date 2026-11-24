'use server';

import { revalidatePath } from 'next/cache';
import { getSession, type Session } from '@/lib/session';
import { can, type Action } from '@/lib/permissions';
import { getActorSupabase, getServerSupabase } from '@/lib/supabaseServer';
import { createVehicleUploadUrl, removeVehicleFile, signVehicleFiles, statVehicleFile } from '@/lib/vehicles/storage';
import {
    DOCUMENT_TYPES, EXPENSE_CATEGORIES, SERVICE_ITEMS, documentAlerts, lastServices, oilStatus, spendSummary,
    type DocumentAlert, type LastService, type OilStatus, type SpendSummary,
} from '@/lib/vehicles/catalog';

// ===========================================================================
// Expediente de vehículos. Las tablas y el bucket son privados: todo se lee y
// escribe aquí con el permiso del módulo `vehicles`. Las escrituras usan el
// cliente con autor, así cada cambio queda en la bitácora a nombre de quien
// lo hizo.
// ===========================================================================

async function requireVehicles(action: Action): Promise<Session> {
    const session = await getSession();
    if (!session) throw new Error('No autenticado.');
    if (!can(session.role, session.permissions, 'vehicles', action)) {
        const verb = { view: 'ver', create: 'registrar', edit: 'editar', delete: 'eliminar' }[action as string] || 'modificar';
        throw new Error(`Sin permiso para ${verb} vehículos.`);
    }
    return session;
}

function writer(session: Session) {
    return getActorSupabase(session.employeeId);
}

function clean(value: unknown): string | null {
    const text = typeof value === 'string' ? value.trim() : '';
    return text || null;
}

function intOrNull(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || n < 0) throw new Error('Revisa los kilómetros capturados.');
    return n;
}

function moneyOrNull(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = Math.round(Number(value) * 100) / 100;
    if (!Number.isFinite(n) || n < 0) throw new Error('Revisa los importes capturados.');
    return n;
}

function dateOrNull(value: unknown): string | null {
    const text = clean(value);
    if (!text) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('Fecha inválida.');
    return text;
}

function revalidateVehicle(id?: string) {
    revalidatePath('/vehicles');
    if (id) revalidatePath(`/vehicles/${id}`);
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------
export type VehicleSummary = {
    id: string; alias: string; brand: string | null; model: string | null; year: number | null; plates: string | null;
    color: string | null; odometer_km: number | null; is_active: boolean; responsible: string | null; coverUrl: string | null;
    oil: OilStatus; alerts: DocumentAlert[]; spend: SpendSummary;
};

const VEHICLE_COLUMNS = 'id, alias, brand, model, year, plates, vin, engine_number, color, fuel_type, odometer_km, odometer_updated_at, responsible_employee_id, cover_file_id, oil_interval_km, oil_interval_months, notes, is_active, created_at';

export async function listVehiclesAction(): Promise<{ vehicles: VehicleSummary[]; canCreate: boolean }> {
    const session = await requireVehicles('view');
    const db = getServerSupabase();
    const [vehicles, services, expenses, documents, employees] = await Promise.all([
        db.from('vehicles').select(VEHICLE_COLUMNS).order('is_active', { ascending: false }).order('alias'),
        db.from('vehicle_services').select('id, vehicle_id, service_date, odometer_km, items, cost, next_service_date, next_service_km'),
        db.from('vehicle_expenses').select('vehicle_id, expense_date, amount, category'),
        db.from('vehicle_documents').select('id, vehicle_id, doc_type, expires_at, provider, document_number, issued_at, cost'),
        db.from('employees').select('id, full_name'),
    ]);
    for (const result of [vehicles, services, expenses, documents]) if (result.error) throw new Error(result.error.message);
    const coverIds = (vehicles.data || []).map((v) => v.cover_file_id).filter(Boolean) as string[];
    const { data: covers } = coverIds.length
        ? await db.from('vehicle_files').select('id, storage_path').in('id', coverIds)
        : { data: [] as { id: string; storage_path: string }[] };
    const signed = await signVehicleFiles((covers || []).map((c) => c.storage_path));
    const coverById = new Map((covers || []).map((c) => [c.id, signed.get(c.storage_path) || null]));
    const names = new Map((employees.data || []).map((e) => [e.id, e.full_name]));
    const by = <T extends { vehicle_id: string }>(rows: T[] | null, id: string) => (rows || []).filter((r) => r.vehicle_id === id);

    return {
        canCreate: can(session.role, session.permissions, 'vehicles', 'create'),
        vehicles: (vehicles.data || []).map((v) => {
            const vehicleServices = by(services.data, v.id).map((s) => ({ ...s, cost: Number(s.cost) }));
            const vehicleDocs = by(documents.data, v.id).map((d) => ({ ...d, cost: d.cost === null ? null : Number(d.cost) }));
            return {
                id: v.id, alias: v.alias, brand: v.brand, model: v.model, year: v.year, plates: v.plates, color: v.color,
                odometer_km: v.odometer_km, is_active: v.is_active,
                responsible: v.responsible_employee_id ? names.get(v.responsible_employee_id) || null : null,
                coverUrl: v.cover_file_id ? coverById.get(v.cover_file_id) || null : null,
                oil: oilStatus(vehicleServices, v),
                alerts: documentAlerts(vehicleDocs),
                spend: spendSummary(vehicleServices, by(expenses.data, v.id).map((e) => ({ ...e, amount: Number(e.amount) })), vehicleDocs),
            };
        }),
    };
}

export type VehicleFile = { id: string; kind: string; file_name: string; content_type: string | null; caption: string | null; created_at: string; uploaded_by_name: string | null; url: string | null };

export async function getVehicleAction(id: string) {
    const session = await requireVehicles('view');
    const db = getServerSupabase();
    const [vehicle, files, documents, services, expenses, employees] = await Promise.all([
        db.from('vehicles').select(VEHICLE_COLUMNS).eq('id', id).single(),
        db.from('vehicle_files').select('id, kind, storage_path, file_name, content_type, caption, created_at, uploaded_by_name').eq('vehicle_id', id).order('created_at', { ascending: false }),
        db.from('vehicle_documents').select('*').eq('vehicle_id', id).order('expires_at', { ascending: false, nullsFirst: false }),
        db.from('vehicle_services').select('*').eq('vehicle_id', id).order('service_date', { ascending: false }),
        db.from('vehicle_expenses').select('*').eq('vehicle_id', id).order('expense_date', { ascending: false }),
        db.from('employees').select('id, full_name').eq('is_active', true).order('full_name'),
    ]);
    if (vehicle.error || !vehicle.data) throw new Error('No se encontró el vehículo.');
    for (const result of [files, documents, services, expenses]) if (result.error) throw new Error(result.error.message);
    const signed = await signVehicleFiles((files.data || []).map((f) => f.storage_path));
    const serviceRows = (services.data || []).map((s) => ({ ...s, cost: Number(s.cost) }));
    const documentRows = (documents.data || []).map((d) => ({ ...d, cost: d.cost === null ? null : Number(d.cost) }));
    const expenseRows = (expenses.data || []).map((e) => ({ ...e, amount: Number(e.amount), liters: e.liters === null ? null : Number(e.liters) }));
    const last: Record<string, LastService> = lastServices(serviceRows);
    return {
        vehicle: vehicle.data,
        files: (files.data || []).map(({ storage_path, ...f }) => ({ ...f, url: signed.get(storage_path) || null })) as VehicleFile[],
        documents: documentRows,
        services: serviceRows,
        expenses: expenseRows,
        employees: employees.data || [],
        summary: {
            oil: oilStatus(serviceRows, vehicle.data),
            alerts: documentAlerts(documentRows),
            spend: spendSummary(serviceRows, expenseRows, documentRows),
            last,
        },
        permissions: {
            edit: can(session.role, session.permissions, 'vehicles', 'edit'),
            create: can(session.role, session.permissions, 'vehicles', 'create'),
            delete: can(session.role, session.permissions, 'vehicles', 'delete'),
        },
    };
}

// ---------------------------------------------------------------------------
// Vehículo
// ---------------------------------------------------------------------------
export type VehicleInput = {
    id?: string | null;
    alias: string; brand?: string; model?: string; year?: string | number | null; plates?: string; vin?: string;
    engine_number?: string; color?: string; fuel_type?: string; odometer_km?: string | number | null;
    responsible_employee_id?: string | null; oil_interval_km?: string | number; oil_interval_months?: string | number; notes?: string;
};

export async function saveVehicleAction(input: VehicleInput) {
    const session = await requireVehicles(input.id ? 'edit' : 'create');
    const alias = clean(input.alias);
    if (!alias) throw new Error('Escribe un nombre para identificar el vehículo.');
    const year = input.year === null || input.year === undefined || input.year === '' ? null : Math.round(Number(input.year));
    if (year !== null && (!Number.isFinite(year) || year < 1950 || year > 2100)) throw new Error('Año inválido.');
    const row = {
        alias, brand: clean(input.brand), model: clean(input.model), year, plates: clean(input.plates)?.toUpperCase() || null,
        vin: clean(input.vin)?.toUpperCase() || null, engine_number: clean(input.engine_number), color: clean(input.color),
        fuel_type: clean(input.fuel_type), odometer_km: intOrNull(input.odometer_km),
        responsible_employee_id: input.responsible_employee_id || null,
        oil_interval_km: intOrNull(input.oil_interval_km) || 5000,
        oil_interval_months: intOrNull(input.oil_interval_months) || 6,
        notes: clean(input.notes), updated_at: new Date().toISOString(),
    };
    const db = writer(session);
    if (input.id) {
        const { error } = await db.from('vehicles').update(row).eq('id', input.id);
        if (error) throw new Error(error.code === '23505' ? 'Ya hay otro vehículo activo con esas placas.' : error.message);
        revalidateVehicle(input.id);
        return { id: input.id };
    }
    const { data, error } = await db.from('vehicles').insert({ ...row, odometer_updated_at: row.odometer_km !== null ? new Date().toISOString() : null, created_by: session.employeeId }).select('id').single();
    if (error) throw new Error(error.code === '23505' ? 'Ya hay otro vehículo activo con esas placas.' : error.message);
    revalidateVehicle(data.id);
    return { id: data.id as string };
}

export async function setVehicleActiveAction(id: string, active: boolean) {
    const session = await requireVehicles(active ? 'edit' : 'delete');
    const { error } = await writer(session).from('vehicles').update({ is_active: active, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(error.code === '23505' ? 'Ya hay otro vehículo activo con esas placas.' : error.message);
    revalidateVehicle(id);
}

// ---------------------------------------------------------------------------
// Archivos (subida directa al bucket privado)
// ---------------------------------------------------------------------------
export async function prepareVehicleUploadAction(input: { vehicleId: string; kind: 'photo' | 'document' | 'receipt'; fileName: string; contentType: string; size: number }) {
    const session = await getSession();
    if (!session) throw new Error('No autenticado.');
    if (!can(session.role, session.permissions, 'vehicles', 'edit') && !can(session.role, session.permissions, 'vehicles', 'create')) {
        throw new Error('Sin permiso para subir archivos de vehículos.');
    }
    return createVehicleUploadUrl(input);
}

export async function registerVehicleFileAction(input: { vehicleId: string; kind: 'photo' | 'document' | 'receipt'; path: string; fileName: string; contentType: string; caption?: string }) {
    const session = await getSession();
    if (!session) throw new Error('No autenticado.');
    if (!can(session.role, session.permissions, 'vehicles', 'edit') && !can(session.role, session.permissions, 'vehicles', 'create')) {
        throw new Error('Sin permiso para subir archivos de vehículos.');
    }
    if (!input.path.startsWith(`vehicles/${input.vehicleId}/`)) throw new Error('Ruta de archivo inválida.');
    const stat = await statVehicleFile(input.path);
    if (!stat) throw new Error('El archivo no terminó de subirse. Intenta de nuevo.');
    const { data, error } = await writer(session).from('vehicle_files').insert({
        vehicle_id: input.vehicleId, kind: input.kind, storage_path: input.path, file_name: input.fileName.slice(0, 200),
        content_type: input.contentType, file_size: stat.size, caption: clean(input.caption),
        uploaded_by: session.employeeId, uploaded_by_name: session.fullName,
    }).select('id').single();
    if (error) throw new Error(error.message);
    if (input.kind === 'photo') {
        await writer(session).from('vehicles').update({ cover_file_id: data.id }).eq('id', input.vehicleId).is('cover_file_id', null);
    }
    revalidateVehicle(input.vehicleId);
    return { id: data.id as string };
}

export async function setVehicleCoverAction(vehicleId: string, fileId: string) {
    const session = await requireVehicles('edit');
    const { error } = await writer(session).from('vehicles').update({ cover_file_id: fileId, updated_at: new Date().toISOString() }).eq('id', vehicleId);
    if (error) throw new Error(error.message);
    revalidateVehicle(vehicleId);
}

export async function deleteVehicleFileAction(fileId: string) {
    const session = await requireVehicles('delete');
    const db = writer(session);
    const { data: file, error } = await db.from('vehicle_files').select('id, vehicle_id, storage_path').eq('id', fileId).single();
    if (error || !file) throw new Error('No se encontró el archivo.');
    const { error: deleteError } = await db.from('vehicle_files').delete().eq('id', fileId);
    if (deleteError) throw new Error(deleteError.message);
    await removeVehicleFile(file.storage_path);
    revalidateVehicle(file.vehicle_id);
}

// ---------------------------------------------------------------------------
// Documentos, servicios y gastos
// ---------------------------------------------------------------------------
type Recordable = { id?: string | null; vehicle_id: string };

async function saveRow(table: 'vehicle_documents' | 'vehicle_services' | 'vehicle_expenses', input: Recordable, row: Record<string, unknown>) {
    const session = await requireVehicles(input.id ? 'edit' : 'create');
    const db = writer(session);
    if (input.id) {
        const { error } = await db.from(table).update({ ...row, updated_at: new Date().toISOString() }).eq('id', input.id).eq('vehicle_id', input.vehicle_id);
        if (error) throw new Error(error.message);
    } else {
        const { error } = await db.from(table).insert({ ...row, vehicle_id: input.vehicle_id, created_by: session.employeeId, created_by_name: session.fullName });
        if (error) throw new Error(error.message);
    }
    revalidateVehicle(input.vehicle_id);
}

async function deleteRow(table: 'vehicle_documents' | 'vehicle_services' | 'vehicle_expenses', id: string) {
    const session = await requireVehicles('delete');
    const { data, error } = await writer(session).from(table).delete().eq('id', id).select('vehicle_id').single();
    if (error) throw new Error(error.message);
    revalidateVehicle(data?.vehicle_id);
}

export type VehicleDocumentInput = Recordable & {
    doc_type: string; title?: string; provider?: string; document_number?: string; coverage?: string;
    issued_at?: string; expires_at?: string; cost?: string | number | null; file_id?: string | null; notes?: string;
};

export async function saveVehicleDocumentAction(input: VehicleDocumentInput) {
    if (!DOCUMENT_TYPES.some((t) => t.code === input.doc_type)) throw new Error('Tipo de documento inválido.');
    const issued = dateOrNull(input.issued_at);
    const expires = dateOrNull(input.expires_at);
    if (issued && expires && expires < issued) throw new Error('La fecha de vencimiento es anterior al inicio de vigencia.');
    await saveRow('vehicle_documents', input, {
        doc_type: input.doc_type, title: clean(input.title), provider: clean(input.provider), document_number: clean(input.document_number),
        coverage: clean(input.coverage), issued_at: issued, expires_at: expires, cost: moneyOrNull(input.cost),
        file_id: input.file_id || null, notes: clean(input.notes),
    });
}

export async function deleteVehicleDocumentAction(id: string) { await deleteRow('vehicle_documents', id); }

export type VehicleServiceInput = Recordable & {
    service_date: string; odometer_km?: string | number | null; items: string[]; description?: string; workshop?: string;
    cost?: string | number | null; next_service_date?: string; next_service_km?: string | number | null; file_id?: string | null;
};

export async function saveVehicleServiceAction(input: VehicleServiceInput) {
    const items = Array.from(new Set(input.items)).filter((code) => SERVICE_ITEMS.some((item) => item.code === code));
    if (!items.length && !clean(input.description)) throw new Error('Marca al menos un servicio o escribe una descripción.');
    const date = dateOrNull(input.service_date);
    if (!date) throw new Error('Indica la fecha del servicio.');
    await saveRow('vehicle_services', input, {
        service_date: date, odometer_km: intOrNull(input.odometer_km), items, description: clean(input.description),
        workshop: clean(input.workshop), cost: moneyOrNull(input.cost) ?? 0, next_service_date: dateOrNull(input.next_service_date),
        next_service_km: intOrNull(input.next_service_km), file_id: input.file_id || null,
    });
}

export async function deleteVehicleServiceAction(id: string) { await deleteRow('vehicle_services', id); }

export type VehicleExpenseInput = Recordable & {
    expense_date: string; category: string; amount: string | number; odometer_km?: string | number | null;
    liters?: string | number | null; description?: string; file_id?: string | null;
};

export async function saveVehicleExpenseAction(input: VehicleExpenseInput) {
    if (!EXPENSE_CATEGORIES.some((c) => c.code === input.category)) throw new Error('Categoría inválida.');
    const amount = moneyOrNull(input.amount);
    if (!amount || amount <= 0) throw new Error('El importe debe ser mayor a cero.');
    const date = dateOrNull(input.expense_date);
    if (!date) throw new Error('Indica la fecha del gasto.');
    const liters = input.liters === null || input.liters === undefined || input.liters === '' ? null : Number(input.liters);
    if (liters !== null && (!Number.isFinite(liters) || liters <= 0)) throw new Error('Litros inválidos.');
    await saveRow('vehicle_expenses', input, {
        expense_date: date, category: input.category, amount, odometer_km: intOrNull(input.odometer_km), liters,
        description: clean(input.description), file_id: input.file_id || null,
    });
}

export async function deleteVehicleExpenseAction(id: string) { await deleteRow('vehicle_expenses', id); }
