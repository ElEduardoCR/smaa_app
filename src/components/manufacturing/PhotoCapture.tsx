"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Image as ImageIcon, X, RefreshCw, MapPin, AlertTriangle, Check, Upload } from "lucide-react";
import clsx from "clsx";
import exifr from "exifr";

type Geo = { lat: number; lng: number; accuracy?: number; source: "exif" | "browser" | "unknown" };
type Props = {
    /** Called with the captured File + its GPS coordinates (if any). */
    onCapture: (file: File, geo: Geo | null) => void;
    /** Whether to use the device camera UI for taking a fresh photo. */
    allowCamera?: boolean;
    label?: string;
    accept?: string;
};

/**
 * Photo capture that:
 *  - reads GPS from EXIF (when uploading from gallery)
 *  - falls back to browser geolocation API (when the user grants permission)
 *  - shows the result + a little "where was this taken" hint so people can't easily lie
 */
export default function PhotoCapture({
    onCapture,
    allowCamera = true,
    label = "Subir o tomar foto",
    accept = "image/*",
}: Props) {
    const [preview, setPreview] = useState<string | null>(null);
    const [file, setFile] = useState<File | null>(null);
    const [geo, setGeo] = useState<Geo | null>(null);
    const [busy, setBusy] = useState(false);
    const [mode, setMode] = useState<"idle" | "camera" | "gallery">("idle");
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const galleryInputRef = useRef<HTMLInputElement>(null);
    const cameraInputRef = useRef<HTMLInputElement>(null);

    // Read EXIF GPS off a File
    const readExifGps = async (f: File): Promise<Geo | null> => {
        try {
            const data = await exifr.parse(f, { gps: true });
            if (data && typeof data.latitude === "number" && typeof data.longitude === "number") {
                return {
                    lat: data.latitude,
                    lng: data.longitude,
                    source: "exif",
                };
            }
        } catch (e) {
            // exifr throws on files without EXIF — that's fine
        }
        return null;
    };

    // Browser geolocation fallback (only when the user clicks "use my location")
    const getBrowserGps = (): Promise<Geo | null> =>
        new Promise((resolve) => {
            if (!("geolocation" in navigator)) return resolve(null);
            navigator.geolocation.getCurrentPosition(
                (pos) => resolve({
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                    accuracy: pos.coords.accuracy,
                    source: "browser",
                }),
                () => resolve(null),
                { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
            );
        });

    const handleFile = async (f: File) => {
        setBusy(true);
        try {
            setFile(f);
            setPreview(URL.createObjectURL(f));
            const exif = await readExifGps(f);
            if (exif) {
                setGeo(exif);
            } else {
                // Try browser geolocation as a backup signal
                const browser = await getBrowserGps();
                setGeo(browser);
            }
        } finally {
            setBusy(false);
        }
    };

    // Live camera stream
    const startCamera = async () => {
        setMode("camera");
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: "environment" },
                audio: false,
            });
            streamRef.current = stream;
            // Wait a tick for the video element to mount
            setTimeout(() => {
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    videoRef.current.play().catch(() => {});
                }
            }, 50);
        } catch (e: any) {
            alert("No se pudo acceder a la cámara: " + (e?.message || e));
            setMode("idle");
        }
    };
    const stopCamera = () => {
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        setMode("idle");
    };
    useEffect(() => () => stopCamera(), []);

    const snapFromCamera = async () => {
        if (!videoRef.current) return;
        setBusy(true);
        const v = videoRef.current;
        const c = document.createElement("canvas");
        c.width = v.videoWidth;
        c.height = v.videoHeight;
        c.getContext("2d")?.drawImage(v, 0, 0);
        const blob: Blob | null = await new Promise((res) => c.toBlob(b => res(b), "image/jpeg", 0.92));
        if (!blob) { setBusy(false); return; }
        const f = new File([blob], `capture_${Date.now()}.jpg`, { type: "image/jpeg" });
        await handleFile(f);
        stopCamera();
        setBusy(false);
    };

    const acceptAndSend = async () => {
        if (!file) return;
        // Always try to attach browser geolocation on confirm, in case EXIF was missing
        let finalGeo = geo;
        if (!finalGeo) {
            finalGeo = await getBrowserGps();
        }
        onCapture(file, finalGeo);
        // reset
        setPreview(null);
        setFile(null);
        setGeo(null);
    };

    const cancelPreview = () => {
        setPreview(null);
        setFile(null);
        setGeo(null);
    };

    return (
        <div className="flex flex-col gap-2">
            {/* Idle: choose source */}
            {mode === "idle" && !preview && (
                <div className="flex flex-wrap items-center gap-2">
                    {allowCamera && (
                        <>
                            <button
                                type="button"
                                onClick={startCamera}
                                className="text-sm flex items-center gap-1.5 text-orange-300 bg-orange-500/10 hover:bg-orange-500/20 px-3 py-2 rounded-lg border border-orange-500/20 transition-colors"
                            >
                                <Camera className="w-4 h-4" /> Tomar foto
                            </button>
                            <input
                                ref={cameraInputRef}
                                type="file"
                                accept="image/*"
                                capture="environment"
                                className="hidden"
                                onChange={async (e) => {
                                    const f = e.target.files?.[0];
                                    if (f) await handleFile(f);
                                    e.target.value = "";
                                }}
                            />
                            <button
                                type="button"
                                onClick={() => cameraInputRef.current?.click()}
                                className="text-sm flex items-center gap-1.5 text-orange-300 bg-orange-500/10 hover:bg-orange-500/20 px-3 py-2 rounded-lg border border-orange-500/20 transition-colors md:hidden"
                            >
                                <Camera className="w-4 h-4" /> Móvil
                            </button>
                        </>
                    )}
                    <button
                        type="button"
                        onClick={() => galleryInputRef.current?.click()}
                        className="text-sm flex items-center gap-1.5 text-neutral-300 bg-neutral-800 hover:bg-neutral-700 px-3 py-2 rounded-lg border border-neutral-700 transition-colors"
                    >
                        <ImageIcon className="w-4 h-4" /> Subir de galería
                    </button>
                    <input
                        ref={galleryInputRef}
                        type="file"
                        accept={accept}
                        className="hidden"
                        onChange={async (e) => {
                            const f = e.target.files?.[0];
                            if (f) await handleFile(f);
                            e.target.value = "";
                        }}
                    />
                    {label && <span className="text-xs text-neutral-500 ml-1">{label}</span>}
                </div>
            )}

            {/* Camera live view */}
            {mode === "camera" && (
                <div className="bg-neutral-900/70 rounded-xl border border-neutral-700/50 p-3 space-y-2">
                    <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className="rounded-lg w-full max-h-[60vh] object-contain bg-black"
                    />
                    <div className="flex items-center gap-2 justify-end">
                        <button
                            type="button"
                            onClick={stopCamera}
                            className="text-sm flex items-center gap-1.5 text-neutral-300 bg-neutral-800 hover:bg-neutral-700 px-3 py-2 rounded-lg border border-neutral-700 transition-colors"
                        >
                            <X className="w-4 h-4" /> Cancelar
                        </button>
                        <button
                            type="button"
                            onClick={snapFromCamera}
                            disabled={busy}
                            className="text-sm flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
                        >
                            <Camera className="w-4 h-4" /> Capturar
                        </button>
                    </div>
                </div>
            )}

            {/* Preview + GPS */}
            {preview && (
                <div className="bg-neutral-900/70 rounded-xl border border-neutral-700/50 p-3 space-y-3">
                    <div className="relative">
                        <img src={preview} alt="preview" className="rounded-lg w-full max-h-[60vh] object-contain bg-black" />
                        <button
                            type="button"
                            onClick={cancelPreview}
                            className="absolute top-2 right-2 p-1.5 rounded-lg bg-neutral-900/80 hover:bg-red-500/30 text-neutral-200 hover:text-red-300 border border-neutral-700 transition-colors"
                            title="Descartar"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    <div className={clsx(
                        "rounded-lg px-3 py-2 text-xs flex items-center gap-2",
                        geo
                            ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-300"
                            : "bg-amber-500/10 border border-amber-500/30 text-amber-300"
                    )}>
                        {geo ? (
                            <>
                                <MapPin className="w-4 h-4 flex-shrink-0" />
                                <span className="flex-1">
                                    <strong>Ubicación capturada:</strong>{" "}
                                    {geo.lat.toFixed(6)}, {geo.lng.toFixed(6)}
                                    {geo.accuracy ? ` (±${Math.round(geo.accuracy)} m)` : ""}{" "}
                                    <span className="text-neutral-400">— fuente: {geo.source === "exif" ? "datos EXIF de la foto" : geo.source === "browser" ? "ubicación del dispositivo" : ""}</span>
                                </span>
                            </>
                        ) : (
                            <>
                                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                                <span className="flex-1">
                                    <strong>Sin ubicación:</strong> la foto no trae EXIF con GPS y el dispositivo negó el permiso. La marca de tiempo del servidor quedará registrada.
                                </span>
                            </>
                        )}
                    </div>

                    <div className="flex items-center gap-2 justify-end">
                        <button
                            type="button"
                            onClick={cancelPreview}
                            className="text-sm flex items-center gap-1.5 text-neutral-300 bg-neutral-800 hover:bg-neutral-700 px-3 py-2 rounded-lg border border-neutral-700 transition-colors"
                        >
                            <RefreshCw className="w-4 h-4" /> Cambiar
                        </button>
                        <button
                            type="button"
                            onClick={acceptAndSend}
                            disabled={busy}
                            className="text-sm flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
                        >
                            <Upload className="w-4 h-4" /> Usar esta foto
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
