// Seed script: 14 ISO 9001:2015 procedure documents for SMAA ERP.
// Run with: node scripts/seed-iso-procedures.mjs
// Requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ENV_PATH = join(__dirname, '..', '.env.local');

if (!existsSync(ENV_PATH)) {
    console.error(`❌ .env.local not found at ${ENV_PATH}`);
    process.exit(1);
}

const env = {};
for (const line of readFileSync(ENV_PATH, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.+)$/);
    if (m) env[m[1]] = m[2].trim();
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    console.error("❌ Missing Supabase env vars in .env.local");
    process.exit(1);
}

// ---------------------------------------------------------------
// 14 ISO 9001:2015 procedure documents
// Each one follows the structure:
//   - Folio auto-generated (PRO-001..PRO-014)
//   - All ISO 9001:2015 required sections
//   - Status = 'approved' (vigente) with creation signature
//   - Initial snapshot saved in document_versions
// ---------------------------------------------------------------

const procedures = [
    {
        // ============ PRO-001 — REVISIÓN POR LA DIRECCIÓN ============
        title: "Revisión por la Dirección",
        keywords: "revision, direccion, alta direccion, mejora continua, sgc, 9.3",
        objective: "Evaluar la conveniencia, adecuación, eficacia y alineación del Sistema de Gestión de Calidad (SGC) con la dirección estratégica de la organización, asegurando su mejora continua.",
        scope: "Aplica a todo el SGC implementado en SMAA ERP, una vez al año como mínimo, o cuando existan cambios significativos (organizativos, de proceso, de mercado o regulatorios). Comienza con la convocatoria a los responsables de proceso y termina con la minuta firmada y archivada. No incluye revisiones operativas diarias ni seguimiento de proyectos individuales (éstos se tratan en juntas directivas semanales).",
        definitions: "SGC: Sistema de Gestión de Calidad. Revisión por la Dirección: análisis sistemático que la alta dirección hace del SGC (ISO 9001:2015 cláusula 9.3). No conformidad: incumplimiento de un requisito. Partes interesadas: clientes, proveedores, colaboradores, socios, autoridades. KPI: indicador clave de desempeño.",
        responsibilities: "Director General: convoca, preside y firma la minuta. Responsables de proceso (Ventas, Compras, Fabricación, Calidad, Finanzas, RH, Logística): presentan resultados e indicadores. Responsable de Calidad: coordina la logística, consolida la información de entrada y resguarda las minutas.",
        content: `1. **Programación (enero de cada año)**
   1.1 El Director General, en conjunto con el Responsable de Calidad, programa la reunión anual ordinaria.
   1.2 En caso de requerir una revisión extraordinaria (auditoría fallida, cambio de mercado, etc.), se convoca con al menos 5 días hábiles de anticipación.

2. **Recopilación de entradas (mínimo 15 días antes)**
   El Responsable de Calidad solicita a cada responsable de proceso la siguiente información:
   - Desempeño de KPIs y cumplimiento de metas por proceso.
   - Resultados de auditorías internas y externas.
   - Retroalimentación del cliente (quejas, encuestas de satisfacción, NPS).
   - Desempeño de proveedores externos críticos.
   - Eficacia de las acciones correctivas (módulo de Acciones Correctivas, PRO-003).
   - Cambios en cuestiones externas e internas (contexto de la organización, ISO 9001:2015 cláusula 4.1).
   - Estado de los objetivos de calidad.
   - Desempeño de los procesos no conformes.
   - Recomendaciones de mejora.

3. **Convocatoria**
   Se envía invitación formal por correo electrónico con orden del día, fecha, hora, lugar (físico o sala virtual) y documentación adjunta para revisión previa.

4. **Desarrollo de la reunión**
   4.1 Verificación de quórum (mínimo 80% de los responsables de proceso).
   4.2 Revisión del acta anterior y cumplimiento de acuerdos.
   4.3 Presentación de cada entrada por su responsable (PowerPoint o documento).
   4.4 Análisis y discusión.
   4.5 Definición de:
       - Oportunidades de mejora.
       - Cambios necesarios al SGC.
       - Necesidades de recursos (humanos, infraestructura, financieros).
       - Acciones de seguimiento con responsable y fecha compromiso.
   4.6 Cierre con resumen de acuerdos.

5. **Minuta y resguardo**
   El Responsable de Calidad levanta la minuta en un máximo de 5 días hábiles, la sube al módulo de Control de Documentos como parte del expediente, y obtiene la firma del Director General.

6. **Seguimiento de acuerdos**
   Los acuerdos con fecha compromiso se monitorean mensualmente hasta su cierre. Cualquier acuerdo vencido se reporta a la siguiente reunión.

7. **Evidencia para auditoría**
   Las minutas firmadas deben estar disponibles para los auditores internos y externos.`,
        document_references: "ISO 9001:2015 cláusula 9.3 (Revisión por la Dirección). ISO 9000:2015 cláusula 3.4.11 (términos y definiciones). Manual de Calidad de SMAA ERP.",
        records: "Minuta de Revisión por la Dirección (firmada). Reporte de cumplimiento de acuerdos (mensual). Presentaciones de cada responsable de proceso.",
        nextReviewMonths: 12,
        approvedBy: "Director General",
        approvedRole: "Alta Dirección"
    },
    {
        // ============ PRO-002 — AUDITORÍAS INTERNAS ============
        title: "Auditorías Internas del SGC",
        keywords: "auditoria, interna, iso 9001, 9.2, no conformidad, hallazgo",
        objective: "Verificar la conformidad del SGC con los requisitos de la norma ISO 9001:2015, con los propios requisitos establecidos por la organización, y con los requisitos contractuales de los clientes.",
        scope: "Aplica a todos los procesos del SGC de SMAA ERP. Se realiza al menos una auditoría anual a cada proceso. Comienza con la planificación anual y termina con el cierre del informe. No incluye auditorías externas (éstas las realiza el organismo certificador).",
        definitions: "Auditoría interna: examen sistemático, independiente y documentado. NC mayor: incumplimiento de un requisito de la norma o que afecta la capacidad del SGC. NC menor: incumplimiento que no afecta la capacidad del SGC. Observación: situación que puede convertirse en NC si no se actúa. Hallazgo: resultado de la auditoría (conformidad, NC u observación).",
        responsibilities: "Responsable de Calidad: planifica, selecciona auditores, elabora programa. Auditor líder: ejecuta la auditoría y firma el informe. Auditores calificados: entrevistan y recopilan evidencia. Auditado: facilita acceso a información y registros. Director General: revisa resultados globales y aprueba el plan de acción resultante.",
        content: `1. **Plan anual de auditorías (noviembre del año anterior)**
   1.1 El Responsable de Calidad elabora el plan considerando: estado e importancia de los procesos, resultados de auditorías previas, quejas, cambios recientes.
   1.2 Se asegura cubrir todos los procesos en un periodo de 12 meses.
   1.3 El Director General aprueba el plan antes del 31 de diciembre.

2. **Selección y calificación de auditores**
   2.1 Los auditores deben: tener competencia técnica en el proceso, capacitación en ISO 9001, no tener responsabilidad directa sobre el proceso auditado (independencia).
   2.2 Lista maestra de auditores calificados en el módulo de Calidad (debe actualizarse anualmente).

3. **Programa y checklist de auditoría (mínimo 10 días antes)**
   3.1 El auditor líder prepara el programa con: alcance, criterios,日程, recursos.
   3.2 Elabora checklist basado en la norma y los procedimientos internos.
   3.3 Notifica al auditado con al menos 5 días hábiles de anticipación.

4. **Reunión de apertura**
   Confirmar: alcance, criterios, agenda,confidencialidad, logística, canales de comunicación.

5. **Ejecución de la auditoría**
   5.1 Entrevistas con el responsable y personal del proceso.
   5.2 Revisión documental (procedimientos, registros, formatos).
   5.3 Observación directa de actividades.
   5.4 Recopilación de evidencia objetiva.
   5.5 Clasificación preliminar de hallazgos (NC mayor, NC menor, observación, conformidad).

6. **Reunión de cierre**
   6.1 Presentación de hallazgos al auditado.
   6.2 Acuerdo sobre las acciones a tomar.
   6.3 Firmar acta de cierre.

7. **Informe de auditoría (5 días hábiles posteriores)**
   7.1 Estructura: alcance, criterios, equipo auditor, fecha, resumen ejecutivo, hallazgos detallados, conclusiones, recomendaciones.
   7.2 Subir al módulo de Control de Documentos y notificar a la dirección.

8. **Acciones correctivas derivadas**
   Toda NC mayor o menor debe generar una acción correctiva en el módulo correspondiente (ver PRO-003). El seguimiento se realiza hasta verificar la eficacia.

9. **Cierre de la auditoría**
   El auditor líder marca la auditoría como cerrada sólo cuando las acciones correctivas derivadas estén verificadas como eficaces.`,
        document_references: "ISO 9001:2015 cláusula 9.2 (Auditoría interna). ISO 19011:2018 (Directrices para la auditoría de los SGC). Manual de Calidad de SMAA ERP.",
        records: "Plan anual de auditorías. Programa de auditoría. Checklist. Acta de apertura. Acta de cierre. Informe de auditoría. Lista maestra de auditores calificados. Acciones correctivas derivadas.",
        nextReviewMonths: 12,
        approvedBy: "Responsable de Calidad",
        approvedRole: "Aseguramiento de Calidad"
    },
    {
        // ============ PRO-003 — ACCIONES CORRECTIVAS ============
        title: "Acciones Correctivas y Preventivas",
        keywords: "accion correctiva, no conformidad, causa raiz, 5 porques, 10.2",
        objective: "Eliminar las causas raíz de las no conformidades detectadas para evitar su recurrencia, y atender las no conformidades potenciales antes de que se materialicen.",
        scope: "Aplica a todas las no conformidades detectadas en cualquier proceso (auditorías, quejas, operación, indicadores fuera de meta). Comienza con la detección y registro de la NC, y termina con el cierre tras verificar la eficacia. Incluye tanto acciones correctivas (NC real) como preventivas (riesgo de NC).",
        definitions: "No conformidad (NC): incumplimiento de un requisito. Causa raíz: causa fundamental que origina la NC. 5 porqués: técnica de análisis que pregunta '¿por qué?' 5 veces. Acción correctiva: acción para eliminar la causa raíz. Acción preventiva: acción para eliminar causa potencial. Eficacia: capacidad de la acción para evitar la recurrencia.",
        responsibilities: "Reportante (cualquier colaborador): detecta y reporta la NC. Responsable del proceso afectado: analiza causa raíz, propone e implementa la acción. Responsable de Calidad: verifica la eficacia, registra y da seguimiento. Director General: aprueba acciones de alto impacto.",
        content: `1. **Detección y registro (inmediato)**
   1.1 Cualquier colaborador puede detectar una NC: producto defectuoso, desviación de proceso, queja del cliente, no cumplimiento de procedimiento, indicador fuera de meta, hallazgo de auditoría.
   1.2 Se registra en el formato 'Reporte de No Conformidad' (FOR-001) o directamente en el módulo de Calidad de la app con: fecha, proceso, descripción del problema, evidencia, reportante.

2. **Contención inmediata (24 h)**
   El responsable del proceso aísla el problema para que no afecte al cliente: separa producto no conforme, detiene el proceso afectado, informa al cliente si aplica.

3. **Análisis de causa raíz (5 días hábiles)**
   3.1 El responsable del proceso, con apoyo del Responsable de Calidad, realiza el análisis usando una o varias técnicas:
       - 5 porqués: ¿por qué ocurrió? (repetir hasta llegar a la causa fundamental).
       - Diagrama de espina de pescado (Ishikawa): 6 Ms (Mano de obra, Método, Máquina, Material, Medición, Medio ambiente).
       - Pareto: para NC recurrentes.
   3.2 Se documenta el análisis en el Reporte de NC.

4. **Definición de la acción correctiva (5 días hábiles)**
   4.1 La acción debe enfocarse en eliminar la causa raíz, no el síntoma.
   4.2 Se definen: acción, responsable, fecha compromiso, recursos, indicador de eficacia.

5. **Aprobación**
   5.1 NC menores: aprueba el Responsable del proceso.
   5.2 NC mayores o que afecten clientes: aprueba el Director General.

6. **Implementación**
   El responsable ejecuta la acción en la fecha compromiso. Si requiere cambio a un procedimiento, se sigue PRO-005 Información Documentada.

7. **Verificación de eficacia (30, 60 o 90 días después)**
   El Responsable de Calidad verifica que la NC no se haya repetido. Si se repite, se reabre el caso y se profundiza el análisis.

8. **Cierre**
   Solo se cierra cuando se confirma la eficacia. El registro se archiva en el módulo de Calidad.

9. **Análisis de tendencias (mensual)**
   El Responsable de Calidad analiza todas las NC del periodo, identifica patrones y presenta resultados en la Revisión por la Dirección (PRO-001).`,
        document_references: "ISO 9001:2015 cláusula 10.2 (No conformidad y acción correctiva). Formato FOR-001 Reporte de No Conformidad. Manual de Calidad.",
        records: "Reporte de NC (firmado y cerrado). Análisis de causa raíz. Plan de acción con seguimiento. Análisis mensual de tendencias.",
        nextReviewMonths: 12,
        approvedBy: "Responsable de Calidad",
        approvedRole: "Aseguramiento de Calidad"
    },
    {
        // ============ PRO-004 — ADMINISTRACIÓN Y FINANZAS ============
        title: "Administración y Finanzas",
        keywords: "finanzas, contabilidad, declaraciones, IVA, ISR, nomina, facturacion, 7.1",
        objective: "Asegurar la disponibilidad de recursos financieros, mantener la contabilidad al día y cumplir puntualmente con las obligaciones fiscales y de nómina de la empresa.",
        scope: "Aplica a todas las actividades financieras y contables: planeación presupuestal, registro contable, conciliaciones bancarias, nóminas, declaraciones mensuales, facturación, cobranza, pagos. Comienza con la planeación anual y termina con el cierre del ejercicio fiscal. No incluye auditoría financiera externa (la realiza un despacho contratado).",
        definitions: "IVA: Impuesto al Valor Agregado (16% general, 8% frontera). ISR: Impuesto Sobre la Renta. SAT: Servicio de Administración Tributaria. UMA: Unidad de Medida y Actualización. SBC: Salario Base de Cotización. Factura CFDI: Comprobante Fiscal Digital por Internet. DIOT: Declaración Informativa de Operaciones con Terceros. Pruebas: psql, Supabase.",
        responsibilities: "Director de Administración: aprueba presupuesto, declaraciones y pagos mayores. Contador: registra operaciones, calcula impuestos, presenta declaraciones. Auxiliar contable: captura facturas, archiva. Director General: aprueba presupuesto anual. SAT: receptor de declaraciones.",
        content: `1. **Planeación presupuestal anual (noviembre)**
   El Director de Administración coordina la elaboración del presupuesto del siguiente año con cada responsable de proceso. Se aprueba por el Director General antes del 31 de diciembre.

2. **Registro contable (diario)**
   - Facturas emitidas: el sistema las guarda en /issued-invoices automáticamente; el contador las revisa y las pasa al sistema contable.
   - Facturas recibidas (compras): se cargan en el buzón /invoice_inbox, se aprueban y se registran.
   - Movimientos bancarios: se capturan en /finance/movements.

3. **Conciliaciones bancarias (mensual)**
   El contador descarga el estado de cuenta, lo cruza contra /finance/movements y /finance/iva, identifica diferencias y las resuelve.

4. **Nóminas (quincenal o según periodo)**
   - El operador sube el archivo del checador en /finance/checador (ver PRO-006).
   - El Director de RH o el contador crea el periodo en /finance/payroll/new.
   - Se calcula la nómina con un click: deducciones de ISR (tabla oficial), IMSS (3% SBC), préstamos.
   - Se aprueba y se marca como pagada.
   - Se dispersa por transferencia bancaria.
   - Se emite recibo de nómina en PDF (botón en el detalle del periodo).

5. **Declaraciones mensuales (antes del día 17 del mes siguiente)**
   5.1 IVA: se crea la declaración en /finance/declarations/new. El sistema la pre-llena desde /finance/iva.
   5.2 ISR provisional: se capturan ingresos y deducciones en el detalle.
   5.3 DIOT: se valida la información de operaciones con terceros.
   5.4 Se presenta en el portal del SAT.
   5.5 Se sube el acuse del SAT (PDF) en la misma pantalla — el sistema extrae automáticamente el folio, periodo, monto y compara con nuestro cálculo.
   5.6 Si la diferencia es >0.5%, se documenta en 'Notas de la diferencia'.

6. **Cierre mensual (último día hábil)**
   El contador verifica que todas las operaciones estén registradas, las conciliaciones cuadradas, las declaraciones presentadas y los pagos al día. Archiva respaldos digitales.

7. **Cierre anual (enero del año siguiente)**
   - Declaración anual de ISR.
   - Cierre de libros contables.
   - Auditoría externa (despacho).
   - Dictamen fiscal si aplica.

8. **Cumplimiento fiscal**
   El Director de Administración se asegura de que el sistema tenga configurados correctamente los certificados de sello digital (CSD) y la contraseña del SAT para la facturación.`,
        document_references: "ISO 9001:2015 cláusula 7.1 (Recursos). Ley del IVA. Ley del ISR. Código Fiscal de la Federación. RMF vigente. Manual del Módulo de Nóminas y Contabilidad de SMAA ERP.",
        records: "Presupuesto anual. Pólizas contables. Conciliaciones bancarias. Recibos de nómina firmados. Declaraciones presentadas con acuses del SAT. Estados financieros mensuales. Cierre anual.",
        nextReviewMonths: 12,
        approvedBy: "Director de Administración y Finanzas",
        approvedRole: "Administración"
    },
    {
        // ============ PRO-005 — INFORMACIÓN DOCUMENTADA ============
        title: "Control de la Información Documentada",
        keywords: "documento, procedimiento, formato, manual, version, firma, obsoleto, 7.5",
        objective: "Asegurar que toda la información documentada requerida por el SGC esté disponible, sea adecuada para su uso, esté protegida y se controle adecuadamente durante su ciclo de vida.",
        scope: "Aplica a toda la documentación interna del SGC: procedimientos (PRO), registros (REG), formatos (FOR), manuales (MAN), políticas (POL), instrucciones (INS), planes (PLA) y documentos externos aplicables (normas ISO, legislacion, fichas técnicas de clientes). Comienza con la identificación de la necesidad documental y termina con la disposición final (archivo histórico o destrucción).",
        definitions: "Documento controlado: aquel con folio asignado, versionado y firmado. Documento vigente: aquel aprobado y dentro de su periodo de validez. Documento obsoleto: aquel reemplazado por una nueva versión. Folio: identificador único (PRO-001, REG-001). Revisión: número entero incremental. Versión: 1.0, 1.1, 2.0. Aprobador: persona con autoridad para firmar la aprobación.",
        responsibilities: "Responsable de Calidad: custodio del SGC, aprueba procedimientos, controla la lista maestra de documentos. Usuarios: utilizan la versión vigente. Aprobadores (Director General, Gerentes): firman según su autoridad. Creadores: elaboran y proponen el documento. TI: administra el módulo /documents y los respaldos.",
        content: `1. **Identificación de la necesidad documental**
   Cualquier colaborador puede solicitar un documento nuevo enviando su requerimiento al Responsable de Calidad, quien evalúa si es necesario y qué tipo de documento aplica (PRO, REG, FOR, etc.).

2. **Creación del documento**
   2.1 Se accede a /documents/new.
   2.2 Paso 1 — Identificación: seleccionar tipo, capturar título, autor, palabras clave, versión inicial (1.0).
   2.3 Paso 2 — Contenido ISO: objetivo, alcance (delimitando el inicio y fin del proceso), definiciones, responsabilidades, desarrollo (procedimiento paso a paso), referencias documentales, registros asociados.
   2.4 Paso 3 — Vigencia: fecha efectiva, próxima revisión (generalmente 12 meses).
   2.5 Al guardar, el sistema asigna automáticamente el folio siguiente: PRO-001, PRO-002, etc., basado en el prefijo del tipo.

3. **Revisión**
   El documento se marca como 'En revisión' y se envía a los aprobadores. Ellos pueden sugerir cambios que se incorporan a una nueva versión.

4. **Firma y aprobación**
   4.1 El aprobador (Director General para PRO y POL; Gerentes para FOR, INS, REG) abre el documento, captura su nombre y cargo, y firma con el dedo o mouse en el SignaturePad.
   4.2 Al firmar, el sistema: marca el documento como 'Vigente', captura la fecha efectiva si no estaba, guarda la firma como evidencia.

5. **Publicación y distribución**
   El documento vigente aparece automáticamente en /documents filtrado por estatus. La distribución al personal se realiza por:
   - Correo electrónico a las partes interesadas.
   - Mural o cartelera.
   - Reunión de inducción (si aplica).

6. **Control de cambios (cada edición)**
   6.1 Al editar un documento vigente, el sistema guarda automáticamente un snapshot en /document_versions con la versión anterior.
   6.2 Se incrementa la revisión y la versión (1.0 → 1.1 para cambios menores, 1.0 → 2.0 para cambios mayores).
   6.3 El aprobador debe volver a firmar.

7. **Obsolescencia**
   7.1 Un documento se marca como 'Por obsolescer' cuando va a ser reemplazado.
   7.2 Después de capacitar al personal en la nueva versión, se marca como 'Obsoleto' con motivo.
   7.3 Los documentos obsoletos permanecen en /documents pero se filtran por defecto para evitar confusiones. Se conservan 5 años para auditoría.

8. **Respaldo y protección**
   El módulo /documents está respaldado automáticamente en Supabase. Los archivos adjuntos (firmas, PDFs) están en el bucket 'finance_files' y 'signatures'. Acceso solo mediante login.

9. **Auditoría**
   La lista maestra de documentos vigentes y obsoletos se exporta a Excel y se entrega al auditor al inicio de cada auditoría.`,
        document_references: "ISO 9001:2015 cláusula 7.5 (Información documentada). Manual de Calidad. Lista maestra de documentos (REG-001).",
        records: "Lista maestra de documentos vigentes. Lista maestra de documentos obsoletos. Registro de firmas de aprobación. Snapshots de cada versión en /document_versions. Acuses de capacitación.",
        nextReviewMonths: 12,
        approvedBy: "Responsable de Calidad",
        approvedRole: "Aseguramiento de Calidad"
    },
    {
        // ============ PRO-006 — RECURSOS HUMANOS ============
        title: "Gestión de Recursos Humanos",
        keywords: "rh, personal, empleado, nomina, contratacion, capacitacion, 7.2",
        objective: "Asegurar que la empresa cuente con personal competente en cantidad y capacidad para operar eficazmente el SGC y satisfacer al cliente.",
        scope: "Aplica a todo el personal de la empresa: desde la identificación del puesto, reclutamiento, selección, contratación, inducción, capacitación, evaluación del desempeño, hasta la baja. Comienza con la detección de una necesidad de personal y termina con la baja y el finiquito. No incluye la relación con sindicatos (en caso de haberla, se maneja por separado).",
        definitions: "Competencia: capacidad demostrada para aplicar conocimientos y habilidades. Inducción: proceso de familiarización con la empresa, el puesto y el SGC. Capacitación: acciones para desarrollar o actualizar competencias. Evaluación de desempeño: revisión periódica del rendimiento. Finiquito: liquidación de derechos al término de la relación laboral. SBC: Salario Base de Cotización.",
        responsibilities: "Director de RH (o Director de Administración si no hay RH dedicado): recluta, selecciona, contrata, capacita, evalúa, paga. Gerentes de área: detectan necesidades, entrevistan candidatos, evalúan desempeño, autorizan movimientos de personal. Responsable de Calidad: define el programa de inducción al SGC. Trabajador: cumple con sus obligaciones y asiste a capacitaciones.",
        content: `1. **Identificación del puesto (descripción)**
   Cada puesto tiene su descripción: funciones, competencias requeridas (educación, experiencia, habilidades), responsabilidades, autoridad, riesgos. Esta descripción se almacena en el sistema como metadato del empleado.

2. **Reclutamiento y selección**
   2.1 El gerente del área solicita la vacante con justificación.
   2.2 RH publica la oferta en bolsas de trabajo, redes sociales, recomendaciones.
   2.3 Se reciben currículos y se filtran.
   2.4 Entrevistas (RH + gerente del área).
   2.5 Aplicación de pruebas (psicométricas, técnicas).
   2.6 Verificación de referencias.
   2.7 Selección final y oferta.

3. **Alta del empleado en el sistema**
   3.1 Captura de datos personales y fiscales en /finance/employees/new:
       - Datos personales: nombre, RFC, CURP, NSS, fecha de nacimiento.
       - Datos del puesto: código (EMP-001), puesto, departamento, fecha de alta.
       - Configuración de pago: tipo (mensual, quincenal, por hora, diario), salario base, factor de horas extra, jornada semanal.
       - Datos bancarios: banco, cuenta, CLABE.
       - Datos fiscales: modalidad IMSS, aplica subsidio al empleo.
   3.2 El sistema asigna automáticamente el siguiente código (EMP-001, EMP-002).

4. **Inducción al puesto y al SGC (primera semana)**
   4.1 Inducción a la empresa: historia, valores, organigrama.
   4.2 Inducción al SGC: política de calidad, objetivos, procedimientos clave (mínimo PRO-001, PRO-005, PRO-008, PRO-012 según aplique).
   4.3 Inducción al puesto específica: funciones, herramientas, equipo de protección personal, riesgos.
   4.4 Entrega de credencial, uniformes, EPP.

5. **Capacitación continua**
   5.1 Plan anual de capacitación definido por RH y el Responsable de Calidad.
   5.2 Incluye: ISO 9001, seguridad, operación específica, desarrollo humano.
   5.3 Se registra la asistencia y se evalúa la eficacia de la capacitación.
   5.4 Meta: mínimo 40 horas / empleado / año.

6. **Evaluación de desempeño (anual)**
   6.1 El gerente evalúa con un formato estándar (FOR-002).
   6.2 Se retroalimenta al empleado.
   6.3 Se identifican áreas de oportunidad y se planifica capacitación.

7. **Operación del módulo /finance**
   7.1 Bono y deducciones fijas se configuran en /finance/employees/[id].
   7.2 El archivo del checador se sube en /finance/checador (ver PRO-006 Recursos Humanos sección operación).
   7.3 Las nóminas se calculan automáticamente (ver PRO-004 Administración y Finanzas sección nóminas).

8. **Baja del empleado**
   8.1 Solicitud del gerente o renuncia del empleado.
   8.2 Entrevista de salida.
   8.3 Cálculo de finiquito (sueldos pendientes, vacaciones, aguinaldo proporcional, prima de antigüedad si aplica).
   8.4 Pago y firma de recibo de finiquito.
   8.5 En el sistema: cambiar estatus a 'terminated' y capturar fecha de baja.

9. **Expediente del empleado**
   Se mantiene un expediente físico y digital con: contrato, RFC, CURP, comprobante de domicilio, acta de nacimiento, NSS, documentos de capacitación, evaluaciones, finiquito.`,
        document_references: "ISO 9001:2015 cláusula 7.2 (Competencia). Ley Federal del Trabajo. Ley del Seguro Social. Ley del ISR (cálculo de nómina). Manual del Módulo de Nóminas y Contabilidad de SMAA ERP.",
        records: "Descripción de puesto. Contrato. Expediente del empleado. Plan anual de capacitación. Registros de asistencia. Evaluaciones de desempeño. Finiquitos firmados.",
        nextReviewMonths: 12,
        approvedBy: "Director de Recursos Humanos",
        approvedRole: "Recursos Humanos"
    },
    {
        // ============ PRO-007 — CLIENTE ============
        title: "Relación con el Cliente",
        keywords: "cliente, requisitos, cotizacion, satisfaccion, 8.2",
        objective: "Determinar, comprender y cumplir los requisitos del cliente para aumentar su satisfacción y construir relaciones de largo plazo.",
        scope: "Aplica a todas las interacciones con clientes: prospección, levantamiento de requisitos, cotización, confirmación, fabricación, entrega, postventa. Comienza con la identificación de un cliente potencial y termina con la entrega del producto o servicio y la confirmación de la satisfacción.",
        definitions: "Cliente: persona física o moral que adquiere productos o servicios. Requisito del cliente: necesidad o expectativa declarada (explícita) o implícita. RFQ: Request for Quotation. Cotización: propuesta económica formal. OT: Orden de Trabajo. Plazo de entrega: tiempo entre la confirmación y la entrega.",
        responsibilities: "Director Comercial: define la estrategia comercial, aprueba cotizaciones grandes. Vendedores: prospectan, levantan requisitos, cotizan, dan seguimiento. Ingenieria: apoyo técnico. Fabricación: produce. Calidad: verifica. Entregas: envía. Servicio al Cliente: postventa y quejas.",
        content: `1. **Prospección de clientes**
   1.1 El Director Comercial y los vendedores identifican clientes potenciales: bases de datos, referidos, redes sociales, eventos.
   1.2 Se da de alta el cliente en /clients con: datos fiscales (RFC, razón social, dirección, email), condiciones de pago, días de crédito, requiere anticipo, porcentaje de anticipo.

2. **Levantamiento de requisitos**
   2.1 El vendedor se reúne con el cliente (presencial, virtual o por correo).
   2.2 Identifica:
       - Producto o servicio solicitado.
       - Especificaciones técnicas (plano, tolerancias, materiales, normas aplicables).
       - Cantidad.
       - Plazo de entrega.
       - Precio objetivo.
       - Condiciones de pago.
       - Necesidades especiales (certificados, embalaje, entrega en sitio).
   2.3 Se documenta la conversación.

3. **Cotización (/sales/new)**
   3.1 El vendedor crea la cotización con los datos del cliente y los conceptos.
   3.2 Ingeniería calcula el costo si es necesario.
   3.3 Se aplica margen según tabla de precios.
   3.4 Se marca la cotización como 'Pending'.
   3.5 Se envía al cliente.

4. **Seguimiento (≤48 h)**
   El vendedor da seguimiento para resolver dudas y empujar la decisión.

5. **Confirmación**
   5.1 Si el cliente acepta, el vendedor cambia el status a 'Approved' en la cotización.
   5.2 La cotización aprobada se asocia a una nueva OT en /manufacturing/new. Si la cotización no estaba aprobada, se confirma en la misma pantalla de nueva OT (PRO-010 Ventas).
   5.3 La OT puede ser con o sin cotización anidada.

6. **Seguimiento durante fabricación**
   El vendedor informa al cliente sobre el avance, especialmente si hay desviaciones de plazo.

7. **Entrega (ver PRO-013 Logística)**
   Se entrega el producto y se firma de recibido.

8. **Postventa (ver PRO-008 Satisfacción y PRO-009 Quejas)**
   Se encuesta al cliente y se atienden quejas.`,
        document_references: "ISO 9001:2015 cláusula 8.2 (Requisitos para los productos y servicios). PRO-010 Ventas. PRO-013 Logística. PRO-008 Satisfacción del Cliente. PRO-009 Quejas.",
        records: "Cotización firmada por el cliente. Orden de Trabajo. Contrato (si aplica). Notas de venta. Correspondencia con el cliente. Encuesta de satisfacción. Quejas resueltas.",
        nextReviewMonths: 12,
        approvedBy: "Director Comercial",
        approvedRole: "Comercial"
    },
];
