// ===========================================================================
// Catálogo de navegación (presentación).
//
// Única fuente de verdad para las tarjetas del dashboard y para el menú
// lateral fijo. Los permisos NO se resuelven aquí: cada consumidor filtra
// con `canViewModule` (server, con permisos de BD) o con `isModuleVisible`
// (server, sólo con el accessList del JWT — sin ir a la BD).
// ===========================================================================

import { accessListIncludes, getSubCodes } from './moduleCatalog';

export type ModuleColor =
    | 'orange' | 'emerald' | 'amber' | 'cyan' | 'rose' | 'violet' | 'sky' | 'slate';

export type ModuleCategory =
    | 'Operación' | 'Comercial' | 'Finanzas' | 'Calidad' | 'Sistema';

export type ModuleCard = {
    href: string;
    title: string;
    desc: string;
    Icon: string;
    color: ModuleColor;
    category: ModuleCategory;
    badge?: string;
};

export type NavModule = ModuleCard & { moduleCode: string; subCode?: string | null };

/** Etiqueta corta para el menú lateral (los títulos del dashboard son largos). */
export type SidebarModule = ModuleCard & { moduleCode: string; short: string };

export const ALL_MODULES: Array<NavModule & { short: string }> = [
    { moduleCode: "manufacturing", href: "/manufacturing", title: "Fabricación", short: "Fabricación",
      desc: "Maquinado, Soldadura y Automatización con WPS, planos y visor 3D.",
      Icon: "Factory", color: "orange", category: "Operación" },
    { moduleCode: "quality", href: "/quality", title: "Calidad", short: "Calidad",
      desc: "Cola de OTs para revisión final y firma de liberación.",
      Icon: "ShieldCheck", color: "sky", category: "Operación" },
    { moduleCode: "deliveries", href: "/deliveries", title: "Entregas", short: "Entregas",
      desc: "Listo para embalaje y Entregados con foto de factura + GPS.",
      Icon: "Truck", color: "emerald", category: "Operación" },
    { moduleCode: "requisitions", href: "/requisitions", title: "Requisiciones", short: "Requisiciones",
      desc: "Solicitudes de insumos de operadores y conversión a compras.",
      Icon: "ClipboardList", color: "amber", category: "Operación", badge: "NUEVO" },

    { moduleCode: "clients", href: "/clients", title: "Clientes", short: "Clientes",
      desc: "CFDI 4.0, RFC, datos fiscales y condiciones de pago.",
      Icon: "Users", color: "cyan", category: "Comercial" },
    { moduleCode: "sales", href: "/sales", title: "Ventas", short: "Ventas",
      desc: "Cotizaciones con margen, OTs anidadas y comisiones.",
      Icon: "Receipt", color: "emerald", category: "Comercial" },
    { moduleCode: "purchases", href: "/purchases", title: "Compras", short: "Compras",
      desc: "Órdenes de compra, 3 cotizaciones y buzón CFDI recibidos.",
      Icon: "ShoppingCart", color: "orange", category: "Comercial" },
    { moduleCode: "suppliers", href: "/suppliers", title: "Proveedores", short: "Proveedores",
      desc: "Catálogo de proveedores con CSF del SAT y datos fiscales.",
      Icon: "Truck", color: "rose", category: "Comercial" },

    { moduleCode: "finance", href: "/finance", title: "Nóminas y Contabilidad", short: "Nóminas y Contabilidad",
      desc: "Empleados, checador, nómina, IVA/ISR con OCR del SAT.",
      Icon: "Wallet", color: "emerald", category: "Finanzas" },

    { moduleCode: "pfmea", href: "/pfmea", title: "PFMEA / AMEF", short: "PFMEA / AMEF",
      desc: "Análisis modal de fallos y efectos. RPN = S × O × D.",
      Icon: "ShieldAlert", color: "rose", category: "Calidad", badge: "NUEVO" },

    { moduleCode: "documents", href: "/documents", title: "Control de Documentos", short: "Documentos",
      desc: "14 procedimientos ISO 9001:2015, foliado y versionado.",
      Icon: "BookOpen", color: "violet", category: "Sistema" },
    { moduleCode: "documents", href: "/changes", title: "Control de Cambios", short: "Control de Cambios",
      desc: "Bitácora de cambios + sync automático de GitHub.",
      Icon: "History", color: "sky", category: "Sistema" },
    { moduleCode: "document_requests", href: "/documents/requests", title: "Requisiciones de Documentos", short: "Req. de Documentos",
      desc: "Solicitudes de documento nuevo o cambio con workflow de aprobación.",
      Icon: "Layers", color: "violet", category: "Sistema", badge: "NUEVO" },
    { moduleCode: "dashboard", href: "/dashboard", title: "Dashboard", short: "Dashboard",
      desc: "Estadísticas del negocio: ventas, compras, gastos.",
      Icon: "BarChart3", color: "orange", category: "Sistema" },
    { moduleCode: "settings", href: "/settings", title: "Configuración", short: "Configuración",
      desc: "Datos de la empresa, logo y PDF.",
      Icon: "Cog", color: "slate", category: "Sistema" },
    { moduleCode: "employees", href: "/settings/employees", title: "Empleados", short: "Empleados",
      desc: "Alta, edición y permisos por módulo de cada usuario.",
      Icon: "UserCog", color: "rose", category: "Sistema" },
];

/** Orden de las secciones en el dashboard y en el menú lateral. */
export const CATEGORIES: { name: ModuleCategory; color: string }[] = [
    { name: "Operación", color: "text-orange-300" },
    { name: "Comercial", color: "text-cyan-300" },
    { name: "Calidad",   color: "text-rose-300" },
    { name: "Finanzas",  color: "text-emerald-300" },
    { name: "Sistema",   color: "text-violet-300" },
];

/**
 * ¿Este módulo se le muestra al usuario? Usa sólo el `accessList` compacto
 * del JWT (mismo criterio que el middleware), así el layout raíz puede
 * armar el menú sin una consulta extra a la BD en cada navegación.
 */
export function isModuleVisible(
    role: string | undefined,
    accessList: string | undefined,
    moduleCode: string
): boolean {
    if (role === 'master') return true;
    if (accessListIncludes(accessList, moduleCode, null)) return true;
    return getSubCodes(moduleCode).some((sub) =>
        accessListIncludes(accessList, moduleCode, sub)
    );
}
