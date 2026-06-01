// Parser de CFDI 4.0 basado en regex (sin dependencias de XML).
// Este archivo NO es server-only para poder usarse también en el navegador
// (carga masiva de facturas emitidas). El módulo server `cfdi.ts` lo re-exporta.

export type CfdiConcepto = {
    description: string;
    quantity: number;
    unit_price: number;
    line_total: number;
};

export type CfdiData = {
    isCfdi: boolean;
    version?: string;
    serie?: string;
    folio?: string;
    fecha?: string;             // ISO
    subtotal?: number;
    iva?: number;
    total?: number;
    moneda?: string;
    emisor_rfc?: string;
    emisor_nombre?: string;
    receptor_rfc?: string;
    receptor_nombre?: string;
    uuid?: string;              // UUID del timbre
    conceptos: CfdiConcepto[];
};

// Lee un atributo de la PRIMERA aparición de un tag dado (con o sin namespace)
function attr(xml: string, tagPattern: RegExp, name: string): string | undefined {
    const m = xml.match(tagPattern);
    if (!m) return undefined;
    const tagContent = m[0];
    const re = new RegExp(`\\b${name}="([^"]*)"`, 'i');
    const am = tagContent.match(re);
    return am?.[1];
}

function num(v?: string): number | undefined {
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number(v);
    return isNaN(n) ? undefined : n;
}

export function parseCFDI(xml: string): CfdiData {
    const out: CfdiData = { isCfdi: false, conceptos: [] };

    // Validar que sea CFDI (busca el namespace o la raíz Comprobante)
    if (!/cfd\/4|Comprobante[\s>]/i.test(xml)) {
        return out;
    }
    out.isCfdi = true;

    const comprobante = /<(?:cfdi:)?Comprobante\b[^>]*>/i;
    out.version = attr(xml, comprobante, 'Version');
    out.serie = attr(xml, comprobante, 'Serie');
    out.folio = attr(xml, comprobante, 'Folio');
    out.fecha = attr(xml, comprobante, 'Fecha');
    out.subtotal = num(attr(xml, comprobante, 'SubTotal'));
    out.total = num(attr(xml, comprobante, 'Total'));
    out.moneda = attr(xml, comprobante, 'Moneda');

    const emisor = /<(?:cfdi:)?Emisor\b[^>]*\/?>/i;
    out.emisor_rfc = attr(xml, emisor, 'Rfc');
    out.emisor_nombre = attr(xml, emisor, 'Nombre');

    const receptor = /<(?:cfdi:)?Receptor\b[^>]*\/?>/i;
    out.receptor_rfc = attr(xml, receptor, 'Rfc');
    out.receptor_nombre = attr(xml, receptor, 'Nombre');

    const timbre = /<(?:tfd:)?TimbreFiscalDigital\b[^>]*\/?>/i;
    out.uuid = attr(xml, timbre, 'UUID');

    // IVA: sumar todos los Traslados con Impuesto=002 (IVA SAT)
    const traslados = [...xml.matchAll(/<(?:cfdi:)?Traslado\b[^>]*\/?>/gi)];
    let iva = 0;
    for (const m of traslados) {
        const tag = m[0];
        const impuesto = tag.match(/\bImpuesto="([^"]*)"/i)?.[1];
        const importe = Number(tag.match(/\bImporte="([^"]*)"/i)?.[1] || 0);
        if (impuesto === '002' && !isNaN(importe)) iva += importe;
    }
    out.iva = iva > 0 ? Number(iva.toFixed(2)) : undefined;

    // Conceptos
    const conceptosMatches = [...xml.matchAll(/<(?:cfdi:)?Concepto\b[^>]*\/?>/gi)];
    for (const m of conceptosMatches) {
        const tag = m[0];
        const description = tag.match(/\bDescripcion="([^"]*)"/i)?.[1] || '';
        const quantity = Number(tag.match(/\bCantidad="([^"]*)"/i)?.[1] || 0);
        const unit_price = Number(tag.match(/\bValorUnitario="([^"]*)"/i)?.[1] || 0);
        const line_total = Number(tag.match(/\bImporte="([^"]*)"/i)?.[1] || 0);
        if (description) {
            out.conceptos.push({ description, quantity, unit_price, line_total });
        }
    }

    return out;
}
