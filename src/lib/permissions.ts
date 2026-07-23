import 'server-only';
import type { EmployeePermission, EmployeeRole } from './employees';
import { hasSubModules } from './moduleCatalog';

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
 * basta con que pueda ver al menos uno para que la tarjeta del módulo
 * padre se muestre en el dashboard.
 *
 * Esto evita el bug de UX donde activar permisos solo en sub-módulos no
 * hace aparecer la tarjeta del módulo padre.
 */
export function canViewModule(
    role: EmployeeRole,
    perms: EmployeePermission[],
    moduleCode: string
): boolean {
    if (role === 'master') return true;
    // Permiso explícito a nivel módulo (sub_code=null) tiene prioridad.
    if (can(role, perms, moduleCode, 'view', null)) return true;
    // Si el módulo tiene sub-módulos, basta con tener can_view en uno.
    if (hasSubModules(moduleCode)) {
        return perms.some(
            (p) => p.module_code === moduleCode && p.sub_code && p.can_view
        );
    }
    return false;
}

/** Lista los sub-códigos a los que el usuario puede entrar dentro de un módulo. */
export function listAccessibleSubCodes(
    role: EmployeeRole,
    perms: EmployeePermission[],
    moduleCode: string
): string[] {
    if (role === 'master') {
        // master ve todos los sub-módulos que existan; el caller puede cruzar con catálogo real
        return perms
            .filter((p) => p.module_code === moduleCode && !!p.sub_code)
            .map((p) => p.sub_code as string);
    }
    return perms
        .filter((p) => p.module_code === moduleCode && p.sub_code && p.can_view)
        .map((p) => p.sub_code as string);
}
