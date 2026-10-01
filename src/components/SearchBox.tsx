"use client";

import { Search, X } from "lucide-react";
import clsx from "clsx";

/** Campo de búsqueda con lupa y botón para limpiar. El filtrado lo hace quien lo usa (ver matchesSearch). */
export default function SearchBox({ value, onChange, placeholder, label, className, autoFocus }: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    label?: string;
    className?: string;
    autoFocus?: boolean;
}) {
    return (
        <div className={clsx("relative", className)}>
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
            <input
                type="text"
                aria-label={label || placeholder || "Buscar"}
                autoComplete="off"
                autoFocus={autoFocus}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape" && value) { e.stopPropagation(); onChange(""); } }}
                placeholder={placeholder || "Buscar..."}
                className="w-full bg-neutral-900/60 border border-neutral-700/50 rounded-xl pl-10 pr-9 py-2 text-sm text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-cyan-500/50"
            />
            {value && (
                <button
                    type="button"
                    onClick={() => onChange("")}
                    aria-label="Limpiar búsqueda"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white p-1 rounded-md hover:bg-neutral-700/50"
                >
                    <X className="w-3.5 h-3.5" />
                </button>
            )}
        </div>
    );
}
