import 'server-only';

import { createHash, timingSafeEqual } from 'node:crypto';

import type { NormalizedAttendanceEvent } from '@/lib/hikvisionAttendance';
import { recalculateAttendanceForEvent } from '@/lib/attendanceService';
import { getServerSupabase } from '@/lib/supabaseServer';

export type AttendancePersistenceResult =
    | { ok: true; status: 'recorded' | 'duplicate'; httpStatus: 200 | 201 }
    | { ok: false; error: 'device_not_allowed' | 'invalid_event_time' | 'employee_not_mapped' | 'employee_not_active' | 'service_unavailable'; httpStatus: 403 | 422 | 503 };

function safeTextEqual(left: string, right: string): boolean {
    const leftHash = createHash('sha256').update(left, 'utf8').digest();
    const rightHash = createHash('sha256').update(right, 'utf8').digest();
    return timingSafeEqual(leftHash, rightHash);
}

/** Persistencia común para el puente Bearer y el receptor Basic directo. */
export async function persistHikvisionAttendanceEvent(
    event: NormalizedAttendanceEvent,
    deviceId: string,
): Promise<AttendancePersistenceResult> {
    if (event.claimedDeviceId && !safeTextEqual(event.claimedDeviceId, deviceId)) {
        return { ok: false, error: 'device_not_allowed', httpStatus: 403 };
    }
    if (new Date(event.occurredAt).getTime() > Date.now() + 5 * 60 * 1000) {
        return { ok: false, error: 'invalid_event_time', httpStatus: 422 };
    }

    let supabase;
    try {
        supabase = getServerSupabase();
    } catch {
        return { ok: false, error: 'service_unavailable', httpStatus: 503 };
    }

    const { data: payrollRows, error: payrollError } = await supabase
        .from('payroll_employees')
        .select('employee_id')
        .eq('code', event.employeeExternalNo)
        .eq('status', 'active')
        .limit(2);

    if (payrollError) {
        console.error('Hikvision receiver: employee mapping query failed.', { code: payrollError.code });
        return { ok: false, error: 'service_unavailable', httpStatus: 503 };
    }
    if (!payrollRows || payrollRows.length !== 1 || !payrollRows[0].employee_id) {
        return { ok: false, error: 'employee_not_mapped', httpStatus: 422 };
    }

    const employeeId = payrollRows[0].employee_id as string;
    const { data: employee, error: employeeError } = await supabase
        .from('employees')
        .select('id, is_active')
        .eq('id', employeeId)
        .maybeSingle();

    if (employeeError) {
        console.error('Hikvision receiver: employee query failed.', { code: employeeError.code });
        return { ok: false, error: 'service_unavailable', httpStatus: 503 };
    }
    if (!employee?.is_active) return { ok: false, error: 'employee_not_active', httpStatus: 422 };

    const { error: insertError } = await supabase.from('attendance_events').insert({
        device_id: deviceId,
        employee_external_no: event.employeeExternalNo,
        employee_id: employeeId,
        occurred_at: event.occurredAt,
        direction: event.direction,
        event_serial: event.eventSerial,
        event_type: event.eventType,
        major_event_type: event.majorEventType,
        sub_event_type: event.subEventType,
        event_state: event.eventState ?? null,
        verification_mode: event.verificationMode ?? null,
        attendance_status: event.attendanceStatus ?? null,
        status_value: event.statusValue ?? null,
        active_post_count: event.activePostCount ?? null,
    });

    if (insertError?.code === '23505') {
        try {
            await recalculateAttendanceForEvent(employeeId, event.occurredAt);
        } catch (error) {
            console.error('Hikvision receiver: derived recalculation failed after duplicate.', {
                code: error instanceof Error ? error.name : 'unknown',
            });
        }
        return { ok: true, status: 'duplicate', httpStatus: 200 };
    }
    if (insertError) {
        console.error('Hikvision receiver: attendance insert failed.', { code: insertError.code });
        return { ok: false, error: 'service_unavailable', httpStatus: 503 };
    }

    try {
        await recalculateAttendanceForEvent(employeeId, event.occurredAt);
    } catch (error) {
        // El evento inmutable ya quedó durable; el resumen se puede recalcular.
        console.error('Hikvision receiver: derived attendance recalculation failed.', {
            code: error instanceof Error ? error.name : 'unknown',
        });
    }

    return { ok: true, status: 'recorded', httpStatus: 201 };
}
