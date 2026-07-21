// Utility to extract text and parse a SAT acuse PDF/image.
// Outputs a structured object with folio, periodo, fecha, IVAs, ISR, etc.

export type ExtractedAcuse = {
    raw_text: string;
    sat_folio: string | null;
    sat_tipo_declaracion: string | null;        // 'Normal' | 'Complementaria'
    sat_periodo: string | null;                  // 'YYYY-MM' or display string
    sat_filing_date: string | null;              // ISO
    sat_due_date: string | null;                 // 'YYYY-MM-DD'
    sat_iva_a_pagar: number | null;
    sat_iva_a_favor: number | null;
    sat_isr_a_pagar: number | null;
    sat_iva_cobrado: number | null;
    sat_iva_acreditable: number | null;
    sat_ingresos_nominales: number | null;
    sat_deducciones_autorizadas: number | null;
    sat_cantidad_a_pagar: number | null;
    sat_linea_captura: string | null;
    rfc: string | null;
    razon_social: string | null;
};

// ---------- Money / date helpers ----------
// Parses "1,234.56", "1.234,56", "$ 1,234.56", "MXN 1,234.56" → 1234.56
export function parseMoney(raw: string | null | undefined): number | null {
    if (!raw) return null;
    const s = String(raw).trim();
    // Remove currency markers and whitespace
    let cleaned = s.replace(/MXN|USD|\$|MN|pesos/gi, "").trim();
    // Detect decimal style: if both . and , present, the rightmost is the decimal sep.
    const lastDot = cleaned.lastIndexOf(".");
    const lastComma = cleaned.lastIndexOf(",");
    if (lastDot !== -1 && lastComma !== -1) {
        // Whichever is rightmost is the decimal separator
        if (lastComma > lastDot) {
            // European: 1.234,56
            cleaned = cleaned.replace(/\./g, "").replace(",", ".");
        } else {
            // US: 1,234.56
            cleaned = cleaned.replace(/,/g, "");
        }
    } else if (lastComma !== -1) {
        // Only commas — could be thousand sep or decimal. If there's a single comma + 1-2 digits after, it's decimal.
        const m = cleaned.match(/,(\d{1,2})\b/);
        if (m) {
            cleaned = cleaned.replace(/,/g, ".");
        } else {
            cleaned = cleaned.replace(/,/g, "");
        }
    } else {
        cleaned = cleaned.replace(/,/g, "");
    }
    cleaned = cleaned.replace(/[^\d.\-]/g, "");
    const n = Number(cleaned);
    return isNaN(n) ? null : n;
}

