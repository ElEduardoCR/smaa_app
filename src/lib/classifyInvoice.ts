import 'server-only';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5';

export type ClassifyInput = {
    from: string;
    subject: string;
    pdfBase64?: string;          // primer PDF adjunto, opcional
};

export type ClassifyResult = {
    is_invoice: boolean;
    confidence: number;          // 0..1
    supplier_rfc?: string;
    supplier_name?: string;
    invoice_folio?: string;
    invoice_date?: string;       // ISO date
    subtotal?: number;
    vat_total?: number;
    total?: number;
    currency?: string;
    notes?: string;
};

const SYSTEM = `Eres un clasificador de facturas mexicanas (CFDI). Recibes el remitente, asunto y opcionalmente el PDF adjunto de un correo. Debes decidir si es una factura emitida hacia el destinatario (factura de COMPRA) y extraer datos clave.

Reglas:
- "is_invoice" = true SOLO si claramente es una factura/CFDI (no cotización, no estado de cuenta, no recibo de pago, no notificación, no orden de compra).
- "confidence" entre 0 y 1.
- Todos los montos en MXN si no se especifica otra moneda.
- Si un dato no aparece, omítelo en el JSON.
- RFC formato mexicano: 12-13 caracteres alfanuméricos.

Responde ÚNICAMENTE con JSON válido, sin texto adicional, con esta forma:
{
  "is_invoice": boolean,
  "confidence": number,
  "supplier_rfc"?: string,
  "supplier_name"?: string,
  "invoice_folio"?: string,
  "invoice_date"?: "YYYY-MM-DD",
  "subtotal"?: number,
  "vat_total"?: number,
  "total"?: number,
  "currency"?: string,
  "notes"?: string
}`;

export async function classifyInvoiceWithHaiku(input: ClassifyInput): Promise<ClassifyResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY no está definida');

    const userText = `Remitente: ${input.from}\nAsunto: ${input.subject}\n\n¿Es una factura? Extrae los datos del PDF si está adjunto.`;

    const content: any[] = [];
    if (input.pdfBase64) {
        content.push({
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: input.pdfBase64 },
        });
    }
    content.push({ type: 'text', text: userText });

    const res = await fetch(ANTHROPIC_API, {
        method: 'POST',
        headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            model: MODEL,
            max_tokens: 1024,
            system: SYSTEM,
            messages: [{ role: 'user', content }],
        }),
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Claude Haiku falló (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        return { is_invoice: false, confidence: 0, notes: 'Respuesta IA no parseable' };
    }
    try {
        return JSON.parse(jsonMatch[0]) as ClassifyResult;
    } catch {
        return { is_invoice: false, confidence: 0, notes: 'JSON inválido de IA' };
    }
}
