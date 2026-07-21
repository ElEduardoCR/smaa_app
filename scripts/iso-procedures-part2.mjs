// Seed script part 2: procedures 8-14.
// Exports the rest of the procedures array. Imported by the main script.

export const proceduresPart2 = [
    {
        // ============ PRO-008 — SATISFACCIÓN DEL CLIENTE ============
        title: "Satisfacción del Cliente",
        keywords: "satisfaccion, NPS, encuesta, cliente, retroalimentacion, 9.1.2",
        objective: "Medir, analizar y aumentar el nivel de satisfacción del cliente para confirmar que el SGC cumple con sus expectativas y detectar oportunidades de mejora.",
        scope: "Aplica a todos los clientes a los que se les ha entregado al menos un producto o servicio. Comienza con el diseño de la encuesta y termina con el análisis trimestral de resultados. No aplica a clientes prospecto (sin entrega aún).",
        definitions: "Satisfacción del cliente: percepción del cliente sobre si el producto/servicio cumplió sus expectativas. NPS: Net Promoter Score, indicador que mide la disposición a recomendar (escala -100 a +100). Encuesta: cuestionario estructurado para recolectar la opinión. Queja: expresión formal de insatisfacción. Tendencia: comportamiento del indicador en el tiempo.",
        responsibilities: "Director Comercial: diseña y aprueba la encuesta. Servicio al Cliente: envía encuestas, consolida respuestas. Director General: revisa resultados trimestrales. Responsable de Calidad: integra los resultados en la Revisión por la Dirección.",
        content: `1. **Diseño de la encuesta (anual, enero)**
   1.1 Se define una encuesta breve (5 a 10 preguntas) que cubra:
       - Calidad del producto (entregado conforme a especificación).
       - Cumplimiento del plazo.
       - Trato del personal (vendedor, operador, entregas).
       - Facilidad de hacer negocios (cotización, pago, comunicación).
       - Disposición a recomendar (NPS: 0-10).
       - Comentarios libres.
   1.2 Se utiliza una herramienta como Google Forms, Typeform, SurveyMonkey.

2. **Envío de la encuesta (tras cada entrega)**
   2.1 Una vez confirmada la entrega en /deliveries, el sistema o el Servicio al Cliente envía automáticamente la encuesta por correo y/o WhatsApp al cliente.
   2.2 Se da un plazo de 7 días para responder.

3. **Recepción de respuestas**
   Las respuestas se almacenan automáticamente en la herramienta de encuestas y se exportan mensualmente a Excel.

4. **Cálculo de indicadores**
   - % de respuesta (objetivo: ≥30%).
   - NPS: % promotores (9-10) − % detractores (0-6).
   - % de satisfacción global (preguntas de 1 a 5 con respuesta ≥4).
   - # de quejas / total entregas.

5. **Análisis trimestral**
   5.1 Servicio al Cliente consolida las respuestas y detecta:
       - Tendencias positivas (lo que el cliente valora).
       - Tendencias negativas (lo que más molesta).
       - Clientes en riesgo (NPS bajo o múltiples quejas).
   5.2 Presenta el informe al Director General.

6. **Acciones derivadas**
   6.1 Si el NPS general cae por debajo de la meta, se inicia un proyecto de mejora.
   6.2 Las quejas recurrentes se canalizan al PRO-003 Acciones Correctivas.
   6.3 Los clientes en riesgo reciben atención personalizada del Director Comercial.

7. **Reporte a la Revisión por la Dirección (anual)**
   El Responsable de Calidad incluye los resultados de satisfacción del cliente en la Revisión por la Dirección (PRO-001).`,
        document_references: "ISO 9001:2015 cláusula 9.1.2 (Satisfacción del cliente). PRO-009 Quejas. PRO-001 Revisión por la Dirección.",
        records: "Encuesta vigente. Base de datos de respuestas. Informes trimestrales. Análisis de tendencias. Acciones de mejora derivadas.",
        nextReviewMonths: 12,
        approvedBy: "Director Comercial",
        approvedRole: "Comercial"
    },
    {
        // ============ PRO-009 — QUEJAS ============
        title: "Gestión de Quejas del Cliente",
        keywords: "queja, reclamacion, satisfaccion, cliente, devolucion, 10.2.1",
        objective: "Atender y resolver las quejas del cliente de manera rápida, satisfactoria y documentada, restableciendo la relación y evitando la recurrencia.",
        scope: "Aplica a todas las quejas recibidas de cualquier cliente, por cualquier canal (correo, WhatsApp, llamada, encuesta de satisfacción, redes sociales). Comienza con la recepción de la queja y termina con la confirmación de la satisfacción del cliente y el cierre del caso. Una queja grave se escala inmediatamente a Director General.",
        definitions: "Queja: expresión formal o informal de insatisfacción. Acuse: confirmación al cliente de que su queja fue recibida. NC: no conformidad (ver PRO-003). Caso crítico: queja con riesgo de pérdida del cliente, afectación legal o impacto en seguridad. Recurrencia: queja similar que se repite.",
        responsibilities: "Servicio al Cliente: recibe, registra y da acuse. Director Comercial: investiga, propone solución. Responsable de Calidad: si la queja es una NC, abre el PRO-003. Director General: aprueba soluciones en casos críticos.",
        content: `1. **Recepción de la queja**
   La queja puede llegar por: correo, WhatsApp, llamada telefónica, redes sociales, encuesta de satisfacción, visita del cliente. Cualquier colaborador que la reciba la canaliza a Servicio al Cliente en máximo 4 horas.

2. **Registro**
   Se crea un registro con: fecha y hora de recepción, cliente, persona de contacto, canal, descripción del problema, evidencia adjunta (fotos, documentos), monto en disputa (si aplica), severidad (baja, media, alta, crítica).

3. **Acuse al cliente (≤24 h)**
   Se envía un mensaje de acuse al cliente confirmando: número de caso, persona responsable, plazo de resolución estimado. El acuse debe ser amable y profesional.

4. **Clasificación**
   - Severidad: baja (incomodidad), media (afecta operación del cliente), alta (pérdida económica), crítica (riesgo legal o de seguridad).
   - Tipo: producto, servicio, facturación, entrega, atención.

5. **Investigación (≤3 días hábiles)**
   5.1 Se identifica el área responsable (Calidad, Producción, Entregas, Comercial).
   5.2 Se recopilan hechos: qué pasó, cuándo, cómo, qué evidencia hay.
   5.3 Si la queja es una NC real, se abre el PRO-003 Acciones Correctivas.
   5.4 Se contacta al cliente para profundizar si es necesario.

6. **Propuesta de solución (≤5 días hábiles)**
   6.1 Se evalúan opciones: reposición, crédito, descuento, corrección, capacitación.
   6.2 Se selecciona la mejor opción considerando: satisfacción del cliente, costo, tiempo.
   6.3 Se presenta al cliente con explicación clara y sincera.
   6.4 Casos graves: el Director General aprueba.

7. **Implementación**
   7.1 Se ejecuta la solución acordada.
   7.2 Se documenta (correos, acta, comprobante).
   7.3 Si requiere reposición, se genera una nueva OT con prioridad 'Urgente'.

8. **Confirmación con el cliente**
   Se contacta al cliente para confirmar que quedó conforme. Si no quedó conforme, se reabre el caso.

9. **Cierre y archivo**
   Solo se cierra cuando el cliente confirma satisfacción. El registro se archiva con: descripción, investigación, solución, evidencia, confirmación, fecha de cierre.

10. **Análisis de tendencias (mensual)**
    El Responsable de Calidad analiza las quejas del mes: tipos recurrentes, clientes con múltiples quejas, áreas problemáticas. Se reporta en Revisión por la Dirección.`,
        document_references: "ISO 9001:2015 cláusula 10.2.1. PRO-003 Acciones Correctivas. PRO-008 Satisfacción del Cliente. PROFECO (en caso de escalamiento).",
        records: "Registro de queja. Acuse al cliente. Investigación. Solución propuesta y aprobada. Evidencia de implementación. Confirmación del cliente. Análisis mensual de tendencias.",
        nextReviewMonths: 12,
        approvedBy: "Director Comercial",
        approvedRole: "Comercial"
    },
    {
        // ============ PRO-010 — VENTAS ============
        title: "Proceso de Ventas",
        keywords: "ventas, cotizacion, margen, facturacion, 8.2, 8.4",
        objective: "Generar cotizaciones competitivas, cerrar ventas con margen adecuado y facturar oportunamente, contribuyendo al crecimiento rentable de la empresa.",
        scope: "Aplica desde la solicitud de cotización del cliente hasta la emisión de la factura al entregar el producto. Comienza con la RFQ del cliente y termina con la factura timbrada ante el SAT. No incluye cobranza (ésta se trata en PRO-004 Administración y Finanzas).",
        definitions: "Cotización: documento formal con precio y plazo. Margen bruto: (precio − costo) / precio. Punto de equilibrio: mínimo margen para cubrir costos fijos. Factura CFDI: comprobante fiscal digital. Aprobación por monto: jerarquía requerida según el valor de la venta. Comisión: porcentaje pagado al vendedor según margen.",
        responsibilities: "Director Comercial: estrategia, aprobación de cotizaciones >$X. Vendedores: prospectar, cotizar, dar seguimiento. Ingenieria: soporte técnico en cotizaciones especiales. Director General: aprobar descuentos exceptionnels. Contador: timbrar facturas.",
        content: `1. **Recepción de la solicitud del cliente**
   Llega por correo, WhatsApp, llamada o de forma presencial. Se registran los datos de contacto y los requisitos iniciales.

2. **Análisis técnico (si es cotización técnica)**
   2.1 Ingenieria revisa planos, especificaciones, normas aplicables.
   2.2 Se definen los pasos de fabricación y los recursos necesarios.
   2.3 Se calcula el costo: materiales, mano de obra, tiempo de máquina, overhead.

3. **Cotización (/sales/new)**
   3.1 El vendedor crea la cotización con: datos del cliente (RFC, razón social), conceptos (descripción, cantidad, precio unitario, subtotal), IVA 16%, total, condiciones de pago, plazo de entrega, vigencia de la cotización (15-30 días), notas.
   3.2 Se aplica el margen según tabla de precios (mínimo 30% salvo excepciones aprobadas).
   3.3 Si el margen es bajo o se requiere descuento, se escala al Director Comercial.

4. **Aprobación interna (según monto)**
   - <$10,000: vendedor.
   - $10,000-$50,000: Director Comercial.
   - >$50,000: Director General.

5. **Envío al cliente**
   Se envía en PDF por correo con copia a Servicio al Cliente. Se da seguimiento en ≤48 h.

6. **Confirmación**
   6.1 Si el cliente acepta: el vendedor cambia el status a 'Approved'.
   6.2 Si requiere ajustes: se edita y se reenvía.
   6.3 Si la cotización NO está aprobada pero el cliente la acepta: se confirma en la pantalla de nueva OT (en /manufacturing/new se permite confirmar in-place).

7. **Generación de la OT**
   7.1 Con cotización aprobada: se crea la OT con la cotización anidada en /manufacturing/new?module=...
   7.2 Sin cotización: se crea ad-hoc (para clientes especiales o trabajos internos).
   7.3 La OT pasa al módulo correspondiente (Maquinado, Soldadura, Automatización).

8. **Seguimiento durante fabricación**
   El vendedor informa al cliente sobre el avance y, si hay desviación de plazo, lo negocia con anticipación.

9. **Facturación al entregar**
   9.1 Al marcar la entrega como completada en /deliveries, el contador genera la factura CFDI.
   9.2 La factura debe emitirse máximo 3 días después de la entrega.
   9.3 Se envía al cliente con su XML y PDF.

10. **Comisiones (si aplica)**
    Se calculan al cierre del mes según las reglas de la empresa y se pagan con la siguiente nómina.`,
        document_references: "ISO 9001:2015 cláusulas 8.2 (Requisitos) y 8.4 (Control de los procesos, productos y servicios provistos externamente). PRO-007 Relación con el Cliente. PRO-013 Logística. Manual del Módulo de Ventas de SMAA ERP.",
        records: "Cotización firmada. Orden de Trabajo generada. Factura timbrada (CFDI). Acuse de entrega. Notas de venta.",
        nextReviewMonths: 12,
        approvedBy: "Director Comercial",
        approvedRole: "Comercial"
    },
    {
        // ============ PRO-011 — COMPRAS ============
        title: "Proceso de Compras",
        keywords: "compras, proveedores, orden de compra, requisicion, cotizacion, 8.4",
        objective: "Adquirir productos, materiales y servicios externos de calidad, al mejor costo y plazo, cumpliendo los requisitos de la operación y los legales aplicables.",
        scope: "Aplica a todas las compras de la empresa: materiales para producción, refacciones, equipo, servicios (subcontratación, calibación, mantenimiento), consumibles. Comienza con la requisición interna y termina con la recepción del producto o servicio y el pago. No aplica a contratación de personal (PRO-006).",
        definitions: "Requisición: solicitud interna de compra. Cotización: oferta del proveedor. OC: Orden de Compra. Proveedor estratégico: aquel del que dependemos fuertemente. Evaluación de proveedores: revisión periódica de su desempeño. Lead time: tiempo de entrega del proveedor. CFDI: factura electrónica que recibimos.",
        responsibilities: "Requisitador (cualquier área): levanta la requisición con justificación. Jefe de Compras: busca proveedores, evalúa cotizaciones, negocia. Director de Administración: aprueba compras >$X. Almacén: recibe, verifica contra OC, reporta discrepancias. Contador: paga, recibe CFDI.",
        content: `1. **Requisición**
   1.1 Cualquier área puede levantar una requisición: descripción del producto/servicio, cantidad, justificación, fecha requerida, presupuesto estimado.
   1.2 El gerente del área aprueba la requisición.

2. **Búsqueda de proveedores (3 cotizaciones mínimo)**
   2.1 Compras investiga proveedores en su catálogo, referidos, internet.
   2.2 Se privilegian proveedores estratégicos y los que ya estén dados de alta en /suppliers.
   2.3 Para montos pequeños (<$5,000) se puede obviar las 3 cotizaciones con justificación.

3. **Solicitud de cotización**
   Se solicita por correo o WhatsApp con: especificaciones, cantidad, fecha requerida, lugar de entrega, condiciones de pago esperadas.

4. **Evaluación y selección**
   4.1 Se comparan: precio, plazo, calidad, condiciones de pago, garantía, soporte.
   4.2 Se selecciona el mejor (no siempre el más barato).
   4.3 Se documenta la justificación.

5. **Creación de la OC en /purchases/new**
   5.1 Datos del proveedor, condiciones, fecha prometida, lugar de entrega.
   5.2 Líneas: producto, cantidad, precio unitario, subtotal, IVA, total.
   5.3 Estado: 'Draft' (pendiente de aprobación).

6. **Aprobación interna (según monto)**
   - <$20,000: Jefe de Compras.
   - $20,000-$100,000: Director de Administración.
   - >$100,000: Director General.

7. **Envío al proveedor**
   Se envía la OC firmada y se confirma la recepción por el proveedor.

8. **Recepción de materiales (Almacén)**
   8.1 Al recibir, se verifica contra la OC: cantidad, descripción, calidad, empaque.
   8.2 Si todo OK: se firma de recibido en la OC y se marca como 'Recibido'.
   8.3 Si hay discrepancias: se reporta a Compras y se negocia con el proveedor.

9. **Captura de la factura del proveedor (CFDI)**
   9.1 El CFDI llega por correo del proveedor o se descarga del portal del SAT.
   9.2 Se sube a /invoice_inbox o se vincula a la OC en /purchases.
   9.3 Se concilia contra la OC.

10. **Pago**
    El contador programa el pago según las condiciones acordadas. Una vez pagado, se actualiza el estatus de la OC a 'Cerrada' y se carga la evidencia de pago.

11. **Evaluación de proveedores (semestral)**
    El Jefe de Compras evalúa: calidad, puntualidad, precio, soporte. Los proveedores con calificación baja se cambian o se cancelan.`,
        document_references: "ISO 9001:2015 cláusula 8.4 (Control de los procesos, productos y servicios provistos externamente). Código Fiscal de la Federación (CFDI). Manual del Módulo de Compras de SMAA ERP.",
        records: "Requisiciones aprobadas. Cotizaciones de proveedores. OC firmada. CFDI de proveedor. Evidencia de recepción. Pagos. Evaluaciones semestrales de proveedores.",
        nextReviewMonths: 12,
        approvedBy: "Jefe de Compras",
        approvedRole: "Compras"
    },
    {
        // ============ PRO-012 — CONTROL DE CALIDAD ============
        title: "Control y Aseguramiento de la Calidad",
        keywords: "calidad, inspeccion, primera pieza, PPAP, no conformidad, 8.5, 9.1",
        objective: "Asegurar que los productos y servicios fabricados cumplan con los requisitos del cliente, las especificaciones técnicas y las normas aplicables, mediante inspección, control dimensional y liberación formal.",
        scope: "Aplica a todos los productos fabricados en la empresa, desde la primera pieza de cada Orden de Trabajo hasta el producto final. Comienza cuando el operador marca la OT como 'terminada' y termina con la liberación de Calidad (o rechazo). Incluye inspección de primera pieza, control dimensional, pruebas no destructivas si aplica, y certificado de calidad cuando el cliente lo requiera.",
        definitions: "PPAP: Production Part Approval Process (proceso de aprobación de pieza de producción, similar al de la industria automotriz). Inspección de primera pieza: revisión de las primeras unidades antes de continuar la producción. NC: no conformidad. Liberación: acto formal de aceptación de Calidad. Certificado de calidad: documento que avala el cumplimiento de las especificaciones. Calibración: comparación de un instrumento contra un patrón certificado.",
        responsibilities: "Operador: ejecuta el proceso, llena la primera pieza, la marca, la documenta, firma la OT al terminar. Inspector de Calidad: revisa la primera pieza y, si el cliente lo requiere, las intermedias y la final. Responsable de Calidad: firma la liberación, emite certificados, gestiona instrumentos calibrados. Director General: aprueba en casos críticos.",
        content: `1. **Definición de puntos de inspección**
   Para cada proceso (Maquinado, Soldadura, Automatización) se define qué se inspecciona, con qué instrumento, qué tolerancias, y con qué frecuencia (por pieza, por lote, por cada N piezas).

2. **Calibración de instrumentos**
   2.1 Todos los instrumentos de medición (calibradores, micrómetros, gauges) deben estar calibrados y con su certificado vigente.
   2.2 El Responsable de Calidad lleva un registro de calibraciones y alerta cuando vencen.

3. **Inspección de primera pieza (PPAP)**
   3.1 El operador, al producir la primera pieza, la separa y la marca.
   3.2 Toma fotos de evidencia (con GPS y fecha) — la cámara del celular o tablet puede tomar las fotos con EXIF.
   3.3 Sube las fotos en el detalle de la OT en /manufacturing/[code]/[id], sección 'Pieza terminada'.

4. **Finalización de la OT por el operador**
   4.1 El operador completa el trabajo, sube todas las fotos requeridas, y firma digitalmente (con el dedo o mouse) en el SignaturePad.
   4.2 Al firmar, la OT pasa automáticamente a status 'QC' (En Calidad).

5. **Revisión de Calidad (/quality)**
   5.1 El inspector de Calidad abre la OT desde la cola de /quality.
   5.2 Revisa:
       - Fotos de la pieza terminada.
       - Cumplimiento de las especificaciones (tolerancias dimensionales, acabado, soldadura, etc.).
       - Completitud de la documentación.
   5.3 Si todo cumple: firma digitalmente como Calidad → la OT pasa a 'QC_Released' y a la fecha efectiva.
   5.4 Si no cumple: rechaza con motivo (rechazo) → la OT regresa al operador con status 'In Progress' (reabrir la operación para corregir).

6. **Liberación**
   6.1 La firma de Calidad se guarda como evidencia.
   6.2 La OT liberada se mueve a la sección de entregas en /deliveries/new.

7. **Certificado de calidad (cuando el cliente lo requiera)**
   7.1 Se emite desde /manufacturing/[code]/[id] una vez liberada.
   7.2 Contiene: datos de la OT, plano, tolerancias, resultados de inspección, instrumento usado, firma del inspector, fecha.

8. **Liberación por lote (si aplica)**
   Para producciones grandes, la primera pieza se inspecciona al 100%, las intermedias por muestreo (AQL acordado) y la final al 100%.

9. **Control de instrumentos no conformes**
   Si un instrumento de medición falla la calibración, se retiran inmediatamente las inspecciones realizadas con él y se reevalúan las OTs.`,
        document_references: "ISO 9001:2015 cláusulas 8.5 (Producción y provisión del servicio) y 9.1 (Seguimiento, medición, análisis y evaluación). PRO-001 Revisión por la Dirección. PRO-005 Información Documentada. Manual del Módulo de Fabricación y Calidad de SMAA ERP.",
        records: "Puntos de inspección definidos. Registros de calibración. Actas de inspección de primera pieza. Certificados de calidad emitidos. NC de calidad.",
        nextReviewMonths: 12,
        approvedBy: "Responsable de Calidad",
        approvedRole: "Aseguramiento de Calidad"
    },
    {
        // ============ PRO-013 — LOGÍSTICA Y EMBARQUES ============
        title: "Logística y Embarques",
        keywords: "logistica, entrega, empaque, paqueteria, transporte, 8.5.4, 8.5.5",
        objective: "Entregar el producto correcto, en el lugar y tiempo acordados, sin daños, con la documentación completa y evidencia fotográfica con geolocalización.",
        scope: "Aplica a todas las entregas a clientes, ya sea recolección en planta o envío a domicilio. Comienza cuando la OT es liberada por Calidad y termina con la confirmación de la entrega al cliente. Aplica a entregas nacionales.",
        definitions: "Empaque: protección física del producto para el transporte. Embalaje: empaque externo (caja, tarima, etc.). Paquetería: empresa de transporte (DHL, FedEx, Estafeta, etc.). Flete: transporte dedicado. Guía: número de rastreo. Prueba de entrega (POD): firma del cliente al recibir. Lead time: tiempo entre la OT liberada y la entrega.",
        responsibilities: "Almacén: empaca y prepara el envío. Embarques: gestiona el transporte, captura guías. Servicio al Cliente: informa al cliente del estatus. Operador del transporte: entrega. Cliente: firma de recibido. Responsable de Calidad: verifica que la entrega cumple requisitos.",
        content: `1. **Recepción de la OT liberada**
   Cuando Calidad libera una OT, aparece automáticamente en /deliveries como candidata para nueva entrega.

2. **Creación de la nota de entrega en /deliveries/new**
   2.1 Seleccionar la OT.
   2.2 Capturar:
       - Método de envío (paquetería, flete, recolección).
       - Paquetería / transportista.
       - Número de guía.
       - Dirección de envío (si es diferente a la del cliente).
       - Observaciones (instrucciones especiales de entrega).

3. **Empaque (Almacén)**
   3.1 El operador empaca el producto siguiendo las instrucciones de empaque del cliente (si las hay) o las estándar de la empresa.
   3.2 Se verifica que el producto esté protegido, que la documentación esté incluida (certificado de calidad, manual, etc.).
   3.3 Se sella el empaque.

4. **Sección 'Listo para embalaje' en /deliveries**
   4.1 La entrega aparece en la pestaña 'Listo para embalaje' con la OT correspondiente.
   4.2 Se toma foto del empaque y se sube (opcional pero recomendado).
   4.3 Se hace clic en 'Marcar como empacado'.

5. **Asignación de paquetería / transporte**
   5.1 Si es paquetería: se imprime la guía, se pega al empaque y se entrega al chofer.
   5.2 Si es flete: se coordina la recolección con el transportista.
   5.3 Si es recolección: se notifica al cliente la fecha y hora.

6. **Monitoreo del envío**
   Si es paquetería, se da seguimiento con el número de guía. Si hay retraso, se informa al cliente y a Servicio al Cliente.

7. **Entrega al cliente**
   7.1 El transportista entrega al cliente.
   7.2 El cliente firma de recibido (POD).
   7.3 Se toman al menos dos evidencias:
       - Foto de la factura firmada o del paquete ya entregado (en /deliveries, sección evidencia).
       - Geolocalización: se activa el GPS del celular al tomar la foto (la app lee el EXIF y muestra las coordenadas).
   7.4 Si no se puede tomar la foto con GPS, se pide permiso de ubicación al navegador.

8. **Confirmación de la entrega**
   8.1 La entrega se mueve a la pestaña 'Entregados' en /deliveries.
   8.2 Se marca la fecha y hora de entrega, el nombre de quien recibe, y se sube la firma.

9. **No entrega o devolución**
   9.1 Si el cliente rechaza el producto: se documenta el motivo, se regresa a almacén, se inicia PRO-009 Quejas.
   9.2 Si la paquetería no puede entregar: se reprograma y se notifica al cliente.

10. **Cierre y retroalimentación**
    Una vez entregado, Servicio al Cliente envía la encuesta de satisfacción (PRO-008).`,
        document_references: "ISO 9001:2015 cláusulas 8.5.4 (Preservación) y 8.5.5 (Actividades posteriores a la entrega). PRO-009 Quejas. PRO-008 Satisfacción. Manual del Módulo de Entregas de SMAA ERP.",
        records: "Nota de entrega. Guía de paquetería. POD firmado. Evidencia fotográfica con GPS. Encuesta de satisfacción.",
        nextReviewMonths: 12,
        approvedBy: "Jefe de Almacén y Embarques",
        approvedRole: "Logística"
    },
    {
        // ============ PRO-014 — COMUNICACIÓN ============
        title: "Comunicación Interna y Externa",
        keywords: "comunicacion, interna, externa, partes interesadas, 7.4",
        objective: "Asegurar una comunicación efectiva, oportuna y documentada con todas las partes interesadas del SGC, tanto internas como externas.",
        scope: "Aplica a toda comunicación oficial de la empresa: con empleados (interna), con clientes, proveedores, autoridades y la sociedad (externa). Comienza con la identificación de qué se comunica, a quién, cómo y cuándo, y termina con el registro y archivo de la comunicación.",
        definitions: "Comunicación interna: entre miembros de la empresa. Comunicación externa: con clientes, proveedores, autoridades, sociedad. Parte interesada: persona u organización que puede afectar o ser afectada por el SGC. Política de calidad: declaración de intenciones y dirección de la calidad. Redes sociales: canales digitales para comunicar.",
        responsibilities: "Director General: define la estrategia de comunicación. Comunicación / Marketing: gestiona canales externos y redes sociales. RH: comunicación interna con empleados. Servicio al Cliente: comunicación con clientes. Compras: comunicación con proveedores. Todos los colaboradores: responsables de comunicar efectivamente con sus pares y superiores.",
        content: `1. **Plan de comunicación (anual)**
   Se define para cada parte interesada:
   - Qué se comunica (política, objetivos, cambios, resultados).
   - A quién (lista específica).
   - Cómo (correo, reunión, intranet, oficio, redes).
   - Cuándo (frecuencia).
   - Quién es responsable.

2. **Comunicación de la política de calidad**
   - Inducción a nuevos empleados.
   - Visible en la planta (murales, intranet).
   - Comunicada en Revisión por la Dirección.

3. **Comunicación interna**
   3.1 Reuniones periódicas:
       - Diaria: pase de turno en producción.
       - Semanal: junta directiva.
       - Mensual: juntas por área.
       - Anual: Revisión por la Dirección.
   3.2 Intranet / correo: avisos importantes.
   3.3 Murales: en áreas comunes.
   3.4 Buzón de sugerencias: físico o digital.

4. **Comunicación externa**
   4.1 Con clientes:
       - Cotización, confirmación, seguimiento, entrega, postventa.
       - Cambios al producto o proceso que los afecten.
       - Encuestas de satisfacción.
       - Respuesta a quejas (PRO-009).
   4.2 Con proveedores:
       - Solicitud de cotización, OC, retroalimentación.
       - Cambios a especificaciones.
   4.3 Con autoridades:
       - Declaraciones fiscales (PRO-004).
       - Cumplimiento normativo.
       - Respuesta a inspecciones.
   4.4 Con la sociedad:
       - Sitio web.
       - Redes sociales.
       - Comunicados de prensa.

5. **Cambios al SGC (ISO 9001:2015 cláusula 7.4)**
   Los cambios al SGC se comunican a las partes interesadas afectadas con al menos 5 días hábiles de anticipación, explicando el cambio, el motivo y la fecha de entrada en vigor.

6. **Bitácora de comunicación (en /changes)**
   Toda comunicación oficial (cambios, decisiones, acuerdos) queda registrada en el módulo de Control de Cambios para auditoría.

7. **Medición de la eficacia de la comunicación**
   7.1 Reuniones: actas firmadas, % de asistencia, acuerdos cumplidos.
   7.2 Correos: confirmación de lectura, respuesta.
   7.3 Redes sociales: alcance, interacción.
   7.4 Encuestas internas: nivel de claridad de la comunicación.

8. **Mejora continua**
   Los resultados de la medición se reportan en la Revisión por la Dirección y se generan acciones de mejora.`,
        document_references: "ISO 9001:2015 cláusula 7.4 (Comunicación). Manual de Calidad. Plan de comunicación anual.",
        records: "Plan de comunicación. Actas de reuniones. Comunicados oficiales. Respuesta a quejas. Bitácora en /changes. Encuestas internas de comunicación.",
        nextReviewMonths: 12,
        approvedBy: "Director General",
        approvedRole: "Alta Dirección"
    },
];
