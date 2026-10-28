import type { IncomingMessage, ServerResponse } from 'node:http';

/** Local authority invalidations. Payloads never include annotation or scene data. */
export function createChangeFeed() {
  const readers = new Set<ServerResponse>();
  const publish = (uri?: string) => {
    const frame = `data: ${JSON.stringify(uri ? { uri } : {})}\n\n`;
    for (const res of readers) {
      if (res.writableNeedDrain) res.destroy();
      else res.write(frame);
    }
  };
  return {
    stream(req: IncomingMessage, res: ServerResponse) {
      if (req.method !== 'GET') { res.writeHead(405).end(); return; }
      if (readers.size >= 32) { res.writeHead(503).end(); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' });
      res.write('data: {}\n\n'); // Reconnects invalidate discovery after any missed changes.
      readers.add(res);
      const timer = setInterval(() => { if (res.writableNeedDrain) res.destroy(); else res.write(': heartbeat\n\n'); }, 15_000);
      timer.unref();
      res.once('close', () => { clearInterval(timer); readers.delete(res); });
    },
    observe(req: IncomingMessage, res: ServerResponse, url: URL) {
      if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method ?? '')) return;
      res.once('finish', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return;
        const file = url.searchParams.get('file');
        if (file && ['/api/annotations', '/api/artifact-feedback'].includes(url.pathname)) {
          publish(`agent-pages://${url.pathname === '/api/annotations' ? 'annotations' : 'feedback'}/${encodeURIComponent(file)}`);
        } else if (/^\/api\/boards\/[^/]+$/.test(url.pathname)) {
          publish(`agent-pages://whiteboards/${url.pathname.split('/')[3]}`);
        } else if (url.pathname === '/api/boards' || url.pathname === '/api/artifacts') publish();
      });
    },
    close() { for (const res of readers) res.destroy(); readers.clear(); },
  };
}
