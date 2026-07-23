import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { canViewModule } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import DashboardClient from './DashboardClient';

type ModuleCard = {
    href: string;
    title: string;
    desc: string;
    Icon: string;
    color: "orange" | "emerald" | "amber" | "cyan" | "rose" | "violet" | "sky" | "slate";
    category: "Operación" | "Comercial" | "Finanzas" | "Calidad" | "Sistema";
    badge?: string;
};

const ALL_MODULES: Array<ModuleCard & { moduleCode: string; subCode?: string | null }> = [
    { moduleCode: "manufacturing", href: "/manufacturing", title: "Fabricación", desc: "Maquinado, Soldadura y Automatización con WPS, planos y visor 3D.",
      Icon: "Factory", color: "orange", category: "Operación" },
    { moduleCode: "quality",       href: "/quality",        title: "Calidad",     desc: "Cola de OTs para revisión final y firma de liberación.",
      Icon: "ShieldCheck", color: "sky", category: "Operación" },
    { moduleCode: "deliveries",    href: "/deliveries",     title: "Entregas",    desc: "Listo para embalaje y Entregados con foto de factura + GPS.",
      Icon: "Truck", color: "emerald", category: "Operación" },
    { moduleCode: "requisitions",  href: "/requisitions",   title: "Requisiciones", desc: "Solicitudes de insumos de operadores y conversión a compras.",
      Icon: "ClipboardList", color: "amber", category: "Operación", badge: "NUEVO" },

    { moduleCode: "clients",       href: "/clients",        title: "Clientes",    desc: "CFDI 4.0, RFC, datos fiscales y condiciones de pago.",
      Icon: "Users", color: "cyan", category: "Comercial" },
    { moduleCode: "sales",         href: "/sales",          title: "Ventas",      desc: "Cotizaciones con margen, OTs anidadas y comisiones.",
      Icon: "Receipt", color: "emerald", category: "Comercial" },
    { moduleCode: "purchases",     href: "/purchases",      title: "Compras",     desc: "Órdenes de compra, 3 cotizaciones y buzón CFDI recibidos.",
      Icon: "Factory", color: "orange", category: "Comercial" },

    { moduleCode: "finance",       href: "/finance",        title: "Nóminas y Contabilidad", desc: "Empleados, checador, nómina, IVA/ISR con OCR del SAT.",
      Icon: "Wallet", color: "emerald", category: "Finanzas" },

    { moduleCode: "documents",     href: "/documents",      title: "Control de Documentos", desc: "14 procedimientos ISO 9001:2015, foliado y versionado.",
      Icon: "BookOpen", color: "violet", category: "Sistema" },
    { moduleCode: "documents",     href: "/changes",        title: "Control de Cambios", desc: "Bitácora de cambios + sync automático de GitHub.",
      Icon: "History", color: "sky", category: "Sistema" },
    { moduleCode: "dashboard",     href: "/dashboard",      title: "Dashboard",   desc: "Estadísticas del negocio: ventas, compras, gastos.",
      Icon: "BarChart3", color: "orange", category: "Sistema" },
    { moduleCode: "settings",      href: "/settings",       title: "Configuración", desc: "Datos de la empresa, logo y PDF.",
      Icon: "Cog", color: "slate", category: "Sistema" },
    { moduleCode: "employees",     href: "/settings/employees", title: "Empleados", desc: "Alta, edición y permisos por módulo de cada usuario.",
      Icon: "UserCog", color: "rose", category: "Sistema", badge: "NUEVO" },
];

const CATEGORIES: { name: string; color: string }[] = [
    { name: "Operación", color: "text-orange-300" },
    { name: "Comercial", color: "text-cyan-300" },
    { name: "Finanzas",  color: "text-emerald-300" },
    { name: "Sistema",   color: "text-violet-300" },
];

export default async function HomePage() {
    const session = await getSession();
    if (!session) redirect('/login?redirect=/');

    // Filtrar módulos según permisos (master ve todo). canViewModule entiende
    // módulos con sub-módulos: si el usuario puede ver al menos un sub, la
    // tarjeta del módulo padre aparece.
    const visible = ALL_MODULES.filter((m) =>
        canViewModule(session.role, session.permissions, m.moduleCode)
    );

    // Stats rápidas
    const [
        { count: employees },
        { count: otInProgress },
        { count: otInQC },
        { count: docsTotal },
        { data: recentChanges },
        { count: pendingRequisitions },
    ] = await Promise.all([
        supabase.from("employees").select("id", { count: "exact", head: true }).eq("is_active", true),
        supabase.from("work_orders").select("id", { count: "exact", head: true }).in("status", ["Open", "In Progress", "Paused"]),
        supabase.from("work_orders").select("id", { count: "exact", head: true }).eq("status", "QC"),
        supabase.from("documents").select("id", { count: "exact", head: true }),
        supabase.from("change_log").select("changed_at").gte("changed_at", new Date(Date.now() - 7 * 86400000).toISOString()),
        supabase.from("requisitions").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ]);

    return (
        <DashboardClient
            user={{
                id: session.employeeId,
                fullName: session.fullName,
                username: session.username,
                role: session.role,
                position: session.position,
                photoUrl: session.photoUrl,
            }}
            visibleModules={visible.map(({ moduleCode, subCode, ...rest }) => rest)}
            stats={{
                employees: employees || 0,
                otInProgress: otInProgress || 0,
                otInQC: otInQC || 0,
                docsTotal: docsTotal || 0,
                changesLast7d: recentChanges?.length || 0,
                pendingRequisitions: pendingRequisitions || 0,
            }}
        />
    );
}
