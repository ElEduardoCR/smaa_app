// Proxy delante de Next (3001 → 3000) que reproduce el límite fijo de 4.5 MB
// del cuerpo de las requests en funciones de Vercel (FUNCTION_PAYLOAD_TOO_LARGE).
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';

const LIMIT = 4.5 * 1024 * 1024;
const LOG = new URL('./vercel-sim.log', import.meta.url).pathname;

http.createServer((req, res) => {
    const len = Number(req.headers['content-length'] || 0);
    const reject = () => {
        fs.appendFileSync(LOG, `${new Date().toISOString()} 413 ${req.method} ${req.url} (${len} bytes)\n`);
        res.writeHead(413, { 'content-type': 'text/plain', 'x-vercel-error': 'FUNCTION_PAYLOAD_TOO_LARGE' });
        res.end('Request Entity Too Large\n\nFUNCTION_PAYLOAD_TOO_LARGE\n');
    };
    if (len > LIMIT) { req.resume(); return reject(); }
    const up = http.request({ host: '127.0.0.1', port: 3000, method: req.method, path: req.url, headers: req.headers }, (r) => {
        res.writeHead(r.statusCode, r.headers);
        r.pipe(res);
    });
    up.on('error', (e) => { res.writeHead(502); res.end(e.message); });
    let seen = 0;
    req.on('data', (c) => {
        seen += c.length;
        if (seen > LIMIT) { up.destroy(); req.destroy(); }
    });
    req.pipe(up);
}).on('upgrade', (req, socket, head) => {
    // WebSocket del HMR de Next: túnel TCP transparente
    const up = net.connect(3000, '127.0.0.1', () => {
        const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
        for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
        up.write(lines.join('\r\n') + '\r\n\r\n');
        if (head?.length) up.write(head);
        up.pipe(socket);
        socket.pipe(up);
    });
    up.on('error', () => socket.destroy());
    socket.on('error', () => up.destroy());
}).listen(3001, '127.0.0.1', () => console.log('vercel-sim on 3001'));
