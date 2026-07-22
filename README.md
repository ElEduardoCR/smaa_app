# SMAA ERP

Sistema de gestión integral para fabricación, ventas, compras, calidad, finanzas y
documentación ISO 9001:2015.

## Stack

- **Frontend + Backend**: Next.js 16 (App Router) + React 19
- **DB + Storage**: Supabase (Postgres + buckets)
- **Auth**: cookie de sesión firmada (JWT) + tabla de empleados propia
- **Estilos**: Tailwind v4
- **PDF / 3D**: jspdf, pdfjs-dist, three.js, occt-import-js

---

## Login con usuarios (a partir de esta versión)

El sistema ahora usa **usuarios individuales con contraseña personal** en lugar de
contraseñas de departamento. Cada empleado se da de alta en
**Configuración → Empleados** y el admin le asigna permisos con palomitas por
módulo y sub-módulo.

### Primer master (instalación nueva)

1. **Aplica la migración SQL** (si no lo has hecho):

   ```bash
   # Desde la raíz del proyecto:
   cat supabase/migrations/20260722150000_employees_and_requisitions.sql \
     | pbcopy
   ```

   Pega el contenido en la consola SQL de tu proyecto de Supabase y ejecútalo.

2. **Agrega `SETUP_SECRET`** a tu `.env.local`:

   ```bash
   # Genera uno seguro:
   openssl rand -hex 32
   ```

   ```env
   SETUP_SECRET=tu-secreto-de-32-bytes-hex
   ```

3. **Levanta el servidor**:

   ```bash
   npm run dev
   ```

4. **Crea el primer master** con un solo comando (con el servidor corriendo):

   ```bash
   ./scripts/setup-master.sh admin "Admin Principal" "MiClaveSegura2026"
   ```

   O manualmente con curl:

   ```bash
   curl -X POST http://localhost:3000/api/setup \
     -H "Content-Type: application/json" \
     -H "x-setup-secret: $SETUP_SECRET" \
     -d '{"username":"admin","password":"MiClaveSegura2026","full_name":"Admin Principal"}'
   ```

   El endpoint solo funciona si la tabla `employees` está vacía. Una vez creado
   el primer master, ya no se puede usar `/api/setup` otra vez (devuelve 409).

5. **Abre la app** y entra con tu usuario:

   ```
   http://localhost:3000/login
   ```

---

## Roles y permisos

### Roles disponibles

| Rol       | Descripción                                                  |
| --------- | ------------------------------------------------------------ |
| `master`  | Acceso total. Solo otro master puede crear masters.          |
| `admin`   | Gestiona empleados, requisiciones, compras.                  |
| `operator`| Operario con permisos específicos asignados por el admin.   |

### Acciones (palomitas que se asignan)

Cada combinación módulo + sub-módulo puede tener estas acciones:

- `Ver` — puede ver la sección
- `Crear` — puede crear registros nuevos
- `Editar` — puede modificar existentes
- `Eliminar` — puede borrar
- `Iniciar` / `Pausar` / `Terminar` — flujo de OT de fabricación
- `Solicitar insumos` — puede crear requisiciones
- `Convertir a compra` — puede cerrar requisiciones (admin/compras)

### Sub-módulos

Algunos módulos tienen sub-módulos. Por ejemplo, Fabricación tiene:

- `Maquinado`
- `Soldadura`
- `Automatización`

El admin decide a cuáles sub-módulos tiene acceso cada empleado.

---

## Módulo de Requisiciones

Operadores con permiso `Solicitar insumos` pueden crear requisiciones con:

- Múltiples artículos (descripción, cantidad, unidad, notas)
- Proveedor sugerido (del catálogo o libre)
- Prioridad y fecha en que se necesita
- Cotizaciones adjuntas (opcional)

Los usuarios con permiso `Convertir a compra` (administración) cierran la
requisición cuando ya se compró el material, adjuntando:

- **Factura** (obligatoria)
- **Foto** del material o factura (opcional)
- Notas finales

La requisición pasa de `Pendiente` → `Comprada` (o `Cancelada`).

---

## Desarrollo local

```bash
npm install
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

## Build de producción

```bash
npm run build
npm run start
```

## Estructura

```
src/
├── app/
│   ├── login/              # Login con selección de usuario
│   ├── (root)              # Páginas autenticadas
│   │   ├── page.tsx        # Dashboard principal
│   │   ├── manufacturing/  # OTs
│   │   ├── requisitions/   # Requisiciones
│   │   ├── settings/employees/  # CRUD de usuarios
│   │   └── ...
│   ├── actions/            # Server actions (auth, employees, requisitions)
│   └── api/
│       ├── me/permissions/ # Devuelve permisos del usuario actual
│       └── setup/          # Crea el primer master
├── lib/
│   ├── employees.ts        # CRUD + auth
│   ├── password.ts         # Hash scrypt
│   ├── permissions.ts      # Helpers de permisos
│   └── session.ts          # Cookie JWT
├── components/             # UI
└── middleware.ts           # Gatea rutas por permiso
```
