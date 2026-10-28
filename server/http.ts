import type { IncomingMessage, ServerResponse } from 'node:http';
import { ZodError } from 'zod';
import { MAX_SCENE_BYTES } from '../src/features/whiteboard/contract.ts';
import { BoardError } from './whiteboards.ts';

export function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

export function failure(res: ServerResponse, error: unknown) {
  if (res.headersSent) { res.destroy(); return; }
  if (error instanceof BoardError) return json(res, error.status, { error: error.message, ...(error.scene ? { scene: error.scene } : {}) });
  if (error instanceof ZodError || error instanceof SyntaxError) return json(res, 400, { error: error.message });
  console.error('[agent-pages API]', error);
  json(res, 500, { error: 'Server operation failed. See the Agent Pages terminal.' });
}

export function checkRequest(req: IncomingMessage) {
  const host = req.headers.host;
  if (!host || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) throw new BoardError(403, 'Local host required');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method ?? '')) {
    if (req.headers.origin && req.headers.origin !== `http://${host}`) throw new BoardError(403, 'Cross-origin writes are forbidden');
    if (req.headers['sec-fetch-site'] === 'cross-site') throw new BoardError(403, 'Cross-site writes are forbidden');
    if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new BoardError(415, 'Use application/json');
  }
}

export async function readJson(req: IncomingMessage, limit = MAX_SCENE_BYTES): Promise<unknown> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) throw new BoardError(413, 'Request exceeds size limit');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw new BoardError(413, 'Request exceeds size limit');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
