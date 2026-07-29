// ===========================================================================
// Catálogo de módulos del sistema.
//
// Esta es la ÚNICA fuente de verdad para:
//   - Qué módulos existen
//   - Qué sub-módulos tiene cada uno
//   - Qué acciones (flags) se pueden asignar
//   - Qué prefijo de URL les corresponde (para que el middleware pueda
//     mapear una URL entrante al módulo correcto y aplicar el permiso)
//
// Para agregar un módulo nuevo:
//   1) Agregar un entry al MODULE_CATALOG con code, label, routePrefix, subs?, actions
//   2) Crear la carpeta app/<routePrefix>/... con los page.tsx que correspondan
//   3) Listo — el middleware protege automáticamente con `canViewModule`.
//
// Convenciones:
//   - `code` es el identificador interno (se usa en BD y permisos)
//   - `routePrefix` es el path de URL (sin leading slash). Para manufacturing
//     con sub-módulos, se queda como 'manufacturing' y los sub-módulos viven
//     en /manufacturing/<sub>/...
//   - `defaultAction` es la acción mínima que se necesita para entrar a la
//     página principal del módulo. Sub-rutas como /new piden 'create'.
// ===========================================================================

import type { Action } from './permissions';

export type PermFlagKey =
    | 'can_view'
    | 'can_create'
    | 'can_edit'
    | 'can_delete'
    | 'can_start'
    | 'can_pause'
    | 'can_complete'
    | 'can_request_supplies'
    | 'can_purchase';

export type ModuleAction = { key: PermFlagKey; label: string };
export type ModuleSub = { code: string; label: string };
export type ModuleDef = {
    code: string;
    label: string;
    /** Prefijo de URL (sin leading slash) que mapea al módulo raíz. */
    routePrefix: string;
    /** Sub-códigos (viven en /<routePrefix>/<sub>/...). */
    subs?: ModuleSub[];
    /** Flags que se pueden asignar para este módulo. */
    actions: ModuleAction[];
    /** Acción mínima que pide la página principal. Default: 'view'. */
    defaultAction?: Action;
};

