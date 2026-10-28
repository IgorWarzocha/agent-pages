import { z } from 'zod';
import { boardMetadataSchema, boardPreviewSchema, boardSceneSchema, boardCheckpointSchema, boardChangesSchema, type BoardUpdate } from '../src/features/whiteboard/contract.ts';

export class AgentPagesClient {
  readonly url: string;

  constructor(url = 'http://127.0.0.1:47983') {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error('AGENT_PAGES_URL must be a local HTTP origin');
    }
    this.url = parsed.origin;
  }

  async request(route: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<unknown> {
    const response = await fetch(`${this.url}${route}`, {
      method, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    const value: unknown = await response.json();
    if (!response.ok) {
      const failure = z.object({ error: z.string(), scene: boardSceneSchema.optional() }).parse(value);
      const message = JSON.stringify({ status: response.status, ...failure, ...(failure.scene ? { scene: sceneMetadata(failure.scene) } : {}) });
      throw new Error(message.length <= 100_000 ? message : JSON.stringify({ status: response.status, error: failure.error, revision: failure.scene?.revision, detail: 'Scene omitted due to size. Read get_whiteboard pages before reconciling.' }));
    }
    return value;
  }

  async list(signal?: AbortSignal) { return z.array(boardMetadataSchema).parse(await this.request('/api/boards', 'GET', undefined, signal)); }
  async create(title: string, signal?: AbortSignal) { return boardSceneSchema.parse(await this.request('/api/boards', 'POST', { title }, signal)); }
  async get(id: string, signal?: AbortSignal, checkpointId?: string) {
    const query = checkpointId ? `?checkpoint=${encodeURIComponent(checkpointId)}` : '';
    return boardSceneSchema.parse(await this.request(`/api/boards/${encodeURIComponent(id)}${query}`, 'GET', undefined, signal));
  }
  async read(id: string, checkpointId?: string, signal?: AbortSignal) {
    // Capture first, then read that immutable snapshot. A concurrent browser edit
    // cannot make the returned scene differ from the bot's saved reference.
    const pinned = checkpointId ?? (await this.checkpoint(id, undefined, signal)).id;
    return this.get(id, signal, pinned);
  }
  async getPreview(id: string, signal?: AbortSignal) { return boardPreviewSchema.parse(await this.request(`/api/boards/${encodeURIComponent(id)}/preview`, 'GET', undefined, signal)); }
  async update(id: string, update: BoardUpdate, signal?: AbortSignal) { return boardSceneSchema.parse(await this.request(`/api/boards/${encodeURIComponent(id)}`, 'PATCH', update, signal)); }
  async checkpoint(id: string, baseRevision?: number, signal?: AbortSignal) { return boardCheckpointSchema.parse(await this.request(`/api/boards/${encodeURIComponent(id)}/checkpoints`, 'POST', { baseRevision }, signal)); }
  async changes(id: string, checkpointId: string, signal?: AbortSignal, toCheckpointId?: string) {
    const query = `checkpoint=${encodeURIComponent(checkpointId)}` + (toCheckpointId ? `&toCheckpoint=${encodeURIComponent(toCheckpointId)}` : '');
    return boardChangesSchema.parse(await this.request(`/api/boards/${encodeURIComponent(id)}/changes?${query}`, 'GET', undefined, signal));
  }
  async readChanges(id: string, checkpointId: string, toCheckpointId?: string, signal?: AbortSignal) {
    const pinned = toCheckpointId ?? (await this.checkpoint(id, undefined, signal)).id;
    return this.changes(id, checkpointId, signal, pinned);
  }

  async wait(id: string, afterRevision: number, timeoutMs: number, signal?: AbortSignal) {
    const deadline = Date.now() + timeoutMs;
    let scene = await this.get(id, signal);
    while (scene.revision === afterRevision && Date.now() < deadline) {
      const remaining = deadline - Date.now();
      await new Promise<void>((resolve, reject) => {
        const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
        const timer = setTimeout(done, Math.min(500, remaining));
        const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal?.reason ?? new Error('Cancelled')); };
        if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
      });
      if (Date.now() >= deadline) break;
      scene = await this.get(id, signal ? AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, deadline - Date.now()))]) : AbortSignal.timeout(Math.max(1, deadline - Date.now())));
    }
    return { changed: scene.revision !== afterRevision, scene };
  }
}

// MCP text must never contain binary attachment payloads, including conflict scenes.
export function sceneMetadata(scene: z.infer<typeof boardSceneSchema>) {
  return { ...scene, files: Object.fromEntries(Object.entries(scene.files).map(([id, file]) => {
    const { dataURL: _dataURL, ...metadata } = file;
    return [id, metadata];
  })) };
}
