import { afterEach, expect, test } from 'bun:test';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApi } from '../server/api.ts';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { z } from 'zod';
import { MAX_PREVIEW_BYTES } from '../src/features/whiteboard/contract.ts';

const imageData = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/F4sAAAAASUVORK5CYII=';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function apiFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-pages-api-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src/pages'), { recursive: true });
  const api = createApi(root);
  const server = createServer((req, res) => api.handle(req, res, () => { res.writeHead(404).end(); }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(async () => {
    await api.close();
    await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected HTTP port');
  const url = `http://127.0.0.1:${address.port}`;
  const request = (route: string, method = 'GET', body?: unknown, headers?: Record<string, string>) => fetch(`${url}${route}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } }) });
  return { api, url, request, root };
}

test('HTTP origin, size, IDs, optimistic conflicts and SSE snapshots', async () => {
  const { request, api } = await apiFixture();
  expect((await request('/api/boards', 'POST', { title: 'Bad origin' }, { origin: 'https://attacker.test' })).status).toBe(403);
  expect((await request('/api/boards', 'POST', { title: 'x' }, { 'content-type': 'text/plain' })).status).toBe(415);
  expect((await request('/api/boards', 'POST', { title: '' })).status).toBe(400);
  expect((await request('/api/boards/invalid')).status).toBe(400);
  const created = await request('/api/boards', 'POST', { title: 'Shared' });
  expect(created.status).toBe(201);
  const board = await created.json();
  expect((await request('/missing')).status).toBe(404);
  const stream = await request(`/api/boards/${board.id}/events`);
  expect(stream.headers.get('content-type')).toBe('text/event-stream');
  const reader = stream.body!.getReader();
  cleanups.push(() => reader.cancel());
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('"revision":0');
  const committed = await request(`/api/boards/${board.id}`, 'PATCH', { baseRevision: 0, elements: [], files: {} });
  expect((await committed.json()).revision).toBe(1);
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('"revision":1');
  const conflict = await request(`/api/boards/${board.id}`, 'PATCH', { baseRevision: 0, elements: [], files: {} });
  expect(conflict.status).toBe(409);
  expect((await conflict.json()).scene.revision).toBe(1);
  expect(await (await request('/api/boards')).json()).toHaveLength(1);
  await api.store.close();
  expect((await reader.read()).done).toBe(true);
});

test('artifact writes remain in pagesDir and round-trip through the HTTP authority', async () => {
  const { request } = await apiFixture();
  expect((await request('/api/artifacts', 'PUT', { file: '../escape.tsx', content: 'no' })).status).toBe(400);
  expect((await request('/api/artifacts', 'PUT', { file: 'demo__diagram.tsx', content: 'export default () => null' })).status).toBe(200);
  expect(await (await request('/api/artifacts')).json()).toEqual(['demo__diagram.tsx']);
  expect((await (await request('/api/artifacts?file=demo__diagram.tsx')).json()).content).toBe('export default () => null');
  expect((await request('/api/artifacts', 'DELETE', { file: 'demo__diagram.tsx' })).status).toBe(200);
  expect(await (await request('/api/artifacts')).json()).toEqual([]);
});

test('preview HTTP boundary rejects malformed, oversized and stale PNGs without advancing or publishing scenes', async () => {
  const { request, api } = await apiFixture();
  const board = await api.store.create({ title: 'Preview' });
  const route = `/api/boards/${board.id}/preview`;
  expect((await request(route)).status).toBe(404);
  for (const dataURL of ['data:image/jpeg;base64,AAAA', 'data:image/png;base64,AAAA', 'data:image/png;base64,!!!!']) {
    expect((await request(route, 'PUT', { revision: 0, dataURL })).status).toBe(400);
  }
  expect((await request(route, 'PUT', { revision: 0, dataURL: `data:image/png;base64,${Buffer.alloc(MAX_PREVIEW_BYTES + 1).toString('base64')}` })).status).toBe(413);
  const revisions: number[] = [];
  await api.store.subscribe(board.id, { scene: scene => revisions.push(scene.revision), close() {} });
  const preview = { revision: 0, dataURL: `data:image/png;base64,${imageData}` };
  expect((await request(route, 'PUT', preview)).status).toBe(200);
  expect(await (await request(route)).json()).toEqual(preview);
  expect(await api.store.get(board.id)).toEqual(board);
  expect(revisions).toEqual([0]);
  await api.store.update(board.id, { baseRevision: 0, elements: [], files: {} });
  expect((await request(route, 'PUT', preview)).status).toBe(409);
  const unavailable = await request(route);
  expect(unavailable.status).toBe(404);
  expect((await unavailable.json()).error).toContain('Open this whiteboard');
});

test('MCP subscriptions, binary attachments and bounded pagination round-trip through the HTTP authority', async () => {
  const { request, url } = await apiFixture();
  const client = new Client({ name: 'whiteboard-contract-test', version: '1.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.resolve('scripts/mcp.ts')], env: { AGENT_PAGES_URL: url }, stderr: 'pipe' });
  cleanups.push(() => client.close());
  await client.connect(transport);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const content = z.array(z.object({ type: z.literal('text'), text: z.string() })).parse(result.content);
    return { result, value: JSON.parse(content[0].text) };
  };
  const { value: board } = await call('create_whiteboard', { title: 'From MCP' });
  const boardUri = `agent-pages://whiteboards/${board.id}`;
  const feedbackUri = 'agent-pages://feedback/demo__mcp.tsx';
  const boardEvent = Promise.withResolvers<void>();
  const feedbackEvent = Promise.withResolvers<void>();
  client.setNotificationHandler('notifications/resources/updated', notification => {
    if (notification.params.uri === boardUri) boardEvent.resolve();
    if (notification.params.uri === feedbackUri) feedbackEvent.resolve();
  });
  const subscription = await client.listen({ resourceSubscriptions: [boardUri, feedbackUri] });
  expect(subscription.honoredFilter.resourceSubscriptions).toEqual([boardUri, feedbackUri]);
  cleanups.push(() => subscription.close());
  const files = { screenshot: { id: 'screenshot', mimeType: 'image/png', dataURL: `data:image/png;base64,${imageData}`, created: Date.now(), lastRetrieved: 123 } };
  const { value: committed } = await call('update_whiteboard', { id: board.id, baseRevision: 0, elements: [{ id: 'box', type: 'rectangle', x: 0, y: 0, width: 20, height: 10 }], files });
  expect(committed.revision).toBe(1);
  await Promise.race([boardEvent.promise, new Promise((_, reject) => setTimeout(() => reject(new Error('Missing stdio board notification')), 1500))]);
  const image = await client.callTool({ name: 'read_whiteboard_image', arguments: { id: board.id, fileId: 'screenshot' } });
  expect(image.content).toEqual([{ type: 'image', mimeType: 'image/png', data: imageData }]);
  const { value: metadata } = await call('get_whiteboard', { id: board.id });
  expect(JSON.stringify(metadata)).not.toContain(imageData);
  const wait = call('wait_for_whiteboard_change', { id: board.id, afterRevision: 1, timeoutMs: 1500 });
  await request(`/api/boards/${board.id}`, 'PATCH', { baseRevision: 1, elements: [], files });
  expect((await wait).value.scene.revision).toBe(2);
  const preserved = await call('update_whiteboard', { id: board.id, baseRevision: 2, elements: [] });
  expect(preserved.value.files.screenshot.dataURL).toBeUndefined();
  expect((await (await request(`/api/boards/${board.id}`)).json()).files).toEqual(files);
  const omittedConflict = await client.callTool({ name: 'update_whiteboard', arguments: { id: board.id, baseRevision: 2, elements: [] } });
  expect(omittedConflict.isError).toBe(true);
  expect(JSON.stringify(omittedConflict.content)).not.toContain(imageData);
  const largeElements = ['first', 'second'].map(id => ({ id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, customData: 'x'.repeat(60_000) }));
  const largeCommit = await call('update_whiteboard', { id: board.id, baseRevision: 3, elements: largeElements });
  expect(largeCommit.result.isError).not.toBe(true);
  expect(largeCommit.value.committed).toBe(true);
  const firstPage = await call('get_whiteboard', { id: board.id });
  expect(JSON.stringify(firstPage.value).length).toBeLessThanOrEqual(100_000);
  expect(firstPage.value.elements.map((element: { id: string }) => element.id)).toEqual(['first']);
  expect(firstPage.value.nextOffset).toBe(1);
  const lastPage = await call('get_whiteboard', { id: board.id, checkpointId: firstPage.value.checkpointId, offset: firstPage.value.nextOffset });
  expect(lastPage.value.elements.map((element: { id: string }) => element.id)).toEqual(['second']);
  expect(lastPage.value.nextOffset).toBeNull();
  expect(lastPage.value.revision).toBe(firstPage.value.revision);
  await call('write_artifact', { file: 'demo__mcp.tsx', content: 'export default () => null' });
  expect((await request('/api/artifact-feedback?file=demo__mcp.tsx', 'PATCH', {
    baseRevision: 0, values: { 'option.direction': 'ship', 'comment.direction': 'Keep it simple' },
  })).status).toBe(200);
  const feedback = (await call('get_artifact_feedback', { file: 'demo__mcp.tsx' })).value;
  await Promise.race([feedbackEvent.promise, new Promise((_, reject) => setTimeout(() => reject(new Error('Missing stdio feedback notification')), 1500))]);
  expect(feedback.revision).toBe(1);
  expect(feedback.values).toEqual({ 'option.direction': 'ship', 'comment.direction': 'Keep it simple' });
  const source = '/*' + '\u0000'.repeat(120_000) + '*/export default () => null';
  await call('write_artifact', { file: 'demo__large.tsx', content: source });
  let rebuilt = '';
  let offset: number | null = 0;
  do {
    const page = (await call('read_artifact', { file: 'demo__large.tsx', offset })).value;
    expect(JSON.stringify(page).length).toBeLessThanOrEqual(100_000);
    rebuilt += page.content;
    offset = page.nextOffset;
  } while (offset !== null);
  expect(rebuilt).toBe(source);
});

test('MCP reads checkpoint automatically, deduplicate unchanged state and pin pages despite live edits', async () => {
  const { api, url } = await apiFixture();
  const board = await api.store.create({ title: 'Read references' });
  const client = new Client({ name: 'read-checkpoint-test', version: '1.0.0' });
  cleanups.push(() => client.close());
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('scripts/mcp.ts')], env: { AGENT_PAGES_URL: url }, stderr: 'pipe' }));
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).not.toBe(true);
    const content = z.array(z.object({ type: z.literal('text'), text: z.string() })).parse(result.content);
    return JSON.parse(content[0].text);
  };
  const baseline = await call('get_whiteboard', { id: board.id });
  expect(baseline.checkpointId).toBeString();
  expect((await call('get_whiteboard', { id: board.id })).checkpointId).toBe(baseline.checkpointId);
  expect((await call('wait_for_whiteboard_change', { id: board.id, afterRevision: 0, timeoutMs: 30 })).scene.checkpointId).toBe(baseline.checkpointId);
  const rectangle = { type: 'rectangle', x: 0, y: 0, width: 100, height: 40 };
  await api.store.update(board.id, { baseRevision: 0, elements: [{ ...rectangle, id: 'first' }, { ...rectangle, id: 'second' }], files: {} });
  const first = await call('get_whiteboard', { id: board.id, limit: 1 });
  expect(first.revision).toBe(1);
  expect(first.durableRevision).toBe(1);
  expect(first.nextOffset).toBe(1);
  await api.store.update(board.id, { baseRevision: 1, elements: [{ ...rectangle, id: 'third' }], files: {} });
  const second = await call('get_whiteboard', { id: board.id, checkpointId: first.checkpointId, offset: first.nextOffset });
  expect(second.revision).toBe(1);
  expect(second.elements.map((e: { id: string }) => e.id)).toEqual(['second']);
  const missingPin = await client.callTool({ name: 'get_whiteboard', arguments: { id: board.id, offset: 1 } });
  expect(missingPin.isError).toBe(true);
  const diff = await call('get_whiteboard_changes', { id: board.id, checkpointId: baseline.checkpointId, limit: 1 });
  expect(diff.toRevision).toBe(2);
  expect(diff.nextCheckpointId).not.toBe(first.checkpointId);
  expect(diff.changes[0].element.id).toBe('third');
  const repeated = await call('get_whiteboard_changes', { id: board.id, checkpointId: baseline.checkpointId });
  expect(repeated.nextCheckpointId).toBe(diff.nextCheckpointId);
  await api.store.update(board.id, { baseRevision: 2, elements: [{ ...rectangle, id: 'fourth' }, { ...rectangle, id: 'fifth' }], files: {} });
  const diffFirst = await call('get_whiteboard_changes', { id: board.id, checkpointId: baseline.checkpointId, limit: 1 });
  expect(diffFirst.toRevision).toBe(3);
  await api.store.update(board.id, { baseRevision: 3, elements: [], files: {} });
  const diffLast = await call('get_whiteboard_changes', { id: board.id, checkpointId: baseline.checkpointId, toCheckpointId: diffFirst.nextCheckpointId, offset: diffFirst.nextOffset });
  expect(diffLast.toRevision).toBe(3);
  expect(diffLast.changes[0].element.id).toBe('fifth');
  expect((await api.store.get(board.id)).revision).toBe(4);
});
