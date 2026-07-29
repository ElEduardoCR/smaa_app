// Parser de Constancia de Situación Fiscal (CSF) del SAT.
// Maneja dos formatos del SAT:
//   1) Datos en líneas separadas (formato moderno) — "Label:" en una línea,
//      valor en la siguiente.
//   2) Datos en formato tabular (formato legacy) — múltiples "Label: valor"
//      en la misma línea, separados por 2+ espacios.
//
// Extrae:
//   - rfc (PM 12 chars o PF 13 chars)
//   - business_name (PM: "Razón Social"; PF: "Nombre Apellido1 Apellido2")
//   - fiscal_regime (código SAT: 601, 612, 626, etc. o label si no mapea)
//   - fiscal_zip_code, email, phone, address
//
// Calibrado contra:
//   - PF: MATE8602263P8 EDEL ARGENIS MAULAS TORRES (jul 2024)

export type CsfData = {
    rfc: string | null;
    business_name: string | null;
    fiscal_regime: string | null;
    fiscal_regime_label: string | null;
    fiscal_zip_code: string | null;
    address: string | null;
    email: string | null;
    phone: string | null;
    raw_text: string;
};

// Catálogo SAT: label (sin prefijo "Régimen") → código.
// Las claves son la forma normalizada SIN la palabra "Régimen".
const REGIMEN_MAP: Record<string, string> = {
    'general de ley personas morales': '601',
    'personas morales con fines no lucrativos': '603',
    'residentes en el extranjero sin establecimiento permanente en mexico': '610',
    'sociedades cooperativas de produccion que optan por diferir sus ingresos': '620',
    'actividades agricolas ganaderas silvicolas y pesqueras': '622',
    'opcional para grupos de sociedades': '623',
    'coordinados': '624',
    'simplificado de confianza (resico pm)': '626',
    'simplificado de confianza (resico pf)': '626',
    'simplificado de confianza': '626',
    'sueldos y salarios e ingresos asimilados a salarios': '605',
    'arrendamiento': '606',
    'de enajenacion o adquisicion de bienes': '607',
    'demas ingresos': '608',
    'de dividendos (socios y accionistas)': '611',
    'personas fisicas con actividades empresariales y profesionales': '612',
    'de intereses': '614',
    'de los ingresos por obtencion de premios': '615',
    'sin obligaciones fiscales': '616',
    'incorporacion fiscal (rif)': '621',
    'de plataformas tecnologicas': '625',
};

function normalize(s: string): string {
    return s
        .toLowerCase()
        .replace(/[áéíóú]/g, c => ({ 'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u' }[c] || c))
        .replace(/ñ/g, 'n')
        .replace(/ü/g, 'u')
        .replace(/\s+/g, ' ')
        .trim();
}

function titleCase(s: string): string {
    return s.toLowerCase().replace(/(^|\s)([a-záéíóúñü])/g, (_, sp, ch) => sp + ch.toUpperCase());
}

function mapRegimenLabelToCode(label: string): string | null {
    // Quitar el prefijo "Régimen" (puede tener "de" después o no)
    const cleaned = normalize(label).replace(/^r[ée]?g[íi]men\s*(de\s+)?:?/, '').trim();
    return REGIMEN_MAP[cleaned] ?? null;
}

// ---------- Helpers de extracción por líneas ----------

/**
 * Toma una línea que puede tener múltiples "Label: valor" separados por 2+ espacios
 * y devuelve un mapa {labelNormalizado: valor}.
 *
 * Ej: "RFC: MATE8602263P8   CURP: ABC" → { rfc: "MATE8602263P8", curp: "ABC" }
 */
