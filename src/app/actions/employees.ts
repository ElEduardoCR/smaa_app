'use server';

import { revalidatePath } from 'next/cache';
import { supabase } from '@/lib/supabase';
import { getSession } from '@/lib/session';
import { can } from '@/lib/permissions';
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

export async function uploadEmployeePhotoAction(base64: string, fileName: string): Promise<string> {
    await requireEmployeesWrite();
    const buf = Buffer.from(base64, 'base64');
    const path = `photos/${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const { error } = await supabase.storage.from('employee_photos').upload(path, buf, {
        contentType: 'image/*',
        upsert: false,
    });
    if (error) throw new Error('Error al subir la foto: ' + error.message);
    const { data } = supabase.storage.from('employee_photos').getPublicUrl(path);
    return data.publicUrl;
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
    await deleteEmployee(id);
    revalidatePath('/settings/employees');
}

export async function viewEmployeesAction() {
    await requireEmployeesView();
}
