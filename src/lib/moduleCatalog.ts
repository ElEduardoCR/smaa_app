// Catálogo de módulos y sus sub-módulos. Lo usan:
//  - /settings/employees (editor de permisos) para renderizar la matriz
//  - / (dashboard) para decidir qué tarjetas mostrar al usuario
//  - /manufacturing y otras páginas para checar accesibilidad
//
// Si agregas un módulo nuevo con sub-módulos, agrega el `subs` aquí y
// `canViewModule` sabrá que la accesibilidad del módulo padre depende
// de que al menos uno de los sub-módulos sea visible.

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
    subs?: ModuleSub[];
    actions: ModuleAction[];
};

export const MODULE_CATALOG: ModuleDef[] = [
    {
        code: 'dashboard',
        label: 'Dashboard / Inicio',
        actions: [{ key: 'can_view', label: 'Ver' }],
    },
    {
        code: 'manufacturing',
        label: 'Fabricación (OTs)',
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
    },
    {
        code: 'quality',
        label: 'Calidad',
        actions: [
            { key: 'can_view', label: 'Ver' },
            { key: 'can_edit', label: 'Liberar/Rechazar' },
        ],
    },
    {
        code: 'requisitions',
        label: 'Requisiciones',
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
        actions: [
            { key: 'can_view', label: 'Ver' },
            { key: 'can_create', label: 'Crear' },
            { key: 'can_edit', label: 'Editar' },
        ],
    },
    {
        code: 'finance',
        label: 'Nóminas y Contabilidad',
        actions: [
            { key: 'can_view', label: 'Ver' },
            { key: 'can_create', label: 'Crear' },
            { key: 'can_edit', label: 'Editar' },
        ],
    },
    {
        code: 'documents',
        label: 'Documentos / Cambios',
        actions: [
            { key: 'can_view', label: 'Ver' },
            { key: 'can_create', label: 'Crear' },
            { key: 'can_edit', label: 'Editar' },
        ],
    },
    {
        code: 'settings',
        label: 'Configuración empresa',
        actions: [
            { key: 'can_view', label: 'Ver' },
            { key: 'can_edit', label: 'Editar' },
        ],
    },
    {
        code: 'employees',
        label: 'Empleados (este módulo)',
        actions: [
            { key: 'can_view', label: 'Ver' },
            { key: 'can_create', label: 'Crear' },
            { key: 'can_edit', label: 'Editar' },
            { key: 'can_delete', label: 'Eliminar' },
        ],
    },
];

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