function splitLineByLabels(line: string): Array<{ label: string; value: string }> {
    // Regex: captura "Texto Label: valor hasta el próximo label o fin de línea"
    // Un label es texto que empieza con mayúscula, contiene letras/espacios/paréntesis,
    // y termina con ":"
    const re = /([A-ZÁÉÍÓÚÑ][A-Za-záéíóúñÑü\s\(\)]{2,50}?)\s*:\s*([^:]+?)(?=(?:\s{2,}[A-ZÁÉÍÓÚÑ][A-Za-záéíóúñÑü\s\(\)]{2,50}?\s*:)|$)/g;
    const out: Array<{ label: string; value: string }> = [];
    let m;
    while ((m = re.exec(line)) !== null) {
        const label = m[1].trim();
        const value = m[2].trim();
        if (label && value) {
            out.push({ label: normalize(label), value });
        }
    }
    return out;
}

/**
 * Encuentra el valor asociado a un label (en su forma normalizada).
 * Busca en la misma línea y, si no encuentra, en la siguiente.
 */
function findFieldValue(lines: string[], lineIdx: number, labelPatterns: RegExp[]): string | null {
    // Primero: split de la línea actual (puede tener varios "Label: valor")
    const inlineMatches = splitLineByLabels(lines[lineIdx]);
    for (const m of inlineMatches) {
        for (const re of labelPatterns) {
            if (re.test(m.label)) {
                return m.value;
            }
        }
    }
    // Segundo: la línea siguiente (formato "Label:" en una línea, valor en la siguiente)
    const l = lines[lineIdx].trim();
    for (const re of labelPatterns) {
        if (re.test(normalize(l))) {
            // El label está solo en esta línea; tomar la siguiente
            if (lineIdx + 1 < lines.length) {
                return lines[lineIdx + 1].trim();
            }
        }
    }
    return null;
}

