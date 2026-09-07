"use client";

// ===========================================================================
// App shell: menú fijo a la izquierda + contenido a la derecha.
//
// Es un componente puramente de presentación. Los módulos ya vienen
// filtrados por permisos desde el layout raíz (server component); aquí sólo
// se pintan y se marca el activo según la URL.
//
// En /login y en /ar/<token> (portal público de clientes) no se pinta chrome.
// ===========================================================================

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    Users, LogOut, BarChart3, Receipt, ShieldCheck, Cog, Wallet, BookOpen,
    History, Factory, Truck, ClipboardList, UserCog, ShieldAlert, Layers,
    ShoppingCart, LayoutGrid, Menu, X, Sun, Moon,
} from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import { CATEGORIES, type ModuleCategory } from "@/lib/navModules";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
    Users, BarChart3, Receipt, ShieldCheck, Cog, Wallet, BookOpen, History,
    Factory, Truck, ClipboardList, UserCog, ShieldAlert, Layers, ShoppingCart,
};

export type ShellUser = {
    fullName: string;
    role: string;
    position: string | null;
    photoUrl: string | null;
};

export type ShellModule = {
    href: string;
    short: string;
    Icon: string;
    category: ModuleCategory;
    badge?: string;
};

const ROLE_LABEL: Record<string, string> = {
    master: "Master",
    admin: "Administrador",
    operator: "Operador",
};

function initials(name: string) {
    return name.trim().split(/\s+/).slice(0, 2)
        .map((p) => p[0]?.toUpperCase() || "").join("");
}

/** Ruta activa = el href más largo que sea prefijo del pathname. */
function activeHref(pathname: string, hrefs: string[]): string | null {
    let best: string | null = null;
    for (const href of hrefs) {
        const match = href === "/"
            ? pathname === "/"
            : pathname === href || pathname.startsWith(href + "/");
        if (match && (best === null || href.length > best.length)) best = href;
    }
    return best;
}

// El icono lo decide el CSS a partir de [data-theme], así no hace falta
// estado en React (ni desajustes de hidratación con el script del <head>).
function ThemeToggle() {
    return (
        <button
            type="button"
            className="app-icon-btn app-theme-toggle"
            title="Cambiar entre tema claro y oscuro"
            aria-label="Cambiar entre tema claro y oscuro"
            onClick={() => {
                const root = document.documentElement;
                const next = root.dataset.theme === "dark" ? "light" : "dark";
                root.dataset.theme = next;
                try { localStorage.setItem("smaa-theme", next); } catch { /* modo privado */ }
            }}
        >
            <Sun className="app-theme-sun" />
            <Moon className="app-theme-moon" />
        </button>
    );
}

export default function AppShell({
    user,
    modules,
    children,
}: {
    user: ShellUser | null;
    modules: ShellModule[];
    children: React.ReactNode;
}) {
    const pathname = usePathname() || "/";
    const [open, setOpen] = useState(false);

    const bare = !user || pathname === "/login" || pathname.startsWith("/ar/");
    if (bare) return <>{children}</>;

    const active = activeHref(pathname, ["/", ...modules.map((m) => m.href)]);

    return (
        <div className="app-shell">
            {/* Barra superior — sólo móvil/tablet */}
            <div className="app-topbar">
                <button
                    type="button"
                    className="app-icon-btn"
                    onClick={() => setOpen(true)}
                    aria-label="Abrir menú"
                >
                    <Menu />
                </button>
                <span className="app-brand-name">SMAA ERP</span>
                <div style={{ marginLeft: "auto" }}><ThemeToggle /></div>
            </div>

            {open && <div className="app-scrim" onClick={() => setOpen(false)} />}

            <aside className="app-sidebar" data-open={open ? "true" : "false"}>
                <div className="app-brand">
                    <div className="app-brand-mark"><Factory className="w-[18px] h-[18px]" /></div>
                    <div style={{ minWidth: 0 }}>
                        <div className="app-brand-name">SMAA ERP</div>
                        <div className="app-brand-sub">ISO 9001:2015</div>
                    </div>
                    <button
                        type="button"
                        className="app-icon-btn app-only-mobile"
                        style={{ marginLeft: "auto" }}
                        onClick={() => setOpen(false)}
                        aria-label="Cerrar menú"
                    >
                        <X />
                    </button>
                </div>

                {/* Al pulsar cualquier enlace se cierra el cajón (sólo aplica en móvil). */}
                <nav className="app-nav" onClick={() => setOpen(false)}>
                    <div className="app-nav-group">
                        <Link href="/" className="app-nav-item" data-active={active === "/"}>
                            <LayoutGrid /> Inicio
                        </Link>
                    </div>

                    {CATEGORIES.map((cat) => {
                        const items = modules.filter((m) => m.category === cat.name);
                        if (items.length === 0) return null;
                        return (
                            <div className="app-nav-group" key={cat.name}>
                                <div className="app-nav-label">{cat.name}</div>
                                {items.map((m) => {
                                    const Icon = ICONS[m.Icon] || Layers;
                                    return (
                                        <Link
                                            key={m.href}
                                            href={m.href}
                                            className="app-nav-item"
                                            data-active={active === m.href}
                                        >
                                            <Icon />
                                            <span className="truncate">{m.short}</span>
                                            {m.badge && <span className="app-nav-badge">{m.badge}</span>}
                                        </Link>
                                    );
                                })}
                            </div>
                        );
                    })}
                </nav>

                <div className="app-user">
                    {user.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={user.photoUrl} alt={user.fullName} className="app-avatar" />
                    ) : (
                        <div className="app-avatar">{initials(user.fullName)}</div>
                    )}
                    <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="app-user-name">{user.fullName}</div>
                        <div className="app-user-role">
                            {user.position || ROLE_LABEL[user.role] || user.role}
                        </div>
                    </div>
                    <ThemeToggle />
                    <button
                        type="button"
                        className="app-icon-btn"
                        data-danger="true"
                        title="Cerrar sesión"
                        aria-label="Cerrar sesión"
                        onClick={async () => {
                            await logoutAction();
                            window.location.href = "/login";
                        }}
                    >
                        <LogOut />
                    </button>
                </div>
            </aside>

            <div className="app-main">{children}</div>
        </div>
    );
}
