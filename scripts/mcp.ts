import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { AgentPagesClient } from '../server/http-client.ts';
import { createMcpServer } from '../server/mcp.ts';
import { watchMcpChanges } from '../server/mcp-events.ts';

const client = new AgentPagesClient(process.env.AGENT_PAGES_URL);
const transport = new StdioServerTransport();
const watchers = new Set<() => Promise<void>>();
const handle = serveStdio(ctx => {
  const server = createMcpServer(client, ctx.era);
  if (ctx.era === 'modern') {
    const stop = watchMcpChanges(client, uri => {
      if (server.isConnected()) return uri ? server.server.sendResourceUpdated({ uri }) : server.server.sendResourceListChanged();
    }, previouslyConnected => { if (previouslyConnected) void server.close().catch(error => console.error('MCP feed disconnect:', error)); });
    watchers.add(stop);
    server.server.onclose = () => { watchers.delete(stop); void stop().catch(error => console.error('MCP feed shutdown:', error)); };
  }
  return server;
}, { transport, onerror: error => console.error('MCP stdio:', error) });
const close = () => { void (async () => { await Promise.all([...watchers].map(stop => stop())); await handle.close(); })().then(() => process.exit(0)); };
process.stdin.once('end', close);
process.once('SIGINT', close);
process.once('SIGTERM', close);
