'use server';

import { listActiveEmployeesPublic } from '@/lib/employees';
import { destroySession } from '@/lib/session';

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
