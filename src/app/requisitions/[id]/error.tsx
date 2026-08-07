"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, RefreshCw, Home } from "lucide-react";

/**
 * Error boundary para el detalle de una requisición.
 *
 * Cubre dos casos típicos:
 *  1) El server component de la página no pudo cargar la requisición
 *     (FK con nombre distinto, RLS restrictiva, registro borrado, etc.).
 *  2) Una server action posterior a `revalidatePath` (`router.refresh()`)
 *     dejó al Server Component en un estado inconsistente.
 *
 * Antes de este boundary, el usuario solo veía el mensaje genérico de
 * Next.js ("An error occurred in the Server Components render…"). Ahora
 * ve el digest + el mensaje real, con opciones para reintentar o volver
 * a la lista sin perder lo que ya hizo.
 */
export default function RequisitionDetailError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        // Log al server (en prod llega a Vercel) y a la consola del browser
        // para que el admin pueda copiar el digest al reportar.
        console.error("[requisitions/[id]] error boundary:", error);
    }, [error]);

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 font-[family-name:var(--font-sans)] flex items-center justify-center p-4">
            <div className="w-full max-w-xl bg-neutral-800/40 border border-rose-500/30 rounded-2xl p-6 space-y-4">
                <div className="flex items-center gap-2">
                    <AlertCircle className="w-6 h-6 text-rose-400" />
                    <h1 className="text-lg font-bold text-white">No se pudo cargar la requisición</h1>
                </div>
                <p className="text-sm text-neutral-300">
                    Algo falló al renderizar esta vista. El error ya se registró — puedes reintentar
                    o volver a la lista para continuar con otra requisición.
                </p>
                <pre className="bg-neutral-900/60 border border-neutral-700/60 rounded-xl p-3 text-[11px] text-neutral-300 overflow-x-auto whitespace-pre-wrap break-words max-h-48">
                    {error.message}
                    {error.digest ? `\n\nDigest: ${error.digest}` : ""}
                </pre>
                <div className="flex items-center gap-2 pt-1">
                    <button
                        onClick={() => reset()}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-orange-500/15 hover:bg-orange-500/25 text-orange-200 border border-orange-500/30 text-sm font-medium"
                    >
                        <RefreshCw className="w-3.5 h-3.5" /> Reintentar
                    </button>
                    <Link
                        href="/requisitions"
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-neutral-800/60 hover:bg-neutral-800 text-neutral-200 border border-neutral-700/50 text-sm font-medium"
                    >
                        <ArrowLeft className="w-3.5 h-3.5" /> Volver a requisiciones
                    </Link>
                    <Link
                        href="/"
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-neutral-400 hover:text-white text-sm"
                    >
                        <Home className="w-3.5 h-3.5" /> Inicio
                    </Link>
                </div>
            </div>
        </div>
    );
}
