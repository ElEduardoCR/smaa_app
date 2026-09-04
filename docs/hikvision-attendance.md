# Integración de asistencia Hikvision

El ERP recibe únicamente eventos JSON normalizados de acceso autorizado. No guarda imágenes, plantillas faciales, biometría, nombres provenientes del equipo, payloads crudos, credenciales, IP, MAC ni serie física del dispositivo.

## Contrato del receptor

`POST /api/integrations/hikvision/access-events`

El request debe usar `Content-Type: application/json` y `Authorization: Bearer <HIKVISION_WEBHOOK_SECRET>`. El secreto no se acepta en la URL. El cuerpo máximo es 64 KiB.

Se acepta el JSON de `AccessControllerEvent` de Hikvision o esta forma normalizada:

```json
{
  "deviceId": "identificador-logico",
  "eventType": "AccessControllerEvent",
  "employeeNoString": "EMP001",
  "dateTime": "2026-08-31T18:15:00-06:00",
  "serialNo": 1234,
  "major": 5,
  "minor": 75,
  "direction": "entry"
}
```

Solo se registra `AccessControllerEvent` activo con `major=5` y `minor=75`. El servidor resuelve `employeeNoString` contra `payroll_employees.code` y persiste el `employees.id` relacionado. La combinación del identificador lógico del equipo y `serialNo` hace idempotente cada entrega.

La dirección nunca se infiere por el orden. En el cuerpo normalizado es obligatoria y admite `entry`, `exit`, `break_start` y `break_end`. Para el cuerpo nativo se aplica esta allowlist de `attendanceStatus`:

- Entrada: `checkIn`, `in`, `onDuty`, `dutyOn`, `overtimeIn`.
- Salida: `checkOut`, `out`, `offDuty`, `dutyOff`, `overtimeOut`.
- Descanso: `breakOut`/`breakStart` y `breakIn`/`breakEnd`.

Un estado ausente, `undefined` o desconocido se rechaza con `direction_not_supported`. Entradas o salidas consecutivas y extremos faltantes quedan como incidencias; nunca producen horas inventadas.

## Reglas de cálculo

`attendance_events` continúa append-only. `attendance_daily_summaries` es una capa derivada que se puede recalcular desde los eventos mediante la ruta server-only `POST /api/attendance/recalculate` (máximo 31 días por solicitud).

- `payroll_employees.payment_type = 'hourly'`: suma intervalos explícitos entrada/salida, resta solo descansos explícitos cerrados y multiplica las horas pagables por `hourly_rate`. Si falta tarifa, deja una incidencia y no inventa un monto.
- Otros tipos de pago: usa el horario efectivo asignado en `employee_attendance_schedules`, incluyendo turnos nocturnos. Calcula retardo, salida anticipada, ausencia y tiempo extra con las tolerancias del horario.
- Si no hay horario o hay asignaciones ambiguas, se requiere revisión: no se fabrica una ausencia ni un turno.
- Las incidencias no descuentan salario. El tiempo extra detectado queda pendiente y solo entra a una futura corrida de nómina tras una aprobación explícita en `attendance_overtime_approvals`.
- Cuando hay resumen en vivo y CSV para el mismo empleado/fecha, nómina usa el resumen en vivo. El `upload_id` y las cargas históricas permanecen separados.

Defaults configurables en base de datos:

- Zona del sistema: `America/Chihuahua`.
- Máximo de una pareja entrada/salida: 960 minutos; al excederlo la pareja queda como incidencia sin horas.
- Tolerancias iniciales por horario: 5 minutos de entrada, 5 de salida y umbral de 30 minutos para reportar tiempo extra. No se crea ningún horario automáticamente.

Finanzas → Checador muestra jornadas, tipo de empleado, entrada/salida, horas, descansos, estimación por hora e incidencias. Debajo conserva los marcajes inmutables y, en secciones distintas, la importación CSV existente.

## Variables de despliegue

- `SUPABASE_SECRET_KEY`: clave secreta de Supabase exclusiva del backend. Como alternativa heredada se admite `SUPABASE_SERVICE_ROLE_KEY`; configura solo una.
- `HIKVISION_WEBHOOK_SECRET`: secreto aleatorio dedicado de al menos 32 caracteres.
- `HIKVISION_DEVICE_ID`: nombre lógico estable del equipo, sin usar IP, MAC ni número de serie.

