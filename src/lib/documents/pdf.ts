import { createHash } from 'node:crypto';
import jsPDF, { GState } from 'jspdf';
import autoTable, { type CellHookData } from 'jspdf-autotable';
import type { DigitalField, DigitalRow, DigitalSection, DigitalTemplate, DigitalValues } from './schema';
import { calculateDigitalValues } from './calculations';

export type DigitalPdfInput = {
    template: DigitalTemplate;
    values: DigitalValues;
    folio: string;
    templateVersion: string;
    templateRevision: number;
    revision: number;
    status: 'draft' | 'finalized' | 'blank';
    authorName: string;
    savedAt: string;
};

const NAVY: [number, number, number] = [18, 33, 56];
const ORANGE: [number, number, number] = [234, 88, 12];
const MUTED: [number, number, number] = [87, 100, 117];
const PALE: [number, number, number] = [247, 249, 252];
const text = (value: unknown): string => String(value ?? '')
    .replace(/[\u2010-\u2015\u2212]/g, '-').replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"').replace(/\u2022/g, '-').replace(/\u2192/g, ' -> ')
    .replace(/\u2265/g, '>=').replace(/\u2264/g, '<=').replace(/\u2713/g, 'Sí');

function display(field: DigitalField, value: unknown, blank = false): string {
    if (field.type === 'signature') return typeof value === 'string' && value.startsWith('data:image/png;base64,') ? 'Firma registrada' : '';
    if (field.type === 'checkbox') return blank ? '' : value === true ? 'Sí' : value === false ? 'No' : '';
    return text(value);
}

