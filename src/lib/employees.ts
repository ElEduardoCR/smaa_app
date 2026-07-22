import 'server-only';
import { supabase } from './supabase';
import { hashPassword, verifyPassword } from './password';

export type EmployeeRole = 'master' | 'admin' | 'operator';

export type Employee = {
    id: string;
    full_name: string;
    username: string;
    role: EmployeeRole;
    position: string | null;
    photo_url: string | null;
    phone: string | null;
    is_active: boolean;
    last_login_at: string | null;
    created_at: string;
    updated_at: string;
};

export type EmployeePermission = {
    id: string;
    employee_id: string;
    module_code: string;
    sub_code: string | null;
    can_view: boolean;
    can_create: boolean;
    can_edit: boolean;
    can_delete: boolean;
    can_start: boolean;
    can_pause: boolean;
    can_complete: boolean;
    can_request_supplies: boolean;
    can_purchase: boolean;
};

export type EmployeeWithPermissions = Employee & { permissions: EmployeePermission[] };

/** Lista ligera de usuarios activos (para el grid del login, sin password_hash). */
export async function listActiveEmployeesPublic(): Promise<Pick<Employee, 'id' | 'full_name' | 'username' | 'position' | 'photo_url' | 'role'>[]> {
    const { data, error } = await supabase
        .from('employees')
        .select('id, full_name, username, position, photo_url, role')
        .eq('is_active', true)
        .order('full_name', { ascending: true });
    if (error) throw error;
    return (data || []) as any;
}

/** Lista completa de empleados (para CRUD en settings). */
export async function listAllEmployees(): Promise<EmployeeWithPermissions[]> {
    const { data: emps, error: eErr } = await supabase
        .from('employees')
        .select('*')
        .order('full_name', { ascending: true });
    if (eErr) throw eErr;

    const { data: perms, error: pErr } = await supabase
        .from('employee_permissions')
        .select('*');
    if (pErr) throw pErr;

    const permsByEmp: Record<string, EmployeePermission[]> = {};
    for (const p of (perms || []) as any[]) {
        (permsByEmp[p.employee_id] = permsByEmp[p.employee_id] || []).push(p);
    }

    return ((emps || []) as any[]).map((e) => ({
        ...e,
        permissions: permsByEmp[e.id] || [],
    }));
}

export async function getEmployeeById(id: string): Promise<EmployeeWithPermissions | null> {
    const { data: emp, error: eErr } = await supabase
        .from('employees')
        .select('*')
        .eq('id', id)
        .maybeSingle();
    if (eErr) throw eErr;
    if (!emp) return null;

    const { data: perms, error: pErr } = await supabase
        .from('employee_permissions')
        .select('*')
        .eq('employee_id', id);
    if (pErr) throw pErr;

    return { ...(emp as any), permissions: (perms || []) as any[] };
}

export type CreateEmployeeInput = {
    full_name: string;
    username: string;
    password: string;
    role: EmployeeRole;
    position?: string | null;
    phone?: string | null;
    photo_url?: string | null;
    is_active?: boolean;
};

export async function createEmployee(input: CreateEmployeeInput): Promise<Employee> {
    const { data, error } = await supabase
        .from('employees')
        .insert({
            full_name: input.full_name.trim(),
            username: input.username.trim().toLowerCase(),
            password_hash: hashPassword(input.password),
            role: input.role,
            position: input.position?.trim() || null,
            phone: input.phone?.trim() || null,
            photo_url: input.photo_url || null,
            is_active: input.is_active ?? true,
        })
        .select('*')
        .single();
    if (error) {
        if ((error as any).code === '23505') {
            throw new Error('Ya existe un empleado con ese usuario.');
        }
        throw error;
    }
    return data as Employee;
}

export type UpdateEmployeeInput = {
    full_name?: string;
    username?: string;
    password?: string | null;        // si viene, se rehashea
    role?: EmployeeRole;
    position?: string | null;
    phone?: string | null;
    photo_url?: string | null;
    is_active?: boolean;
};

export async function updateEmployee(id: string, input: UpdateEmployeeInput): Promise<Employee> {
    const patch: Record<string, any> = {};
    if (input.full_name !== undefined) patch.full_name = input.full_name.trim();
    if (input.username !== undefined) patch.username = input.username.trim().toLowerCase();
    if (input.password) patch.password_hash = hashPassword(input.password);
    if (input.role !== undefined) patch.role = input.role;
    if (input.position !== undefined) patch.position = input.position?.trim() || null;
    if (input.phone !== undefined) patch.phone = input.phone?.trim() || null;
    if (input.photo_url !== undefined) patch.photo_url = input.photo_url || null;
    if (input.is_active !== undefined) patch.is_active = input.is_active;

    const { data, error } = await supabase
        .from('employees')
        .update(patch)
        .eq('id', id)
        .select('*')
        .single();
    if (error) {
        if ((error as any).code === '23505') {
            throw new Error('Ya existe un empleado con ese usuario.');
        }
        throw error;
    }
    return data as Employee;
}

export async function deleteEmployee(id: string): Promise<void> {
    const { error } = await supabase.from('employees').delete().eq('id', id);
    if (error) throw error;
}

/** Reemplaza toda la matriz de permisos del empleado. */
export async function setEmployeePermissions(
    employeeId: string,
    perms: Array<Omit<EmployeePermission, 'id' | 'employee_id' | 'created_at'>>
): Promise<void> {
    // Borrar existentes
    const { error: delErr } = await supabase
        .from('employee_permissions')
        .delete()
        .eq('employee_id', employeeId);
    if (delErr) throw delErr;

    if (!perms.length) return;

    const rows = perms.map((p) => ({
        employee_id: employeeId,
        module_code: p.module_code,
        sub_code: p.sub_code,
        can_view: p.can_view,
        can_create: p.can_create,
        can_edit: p.can_edit,
        can_delete: p.can_delete,
        can_start: p.can_start,
        can_pause: p.can_pause,
        can_complete: p.can_complete,
        can_request_supplies: p.can_request_supplies,
        can_purchase: p.can_purchase,
    }));

    const { error: insErr } = await supabase.from('employee_permissions').insert(rows);
    if (insErr) throw insErr;
}

/** Login: trae el empleado + permisos, valida password, actualiza last_login_at. */
export async function authenticateEmployee(
    username: string,
    password: string
): Promise<EmployeeWithPermissions | null> {
    const { data, error } = await supabase
        .from('employees')
        .select('*')
        .eq('username', username.trim().toLowerCase())
        .eq('is_active', true)
        .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    if (!verifyPassword(password, (data as any).password_hash)) return null;

    // best-effort: last_login_at
    await supabase
        .from('employees')
        .update({ last_login_at: new Date().toISOString() })
        .eq('id', (data as any).id);

    const { data: perms } = await supabase
        .from('employee_permissions')
        .select('*')
        .eq('employee_id', (data as any).id);

    return { ...(data as any), permissions: (perms || []) as any[] };
}
