import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Plugin } from 'vite';

export function excalidrawAssetsPlugin(): Plugin {
  const fonts = path.join(path.dirname(createRequire(import.meta.url).resolve('@excalidraw/excalidraw')), 'fonts');
  return {
    name: 'excalidraw-local-fonts',
    configureServer(server) {
      server.middlewares.use('/excalidraw-assets/fonts', (req, res) => {
        void (async () => {
          if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
          const relative = decodeURIComponent((req.url ?? '').split('?')[0]);
          const file = path.resolve(fonts, `.${relative}`);
          if (!file.startsWith(fonts + path.sep) || !file.endsWith('.woff2')) { res.writeHead(404).end(); return; }
          const source = await readFile(file);
          res.writeHead(200, { 'content-type': 'font/woff2', 'cache-control': 'public, max-age=86400' });
          res.end(req.method === 'HEAD' ? undefined : source);
        })().catch(() => { if (!res.headersSent) res.writeHead(404); res.end(); });
      });
    },
    async generateBundle() {
      const files = await readdir(fonts, { recursive: true, withFileTypes: true });
      for (const entry of files) {
        if (!entry.isFile() || !entry.name.endsWith('.woff2')) continue;
        const file = path.join(entry.parentPath, entry.name);
        this.emitFile({ type: 'asset', fileName: `excalidraw-assets/fonts/${path.relative(fonts, file).split(path.sep).join('/')}`, source: await readFile(file) });
      }
    },
  };
}
