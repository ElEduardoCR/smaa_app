// Quick test para calibrar csfParser contra un CSF real.
// Uso: npx tsx scripts/test-csf-parser.ts
import { parseCSF } from '../src/lib/csfParser';

// Texto extraído de la CSF MATE8602263P8 EDEL ARGENIS MAULAS TORRES.pdf
const csfText = `Página [1] de [3]
CÉDULA DE IDENTIFICACIÓN FISCAL
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
2   Construcción de inmuebles comerciales, institucionales y de servicios   20   10/07/2024
4   Instalaciones eléctricas en construcciones   20   10/07/2024
3   Construcción de obras para telecomunicaciones   20   10/07/2024
2   Asalariado   10   01/02/2023
Regímenes:
Régimen   Fecha Inicio   Fecha Fin
Régimen de Sueldos y Salarios e Ingresos Asimilados a Salarios   01/02/2023
Régimen Simplificado de Confianza   01/01/2024
Obligaciones:
Descripción de la Obligación   Descripción Vencimiento   Fecha Inicio   Fecha Fin
Pago provisional mensual de ISR. Régimen Simplificado de Confianza.
A más tardar el día 17 del mes de calendario
inmediato posterior a aquél al que corresponda
el pago
01/01/2024
Pago definitivo mensual de IVA. Régimen Simplificado de
Confianza.
A   más   tardar   el   día   17   del   mes   inmediato
posterior al periodo que corresponda.
01/01/2024
Ajuste anual de ISR correspondiente a la declaración anual.
Régimen Simplificado de Confianza.
A más tardar el día 30 del mes de abril del
ejercicio siguiente
01/01/2024
Sus datos personales son incorporados y protegidos en los sistemas del SAT, de conformidad con los Lineamientos de Protección de Datos
Personales y con diversas disposiciones fiscales y legales sobre confidencialidad y protección de datos, a fin de ejercer las facultades
conferidas a la autoridad fiscal.
Si desea modificar o corregir sus datos personales, puede acudir a cualquier Módulo de Servicios Tributarios y/o a través de la dirección
http://sat.gob.mx
"La corrupción tiene consecuencias ¡denúnciala! Si conoces algún posible acto de corrupción o delito presenta una queja o denuncia a través
de: www.sat.gob.mx, denuncias@sat.gob.mx, desde México: (55) 8852 2222, desde el extranjero: + 55 8852 2222, SAT móvil o www.gob.mx/sfp".
Cadena Original Sello:   ||2024/07/10|MATE8602263P8|CONSTANCIA DE SITUACIÓN FISCAL|200001088888800000031||
Sello Digital:   GsCvG8y2KZ0HaUiGHckEMzlKQKBeHLmUjMuylASZ6kIrQQZdTaWBuK3xT+6jq/iqS8pM/vqlRV4pfWyGP61rRf
wJTWlJL90cqfjd4ns6fBV6ZRoxEaci16GIksj9YBwkCH9a4NOGNr1Bze7uk92+Q0KOXniKxiWWbOpaI/YdUtU=

Página [3] de [3]`;

console.log('=================================');
console.log('TEST: parseCSF contra CSF real');
console.log('=================================\n');

const result = parseCSF(csfText);

console.log(JSON.stringify(result, null, 2));

console.log('\n=================================');
console.log('Verificación de valores esperados:');
console.log('=================================\n');

const expectations: Array<[string, any, any]> = [
    ['rfc', result.rfc, 'MATE8602263P8'],
    ['business_name', result.business_name, 'Edel Argenis Maulas Torres'],
    ['fiscal_regime', result.fiscal_regime === '626', true],
    ['fiscal_zip_code', result.fiscal_zip_code, '31060'],
    ['address', result.address?.includes('Tamborel'), true],
    ['address', result.address?.includes('Lealtad'), true],
    ['address', result.address?.includes('Chihuahua'), true],
];

let passed = 0, failed = 0;
for (const [label, actual, expected] of expectations) {
    const ok = typeof expected === 'string'
        ? actual === expected
        : actual === expected;
    if (ok) {
        console.log(`  ✅ ${label}: ${JSON.stringify(actual)}`);
        passed++;
    } else {
        console.log(`  ❌ ${label}: ${JSON.stringify(actual)} (esperado: ${JSON.stringify(expected)})`);
        failed++;
    }
}

console.log(`\n📊 ${passed} pasaron, ${failed} fallaron`);
if (failed > 0) process.exit(1);
