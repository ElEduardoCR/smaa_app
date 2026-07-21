"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2, Minimize2, X, Download, Loader2, FileText } from "lucide-react";
import clsx from "clsx";

// Lazy-load pdfjs on the client only (it touches DOM and uses workers)
let pdfjs: any | null = null;
async function getPdfjs() {
    if (pdfjs) return pdfjs;
    const lib = await import("pdfjs-dist");
    // Use the worker bundled with the package (we set it from public/ in the layout or copy it)
    // pdfjs can use a fake worker with disableWorker too, but we want a real one for speed.
    const workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    lib.GlobalWorkerOptions.workerSrc = workerSrc;
    pdfjs = lib;
    return lib;
}

type Props = {
    url: string;
    fileName?: string;
    onClose?: () => void;
};

export default function PdfViewer({ url, fileName, onClose }: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const renderTaskRef = useRef<any>(null);
    const [pdf, setPdf] = useState<any>(null);
    const [pageNum, setPageNum] = useState(1);
    const [numPages, setNumPages] = useState(0);
    const [scale, setScale] = useState(1.0);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                setLoading(true);
                setError(null);
                const lib = await getPdfjs();
                const loadingTask = lib.getDocument({ url, withCredentials: false });
                const doc = await loadingTask.promise;
                if (cancelled) return;
                setPdf(doc);
                setNumPages(doc.numPages);
                setPageNum(1);
            } catch (e: any) {
                console.error("PdfViewer load error", e);
                if (!cancelled) setError(e?.message || "No se pudo cargar el PDF");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [url]);

    // Render current page
    useEffect(() => {
        if (!pdf || !canvasRef.current) return;
        let cancelled = false;
        (async () => {
            try {
                if (renderTaskRef.current) {
                    try { await renderTaskRef.current.cancel(); } catch {}
                    renderTaskRef.current = null;
                }
                const page = await pdf.getPage(pageNum);
                if (cancelled) return;
                const containerWidth = containerRef.current?.clientWidth || 600;
                const containerHeight = containerRef.current?.clientHeight || 800;
                const baseViewport = page.getViewport({ scale: 1 });
                const fitScale = Math.min(
                    (containerWidth - 32) / baseViewport.width,
                    (containerHeight - 32) / baseViewport.height
                );
                const finalScale = Math.max(0.4, fitScale * scale);
                const viewport = page.getViewport({ scale: finalScale });

                const canvas = canvasRef.current!;
                const ctx = canvas.getContext("2d");
                if (!ctx) return;
                const dpr = window.devicePixelRatio || 1;
                canvas.width = viewport.width * dpr;
                canvas.height = viewport.height * dpr;
                canvas.style.width = `${viewport.width}px`;
                canvas.style.height = `${viewport.height}px`;
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

                const task = page.render({ canvasContext: ctx, viewport });
                renderTaskRef.current = task;
                await task.promise;
            } catch (e: any) {
                if (e?.name !== "RenderingCancelledException") {
                    console.error("Pdf render error", e);
                }
            }
        })();
        return () => { cancelled = true; };
    }, [pdf, pageNum, scale]);

    const zoomIn  = () => setScale(s => Math.min(3, s + 0.2));
    const zoomOut = () => setScale(s => Math.max(0.4, s - 0.2));
    const reset   = () => setScale(1);

    return (
        <div
            ref={containerRef}
            className={clsx(
                "flex flex-col bg-neutral-900/60 rounded-2xl border border-neutral-700/50 overflow-hidden",
                isFullscreen ? "fixed inset-4 z-50" : "h-full w-full"
            )}
        >
            {/* Toolbar */}
            <div className="flex items-center gap-2 px-3 py-2 bg-neutral-800/60 border-b border-neutral-700/50 text-sm">
                <FileText className="w-4 h-4 text-orange-400 flex-shrink-0" />
                <span className="text-neutral-200 truncate flex-1 font-medium" title={fileName || url}>
                    {fileName || "Documento PDF"}
                </span>
                {numPages > 0 && (
                    <div className="flex items-center gap-1 text-neutral-400">
                        <button
                            onClick={() => setPageNum(p => Math.max(1, p - 1))}
                            disabled={pageNum <= 1}
                            className="p-1.5 rounded-lg hover:bg-neutral-700 disabled:opacity-30 transition-colors"
                            title="Página anterior"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span className="text-xs tabular-nums">
                            {pageNum} / {numPages}
                        </span>
                        <button
                            onClick={() => setPageNum(p => Math.min(numPages, p + 1))}
                            disabled={pageNum >= numPages}
                            className="p-1.5 rounded-lg hover:bg-neutral-700 disabled:opacity-30 transition-colors"
                            title="Página siguiente"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                )}
                <div className="flex items-center gap-1 ml-1 border-l border-neutral-700 pl-2">
                    <button onClick={zoomOut} className="p-1.5 rounded-lg hover:bg-neutral-700 text-neutral-300 transition-colors" title="Zoom -">
                        <ZoomOut className="w-4 h-4" />
                    </button>
                    <button onClick={reset} className="px-2 py-1 text-xs rounded-lg hover:bg-neutral-700 text-neutral-400 tabular-nums transition-colors" title="Reset zoom">
                        {Math.round(scale * 100)}%
                    </button>
                    <button onClick={zoomIn} className="p-1.5 rounded-lg hover:bg-neutral-700 text-neutral-300 transition-colors" title="Zoom +">
                        <ZoomIn className="w-4 h-4" />
                    </button>
                </div>
                <a href={url} download target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-lg hover:bg-neutral-700 text-neutral-300 transition-colors" title="Descargar">
                    <Download className="w-4 h-4" />
                </a>
                <button onClick={() => setIsFullscreen(f => !f)} className="p-1.5 rounded-lg hover:bg-neutral-700 text-neutral-300 transition-colors" title={isFullscreen ? "Salir" : "Pantalla completa"}>
                    {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>
                {onClose && (
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-red-500/20 text-neutral-300 hover:text-red-400 transition-colors" title="Cerrar">
                        <X className="w-4 h-4" />
                    </button>
                )}
            </div>

            {/* Canvas area */}
            <div className="flex-1 overflow-auto bg-neutral-950/80 flex items-center justify-center p-2 min-h-0">
                {loading && (
                    <div className="flex flex-col items-center text-neutral-400">
                        <Loader2 className="w-6 h-6 animate-spin text-orange-400 mb-2" />
                        <span className="text-xs">Cargando PDF…</span>
                    </div>
                )}
                {error && (
                    <div className="text-center text-red-400 text-sm p-6">
                        <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p>No se pudo mostrar el PDF.</p>
                        <a href={url} target="_blank" rel="noopener noreferrer" className="text-orange-400 underline text-xs mt-1 inline-block">Abrir en nueva pestaña</a>
                    </div>
                )}
                {!loading && !error && (
                    <canvas ref={canvasRef} className="shadow-2xl" />
                )}
            </div>
        </div>
    );
}
