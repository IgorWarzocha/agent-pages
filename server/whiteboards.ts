import { randomUUID } from 'node:crypto';
import {
  boardIdSchema, boardMetadataSchema, boardPreviewSchema, createBoardSchema, checkpointRequestSchema,
  MAX_PREVIEW_BYTES, MAX_PREVIEW_REQUEST_BYTES, MAX_SCENE_BYTES, updateBoardSchema,
  type BoardScene, type BoardPreview,
} from '../src/features/whiteboard/contract.ts';
import { WhiteboardDatabase } from './whiteboard-database.ts';
import { sceneChanges } from './whiteboard-changes.ts';

export class BoardError extends Error {
  constructor(public status: number, message: string, public scene?: BoardScene) { super(message); }
}

function checkSize(value: unknown) {
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_SCENE_BYTES) throw new BoardError(413, 'Scene exceeds 20 MiB');
}

type Listener = { scene: (scene: BoardScene) => void; close: () => void };
type Pending = { first: number; edited: number; preview?: BoardPreview };
export const SAVE_POLICY = { idleMs: 2_000, minIntervalMs: 5_000, maxWaitMs: 10_000 };
export function persistenceDeadline(first: number, edited: number, persisted: number, policy = SAVE_POLICY) {
  return Math.max(persisted + policy.minIntervalMs, Math.min(edited + policy.idleMs, first + policy.maxWaitMs));
}

/** One HTTP authority owns live scenes. SQLite owns recovery and explicit checkpoints. */
export class WhiteboardStore {
  private tail: Promise<unknown> = Promise.resolve();
  private listeners = new Map<string, Set<Listener>>();
  private scenes = new Map<string, BoardScene>();
  private durable = new Map<string, number>();
  private persistedAt = new Map<string, number>();
  private pending = new Map<string, Pending>();
  private previews = new Map<string, BoardPreview>();
  private errors = new Map<string, string>();
  private timer?: ReturnType<typeof setTimeout>;
  private ready?: Promise<void>;
  private closing?: Promise<void>;
  private database: WhiteboardDatabase;

  constructor(readonly directory: string, private policy = SAVE_POLICY) {
    if (policy.idleMs < 0 || policy.minIntervalMs <= 0 || policy.maxWaitMs < policy.minIntervalMs || policy.maxWaitMs < policy.idleMs) throw new Error('Invalid whiteboard save policy');
    this.database = new WhiteboardDatabase(directory);
  }

  private initialise() {
    return this.ready ??= this.database.initialise().then(() => {
      for (const scene of this.database.list()) {
        this.scenes.set(scene.id, scene);
        this.durable.set(scene.id, scene.revision);
      }
    });
  }

