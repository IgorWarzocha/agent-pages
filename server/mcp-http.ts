import { timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type RequestListener } from 'node:http';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { AgentPagesClient } from './http-client.ts';
import { createMcpServer } from './mcp.ts';
import { MAX_SCENE_BYTES } from '../src/features/whiteboard/contract.ts';
import { watchMcpChanges } from './mcp-events.ts';

export async function readMcpToken(file: string) {
  const info = await stat(file);
  if (!info.isFile() || (process.platform !== 'win32' && ((info.mode & 0o077) || info.uid !== process.getuid?.()))) {
    throw new Error('MCP token must be a regular file owned by the service user with mode 0600');
  }
  const token = (await readFile(file, 'utf8')).trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('MCP token must contain 64 lowercase hexadecimal characters');
  return token;
}

export function createMcpHttpHandler({ token, client, origins = [], maxBodyBytes = MAX_SCENE_BYTES }: {
  token: string; client: AgentPagesClient; origins?: string[]; maxBodyBytes?: number;
}) {
  const expected = Buffer.from(`Bearer ${token}`);
  const handler = createMcpHandler(ctx => createMcpServer(client, ctx.era), { maxSubscriptions: 16, maxRequestBodySize: maxBodyBytes });
  const dispatch = toNodeHandler(handler, { maxRequestBodySize: maxBodyBytes, onerror: error => console.error('MCP HTTP adapter:', error) });
  const subscriptions = new Set<import('node:http').ServerResponse>();
  const stopWatching = watchMcpChanges(client, uri => { if (uri) handler.notify.resourceUpdated(uri); else handler.notify.resourcesChanged(); }, () => {
    for (const res of subscriptions) res.destroy();
  });
  let active = 0;
  const listener: RequestListener = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const auth = Buffer.from(req.headers.authorization ?? '');
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end('Bearer token required'); return;
    }
    if (req.headers.origin && !origins.includes(req.headers.origin)) {
      res.writeHead(403).end('Origin not allowed'); return;
    }
    if (req.url !== '/mcp') { res.writeHead(404).end(); return; }
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }).end(); return; }
    if (active >= 16) { res.writeHead(503).end('MCP request capacity reached'); return; }
    if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      res.writeHead(415).end('Expected application/json'); return;
    }
    active++;
    let subscription = false;
    const timer = setTimeout(() => req.destroy(), 10000);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      if (subscription) subscriptions.delete(res);
      else active--;
    };
    res.once('close', close);
    try {
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > maxBodyBytes) { res.writeHead(413).end('MCP request exceeds size limit'); return; }
        chunks.push(Buffer.from(chunk));
      }
      clearTimeout(timer);
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { res.writeHead(400).end('Invalid JSON'); return; }
      if (closed) return;
      if (body !== null && typeof body === 'object' && 'method' in body && body.method === 'subscriptions/listen') {
        // The SDK separately caps listeners. They must not consume the slots
        // needed to read resources, call tools or cancel those listeners.
        active--;
        subscription = true;
        subscriptions.add(res);
      }
      await dispatch(req, res, body);
    } catch (error) {
      console.error('MCP HTTP request failed:', error instanceof Error ? error.message : 'Unknown error');
      if (!res.headersSent && !res.destroyed) res.writeHead(500).end('MCP request failed');
      else if (!res.writableEnded) res.end();
    } finally {
      clearTimeout(timer);
      if (res.writableEnded || res.destroyed) close();
    }
  };
  return Object.assign(listener, { async close() { await stopWatching(); await handler.close(); } });
}

export function createMcpHttpServer(options: Parameters<typeof createMcpHttpHandler>[0]) {
  const handler = createMcpHttpHandler(options);
  const server = createServer(handler);
  server.once('close', () => { void handler.close().catch(error => console.error('MCP shutdown:', error)); });
  server.headersTimeout = 10000;
  server.requestTimeout = 15000;
  server.maxConnections = 64;
  return server;
}
