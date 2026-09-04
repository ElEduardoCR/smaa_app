import { handleHikvisionDirectRequest } from '@/lib/hikvisionDirectRoute';
import { persistHikvisionAttendanceEvent } from '@/lib/hikvisionAttendanceReceiver';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function validConfiguration(username: string, password: string, deviceId: string): boolean {
    return username.length >= 12
        && username.length <= 64
        // Este firmware limita la contraseña saliente a 16 caracteres.
        // Una cadena aleatoria de 16 caracteres base64url conserva ~96 bits.
        && password.length >= 16
        && password.length <= 128
        && deviceId.length >= 1
        && deviceId.length <= 128
        && !/[:\r\n\0]/.test(username)
        && !/[\r\n\0]/.test(password)
        && !/[\r\n\0]/.test(deviceId);
}

export async function POST(request: Request): Promise<Response> {
    const username = process.env.HIKVISION_DIRECT_USERNAME || '';
    const password = process.env.HIKVISION_DIRECT_PASSWORD || '';
    const deviceId = process.env.HIKVISION_DEVICE_ID || '';
    if (!validConfiguration(username, password, deviceId)) {
        return Response.json(
            { ok: false, error: 'service_unavailable' },
            { status: 503, headers: { 'cache-control': 'no-store' } },
        );
    }

    return handleHikvisionDirectRequest(request, {
        username,
        password,
        deviceId,
        persist: persistHikvisionAttendanceEvent,
        diagnostic: code => console.info('Hikvision direct event rejected.', { code }),
    });
}
