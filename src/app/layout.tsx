import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { decrypt } from "@/lib/session";
import { ALL_MODULES, isModuleVisible } from "@/lib/navModules";
import AppShell, { type ShellUser, type ShellModule } from "@/components/AppShell";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SMAA ERP",
  description: "SMAA ERP App",
  icons: {
    icon: "/browser.png",
    shortcut: "/Android.png",
    apple: "/iPhone.png",
  },
};

// Fija el tema antes del primer pintado para que no haya "flash" de blanco.
// Preferencia guardada > preferencia del sistema > claro.
const THEME_INIT = `(function(){try{var t=localStorage.getItem('smaa-theme');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='light';}})();`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Sólo se lee el JWT (sin consultar la BD) para armar el menú lateral:
  // el `accessList` de la cookie ya trae los módulos accesibles, igual que
  // usa el middleware. El gateo real de cada página no cambia.
  const cookieStore = await cookies();
  const payload = await decrypt(cookieStore.get("smaa_session")?.value);

  const user: ShellUser | null = payload
    ? {
        fullName: payload.fullName,
        role: payload.role,
        position: payload.position,
        photoUrl: payload.photoUrl,
      }
    : null;

  const modules: ShellModule[] = payload
    ? ALL_MODULES.filter((m) =>
        isModuleVisible(payload.role, payload.accessList, m.moduleCode)
      ).map(({ href, short, Icon, category, badge }) => ({
        href,
        short,
        Icon,
        category,
        badge,
      }))
    : [];

  return (
    <html lang="es" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AppShell user={user} modules={modules}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
