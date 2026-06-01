import 'server-only';

// Re-exporta el parser compartido. La lógica vive en cfdiParse.ts (sin server-only)
// para poder reutilizarse en el navegador (carga masiva de facturas emitidas).
export * from './cfdiParse';
