"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Environment, Grid } from "@react-three/drei";
import * as THREE from "three";
import { Maximize2, Minimize2, X, RefreshCw, Loader2, Cpu, Move3d } from "lucide-react";
import clsx from "clsx";

// Use `any` for the R3F intrinsic element types so we don't have to fight React 19's
// stricter namespace. The runtime is what matters; types here are decorative.
type AnyProps = any;
const Group: any = "group";
const Mesh: any = "mesh";
const BoxGeometry: any = "boxGeometry";
const MeshStandardMaterial: any = "meshStandardMaterial";
const Color: any = "color";
const AmbientLight: any = "ambientLight";
const DirectionalLight: any = "directionalLight";

// Convert STEP / IGES → Three.js BufferGeometry using occt-import-js.
type PartProps = { fileUrl: string; autoRotate: boolean; onLoaded?: (triCount: number) => void; onError?: (msg: string) => void };
function StepPart({ fileUrl, autoRotate, onLoaded, onError }: PartProps) {
    const groupRef = useRef<THREE.Group>(null);
    const [geometries, setGeometries] = useState<THREE.BufferGeometry[] | null>(null);

    useFrame((_state: any, dt: number) => {
        if (groupRef.current && autoRotate) {
            groupRef.current.rotation.y += dt * 0.4;
        }
    });

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const mod: any = await import("occt-import-js");
                // occt-import-js loads its WASM at runtime. By default it tries to fetch it
                // from `/_next/static/chunks/occt-import-js.wasm` which doesn't exist because
                // Next/Turbopack doesn't bundle it. We copied the .wasm to /public so we can
                // tell the loader to fetch it from there.
                const occt = await mod.default({
                    locateFile: (path: string) => {
                        if (path.endsWith(".wasm")) {
                            return `${window.location.origin}/occt-import-js.wasm`;
                        }
                        return path;
                    },
                });
                const res = await fetch(fileUrl);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const buf = new Uint8Array(await res.arrayBuffer());

                // The API returns: { success, root, meshes: [...] } — NOT a flat array.
                const fileName = (fileUrl || "").toLowerCase();
                const isIges = fileName.endsWith(".igs") || fileName.endsWith(".iges");
                const result = isIges ? occt.ReadIgesFile(buf, null) : occt.ReadStepFile(buf, null);
                if (!result) throw new Error("El archivo no se pudo leer (resultado nulo).");
                if (result.success === false) {
                    throw new Error("OpenCascade no pudo parsear el archivo.");
                }
                const meshes: any[] = result.meshes || [];
                if (meshes.length === 0) {
                    throw new Error("STEP/IGES sin geometría.");
                }

                const geos: THREE.BufferGeometry[] = [];
                let totalTris = 0;
                for (const mesh of meshes) {
                    const positions = mesh.attributes?.position?.array;
                    const normals = mesh.attributes?.normal?.array;
                    const indices = mesh.index?.array;
                    if (!positions || !indices) continue;
                    const g = new THREE.BufferGeometry();
                    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
                    if (normals) {
                        g.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
                    } else {
                        g.computeVertexNormals();
                    }
                    g.setIndex(new THREE.Uint32BufferAttribute(indices, 1));
                    geos.push(g);
                    totalTris += indices.length / 3;
                }
                if (geos.length === 0) throw new Error("STEP sin triángulos extraíbles.");
                if (cancelled) return;
                setGeometries(geos);
                onLoaded?.(totalTris);
            } catch (e: any) {
                if (!cancelled) onError?.(e?.message || "No se pudo leer el archivo STEP/IGES.");
            }
        })();
        return () => { cancelled = true; };
    }, [fileUrl, onLoaded, onError]);

    if (!geometries) return null;

    return (
        <Group ref={groupRef}>
            {geometries.map((g, i) => (
                <Mesh key={i} geometry={g} castShadow receiveShadow>
                    <MeshStandardMaterial
                        color="#cbd5e1"
                        metalness={0.45}
                        roughness={0.45}
                        envMapIntensity={0.7}
                    />
                </Mesh>
            ))}
        </Group>
    );
}

// Center & scale a group of children to fit in a unit box
function FitOnLoad({ children }: { children: any }) {
    const ref = useRef<THREE.Group>(null);
    const { camera } = useThree() as any;
    useEffect(() => {
        if (!ref.current) return;
        const box = new THREE.Box3().setFromObject(ref.current);
        if (box.isEmpty()) return;
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const max = Math.max(size.x, size.y, size.z) || 1;
        const dist = max * 1.8;
        (camera as any).position.set(center.x + dist, center.y + dist * 0.7, center.z + dist);
        (camera as any).lookAt(center);
        (camera as any).near = Math.max(0.01, dist / 1000);
        (camera as any).far = dist * 50;
        (camera as any).updateProjectionMatrix();
    }, [children]);
    return <Group ref={ref}>{children}</Group>;
}

