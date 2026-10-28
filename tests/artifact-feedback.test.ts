import { afterEach, expect, test } from 'bun:test';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApi } from '../server/api.ts';
import { FeedbackConflictError, FeedbackStore } from '../server/feedback.ts';
import { MAX_FEEDBACK_BYTES } from '../src/features/feedback/contract.ts';

const cleanups: (() => Promise<unknown> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'artifact-feedback-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, '.agent-pages');
  const store = new FeedbackStore(directory);
  cleanups.push(() => store.close());
  return { root, directory, store };
}

test('feedback commits durably, isolates artifacts and restarts with private storage', async () => {
  const { store, directory } = await fixture();
  expect(await store.get('review.tsx')).toEqual({ file: 'review.tsx', revision: 0, updatedAt: null, values: {} });
  const saved = await store.update('review.tsx', { baseRevision: 0, values: { score: 4, approved: true, comment: 'Ship it', nested: { choices: [null, 'yes'] } } });
  expect(saved.revision).toBe(1);
  expect(saved.updatedAt).not.toBeNull();
  expect((await store.get('other.tsx')).values).toEqual({});
  // A second connection sees the completed commit before the first store closes.
  const reader = new FeedbackStore(directory);
  cleanups.push(() => reader.close());
  expect(await reader.get('review.tsx')).toEqual(saved);
  await reader.close();
  await store.close();
  const restarted = new FeedbackStore(directory);
  cleanups.push(() => restarted.close());
  expect(await restarted.get('review.tsx')).toEqual(saved);
  expect((await stat(directory)).mode & 0o777).toBe(0o700);
  expect((await stat(path.join(directory, 'feedback.sqlite'))).mode & 0o777).toBe(0o600);
  await expect(store.get('review.tsx')).rejects.toThrow('closed');
});

test('CAS rejects stale concurrent submissions without overwriting the winning values', async () => {
  const { store } = await fixture();
  const results = await Promise.allSettled([
    store.update('review.tsx', { baseRevision: 0, values: { choice: 'first' } }),
    store.update('review.tsx', { baseRevision: 0, values: { choice: 'second' } }),
  ]);
  expect(results[0].status).toBe('fulfilled');
  expect(results[1].status).toBe('rejected');
  if (results[1].status !== 'rejected') throw new Error('Expected revision conflict');
  expect(results[1].reason).toBeInstanceOf(FeedbackConflictError);
  const saved = await store.get('review.tsx');
  expect(results[1].reason.feedback).toEqual(saved);
  expect(saved.values).toEqual({ choice: 'first' });
  expect((await store.update('review.tsx', { baseRevision: 1, values: { choice: 'reconciled' } })).revision).toBe(2);
});

test('HTTP requires a real artifact, bounded explicit submissions, local origin and conflict feedback', async () => {
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
  if (!address || typeof address === 'string') throw new Error('Expected HTTP port');
  const request = (file: string, body?: unknown, headers: Record<string, string> = {}) => fetch(`http://127.0.0.1:${address.port}/api/artifact-feedback?file=${encodeURIComponent(file)}`, {
    method: body === undefined ? 'GET' : 'PATCH',
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } }),
  });
  expect((await request('../review.tsx')).status).toBe(400);
  expect((await request('missing.tsx')).status).toBe(404);
  expect((await request('linked.tsx')).status).toBe(400);
  expect((await request('directory.tsx')).status).toBe(400);
  const initial = await request('review.tsx');
  expect(initial.status).toBe(200);
  expect(await initial.json()).toEqual({ file: 'review.tsx', revision: 0, updatedAt: null, values: {} });
  const update = { baseRevision: 0, values: { selected: 'A' } };
  expect((await request('review.tsx', update, { origin: 'https://attacker.test' })).status).toBe(403);
  expect((await request('review.tsx', update, { 'content-type': 'text/plain' })).status).toBe(415);
  expect((await request('review.tsx', { baseRevision: 0, values: { text: 'a'.repeat(MAX_FEEDBACK_BYTES) } })).status).toBe(413);
  expect((await request('review.tsx', { baseRevision: 0, values: { text: 'a'.repeat(8193) } })).status).toBe(400);
  const saved = await (await request('review.tsx', update)).json();
  expect(saved.revision).toBe(1);
  const conflict = await request('review.tsx', { baseRevision: 0, values: { selected: 'B' } });
  expect(conflict.status).toBe(409);
  expect((await conflict.json()).feedback).toEqual(saved);
  expect(await (await request('review.tsx')).json()).toEqual(saved);
});