export function parseCSF(text: string): CsfData {
    const result: CsfData = {
        rfc: null,
        business_name: null,
        fiscal_regime: null,
        fiscal_regime_label: null,
        fiscal_zip_code: null,
        address: null,
        email: null,
        phone: null,
        raw_text: text,
    };

    if (!text) return result;

    // Cortamos en "Página [N]" para quedarnos con las páginas 1+2.
    // Página 3+ suele contener el sello digital.
    const page1End = text.indexOf('Página [2]');
    const page1 = page1End > 0 ? text.slice(0, page1End) : text;
    const page2Start = text.indexOf('Página [2]');
    const page3Start = text.indexOf('Página [3]');
    const page2 = (page2Start > 0 && page3Start > page2Start)
        ? text.slice(page2Start, page3Start)
        : '';
    const dataText = page1 + '\n' + page2;
    const allLines = dataText.split('\n').map(l => l.trim()).filter(Boolean);

    // ---------------------------------------------------------------------
    // 1) RFC
    // ---------------------------------------------------------------------
    for (let i = 0; i < allLines.length; i++) {
        const v = findFieldValue(allLines, i, [/^r\.?f\.?c\.?$/]);
        if (v) {
            const rfcMatch = v.match(/([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})/i);
            if (rfcMatch) {
                result.rfc = rfcMatch[1].toUpperCase().slice(0, 13);
                break;
            }
        }
    }

    // ---------------------------------------------------------------------
    // 2) Razón Social (PM) o Nombre + Apellidos (PF)
    // ---------------------------------------------------------------------
    // PF: buscar "Nombre (s):" + "Primer Apellido:" + "Segundo Apellido:"
    let pfNombre: string | null = null;
    let pfAp1: string | null = null;
    let pfAp2: string | null = null;
    for (let i = 0; i < allLines.length; i++) {
        const vNombre = findFieldValue(allLines, i, [/^nombre(?:\s*\(s\))?$/]);
        if (vNombre) { pfNombre = vNombre; continue; }
        const vAp1 = findFieldValue(allLines, i, [/^primer\s+apellido$/]);
        if (vAp1) { pfAp1 = vAp1; continue; }
        const vAp2 = findFieldValue(allLines, i, [/^segundo\s+apellido$/]);
        if (vAp2) { pfAp2 = vAp2; continue; }
    }

    if (pfNombre) {
        const parts = [pfNombre, pfAp1, pfAp2].filter(Boolean);
        result.business_name = titleCase(parts.join(' '));
    } else {
        // PM: la razón social aparece ANTES del label "Nombre, denominación o razón social".
        for (let i = 0; i < allLines.length; i++) {
            const l = normalize(allLines[i]);
            if (/^nombre,?\s*denominaci[oó]n\s*o\s*raz[oó]n\s*social/.test(l) || /^denominaci[oó]n\s*o\s*raz[oó]n\s*social/.test(l)) {
                // El label puede ser de 1-2 líneas. El valor está en la(s) línea(s) anterior(es).
                const prev1 = i >= 1 ? allLines[i - 1] : '';
                const prev2 = i >= 2 ? allLines[i - 2] : '';
                const candidate = [prev2, prev1].filter(Boolean).join(' ').trim();
                if (candidate && !/^idCIF/i.test(candidate) && !/^constancia/i.test(candidate) && !/^valida/i.test(candidate) && candidate.length > 3) {
                    result.business_name = titleCase(candidate);
                }
                break;
            }
        }
    }

    // ---------------------------------------------------------------------
    // 3) Régimen Fiscal
    // ---------------------------------------------------------------------
    // Buscamos la sección de regímenes (después de "Regímenes:") y tomamos
    // el primer régimen listado (que es el más reciente).
    //
    // "Régimen" en español tiene 2 variantes:
    //   - Singular: R-é-g-i-m-e-n (con "é" en posición 1)
    //   - Plural:   R-e-g-í-m-e-n-e-s (con "e" en pos 1 y "í" en pos 3)
    // Usamos regex tolerante: `r[éí]?g[íi]men(?:es)?` con clases de caracteres
    // que acepten con/sin tilde en cada posición.
    const RE_REGIMEN_SECTION = /^r[ée]?g[íi]men(?:es)?:?\s*$/i;
    const RE_REGIMEN_HEADER = /^r[ée]?g[íi]men$/i;
    const RE_REGIMEN_COMPOUND = /^r[ée]?g[íi]men\s+.*fecha/i;
    const RE_SECTION_END = /^(obligaciones|actividades|datos\s+de|caracter[íi]sticas)/i;
    const RE_DATE_PURE = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;
    const RE_FECHA_HEADER = /^fecha\s+(inicio|fin)\s*$/i;

    let inRegimenSection = false;
    for (let i = 0; i < allLines.length; i++) {
        const l = allLines[i];

        if (RE_REGIMEN_SECTION.test(l)) {
            inRegimenSection = true;
            continue;
        }
        if (inRegimenSection && RE_SECTION_END.test(l)) {
            break;
        }
        if (inRegimenSection) {
            if (RE_REGIMEN_HEADER.test(l)) continue;
            if (RE_FECHA_HEADER.test(l)) continue;
            if (RE_REGIMEN_COMPOUND.test(l)) continue;
            if (RE_DATE_PURE.test(l)) continue;
            if (l.length < 10) continue;

            // El SAT lista los regímenes en orden cronológico (antiguo → nuevo).
            // Queremos el MÁS RECIENTE, así que seguimos iterando hasta el final
            // de la sección (hasta Obligaciones:) y guardamos el último.
            const labelOnly = l.replace(/\s+\d{1,2}\/\d{1,2}\/\d{2,4}\s*$/, '').trim();
            if (labelOnly.length < 5) continue;

            result.fiscal_regime_label = labelOnly;
            const code = mapRegimenLabelToCode(labelOnly);
            if (code) result.fiscal_regime = code;
            // NO break — seguimos al siguiente para tomar el último
        }
    }

    // ---------------------------------------------------------------------
    // 4) Código Postal fiscal
    // ---------------------------------------------------------------------
    for (let i = 0; i < allLines.length; i++) {
        const v = findFieldValue(allLines, i, [/^c[óo]digo\s+postal$/, /^c\.?p\.?$/]);
        if (v) {
            const cp = v.match(/(\d{5})/);
            if (cp) { result.fiscal_zip_code = cp[1]; break; }
        }
    }

    // ---------------------------------------------------------------------
    // 5) Email — solo en la sección de datos, NO en el disclaimer del SAT
    // ---------------------------------------------------------------------
    // El disclaimer del SAT comienza con "Sus datos personales son incorporados"
    // y termina antes de "Sello Digital". Excluimos todo ese bloque.
    const selloIdx = text.indexOf('Sello Digital');
    const datosPersonalesIdx = text.indexOf('Sus datos personales son incorporados');
    const endIdx = selloIdx > 0 ? selloIdx : text.length;
    const startIdx = datosPersonalesIdx > 0 ? datosPersonalesIdx : 0;
    const dataOnly = text.slice(0, endIdx);
    // Buscar email solo ANTES del bloque de disclaimer
    const beforeDisclaimer = datosPersonalesIdx > 0 ? text.slice(0, datosPersonalesIdx) : dataOnly;
    const emailMatch = beforeDisclaimer.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    result.email = emailMatch ? emailMatch[0].toLowerCase() : null;

    // ---------------------------------------------------------------------
    // 6) Teléfono
    // ---------------------------------------------------------------------
    for (let i = 0; i < allLines.length; i++) {
        const v = findFieldValue(allLines, i, [/^tel[ée]fono$/, /^tel\.?$/]);
        if (v) {
            const digits = v.replace(/[^\d]/g, '');
            if (digits.length >= 10 && digits.length <= 13) {
                result.phone = digits;
                break;
            }
        }
    }

    // ---------------------------------------------------------------------
    // 7) Dirección completa
    // ---------------------------------------------------------------------
    const fields: Record<string, string | null> = {
        vialidad: null,
        numExt: null,
        numInt: null,
        colonia: null,
        municipio: null,
        estado: null,
    };
    const fieldLabels: Record<keyof typeof fields, RegExp[]> = {
        vialidad: [/^nombre\s+de\s+(?:la\s+)?vialidad$/, /^calle$/, /^vialidad$/],
        numExt: [/^n[úu]mero\s+exterior$/, /^no\.?\s*exterior$/, /^ext$/],
        numInt: [/^n[úu]mero\s+interior$/, /^no\.?\s*interior$/, /^int$/],
        colonia: [/^nombre\s+de\s+la\s+colonia$/, /^colonia$/],
        municipio: [/^nombre\s+del\s+municipio(?:\s+o\s+demarcaci[óo]n\s+territorial)?$/, /^municipio$/, /^delegaci[óo]n$/],
        estado: [/^nombre\s+de\s+la\s+entidad\s+federativa$/, /^estado$/, /^entidad\s+federativa$/],
    };

    for (let i = 0; i < allLines.length; i++) {
        for (const key of Object.keys(fieldLabels) as Array<keyof typeof fields>) {
            const v = findFieldValue(allLines, i, fieldLabels[key]);
            if (v && !fields[key]) {
                // Filtrar valores que parecen otras etiquetas o están vacíos
                const trimmed = v.trim();
                if (trimmed.length > 0 && !/^(nombre|c[óo]digo|n[úu]mero)/i.test(trimmed)) {
                    fields[key] = trimmed;
                }
            }
        }
    }

    const addrParts: string[] = [];
    if (fields.vialidad) addrParts.push(titleCase(fields.vialidad));
    if (fields.numExt) addrParts.push(`#${fields.numExt}`);
    if (fields.numInt) addrParts.push(`Int. ${fields.numInt}`);
    if (fields.colonia) addrParts.push(`Col. ${titleCase(fields.colonia)}`);
    if (fields.municipio) addrParts.push(titleCase(fields.municipio));
    if (fields.estado) addrParts.push(titleCase(fields.estado));
    if (addrParts.length > 0) {
        result.address = addrParts.join(', ');
    }

    return result;
}

// ---------- High-level: extract + parse from File ----------

/**
 * Extrae texto de un PDF o imagen y lo parsea como CSF.
 * Usa pdfjs-dist para PDFs y tesseract.js para imágenes (lazy-loaded).
 */
export async function extractAndParseCSF(file: File): Promise<CsfData> {
    const { extractTextFromFile } = await import('./satAcuseParser');
    const text = await extractTextFromFile(file);
    return parseCSF(text);
}
