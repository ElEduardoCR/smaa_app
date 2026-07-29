/**
 * Tests unitarios del CSF parser.
 *
 * Valida dos formatos:
 *   - PF (Persona Física): RFC 13 chars, Nombre + Apellidos separados
 *   - PM (Persona Moral): RFC 12 chars, Razón Social
 *
 * Uso: npx tsx scripts/test-csf-parser.ts
 */
import { parseCSF, type CsfData } from '../src/lib/csfParser';

let passed = 0, failed = 0;

type Expectation = {
    field: keyof CsfData;
    match: 'eq' | 'contains' | 'notNull' | 'null' | 'true' | 'false';
    expected?: any;
    note?: string;
};

function assert(testName: string, data: CsfData, expectations: Expectation[]) {
    let allPassed = true;
    const failures: string[] = [];
    for (const e of expectations) {
        const actual = data[e.field];
        let ok = false;
        switch (e.match) {
            case 'eq':
                ok = actual === e.expected;
                if (!ok) failures.push(`${e.field}: expected ${JSON.stringify(e.expected)}, got ${JSON.stringify(actual)}`);
                break;
            case 'contains':
                ok = typeof actual === 'string' && actual.includes(e.expected);
                if (!ok) failures.push(`${e.field}: expected to contain ${JSON.stringify(e.expected)}, got ${JSON.stringify(actual)}`);
                break;
            case 'notNull':
                ok = actual != null && actual !== '';
                if (!ok) failures.push(`${e.field}: expected not null, got ${JSON.stringify(actual)}`);
                break;
            case 'null':
                ok = actual == null || actual === '';
                if (!ok) failures.push(`${e.field}: expected null, got ${JSON.stringify(actual)}`);
                break;
        }
        if (!ok) allPassed = false;
    }
    if (allPassed) {
        console.log(`  ✅ ${testName}`);
        passed++;
    } else {
        console.log(`  ❌ ${testName}`);
        failures.forEach(f => console.log(`     └─ ${f}`));
        failed++;
    }
}

// =============================================================================
// Test 1: CSF real de PF (MATE8602263P8) - el que mandaste
// =============================================================================
console.log('\n=== Test 1: CSF real de Persona Física ===');
{
    const csfText = `CÉDULA DE IDENTIFICACIÓN FISCAL
MATE8602263P8
Registro Federal de Contribuyentes
EDEL ARGENIS MAULAS
TORRES
Nombre, denominación o razón
social
idCIF: 14110491720
VALIDA TU INFORMACIÓN
FISCAL
CONSTANCIA DE SITUACIÓN FISCAL
Lugar y Fecha de Emisión
CHIHUAHUA , CHIHUAHUA A 10 DE JULIO DE 2024
MATE8602263P8
Datos de Identificación del Contribuyente:
RFC:   MATE8602263P8
CURP:   MATE860226HCHLRD00
Nombre (s):   EDEL ARGENIS
Primer Apellido:   MAULAS
Segundo Apellido:   TORRES
Fecha inicio de operaciones:   01 DE SEPTIEMBRE DE 2007
Estatus en el padrón:   REACTIVADO
Fecha de último cambio de estado:   02 DE AGOSTO DE 2018
Nombre Comercial:
Datos del domicilio registrado
Código Postal: 31060   Tipo de Vialidad:   CERRADA (CDA) O PRIVADA (PRIV)
Nombre de Vialidad:   TAMBOREL   Número Exterior:   3900
Número Interior:   Nombre de la Colonia:   LEALTAD I
Nombre de la Localidad:   CHIHUAHUA   Nombre del Municipio o Demarcación Territorial:   CHIHUAHUA
Nombre de la Entidad Federativa:   CHIHUAHUA   Entre Calle:   AVENIDA PACHECO

Página [2] de [3]
Y Calle:   CALLE MEOQUI
Actividades Económicas:
Orden   Actividad Económica   Porcentaje   Fecha Inicio   Fecha Fin
1   Construcción de vivienda unifamiliar   30   10/07/2024
Regímenes:
Régimen   Fecha Inicio   Fecha Fin
Régimen de Sueldos y Salarios e Ingresos Asimilados a Salarios   01/02/2023
Régimen Simplificado de Confianza   01/01/2024
Obligaciones:
Descripción de la Obligación   Descripción Vencimiento   Fecha Inicio   Fecha Fin
Pago provisional mensual de ISR. Régimen Simplificado de Confianza.
A más tardar el día 17 del mes de calendario inmediato posterior
01/01/2024
Página [3] de [3]`;

    const data = parseCSF(csfText);
    assert('PF MATE8602263P8 - extrae RFC', data, [
        { field: 'rfc', match: 'eq', expected: 'MATE8602263P8' },
    ]);
    assert('PF MATE8602263P8 - combina Nombre+Apellidos', data, [
        { field: 'business_name', match: 'eq', expected: 'Edel Argenis Maulas Torres' },
    ]);
    assert('PF MATE8602263P8 - extrae CP', data, [
        { field: 'fiscal_zip_code', match: 'eq', expected: '31060' },
    ]);
    assert('PF MATE8602263P8 - extrae régimen más reciente (RESICO = 626)', data, [
        { field: 'fiscal_regime', match: 'eq', expected: '626' },
        { field: 'fiscal_regime_label', match: 'contains', expected: 'Simplificado de Confianza' },
    ]);
    assert('PF MATE8602263P8 - dirección concatenada con calle/colonia/municipio/estado', data, [
        { field: 'address', match: 'contains', expected: 'Tamborel' },
        { field: 'address', match: 'contains', expected: 'Lealtad' },
        { field: 'address', match: 'contains', expected: 'Chihuahua' },
    ]);
    assert('PF MATE8602263P8 - email y phone son null (no están en la CSF)', data, [
        { field: 'email', match: 'null' },
        { field: 'phone', match: 'null' },
    ]);
}

