import { boardSceneSchema as BoardSchema, type BoardScene as Board } from './contract';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { BinaryFiles } from '@excalidraw/excalidraw/types';

export type Scene = { elements: readonly ExcalidrawElement[]; files: BinaryFiles };
export type SyncStatus = 'connecting' | 'saved' | 'synced' | 'saving' | 'offline';

// Files are immutable by ID. Element versions change for every drawing edit,
// including deletion; viewport and selection changes must not trigger writes.
export function sceneKey(scene: {
  elements: readonly { id: string; version: number; versionNonce?: unknown; isDeleted: boolean; index?: unknown }[];
  files: Record<string, { version?: unknown }>;
}) {
  return JSON.stringify([
    scene.elements.map(e => [e.id, e.version, e.versionNonce, e.isDeleted, e.index]),
    Object.entries(scene.files).map(([id, file]) => [id, file.version]),
  ]);
}

export async function boardRequest(path: string, init?: RequestInit) {
  const response = await fetch('/api/boards' + path, init);
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Whiteboards need the running Agent Pages server. Start it with bun run dev.');
  if (!response.ok) {
    const body = await response.json();
    throw new Error(typeof body.error === 'string' ? body.error : 'Whiteboard request failed');
  }
  return response.json();
}

type Adapter = {
  read: () => Scene;
  merge: (board: Board) => void;
  ready: () => boolean;
  status: (status: SyncStatus, error?: string, revision?: number, scene?: Scene) => void;
};

/** One browser editor's network lifetime; the HTTP service owns revisions. */
export function connectBoard(id: string, adapter: Adapter) {
  const abort = new AbortController();
  let revision = -1;
  let durableRevision = -1;
  let persistenceError: string | undefined;
  let acknowledged = '';
  let observed = sceneKey(adapter.read());
  let pending = false;
  let flight: Promise<void> | undefined;
  let submitted: { key: string; revision: number } | undefined;
  let deferred: Board | undefined;
  let serverFileIds = new Set<string>();
  const removedFiles = new Map<string, Set<string>>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const events = new EventSource('/api/boards/' + id + '/events');

  function read(): Scene {
    const scene = adapter.read();
    // Excalidraw keeps an additive file cache. A remote removal must stay
    // removed until a new local image element deliberately reattaches it.
    for (const [id, oldReferences] of removedFiles) {
      if (scene.elements.some(e => e.type === 'image' && !e.isDeleted && e.fileId === id && !oldReferences.has(e.id))) removedFiles.delete(id);
    }
    return { elements: scene.elements, files: Object.fromEntries(Object.entries(scene.files).filter(([id]) => !removedFiles.has(id))) };
  }
  function dirty() { return sceneKey(read()) !== acknowledged; }
  function status() {
    adapter.status(dirty() ? 'saving' : durableRevision >= revision ? 'saved' : 'synced', persistenceError, revision, read());
  }
  function schedule() {
    clearTimeout(timer);
    if (revision >= 0 && dirty()) timer = setTimeout(() => void save(), 180);
    else if (revision >= 0) status();
  }
  function accept(board: Board) {
    if (abort.signal.aborted || board.revision < revision) return;
    if (!adapter.ready()) {
      if (!deferred || board.revision >= deferred.revision) deferred = board;
      return;
    }
    const sameScene = revision === board.revision && acknowledged === sceneKey(board);
    revision = board.revision;
    durableRevision = board.durableRevision ?? board.revision;
    persistenceError = board.persistenceError;
    acknowledged = sceneKey(board);
    const local = adapter.read();
    for (const id of serverFileIds) {
      if (!Object.hasOwn(board.files, id)) removedFiles.set(id, new Set(local.elements.filter(e => e.type === 'image' && e.fileId === id).map(e => e.id)));
    }
    for (const id of Object.keys(board.files)) removedFiles.delete(id);
    serverFileIds = new Set(Object.keys(board.files));
    // Our own SSE echo is an acknowledgement, not an external edit. Replacing
    // editor objects here can detach an image still being initialised by the SDK.
    const ownCommit = submitted?.revision === revision && submitted.key === acknowledged;
    if (!sameScene && !ownCommit && sceneKey(read()) !== acknowledged) adapter.merge(board);
    observed = sceneKey(read());
    status();
    schedule();
  }
  function fail(error: unknown) {
    if (!abort.signal.aborted) adapter.status('offline', error instanceof Error ? error.message : 'Connection lost');
  }
  async function refresh() {
    try {
      accept(BoardSchema.parse(await boardRequest('/' + id, { signal: abort.signal })));
      return true;
    } catch (error) { fail(error); return false; }
  }
  function save(): Promise<void> {
    if (pending) return flight ?? Promise.resolve();
    flight = submit();
    return flight;
  }
  async function submit() {
    if (pending || abort.signal.aborted || revision < 0 || !dirty()) return;
    if (!adapter.ready()) { schedule(); return; }
    pending = true;
    adapter.status('saving');
    let succeeded = false;
    try {
      const scene = read();
      submitted = { key: sceneKey(scene), revision: revision + 1 };
      const response = await fetch('/api/boards/' + id, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseRevision: revision, ...scene }),
        signal: abort.signal,
      });
      if (response.status === 409) {
        succeeded = await refresh();
      } else {
        if (!response.ok) throw new Error((await response.json()).error || 'Save failed');
        accept(BoardSchema.parse(await response.json()));
        succeeded = true;
      }
    } catch (error) { fail(error); }
    finally {
      pending = false;
      if (succeeded && !abort.signal.aborted) schedule();
    }
  }
  events.addEventListener('scene', event => {
    try { accept(BoardSchema.parse(JSON.parse(event.data))); }
    catch (error) { fail(error); }
  });
  events.onerror = () => fail(new Error('Live connection lost. Reconnecting…'));
  function beforeUnload(event: BeforeUnloadEvent) {
    if (dirty()) event.preventDefault();
  }
  window.addEventListener('beforeunload', beforeUnload);
  adapter.status('connecting');
  void refresh();
  return {
    changed() {
      if (deferred && adapter.ready()) {
        const board = deferred;
        deferred = undefined;
        accept(board);
      }
      const next = sceneKey(read());
      if (next === observed) return;
      observed = next;
      if (revision >= 0) status();
      schedule();
    },
    retry: refresh,
    async flush() {
      try {
        await save();
        if (dirty()) throw new Error('Edits are still syncing. Try Save again.');
        accept(BoardSchema.parse(await boardRequest('/' + id + '/save', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: abort.signal,
        })));
      } catch (error) { fail(error); }
    },
    dirty,
    close() {
      abort.abort();
      events.close();
      clearTimeout(timer);
      window.removeEventListener('beforeunload', beforeUnload);
    },
  };
}
