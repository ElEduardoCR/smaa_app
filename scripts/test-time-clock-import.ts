import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';

import {
    calculateWorkedMinutes,
    detectAttendanceMappings,
    interpretTimeClockFile,
    mergeTimeClockMarks,
    normalizeAttendanceSheets,
    parseDateValue,
    parseTimeValue,
    readSpreadsheet,
    type SpreadsheetSheet,
} from '../src/lib/timeClockImport';

async function main() {
    const wide: SpreadsheetSheet[] = [{
        name: 'Asistencia',
        rows: [
            ['Reporte semanal'],
            ['ID de empleado', 'Fecha', 'Hora de entrada', 'Hora de salida', 'Total horas'],
            ['EMP-005', '01/09/2026', '08:00', '17:15', 9.25],
            ['EMP006', '02/09/2026', '09:30', null, null],
        ],
    }];
    const wideMappings = detectAttendanceMappings(wide);
    assert.equal(wideMappings.length, 1);
    const wideResult = normalizeAttendanceSheets(wide, wideMappings);
    assert.deepEqual(wideResult.records[0], {
        employeeCode: 'EMP005',
        workDate: '2026-09-01',
        checkIn: '08:00:00',
        checkOut: '17:15:00',
        sourceTotalMinutes: 555,
    });
    assert.equal(wideResult.records[1].checkOut, null);

    const long: SpreadsheetSheet[] = [{
        name: 'Marcajes',
        rows: [
            ['Código empleado', 'Fecha', 'Hora', 'Estado de asistencia'],
            ['EMP007', '02/09/2026', '22:00', 'Entrada'],
            ['EMP007', '02/09/2026', '06:00', 'Salida'],
            ['EMP008', '02/09/2026', '08:00', 'Desconocido'],
        ],
    }];
    const longResult = normalizeAttendanceSheets(long, detectAttendanceMappings(long));
    assert.equal(longResult.records.length, 1);
    assert.equal(longResult.records[0].checkIn, '22:00:00');
    assert.equal(longResult.records[0].checkOut, '06:00:00');
    assert.equal(calculateWorkedMinutes('22:00:00', '06:00:00'), 480);
    assert.ok(longResult.warnings.some((warning) => warning.includes('no reconocido')));

    const incomplete = mergeTimeClockMarks(
        { checkIn: '08:00:00', checkOut: null },
        { checkIn: '08:00:00', checkOut: '17:00:00' },
    );
    assert.equal(incomplete.changed, true);
    assert.equal(incomplete.conflict, false);
    assert.equal(incomplete.workedMinutes, 540);

    const duplicate = mergeTimeClockMarks(
        { checkIn: '08:00:00', checkOut: '17:00:00' },
        { checkIn: '08:00:00', checkOut: '17:00:00' },
    );
    assert.equal(duplicate.changed, false);
    assert.equal(duplicate.conflict, false);

    const conflict = mergeTimeClockMarks(
        { checkIn: '08:00:00', checkOut: null },
        { checkIn: '08:15:00', checkOut: '17:00:00' },
    );
    assert.equal(conflict.changed, true);
    assert.equal(conflict.conflict, true);
    assert.equal(conflict.checkIn, '08:00:00');

    const excessive = mergeTimeClockMarks(null, { checkIn: '01:00:00', checkOut: '22:00:00' });
    assert.equal(excessive.durationInvalid, true);

    assert.equal(parseDateValue('3/9/2026'), '2026-09-03');
    assert.equal(parseDateValue('2026-09-03 08:00'), '2026-09-03');
    assert.equal(parseTimeValue('2026-09-03 8:05 p. m.'), '20:05:00');
    assert.equal(parseTimeValue(0.5), '12:00:00');

    const csv = Buffer.from([
        'ID de empleado,Fecha,Entrada,Salida',
        '"EMP,009",03/09/2026,08:00,17:00',
    ].join('\r\n'));
    const csvSheets = await readSpreadsheet(csv, 'csv');
    assert.equal(csvSheets[0].rows[1][0], 'EMP,009');

    const aiWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(aiWorkbook, XLSX.utils.aoa_to_sheet([
        ['Attendance Summary'],
        ['Employee ID', 'Name', 'Attendance Days'],
        ['EMP-005', 'Persona de prueba', 2],
    ]), 'Summary');
    XLSX.utils.book_append_sheet(aiWorkbook, XLSX.utils.aoa_to_sheet([
        ['Attendance Abnormal'],
        ['Employee ID', 'Date', 'The first', null],
        [null, null, 'On', 'Off'],
        ['EMP-005', '2026/09/01', '08:00', '17:00'],
        ['EMP-005', '2026/09/02', '08:15', '--:--'],
    ]), 'Attendance Source');
    XLSX.utils.book_append_sheet(aiWorkbook, XLSX.utils.aoa_to_sheet([
        ['Attendance Employee'],
        ['ID', 'Date', 'On', 'Off'],
        ['EMP-005', '2026/09/01', '08:00', '17:00'],
    ]), 'Employee Detail');
    const legacyXls = XLSX.write(aiWorkbook, { type: 'buffer', bookType: 'xls' }) as Buffer;

    const originalFetch = globalThis.fetch;
    const originalProvider = process.env.TIME_CLOCK_AI_PROVIDER;
    const originalKey = process.env.DEEPSEEK_API_KEY;
    const originalModel = process.env.DEEPSEEK_ATTENDANCE_MODEL;
    let sentAllSheets = false;
    let usedHighThinking = false;
    process.env.TIME_CLOCK_AI_PROVIDER = 'deepseek';
    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_ATTENDANCE_MODEL = 'test-model';
    globalThis.fetch = (async (_input, init) => {
        const request = JSON.parse(String(init?.body)) as {
            messages: Array<{ content: string }>;
            thinking?: { type?: string };
            reasoning_effort?: string;
        };
        const prompt = request.messages.at(-1)?.content || '';
        sentAllSheets = ['Summary', 'Attendance Source', 'Employee Detail'].every((name) => prompt.includes(name));
        usedHighThinking = request.thinking?.type === 'enabled' && request.reasoning_effort === 'high';
        return new Response(JSON.stringify({
            choices: [{
                message: {
                    content: JSON.stringify({
                        sheetRoles: [
                            { sheetIndex: 0, role: 'summary' },
                            { sheetIndex: 1, role: 'attendance_source' },
                            { sheetIndex: 2, role: 'employee_detail' },
                        ],
                        records: [
                            {
                                employeeCode: 'EMP-005',
                                workDate: '2026-09-01',
                                checkIn: '08:00:00',
                                checkOut: '17:00:00',
                                source: {
                                    sheetIndex: 1,
                                    employeeCell: { rowIndex: 3, columnIndex: 0 },
                                    dateCells: [{ rowIndex: 3, columnIndex: 1 }],
                                    checkInCell: { rowIndex: 3, columnIndex: 2 },
                                    checkOutCell: { rowIndex: 3, columnIndex: 3 },
                                },
                            },
                            {
                                employeeCode: 'EMP-005',
                                workDate: '2026-09-02',
                                checkIn: '08:15:00',
                                checkOut: null,
                                source: {
                                    sheetIndex: 1,
                                    employeeCell: { rowIndex: 4, columnIndex: 0 },
                                    dateCells: [{ rowIndex: 4, columnIndex: 1 }],
                                    checkInCell: { rowIndex: 4, columnIndex: 2 },
                                    checkOutCell: null,
                                },
                            },
                        ],
                    }),
                },
            }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    try {
        const aiResult = await interpretTimeClockFile(legacyXls, 'xls');
        assert.equal(sentAllSheets, true);
        assert.equal(usedHighThinking, true);
        assert.equal(aiResult.interpreter, 'deepseek:test-model');
        assert.equal(aiResult.sheetRoles.length, 3);
        assert.equal(aiResult.records.length, 2);
        assert.deepEqual(aiResult.records[0], {
            employeeCode: 'EMP005',
            workDate: '2026-09-01',
            checkIn: '08:00:00',
            checkOut: '17:00:00',
            sourceTotalMinutes: null,
        });
        assert.equal(aiResult.records[1].checkOut, null);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalProvider === undefined) delete process.env.TIME_CLOCK_AI_PROVIDER;
        else process.env.TIME_CLOCK_AI_PROVIDER = originalProvider;
        if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
        else process.env.DEEPSEEK_API_KEY = originalKey;
        if (originalModel === undefined) delete process.env.DEEPSEEK_ATTENDANCE_MODEL;
        else process.env.DEEPSEEK_ATTENDANCE_MODEL = originalModel;
    }

    console.log('Time clock import tests: OK');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
