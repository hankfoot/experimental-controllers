import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT) || 8000;
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname.split('/').some((segment) => segment.startsWith('.'))) {
      respond(response, 404, 'Not found');
      return;
    }
    const requestedPath = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (requestedPath !== root && !requestedPath.startsWith(`${root}${sep}`)) {
      respond(response, 403, 'Forbidden');
      return;
    }
    const info = await stat(requestedPath);
    if (!info.isFile()) throw new Error('Not a file');
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': contentTypes[extname(requestedPath)] ?? 'application/octet-stream',
    });
    createReadStream(requestedPath).pipe(response);
  } catch {
    respond(response, 404, 'Not found');
  }
}).listen(port, () => {
  console.log(`Static site running at http://localhost:${port}`);
});

function respond(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(body);
}
