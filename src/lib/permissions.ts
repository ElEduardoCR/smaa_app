import 'server-only';
import type { EmployeePermission, EmployeeRole } from './employees';
import { hasSubModules, getSubCodes } from './moduleCatalog';

export type Action =
    | 'view'
    | 'create'
    | 'edit'
    | 'delete'
    | 'start'
    | 'pause'
    | 'complete'
    | 'request_supplies'
    | 'purchase';

/** Busca el permiso más específico: (module + sub) si existe, si no (module + null). */
export function resolvePermission(
    perms: EmployeePermission[],
    moduleCode: string,
    subCode: string | null = null
): EmployeePermission | null {
    const exact = perms.find((p) => p.module_code === moduleCode && p.sub_code === subCode);
    if (exact) return exact;
    const moduleOnly = perms.find(
        (p) => p.module_code === moduleCode && (p.sub_code === null || p.sub_code === '')
    );
    return moduleOnly || null;
}

export function can(
    role: EmployeeRole,
    perms: EmployeePermission[],
    moduleCode: string,
    action: Action,
    subCode: string | null = null
): boolean {
    if (role === 'master') return true;
    const p = resolvePermission(perms, moduleCode, subCode);
    if (!p) return false;
    switch (action) {
        case 'view': return p.can_view;
        case 'create': return p.can_create;
        case 'edit': return p.can_edit;
        case 'delete': return p.can_delete;
        case 'start': return p.can_start;
        case 'pause': return p.can_pause;
        case 'complete': return p.can_complete;
        case 'request_supplies': return p.can_request_supplies;
        case 'purchase': return p.can_purchase;
    }
}

/**
 * ¿El usuario puede ver este módulo? Considera sub-módulos: si el módulo
 * los tiene (ej. manufacturing → maquinado/soldadura/automatizacion),
 * basta con que pueda ver al menos uno para que el módulo padre sea
 * accesible.
 */
export function canViewModule(
    role: EmployeeRole,
    perms: EmployeePermission[],
    moduleCode: string
): boolean {
    if (role === 'master') return true;
    if (can(role, perms, moduleCode, 'view', null)) return true;
    if (hasSubModules(moduleCode)) {
        return perms.some(
            (p) => p.module_code === moduleCode && p.sub_code && p.can_view
        );
    }
    return false;
}

/**
 * ¿El usuario puede entrar a este (module, sub)? El sub_code puede ser null
 * para el módulo raíz. Esta es la función que usa el middleware y los
 * layouts para gatear de forma gruesa antes de pasar a checks finos.
 *
 * Para módulos con sub-módulos, el "módulo raíz" (sub=null) NO se considera
 * accesible por sí solo — el usuario debe poder ver al menos un sub.
 * (Si quieres que pueda ver la página /manufacturing raíz, dale permisos en
 * cada sub y `canViewModule` los junta para mostrar la tarjeta.)
 */
export function canAccessPath(
    role: EmployeeRole,
    perms: EmployeePermission[],
    moduleCode: string,
    subCode: string | null
): boolean {
    if (role === 'master') return true;
    if (subCode) {
        // Sub-módulo específico: necesita can_view explícito
        return can(role, perms, moduleCode, 'view', subCode);
    }
    // Módulo raíz
    if (hasSubModules(moduleCode)) {
        // El módulo raíz sin sub no es "una entrada" propia — el usuario
        // entra por un sub. canViewModule ya lo entiende para mostrar la UI.
        return canViewModule(role, perms, moduleCode);
    }
    return can(role, perms, moduleCode, 'view');
}

/** Lista los sub-códigos a los que el usuario puede entrar dentro de un módulo. */
export function listAccessibleSubCodes(
    role: EmployeeRole,
    perms: EmployeePermission[],
    moduleCode: string
): string[] {
    if (role === 'master') {
        return perms
            .filter((p) => p.module_code === moduleCode && !!p.sub_code)
            .map((p) => p.sub_code as string);
    }
    return perms
        .filter((p) => p.module_code === moduleCode && p.sub_code && p.can_view)
        .map((p) => p.sub_code as string);
}