/** Creates the exact PDF archived with a capture revision. No browser globals. */
export function generateDigitalPdf(input: DigitalPdfInput): { bytes: Buffer; sha256: string; pageCount: number } {
    const { template, values } = input;
    const widest = Math.max(0, ...template.sections.map(s => s.table?.columns.length || 0));
    const pdf = new jsPDF({ orientation: widest >= 7 || template.sections.some(s => s.flow) ? 'landscape' : 'portrait', unit: 'mm', format: 'a4', compress: true });
    const width = pdf.internal.pageSize.getWidth();
    const height = pdf.internal.pageSize.getHeight();
    const margin = 16;
    const contentWidth = width - margin * 2;
    const top = 48;
    const bottom = height - 18;
    const date = new Date(input.savedAt);
    if (!Number.isFinite(date.getTime())) throw new Error('Fecha de documento no válida.');
    pdf.setCreationDate(date);
    pdf.setFileId(createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 32).toUpperCase());
    pdf.setProperties({ title: `${template.code} ${template.title}`, subject: input.folio,
        author: 'SMAA S.A. de C.V.', creator: 'SMAA · Control de Documentos', keywords: `${template.code}, ${template.area}` });
    const decorated = new Set<number>();
    const shortDate = date.toLocaleString('es-MX', { timeZone: 'America/Chihuahua', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const status = input.status === 'blank' ? 'FORMATO EN BLANCO' : input.status === 'draft' ? 'BORRADOR' : 'FINALIZADO';

    function decorate() {
        const page = pdf.getCurrentPageInfo().pageNumber;
        if (decorated.has(page)) return;
        decorated.add(page);
        pdf.saveGraphicsState();
        pdf.setGState(new GState({ opacity: 0.045 }));
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(66);
        pdf.setTextColor(...NAVY);
        pdf.text('SMAA', width / 2, height / 2, { align: 'center', angle: 28 });
        if (input.status === 'draft') {
            pdf.setFontSize(28);
            pdf.text('BORRADOR', width / 2, height / 2 + 18, { align: 'center', angle: 28 });
        }
        pdf.restoreGraphicsState();
        pdf.setFillColor(...NAVY);
        pdf.rect(0, 0, width, 13, 'F');
        pdf.setFillColor(...ORANGE);
        pdf.rect(0, 13, width, 1.4, 'F');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(11);
        pdf.setTextColor(255, 255, 255);
        pdf.text('SMAA S.A. de C.V.', margin, 8.5);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.text('CONTROL DE DOCUMENTOS', width - margin, 8.5, { align: 'right' });
        pdf.setTextColor(...NAVY);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(9);
        pdf.text(text(template.code), margin, 22);
        pdf.text(status, width - margin, 22, { align: 'right' });
        pdf.setFontSize(12);
        const titleLines = pdf.splitTextToSize(text(template.title), contentWidth);
        pdf.text(titleLines.slice(0, 2), margin, 28.5);
        pdf.setFontSize(7.5);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(...MUTED);
        pdf.text(text(`Formato v${input.templateVersion} / rev. ${input.templateRevision} · Captura rev. ${input.revision || '-'} · ${input.folio}`), margin, 41);
        pdf.setDrawColor(218, 224, 232);
        pdf.setLineWidth(0.25);
        pdf.line(margin, 44, width - margin, 44);
    }
    decorate();
    let y = top;
    function newPage() { pdf.addPage(); decorate(); y = top; }
    function room(mm: number) { if (y + mm > bottom) newPage(); }
    function paragraph(value: string, size = 9, bold = false) {
        pdf.setFont('helvetica', bold ? 'bold' : 'normal');
        pdf.setFontSize(size);
        pdf.setTextColor(...NAVY);
        const lines: string[] = pdf.splitTextToSize(text(value), contentWidth);
        const lineHeight = size * 0.45;
        for (const line of lines) { room(lineHeight + 1); pdf.text(line, margin, y + lineHeight); y += lineHeight; }
        y += 2;
    }
    function heading(value: string) {
        room(16);
        pdf.setFillColor(...PALE);
        pdf.setDrawColor(228, 232, 239);
        pdf.roundedRect(margin, y, contentWidth, 8, 1.5, 1.5, 'FD');
        pdf.setFillColor(...ORANGE);
        pdf.rect(margin, y, 1.2, 8, 'F');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(9);
        pdf.setTextColor(...NAVY);
        const lines = pdf.splitTextToSize(text(value), contentWidth - 9);
        if (lines.length > 1) {
            // Long headings use their natural height instead of overlapping the content.
            pdf.setFillColor(...PALE);
            pdf.rect(margin + 1.4, y + 7, contentWidth - 1.4, (lines.length - 1) * 4, 'F');
        }
        pdf.text(lines, margin + 4, y + 5.2);
        y += 12 + (lines.length - 1) * 4;
    }
    function runTable(head: string[], body: (string | { content: string; styles: { minCellHeight: number } })[][],
        onDraw?: (data: CellHookData) => void, columnStyles?: Record<number, { cellWidth: number }>) {
        room(15);
        autoTable(pdf, {
            startY: y, margin: { top, right: margin, bottom: 18, left: margin },
            head: [head.map(text)], body, theme: 'grid', pageBreak: 'auto', rowPageBreak: 'avoid',
            styles: { font: 'helvetica', fontSize: 8, cellPadding: 2.3, textColor: NAVY,
                lineColor: [220, 225, 233], lineWidth: 0.15, overflow: 'linebreak', valign: 'top' },
            headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
            alternateRowStyles: { fillColor: [250, 251, 253] }, columnStyles,
            willDrawPage: decorate,
            didDrawCell: onDraw,
        });
        y = ((pdf as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY || y) + 6;
    }
    function signature(data: CellHookData, value: unknown) {
        if (data.section !== 'body' || typeof value !== 'string' || !value.startsWith('data:image/png;base64,')) return;
        const properties = pdf.getImageProperties(value);
        const maxWidth = data.cell.width - 5;
        const maxHeight = data.cell.height - 9;
        const scale = Math.min(maxWidth / properties.width, maxHeight / properties.height);
        if (scale > 0) pdf.addImage(value, 'PNG', data.cell.x + 2.5, data.cell.y + 7,
            properties.width * scale, properties.height * scale, undefined, 'FAST');
    }
    function drawFlow(flow: NonNullable<DigitalSection['flow']>, title = 'Diagrama del proceso') {
        if (!flow.nodes.length) return;
        const rowCoordinates = [...new Set(flow.nodes.map(node => node.y))].sort((a, b) => a - b);
        const byId = new Map(flow.nodes.map((node, index) => [node.id,
            { ...node, number: index + 1, row: rowCoordinates.indexOf(node.y) }]));
        const sorted = [...byId.values()].sort((a, b) => a.y - b.y || a.x - b.x);
        const scale = contentWidth / Math.max(flow.width, 1);
        const usableHeight = bottom - top - 14;
        const boxHeight = 13;
        const rowPitch = 17;
        const maxRows = Math.max(1, Math.floor((usableHeight + rowPitch - boxHeight) / rowPitch));
        const parts = Math.ceil(rowCoordinates.length / maxRows);
        const rowsPerPart = Math.ceil(rowCoordinates.length / parts);
        // Keep original columns and connections, compress vertical whitespace,
        // and balance pages so a final node never occupies a page by itself.
        const bands: typeof sorted[] = Array.from({ length: parts }, (_, part) => sorted.filter(node =>
            node.row >= part * rowsPerPart && node.row < (part + 1) * rowsPerPart));
        const arrow = (x1: number, y1: number, x2: number, y2: number) => {
            pdf.setDrawColor(...ORANGE); pdf.setLineWidth(0.45); pdf.line(x1, y1, x2, y2);
            const angle = Math.atan2(y2 - y1, x2 - x1);
            const len = 2;
            pdf.line(x2, y2, x2 - len * Math.cos(angle - 0.5), y2 - len * Math.sin(angle - 0.5));
            pdf.line(x2, y2, x2 - len * Math.cos(angle + 0.5), y2 - len * Math.sin(angle + 0.5));
        };
        for (const [part, band] of bands.entries()) {
            newPage();
            paragraph(`${title} · Parte ${part + 1} de ${bands.length}`, 9, true);
            const originY = y + 3;
            const minRow = band[0].row;
            const inBand = new Set(band.map(n => n.id));
            const at = (node: typeof sorted[number]) => ({ x: margin + node.x * scale, y: originY + (node.row - minRow) * rowPitch,
                w: node.width * scale, h: boxHeight });
            // Edges are drawn first, so the nodes keep their text unobstructed.
            for (const edge of flow.edges) {
                const from = byId.get(edge.from), to = byId.get(edge.to);
                if (!from || !to || (!inBand.has(from.id) && !inBand.has(to.id))) continue;
                const f = at(from), t = at(to);
                pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor(...MUTED);
                if (inBand.has(from.id) && inBand.has(to.id)) {
                    const downward = to.y > from.y + from.height / 2;
                    const upward = to.y + to.height < from.y;
                    if (!downward && !upward) {
                        const right = to.x > from.x;
                        const sx = right ? f.x + f.w : f.x, tx = right ? t.x : t.x + t.w;
                        arrow(sx, f.y + f.h / 2, tx, t.y + t.h / 2);
                        if (edge.label) pdf.text(text(edge.label), (sx + tx) / 2, (f.y + t.y) / 2 + f.h / 2 - 1, { align: 'center' });
                        continue;
                    }
                    const sx = f.x + f.w / 2, sy = downward ? f.y + f.h : upward ? f.y : f.y + f.h / 2;
                    const tx = t.x + t.w / 2, ty = downward ? t.y : upward ? t.y + t.h : t.y + t.h / 2;
                    const middle = (sy + ty) / 2;
                    pdf.setDrawColor(...ORANGE); pdf.setLineWidth(0.45);
                    pdf.line(sx, sy, sx, middle); pdf.line(sx, middle, tx, middle); arrow(tx, middle, tx, ty);
                    if (edge.label) pdf.text(text(edge.label), (sx + tx) / 2 + 2, middle - 1);
                } else if (inBand.has(from.id)) {
                    const down = to.y > from.y;
                    const sx = f.x + f.w / 2, sy = down ? f.y + f.h : f.y;
                    const ey = down ? Math.min(bottom - 3, sy + 8) : Math.max(originY - 1, sy - 6);
                    arrow(sx, sy, sx, ey);
                    pdf.text(text(`${edge.label ? `${edge.label}: ` : ''}Paso ${to.number} en otra parte`), sx + 3, ey);
                } else {
                    const down = from.y < to.y;
                    const tx = t.x + t.w / 2, ty = down ? t.y : t.y + t.h;
                    arrow(tx, down ? Math.max(originY - 1, ty - 7) : Math.min(bottom - 2, ty + 7), tx, ty);
                }
            }
            for (const node of band) {
                const box = at(node);
                pdf.setFillColor(...(node.decision ? [255, 242, 232] as [number, number, number] : PALE));
                pdf.setDrawColor(...NAVY); pdf.setLineWidth(0.35);
                if (node.decision) {
                    pdf.lines([[box.w / 2, box.h / 2], [-box.w / 2, box.h / 2], [-box.w / 2, -box.h / 2], [box.w / 2, -box.h / 2]], box.x + box.w / 2, box.y, [1, 1], 'FD', true);
                } else pdf.roundedRect(box.x, box.y, box.w, box.h, 1.5, 1.5, 'FD');
                pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(...NAVY);
                const textWidth = box.w * (node.decision ? 0.66 : 0.9);
                const lines: string[] = pdf.splitTextToSize(text(`${node.number}. ${node.label}`), textWidth);
                const maxLines = Math.max(1, Math.floor((box.h - 3) / 3.1));
                const visible = lines.slice(0, maxLines);
                if (lines.length > maxLines) visible[visible.length - 1] = `${visible.at(-1)?.slice(0, -3)}...`;
                pdf.text(visible, box.x + box.w / 2, box.y + (box.h - visible.length * 3.1) / 2 + 2.3, { align: 'center', lineHeightFactor: 1.15 });
            }
            y = Math.max(...band.map(node => at(node).y + at(node).h)) + 8;
        }
        newPage();
        heading('Pasos y conexiones del diagrama');
        runTable(['Paso', 'Actividad o decisión'], [...byId.values()].map(node => [String(node.number), text(node.label)]));
        runTable(['Desde', 'Hacia', 'Condición'], flow.edges.map(edge => [
            String(byId.get(edge.from)?.number ?? edge.from), String(byId.get(edge.to)?.number ?? edge.to), text(edge.label || 'Continuación'),
        ]));
    }

    runTable(['Folio de captura', 'Responsable', 'Fecha de guardado'], [[text(input.folio), text(input.authorName || 'Sin captura'), shortDate]]);
    if (template.needsAdaptation) {
        paragraph('Contenido de referencia para SMAA S.A. de C.V. Pendiente de revisión y adaptación antes de su aprobación.', 8);
    }
    if (input.status === 'blank') paragraph('Formato en blanco. Los espacios de captura y firma se completan al realizar la actividad.', 8);
    if (template.description) paragraph(template.description, 8);

    for (const section of template.sections) {
        if (section.flow && !section.paragraphs?.length && !section.fields?.length && !section.table) {
            drawFlow(section.flow, section.title);
            continue;
        }
        // Keep a section title, its short instructions and its first data row
        // together. Otherwise autoTable can leave the heading on the prior page.
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9);
        const instructionHeight = (section.paragraphs || []).reduce((sum, p) =>
            sum + pdf.splitTextToSize(text(p), contentWidth).length * 4.05 + 2, 0);
        const headingHeight = 12 + (pdf.splitTextToSize(text(section.title), contentWidth - 9).length - 1) * 4;
        const lineHeight = (value: string, cellWidth: number, size = 8, bold = false) => {
            pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size);
            return pdf.splitTextToSize(text(value), Math.max(8, cellWidth - 4.6)).length * size * 0.405 + 4.6;
        };
        let firstBlock = 8;
        if (section.fields?.length) {
            const labelWidth = Math.min(65, contentWidth * 0.32);
            const heights = section.fields.map(field => Math.max(field.type === 'signature' ? 26 : 8,
                lineHeight(field.label, labelWidth), lineHeight(display(field, values[field.key]), contentWidth - labelWidth)));
            const completeBlock = 8 + heights.reduce((sum, height) => sum + height, 0);
            // Small approval blocks stay intact, including the date after a signature.
            const availableOnFreshPage = bottom - top - headingHeight - Math.min(instructionHeight, 60);
            firstBlock = completeBlock <= availableOnFreshPage ? completeBlock : 8 + heights[0];
        } else if (section.table) {
            const table = section.table;
            const cols = table.columns.length > 8 ? [table.columns[0], ...table.columns.slice(1, 7)] : table.columns;
            const cellWidth = (contentWidth - 10) / cols.length;
            const sourceRows = values[table.key];
            const firstRow = (Array.isArray(sourceRows) ? sourceRows[0] : {}) as DigitalRow | undefined;
            const headHeight = Math.max(...cols.map(field => lineHeight(field.label, cellWidth, 7.5, true)));
            const rowHeight = Math.max(8, ...cols.map(field => field.type === 'signature' ? 26 :
                lineHeight(display(field, firstRow?.[field.key]), cellWidth)));
            firstBlock = headHeight + rowHeight + (table.label !== section.title || table.columns.length > 8 ? 6 : 0) + 3;
        }
        room(Math.min(bottom - top, headingHeight + Math.min(instructionHeight, 60) + firstBlock));
        heading(section.title);
        for (const p of section.paragraphs || []) paragraph(p);
        if (section.flow) drawFlow(section.flow);
        if (section.fields?.length) {
            const fields = section.fields;
            runTable(['Campo', 'Información'], fields.map(field => [text(field.label), field.type === 'signature'
                ? { content: display(field, values[field.key], input.status === 'blank'), styles: { minCellHeight: 26 } }
                : display(field, values[field.key], input.status === 'blank')]), data => {
                if (data.column.index === 1) signature(data, values[fields[data.row.index]?.key]);
            }, { 0: { cellWidth: Math.min(65, contentWidth * 0.32) } });
        }
        if (!section.table) continue;
        const table = section.table;
        const rows = (Array.isArray(values[table.key]) ? values[table.key] : []) as DigitalRow[];
        const printableRows = rows.length ? rows : [Object.fromEntries(table.columns.map(c => [c.key, ''])) as DigitalRow];
        // Wide spreadsheets are printed in readable column groups, repeating the
        // row number and first identifying column. Every source column is retained.
        const groups: DigitalField[][] = table.columns.length <= 8 ? [table.columns] :
            Array.from({ length: Math.ceil((table.columns.length - 1) / 6) }, (_, i) =>
                [table.columns[0], ...table.columns.slice(1 + i * 6, 1 + (i + 1) * 6)]);
        for (let group = 0; group < groups.length; group++) {
            const columns = groups[group];
            if (groups.length > 1) {
                const cellWidth = (contentWidth - 10) / columns.length;
                const headHeight = Math.max(...columns.map(field => lineHeight(field.label, cellWidth, 7.5, true)));
                const rowHeight = Math.max(8, ...columns.map(field => field.type === 'signature' ? 26 :
                    lineHeight(display(field, printableRows[0]?.[field.key]), cellWidth)));
                room(6 + headHeight + rowHeight + 3);
                paragraph(`${table.label} · Parte ${group + 1} de ${groups.length}`, 8, true);
            } else if (table.label !== section.title) paragraph(table.label, 8, true);
            runTable(['N.º', ...columns.map(c => c.label)], printableRows.map((row, i) => [String(i + 1), ...columns.map(field =>
                field.type === 'signature' ? { content: display(field, row[field.key], input.status === 'blank'), styles: { minCellHeight: 26 } } : display(field, row[field.key], input.status === 'blank'))]),
            data => {
                if (data.column.index > 0) signature(data, printableRows[data.row.index]?.[columns[data.column.index - 1]?.key]);
            }, { 0: { cellWidth: 10 } });
        }
    }
    if (input.status !== 'blank') {
        const summary = calculateDigitalValues(template, values);
        if (summary.length) { heading('Resumen calculado'); runTable(['Concepto', 'Resultado'], summary.map(s => [text(s.label), text(s.value)])); }
    }
    const pages = pdf.getNumberOfPages();
    for (let page = 1; page <= pages; page++) {
        pdf.setPage(page);
        pdf.setDrawColor(218, 224, 232);
        pdf.line(margin, height - 13, width - margin, height - 13);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7);
        pdf.setTextColor(...MUTED);
        pdf.text(text(`${template.code} · ${input.folio} · ${status}`), margin, height - 8);
        pdf.text(`Página ${page} de ${pages}`, width - margin, height - 8, { align: 'right' });
    }
    const bytes = Buffer.from(pdf.output('arraybuffer'));
    return { bytes, sha256: createHash('sha256').update(bytes).digest('hex'), pageCount: pages };
}
