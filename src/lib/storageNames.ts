// ===========================================================================
// Nombres seguros para rutas de Supabase Storage.
//
// Storage rechaza con "Invalid key" cualquier ruta con caracteres fuera de
// [A-Za-z0-9 _/!-.*'()&$@=;:+,?]: acentos, ñ, º, ″, #, %, etc. Y un "#" que
// sí llegara a la URL se interpretaría como ancla, truncando la ruta.
// Por eso NUNCA se usa el nombre original del archivo (ni un RFC, que puede
// traer Ñ) tal cual en una ruta: siempre pasa por aquí. El nombre original se
// guarda aparte en la BD para mostrarlo.
// ===========================================================================

/** "Plano brida 4″ revisión Ñ #2.pdf" → "Plano_brida_4_revision_N_2.pdf" */
export function safeStorageName(name: string, maxLength = 120): string {
    const cleaned = (name || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/_{2,}/g, '_')
        .replace(/^[_.]+/, '')
        .slice(-maxLength);
    return cleaned || 'archivo';
}

/** Segmento de ruta seguro para un RFC u otro identificador (Ñ → N, & → _). */
export function safeStorageSegment(value: string): string {
    return safeStorageName(value, 60).toUpperCase();
}

/** Extensión en minúsculas sin el punto ("" si no tiene). */
export function fileExtension(name: string): string {
    const m = /\.([a-zA-Z0-9]{1,8})$/.exec(name || '');
    return m ? m[1].toLowerCase() : '';
}
