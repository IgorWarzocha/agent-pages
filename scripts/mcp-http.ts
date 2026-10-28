import os from 'node:os';
import path from 'node:path';
import { AgentPagesClient } from '../server/http-client.ts';
import { createMcpHttpServer, readMcpToken } from '../server/mcp-http.ts';

const tokenFile = process.env.AGENT_PAGES_MCP_TOKEN_FILE ?? path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'agent-pages-mcp', 'token');
const port = Number(process.env.AGENT_PAGES_MCP_PORT ?? 8794);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('AGENT_PAGES_MCP_PORT must be an integer from 1 to 65535');
const server = createMcpHttpServer({
  token: await readMcpToken(tokenFile),
  client: new AgentPagesClient(process.env.AGENT_PAGES_URL),
  origins: (process.env.AGENT_PAGES_MCP_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean),
});
server.listen(port, '127.0.0.1', () => console.error(`Agent Pages MCP listening on http://127.0.0.1:${port}/mcp (Bearer token required)`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
  server.close();
  server.closeAllConnections();
});
