'use server';

import { updateSession } from '@/lib/session';

type LoginResult = {
    success: boolean;
    error?: string;
    redirectTo?: string;
};

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

    let grantedPermissions: string[] = [];
    let defaultRedirect = '/';

    if (master && password === master) {
        grantedPermissions = ['master', 'system', 'purchases', 'sales', 'config', 'ot'];
        defaultRedirect = '/';
    } else if (system && password === system) {
        grantedPermissions = ['system'];
        defaultRedirect = '/';
    } else if (purchase && password === purchase) {
        grantedPermissions = ['purchases'];
        defaultRedirect = '/purchases';
    } else if (sales && password === sales) {
        grantedPermissions = ['sales'];
        defaultRedirect = '/sales';
    } else if (config && password === config) {
        grantedPermissions = ['config'];
        defaultRedirect = '/settings';
    } else if (ot && password === ot) {
        grantedPermissions = ['ot'];
        defaultRedirect = '/manufacturing/new';
    } else {
        return { success: false, error: 'Contraseña incorrecta.' };
    }

    // Update the encrypted cookie
    await updateSession(grantedPermissions);

    return {
        success: true,
        redirectTo: redirectTo || defaultRedirect
    };
}