export const MODULE_CATALOG: ModuleDef[] = [
    {
        code: 'dashboard',
        label: 'Dashboard / Inicio',
        routePrefix: 'dashboard',
        actions: [{ key: 'can_view', label: 'Ver' }],
    },
    {
        code: 'manufacturing',
        label: 'Fabricación (OTs)',
        routePrefix: 'manufacturing',
        subs: [
            { code: 'maquinado', label: 'Maquinado' },
            { code: 'soldadura', label: 'Soldadura' },
            { code: 'automatizacion', label: 'Automatización' },
        ],
        actions: [
            { key: 'can_view', label: 'Ver' },
            { key: 'can_create', label: 'Crear OT' },
            { key: 'can_edit', label: 'Editar OT' },
            { key: 'can_delete', label: 'Eliminar' },
            { key: 'can_start', label: 'Iniciar' },
            { key: 'can_pause', label: 'Pausar' },
            { key: 'can_complete', label: 'Terminar' },
        ],
        defaultAction: 'view',
    },
    {
        code: 'quality',
        label: 'Calidad',
        routePrefix: 'quality',
        actions: [
            { key: 'can_view', label: 'Ver' },
            { key: 'can_edit', label: 'Liberar/Rechazar' },
        ],
    },
    {
        code: 'requisitions',
        label: 'Requisiciones',
        routePrefix: 'requisitions',
        actions: [
            { key: 'can_view', label: 'Ver' },
            { key: 'can_create', label: 'Crear' },
            { key: 'can_edit', label: 'Editar' },
            { key: 'can_request_supplies', label: 'Solicitar insumos' },
            { key: 'can_purchase', label: 'Convertir a compra' },
        ],
    },
    {
        code: 'sales',
        label: 'Ventas / Cotizaciones',
        routePrefix: 'sales',
        actions: [
            { key: 'can_view', label: 'Ver' },
            { key: 'can_create', label: 'Crear' },
            { key: 'can_edit', label: 'Editar' },
            { key: 'can_delete', label: 'Eliminar' },
        ],
    },
    {
        code: 'purchases',
        label: 'Compras / POs',
        routePrefix: 'purchases',
        actions: [
            { key: 'can_view', label: 'Ver' },
            { key: 'can_create', label: 'Crear' },
            { key: 'can_edit', label: 'Editar' },
            { key: 'can_delete', label: 'Eliminar' },
        ],
    },
    {
        code: 'clients',
        label: 'Clientes',
        routePrefix: 'clients',
        actions: [
            { key: 'can_view', label: 'Ver' },
            { key: 'can_create', label: 'Crear' },
            { key: 'can_edit', label: 'Editar' },
            { key: 'can_delete', label: 'Eliminar' },
        ],
    },
    {
        code: 'suppliers',
        label: 'Proveedores',
        routePrefix: 'suppliers',
        actions: [
            { key: 'can_view', label: 'Ver' },
            { key: 'can_create', label: 'Crear' },
            { key: 'can_edit', label: 'Editar' },
            { key: 'can_delete', label: 'Eliminar' },
        ],
    },
    {
        code: 'deliveries',
        label: 'Entregas',
        routePrefix: 'deliveries',
        actions: [
            { key: 'can_view', label: 'Ver' },
            { key: 'can_create', label: 'Crear' },
            { key: 'can_edit', label: 'Editar' },
        ],
    },
    {
        code: 'finance',
        label: 'Nóminas y Contabilidad',
        routePrefix: 'finance',
        actions: [
            { key: 'can_view', label: 'Ver' },
            { key: 'can_create', label: 'Crear' },
            { key: 'can_edit', label: 'Editar' },
        ],
    },
    {
        code: 'documents',
        label: 'Documentos / Cambios',
        routePrefix: 'documents',
        actions: [
            { key: 'can_view', label: 'Ver' },
            { key: 'can_create', label: 'Crear' },
            { key: 'can_edit', label: 'Editar' },
        ],
    },
    {
        code: 'settings',
        label: 'Configuración empresa',
        routePrefix: 'settings',
        actions: [
            { key: 'can_view', label: 'Ver' },
            { key: 'can_edit', label: 'Editar' },
        ],
    },
    {
        code: 'employees',
        label: 'Empleados (este módulo)',
        routePrefix: 'settings/employees',
        actions: [
            { key: 'can_view', label: 'Ver' },
            { key: 'can_create', label: 'Crear' },
            { key: 'can_edit', label: 'Editar' },
            { key: 'can_delete', label: 'Eliminar' },
        ],
    },
];

// NOTA: DASHBOARD_CARDS eliminado (era código muerto).
// El dashboard consume `ALL_MODULES` desde src/app/page.tsx.
// Si en el futuro queremos una sola fuente de verdad, consolidar ahí.

// ===========================================================================
// Helpers
// ===========================================================================

export const ALL_FLAG_KEYS: PermFlagKey[] = [
    'can_view', 'can_create', 'can_edit', 'can_delete',
    'can_start', 'can_pause', 'can_complete',
    'can_request_supplies', 'can_purchase',
];

/** Devuelve el ModuleDef o undefined. */
export function getModuleDef(code: string): ModuleDef | undefined {
    return MODULE_CATALOG.find((m) => m.code === code);
}

/** Códigos de sub-módulos de un módulo (vacío si no tiene). */
export function getSubCodes(code: string): string[] {
    return getModuleDef(code)?.subs?.map((s) => s.code) ?? [];
}

/** ¿Este módulo tiene sub-módulos? */
export function hasSubModules(code: string): boolean {
    return getSubCodes(code).length > 0;
}

/**
 * Resultado de mapear una URL a un (módulo, sub-módulo, acción).
 * - moduleCode: código del módulo en MODULE_CATALOG
 * - subCode: sub-módulo si la URL lo especifica, si no null
 * - action: 'view' para la página principal, 'create' para /new, etc.
 */
export type PathMapping = {
    moduleCode: string;
    subCode: string | null;
    action: Action;
};

