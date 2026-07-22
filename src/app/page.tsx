import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
    Users, LogOut, BarChart3, Receipt, ShieldCheck, Cog,
    Wallet, BookOpen, History, Factory, Truck, ChevronRight,
    ClipboardList, UserCog
} from 'lucide-react';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';
import { getSession } from '@/lib/session';
import { can } from '@/lib/permissions';
import { logoutAction } from '@/app/actions/auth';
import { supabase } from '@/lib/supabase';
import DashboardClient from './DashboardClient';

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

type ModuleCard = {
    href: string;
    title: string;
    desc: string;
    Icon: any;
    color: "orange" | "emerald" | "amber" | "cyan" | "rose" | "violet" | "sky" | "slate";
    category: "Operación" | "Comercial" | "Finanzas" | "Calidad" | "Sistema";
    badge?: string;
};

const COLOR_CLASSES: Record<string, { border: string; icon: string; hover: string; }> = {
    orange:  { border: "border-orange-500/20 hover:border-orange-500/60",  icon: "bg-orange-500/15 text-orange-300",   hover: "text-orange-300" },
    emerald: { border: "border-emerald-500/20 hover:border-emerald-500/60", icon: "bg-emerald-500/15 text-emerald-300",  hover: "text-emerald-300" },
    amber:   { border: "border-amber-500/20 hover:border-amber-500/60",   icon: "bg-amber-500/15 text-amber-300",     hover: "text-amber-300" },
    cyan:    { border: "border-cyan-500/20 hover:border-cyan-500/60",     icon: "bg-cyan-500/15 text-cyan-300",       hover: "text-cyan-300" },
    rose:    { border: "border-rose-500/20 hover:border-rose-500/60",     icon: "bg-rose-500/15 text-rose-300",       hover: "text-rose-300" },
    violet:  { border: "border-violet-500/20 hover:border-violet-500/60",  icon: "bg-violet-500/15 text-violet-300",   hover: "text-violet-300" },
    sky:     { border: "border-sky-500/20 hover:border-sky-500/60",       icon: "bg-sky-500/15 text-sky-300",         hover: "text-sky-300" },
    slate:   { border: "border-slate-500/20 hover:border-slate-500/60",    icon: "bg-slate-500/15 text-slate-300",     hover: "text-slate-300" },
};

const ALL_MODULES: Array<ModuleCard & { moduleCode: string; subCode?: string | null }> = [
    { moduleCode: "manufacturing", href: "/manufacturing", title: "Fabricación", desc: "Maquinado, Soldadura y Automatización con WPS, planos y visor 3D.",
      Icon: Factory, color: "orange", category: "Operación" },
    { moduleCode: "quality",       href: "/quality",        title: "Calidad",     desc: "Cola de OTs para revisión final y firma de liberación.",
      Icon: ShieldCheck, color: "sky", category: "Operación" },
    { moduleCode: "deliveries",    href: "/deliveries",     title: "Entregas",    desc: "Listo para embalaje y Entregados con foto de factura + GPS.",
      Icon: Truck, color: "emerald", category: "Operación" },
    { moduleCode: "requisitions",  href: "/requisitions",   title: "Requisiciones", desc: "Solicitudes de insumos de operadores y conversión a compras.",
      Icon: ClipboardList, color: "amber", category: "Operación", badge: "NUEVO" },

    { moduleCode: "clients",       href: "/clients",        title: "Clientes",    desc: "CFDI 4.0, RFC, datos fiscales y condiciones de pago.",
      Icon: Users, color: "cyan", category: "Comercial" },
    { moduleCode: "sales",         href: "/sales",          title: "Ventas",      desc: "Cotizaciones con margen, OTs anidadas y comisiones.",
      Icon: Receipt, color: "emerald", category: "Comercial" },
    { moduleCode: "purchases",     href: "/purchases",      title: "Compras",     desc: "Órdenes de compra, 3 cotizaciones y buzón CFDI recibidos.",
      Icon: Factory, color: "orange", category: "Comercial" },

    { moduleCode: "finance",       href: "/finance",        title: "Nóminas y Contabilidad", desc: "Empleados, checador, nómina, IVA/ISR con OCR del SAT.",
      Icon: Wallet, color: "emerald", category: "Finanzas" },

    { moduleCode: "documents",     href: "/documents",      title: "Control de Documentos", desc: "14 procedimientos ISO 9001:2015, foliado y versionado.",
      Icon: BookOpen, color: "violet", category: "Sistema" },
    { moduleCode: "documents",     href: "/changes",        title: "Control de Cambios", desc: "Bitácora de cambios + sync automático de GitHub.",
      Icon: History, color: "sky", category: "Sistema" },
    { moduleCode: "dashboard",     href: "/dashboard",      title: "Dashboard",   desc: "Estadísticas del negocio: ventas, compras, gastos.",
      Icon: BarChart3, color: "orange", category: "Sistema" },
    { moduleCode: "settings",      href: "/settings",       title: "Configuración", desc: "Datos de la empresa, logo y PDF.",
      Icon: Cog, color: "slate", category: "Sistema" },
    { moduleCode: "employees",     href: "/settings/employees", title: "Empleados", desc: "Alta, edición y permisos por módulo de cada usuario.",
      Icon: UserCog, color: "rose", category: "Sistema", badge: "NUEVO" },
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

    // Filtrar módulos según permisos (master ve todo)
    const visible = ALL_MODULES.filter((m) =>
        can(session.role, session.permissions, m.moduleCode, 'view', m.subCode ?? null)
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
