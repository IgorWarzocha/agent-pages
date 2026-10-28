import { expect, test } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createApi } from '../server/api.ts';
import { createMcpHttpServer } from '../server/mcp-http.ts';
import { AgentPagesClient } from '../server/http-client.ts';

async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected port');
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
}
test('HTTP MCP creates sessionless pages, receives live batches, pages notes and clears without resurrecting retries', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-pages-annotations-mcp-'));
  await mkdir(path.join(root, 'src/pages'), { recursive: true });
  const api = createApi(root);
  const http = createServer((req, res) => api.handle(req, res, () => res.writeHead(404).end()));
  const url = await listen(http);
  const token = randomBytes(32).toString('hex');
  const bridge = createMcpHttpServer({ token, client: new AgentPagesClient(url) });
  const bridgeUrl = await listen(bridge);
  const client = new Client({ name: 'annotation-integration', version: '1.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
  const file = 'cloud__annotation-review.tsx';
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(bridgeUrl + '/mcp'), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).not.toBe(true);
      const content = result.content as { type: string; text: string }[];
      return JSON.parse(content[0].text);
    };
    await call('write_artifact', { file, content: 'export default () => <main>Review me</main>' });
    const uri = `agent-pages://annotations/${file}`;
    const updates: string[] = [];
    const delivered = Promise.withResolvers<void>();
    client.setNotificationHandler('notifications/resources/updated', notification => {
      updates.push(notification.params.uri);
      delivered.resolve();
    });
    const subscription = await client.listen({ resourceSubscriptions: [uri] });
    expect(subscription.honoredFilter.resourceSubscriptions).toEqual([uri]);
    expect((await call('get_page_annotations', { file })).totalAnnotations).toBe(0);
    const pending = call('wait_for_page_annotations', { file, afterRevision: 0, timeoutMs: 1000 });
    const note = (comment: string) => ({ id: randomUUID(), kind: 'rectangle', points: [{ x: 10, y: 10 }, { x: 80, y: 40 }], bounds: { x: 10, y: 10, width: 70, height: 30 }, comment, viewport: { width: 1000, height: 800 }, pageSize: { width: 700, height: 900 } });
    const notes = [note('Reduce the gap'), { ...note('Keep this title'), kind: 'text', points: [{ x: 10, y: 10 }], bounds: { x: 10, y: 10, width: 0, height: 0 } }];
    const batch = { batchId: randomUUID(), annotations: notes };
    const request = (method: string, body: unknown) => fetch(`${url}/api/annotations?file=${file}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await request('POST', batch)).status).toBe(200);
    await Promise.race([delivered.promise, new Promise((_, reject) => setTimeout(() => reject(new Error('Subscription did not deliver annotation change')), 1500))]);
    expect(updates).toContain(uri);
    expect((await client.readResource({ uri })).contents[0]).toMatchObject({ uri, mimeType: 'application/json' });
    await subscription.close();
    expect(await subscription.closed).toBe('local');
    const listeners = await Promise.all(Array.from({ length: 16 }, () => client.listen({ resourceSubscriptions: [uri] })));
    expect((await client.callTool({ name: 'get_skill', arguments: {} })).isError).not.toBe(true);
    expect((await client.readResource({ uri })).contents).toHaveLength(1);
    await Promise.all(listeners.map(listener => listener.close()));
    expect(await pending).toMatchObject({ changed: true, revision: 1, totalAnnotations: 2 });
    const first = await call('get_page_annotations', { file, limit: 1 });
    expect(first.annotations[0].comment).toBe('Reduce the gap');
    const second = await call('get_page_annotations', { file, revision: first.revision, offset: first.nextOffset });
    expect(second.annotations[0].comment).toBe('Keep this title');
    expect(second.annotations[0].kind).toBe('text');
    expect((await request('POST', { batchId: randomUUID(), annotations: [note('A newer note')] })).status).toBe(200);
    const stalePage = await client.callTool({ name: 'get_page_annotations', arguments: { file, revision: first.revision, offset: first.nextOffset } });
    expect(stalePage.isError).toBe(true);
    const staleClear = await client.callTool({ name: 'clear_page_annotations', arguments: { file, baseRevision: 1 } });
    expect(staleClear.isError).toBe(true);
    expect((await call('get_page_annotations', { file })).totalAnnotations).toBe(3);
    expect(await call('clear_page_annotations', { file, baseRevision: 2, ids: notes.map(note => note.id) })).toMatchObject({ revision: 3, remainingAnnotations: 1 });
    expect(await call('clear_page_annotations', { file, baseRevision: 3 })).toMatchObject({ revision: 4, remainingAnnotations: 0 });
    expect((await request('POST', batch)).status).toBe(200);
    expect((await call('get_page_annotations', { file })).totalAnnotations).toBe(0);
    expect(await call('wait_for_page_annotations', { file, afterRevision: 4, timeoutMs: 10 })).toMatchObject({ changed: false, revision: 4 });
    const interrupted = await client.listen({ resourceSubscriptions: [uri] });
    await api.close();
    expect(await Promise.race([interrupted.closed, new Promise((_, reject) => setTimeout(() => reject(new Error('Broken authority feed left subscription open')), 1500))])).toBe('remote');
  } finally {
    await client.close(); await close(bridge); await api.close(); await close(http); await rm(root, { recursive: true, force: true });
  }
});
