"use client";

import { useEffect, useRef, useState } from "react";
import { Eraser, Check, X, PenLine } from "lucide-react";
import clsx from "clsx";

type Props = {
    onSave: (dataUrl: string) => Promise<void> | void;
    onCancel?: () => void;
    width?: number;
    height?: number;
    label?: string;
    saving?: boolean;
    color?: string;       // stroke color
    savingLabel?: string; // e.g. "Firmando…"
    saveLabel?: string;   // e.g. "Firmar y liberar"
};

/**
 * Hand-rolled signature pad. Touch + mouse + pen, smooth stroke,
 * uploads as PNG with transparent background.
 */
export default function SignaturePad({
    onSave,
    onCancel,
    width = 560,
    height = 220,
    label = "Firma aquí con el dedo, stylus o mouse",
    saving = false,
    color = "#f97316",
    savingLabel = "Guardando…",
    saveLabel = "Guardar firma",
}: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawing = useRef(false);
    const last = useRef<{ x: number; y: number } | null>(null);
    const [isEmpty, setIsEmpty] = useState(true);

    // Init canvas
    useEffect(() => {
        const c = canvasRef.current;
        if (!c) return;
        const ratio = window.devicePixelRatio || 1;
        c.width = width * ratio;
        c.height = height * ratio;
        c.style.width = `${width}px`;
        c.style.height = `${height}px`;
        const ctx = c.getContext("2d");
        if (!ctx) return;
        ctx.scale(ratio, ratio);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.4;
        ctx.fillStyle = "rgba(0,0,0,0)";
        ctx.fillRect(0, 0, width, height);
    }, [width, height, color]);

    const getXY = (e: PointerEvent | React.PointerEvent) => {
        const c = canvasRef.current!;
        const r = c.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
        // Don't preventDefault here: react-three-fiber's canvas would lose
        // context otherwise, but this is a plain canvas, so safe.
        e.preventDefault();
        (e.target as Element).setPointerCapture(e.pointerId);
        drawing.current = true;
        last.current = getXY(e);
        setIsEmpty(false);
        // Draw a dot so a tiny tap registers
        const ctx = canvasRef.current!.getContext("2d")!;
        ctx.beginPath();
        ctx.arc(last.current.x, last.current.y, 1.2, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
    };
    const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!drawing.current) return;
        e.preventDefault();
        const p = getXY(e);
        const ctx = canvasRef.current!.getContext("2d")!;
        if (last.current) {
            ctx.beginPath();
            ctx.moveTo(last.current.x, last.current.y);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
        }
        last.current = p;
    };
    const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
        drawing.current = false;
        last.current = null;
        try { (e.target as Element).releasePointerCapture(e.pointerId); } catch {}
    };

    const clear = () => {
        const c = canvasRef.current!;
        const ctx = c.getContext("2d")!;
        ctx.clearRect(0, 0, c.width, c.height);
        setIsEmpty(true);
    };

    const save = async () => {
        if (isEmpty) return;
        const c = canvasRef.current!;
        const dataUrl = c.toDataURL("image/png");
        await onSave(dataUrl);
    };

    return (
        <div className="flex flex-col gap-2">
            <div className="bg-neutral-900/60 rounded-xl border border-neutral-700/50 p-2 inline-block">
                <canvas
                    ref={canvasRef}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    onPointerLeave={onPointerUp}
                    className="rounded-lg touch-none cursor-crosshair bg-[radial-gradient(circle,#1f2937_1px,transparent_1px)] [background-size:14px_14px]"
                    style={{ width, height, touchAction: "none", userSelect: "none" }}
                />
            </div>
            <p className="text-xs text-neutral-500 flex items-center gap-1.5">
                <PenLine className="w-3.5 h-3.5" /> {label}
            </p>
            <div className="flex items-center gap-2 mt-1">
                <button
                    type="button"
                    onClick={clear}
                    className="text-sm flex items-center gap-1.5 text-neutral-300 bg-neutral-800 hover:bg-neutral-700 px-3 py-2 rounded-lg border border-neutral-700 transition-colors"
                >
                    <Eraser className="w-4 h-4" /> Limpiar
                </button>
                {onCancel && (
                    <button
                        type="button"
                        onClick={onCancel}
                        className="text-sm flex items-center gap-1.5 text-neutral-300 bg-neutral-800 hover:bg-neutral-700 px-3 py-2 rounded-lg border border-neutral-700 transition-colors"
                    >
                        <X className="w-4 h-4" /> Cancelar
                    </button>
                )}
                <div className="flex-1" />
                <button
                    type="button"
                    onClick={save}
                    disabled={isEmpty || saving}
                    className="text-sm flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 disabled:bg-neutral-700 disabled:text-neutral-500 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                >
                    <Check className="w-4 h-4" /> {saving ? savingLabel : saveLabel}
                </button>
            </div>
        </div>
    );
}
