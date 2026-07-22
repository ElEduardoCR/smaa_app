"use client";

import Link from "next/link";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";
import {
    Users, LogOut, BarChart3, Receipt, ShieldCheck, Cog,
    Wallet, BookOpen, History, Factory, Truck, ChevronRight,
    ClipboardList, UserCog
} from "lucide-react";
import { logoutAction } from "@/app/actions/auth";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

type UserInfo = {
    id: string;
    fullName: string;
    username: string;
    role: string;
    position: string | null;
    photoUrl: string | null;
};

type ModuleCard = {
    href: string;
    title: string;
    desc: string;
    Icon: string;
    color: "orange" | "emerald" | "amber" | "cyan" | "rose" | "violet" | "sky" | "slate";
    category: "Operación" | "Comercial" | "Finanzas" | "Calidad" | "Sistema";
    badge?: string;
};

const ICONS: Record<string, any> = {
    Users, BarChart3, Receipt, ShieldCheck, Cog,
    Wallet, BookOpen, History, Factory, Truck,
    ClipboardList, UserCog,
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

const CATEGORIES: { name: string; color: string }[] = [
    { name: "Operación", color: "text-orange-300" },
    { name: "Comercial", color: "text-cyan-300" },
    { name: "Finanzas",  color: "text-emerald-300" },
    { name: "Sistema",   color: "text-violet-300" },
];

const ROLE_LABEL: Record<string, string> = {
    master: "Master",
    admin: "Administrador",
    operator: "Operador",
};

function initials(name: string) {
    const parts = name.trim().split(/\s+/).slice(0, 2);
    return parts.map((p) => p[0]?.toUpperCase() || "").join("");
}

export default function DashboardClient({
    user,
    visibleModules,
    stats,
}: {
    user: UserInfo;
    visibleModules: ModuleCard[];
    stats: {
        employees: number;
        otInProgress: number;
        otInQC: number;
        docsTotal: number;
        changesLast7d: number;
        pendingRequisitions: number;
    };
}) {
    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 font-[family-name:var(--font-sans)]">
            <div className="max-w-[1800px] mx-auto p-3 md:p-5 lg:p-6 space-y-4">
                {/* Header */}
                <header className="bg-neutral-800/40 p-3.5 md:p-4 rounded-2xl border border-neutral-700/50 flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-orange-500/30 to-amber-500/30 rounded-xl flex items-center justify-center border border-orange-500/30">
                            <Factory className="w-5 h-5 text-orange-300" />
                        </div>
                        <div>
                            <h1 className="text-xl md:text-2xl font-bold text-white flex items-center gap-2">
                                SMAA ERP
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 uppercase tracking-wider">
                                    ISO 9001:2015
                                </span>
                            </h1>
                            <p className="text-[11px] md:text-xs text-neutral-400">
                                Sistema de Gestión Integral — {visibleModules.length} módulos disponibles para ti
                            </p>
                        </div>
                    </div>

                    {/* User chip + logout */}
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-neutral-800/60 border border-neutral-700/50">
                            {user.photoUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={user.photoUrl} alt={user.fullName} className="w-7 h-7 rounded-lg object-cover" />
                            ) : (
                                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-orange-500/30 to-amber-500/30 flex items-center justify-center text-[10px] font-bold text-orange-200">
                                    {initials(user.fullName)}
                                </div>
                            )}
                            <div className="leading-tight hidden sm:block">
                                <p className="text-xs font-semibold text-white">{user.fullName}</p>
                                <p className="text-[10px] text-neutral-400">
                                    {user.position || ROLE_LABEL[user.role] || user.role}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={async () => {
                                await logoutAction();
                                window.location.href = "/login";
                            }}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-neutral-800/60 hover:bg-rose-500/20 text-neutral-300 hover:text-rose-300 border border-neutral-700/50 hover:border-rose-500/40 transition-colors text-xs font-medium"
                        >
                            <LogOut className="w-3.5 h-3.5" />
                            <span className="hidden md:inline">Salir</span>
                        </button>
                    </div>
                </header>

                {/* Quick stats row */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
                    <StatChip label="Empleados activos" value={stats.employees} Icon={Users} color="emerald" />
                    <StatChip label="OTs en curso" value={stats.otInProgress} Icon={Factory} color="orange" />
                    <StatChip label="OTs en Calidad" value={stats.otInQC} Icon={ShieldCheck} color="sky" />
                    <StatChip label="Requisiciones pendientes" value={stats.pendingRequisitions} Icon={ClipboardList} color="amber" />
                    <StatChip label="Docs ISO" value={stats.docsTotal} Icon={BookOpen} color="violet" />
                    <StatChip label="Cambios (7d)" value={stats.changesLast7d} Icon={History} color="amber" />
                </div>

                {/* Modules grouped by category */}
                {CATEGORIES.map((cat) => {
                    const items = visibleModules.filter((m) => m.category === cat.name);
                    if (items.length === 0) return null;
                    return (
                        <section key={cat.name}>
                            <h2 className={cn("text-[11px] font-bold uppercase tracking-[0.15em] mb-2 flex items-center gap-1.5", cat.color)}>
                                <span className="w-1 h-3 rounded-full bg-current opacity-70" />
                                {cat.name}
                                <span className="text-neutral-600 ml-1">· {items.length}</span>
                            </h2>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-6 gap-2.5">
                                {items.map((m) => <CompactModuleCard key={m.href} {...m} />)}
                            </div>
                        </section>
                    );
                })}

                {visibleModules.length === 0 && (
                    <div className="bg-neutral-800/40 border border-amber-500/30 rounded-2xl p-8 text-center">
                        <ShieldCheck className="w-10 h-10 text-amber-400 mx-auto mb-3" />
                        <h2 className="text-lg font-bold text-white mb-2">No tienes módulos asignados</h2>
                        <p className="text-sm text-neutral-400">
                            Pide al administrador que te asigne permisos desde Configuración → Empleados.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}

function CompactModuleCard({ href, title, desc, Icon, color, badge }: ModuleCard) {
    const c = COLOR_CLASSES[color] || COLOR_CLASSES.slate;
    const IconCmp = ICONS[Icon] || Factory;
    return (
        <Link
            href={href}
            className={cn(
                "group relative bg-neutral-800/40 border rounded-2xl p-3.5 hover:bg-neutral-800/80 transition-all duration-200 shadow-lg shadow-black/10 hover:-translate-y-0.5 flex flex-col overflow-hidden",
                c.border
            )}
        >
            <div className="flex items-start justify-between mb-2.5">
                <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform", c.icon)}>
                    <IconCmp className="w-[18px] h-[18px]" />
                </div>
                {badge && (
                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300 uppercase tracking-wider border border-orange-500/30">
                        {badge}
                    </span>
                )}
            </div>
            <h3 className="text-sm font-bold text-white leading-tight">{title}</h3>
            <p className="text-[11px] text-neutral-400 mt-1 line-clamp-2 leading-snug flex-1">{desc}</p>
            <div className={cn("mt-2.5 pt-2 border-t border-neutral-700/40 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider", c.hover)}>
                <span>Abrir</span>
                <ChevronRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </div>
        </Link>
    );
}

function StatChip({ label, value, Icon, color }: any) {
    const colors: Record<string, string> = {
        emerald: "border-emerald-500/20 bg-emerald-500/5 text-emerald-300",
        orange:  "border-orange-500/20 bg-orange-500/5 text-orange-300",
        sky:     "border-sky-500/20 bg-sky-500/5 text-sky-300",
        violet:  "border-violet-500/20 bg-violet-500/5 text-violet-300",
        amber:   "border-amber-500/20 bg-amber-500/5 text-amber-300",
    };
    return (
        <div className={cn("rounded-2xl border p-3 flex items-center gap-2.5", colors[color] || colors.slate)}>
            <div className="w-9 h-9 rounded-xl bg-neutral-900/40 flex items-center justify-center flex-shrink-0">
                <Icon className="w-4 h-4" />
            </div>
            <div className="min-w-0">
                <p className="text-[9px] uppercase tracking-wider opacity-80 leading-tight">{label}</p>
                <p className="text-xl font-bold text-white leading-tight tabular-nums">{value}</p>
            </div>
        </div>
    );
}
