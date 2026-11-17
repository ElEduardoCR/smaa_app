export type DigitalField = {
    key: string;
    label: string;
    type?: 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox' | 'signature';
    required?: boolean;
    options?: string[];
    min?: number;
    max?: number;
    readOnly?: boolean;
    placeholder?: string;
};

export type DigitalRow = Record<string, string | number | boolean | null>;
export type DigitalValues = Record<string, string | number | boolean | null | DigitalRow[]>;
export type DigitalTable = {
    key: string;
    label: string;
    columns: DigitalField[];
    initialRows?: DigitalRow[];
    minRows?: number;
    maxRows?: number;
    fixedRows?: boolean;
};
export type DigitalSection = {
    title: string;
    paragraphs?: string[];
    fields?: DigitalField[];
    table?: DigitalTable;
    flow?: {
        nodes: { id: string; label: string; x: number; y: number; width: number; height: number; decision?: boolean }[];
        edges: { from: string; to: string; label?: string }[];
        width: number;
        height: number;
    };
};
export type DigitalTemplate = {
    key: string;
    code: string;
    title: string;
    kind: 'form' | 'document' | 'process_map' | 'presentation' | 'register';
    area: string;
    priority: number;
    sourceFiles: string[];
    sourceIsExample: boolean;
    description: string;
    needsAdaptation?: boolean;
    captureEnabled?: boolean;
    relatedCodes?: string[];
    normativeBaseline?: string;
    transitionNote?: string;
    sourceEvidence?: { label: string; fileName: string; sha256: string; storagePath: string }[];
    sections: DigitalSection[];
};

export function initialDigitalValues(template: DigitalTemplate): DigitalValues {
    const values: DigitalValues = {};
    for (const section of template.sections) {
        for (const field of section.fields || []) values[field.key] = field.type === 'checkbox' ? false : '';
        if (section.table) {
            const table = section.table;
            values[table.key] = table.initialRows?.map(row => ({ ...row })) ||
                Array.from({ length: table.minRows ?? 1 }, () => Object.fromEntries(table.columns.map(field => [field.key, ''])));
        }
    }
    return values;
}
