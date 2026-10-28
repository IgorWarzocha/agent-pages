import { expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { AgentPagesClient } from '../server/http-client.ts';
import { createMcpHttpServer, readMcpToken } from '../server/mcp-http.ts';

async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
  return `http://127.0.0.1:${address.port}`;
}
async function stop(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}

test('HTTP MCP gates every route and method before SDK dispatch, and bounds JSON bodies', async () => {
  const token = randomBytes(32).toString('hex');
  const server = createMcpHttpServer({ token, client: new AgentPagesClient(), origins: ['https://trusted.example'], maxBodyBytes: 128 });
  const url = await listen(server);
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  try {
    for (const route of ['/mcp', '/missing']) {
      expect((await fetch(url + route, { method: 'POST' })).status).toBe(401);
    }
    expect((await fetch(url + '/mcp', { headers: { ...headers, authorization: 'Bearer wrong' } })).status).toBe(401);
    expect((await fetch(url + '/mcp', { headers: { ...headers, origin: 'https://hostile.example' } })).status).toBe(403);
    expect((await fetch(url + '/missing', { headers })).status).toBe(404);
    expect((await fetch(url + '/mcp', { headers })).status).toBe(405);
    expect((await fetch(url + '/mcp', { method: 'POST', headers: { authorization: headers.authorization }, body: '{}' })).status).toBe(415);
    expect((await fetch(url + '/mcp', { method: 'POST', headers: { ...headers, origin: 'https://trusted.example' }, body: '{' })).status).toBe(400);
    expect((await fetch(url + '/mcp', { method: 'POST', headers, body: JSON.stringify('x'.repeat(129)) })).status).toBe(413);
  } finally { await stop(server); }
});

test('MCP token rejects malformed contents and non-private POSIX permissions', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'agent-pages-token-'));
  const file = path.join(dir, 'token');
  try {
    const token = randomBytes(32).toString('hex');
    await writeFile(file, token + '\n', { mode: 0o600 });
    expect(await readMcpToken(file)).toBe(token);
    await writeFile(file, 'not-a-token');
    await expect(readMcpToken(file)).rejects.toThrow('64 lowercase hexadecimal');
    if (process.platform !== 'win32') {
      await writeFile(file, token);
      await chmod(file, 0o644);
      await expect(readMcpToken(file)).rejects.toThrow('mode 0600');
    }
    await expect(readMcpToken(dir)).rejects.toThrow('regular file');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
