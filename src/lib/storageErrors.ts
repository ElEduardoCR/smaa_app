// Traduce los errores de Supabase Storage a mensajes que el usuario entienda
// y que digan la causa real (antes llegaban como "Invalid key: …" o
// "mime type … is not supported" sin más contexto).
export function storageErrorMessage(message: string | undefined | null): string {
    const msg = message || 'Error desconocido del almacenamiento.';
    const mime = /mime type (\S+) is not supported/i.exec(msg);
    if (mime) return `El almacenamiento no acepta archivos de tipo ${mime[1]}.`;
    if (/maximum allowed size|Payload too large/i.test(msg)) return 'El archivo excede el tamaño máximo permitido.';
    if (/Invalid key/i.test(msg)) return 'El nombre del archivo tiene caracteres que el almacenamiento no acepta.';
    if (/row-level security/i.test(msg)) return 'El almacenamiento rechazó la subida por permisos del bucket.';
    if (/Bucket not found/i.test(msg)) return 'No existe el bucket de almacenamiento configurado.';
    if (/already exists|Duplicate/i.test(msg)) return 'Ya existe un archivo con ese nombre.';
    return msg;
}
