import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Plugin } from 'vite';
import { annotationsApi } from './annotations-api.ts';
import { AnnotationStore } from './annotations.ts';
import { artifactsApi } from './artifacts-api.ts';
import { boardsApi } from './boards-api.ts';
import { feedbackApi } from './feedback-api.ts';
import { FeedbackStore } from './feedback.ts';
import { checkRequest, failure, json } from './http.ts';
import { WhiteboardStore } from './whiteboards.ts';
import { createChangeFeed } from './change-feed.ts';

export const AGENT_PAGES_PORT = 47983;

export function createApi(rootDir: string, store = new WhiteboardStore(path.join(rootDir, '.agent-pages/boards'))) {
  const pagesDir = path.join(rootDir, 'src/pages');
  const feedbackStore = new FeedbackStore(path.join(rootDir, '.agent-pages'));
  const annotationStore = new AnnotationStore(path.join(rootDir, '.agent-pages'));
  const changes = createChangeFeed();
  return {
    store,
    feedbackStore,
    annotationStore,
    async close() { changes.close(); await Promise.all([store.close(), feedbackStore.close(), annotationStore.close()]); },
    handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (!['/api/changes', '/api/boards', '/api/artifacts', '/api/artifact-feedback', '/api/annotations', '/api/agent-pages'].some(prefix => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))) return next();
      void (async () => {
        checkRequest(req);
        if (url.pathname === '/api/changes') return changes.stream(req, res);
        changes.observe(req, res, url);
        if (url.pathname === '/api/agent-pages') {
          if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
          return json(res, 200, { name: 'agent-pages', rootDir, pagesDir, port: AGENT_PAGES_PORT, url: `http://127.0.0.1:${AGENT_PAGES_PORT}`, boardsUrl: '/api/boards' });
        }
        if (url.pathname === '/api/artifacts') return artifactsApi(req, res, url, pagesDir);
        if (url.pathname === '/api/annotations' || url.pathname.startsWith('/api/annotations/')) return annotationsApi(req, res, url, pagesDir, annotationStore);
        if (url.pathname === '/api/artifact-feedback') return feedbackApi(req, res, url, pagesDir, feedbackStore);
        if (url.pathname.startsWith('/api/artifact-feedback/')) return json(res, 404, { error: 'Not found' });
        return boardsApi(req, res, url.pathname, store);
      })().catch(error => failure(res, error));
    },
  };
}

export function agentPagesPlugin(): Plugin {
  let api: ReturnType<typeof createApi>;
  return {
    name: 'agent-pages-api',
    configureServer(server) {
      api = createApi(server.config.root);
      server.middlewares.use(api.handle);
      server.httpServer?.once('close', () => { void api.close().catch(error => console.error('[agent-pages shutdown]', error)); });
    },
    async closeBundle() { await api?.close(); },
  };
}
