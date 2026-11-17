import type { DigitalRow, DigitalTemplate, DigitalValues } from './schema';

export type DigitalCalculation = { label: string; value: string };

function numberValue(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string' || value.trim() === '') return null;
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
}

function tableRows(values: DigitalValues, key: string): DigitalRow[] {
    const value = values[key];
    return Array.isArray(value) ? value : [];
}

const decimal = (value: number) => new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 }).format(value);
const percentage = (real: number | null, planned: number | null, complete = true): string => {
    if (!complete || planned === null || real === null) return 'Sin datos completos';
    if (planned === 0) return 'No disponible: presupuesto igual a cero';
    return `${decimal(real / planned * 100)} %`;
};

function sumPresent(values: (number | null)[]): number | null {
    const present = values.filter((value): value is number => value !== null);
    return present.length ? present.reduce((sum, value) => sum + value, 0) : null;
}

const monthNames = [
    ['ene', 'Enero'], ['feb', 'Febrero'], ['mar', 'Marzo'], ['abr', 'Abril'], ['may', 'Mayo'], ['jun', 'Junio'],
    ['jul', 'Julio'], ['ago', 'Agosto'], ['sep', 'Septiembre'], ['oct', 'Octubre'], ['nov', 'Noviembre'], ['dic', 'Diciembre'],
];

