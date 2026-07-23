"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
    ArrowLeft, RefreshCw, Users, Search, Eye, Filter, UserPlus, Briefcase
} from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

/**
 * Lista UNIFICADA de empleados para Nóminas.
 *
 * Los empleados viven en la tabla `employees` (misma que /settings/employees
 * usa para login y permisos). Cada empleado tiene una fila opcional en
 * `payroll_employees` con los datos de nómina (RFC, salario, banco, etc.)
 * creada automáticamente al dar de alta al empleado.
 *
 * Aquí se listan TODOS los empleados (con o sin datos de nómina capturados)
 * y se muestra el status de captura de nómina en cada uno.
 */

type Employee = {
    id: string;
    username: string;
    full_name: string;
    role: string;
    position: string | null;
    phone: string | null;
    photo_url: string | null;
    is_active: boolean;
    payroll: {
        id: string;
        code: string;
        status: string;
        department: string | null;
        payment_type: string;
        base_salary: number;
        rfc: string | null;
        hire_date: string | null;
    } | null;
};

const PAYROLL_STATUS_STYLES: Record<string, string> = {
    active: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
    inactive: "bg-neutral-500/10 text-neutral-300 border-neutral-500/30",
    suspended: "bg-amber-500/10 text-amber-300 border-amber-500/30",
    terminated: "bg-red-500/10 text-red-300 border-red-500/30",
};
const PAYROLL_STATUS_LABEL: Record<string, string> = {
    active: "Activo", inactive: "Inactivo", suspended: "Suspendido", terminated: "Baja",
};
const PAY_LABEL: Record<string, string> = {
    monthly: "Mensual", biweekly: "Quincenal", weekly: "Semanal", hourly: "Por hora", daily: "Diario",
};
const ROLE_LABEL: Record<string, string> = {
    master: "Master", admin: "Admin", operator: "Operador",
};

