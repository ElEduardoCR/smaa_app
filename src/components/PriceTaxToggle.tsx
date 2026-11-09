"use client";

export default function PriceTaxToggle({ includesVat, onChange, disabled = false, label = "Precio incluye IVA" }: {
    includesVat: boolean;
    onChange: (includesVat: boolean) => void;
    disabled?: boolean;
    label?: string;
}) {
    return (
        <button type="button" aria-pressed={includesVat} disabled={disabled}
            onClick={() => onChange(!includesVat)}
            className="rounded-lg border border-neutral-600 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 disabled:opacity-50">
            {label}: <strong>{includesVat ? "Sí" : "No"}</strong>
        </button>
    );
}