/** Summaries are derived from saved answers; blank inputs remain distinguishable from zero. */
export function calculateDigitalValues(template: DigitalTemplate, values: DigitalValues): DigitalCalculation[] {
    if (template.key === 'evaluacion-proveedores-desempeno') {
        return tableRows(values, 'proveedores').flatMap((row, index) => {
            const scores = ['precios', 'atencion_cotizacion', 'tiempo_entrega', 'domicilio'].map(key => numberValue(row[key]));
            const name = String(row.proveedor || `Proveedor ${index + 1}`);
            const complete = scores.every(score => score !== null);
            const subtotal = complete ? (scores as number[]).reduce((sum, score) => sum + score, 0) : null;
            const manual = numberValue(row.calificacion_total);
            return [
                { label: `${name}: subtotal de cuatro criterios`, value: subtotal === null ? 'Faltan valoraciones' : decimal(subtotal) },
                { label: `${name}: calificación registrada`, value: manual === null ? 'Sin captura' : decimal(manual) },
                ...(subtotal !== null && manual !== null && subtotal !== manual
                    ? [{ label: `${name}: diferencia documentada`, value: String(row.justificacion_total || 'Registre la justificación de la calificación manual') }] : []),
            ];
        });
    }
    if (template.key === 'resultados-auditoria-requisitos' || template.key === 'resultados-auditoria-procesos') {
        const rows = tableRows(values, 'hallazgos');
        const categories = [['mayor', 'No conformidades mayores'], ['menor', 'No conformidades menores'], ['observacion', 'Observaciones'], ['mejora', 'Oportunidades de mejora']];
        const totals = categories.map(([key, label]) => ({ label, total: sumPresent(rows.map(row => numberValue(row[key]))) }));
        const output: DigitalCalculation[] = totals.map(({ label, total }) => ({ label, value: total === null ? 'Sin captura' : decimal(total) }));
        rows.forEach((row, index) => {
            const total = sumPresent(categories.map(([key]) => numberValue(row[key])));
            if (total !== null) output.push({ label: `Total ${String(row.clausula || row.proceso || `fila ${index + 1}`)}`, value: decimal(total) });
        });
        const total = sumPresent(totals.map(item => item.total));
        output.push({ label: 'Total de hallazgos capturados', value: total === null ? 'Sin captura' : decimal(total) });
        return output;
    }

    if (template.key === 'planeacion-presupuesto') {
        const rows = tableRows(values, 'presupuesto');
        const currency = values.moneda === 'MXN' || values.moneda === 'USD' ? ` ${values.moneda}` : '';
        const money = (value: number | null) => value === null ? 'Sin captura' : `${decimal(value)}${currency}`;
        const output: DigitalCalculation[] = [];
        const components = new Map<string, { planned: (number | null)[]; real: (number | null)[]; complete: boolean }>();
        const plannedTotals: (number | null)[] = [];
        const realTotals: (number | null)[] = [];
        const activeRows = rows.filter(row => String(row.actividad || '').trim() || monthNames.some(([month]) => numberValue(row[`${month}_programado`]) !== null || numberValue(row[`${month}_real`]) !== null));
        activeRows.forEach((row, index) => {
            const planned = sumPresent(monthNames.map(([month]) => numberValue(row[`${month}_programado`])));
            const real = sumPresent(monthNames.map(([month]) => numberValue(row[`${month}_real`])));
            const complete = monthNames.every(([month]) => numberValue(row[`${month}_programado`]) !== null && numberValue(row[`${month}_real`]) !== null);
            const name = String(row.actividad || `Actividad ${index + 1}`);
            output.push({ label: `${name}: programado anual capturado`, value: money(planned) });
            output.push({ label: `${name}: real anual capturado`, value: money(real) });
            output.push({ label: `${name}: porcentaje de ejercicio`, value: percentage(real, planned, complete) });
            plannedTotals.push(planned);
            realTotals.push(real);
            const program = String(row.id_programa || '').trim();
            const componentId = String(row.id_componente || '').trim();
            const componentName = String(row.componente || '').trim();
            if (componentId || componentName) {
                const componentKey = `${program ? `${program} / ` : ''}${componentId ? `${componentId} ` : ''}${componentName}`.trim();
                const component = components.get(componentKey) || { planned: [], real: [], complete: true };
                component.planned.push(planned);
                component.real.push(real);
                component.complete = component.complete && complete;
                components.set(componentKey, component);
            }
        });
        for (const [name, totals] of components) {
            const planned = sumPresent(totals.planned);
            const real = sumPresent(totals.real);
            output.push({ label: `Componente ${name}: programado`, value: money(planned) });
            output.push({ label: `Componente ${name}: real`, value: money(real) });
            output.push({ label: `Componente ${name}: porcentaje de ejercicio`, value: percentage(real, planned, totals.complete) });
        }
        for (const [month, name] of monthNames) {
            const planned = sumPresent(activeRows.map(row => numberValue(row[`${month}_programado`])));
            const real = sumPresent(activeRows.map(row => numberValue(row[`${month}_real`])));
            if (planned === null && real === null) continue;
            output.push({ label: `${name}: total programado`, value: money(planned) });
            output.push({ label: `${name}: total real`, value: money(real) });
            const complete = activeRows.every(row => numberValue(row[`${month}_programado`]) !== null && numberValue(row[`${month}_real`]) !== null);
            output.push({ label: `${name}: porcentaje global`, value: percentage(real, planned, complete) });
        }
        const planned = sumPresent(plannedTotals);
        const real = sumPresent(realTotals);
        output.push({ label: 'Total anual programado capturado', value: money(planned) });
        output.push({ label: 'Total anual real capturado', value: money(real) });
        const complete = activeRows.length > 0 && activeRows.every(row => monthNames.every(([month]) => numberValue(row[`${month}_programado`]) !== null && numberValue(row[`${month}_real`]) !== null));
        output.push({ label: 'Porcentaje global de ejercicio', value: percentage(real, planned, complete) });
        if (!complete) {
            output.push({ label: 'Cobertura de importes', value: 'Hay meses sin captura. Los totales incluyen únicamente importes capturados; registre 0 cuando corresponda un importe cero.' });
        }
        return output;
    }

    if (template.key === 'deteccion-necesidades-capacitacion') {
        const rows = tableRows(values, 'cursos').filter(row => String(row.curso || '').trim());
        const hours = sumPresent(rows.map(row => numberValue(row.duracion)));
        return [
            { label: 'Cursos detectados', value: String(rows.length) },
            { label: 'Cursos prioridad A', value: String(rows.filter(row => String(row.prioridad || '').startsWith('A ')).length) },
            { label: 'Cursos prioridad B', value: String(rows.filter(row => String(row.prioridad || '').startsWith('B ')).length) },
            { label: 'Cursos sin prioridad asignada', value: String(rows.filter(row => !String(row.prioridad || '').startsWith('A ') && !String(row.prioridad || '').startsWith('B ')).length) },
            { label: 'Duración acumulada de cursos capturada', value: hours === null ? 'Sin captura' : `${decimal(hours)} horas` },
        ];
    }

    if (template.key === 'checklist-proveedor-potencial') {
        const rows = tableRows(values, 'requisitos');
        return [
            { label: 'Requisitos entregados', value: String(rows.filter(row => row.entregado === 'Sí').length) },
            { label: 'Requisitos no entregados', value: String(rows.filter(row => row.entregado === 'No').length) },
            { label: 'Requisitos que no aplican', value: String(rows.filter(row => row.entregado === 'No aplica').length) },
            { label: 'Requisitos pendientes de revisión', value: String(rows.filter(row => !['Sí', 'No', 'No aplica'].includes(String(row.entregado || ''))).length) },
        ];
    }

    if (template.key === 'matriz-control-cambios') {
        const rows = tableRows(values, 'cronograma').filter(row => String(row.actividad || '').trim());
        return ['Cumplida', 'En proceso', 'Reprogramada'].map(state => ({ label: `Actividades: ${state.toLowerCase()}`, value: String(rows.filter(row => row.estado === state).length) }));
    }

    return [];
}
