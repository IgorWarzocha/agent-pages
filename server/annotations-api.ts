import { lstat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { MAX_ANNOTATION_REQUEST_BYTES } from '../src/features/annotations/contract.ts';
import { AnnotationConflictError, type AnnotationStore } from './annotations.ts';
import { artifactFileSchema } from './artifacts-api.ts';
import { json, readJson } from './http.ts';
import { BoardError } from './whiteboards.ts';

function streamAnnotations(req: IncomingMessage, res: ServerResponse, store: AnnotationStore, file: string) {
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    unsubscribe?.();
    if (heartbeat) clearInterval(heartbeat);
    req.removeListener('aborted', cleanup);
    res.removeListener('close', cleanup);
    res.end();
  };
  res.once('close', cleanup);
  req.once('aborted', cleanup);
  return store.subscribe(file, {
    annotations(document) {
      if (closed) return;
      if (!res.headersSent) res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      // At most one bounded document may be queued per reader.
      if (res.writableNeedDrain) { cleanup(); return; }
      res.write(`event: annotations\nid: ${document.revision}\ndata: ${JSON.stringify(document)}\n\n`);
    },
    close: cleanup,
  }).then(stop => {
    unsubscribe = stop;
    if (closed) { stop(); return; }
    heartbeat = setInterval(() => {
      if (res.writableNeedDrain) cleanup();
      else res.write(': heartbeat\n\n');
    }, 15_000);
    heartbeat.unref();
  }).catch(error => {
    res.removeListener('close', cleanup);
    req.removeListener('aborted', cleanup);
    if (heartbeat) clearInterval(heartbeat);
    throw error;
  });
}

export async function annotationsApi(req: IncomingMessage, res: ServerResponse, url: URL, pagesDir: string, store: AnnotationStore) {
  const events = url.pathname === '/api/annotations/events';
  if (!events && url.pathname !== '/api/annotations') throw new BoardError(404, 'Endpoint not found');
  if (events ? req.method !== 'GET' : !['GET', 'POST', 'DELETE'].includes(req.method ?? '')) throw new BoardError(405, 'Method not allowed');
  const file = artifactFileSchema.parse(url.searchParams.get('file'));
  try {
    const stat = await lstat(path.join(pagesDir, file));
    if (stat.isSymbolicLink() || !stat.isFile()) throw new BoardError(400, 'Annotations require a regular artifact file, not a symlink');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') throw new BoardError(404, 'Artifact not found');
    throw error;
  }
  if (events) return streamAnnotations(req, res, store, file);
  if (req.method === 'GET') return json(res, 200, await store.get(file));
  try {
    const input = await readJson(req, MAX_ANNOTATION_REQUEST_BYTES);
    return json(res, 200, await (req.method === 'POST' ? store.submit(file, input) : store.clear(file, input)));
  } catch (error) {
    if (error instanceof AnnotationConflictError) return json(res, 409, { error: error.message, annotations: error.annotations });
    throw error;
  }
}
