"use client";

import { useEffect, useState, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
    Lock, ArrowRight, Loader2, KeyRound, User, X, LogIn, ShieldCheck
} from "lucide-react";
import {
    listLoginUsersAction,
    loginEmployeeAction,
} from "@/app/actions/auth";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

type LoginUser = {
    id: string;
    full_name: string;
    username: string;
    position: string | null;
    photo_url: string | null;
    role: string;
};

const ROLE_STYLES: Record<string, { ring: string; label: string; chip: string }> = {
    master:   { ring: "ring-orange-500/50",   label: "Master",   chip: "bg-orange-500/20 text-orange-300 border-orange-500/30" },
    admin:    { ring: "ring-cyan-500/50",     label: "Admin",    chip: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30" },
    operator: { ring: "ring-emerald-500/50",  label: "Operador", chip: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
};

function initials(name: string) {
    const parts = name.trim().split(/\s+/).slice(0, 2);
    return parts.map((p) => p[0]?.toUpperCase() || "").join("");
}

function Avatar({ user, size = "lg" }: { user: LoginUser; size?: "lg" | "xl" }) {
    const dim = size === "xl" ? "w-20 h-20 text-2xl" : "w-14 h-14 text-base";
    if (user.photo_url) {
        // eslint-disable-next-line @next/next/no-img-element
        return <img src={user.photo_url} alt={user.full_name} className={cn(dim, "rounded-2xl object-cover bg-neutral-800")} />;
    }
    const colors = [
        "from-orange-500/30 to-amber-500/30 text-orange-200",
        "from-cyan-500/30 to-sky-500/30 text-cyan-200",
        "from-emerald-500/30 to-teal-500/30 text-emerald-200",
        "from-violet-500/30 to-fuchsia-500/30 text-violet-200",
        "from-rose-500/30 to-pink-500/30 text-rose-200",
    ];
    const idx = (user.full_name.charCodeAt(0) || 0) % colors.length;
    return (
        <div className={cn(dim, "rounded-2xl bg-gradient-to-br flex items-center justify-center font-bold border border-neutral-700/60", colors[idx])}>
            {initials(user.full_name)}
        </div>
    );
}

function LoginInner() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const redirectUrl = searchParams.get('redirect') || '/';

    const [users, setUsers] = useState<LoginUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<LoginUser | null>(null);
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const pwdRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        (async () => {
            try {
                const list = await listLoginUsersAction();
                setUsers(list || []);
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    useEffect(() => {
        if (selected) {
            // pequeño delay para que el modal rinda
            setTimeout(() => pwdRef.current?.focus(), 80);
        }
    }, [selected]);

    const closeModal = () => {
        if (submitting) return;
        setSelected(null);
        setPassword("");
        setError(null);
    };

    const handleSubmit = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!selected) return;
        setError(null);
        setSubmitting(true);
        try {
            const result = await loginEmployeeAction(selected.username, password, redirectUrl);
            if (result.success && result.redirectTo) {
                router.push(result.redirectTo);
                router.refresh();
            } else {
                setError(result.error || "Error al iniciar sesión.");
            }
        } catch (err: any) {
            setError(err.message || "Error inesperado.");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 flex flex-col items-center p-6 font-[family-name:var(--font-sans)] relative overflow-hidden">
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-orange-500/10 rounded-full blur-[120px] mix-blend-screen pointer-events-none" />
            <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-[120px] mix-blend-screen pointer-events-none" />

            <div className="w-full max-w-5xl relative z-10 my-auto py-6">
                {/* Header */}
                <div className="text-center mb-10">
                    <div className="flex justify-center mb-5">
                        <div className="w-16 h-16 bg-gradient-to-br from-orange-500 to-amber-500 rounded-2xl flex items-center justify-center shadow-lg shadow-orange-500/25">
                            <KeyRound className="w-8 h-8 text-white" />
                        </div>
                    </div>
                    <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">SMAA ERP</h1>
                    <p className="text-neutral-400 text-sm md:text-base">
                        Selecciona tu usuario para acceder al sistema
                    </p>
                </div>

                {/* User grid */}
                {loading ? (
                    <div className="flex justify-center py-20">
                        <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
                    </div>
                ) : users.length === 0 ? (
                    <div className="bg-neutral-800/40 border border-amber-500/30 rounded-2xl p-8 text-center max-w-xl mx-auto">
                        <ShieldCheck className="w-10 h-10 text-amber-400 mx-auto mb-3" />
                        <h2 className="text-lg font-bold text-white mb-2">No hay usuarios registrados</h2>
                        <p className="text-sm text-neutral-400">
                            Crea el primer empleado ejecutando el script de seed o desde la
                            consola de Supabase. Una vez creado, aparecerá aquí.
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-4">
                        {users.map((u) => {
                            const role = ROLE_STYLES[u.role] || ROLE_STYLES.operator;
                            return (
                                <button
                                    key={u.id}
                                    onClick={() => setSelected(u)}
                                    className={cn(
                                        "group bg-neutral-800/40 hover:bg-neutral-800/80 border border-neutral-700/50 hover:border-neutral-600",
                                        "rounded-2xl p-4 flex flex-col items-center gap-3 transition-all hover:-translate-y-0.5 hover:shadow-xl",
                                        "focus:outline-none focus:ring-2", role.ring
                                    )}
                                >
                                    <Avatar user={u} />
                                    <div className="text-center min-w-0 w-full">
                                        <p className="text-sm font-semibold text-white truncate">
                                            {u.full_name}
                                        </p>
                                        {u.position && (
                                            <p className="text-[11px] text-neutral-400 truncate">
                                                {u.position}
                                            </p>
                                        )}
                                    </div>
                                    <span className={cn("text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border", role.chip)}>
                                        {role.label}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                )}

                <p className="text-center text-[11px] text-neutral-500 mt-10">
                    SMAA ERP · ISO 9001:2015
                </p>
            </div>

            {/* Password modal */}
            {selected && (
                <div
                    className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={closeModal}
                >
                    <div
                        className="bg-neutral-900 border border-neutral-700/60 rounded-3xl w-full max-w-md p-6 shadow-2xl relative"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            onClick={closeModal}
                            disabled={submitting}
                            className="absolute top-3 right-3 p-2 text-neutral-500 hover:text-white disabled:opacity-30"
                            aria-label="Cerrar"
                        >
                            <X className="w-5 h-5" />
                        </button>

                        <div className="flex flex-col items-center gap-3 mb-6">
                            <Avatar user={selected} size="xl" />
                            <div className="text-center">
                                <h2 className="text-lg font-bold text-white">{selected.full_name}</h2>
                                {selected.position && (
                                    <p className="text-xs text-neutral-400">{selected.position}</p>
                                )}
                            </div>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="block text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">
                                    Contraseña
                                </label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                                    <input
                                        ref={pwdRef}
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="Ingresa tu contraseña"
                                        className="w-full bg-neutral-800/60 border border-neutral-700 rounded-xl py-3 pl-10 pr-3 text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 transition-all"
                                        autoComplete="current-password"
                                    />
                                </div>
                                {error && (
                                    <p className="mt-2 text-xs text-rose-400 text-center">{error}</p>
                                )}
                            </div>

                            <button
                                type="submit"
                                disabled={submitting || !password}
                                className="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-white py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2"
                            >
                                {submitting ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <>
                                        <LogIn className="w-4 h-4" />
                                        Ingresar
                                        <ArrowRight className="w-4 h-4" />
                                    </>
                                )}
                            </button>

                            <button
                                type="button"
                                onClick={closeModal}
                                disabled={submitting}
                                className="w-full text-neutral-400 hover:text-white py-2 rounded-xl text-xs font-medium transition-colors disabled:opacity-30"
                            >
                                Cambiar de usuario
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

export default function LoginPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
            </div>
        }>
            <LoginInner />
        </Suspense>
    );
}
