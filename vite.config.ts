import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { unlink } from 'node:fs/promises';
import path from 'node:path';

const AGENT_PAGES_PORT = 47983;

function agentPagesPlugin(): Plugin {
  const rootDir = process.cwd();
  const pagesDir = path.resolve(rootDir, 'src/pages');
  async function deleteArtifact(file: string) {
    const resolved = path.resolve(pagesDir, file);
    if (!resolved.startsWith(pagesDir + path.sep) || !file.endsWith('.tsx')) throw new Error('Invalid artifact file');
    await unlink(resolved);
  }
  return {
    name: 'agent-pages-api',
    configureServer(server) {
      server.middlewares.use('/api/agent-pages', (req, res) => {
        if (req.method !== 'GET') return res.writeHead(405).end('Method not allowed');
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ name: 'agent-pages', rootDir, pagesDir, port: AGENT_PAGES_PORT, url: `http://127.0.0.1:${AGENT_PAGES_PORT}` }));
      });
      server.middlewares.use('/api/artifacts', (req, res) => {
        if (req.method !== 'DELETE') return res.writeHead(405).end('Method not allowed');
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
          try {
            const payload = JSON.parse(body || '{}') as { file?: string; files?: string[] };
            const files = payload.files ?? (payload.file ? [payload.file] : []);
            if (!files.length) throw new Error('No files provided');
            await Promise.all(files.map(deleteArtifact));
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, deleted: files }));
          } catch (error) {
            res.statusCode = 400;
            res.end(error instanceof Error ? error.message : 'Delete failed');
          }
        });
      });
    },
  };
}

export default defineConfig({ plugins: [react(), agentPagesPlugin()], server: { host: '127.0.0.1', port: AGENT_PAGES_PORT, strictPort: true } });