  private serial<T>(operation: () => T | Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new BoardError(503, 'Whiteboard store is closed'));
    const result = this.tail.then(() => this.initialise()).then(operation);
    this.tail = result.catch(() => undefined);
    return result;
  }

  private read(id: string) {
    boardIdSchema.parse(id);
    const scene = this.scenes.get(id);
    if (!scene) throw new BoardError(404, 'Whiteboard not found');
    return scene;
  }

  private snapshot(scene: BoardScene): BoardScene {
    return structuredClone({ ...scene, durableRevision: this.durable.get(scene.id) ?? scene.revision,
      ...(this.errors.has(scene.id) ? { persistenceError: this.errors.get(scene.id) } : {}) });
  }

  private publish(scene: BoardScene) {
    for (const listener of this.listeners.get(scene.id) ?? []) {
      try { listener.scene(this.snapshot(scene)); }
      catch { this.listeners.get(scene.id)?.delete(listener); listener.close(); }
    }
  }

  private changed(id: string, preview?: BoardPreview) {
    const now = Date.now();
    const pending = this.pending.get(id) ?? { first: now, edited: now };
    if (preview) pending.preview = preview;
    else pending.edited = now;
    this.pending.set(id, pending);
    this.schedule();
  }

  private deadline(id: string, pending: Pending) {
    return persistenceDeadline(pending.first, pending.edited, this.persistedAt.get(id) ?? 0, this.policy);
  }

  private schedule() {
    clearTimeout(this.timer);
    if (this.closing || !this.pending.size) return;
    const next = Math.min(...Array.from(this.pending, ([id, pending]) => this.deadline(id, pending)));
    this.timer = setTimeout(() => {
      void this.serial(() => {
        for (const [id, pending] of this.pending) {
          if (this.deadline(id, pending) > Date.now()) continue;
          try {
            const scene = this.read(id);
            this.persist(scene);
            this.publish(scene);
          }
          catch (error) {
            const message = error instanceof Error ? error.message : 'SQLite save failed';
            console.error('[whiteboard persistence]', error);
            this.errors.set(id, message);
            // Keep live edits, report the failure and retry at the bounded cadence.
            this.persistedAt.set(id, Date.now());
            this.publish(this.read(id));
          }
        }
        this.schedule();
      }).catch(error => console.error('[whiteboard persistence]', error));
    }, Math.max(0, next - Date.now()));
    this.timer.unref();
  }

  private persist(scene: BoardScene, checkpoint?: { id: string; createdAt: string }) {
    this.database.save(scene, checkpoint, this.pending.get(scene.id)?.preview);
    this.durable.set(scene.id, scene.revision);
    this.persistedAt.set(scene.id, Date.now());
    this.pending.delete(scene.id);
    this.errors.delete(scene.id);
  }

  list() {
    return this.serial(() => Array.from(this.scenes.values(), scene => boardMetadataSchema.parse(scene))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)));
  }
  get(id: string, checkpointId?: string) {
    return this.serial(() => {
      const current = this.read(id);
      return checkpointId ? this.readCheckpoint(id, checkpointId) : this.snapshot(current);
    });
  }

  private readCheckpoint(id: string, checkpointId: string): BoardScene {
    boardIdSchema.parse(checkpointId);
    const scene = this.database.checkpoint(id, checkpointId);
    if (!scene) throw new BoardError(404, 'Checkpoint not found for this whiteboard');
    return { ...scene, durableRevision: scene.revision, checkpointId };
  }

  getPreview(id: string) {
    return this.serial(() => {
      const scene = this.read(id);
      const preview = this.previews.get(id) ?? this.database.getPreview(id);
      if (!preview || preview.revision !== scene.revision) throw new BoardError(404, 'Current canvas preview unavailable. Open this whiteboard in the browser to generate it.');
      return structuredClone(preview);
    });
  }

  putPreview(id: string, input: unknown) {
    if (Buffer.byteLength(JSON.stringify(input)) > MAX_PREVIEW_REQUEST_BYTES) throw new BoardError(413, 'Preview exceeds 4 MiB PNG limit');
    const preview = boardPreviewSchema.parse(input);
    const encoded = preview.dataURL.slice('data:image/png;base64,'.length);
    const png = Buffer.from(encoded, 'base64');
    if (png.length > MAX_PREVIEW_BYTES) throw new BoardError(413, 'Preview exceeds 4 MiB PNG limit');
    if (png.toString('base64') !== encoded || png.length < 45 ||
      !png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ||
      png.readUInt32BE(8) !== 13 || png.toString('ascii', 12, 16) !== 'IHDR' ||
      !png.readUInt32BE(16) || !png.readUInt32BE(20) ||
      !png.subarray(-12).equals(Buffer.from('0000000049454e44ae426082', 'hex'))) throw new BoardError(400, 'Preview must be a PNG base64 data URL');
    return this.serial(() => {
      const scene = this.read(id);
      if (scene.revision !== preview.revision) throw new BoardError(409, 'Preview revision is stale. Sync the current scene before exporting again.');
      const existing = this.previews.get(id) ?? this.database.getPreview(id);
      if (existing?.dataURL !== preview.dataURL || existing?.revision !== preview.revision) {
        this.previews.set(id, preview);
        this.changed(id, preview);
      }
      return structuredClone(preview);
    });
  }

  create(input: unknown) {
    const { title } = createBoardSchema.parse(input);
    return this.serial(() => {
      const scene: BoardScene = { id: randomUUID(), title, revision: 0, updatedAt: new Date().toISOString(), elements: [], files: {} };
      this.persist(scene);
      this.scenes.set(scene.id, scene);
      return this.snapshot(scene);
    });
  }

  update(id: string, input: unknown) {
    checkSize(input);
    const update = updateBoardSchema.parse(input);
    return this.serial(() => {
      const current = this.read(id);
      this.checkRevision(current, update.baseRevision);
      const scene: BoardScene = { ...current, elements: update.elements, files: update.files,
        revision: current.revision + 1, updatedAt: new Date().toISOString() };
      checkSize(scene);
      const checkpoint = update.checkpoint ? { id: randomUUID(), createdAt: new Date().toISOString() } : undefined;
      if (checkpoint) this.persist(scene, checkpoint);
      this.scenes.set(id, scene);
      if (!checkpoint) this.changed(id);
      this.publish(scene);
      this.schedule();
      return { ...this.snapshot(scene), ...(checkpoint ? { checkpointId: checkpoint.id } : {}) };
    });
  }

  private checkRevision(scene: BoardScene, revision: number) {
    if (scene.revision !== revision) throw new BoardError(409, 'Revision conflict. Read the current scene and reconcile before retrying.', this.snapshot(scene));
  }

  save(id: string) {
    return this.serial(() => {
      const scene = this.read(id);
      if (this.pending.has(id) || this.errors.has(id)) this.persist(scene);
      this.publish(scene);
      this.schedule();
      return this.snapshot(scene);
    });
  }

  checkpoint(id: string, input: unknown) {
    const { baseRevision } = checkpointRequestSchema.parse(input);
    return this.serial(() => {
      const scene = this.read(id);
      if (baseRevision !== undefined) this.checkRevision(scene, baseRevision);
      const existing = this.database.checkpointAtRevision(id, scene.revision);
      if (existing) return { ...existing, boardId: id, revision: scene.revision };
      const checkpoint = { id: randomUUID(), createdAt: new Date().toISOString() };
      this.persist(scene, checkpoint);
      this.publish(scene);
      this.schedule();
      return { ...checkpoint, boardId: id, revision: scene.revision };
    });
  }

  changes(id: string, checkpointId: string, toCheckpointId?: string) {
    boardIdSchema.parse(checkpointId);
    return this.serial(() => {
      const current = this.read(id);
      const baseline = this.readCheckpoint(id, checkpointId);
      const target = toCheckpointId ? this.readCheckpoint(id, toCheckpointId) : current;
      if (target.revision < baseline.revision) throw new BoardError(400, 'Target checkpoint predates the baseline');
      return { ...sceneChanges(checkpointId, baseline, target), ...(toCheckpointId ? { nextCheckpointId: toCheckpointId } : {}) };
    });
  }

  subscribe(id: string, listener: Listener): Promise<() => void> {
    return this.serial(() => {
      const scene = this.read(id);
      const listeners = this.listeners.get(id) ?? new Set<Listener>();
      listeners.add(listener);
      this.listeners.set(id, listeners);
      const unsubscribe = () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(id); };
      try { listener.scene(this.snapshot(scene)); }
      catch (error) { unsubscribe(); throw error; }
      return unsubscribe;
    });
  }

  close() {
    if (this.closing) return this.closing;
    clearTimeout(this.timer);
    this.closing = (async () => {
      await this.tail;
      try {
        if (this.ready) {
          await this.ready;
          for (const id of this.pending.keys()) this.persist(this.read(id));
        }
      } finally {
        for (const listeners of this.listeners.values()) for (const listener of listeners) listener.close();
        this.listeners.clear();
        this.database.close();
      }
    })();
    return this.closing;
  }
}