export function parseSpanishDate(s: string | null | undefined): string | null {
    if (!s) return null;
    const t = s.trim();
    // dd/mm/yyyy or dd-mm-yyyy
    const m = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (m) {
        let [, d, mo, y] = m;
        if (y.length === 2) y = "20" + y;
        return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
    return null;
}

export function parseSpanishDateTime(s: string | null | undefined): string | null {
    if (!s) return null;
    const t = s.trim();
    // dd/mm/yyyy hh:mm:ss
    const m = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})[ T]?(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
    if (m) {
        let [, d, mo, y, h, mi, se] = m;
        if (y.length === 2) y = "20" + y;
        return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T${h.padStart(2, "0")}:${mi.padStart(2, "0")}:${(se || "00").padStart(2, "0")}`;
    }
    return parseSpanishDate(t);
}

// ---------- Text extraction ----------
async function extractTextFromPdf(url: string): Promise<string> {
    const lib = await import("pdfjs-dist");
    lib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    const doc = await lib.getDocument({ url, withCredentials: false }).promise;
    let out = "";
    for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        out += content.items.map((it: any) => "str" in it ? it.str : "").join(" ") + "\n";
    }
    return out;
}

async function extractTextFromImage(url: string): Promise<string> {
    // Lazy-load Tesseract only when needed (heavy WASM)
    const Tesseract = (await import("tesseract.js")).default;
    const { data } = await Tesseract.recognize(url, "spa", {
        logger: () => {}, // silent
    });
    return data.text || "";
}

// ---------- Extract from File (PDF or image) ----------
export async function extractTextFromFile(file: File): Promise<string> {
    const url = URL.createObjectURL(file);
    try {
        const name = (file.name || "").toLowerCase();
        if (name.endsWith(".pdf") || file.type === "application/pdf") {
            return await extractTextFromPdf(url);
        }
        if (file.type.startsWith("image/")) {
            return await extractTextFromImage(url);
        }
        // Try PDF first
        try { return await extractTextFromPdf(url); }
        catch { return await extractTextFromImage(url); }
    } finally {
        URL.revokeObjectURL(url);
    }
}

export async function extractTextFromUrl(url: string): Promise<string> {
    const lower = url.toLowerCase();
    if (lower.endsWith(".pdf") || lower.includes("/raw/")) {
        try { return await extractTextFromPdf(url); }
        catch { return ""; }
    }
    // Image
    try { return await extractTextFromImage(url); }
    catch { return ""; }
}

// ---------- Parse SAT acuse text ----------
export function parseSatAcuseText(text: string): ExtractedAcuse {
    const result: ExtractedAcuse = {
        raw_text: text,
        sat_folio: null,
        sat_tipo_declaracion: null,
        sat_periodo: null,
        sat_filing_date: null,
        sat_due_date: null,
        sat_iva_a_pagar: null,
        sat_iva_a_favor: null,
        sat_isr_a_pagar: null,
        sat_iva_cobrado: null,
        sat_iva_acreditable: null,
        sat_ingresos_nominales: null,
        sat_deducciones_autorizadas: null,
        sat_cantidad_a_pagar: null,
        sat_linea_captura: null,
        rfc: null,
        razon_social: null,
    };

    if (!text) return result;

    const norm = (s: string) => s.replace(/\s+/g, " ").trim();

    // Folio (22 digits in SAT acuses, but we accept 15-22)
    const folio = text.match(/Folio(?: de (?:operación|acuse))?[^\d]{0,30}(\d{15,25})/i);
    if (folio) result.sat_folio = folio[1];

    // RFC
    const rfc = text.match(/R\.?F\.?C\.?[:\s]+([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})/i);
    if (rfc) result.rfc = rfc[1].toUpperCase();

    // Razón social
    const rs = text.match(/Raz[oó]n\s+Social[:\s]+([^\n]+?)(?:\n|R\.?F\.?C\.?|Tipo\s+de\s+Declar|$)/i);
    if (rs) result.razon_social = rs[1].trim().slice(0, 200);

    // Tipo de declaración
    if (/Normal/i.test(text)) result.sat_tipo_declaracion = "Normal";
    else if (/Complementaria/i.test(text)) result.sat_tipo_declaracion = "Complementaria";

    // Periodo: "Periodo: de dd/mm/yyyy al dd/mm/yyyy" or "Mes de <mes> <año>"
    const periodo = text.match(/Periodo[:\s]+(?:de\s+)?(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s*(?:al|hasta)\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
    if (periodo) {
        const start = parseSpanishDate(periodo[1]);
        const end = parseSpanishDate(periodo[2]);
        if (start) result.sat_periodo = start.slice(0, 7);
        if (end) result.sat_due_date = end;
    } else {
        // Try "Mes de <Mes> <año>"
        const mesAnio = text.match(/Mes\s+de\s+([A-Za-záéíóú]+)\s+(?:de\s+)?(\d{4})/i);
        if (mesAnio) {
            const meses: Record<string, string> = {
                enero: "01", febrero: "02", marzo: "03", abril: "04",
                mayo: "05", junio: "06", julio: "07", agosto: "08",
                septiembre: "09", octubre: "10", noviembre: "11", diciembre: "12",
            };
            const m = meses[mesAnio[1].toLowerCase()];
            if (m) result.sat_periodo = `${mesAnio[2]}-${m}`;
        }
    }

    // Fecha de presentación
    const fecha = text.match(/Fecha\s+y\s+Hora\s+de\s+Presentaci[oó]n[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\s+\d{1,2}:\d{2}:\d{2})/i)
        || text.match(/Fecha\s+de\s+Presentaci[oó]n[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
    if (fecha) result.sat_filing_date = parseSpanishDateTime(fecha[1]);

    // Línea de captura
    const lc = text.match(/L[ií]nea\s+de\s+Captura[:\s]+([\d\s]{15,40})/i);
    if (lc) result.sat_linea_captura = lc[1].replace(/\s+/g, "").slice(0, 40);

    // Cantidad a cargo / a favor / a pagar
    const findAfter = (label: string, maxDistance = 80) => {
        const re = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\\s:\\$]*([^\\n\\r]{0," + maxDistance + "})", "i");
        const m = text.match(re);
        return m ? m[1] : null;
    };

    // Try the most common SAT labels
    const tryLabels = (labels: string[]) => {
        for (const l of labels) {
            const v = findAfter(l);
            if (v) {
                const money = parseMoney(v);
                if (money !== null && money !== 0) return money;
            }
        }
        return null;
    };

    result.sat_iva_a_pagar = tryLabels([
        "IVA a cargo", "Cantidad a cargo del IVA", "I\.V\.A\. a cargo",
        "Total de IVA a cargo", "Determinación del IVA.*Cantidad a cargo",
    ]);
    result.sat_iva_a_favor = tryLabels([
        "IVA a favor", "Saldo a favor del IVA", "Saldo a favor",
        "I\.V\.A\. a favor",
    ]);
    result.sat_isr_a_pagar = tryLabels([
        "ISR a cargo", "ISR a pagar", "I\.S\.R\. a cargo", "I\.S\.R\. a pagar",
        "ISR retenido", "Determinación del ISR.*Cantidad a cargo",
    ]);
    result.sat_iva_cobrado = tryLabels([
        "IVA cobrado", "Total de IVA trasladado", "IVA trasladado",
    ]);
    result.sat_iva_acreditable = tryLabels([
        "IVA acreditable", "Total de IVA acreditable", "Acreditamiento de IVA",
    ]);
    result.sat_ingresos_nominales = tryLabels([
        "Ingresos nominales", "Ingresos del mes", "Total de ingresos",
    ]);
    result.sat_deducciones_autorizadas = tryLabels([
        "Deducciones autorizadas", "Deducciones del mes", "Total de deducciones",
    ]);
    result.sat_cantidad_a_pagar = tryLabels([
        "Cantidad a cargo", "Cantidad a pagar", "Total a pagar",
    ]);

    return result;
}

// ---------- High-level: extract + parse from File ----------
export async function extractAndParseAcuse(file: File): Promise<ExtractedAcuse> {
    const text = await extractTextFromFile(file);
    return parseSatAcuseText(text);
}

export async function extractAndParseAcuseFromUrl(url: string): Promise<ExtractedAcuse> {
    const text = await extractTextFromUrl(url);
    return parseSatAcuseText(text);
}

// ---------- Comparison helper ----------
export type ComparisonRow = {
    field: string;
    ours: number | null;
    sat: number | null;
    diff: number | null;
    pct: number | null;
    label: string;
};

export function buildComparison(ours: { iva_a_pagar: number; isr_a_pagar: number; iva_cobrado_total: number; iva_acreditable_total: number }, sat: ExtractedAcuse): ComparisonRow[] {
    const rows: ComparisonRow[] = [];
    const cmp = (field: string, label: string, o: number | null, s: number | null) => {
        const diff = (o != null && s != null) ? s - o : null;
        const pct = (o != null && s != null && o !== 0) ? ((s - o) / o) * 100 : null;
        rows.push({ field, label, ours: o, sat: s, diff, pct });
    };
    cmp("iva_a_pagar", "IVA a pagar", ours.iva_a_pagar, sat.sat_iva_a_pagar ?? sat.sat_cantidad_a_pagar);
    cmp("isr_a_pagar", "ISR a pagar", ours.isr_a_pagar, sat.sat_isr_a_pagar);
    cmp("iva_cobrado", "IVA cobrado", ours.iva_cobrado_total, sat.sat_iva_cobrado);
    cmp("iva_acreditable", "IVA acreditable", ours.iva_acreditable_total, sat.sat_iva_acreditable);
    return rows;
}
