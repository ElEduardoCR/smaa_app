'use server';

import { authenticateEmployee, listActiveEmployeesPublic } from '@/lib/employees';
import { destroySession, setSession } from '@/lib/session';

export type LoginResult = {
    success: boolean;
    error?: string;
    redirectTo?: string;
    user?: {
        id: string;
        fullName: string;
        username: string;
        role: string;
        position: string | null;
        photoUrl: string | null;
    };
};

export async function logoutAction() {
    await destroySession();
}

export async function listLoginUsersAction() {
    return await listActiveEmployeesPublic();
}

/** Login con selección de usuario + contraseña. */
export async function loginEmployeeAction(
    username: string,
    password: string,
    redirectTo?: string
): Promise<LoginResult> {
    if (!username || !password) {
        return { success: false, error: 'Selecciona un usuario e ingresa tu contraseña.' };
    }

    let employee;
    try {
        employee = await authenticateEmployee(username, password);
    } catch (err: any) {
        console.error('auth error', err);
        return { success: false, error: 'Error al validar las credenciales.' };
    }

    if (!employee) {
        return { success: false, error: 'Usuario o contraseña incorrectos.' };
    }

    await setSession({
        employeeId: employee.id,
        username: employee.username,
        fullName: employee.full_name,
        role: employee.role,
        position: employee.position,
        photoUrl: employee.photo_url,
        permissions: employee.permissions,
    });

    return {
        success: true,
        redirectTo: redirectTo || '/',
        user: {
            id: employee.id,
            fullName: employee.full_name,
            username: employee.username,
            role: employee.role,
            position: employee.position,
            photoUrl: employee.photo_url,
        },
    };
}

/** Compatibilidad con código viejo: por si algún sitio sigue llamando loginAction. */
export async function loginAction(_password: string, redirectTo?: string): Promise<LoginResult> {
    return {
        success: false,
        error: 'Este sistema ahora usa login con usuario. Ingresa por la pantalla de selección de usuario.',
    };
}