// =============================================================================
// Test 2: CSF sintético de PM (Persona Moral) - 12 char RFC + Razón Social
// =============================================================================
console.log('\n=== Test 2: CSF sintético de Persona Moral ===');
{
    const csfText = `CÉDULA DE IDENTIFICACIÓN FISCAL
XAXX010101000
Registro Federal de Contribuyentes
INDUSTRIAS ACME
SOCIEDAD ANONIMA DE CAPITAL VARIABLE
Nombre, denominación o razón
social
idCIF: 15010012345
VALIDA TU INFORMACIÓN
FISCAL
CONSTANCIA DE SITUACIÓN FISCAL
Lugar y Fecha de Emisión
CIUDAD DE MÉXICO A 15 DE MARZO DE 2025
XAXX010101000
Datos de Identificación del Contribuyente:
RFC:   XAXX010101000
Razón Social:   INDUSTRIAS ACME SOCIEDAD ANONIMA DE CAPITAL VARIABLE
Régimen Capital:   SA DE CV
Fecha inicio de operaciones:   01 DE ENERO DE 2010
Estatus en el padrón:   ACTIVO
Nombre Comercial:   ACME
Datos del domicilio registrado
Código Postal: 11550   Tipo de Vialidad:   AVENIDA (AV)
Nombre de Vialidad:   PASEO DE LA REFORMA   Número Exterior:   250
Número Interior:   502   Nombre de la Colonia:   JUÁREZ
Nombre de la Localidad:   CIUDAD DE MÉXICO   Nombre del Municipio o Demarcación Territorial:   CUAUHTÉMOC
Nombre de la Entidad Federativa:   CIUDAD DE MÉXICO   Entre Calle:   INSURGENTES SUR
Y Calle:   CALLE BRISTOL
Regímenes:
Régimen   Fecha Inicio   Fecha Fin
General de Ley Personas Morales   01/01/2010
Página [2] de [2]`;

    const data = parseCSF(csfText);
    assert('PM XAXX010101000 - extrae RFC 12 chars', data, [
        { field: 'rfc', match: 'eq', expected: 'XAXX010101000' },
    ]);
    assert('PM XAXX010101000 - extrae Razón Social', data, [
        { field: 'business_name', match: 'contains', expected: 'INDUSTRIAS ACME' },
    ]);
    assert('PM XAXX010101000 - extrae CP', data, [
        { field: 'fiscal_zip_code', match: 'eq', expected: '11550' },
    ]);
    assert('PM XAXX010101000 - extrae régimen (601 = General de Ley PM)', data, [
        { field: 'fiscal_regime', match: 'eq', expected: '601' },
    ]);
    assert('PM XAXX010101000 - dirección con calle/colonia/municipio', data, [
        { field: 'address', match: 'contains', expected: 'Paseo De La Reforma' },
        { field: 'address', match: 'contains', expected: 'Juárez' },
        { field: 'address', match: 'contains', expected: 'Cuauhtémoc' },
    ]);
}