/**
 * Mapea un pathname (sin query) a su módulo/sub/acción. Devuelve null si la
 * ruta no corresponde a ningún módulo conocido (página pública, API, etc.).
 *
 * Reglas:
 *   /<prefix>              → module, null, defaultAction (view)
 *   /<prefix>/<sub>        → module, sub, view
 *   /<prefix>/<sub>/<id>   → module, sub, view
 *   /<prefix>/new          → module, null, create
 *   /<prefix>/<sub>/new    → module, sub, create
 *   /<prefix>/<sub>/<id>/... → module, sub, view
 *
 * Si un módulo tiene sub-módulos, cualquier /<prefix>/<algo> que no sea 'new'
 * se trata como sub-módulo. Si no tiene sub-módulos, los segmentos después
 * del prefijo son path params ([id], etc.) y no cambian el sub_code.
 */
export function getModuleForPath(pathname: string): PathMapping | null {
    // Normalizar
    const p = pathname.replace(/^\/+/, '').replace(/\/+$/, '');
    if (!p) return null;

    for (const m of MODULE_CATALOG) {
        const prefix = m.routePrefix;
        if (p === prefix) {
            return { moduleCode: m.code, subCode: null, action: m.defaultAction ?? 'view' };
        }
        if (p === `${prefix}/new`) {
            return { moduleCode: m.code, subCode: null, action: 'create' };
        }
        if (p.startsWith(prefix + '/')) {
            const rest = p.slice(prefix.length + 1);
            const segs = rest.split('/').filter(Boolean);
            if (segs.length === 0) {
                return { moduleCode: m.code, subCode: null, action: m.defaultAction ?? 'view' };
            }
            const first = segs[0];
            // /<prefix>/new → create (ya cubierto arriba pero por si acaso)
            if (first === 'new' && segs.length === 1) {
                return { moduleCode: m.code, subCode: null, action: 'create' };
            }
            if (m.subs && m.subs.length > 0) {
                // Si el primer segmento es un sub conocido, ese es el sub_code
                if (m.subs.some((s) => s.code === first)) {
                    return { moduleCode: m.code, subCode: first, action: m.defaultAction ?? 'view' };
                }
                // Si no es un sub conocido pero el módulo tiene subs, no matchea
                return null;
            }
            // Módulo sin sub-módulos: el primer segmento es path param ([id])
            return { moduleCode: m.code, subCode: null, action: m.defaultAction ?? 'view' };
        }
    }
    return null;
}

/**
 * Calcula la lista compacta de pares `module:sub` a los que el usuario
 * puede acceder (con cualquier flag activo). Se guarda en el JWT para que
 * el middleware pueda gatear sin ir a la BD.
 *
 * Formato: "manufacturing:maquinado,manufacturing:soldadura,requisitions:,clients:"
 *   - `module:` (sub vacío) = acceso al módulo raíz
 *   - `module:sub` = acceso al sub-módulo
 *
 * Para módulos con sub-módulos, también incluimos el módulo raíz si el
 * usuario tiene acceso a al menos un sub.
 */
export function computeAccessList(perms: Array<{ module_code: string; sub_code: string | null }>): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const byModule = new Map<string, Set<string | null>>();

    for (const p of perms) {
        if (!byModule.has(p.module_code)) byModule.set(p.module_code, new Set());
        byModule.get(p.module_code)!.add(p.sub_code || null);
    }

    for (const [moduleCode, subs] of byModule) {
        const def = getModuleDef(moduleCode);
        const hasSub = def && def.subs && def.subs.length > 0;
        if (hasSub) {
            // Solo emitimos los sub-módulos; el helper canViewModule se encarga
            // de mostrar la tarjeta padre si al menos uno es accesible.
            for (const sub of subs) {
                if (sub) {
                    const k = `${moduleCode}:${sub}`;
                    if (!seen.has(k)) { seen.add(k); out.push(k); }
                }
            }
        } else {
            // Módulo sin sub-módulos: emitimos module: (sub vacío)
            const k = `${moduleCode}:`;
            if (!seen.has(k)) { seen.add(k); out.push(k); }
        }
    }
    return out;
}

/** ¿El accessList del JWT contiene este moduleCode:subCode? */
export function accessListIncludes(accessList: string | undefined, moduleCode: string, subCode: string | null): boolean {
    if (!accessList) return false;
    const key = subCode ? `${moduleCode}:${subCode}` : `${moduleCode}:`;
    return accessList.split(',').includes(key);
}
