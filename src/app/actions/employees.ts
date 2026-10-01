'use server';

import { revalidatePath } from 'next/cache';
import { supabase } from '@/lib/supabase';
import { getSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { safeStorageName } from '@/lib/storageNames';
import { storageErrorMessage } from '@/lib/storageErrors';
import {
    createEmployee,
    deleteEmployee,
    setEmployeePermissions,
    updateEmployee,
    type CreateEmployeeInput,
    type EmployeePermission,
    type UpdateEmployeeInput,
} from '@/lib/employees';

async function requireEmployeesWrite() {
    const session = await getSession();
    if (!session) throw new Error('No autenticado.');
    if (session.role === 'master') return session;
    if (!can(session.role, session.permissions, 'employees', 'edit')) {
        throw new Error('No tienes permisos para modificar empleados.');
    }
    return session;
}

async function requireEmployeesView() {
    const session = await getSession();
    if (!session) throw new Error('No autenticado.');
    if (!can(session.role, session.permissions, 'employees', 'view')) {
        throw new Error('No tienes permisos para ver empleados.');
    }
    return session;
}

export async function listSuppliersForSelect() {
    const { data } = await supabase.from('suppliers').select('id, name').order('name');
    return data || [];
}

const EMPLOYEE_PHOTO_LIMIT_BYTES = 5 * 1024 * 1024;   // = file_size_limit del bucket

/**
 * Firma la subida directa de la foto (navegador → bucket employee_photos).
 * Antes la foto viajaba en base64 por esta server action y cualquier foto de
 * celular de más de ~3 MB rebasaba el límite de 4.5 MB de Vercel.
 */
export async function createEmployeePhotoUploadAction(
    fileName: string,
    contentType: string,
    fileSize: number,
): Promise<{ path: string; token: string; publicUrl: string }> {
    await requireEmployeesWrite();
    if (!(contentType || '').toLowerCase().startsWith('image/')) {
        throw new Error('La foto debe ser una imagen (JPG, PNG o WEBP).');
    }
    if (!Number.isFinite(fileSize) || fileSize <= 0) throw new Error('La foto está vacía.');
    if (fileSize > EMPLOYEE_PHOTO_LIMIT_BYTES) throw new Error('La foto excede el límite de 5 MB.');

    const path = `photos/${Date.now()}-${safeStorageName(fileName)}`;
    const { data, error } = await supabase.storage.from('employee_photos').createSignedUploadUrl(path);
    if (error || !data?.token) {
        throw new Error('No se pudo preparar la carga de la foto: ' + storageErrorMessage(error?.message));
    }
    const { data: pub } = supabase.storage.from('employee_photos').getPublicUrl(path);
    return { path, token: data.token, publicUrl: pub.publicUrl };
}

/** Sólo un master puede modificar, obsoletar o borrar a otro master. */
async function assertCanManage(session: { role: string }, targetId: string) {
    if (session.role === 'master') return;
    const { data } = await supabase.from('employees').select('role').eq('id', targetId).maybeSingle();
    if (data?.role === 'master') {
        throw new Error('Solo un master puede modificar a un usuario master.');
    }
}

export async function createEmployeeAction(
    input: CreateEmployeeInput,
    permissions: Array<Omit<EmployeePermission, 'id' | 'employee_id' | 'created_at'>>
) {
    const session = await requireEmployeesWrite();
    if (session.role !== 'master' && input.role === 'master') {
        throw new Error('Solo un master puede crear otro master.');
    }
    const created = await createEmployee(input);
    await setEmployeePermissions(created.id, permissions);
    revalidatePath('/settings/employees');
    return { id: created.id, username: created.username };
}

export async function updateEmployeeAction(
    id: string,
    input: UpdateEmployeeInput,
    permissions: Array<Omit<EmployeePermission, 'id' | 'employee_id' | 'created_at'>>
) {
    const session = await requireEmployeesWrite();
    if (input.role === 'master' && session.role !== 'master') {
        throw new Error('Solo un master puede asignar el rol master.');
    }
    await assertCanManage(session, id);
    await updateEmployee(id, input);
    await setEmployeePermissions(id, permissions);
    revalidatePath('/settings/employees');
    revalidatePath(`/settings/employees/${id}`);
}

export async function deleteEmployeeAction(id: string) {
    const session = await requireEmployeesWrite();
    if (id === session.employeeId) {
        throw new Error('No puedes eliminar tu propio usuario.');
    }
    await assertCanManage(session, id);
    await deleteEmployee(id);
    revalidatePath('/settings/employees');
}

/** Marca un empleado como obsoleto (is_active = false). Preserva permisos y
 *  audit trail. No se puede obsoletar a sí mismo. */
export async function obsoleteEmployeeAction(id: string) {
    const session = await requireEmployeesWrite();
    if (id === session.employeeId) {
        throw new Error('No puedes obsoletar tu propio usuario.');
    }
    await assertCanManage(session, id);

    const { supabase } = await import('@/lib/supabase');
    const { error } = await supabase
        .from('employees')
        .update({ is_active: false })
        .eq('id', id);
    if (error) throw new Error('Error al obsoletar: ' + error.message);

    revalidatePath('/settings/employees');
}

/** Restaura un empleado que fue marcado como obsoleto. */
export async function restoreEmployeeAction(id: string) {
    const session = await requireEmployeesWrite();
    await assertCanManage(session, id);

    const { supabase } = await import('@/lib/supabase');
    const { error } = await supabase
        .from('employees')
        .update({ is_active: true })
        .eq('id', id);
    if (error) throw new Error('Error al restaurar: ' + error.message);

    revalidatePath('/settings/employees');
}

export async function viewEmployeesAction() {
    await requireEmployeesView();
}
