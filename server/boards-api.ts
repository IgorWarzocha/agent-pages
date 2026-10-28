import type { IncomingMessage, ServerResponse } from 'node:http';
import { boardIdSchema, MAX_PREVIEW_REQUEST_BYTES } from '../src/features/whiteboard/contract.ts';
import { json, readJson } from './http.ts';
import { BoardError, WhiteboardStore } from './whiteboards.ts';

function streamBoard(req: IncomingMessage, res: ServerResponse, store: WhiteboardStore, id: string) {
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const cleanup = () => {
    closed = true;
    unsubscribe?.();
    if (heartbeat) clearInterval(heartbeat);
    res.end();
  };
  res.once('close', cleanup);
  req.once('aborted', cleanup);
  return store.subscribe(id, {
    scene(scene) {
      if (closed) return;
      if (!res.headersSent) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      }
      // Allow one bounded snapshot in flight, not an unbounded queue for slow readers.
      if (res.writableNeedDrain) { cleanup(); return; }
      res.write(`event: scene\nid: ${scene.revision}\ndata: ${JSON.stringify(scene)}\n\n`);
    },
    close: cleanup,
  }).then(stop => {
    unsubscribe = stop;
    if (closed) { stop(); return; }
    heartbeat = setInterval(() => { if (!res.writableNeedDrain) res.write(': heartbeat\n\n'); }, 15_000);
    heartbeat.unref();
  }).catch(error => {
    res.removeListener('close', cleanup);
    req.removeListener('aborted', cleanup);
    if (heartbeat) clearInterval(heartbeat);
    throw error;
  });
}

export async function boardsApi(req: IncomingMessage, res: ServerResponse, pathname: string, store: WhiteboardStore) {
  const match = /^\/api\/boards(?:\/([^/]+)(\/events|\/preview|\/save|\/checkpoints|\/changes)?)?$/.exec(pathname);
  if (!match) throw new BoardError(404, 'Endpoint not found');
  const id = match[1] ? boardIdSchema.parse(match[1]) : undefined;
  if (!id) {
    if (req.method === 'GET') return json(res, 200, await store.list());
    if (req.method === 'POST') return json(res, 201, await store.create(await readJson(req)));
  } else if (match[2] === '/save') {
    if (req.method === 'POST') return json(res, 200, await store.save(id));
  } else if (match[2] === '/checkpoints') {
    if (req.method === 'POST') return json(res, 201, await store.checkpoint(id, await readJson(req)));
  } else if (match[2] === '/changes') {
    if (req.method === 'GET') {
      const params = new URL(req.url ?? '/', 'http://localhost').searchParams;
      const checkpoint = boardIdSchema.parse(params.get('checkpoint'));
      const target = boardIdSchema.optional().parse(params.get('toCheckpoint') ?? undefined);
      return json(res, 200, await store.changes(id, checkpoint, target));
    }
  } else if (match[2] === '/preview') {
    if (req.method === 'GET') return json(res, 200, await store.getPreview(id));
    if (req.method === 'PUT') return json(res, 200, await store.putPreview(id, await readJson(req, MAX_PREVIEW_REQUEST_BYTES)));
  } else if (match[2] === '/events') {
    if (req.method === 'GET') return streamBoard(req, res, store, id);
  } else {
    if (req.method === 'GET') {
      const checkpoint = boardIdSchema.optional().parse(new URL(req.url ?? '/', 'http://localhost').searchParams.get('checkpoint') ?? undefined);
      return json(res, 200, await store.get(id, checkpoint));
    }
    if (req.method === 'PATCH') return json(res, 200, await store.update(id, await readJson(req)));
  }
  throw new BoardError(405, 'Method not allowed');
}
