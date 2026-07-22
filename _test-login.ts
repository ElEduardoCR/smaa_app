// Script para probar el flujo de login end-to-end
const BASE = 'http://localhost:3000';

async function getLoginPage() {
    const res = await fetch(`${BASE}/login`);
    const html = await res.text();
    return html;
}

async function tryLogin(username: string, password: string) {
    // En Next.js, los server actions se llaman con POST a la página
    // con un header Next-Action que contiene el ID del action
    // y el body contiene los args serializados

    // Primero obtenemos la página para encontrar el action ID
    const html = await getLoginPage();

    // Buscamos el action ID (formato: "Next-Action" en los chunks)
    // En realidad el cliente genera un hash único. Esto es complicado.

    // Forma alternativa: usamos la API de Next.js para server actions
    // El cliente envía: POST /login con header 'Next-Action: <hash>'
    // y body: [args serializados]

    // Vamos a invocar el server action via el endpoint interno
    // Next 16 usa un endpoint especial para esto

    // La forma más simple: hacer un POST normal con form data
    // El server action recibe los args y procesa

    // Vamos a probar primero a ver si la página tiene el action ID
    const actionMatch = html.match(/data-action="([^"]+)"/);
    console.log('Action ID found:', actionMatch?.[1] || 'NOT FOUND');

    // Buscar el script que define los action IDs
    const scriptMatch = html.match(/"([a-f0-9]{40})"/g);
    console.log('Possible action IDs (40-char hex):', scriptMatch?.slice(0, 5));

    // En Next 16, los server actions se llaman con un POST a la página
    // El header 'next-action' contiene el ID
    // El body es FormData con los args

    // Probemos con un fetch genérico
    const res = await fetch(`${BASE}/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password, redirectTo: '/' }),
        redirect: 'manual',
    });
    return { status: res.status, headers: Object.fromEntries(res.headers), text: (await res.text()).slice(0, 500) };
}

(async () => {
    console.log('--- Probando /login ---');
    const html = await getLoginPage();
    console.log('Login page size:', html.length, 'bytes');
    console.log('Has SMAA:', html.includes('SMAA ERP'));
    console.log('Has selecciona:', html.includes('Selecciona'));

    console.log('\n--- Probando login con admin/admin2026 ---');
    const result = await tryLogin('admin', 'admin2026');
    console.log('Status:', result.status);
    console.log('Set-Cookie:', result.headers['set-cookie']);
    console.log('Response body (first 500):', result.text);
})();
