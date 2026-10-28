import { createHash } from 'node:crypto';
import { chmod, mkdir, open, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import {
  binaryFileSchema, boardCheckpointSchema, boardIdSchema, boardPreviewSchema, boardSceneSchema,
  MAX_PREVIEW_BYTES, MAX_PREVIEW_REQUEST_BYTES, MAX_SCENE_BYTES,
  type BoardPreview, type BoardScene,
} from '../src/features/whiteboard/contract.ts';

const storedSceneSchema = boardSceneSchema.omit({
  files: true, durableRevision: true, persistenceError: true, checkpointId: true,
}).extend({
  fileRefs: z.record(z.string(), z.object({
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    metadata: binaryFileSchema.omit({ dataURL: true }),
  }).strict()),
}).strict();

function checkSize(source: string, limit: number, description: string) {
  if (Buffer.byteLength(source) > limit) throw new Error(`${description} exceeds size limit`);
}

function parsePreview(source: string): BoardPreview {
  checkSize(source, MAX_PREVIEW_REQUEST_BYTES, 'Persisted preview');
  const preview = boardPreviewSchema.parse(JSON.parse(source));
  const encoded = preview.dataURL.slice('data:image/png;base64,'.length);
  const png = Buffer.from(encoded, 'base64');
  if (png.length > MAX_PREVIEW_BYTES || png.toString('base64') !== encoded || png.length < 45 ||
    !png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ||
    png.readUInt32BE(8) !== 13 || png.toString('ascii', 12, 16) !== 'IHDR' ||
    !png.readUInt32BE(16) || !png.readUInt32BE(20) ||
    !png.subarray(-12).equals(Buffer.from('0000000049454e44ae426082', 'hex'))) {
    throw new Error('Persisted preview must be a PNG base64 data URL');
  }
  return preview;
}

/** Durable storage only; the authority owns validation, ordering and publication. */
export class WhiteboardDatabase {
  private connection?: DatabaseSync;
  readonly directory: string;

  constructor(directory: string) { this.directory = directory; }

  private get db(): DatabaseSync {
    if (!this.connection) throw new Error('Whiteboard database is not initialised');
    return this.connection;
  }

  async initialise(): Promise<void> {
    if (this.connection) return;
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    const filename = path.join(this.directory, 'boards.sqlite');
    const handle = await open(filename, 'a', 0o600);
    try { await handle.chmod(0o600); } finally { await handle.close(); }
    this.connection = new DatabaseSync(filename);
    try {
      // FULL sync makes a successful COMMIT durable in the WAL, not merely queued.
      this.db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS blobs (hash TEXT PRIMARY KEY, data_url TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS scenes (id TEXT PRIMARY KEY, snapshot TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS checkpoints (
          board_id TEXT NOT NULL REFERENCES scenes(id),
          id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          snapshot TEXT NOT NULL,
          PRIMARY KEY (board_id, id)
        );
        CREATE INDEX IF NOT EXISTS checkpoint_revisions
          ON checkpoints (board_id, json_extract(snapshot, '$.revision'));
        CREATE TABLE IF NOT EXISTS previews (
          board_id TEXT PRIMARY KEY REFERENCES scenes(id), payload TEXT NOT NULL
        );
      `);
      await this.migrateLegacy();
    } catch (error) {
      this.close();
      throw new Error('Unable to initialise whiteboard database', { cause: error });
    }
  }

  private transaction(operation: () => void): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      operation();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private async migrateLegacy(): Promise<void> {
    if (this.db.prepare('SELECT name FROM migrations WHERE name = ?').get('legacy-json')) return;
    // Keep the entire import and its marker atomic, including a malformed later file.
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const entries = (await readdir(this.directory)).sort();
      for (const entry of entries.filter(entry => entry.endsWith('.json'))) {
        const id = boardIdSchema.parse(entry.slice(0, -5));
        const source = await readFile(path.join(this.directory, entry), 'utf8');
        checkSize(source, MAX_SCENE_BYTES, 'Persisted scene');
        const scene = boardSceneSchema.parse(JSON.parse(source));
        if (scene.id !== id) throw new Error(`Persisted board ID does not match ${entry}`);
        if (!this.db.prepare('SELECT id FROM scenes WHERE id = ?').get(id)) this.writeScene(scene);
      }
      for (const entry of entries.filter(entry => entry.endsWith('.json.preview'))) {
        const id = boardIdSchema.parse(entry.slice(0, -13));
        const preview = parsePreview(await readFile(path.join(this.directory, entry), 'utf8'));
        if (!this.db.prepare('SELECT id FROM scenes WHERE id = ?').get(id)) {
          throw new Error(`Persisted preview has no whiteboard: ${entry}`);
        }
        // Old derived previews must not replace previews already in SQLite.
        this.db.prepare('INSERT OR IGNORE INTO previews (board_id, payload) VALUES (?, ?)')
          .run(id, JSON.stringify(preview));
      }
      this.db.prepare('INSERT INTO migrations (name) VALUES (?)').run('legacy-json');
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private writeScene(scene: BoardScene): string {
    // Persist domain state only, never live authority status from the wire scene.
    const { id, title, revision, updatedAt, elements, files } = scene;
    const fileRefs: z.infer<typeof storedSceneSchema>['fileRefs'] = {};
    const insertBlob = this.db.prepare('INSERT OR IGNORE INTO blobs (hash, data_url) VALUES (?, ?)');
    for (const [id, file] of Object.entries(files)) {
      const { dataURL, ...metadata } = file;
      const hash = createHash('sha256').update(dataURL).digest('hex');
      insertBlob.run(hash, dataURL);
      Object.defineProperty(fileRefs, id, { value: { hash, metadata }, enumerable: true });
    }
    const snapshot = JSON.stringify({ id, title, revision, updatedAt, elements, fileRefs });
    this.db.prepare('INSERT INTO scenes (id, snapshot) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET snapshot = excluded.snapshot')
      .run(scene.id, snapshot);
    return snapshot;
  }

  private restore(snapshot: unknown): BoardScene {
    if (typeof snapshot !== 'string') throw new Error('Invalid persisted scene snapshot');
    const { fileRefs, ...content } = storedSceneSchema.parse(JSON.parse(snapshot));
    const files: BoardScene['files'] = {};
    for (const [id, { hash, metadata }] of Object.entries(fileRefs)) {
      const blob = this.db.prepare('SELECT data_url FROM blobs WHERE hash = ?').get(hash);
      if (!blob || typeof blob.data_url !== 'string') throw new Error(`Missing persisted file blob ${hash}`);
      Object.defineProperty(files, id, { value: { ...metadata, dataURL: blob.data_url }, enumerable: true });
    }
    return boardSceneSchema.parse({ ...content, files });
  }

  get(id: string): BoardScene | undefined {
    const row = this.db.prepare('SELECT snapshot FROM scenes WHERE id = ?').get(id);
    return row ? this.restore(row.snapshot) : undefined;
  }

  list(): BoardScene[] {
    return this.db.prepare('SELECT snapshot FROM scenes').all().map(row => this.restore(row.snapshot))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  }

  save(scene: BoardScene, checkpoint?: { id: string; createdAt: string }, preview?: BoardPreview): void {
    this.transaction(() => {
      const snapshot = this.writeScene(scene);
      if (preview) this.putPreview(scene.id, preview);
      if (checkpoint) {
        this.db.prepare('INSERT INTO checkpoints (board_id, id, created_at, snapshot) VALUES (?, ?, ?, ?)')
          .run(scene.id, checkpoint.id, checkpoint.createdAt, snapshot);
      }
    });
  }

  checkpoint(id: string, checkpointId: string): BoardScene | undefined {
    const row = this.db.prepare('SELECT snapshot FROM checkpoints WHERE board_id = ? AND id = ?').get(id, checkpointId);
    return row ? this.restore(row.snapshot) : undefined;
  }

  checkpointAtRevision(id: string, revision: number) {
    const row = this.db.prepare(`SELECT id, created_at AS createdAt FROM checkpoints
      WHERE board_id = ? AND json_extract(snapshot, '$.revision') = ? ORDER BY rowid LIMIT 1`).get(id, revision);
    return row ? boardCheckpointSchema.pick({ id: true, createdAt: true }).parse(row) : undefined;
  }

  getPreview(id: string): BoardPreview | undefined {
    const row = this.db.prepare('SELECT payload FROM previews WHERE board_id = ?').get(id);
    if (!row) return undefined;
    if (typeof row.payload !== 'string') throw new Error('Invalid persisted preview');
    return parsePreview(row.payload);
  }

  putPreview(id: string, preview: BoardPreview): void {
    this.db.prepare('INSERT INTO previews (board_id, payload) VALUES (?, ?) ON CONFLICT(board_id) DO UPDATE SET payload = excluded.payload')
      .run(id, JSON.stringify(preview));
  }

  close(): void {
    this.connection?.close();
    this.connection = undefined;
  }
}
