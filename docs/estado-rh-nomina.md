# Estado de RH / Nómina — corte del 2026-08-31

Dónde quedó el trabajo y qué sigue. Sustituye a leerse toda la conversación.

---

## Lo primero al retomar (1 minuto)

Agregar a `.env.local` y a las variables de entorno de Vercel:

```
SUPABASE_SECRET_KEY=
```

De Supabase → Project Settings → API. **Sin esto la pestaña de Expediente no
abre y la nómina no calcula**: el bucket del expediente es privado a propósito
y la anon key no lo puede leer. El mensaje de error lo dice, pero mejor
saberlo antes.

---

## Ya aplicado en la base de producción (verificado)

Dos migraciones corridas el 2026-08-31 contra el proyecto `mvjrqgyrjoawdhpalbix`,
con respaldo previo:

| Migración | Qué dejó |
|---|---|
| `20260831000000_payroll_foundations.sql` | 5 tablas + `v_payroll_employees`, ~17 columnas fiscales en `payroll_employees`, esquema fiscal/complementaria, desglose gravado/exento, bucket privado `employee_files` |
| `20260901120000_employee_files.sql` | `employee_document_types`, `employee_documents`, `document_templates`, `v_employee_document_status`, trigger de reemplazo |

Sembrado: 28 conceptos de nómina · 19 tipos de documento (10 obligatorios) ·
14 reglas de vacaciones LFT · 9 parámetros fiscales · 11 rangos de ISR.

La reparación de IDs (`employee_id` que apuntaban a `payroll_employees`) fue
**no-op**: las tablas de nómina estaban vacías. Confirmado con
`supabase/tests/employee_id_integrity.sql`, que se puede volver a correr
cuando sea — es solo lectura.

Respaldo previo en `/Volumes/Samsung T9/SMAA_APP/backups/` con su
`COMO-RESTAURAR.md`. Fuera del repo a propósito: trae datos de empleados.

---

## Sin verificar: la migración de la otra sesión

`20260901012603_add_attendance_calculation.sql` apareció mientras cerrábamos y
**no sé si está aplicada**. Crea `attendance_policies`,
`attendance_schedules`, `employee_attendance_schedules` y
`attendance_daily_summaries`.

Cómo checar (solo lectura):

```sql
SELECT relname FROM pg_class
 WHERE relnamespace = 'public'::regnamespace
   AND relname IN ('attendance_policies','attendance_schedules',
                   'employee_attendance_schedules','attendance_daily_summaries');
```

Ojo: esa migración y `20260901003958` usan `CREATE TABLE` **sin**
`IF NOT EXISTS`, así que reaplicarlas da error. Verificar antes de correrlas.

---

## Bloqueado hasta que lo defina la contadora

El motor de nómina se **detiene a propósito** con un mensaje accionable si
falta alguno de estos. No adivina:

1. **Tarifa de ISR vigente.** La migración sembró la mensual de 2024 como
   ejemplo del formato, expirada y sin verificar, para que nunca aplique a un
   periodo actual. Cargar la real:
   ```
   npx tsx scripts/import-tax-table.ts isr quincenal 2026-01-01 tarifa.csv --hasta 2026-12-31 --fuente "DOF ..." --verificada
   ```
2. **UMA de 2025 y 2026** en `fiscal_parameters`, clave `uma_daily`. Cambia
   cada 1 de febrero.
3. **Esquema de subsidio al empleo**: `fiscal_parameters` → `subsidio_scheme`
   = `tabla` | `uma_pct` | `ninguno`.
4. **Verificar las claves SAT** de `payroll_concepts` (van con
   `verified = false` a propósito) antes del primer timbrado.

También pendiente de ella: **qué necesita exactamente del SUA.**

---

## Dónde seguir

### Ruta A — cerrar la fase 1 (no depende de nadie)

Falta el **motor de generación de cartas, contratos y credenciales**. La tabla
`document_templates` ya existe y está vacía. Lo generado se archiva como una
fila más de `employee_documents` con `source = 'generated'`, que ya está
contemplado en el esquema.

**Decisión pendiente del usuario:** los contratos y las cartas son mucha
prosa, y jsPDF —lo que usa todo el proyecto— es incómodo para eso. Las
opciones son plantilla HTML → PDF (mete una dependencia nueva) o quedarse con
jsPDF (plantillas más rígidas). No está decidido.

### Ruta B — desbloquear el cálculo

Sentarse con la contadora y cargar los cuatro puntos de arriba.

---

## Cambio de plan para la fase 2

La otra sesión construyó una capa de asistencia bastante completa: el flujo
crudo del lector facial Hikvision (`attendance_events`) más horarios, políticas
y **`attendance_daily_summaries`**, que es justo el día consolidado que yo iba
a derivar.

**La fase 2 ya no debe crear una capa paralela.** El plan original era una
tabla espina `employee_incidences` que cubriera faltas, permisos, vacaciones e
incapacidades. Eso sigue teniendo sentido para lo que se *captura* (vacaciones,
incapacidades, permisos), pero lo que se *deriva* del checador ya lo resuelve
su capa. Hay que revisar su diseño primero y coordinarlo.

Dato conocido: `attendance_events.direction` tiene un CHECK que solo permite
`'entry'` — hoy no hay registro de salidas.

---

## Archivos clave

| Ruta | Qué es |
|---|---|
| `src/lib/nomina/calc.ts` | Funciones puras: ISR, IMSS, exenciones, SDI. Sin I/O, probadas |
| `src/lib/nomina/engine.ts` | Orquestación: carga, calcula, persiste |
| `src/lib/nomina/fiscalData.ts` | Carga el marco fiscal; aquí viven los mensajes de error accionables |
| `src/app/actions/payroll.ts` | Server actions de nómina |
| `src/app/actions/employeeDocuments.ts` | Server actions del expediente |
| `src/lib/expediente/storage.ts` | Bucket privado: subir, firmar URL, borrar |
| `src/app/finance/employees/[id]/ExpedienteTab.tsx` | La pestaña de expediente |
| `docs/nomina.md` | Qué cambió en el motor y por qué |
| `docs/expediente.md` | Cómo funciona el expediente |

## Comandos

```bash
npx tsx scripts/test-nomina-calc.ts      # 31 pruebas de la matemática, sin BD
npm run build                            # compila limpio al corte
```

Para migrar: pegar `DB_URL` en `.env.local` (hay plantilla comentada ahí) y
`npx tsx scripts/apply-migration.ts <archivo>`. La contraseña de la base se
rotó el 2026-08-31, así que la plantilla no trae valor.

Para `pg_dump` / `pg_restore` hay que usar `docker run --rm -i postgres:17`:
el Postgres local es 14 y se niega contra un servidor 17.

---

## Anotado, sin urgencia

- **Los otros 8 buckets de storage son públicos**, incluidos `client_documents`
  y `finance_files`. Si ahí hay constancias fiscales o declaraciones, son
  accesibles con solo la URL. `employee_files` es el primero privado del
  proyecto.
- **Nada está commiteado.** Al corte había 32 archivos entre lo de nómina/
  expediente y lo de asistencia de la otra sesión.
- Decidido y no implementado: partir en dos módulos, `rh` (que absorbe
  `employees`, `checador` y `payroll` de `/finance`) y `finance` (CxC,
  declaraciones, IVA, movimientos). Cuando pase, los permisos del expediente
  cambian de `finance` a `rh` en un solo lugar: la constante `MODULE` de
  `src/app/actions/employeeDocuments.ts`.
