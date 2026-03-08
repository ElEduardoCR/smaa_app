"use client";

import { useState } from "react";
import { Lock, ArrowRight, Loader2, KeyRound } from "lucide-react";
import { loginAction } from "@/app/actions/auth";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

function LoginForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const redirectUrl = searchParams.get('redirect') || '/';

    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    let moduleName = "el Sistema Voxa";
    if (redirectUrl.startsWith('/purchases')) moduleName = "Compras";
    if (redirectUrl.startsWith('/sales')) moduleName = "Ventas";
    if (redirectUrl.startsWith('/settings')) moduleName = "Configuración";
    if (redirectUrl.startsWith('/manufacturing/new')) moduleName = "Fabricación";

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsLoading(true);

        try {
            const result = await loginAction(password, redirectUrl);
            if (result.success && result.redirectTo) {
                router.push(result.redirectTo);
                router.refresh();
            } else {
                setError(result.error || "Error al iniciar sesión.");
            }
        } catch (err: any) {
            setError(err.message || "Error inesperado.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#0B1120] text-slate-200 flex items-center justify-center p-6 font-[family-name:var(--font-sans)] relative overflow-hidden">
            {/* Background elements */}
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-violet-500/10 rounded-full blur-[120px] mix-blend-screen pointer-events-none"></div>
            <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-[120px] mix-blend-screen pointer-events-none"></div>

            <div className="w-full max-w-md bg-slate-800/40 p-10 rounded-[2rem] border border-slate-700/50 backdrop-blur-xl shadow-2xl relative z-10">
                <div className="flex justify-center mb-8">
                    <div className="w-16 h-16 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-2xl flex items-center justify-center shadow-lg shadow-violet-500/25">
                        <KeyRound className="w-8 h-8 text-white" />
                    </div>
                </div>

                <div className="text-center mb-10">
                    <h1 className="text-3xl font-bold text-white mb-2">Voxa ERP</h1>
                    <p className="text-slate-400 text-sm">
                        Ingresa la clave para acceder a <strong className="text-white">{moduleName}</strong>
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <div className="relative">
                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Contraseña de acceso"
                                className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-4 pl-12 pr-4 text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-all font-mono"
                                autoFocus
                            />
                        </div>
                        {error && (
                            <p className="mt-3 text-sm text-red-400 text-center animate-pulse">{error}</p>
                        )}
                    </div>

                    <button
                        type="submit"
                        disabled={isLoading || !password}
                        className="w-full bg-violet-500 hover:bg-violet-600 disabled:opacity-50 disabled:cursor-not-allowed text-white py-4 rounded-xl font-bold transition-all shadow-[0_0_15px_rgba(139,92,246,0.2)] hover:shadow-[0_0_20px_rgba(139,92,246,0.4)] flex items-center justify-center gap-2 group"
                    >
                        {isLoading ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                            <>
                                Acceder
                                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                            </>
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
}

export default function LoginPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-violet-500 animate-spin" />
            </div>
        }>
            <LoginForm />
        </Suspense>
    );
}
