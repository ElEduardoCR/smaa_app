'use server';

import { updateSession, destroySession } from '@/lib/session';

type LoginResult = {
    success: boolean;
    error?: string;
    redirectTo?: string;
};

export async function logoutAction() {
    await destroySession();
}

export async function loginAction(password: string, redirectTo?: string): Promise<LoginResult> {
    const master = process.env.MASTER_PASS;
    const system = process.env.SYSTEM_PASS;
    const purchase = process.env.PURCHASE_PASS;
    const sales = process.env.SALES_PASS;
    const config = process.env.CONFIG_PASS;
    const ot = process.env.OT_PASS;

    if (!password) {
        return { success: false, error: 'Por favor ingresa una contraseña.' };
    }

    // Master pass bypasses everything
    if (master && password === master) {
        await updateSession(['master', 'system', 'purchases', 'sales', 'config', 'ot']);
        return { success: true, redirectTo: redirectTo || '/' };
    }

    const targetPath = redirectTo || '/';

    if (targetPath.startsWith('/purchases')) {
        if (purchase && password === purchase) {
            await updateSession(['purchases']);
            return { success: true, redirectTo: targetPath };
        }
        return { success: false, error: 'Contraseña de departamento incorrecta.' };
    }

    if (targetPath.startsWith('/sales')) {
        if (sales && password === sales) {
            await updateSession(['sales']);
            return { success: true, redirectTo: targetPath };
        }
        return { success: false, error: 'Contraseña de departamento incorrecta.' };
    }

    if (targetPath.startsWith('/settings')) {
        if (config && password === config) {
            await updateSession(['config']);
            return { success: true, redirectTo: targetPath };
        }
        return { success: false, error: 'Contraseña de departamento incorrecta.' };
    }

    if (targetPath.startsWith('/manufacturing/new')) {
        if (ot && password === ot) {
            await updateSession(['ot']);
            return { success: true, redirectTo: targetPath };
        }
        return { success: false, error: 'Contraseña de departamento incorrecta.' };
    }

    // Default to system login for /, /clients, /deliveries, /suppliers, etc
    if (system && password === system) {
        await updateSession(['system']);
        return { success: true, redirectTo: targetPath };
    }

    return { success: false, error: 'Contraseña de sistema incorrecta.' };
}
