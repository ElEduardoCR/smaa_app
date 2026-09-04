# Checador semanal por archivo

La asistencia automatica de Hikvision permanece en el codigo y en sus tablas,
pero ya no se muestra ni participa en el calculo de nomina. Por ahora la fuente
activa es el archivo semanal del checador.

## Flujo

1. Finanzas sube un `.xls` o `.xlsx` (se conserva compatibilidad con `.csv` y `.txt`).
2. El servidor procesa el archivo en memoria; el original no se guarda.
3. Con DeepSeek activo, el contenido de todas las hojas se envia al proveedor.
   La IA clasifica cada hoja y devuelve jornadas unicas con codigo de empleado,
   fecha, entrada, salida y referencias exactas a las celdas de origen.
4. El ERP empata el codigo normalizado con `payroll_employees.code`, valida cada
   valor contra esas celdas y calcula los minutos entre entrada y salida.
5. La vista previa indica registros nuevos, pendientes que se completaran,
   repetidos, conflictos y codigos sin empleado.
6. Al confirmar se aplica todo en una transaccion. Existe una sola jornada por
   `(employee_id, work_date)` y el SHA-256 del archivo evita reprocesar el mismo
   archivo.

Una carga posterior nunca borra una entrada o salida. Solo llena un valor nulo.
Si trae otra hora para un valor ya registrado, conserva la existente y reporta
el conflicto. Esto permite subir el reporte un viernes con salidas pendientes y
completarlas con un reporte posterior.

## Interpretacion multih hoja con IA

DeepSeek recibe todas las celdas con contenido de todas las hojas, no el archivo
binario. Debe clasificar cada pestaña como fuente de marcajes, resumen, horario,
definicion de turno, detalle duplicado o irrelevante. Despues devuelve una sola
jornada por empleado y fecha. Esto permite leer reportes como `AllReport.xls`,
que separan resumen, marcajes, anomalias, horarios, turnos y fichas individuales.

El ERP no confia directamente en la respuesta. Cada codigo, fecha, entrada y
salida debe señalar las celdas que lo respaldan; el servidor vuelve a comprobar
esas referencias, descarta propuestas no demostrables, empata al empleado y
calcula las horas. DeepSeek no tiene acceso a Supabase ni decide la escritura.

El archivo admite hasta 50 hojas, 20,000 filas con contenido, 80 columnas por
hoja y 5 MB. Para no truncar libros que excedan la ventana segura de IA, se
solicita exportar un periodo semanal mas corto en lugar de procesar solo una
parte silenciosamente.

El proveedor predeterminado sigue siendo `deterministic`, que reconoce formatos
tabulares sencillos sin enviar datos a terceros. Para interpretar el libro
completo se configura DeepSeek:

```env
TIME_CLOCK_AI_PROVIDER=
DEEPSEEK_API_KEY=
DEEPSEEK_ATTENDANCE_MODEL=deepseek-v4-pro
```

Las tres variables son exclusivas del servidor y se configuran sin prefijo
`NEXT_PUBLIC_`. Para esta integracion el request habilita `thinking` y utiliza
`reasoning_effort=high`. La vista previa muestra la clasificacion de cada hoja
antes de que el usuario confirme la escritura.

## Persistencia

- `time_clock_uploads`: bitacora y contadores, sin archivo crudo.
- `time_clock_daily_records`: estado canonico por empleado/dia.
- `time_clock_entries`: legado de cargas anteriores, solo lectura.
- `attendance_events` y `attendance_daily_summaries`: automatizacion oculta y
  separada; no se mezcla con el archivo.

Las tablas del flujo nuevo tienen RLS activo, no otorgan acceso a `anon` ni a
`authenticated`, y solo se consultan mediante rutas del ERP que validan la
sesion y utilizan la clave secreta de Supabase en servidor.
