import { afterEach, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApi } from '../server/api.ts';
import { AnnotationConflictError, AnnotationStore, MAX_ANNOTATION_RECEIPTS } from '../server/annotations.ts';
import { MAX_ANNOTATION_REQUEST_BYTES, type Annotation, type AnnotationDocument } from '../src/features/annotations/contract.ts';

const cleanups: (() => Promise<unknown> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

function annotation(overrides: Partial<Annotation> = {}): Annotation {
  return { id: randomUUID(), kind: 'rectangle', points: [{ x: 10, y: 20 }, { x: 100, y: 80 }], bounds: { x: 10, y: 20, width: 90, height: 60 }, comment: 'Align this', viewport: { width: 1280, height: 720 }, pageSize: { width: 1280, height: 1400 }, ...overrides };
}
const submission = (...annotations: Annotation[]) => ({ batchId: randomUUID(), annotations });

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'annotations-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, '.agent-pages');
  const store = new AnnotationStore(directory);
  cleanups.push(() => store.close());
  return { root, directory, store };
}

test('explicit batches commit durably, isolate artifacts, restart and keep storage private', async () => {
  const { store, directory } = await fixture();
  expect(await store.get('review.tsx')).toEqual({ file: 'review.tsx', revision: 0, updatedAt: null, batches: [] });
  const input = submission(annotation({ anchor: { selector: '#hero', tag: 'section', text: 'Hero', context: '<Hero> at src/pages/review.tsx:12' } }));
  const saved = await store.submit('review.tsx', input);
  expect(saved.revision).toBe(1);
  expect(saved.batches[0].id).toBe(input.batchId);
  expect(saved.batches[0].annotations).toEqual(input.annotations);
  expect(saved.updatedAt).not.toBeNull();
  expect((await store.get('other.tsx')).batches).toEqual([]);
  const reader = new AnnotationStore(directory);
  cleanups.push(() => reader.close());
  expect(await reader.get('review.tsx')).toEqual(saved);
  await reader.close();
  await store.close();
  const restarted = new AnnotationStore(directory);
  cleanups.push(() => restarted.close());
  expect(await restarted.get('review.tsx')).toEqual(saved);
  for (const file of ['annotations.sqlite', 'annotations.sqlite-wal', 'annotations.sqlite-shm']) expect((await stat(path.join(directory, file))).mode & 0o777).toBe(0o600);
  expect((await stat(directory)).mode & 0o777).toBe(0o700);
  await expect(store.get('review.tsx')).rejects.toThrow('closed');
});

test('durable receipts prevent retries resurrecting cleared annotations and remain bounded without eviction', async () => {
  const { store, directory } = await fixture();
  const first = annotation();
  const second = annotation();
  const input = submission(first, second);
  await store.submit('review.tsx', input);
  const selected = await store.clear('review.tsx', { baseRevision: 1, ids: [first.id] });
  expect(await store.submit('review.tsx', input)).toEqual(selected);
  const cleared = await store.clear('review.tsx', { baseRevision: 2 });
  await store.close();
  const restarted = new AnnotationStore(directory);
  cleanups.push(() => restarted.close());
  expect(await restarted.submit('review.tsx', input)).toEqual(cleared);
  await expect(restarted.submit('review.tsx', { ...input, annotations: [first] })).rejects.toBeInstanceOf(AnnotationConflictError);
  const db = new DatabaseSync(path.join(directory, 'annotations.sqlite'));
  cleanups.push(() => db.close());
  const insert = db.prepare('INSERT INTO annotation_receipts (file, batch_id, hash) VALUES (?, ?, ?)');
  db.exec('BEGIN');
  for (let i = 1; i < MAX_ANNOTATION_RECEIPTS; i++) insert.run('review.tsx', randomUUID(), '0'.repeat(64));
  db.exec('COMMIT');
  await expect(restarted.submit('review.tsx', submission(annotation()))).rejects.toThrow('receipt capacity');
  expect(await restarted.submit('review.tsx', input)).toEqual(cleared);
  expect(await restarted.get('review.tsx')).toEqual(cleared);
});

