"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export default function HorizontalTableScroll({ children, label }: { children: ReactNode; label: string }) {
    const viewport = useRef<HTMLDivElement>(null);
    const regionId = useId();
    const [position, setPosition] = useState({ left: 0, max: 0 });

    useEffect(() => {
        const element = viewport.current;
        if (!element) return;
        const update = () => {
            const max = Math.max(0, element.scrollWidth - element.clientWidth);
            setPosition({ left: Math.max(0, Math.min(element.scrollLeft, max)), max });
        };
        const observer = new ResizeObserver(update);
        observer.observe(element);
        if (element.firstElementChild) observer.observe(element.firstElementChild);
        element.addEventListener("scroll", update, { passive: true });
        update();
        return () => {
            observer.disconnect();
            element.removeEventListener("scroll", update);
        };
    }, []);

    const scrollTo = (left: number) => {
        if (viewport.current) viewport.current.scrollLeft = left;
    };
    const buttonClass = "inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-neutral-700 bg-neutral-800 px-2 text-neutral-300 hover:bg-neutral-700 disabled:opacity-40";

    return <div className="min-w-0 max-w-full">
        {position.max > 0 && <div className="flex flex-wrap items-center gap-2 border-b border-neutral-700/50 bg-neutral-900 px-3 py-2 sm:px-6">
            <span className="text-xs text-neutral-400">Desliza para ver más columnas</span>
            <div className="flex min-w-40 flex-1 items-center gap-2">
                <button type="button" className={buttonClass} aria-label="Desplazar columnas a la izquierda" aria-controls={regionId}
                    disabled={position.left <= 0} onClick={() => scrollTo(position.left - (viewport.current?.clientWidth || 300) * 0.75)}>
                    <ChevronLeft className="h-4 w-4" />
                </button>
                <input type="range" min={0} max={position.max} step="any" value={position.left}
                    aria-label={`Desplazamiento horizontal de ${label}`} aria-controls={regionId}
                    aria-valuetext={`${Math.round(position.left / position.max * 100)}%`}
                    onChange={event => scrollTo(Number(event.target.value))}
                    className="h-9 w-full min-w-16 cursor-pointer accent-orange-600" />
                <button type="button" className={buttonClass} aria-label="Desplazar columnas a la derecha" aria-controls={regionId}
                    disabled={position.left >= position.max - 1} onClick={() => scrollTo(position.left + (viewport.current?.clientWidth || 300) * 0.75)}>
                    <ChevronRight className="h-4 w-4" />
                </button>
            </div>
            <button type="button" className={`${buttonClass} text-xs font-medium`} aria-controls={regionId}
                onClick={() => scrollTo(position.max)}>Ver acciones</button>
        </div>}
        <div ref={viewport} id={regionId} role="region" aria-label={label} tabIndex={0} className="max-w-full overflow-x-auto">
            {children}
        </div>
    </div>;
}
