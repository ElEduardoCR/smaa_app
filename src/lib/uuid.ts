/** Genera UUID v4 en el navegador, incluso cuando randomUUID no está disponible. */
export function generateUUID(): string {
    const crypto = globalThis.crypto;
    if (typeof crypto?.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    // getRandomValues también está disponible en contextos HTTP de red local.
    if (typeof crypto?.getRandomValues !== 'function') {
        throw new Error('Tu navegador no permite generar identificadores seguros. Actualízalo o utiliza otro navegador.');
    }

    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