test('subscriptions observe only committed writes, unsubscribe and close are owned by the store', async () => {
  const { store, directory } = await fixture();
  await store.get('review.tsx');
  const db = new DatabaseSync(path.join(directory, 'annotations.sqlite'));
  cleanups.push(() => db.close());
  const seen: number[] = [];
  const committed: unknown[] = [];
  let closed = 0;
  const stop = await store.subscribe('review.tsx', {
    annotations(doc) {
      seen.push(doc.revision);
      if (doc.revision) committed.push(db.prepare('SELECT snapshot FROM artifact_annotations WHERE file = ?').get('review.tsx')?.snapshot);
    },
    close() { closed++; },
  });
  db.exec(`CREATE TRIGGER fail_write BEFORE INSERT ON artifact_annotations BEGIN SELECT RAISE(ABORT, 'disk failure'); END;`);
  const input = submission(annotation());
  await expect(store.submit('review.tsx', input)).rejects.toThrow('disk failure');
  expect(seen).toEqual([0]);
  expect((await store.get('review.tsx')).revision).toBe(0);
  db.exec('DROP TRIGGER fail_write');
  await store.submit('review.tsx', input);
  expect(seen).toEqual([0, 1]);
  expect(committed.map(snapshot => JSON.parse(String(snapshot)).revision)).toEqual([1]);
  stop();
  await store.clear('review.tsx', { baseRevision: 1 });
  expect(seen).toEqual([0, 1]);
  await store.subscribe('review.tsx', { annotations() {}, close() { closed++; } });
  const queued = store.submit('review.tsx', submission(annotation()));
  const closing = store.close();
  await queued;
  await closing;
  await store.close();
  expect(closed).toBe(1);
  await expect(store.subscribe('review.tsx', { annotations() {}, close() {} })).rejects.toThrow('closed');
});

test('a full annotation inbox rejects a new batch without changing saved notes', async () => {
  const { store } = await fixture();
  let doc = await store.get('review.tsx');
  for (let i = 0; i < 100; i++) doc = await store.submit('review.tsx', submission(annotation()));
  await expect(store.submit('review.tsx', submission(annotation()))).rejects.toThrow();
  expect(await store.get('review.tsx')).toEqual(doc);
});

async function httpFixture() {
  const { root } = await fixture();
  const pages = path.join(root, 'src/pages');
  await mkdir(pages, { recursive: true });
  await writeFile(path.join(pages, 'review.tsx'), 'export default () => null;');
  await symlink(path.join(pages, 'review.tsx'), path.join(pages, 'linked.tsx'));
  await mkdir(path.join(pages, 'directory.tsx'));
  const api = createApi(root);
  cleanups.push(() => api.close());
  const server = createServer((req, res) => api.handle(req, res, () => { res.writeHead(404).end(); }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected port');
  const base = `http://127.0.0.1:${address.port}`;
  const request = (file: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => fetch(`${base}/api/annotations?file=${encodeURIComponent(file)}`, {
    method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } }),
  });
  return { api, base, request };
}

test('HTTP guards artifacts, methods, request size and origin; returns conflict snapshots', async () => {
  const { request, base } = await httpFixture();
  for (const [file, status] of [['../review.tsx', 400], ['missing.tsx', 404], ['linked.tsx', 400], ['directory.tsx', 400]] as const) expect((await request(file)).status).toBe(status);
  expect((await fetch(`${base}/api/annotations`)).status).toBe(400);
  expect((await fetch(`${base}/api/annotations/unknown?file=review.tsx`)).status).toBe(404);
  expect((await request('review.tsx', 'PATCH', {})).status).toBe(405);
  const input = submission(annotation());
  expect((await request('review.tsx', 'POST', input, { origin: 'https://attacker.test' })).status).toBe(403);
  expect((await request('review.tsx', 'POST', input, { 'content-type': 'text/plain' })).status).toBe(415);
  expect((await request('review.tsx', 'POST', { comment: 'x'.repeat(MAX_ANNOTATION_REQUEST_BYTES) })).status).toBe(413);
  const saved = await (await request('review.tsx', 'POST', input)).json();
  expect(saved.revision).toBe(1);
  expect(await (await request('review.tsx', 'POST', input)).json()).toEqual(saved);
  const conflict = await request('review.tsx', 'DELETE', { baseRevision: 0 });
  expect(conflict.status).toBe(409);
  expect((await conflict.json()).annotations).toEqual(saved);
  expect((await request('review.tsx', 'DELETE', { baseRevision: 1 })).status).toBe(200);
  expect((await (await request('review.tsx')).json()).batches).toEqual([]);
});
