-- =====================================================
-- Seed inicial: definiciones de las escalas PFMEA y 5 riesgos de ejemplo.
--
-- Escalas (5 niveles cada una):
--   severity:   1=bajo ... 5=alto (impacto en el cliente / seguridad / calidad)
--   occurrence: 1=ocurre una vez al mes ... 5=varias veces por turno
--   detection:  1=se detecta rápido (fácil) ... 5=difícil de detectar
--
-- 5 riesgos seedeados: cubren procesos típicos de manufactura / CNC.
-- Idempotente: ON CONFLICT hace skip.
-- =====================================================

-- Definiciones de las escalas
INSERT INTO public.pfmea_scales (scale_type, level, label, description) VALUES
    -- SEVERITY (impacto)
    ('severity', 1, 'Bajo',          'Impacto menor. El cliente probablemente no lo nota.'),
    ('severity', 2, 'Menor',         'Impacto leve. Causa inconvenientes menores.'),
    ('severity', 3, 'Moderado',      'Impacto medio. Genera retrabajo o desperdicio.'),
    ('severity', 4, 'Alto',          'Impacto alto. Cliente insatisfecho, posible paro de línea.'),
    ('severity', 5, 'Crítico',       'Impacto crítico. Riesgo de seguridad, incumplimiento normativo o paro total.'),

    -- OCCURRENCE (frecuencia)
    ('occurrence', 1, 'Muy rara',     'Ocurre una vez al mes o menos.'),
    ('occurrence', 2, 'Rara',         'Ocurre una vez por semana.'),
    ('occurrence', 3, 'Ocasional',    'Ocurre una vez al día.'),
    ('occurrence', 4, 'Frecuente',    'Ocurre una vez por turno.'),
    ('occurrence', 5, 'Muy frecuente','Ocurre varias veces por turno.'),

    -- DETECTION (dificultad de detección)
    ('detection', 1, 'Casi cierta',  'Se detecta al instante con un control automático o visual obvio.'),
    ('detection', 2, 'Alta',         'Se detecta con un control de operador en línea.'),
    ('detection', 3, 'Moderada',     'Se detecta con inspección posterior o muestreo.'),
    ('detection', 4, 'Baja',         'Difícil de detectar. Solo con auditoría o cuando llega al cliente.'),
    ('detection', 5, 'Casi imposible','Casi imposible de detectar antes de que llegue al cliente.')
ON CONFLICT (scale_type, level) DO UPDATE SET
    label = EXCLUDED.label,
    description = EXCLUDED.description;

-- 5 riesgos de ejemplo (procesos típicos de manufactura CNC)
INSERT INTO public.pfmea_risks (
    process, failure_mode, effect, cause,
    severity, occurrence, detection,
    current_controls, recommended_actions, responsible, target_date,
    status, notes
) VALUES
    -- 1) Desgaste de herramienta
    (
        'Maquinado CNC — Torneado',
        'Desgaste prematuro de la herramienta de corte',
        'Pieza fuera de tolerancia dimensional, retrabajo o scrap',
        'Avance excesivo, material más duro de lo especificado, falta de lubricación',
        4, 3, 2,
        'Inspección visual cada 50 piezas; control de horas-vida de inserto.',
        'Implementar monitoreo de carga del husillo (sensor de corriente) y cambiar a sistema de cambio automático con contador de piezas.',
        'Jefe de Producción',
        (CURRENT_DATE + INTERVAL '60 days'),
        'open',
        'Riesgo típico cuando se maquilan lotes largos de acero inoxidable.'
    ),
    -- 2) Soldadura con porosidad
    (
        'Soldadura MIG — Estructuras',
        'Porosidad en cordón de soldadura',
        'Debilitamiento de la unión, posible fractura bajo carga, rechazo de cliente',
        'Gas de protección insuficiente, superficie sucia, viento en área de soldadura',
        5, 2, 3,
        'Inspección visual del soldador; prueba de líquido penetrante en muestreo.',
        'Instalar cabina de soldadura con extracción de aire; cambiar a mezclas de gas con mayor contenido de argón; capacitar en limpieza de pieza.',
        'Responsable de Calidad',
        (CURRENT_DATE + INTERVAL '45 days'),
        'in_progress',
        'Afecta directamente la calificación del proceso ante clientes aeroespaciales.'
    ),
    -- 3) Error en programación CNC
    (
        'Maquinado CNC — Programación',
        'Código G incorrecto: colisión o dimensiones erróneas',
        'Daño a herramienta, pieza o máquina; paro de producción no planificado',
        'Error de tipeo, mal entendimiento del plano, fixture no considerado en el postprocesador',
        5, 2, 4,
        'Simulación en software CAM antes de llevar a máquina; primera pieza revisada por QC.',
        'Implementar checklist obligatorio de programación; usar software CAM con postprocesadores validados; simulación 3D obligatoria para piezas nuevas.',
        'Ingeniero de Procesos',
        (CURRENT_DATE + INTERVAL '30 days'),
        'open',
        'Riesgo histórico: al menos 1 incidente por trimestre en los últimos 2 años.'
    ),
    -- 4) Materia prima fuera de especificación
    (
        'Recepción de materiales',
        'Materia prima con certificado de calidad falsificado o composición incorrecta',
        'Piezas defectuosas que solo se detectan al final del proceso; posible afectación al cliente',
        'Proveedor no auditado, dependencia de certificados sin trazabilidad',
        5, 1, 5,
        'Inspección dimensional al recibir; verificación del certificado con el proveedor cuando hay duda.',
        'Auditar proveedores críticos anualmente; exigir certificados digitales verificables; implementar prueba de composición por fluorescencia de rayos X en muestreo.',
        'Jefe de Compras + Calidad',
        (CURRENT_DATE + INTERVAL '90 days'),
        'open',
        'Detección muy difícil: por eso RPN alto aunque la ocurrencia sea baja.'
    ),
    -- 5) Falla en tratamiento térmico
    (
        'Tratamiento térmico — Temple',
        'Dureza fuera de especificación por temperatura o tiempo incorrectos',
        'Pieza con propiedades mecánicas insuficientes, posible falla en servicio',
        'Calibración vencida del horno, error del operador al cargar el lote, falla en el control de temperatura',
        5, 2, 4,
        'Verificación de dureza Rockwell en muestreo de cada lote; bitácora de mantenimiento del horno.',
        'Termopares con calibración trazable cada 6 meses; sistema de registro continuo de temperatura con alarmas; segunda verificación de dureza 100% en piezas críticas.',
        'Responsable de Calidad',
        (CURRENT_DATE + INTERVAL '75 days'),
        'open',
        'Aplica a todos los lotes de aceros bonificados.'
    )
ON CONFLICT DO NOTHING;
