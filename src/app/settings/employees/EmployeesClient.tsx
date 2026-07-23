"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    ArrowLeft, Plus, Pencil, Trash2, X, Loader2, User, ShieldCheck,
    KeyRound, Camera, Eye, EyeOff
} from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import {
    createEmployeeAction,
    deleteEmployeeAction,
    updateEmployeeAction,
    uploadEmployeePhotoAction,
} from "@/app/actions/employees";
import {
    MODULE_CATALOG,
    ALL_FLAG_KEYS,
    type PermFlagKey,
} from "@/lib/moduleCatalog";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

type PermFlag = PermFlagKey;

type Permission = {
    id?: string;
    module_code: string;
    sub_code: string | null;
    can_view: boolean;
    can_create: boolean;
    can_edit: boolean;
    can_delete: boolean;
    can_start: boolean;
    can_pause: boolean;
    can_complete: boolean;
    can_request_supplies: boolean;
    can_purchase: boolean;
};

type Employee = {
    id: string;
    full_name: string;
    username: string;
    role: "master" | "admin" | "operator";
    position: string | null;
    phone: string | null;
    photo_url: string | null;
    is_active: boolean;
    last_login_at: string | null;
    created_at: string;
    permissions: Permission[];
};

const ROLE_LABEL: Record<string, { label: string; chip: string }> = {
    master:   { label: "Master",   chip: "bg-orange-500/20 text-orange-300 border-orange-500/30" },
    admin:    { label: "Admin",    chip: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30" },
    operator: { label: "Operador", chip: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
};

// MODULE_CATALOG y ALL_FLAG_KEYS vienen de @/lib/moduleCatalog — fuente única.
// Si agregas un módulo, edita solo ese archivo.

function blankPerm(module_code: string, sub_code: string | null): Permission {
    return {
        module_code, sub_code,
        can_view: false, can_create: false, can_edit: false, can_delete: false,
        can_start: false, can_pause: false, can_complete: false,
        can_request_supplies: false, can_purchase: false,
    };
}

function initials(name: string) {
    const parts = name.trim().split(/\s+/).slice(0, 2);
    return parts.map((p) => p[0]?.toUpperCase() || "").join("");
}

function fmtDate(iso: string | null) {
    if (!iso) return "—";
    try {
        return new Date(iso).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
    } catch { return iso; }
}

// ============================================================
// Componente principal
// ============================================================
export default function EmployeesClient({
    currentUserId,
    currentUserRole,
    initialEmployees,
}: {
    currentUserId: string;
    currentUserRole: string;
    initialEmployees: Employee[];
}) {
    const router = useRouter();
    const [employees, setEmployees] = useState<Employee[]>(initialEmployees);
    const [search, setSearch] = useState("");
    const [editing, setEditing] = useState<Employee | null>(null);
    const [creating, setCreating] = useState(false);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [info, setInfo] = useState<string | null>(null);

    const filtered = useMemo(() => {
        const q = search.toLowerCase().trim();
        if (!q) return employees;
        return employees.filter((e) =>
            e.full_name.toLowerCase().includes(q) ||
            e.username.toLowerCase().includes(q) ||
            (e.position || "").toLowerCase().includes(q)
        );
    }, [employees, search]);

    const handleSaved = (msg: string) => {
        setInfo(msg);
        setTimeout(() => setInfo(null), 3500);
        router.refresh();
    };

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 font-[family-name:var(--font-sans)]">
            <div className="max-w-[1500px] mx-auto p-3 md:p-6 space-y-4">
                {/* Header */}
                <header className="bg-neutral-800/40 p-4 rounded-2xl border border-neutral-700/50 flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3">
                        <Link href="/" className="p-2.5 bg-neutral-800 hover:bg-neutral-700 rounded-xl border border-neutral-700">
                            <ArrowLeft className="w-4 h-4" />
                        </Link>
                        <div>
                            <h1 className="text-xl font-bold text-white">Empleados</h1>
                            <p className="text-xs text-neutral-400">
                                {employees.length} usuario{employees.length === 1 ? "" : "s"} · asigna módulos y acciones con palomitas
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Buscar por nombre, usuario, puesto…"
                            className="bg-neutral-900/50 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500 w-72"
                        />
                        <button
                            onClick={() => { setCreating(true); setErr(null); }}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white text-xs font-semibold"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            Nuevo empleado
                        </button>
                    </div>
                </header>

                {info && (
                    <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-sm rounded-xl p-3">
                        {info}
                    </div>
                )}
                {err && (
                    <div className="bg-rose-500/10 border border-rose-500/30 text-rose-200 text-sm rounded-xl p-3">
                        {err}
                    </div>
                )}

                {/* Lista */}
                <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-neutral-900/50 text-[10px] uppercase tracking-wider text-neutral-400">
                                <tr>
                                    <th className="text-left p-3">Empleado</th>
                                    <th className="text-left p-3">Usuario</th>
                                    <th className="text-left p-3">Rol</th>
                                    <th className="text-left p-3">Puesto</th>
                                    <th className="text-left p-3">Módulos</th>
                                    <th className="text-left p-3">Último acceso</th>
                                    <th className="text-left p-3">Estado</th>
                                    <th className="text-right p-3">Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.length === 0 && (
                                    <tr>
                                        <td colSpan={8} className="p-10 text-center text-neutral-500 text-sm">
                                            {employees.length === 0 ? "Aún no hay empleados. Crea el primero." : "Sin coincidencias."}
                                        </td>
                                    </tr>
                                )}
                                {filtered.map((e) => {
                                    const role = ROLE_LABEL[e.role] || ROLE_LABEL.operator;
                                    const modulesCount = new Set(
                                        e.permissions.filter((p) => p.can_view).map((p) => p.module_code)
                                    ).size;
                                    return (
                                        <tr key={e.id} className="border-t border-neutral-800/60 hover:bg-neutral-800/30">
                                            <td className="p-3">
                                                <div className="flex items-center gap-2.5">
                                                    {e.photo_url ? (
                                                        // eslint-disable-next-line @next/next/no-img-element
                                                        <img src={e.photo_url} alt={e.full_name} className="w-8 h-8 rounded-lg object-cover" />
                                                    ) : (
                                                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500/30 to-amber-500/30 flex items-center justify-center text-[10px] font-bold text-orange-200">
                                                            {initials(e.full_name)}
                                                        </div>
                                                    )}
                                                    <div className="leading-tight">
                                                        <p className="text-white font-semibold text-sm">{e.full_name}</p>
                                                        {e.phone && <p className="text-[10px] text-neutral-500">{e.phone}</p>}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="p-3 font-mono text-[12px] text-neutral-300">{e.username}</td>
                                            <td className="p-3">
                                                <span className={cn("text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border", role.chip)}>
                                                    {role.label}
                                                </span>
                                            </td>
                                            <td className="p-3 text-neutral-300 text-xs">{e.position || "—"}</td>
                                            <td className="p-3 text-xs text-neutral-300">{modulesCount} módulo{modulesCount === 1 ? "" : "s"}</td>
                                            <td className="p-3 text-[11px] text-neutral-400">{fmtDate(e.last_login_at)}</td>
                                            <td className="p-3">
                                                {e.is_active ? (
                                                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                                        Activo
                                                    </span>
                                                ) : (
                                                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-neutral-700/40 text-neutral-400 border border-neutral-600/30">
                                                        Inactivo
                                                    </span>
                                                )}
                                            </td>
                                            <td className="p-3 text-right">
                                                <div className="inline-flex items-center gap-1">
                                                    <button
                                                        onClick={() => { setEditing(e); setErr(null); }}
                                                        className="p-1.5 rounded-lg text-neutral-400 hover:text-orange-300 hover:bg-orange-500/10"
                                                        title="Editar"
                                                    >
                                                        <Pencil className="w-3.5 h-3.5" />
                                                    </button>
                                                    <button
                                                        onClick={async () => {
                                                            if (e.id === currentUserId) {
                                                                setErr("No puedes eliminar tu propio usuario.");
                                                                return;
                                                            }
                                                            if (!confirm(`¿Eliminar a ${e.full_name}?`)) return;
                                                            setBusy(true);
                                                            try {
                                                                await deleteEmployeeAction(e.id);
                                                                setEmployees((prev) => prev.filter((x) => x.id !== e.id));
                                                                handleSaved("Empleado eliminado.");
                                                            } catch (ex: any) {
                                                                setErr(ex.message);
                                                            } finally {
                                                                setBusy(false);
                                                            }
                                                        }}
                                                        disabled={busy || e.id === currentUserId}
                                                        className="p-1.5 rounded-lg text-neutral-400 hover:text-rose-300 hover:bg-rose-500/10 disabled:opacity-30"
                                                        title="Eliminar"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {(editing || creating) && (
                <EmployeeEditorModal
                    employee={editing}
                    currentUserRole={currentUserRole}
                    isMaster={currentUserRole === "master"}
                    onClose={() => { setEditing(null); setCreating(false); setErr(null); }}
                    onSaved={async (saved) => {
                        if (creating) {
                            // recargar lista (mejor server refresh)
                            setCreating(false);
                            handleSaved("Empleado creado. Recargando…");
                            setTimeout(() => router.refresh(), 300);
                        } else {
                            setEmployees((prev) => prev.map((x) => x.id === saved.id ? { ...x, ...saved } : x));
                            setEditing(null);
                            handleSaved("Cambios guardados.");
                        }
                    }}
                    setErr={setErr}
                />
            )}
        </div>
    );
}

// ============================================================
// Modal: crear / editar empleado
// ============================================================
function EmployeeEditorModal({
    employee,
    currentUserRole,
    isMaster,
    onClose,
    onSaved,
    setErr,
}: {
    employee: Employee | null;
    currentUserRole: string;
    isMaster: boolean;
    onClose: () => void;
    onSaved: (saved: Employee) => void;
    setErr: (msg: string | null) => void;
}) {
    const isEdit = !!employee;

    const [fullName, setFullName] = useState(employee?.full_name || "");
    const [username, setUsername] = useState(employee?.username || "");
    const [password, setPassword] = useState("");
    const [showPwd, setShowPwd] = useState(false);
    const [role, setRole] = useState<"master" | "admin" | "operator">(employee?.role || "operator");
    const [position, setPosition] = useState(employee?.position || "");
    const [phone, setPhone] = useState(employee?.phone || "");
    const [isActive, setIsActive] = useState(employee?.is_active ?? true);
    const [photoUrl, setPhotoUrl] = useState(employee?.photo_url || "");

    // permisos: inicializar desde employee o vacíos
    const [perms, setPerms] = useState<Permission[]>(() => {
        if (employee) return employee.permissions.length ? employee.permissions : [];
        // inicial: crear un permiso vacío por módulo/sub para que el editor los muestre
        const list: Permission[] = [];
        for (const m of MODULE_CATALOG) {
            if (m.subs && m.subs.length) {
                for (const s of m.subs) list.push(blankPerm(m.code, s.code));
            } else {
                list.push(blankPerm(m.code, null));
            }
        }
        return list;
    });

    const [saving, setSaving] = useState(false);
    const [uploadingPhoto, setUploadingPhoto] = useState(false);

    // sincronizar perms si cambia de módulo raíz (subs) - ya están todos inicializados

    const getPerm = (moduleCode: string, subCode: string | null): Permission => {
        return perms.find((p) => p.module_code === moduleCode && p.sub_code === subCode) || blankPerm(moduleCode, subCode);
    };

    const setPermFlag = (
        moduleCode: string,
        subCode: string | null,
        flag: PermFlag,
        value: boolean
    ) => {
        setPerms((prev) => {
            const idx = prev.findIndex((p) => p.module_code === moduleCode && p.sub_code === subCode);
            if (idx >= 0) {
                const copy = [...prev];
                copy[idx] = { ...copy[idx], [flag]: value };
                return copy;
            }
            return [...prev, { ...blankPerm(moduleCode, subCode), [flag]: value }];
        });
    };

    const setSubEnabled = (moduleCode: string, subCode: string | null, enabled: boolean) => {
        setPerms((prev) => {
            const idx = prev.findIndex((p) => p.module_code === moduleCode && p.sub_code === subCode);
            if (enabled) {
                if (idx >= 0) return prev;
                return [...prev, blankPerm(moduleCode, subCode)];
            } else {
                if (idx < 0) return prev;
                return prev.filter((_, i) => i !== idx);
            }
        });
    };

    const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        if (!f) return;
        setUploadingPhoto(true);
        try {
            const reader = new FileReader();
            const base64: string = await new Promise((res, rej) => {
                reader.onload = () => res(String(reader.result || ""));
                reader.onerror = rej;
                reader.readAsDataURL(f);
            });
            const b64 = base64.split(",")[1] || "";
            const url = await uploadEmployeePhotoAction(b64, f.name);
            setPhotoUrl(url);
        } catch (ex: any) {
            setErr(ex.message || "Error al subir la foto.");
        } finally {
            setUploadingPhoto(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErr(null);

        if (!fullName.trim() || !username.trim()) {
            setErr("Nombre completo y usuario son obligatorios.");
            return;
        }
        if (!isEdit && !password) {
            setErr("La contraseña es obligatoria al crear un empleado.");
            return;
        }
        if (role === "master" && !isMaster) {
            setErr("Solo un master puede asignar el rol master.");
            return;
        }

        setSaving(true);
        try {
            // limpiar permisos vacíos antes de enviar
            const cleanPerms = perms.filter((p) =>
                p.can_view || p.can_create || p.can_edit || p.can_delete ||
                p.can_start || p.can_pause || p.can_complete ||
                p.can_request_supplies || p.can_purchase
            );

            if (isEdit && employee) {
                const input: any = {
                    full_name: fullName,
                    username,
                    role,
                    position: position || null,
                    phone: phone || null,
                    photo_url: photoUrl || null,
                    is_active: isActive,
                };
                if (password) input.password = password;
                await updateEmployeeAction(employee.id, input, cleanPerms);
                onSaved({ ...employee, ...input, permissions: cleanPerms, id: employee.id } as any);
            } else {
                const input: any = {
                    full_name: fullName,
                    username,
                    password,
                    role,
                    position: position || null,
                    phone: phone || null,
                    photo_url: photoUrl || null,
                    is_active: isActive,
                };
                await createEmployeeAction(input, cleanPerms);
                onSaved({ ...input, permissions: cleanPerms, id: "new" } as any);
            }
        } catch (ex: any) {
            setErr(ex.message || "Error al guardar.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div
                className="bg-neutral-900 border border-neutral-700/60 rounded-3xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <form onSubmit={handleSubmit}>
                    {/* Header */}
                    <div className="sticky top-0 z-10 bg-neutral-900 border-b border-neutral-800 p-5 flex items-center justify-between">
                        <div>
                            <h2 className="text-lg font-bold text-white flex items-center gap-2">
                                {isEdit ? <Pencil className="w-4 h-4 text-orange-400" /> : <Plus className="w-4 h-4 text-orange-400" />}
                                {isEdit ? "Editar empleado" : "Nuevo empleado"}
                            </h2>
                            <p className="text-[11px] text-neutral-500">
                                Llena los datos y marca los módulos/acciones que este usuario podrá usar.
                            </p>
                        </div>
                        <button type="button" onClick={onClose} className="p-2 text-neutral-500 hover:text-white">
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    <div className="p-5 space-y-6">
                        {/* Foto */}
                        <div className="flex items-center gap-4">
                            <div className="w-20 h-20 rounded-2xl bg-neutral-800 border border-neutral-700 overflow-hidden flex items-center justify-center">
                                {photoUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={photoUrl} alt="Foto" className="w-full h-full object-cover" />
                                ) : (
                                    <User className="w-8 h-8 text-neutral-600" />
                                )}
                            </div>
                            <div>
                                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-xs font-medium text-neutral-300 cursor-pointer">
                                    <Camera className="w-3.5 h-3.5" />
                                    {uploadingPhoto ? "Subiendo…" : photoUrl ? "Cambiar foto" : "Subir foto"}
                                    <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} disabled={uploadingPhoto} />
                                </label>
                                {photoUrl && (
                                    <button
                                        type="button"
                                        onClick={() => setPhotoUrl("")}
                                        className="ml-2 text-[11px] text-neutral-500 hover:text-rose-300"
                                    >
                                        Quitar
                                    </button>
                                )}
                                <p className="text-[10px] text-neutral-500 mt-1">JPG o PNG, máx 5 MB</p>
                            </div>
                        </div>

                        {/* Datos */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Field label="Nombre completo *">
                                <input
                                    type="text"
                                    value={fullName}
                                    onChange={(e) => setFullName(e.target.value)}
                                    className="w-full bg-neutral-800/60 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                                    placeholder="Juan Pérez López"
                                    required
                                />
                            </Field>
                            <Field label="Puesto">
                                <input
                                    type="text"
                                    value={position}
                                    onChange={(e) => setPosition(e.target.value)}
                                    className="w-full bg-neutral-800/60 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                                    placeholder="Operador de Soldadura"
                                />
                            </Field>
                            <Field label="Usuario (login) *">
                                <input
                                    type="text"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ""))}
                                    className="w-full bg-neutral-800/60 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-orange-500"
                                    placeholder="jperez"
                                    required
                                />
                            </Field>
                            <Field label={isEdit ? "Nueva contraseña (dejar vacío para no cambiar)" : "Contraseña *"}>
                                <div className="relative">
                                    <input
                                        type={showPwd ? "text" : "password"}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="w-full bg-neutral-800/60 border border-neutral-700 rounded-xl pl-3 pr-10 py-2 text-sm text-white font-mono focus:outline-none focus:border-orange-500"
                                        placeholder={isEdit ? "••••••••" : "Mínimo 6 caracteres"}
                                        autoComplete="new-password"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPwd((v) => !v)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-neutral-500 hover:text-white"
                                    >
                                        {showPwd ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                    </button>
                                </div>
                            </Field>
                            <Field label="Rol">
                                <select
                                    value={role}
                                    onChange={(e) => setRole(e.target.value as any)}
                                    className="w-full bg-neutral-800/60 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                                    disabled={!isMaster}
                                >
                                    <option value="operator">Operador</option>
                                    <option value="admin">Administrador</option>
                                    {isMaster && <option value="master">Master</option>}
                                </select>
                            </Field>
                            <Field label="Teléfono">
                                <input
                                    type="text"
                                    value={phone}
                                    onChange={(e) => setPhone(e.target.value)}
                                    className="w-full bg-neutral-800/60 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                                    placeholder="+52 999 123 4567"
                                />
                            </Field>
                        </div>

                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                id="isActive"
                                checked={isActive}
                                onChange={(e) => setIsActive(e.target.checked)}
                                className="w-4 h-4 rounded border-neutral-600 bg-neutral-800 text-orange-500 focus:ring-orange-500/30"
                            />
                            <label htmlFor="isActive" className="text-sm text-neutral-300">Usuario activo (puede iniciar sesión)</label>
                        </div>

                        {/* Permisos */}
                        <div>
                            <div className="flex items-center gap-2 mb-3">
                                <ShieldCheck className="w-4 h-4 text-orange-400" />
                                <h3 className="text-sm font-bold text-white">Permisos por módulo</h3>
                                <span className="text-[10px] text-neutral-500">Marca con palomitas las acciones que el usuario puede realizar.</span>
                            </div>
                            <div className="space-y-3">
                                {MODULE_CATALOG.map((m) => {
                                    if (m.subs && m.subs.length) {
                                        return (
                                            <div key={m.code} className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-4">
                                                <div className="flex items-center justify-between mb-3">
                                                    <div className="text-sm font-bold text-white">{m.label}</div>
                                                </div>
                                                <div className="space-y-2.5">
                                                    {m.subs.map((s) => {
                                                        const p = getPerm(m.code, s.code);
                                                        const enabled = perms.some((x) => x.module_code === m.code && x.sub_code === s.code);
                                                        return (
                                                            <div key={s.code} className="border-t border-neutral-800/60 pt-2.5 first:border-t-0 first:pt-0">
                                                                <label className="flex items-center gap-2 mb-1.5">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={enabled}
                                                                        onChange={(e) => setSubEnabled(m.code, s.code, e.target.checked)}
                                                                        className="w-3.5 h-3.5 rounded border-neutral-600 bg-neutral-800 text-orange-500"
                                                                    />
                                                                    <span className="text-xs font-semibold text-neutral-200">{s.label}</span>
                                                                </label>
                                                                {enabled && (
                                                                    <div className="flex flex-wrap gap-1.5 ml-5">
                                                                        {m.actions.map((a) => (
                                                                            <label
                                                                                key={a.key}
                                                                                className={cn(
                                                                                    "px-2 py-1 rounded-lg border text-[11px] cursor-pointer flex items-center gap-1.5 transition-colors",
                                                                                    (p as any)[a.key]
                                                                                        ? "bg-orange-500/15 border-orange-500/40 text-orange-200"
                                                                                        : "bg-neutral-900/40 border-neutral-700/50 text-neutral-400 hover:border-neutral-600"
                                                                                )}
                                                                            >
                                                                                <input
                                                                                    type="checkbox"
                                                                                    checked={!!(p as any)[a.key]}
                                                                                    onChange={(e) => setPermFlag(m.code, s.code, a.key, e.target.checked)}
                                                                                    className="hidden"
                                                                                />
                                                                                <span className={cn("w-1.5 h-1.5 rounded-full", (p as any)[a.key] ? "bg-orange-400" : "bg-neutral-600")} />
                                                                                {a.label}
                                                                            </label>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        );
                                    }
                                    const p = getPerm(m.code, null);
                                    const enabled = perms.some((x) => x.module_code === m.code && (x.sub_code === null || x.sub_code === ""));
                                    return (
                                        <div key={m.code} className="bg-neutral-800/40 border border-neutral-700/50 rounded-2xl p-4">
                                            <div className="flex items-center justify-between gap-2 mb-2">
                                                <label className="flex items-center gap-2">
                                                    <input
                                                        type="checkbox"
                                                        checked={enabled}
                                                        onChange={(e) => setSubEnabled(m.code, null, e.target.checked)}
                                                        className="w-3.5 h-3.5 rounded border-neutral-600 bg-neutral-800 text-orange-500"
                                                    />
                                                    <span className="text-sm font-bold text-white">{m.label}</span>
                                                </label>
                                            </div>
                                            {enabled && (
                                                <div className="flex flex-wrap gap-1.5">
                                                    {m.actions.map((a) => (
                                                        <label
                                                            key={a.key}
                                                            className={cn(
                                                                "px-2 py-1 rounded-lg border text-[11px] cursor-pointer flex items-center gap-1.5 transition-colors",
                                                                (p as any)[a.key]
                                                                    ? "bg-orange-500/15 border-orange-500/40 text-orange-200"
                                                                    : "bg-neutral-900/40 border-neutral-700/50 text-neutral-400 hover:border-neutral-600"
                                                            )}
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={!!(p as any)[a.key]}
                                                                onChange={(e) => setPermFlag(m.code, null, a.key, e.target.checked)}
                                                                className="hidden"
                                                            />
                                                            <span className={cn("w-1.5 h-1.5 rounded-full", (p as any)[a.key] ? "bg-orange-400" : "bg-neutral-600")} />
                                                            {a.label}
                                                        </label>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="sticky bottom-0 bg-neutral-900 border-t border-neutral-800 p-4 flex items-center justify-end gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 rounded-xl text-sm text-neutral-300 hover:bg-neutral-800"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="px-5 py-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-1.5"
                        >
                            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            {isEdit ? "Guardar cambios" : "Crear empleado"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <label className="block text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">{label}</label>
            {children}
        </div>
    );
}