Antes de conectar el notification host, aplica la migración y configura estas variables en el entorno del servidor. Si el equipo no puede enviar el header Bearer y JSON compatible, debe interponerse un adaptador HTTPS que autentique al equipo, descarte cualquier contenido multimedia, normalice el evento y agregue el secreto; no se debe pasar el secreto por query string.

## Receptor directo HTTPS de la terminal

`POST /api/integrations/hikvision/direct-events` es una ruta separada para el
notification host del equipo. No modifica ni debilita el receptor Bearer
anterior. Requiere HTTPS y `Authorization: Basic` con credenciales aleatorias y
exclusivas configuradas solo en Producción:

- `HIKVISION_DIRECT_USERNAME`: entre 12 y 64 caracteres, sin `:`.
- `HIKVISION_DIRECT_PASSWORD`: entre 16 y 128 caracteres. El DS-K1T320MFWX-B
  limita el notification host a 16; usa exactamente 16 caracteres base64url
  aleatorios (aprox. 96 bits), nunca una contraseña humana.

No se aceptan credenciales en query strings, HTTP, autenticación ausente ni
métodos distintos de POST. El receptor admite el evento nativo como JSON, XML o
multipart. Cada parte de evento está limitada a 64 KiB y el multipart completo
a 4 MiB con tiempo de lectura acotado. Partes de imagen/binarias se descartan sin
materializarlas; URLs, nombres y demás campos no incluidos en la allowlist no se
persisten. Un `attendanceStatus` ausente o desconocido se rechaza sin inferir la
dirección.

En la terminal se debe ocupar únicamente un slot libre de HTTP notification
host con HTTPS, puerto 443 y Basic. Prefiere JSON y desactiva imágenes cuando el
firmware exponga esas opciones; el DS-K1T320MFWX-B validado anuncia XML y no
expone control de imágenes, por lo que se usa XML y el receptor descarta en
streaming cualquier parte multimedia. Si la prueba TLS/Basic falla, restaura el
slot y usa el puente LAN; nunca cambies a HTTP o autenticación `none`.

Notificaciones autenticadas pero no elegibles (por ejemplo `heartBeat`, otro
tipo de evento o un estado de asistencia ausente) reciben `202 ignored` y no se
persisten. Esto evita reintentos infinitos del equipo sin relajar la allowlist;
solo el facial aprobado activo con estado explícito llega a `attendance_events`.

## Puente LAN de respaldo para DS-K1T320

El firmware no puede agregar el Bearer del receptor original. Si el notification
host directo no supera la validación HTTPS/Basic, el adaptador
`scripts/hikvision-lan-bridge.ts` mantiene `alertStream` desde un host permanente
de la misma LAN y reenvía solo eventos válidos. No se ejecuta ni se instala si el
envío directo funciona.

Configura en ese host, nunca en Vercel ni en un cliente web:

- `HIKVISION_TERMINAL_URL`: base HTTPS de la terminal.
- `HIKVISION_TERMINAL_USER` y `HIKVISION_TERMINAL_PASSWORD`: cuenta técnica de solo lectura cuando el equipo lo permita.
- `HIKVISION_TERMINAL_PINNED_PUBKEY`: pin TLS `sha256/BASE64`; permite validar el certificado autofirmado sin confiar ciegamente en él.
- `HIKVISION_WEBHOOK_URL` y `HIKVISION_WEBHOOK_SECRET`: receptor público y su Bearer dedicado.

Ejecuta `npm run test:hikvision-bridge` y luego `npx tsx scripts/hikvision-lan-bridge.ts`. El proceso solo registra estados operativos; nunca imprime personas, series de evento, direcciones, credenciales ni cuerpos recibidos. Debe instalarse como servicio con reinicio automático en un equipo que permanezca encendido.

En la terminal, el estado se configura localmente en **T&A / Platform Attendance**. Para exigir estados explícitos y soportar cruces de medianoche, usa **Manual**, habilita **Check In** y **Check Out** y, si se van a descontar descansos reales, también **Break Out** y **Break In**. No uses el orden de los marcajes para deducir una salida.