type Props = {
    fileUrl: string;
    fileName?: string;
    onClose?: () => void;
};

export default function StepViewer({ fileUrl, fileName, onClose }: Props) {
    const [loading, setLoading] = useState(true);
    const [autoRotate, setAutoRotate] = useState(true);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [triCount, setTriCount] = useState(0);
    const [err, setErr] = useState<string | null>(null);

    return (
        <div
            className={clsx(
                "flex flex-col bg-neutral-900/60 rounded-2xl border border-neutral-700/50 overflow-hidden",
                isFullscreen ? "fixed inset-4 z-50" : "h-full w-full"
            )}
        >
            {/* Toolbar */}
            <div className="flex items-center gap-2 px-3 py-2 bg-neutral-800/60 border-b border-neutral-700/50 text-sm">
                <Cpu className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                <span className="text-neutral-200 truncate flex-1 font-medium" title={fileName || fileUrl}>
                    {fileName || "Modelo 3D"}
                </span>
                {triCount > 0 && (
                    <span className="text-[10px] text-neutral-500 hidden sm:inline">
                        {triCount.toLocaleString()} triángulos
                    </span>
                )}
                <button
                    onClick={() => setAutoRotate(r => !r)}
                    className={clsx(
                        "p-1.5 rounded-lg transition-colors",
                        autoRotate ? "bg-cyan-500/20 text-cyan-300" : "hover:bg-neutral-700 text-neutral-300"
                    )}
                    title="Auto-rotar"
                >
                    <RefreshCw className="w-4 h-4" />
                </button>
                <button
                    onClick={() => setIsFullscreen(f => !f)}
                    className="p-1.5 rounded-lg hover:bg-neutral-700 text-neutral-300 transition-colors"
                    title="Pantalla completa"
                >
                    {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>
                {onClose && (
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-red-500/20 text-neutral-300 hover:text-red-400 transition-colors" title="Cerrar">
                        <X className="w-4 h-4" />
                    </button>
                )}
            </div>

            {/* Canvas */}
            <div className="relative flex-1 bg-gradient-to-br from-neutral-900 to-neutral-950 min-h-0">
                {(loading || err) && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-neutral-400 z-10 pointer-events-none">
                        {err ? (
                            <>
                                <X className="w-7 h-7 text-red-400 mb-2" />
                                <span className="text-xs text-red-300 max-w-md text-center px-4">{err}</span>
                            </>
                        ) : (
                            <>
                                <Loader2 className="w-7 h-7 animate-spin text-cyan-400 mb-2" />
                                <span className="text-xs">Procesando geometría…</span>
                            </>
                        )}
                    </div>
                )}
                <div className="absolute top-2 left-2 z-10 text-[10px] text-neutral-500 bg-neutral-900/70 backdrop-blur px-2 py-1 rounded-lg border border-neutral-700/50 pointer-events-none flex items-center gap-1">
                    <Move3d className="w-3 h-3" /> Arrastra · Rueda zoom · Doble-click para centrar
                </div>
                <Canvas
                    shadows
                    dpr={[1, 2]}
                    camera={{ position: [3, 2.5, 3], fov: 45 }}
                    gl={{ antialias: true, preserveDrawingBuffer: true }}
                >
                    <Color attach="background" args={["#0a0a0a"]} />
                    <AmbientLight intensity={0.5} />
                    <DirectionalLight
                        position={[5, 8, 5]}
                        intensity={1.2}
                        castShadow
                        shadow-mapSize-width={1024}
                        shadow-mapSize-height={1024}
                    />
                    <DirectionalLight position={[-5, 3, -5]} intensity={0.4} color="#7dd3fc" />

                    <Suspense fallback={null}>
                        <FitOnLoad>
                            <StepPart
                                fileUrl={fileUrl}
                                autoRotate={autoRotate}
                                onLoaded={() => setLoading(false)}
                                onError={(m) => { setErr(m); setLoading(false); }}
                            />
                        </FitOnLoad>
                        <Environment preset="city" />
                    </Suspense>

                    <Grid
                        args={[20, 20]}
                        cellSize={0.5}
                        cellThickness={0.5}
                        cellColor="#334155"
                        sectionSize={2.5}
                        sectionThickness={1}
                        sectionColor="#475569"
                        fadeDistance={20}
                        fadeStrength={1}
                        infiniteGrid
                        position={[0, -0.001, 0]}
                    />
                    <OrbitControls
                        makeDefault
                        enableDamping
                        dampingFactor={0.08}
                        rotateSpeed={0.8}
                        zoomSpeed={1.0}
                        panSpeed={0.6}
                        enablePan
                        screenSpacePanning
                        minDistance={0.2}
                        maxDistance={200}
                    />
                </Canvas>
            </div>
        </div>
    );
}