const fmt = (n: number | null | undefined) =>
    `$${(Number(n) || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function EmployeesPage() {
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");
    const [captureFilter, setCaptureFilter] = useState("all");

    const load = async () => {
        setLoading(true);
        try {
            // Trae todos los empleados con su info de nómina (LEFT JOIN via la FK employee_id).
            const { data, error } = await supabase
                .from("employees")
                .select(`
                    id, username, full_name, role, position, phone, photo_url, is_active,
                    payroll:payroll_employees!payroll_employees_employee_id_fkey(
                        id, code, status, department, payment_type, base_salary, rfc, hire_date
                    )
                `)
                .order("full_name", { ascending: true });
            if (error) throw error;
            // Normaliza: payroll viene como array (Supabase no sabe que es 1:1 sin .single()).
            const normalized = (data || []).map((e: any) => ({
                ...e,
                payroll: Array.isArray(e.payroll) ? (e.payroll[0] || null) : e.payroll,
            }));
            setEmployees(normalized);
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);

    const filtered = employees.filter(e => {
        if (statusFilter === "system_inactive" && e.is_active) return false;
        if (statusFilter === "system_active" && !e.is_active) return false;
        if (statusFilter !== "all" && statusFilter !== "system_inactive" && statusFilter !== "system_active") {
            // filtro por status de nómina
            const ps = e.payroll?.status || "active";
            if (ps !== statusFilter) return false;
        }
        if (captureFilter === "captured" && (!e.payroll?.rfc || !e.payroll?.base_salary)) return false;
        if (captureFilter === "pending" && e.payroll?.rfc && e.payroll?.base_salary) return false;
        if (search) {
            const s = search.toLowerCase();
            return e.full_name.toLowerCase().includes(s)
                || e.username.toLowerCase().includes(s)
                || (e.payroll?.code || "").toLowerCase().includes(s)
                || (e.payroll?.rfc || "").toLowerCase().includes(s)
                || (e.position || "").toLowerCase().includes(s)
                || (e.payroll?.department || "").toLowerCase().includes(s);
        }
        return true;
    });

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-3 sm:p-6 md:p-8 lg:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-7xl mx-auto space-y-6">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50">
                    <div className="flex items-center gap-4">
                        <Link href="/finance" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors text-neutral-400 hover:text-white border border-neutral-700">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div>
                            <h1 className="text-2xl font-bold text-white flex items-center gap-3">
                                <Users className="w-7 h-7 text-emerald-400" />
                                Empleados — Nóminas
                            </h1>
                            <p className="text-neutral-400 text-sm mt-1">
                                Datos de nómina de todos los usuarios del sistema. Los empleados se dan de alta en{" "}
                                <Link href="/settings/employees" className="text-emerald-300 hover:text-emerald-200 underline">Configuración → Empleados</Link>.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={load} className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg transition-colors flex items-center gap-2 text-sm" disabled={loading}>
                            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin text-emerald-400")} /> Actualizar
                        </button>
                    </div>
                </header>

                {/* Stats */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-xl p-3">
                        <p className="text-xs text-neutral-500">Total empleados</p>
                        <p className="text-2xl font-bold text-white">{employees.length}</p>
                    </div>
                    <div className="bg-emerald-500/5 border border-emerald-500/30 rounded-xl p-3">
                        <p className="text-xs text-emerald-300">Activos en sistema</p>
                        <p className="text-2xl font-bold text-emerald-200">{employees.filter(e => e.is_active).length}</p>
                    </div>
                    <div className="bg-amber-500/5 border border-amber-500/30 rounded-xl p-3">
                        <p className="text-xs text-amber-300">Con nómina capturada</p>
                        <p className="text-2xl font-bold text-amber-200">
                            {employees.filter(e => e.payroll?.rfc && e.payroll?.base_salary).length}
                        </p>
                    </div>
                    <div className="bg-rose-500/5 border border-rose-500/30 rounded-xl p-3">
                        <p className="text-xs text-rose-300">Pendientes de capturar</p>
                        <p className="text-2xl font-bold text-rose-200">
                            {employees.filter(e => !e.payroll?.rfc || !e.payroll?.base_salary).length}
                        </p>
                    </div>
                </div>

                <div className="flex flex-col md:flex-row gap-3 flex-wrap">
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Buscar por nombre, usuario, código, RFC…"
                        className="flex-1 min-w-0 min-w-[200px] bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
                    />
                    <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500">
                        <option value="all">Todos los status</option>
                        <option value="system_active">Activos en sistema</option>
                        <option value="system_inactive">Inactivos en sistema</option>
                        <option value="active">Activos en nómina</option>
                        <option value="inactive">Inactivos en nómina</option>
                        <option value="suspended">Suspendidos</option>
                        <option value="terminated">Baja</option>
                    </select>
                    <select value={captureFilter} onChange={e => setCaptureFilter(e.target.value)} className="bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500">
                        <option value="all">Captura de nómina</option>
                        <option value="captured">Con RFC + salario</option>
                        <option value="pending">Pendientes</option>
                    </select>
                </div>

                <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl overflow-hidden">
                    {loading ? (
                        <div className="p-12 text-center text-neutral-400"><RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-emerald-400" /> Cargando…</div>
                    ) : filtered.length === 0 ? (
                        <div className="p-12 text-center text-neutral-400">
                            <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
                            <p>Sin empleados que mostrar.</p>
                            {employees.length === 0 && (
                                <p className="text-xs mt-2">
                                    Crea el primer usuario en{" "}
                                    <Link href="/settings/employees" className="text-emerald-300 hover:text-emerald-200 underline">Configuración → Empleados</Link>.
                                </p>
                            )}
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-neutral-900/50 text-[10px] uppercase tracking-wider text-neutral-400">
                                    <tr>
                                        <th className="text-left p-3">Empleado</th>
                                        <th className="text-left p-3">Código</th>
                                        <th className="text-left p-3">Status sistema</th>
                                        <th className="text-left p-3">Status nómina</th>
                                        <th className="text-left p-3">Pago</th>
                                        <th className="text-left p-3">Salario</th>
                                        <th className="text-left p-3">Captura</th>
                                        <th className="text-right p-3">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filtered.map(e => {
                                        const captured = !!(e.payroll?.rfc && e.payroll?.base_salary);
                                        return (
                                            <tr key={e.id} className="border-t border-neutral-800/60 hover:bg-neutral-800/30">
                                                <td className="p-3">
                                                    <div className="flex items-center gap-2.5">
                                                        {e.photo_url ? (
                                                            // eslint-disable-next-line @next/next/no-img-element
                                                            <img src={e.photo_url} alt={e.full_name} className="w-8 h-8 rounded-lg object-cover" />
                                                        ) : (
                                                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500/30 to-teal-500/30 flex items-center justify-center text-[10px] font-bold text-emerald-200">
                                                                {e.full_name.split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase()}
                                                            </div>
                                                        )}
                                                        <div className="leading-tight">
                                                            <p className="text-white font-semibold text-sm">{e.full_name}</p>
                                                            <p className="text-[10px] text-neutral-500">
                                                                <span className="text-neutral-400">{ROLE_LABEL[e.role] || e.role}</span>
                                                                {e.position && <> · {e.position}</>}
                                                            </p>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="p-3 font-mono text-xs text-violet-300">{e.payroll?.code || '—'}</td>
                                                <td className="p-3">
                                                    <span className={cn(
                                                        "text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border",
                                                        e.is_active
                                                            ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                                                            : "bg-rose-500/10 text-rose-300 border-rose-500/30"
                                                    )}>
                                                        {e.is_active ? "Activo" : "Inactivo"}
                                                    </span>
                                                </td>
                                                <td className="p-3">
                                                    {e.payroll ? (
                                                        <span className={cn(
                                                            "text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border",
                                                            PAYROLL_STATUS_STYLES[e.payroll.status] || PAYROLL_STATUS_STYLES.active
                                                        )}>
                                                            {PAYROLL_STATUS_LABEL[e.payroll.status] || e.payroll.status}
                                                        </span>
                                                    ) : (
                                                        <span className="text-[10px] text-neutral-500 italic">sin stub</span>
                                                    )}
                                                </td>
                                                <td className="p-3 text-xs text-neutral-300">{e.payroll ? PAY_LABEL[e.payroll.payment_type] || e.payroll.payment_type : '—'}</td>
                                                <td className="p-3 text-xs text-emerald-200 font-mono">{e.payroll ? fmt(e.payroll.base_salary) : '—'}</td>
                                                <td className="p-3">
                                                    {captured ? (
                                                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border bg-emerald-500/10 text-emerald-300 border-emerald-500/30">
                                                            Capturado
                                                        </span>
                                                    ) : (
                                                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border bg-amber-500/10 text-amber-300 border-amber-500/30">
                                                            Pendiente
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="p-3 text-right">
                                                    <Link
                                                        href={`/finance/employees/${e.id}`}
                                                        className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 transition-colors bg-emerald-500/10 hover:bg-emerald-500/20 px-3 py-1.5 rounded-lg border border-emerald-500/20"
                                                    >
                                                        <Eye className="w-3.5 h-3.5" /> Ver / Editar nómina
                                                    </Link>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
