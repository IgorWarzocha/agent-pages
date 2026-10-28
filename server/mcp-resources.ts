import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { artifactFileSchema } from './artifacts-api.ts';
import { boardIdSchema } from '../src/features/whiteboard/contract.ts';
import { AgentPagesClient, sceneMetadata } from './http-client.ts';

export function registerMcpResources(server: McpServer, client: AgentPagesClient) {
  for (const kind of ['annotations', 'feedback'] as const) {
    server.registerResource(kind, new ResourceTemplate(`agent-pages://${kind}/{file}`, {
      list: async () => ({ resources: z.array(artifactFileSchema).parse(await client.request('/api/artifacts')).map(file => ({ uri: `agent-pages://${kind}/${encodeURIComponent(file)}`, name: `${kind}: ${file}`, mimeType: 'application/json' })) }),
    }), { mimeType: 'application/json' }, async (uri, variables, ctx) => {
      const file = artifactFileSchema.parse(variables.file);
      const route = kind === 'annotations' ? '/api/annotations' : '/api/artifact-feedback';
      const data = await client.request(`${route}?file=${encodeURIComponent(file)}`, 'GET', undefined, ctx.mcpReq.signal);
      const text = JSON.stringify(data);
      if (text.length > 100_000) throw new Error('Resource exceeds 100,000 characters; use paginated MCP tools');
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text }] };
    });
  }
  server.registerResource('whiteboards', new ResourceTemplate('agent-pages://whiteboards/{id}', {
    list: async () => ({ resources: (await client.list()).map(board => ({ uri: `agent-pages://whiteboards/${board.id}`, name: board.title, mimeType: 'application/json' })) }),
  }), { mimeType: 'application/json' }, async (uri, variables, ctx) => {
    const text = JSON.stringify(sceneMetadata(await client.get(boardIdSchema.parse(variables.id), ctx.mcpReq.signal)));
    if (text.length > 100_000) throw new Error('Resource exceeds 100,000 characters; use get_whiteboard pagination');
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text }] };
  });
}
