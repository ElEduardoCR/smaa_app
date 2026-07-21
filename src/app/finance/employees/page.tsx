"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
    ArrowLeft, Plus, RefreshCw, Users, Search, Eye, Filter
} from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

type Employee = {
    id: string;
    code: string;
    full_name: string;
    rfc: string | null;
    position: string | null;
    department: string | null;
    payment_type: string;
    base_salary: number;
    hourly_rate: number;
    status: string;
    hire_date: string;
};

const STATUS_STYLES: Record<string, string> = {
    active: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
    inactive: "bg-neutral-500/10 text-neutral-300 border-neutral-500/30",
    suspended: "bg-amber-500/10 text-amber-300 border-amber-500/30",
    terminated: "bg-red-500/10 text-red-300 border-red-500/30",
};
const STATUS_LABEL: Record<string, string> = {
    active: "Activo", inactive: "Inactivo", suspended: "Suspendido", terminated: "Baja",
};
const PAY_LABEL: Record<string, string> = {
    monthly: "Mensual", biweekly: "Quincenal", weekly: "Semanal", hourly: "Por hora", daily: "Diario",
};

const fmt = (n: number | null | undefined) =>
    `$${(Number(n) || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function EmployeesPage() {
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");

    const load = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from("employees")
                .select("id, code, full_name, rfc, position, department, payment_type, base_salary, hourly_rate, status, hire_date")
                .order("full_name", { ascending: true });
            if (error) throw error;
            setEmployees(data || []);
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);

    const filtered = employees.filter(e => {
        if (statusFilter !== "all" && e.status !== statusFilter) return false;
        if (search) {
            const s = search.toLowerCase();
            return e.full_name.toLowerCase().includes(s)
                || (e.code || "").toLowerCase().includes(s)
                || (e.rfc || "").toLowerCase().includes(s)
                || (e.position || "").toLowerCase().includes(s)
                || (e.department || "").toLowerCase().includes(s);
        }
        return true;
    });

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 p-6 md:p-10 font-[family-name:var(--font-sans)]">
            <div className="max-w-6xl mx-auto space-y-6">
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-neutral-800/40 p-6 rounded-3xl border border-neutral-700/50 backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                        <Link href="/finance" className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors text-neutral-400 hover:text-white border border-neutral-700">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div>
                            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                                <Users className="w-8 h-8 text-emerald-400" />
                                Empleados
                            </h1>
                            <p className="text-neutral-400 text-sm mt-1">Personal contratado con salario, bonos y configuración de pago.</p>
                        </div>
                    </div>
                    <Link
                        href="/finance/employees/new"
                        className="flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-5 py-3 rounded-xl font-medium transition-all hover:shadow-[0_0_20px_rgba(16,185,129,0.4)] active:scale-95"
                    >
                        <Plus className="w-5 h-5" /> Nuevo empleado
                    </Link>
                </header>

                <div className="flex flex-col md:flex-row gap-3">
                    <div className="relative flex-1">
                        <Search className="w-4 h-4 absolute left-3 top-3.5 text-neutral-500" />
                        <input
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Buscar por nombre, código, RFC o puesto…"
                            className="w-full pl-9 pr-3 py-2.5 bg-neutral-900/50 border border-neutral-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <Filter className="w-4 h-4 text-neutral-500" />
                        {["all", "active", "inactive", "suspended", "terminated"].map(s => (
                            <button
                                key={s}
                                onClick={() => setStatusFilter(s)}
                                className={cn(
                                    "text-xs px-3 py-1.5 rounded-full border transition-colors",
                                    statusFilter === s
                                        ? "bg-white/10 text-white border-white/20"
                                        : "bg-neutral-800/40 text-neutral-400 border-neutral-700/50 hover:bg-neutral-800"
                                )}
                            >
                                {s === "all" ? "Todos" : STATUS_LABEL[s]} ({s === "all" ? employees.length : employees.filter(e => e.status === s).length})
                            </button>
                        ))}
                    </div>
                </div>

                <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-3xl overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-neutral-900/50 text-neutral-400 uppercase text-xs font-semibold tracking-wider">
                                <tr>
                                    <th className="px-6 py-4 rounded-tl-xl">Código</th>
                                    <th className="px-6 py-4">Nombre</th>
                                    <th className="px-6 py-4">Puesto / Área</th>
                                    <th className="px-6 py-4">Tipo de pago</th>
                                    <th className="px-6 py-4">Salario / Rate</th>
                                    <th className="px-6 py-4">RFC</th>
                                    <th className="px-6 py-4">Alta</th>
                                    <th className="px-6 py-4">Estatus</th>
                                    <th className="px-6 py-4 rounded-tr-xl text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-700/50">
                                {loading ? (
                                    <tr><td colSpan={9} className="px-6 py-12 text-center text-neutral-400">
                                        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-emerald-500" /> Cargando…
                                    </td></tr>
                                ) : filtered.length === 0 ? (
                                    <tr><td colSpan={9} className="px-6 py-12 text-center text-neutral-400">
                                        <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
                                        <p className="text-lg text-neutral-300 font-medium">No hay empleados</p>
                                        <p className="text-sm mt-1">Agrega el primero con el botón de arriba.</p>
                                    </td></tr>
                                ) : (
                                    filtered.map(emp => (
                                        <tr key={emp.id} className="hover:bg-neutral-800/80 transition-colors group">
                                            <td className="px-6 py-4">
                                                <span className="font-mono font-medium text-emerald-300 bg-emerald-500/10 px-2.5 py-1 rounded-md border border-emerald-500/20">
                                                    {emp.code}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 font-medium text-neutral-200">{emp.full_name}</td>
                                            <td className="px-6 py-4 text-neutral-300 text-xs">
                                                <div>{emp.position || <span className="text-neutral-600">—</span>}</div>
                                                <div className="text-neutral-500">{emp.department}</div>
                                            </td>
                                            <td className="px-6 py-4 text-xs text-neutral-300">{PAY_LABEL[emp.payment_type] || emp.payment_type}</td>
                                            <td className="px-6 py-4 text-xs text-neutral-200 font-mono">
                                                {emp.payment_type === "hourly" ? `${fmt(emp.hourly_rate)} /h` : fmt(emp.base_salary)}
                                            </td>
                                            <td className="px-6 py-4 font-mono text-[11px] text-neutral-400">{emp.rfc || "—"}</td>
                                            <td className="px-6 py-4 text-neutral-400 text-xs">{new Date(emp.hire_date).toLocaleDateString()}</td>
                                            <td className="px-6 py-4">
                                                <span className={cn("px-2.5 py-1 rounded-full text-xs font-semibold border", STATUS_STYLES[emp.status])}>
                                                    {STATUS_LABEL[emp.status] || emp.status}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <Link
                                                    href={`/finance/employees/${emp.id}`}
                                                    className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 transition-colors bg-emerald-500/10 hover:bg-emerald-500/20 px-3 py-1.5 rounded-lg border border-emerald-500/20"
                                                >
                                                    <Eye className="w-3.5 h-3.5" /> Ver
                                                </Link>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