// =============================================================================
// Test 3: Texto vacío / inválido
// =============================================================================
console.log('\n=== Test 3: Casos edge (texto vacío, no-CSF) ===');
{
    const data = parseCSF('');
    assert('Texto vacío - todos los campos son null', data, [
        { field: 'rfc', match: 'null' },
        { field: 'business_name', match: 'null' },
        { field: 'fiscal_regime', match: 'null' },
        { field: 'fiscal_zip_code', match: 'null' },
        { field: 'address', match: 'null' },
        { field: 'email', match: 'null' },
        { field: 'phone', match: 'null' },
    ]);
}
{
    // Un texto que no es CSF
    const data = parseCSF('Hola mundo, esto no es una CSF del SAT.');
    assert('Texto no-CSF - todos los campos son null', data, [
        { field: 'rfc', match: 'null' },
        { field: 'business_name', match: 'null' },
    ]);
}

// =============================================================================
// Test 4: Email del disclaimer del SAT NO debe contaminar
// =============================================================================
console.log('\n=== Test 4: Email del disclaimer del SAT se ignora ===');
{
    const csfText = `CONSTANCIA DE SITUACIÓN FISCAL
RFC: XAXX010101000
Nombre: TEST USER
Código Postal: 12345
contacto@miempresa.com
denuncias@sat.gob.mx
www.sat.gob.mx
Sus datos personales son incorporados y protegidos en los sistemas del SAT
Sello Digital: abc123`;

    const data = parseCSF(csfText);
    if (data.email === 'denuncias@sat.gob.mx') {
        console.log(`  ❌ Email del disclaimer se filtró incorrectamente`);
        failed++;
    } else if (data.email === 'contacto@miempresa.com') {
        console.log(`  ✅ Email del contribuyente extraído correctamente: ${data.email}`);
        passed++;
    } else {
        console.log(`  ❌ Email inesperado: ${data.email} (esperado contacto@miempresa.com)`);
        failed++;
    }
}

// =============================================================================
// Test 5: Variantes de regímenes
// =============================================================================
console.log('\n=== Test 5: Mapeo de regímenes comunes ===');
{
    const tests: Array<[string, string, string]> = [
        // [label en CSF, código esperado, descripción]
        ['Régimen: 601 General de Ley Personas Morales', '601', 'PM general'],
        ['Régimen de Sueldos y Salarios e Ingresos Asimilados a Salarios', '605', 'PF asalariado'],
        ['Régimen Simplificado de Confianza', '626', 'RESICO'],
        ['Régimen de Arrendamiento', '606', 'arrendamiento'],
        ['Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas', '625', 'plataformas'],
    ];
    for (const [label, expectedCode, desc] of tests) {
        const csfText = `CONSTANCIA DE SITUACIÓN FISCAL
RFC: XAXX010101000
Regímenes:
${label}   01/01/2020`;
        const data = parseCSF(csfText);
        if (data.fiscal_regime === expectedCode) {
            console.log(`  ✅ Régimen ${desc} (${expectedCode}) detectado correctamente`);
            passed++;
        } else {
            console.log(`  ❌ Régimen ${desc}: esperado ${expectedCode}, got ${data.fiscal_regime} (label: "${data.fiscal_regime_label}")`);
            failed++;
        }
    }
}

// =============================================================================
// Resumen
// =============================================================================
console.log(`\n📊 Resumen: ${passed} pasaron, ${failed} fallaron (de ${passed + failed} total)`);
if (failed > 0) process.exit(1);
