import { chmod, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { artifactFeedbackSchema, feedbackUpdateSchema, MAX_FEEDBACK_BYTES, type ArtifactFeedback } from '../src/features/feedback/contract.ts';
import { BoardError } from './whiteboards.ts';

export class FeedbackConflictError extends Error {
  constructor(public feedback: ArtifactFeedback) { super('Revision conflict. Read current feedback and reconcile before submitting again.'); }
}

/** One queued authority; successful updates are already durable, never autosaved. */
export class FeedbackStore {
  private database?: DatabaseSync;
  private ready?: Promise<void>;
  private tail: Promise<unknown> = Promise.resolve();
  private closing?: Promise<void>;

  constructor(readonly directory: string) {}

  private initialise() {
    return this.ready ??= (async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await chmod(this.directory, 0o700);
      const filename = path.join(this.directory, 'feedback.sqlite');
      const handle = await open(filename, 'a', 0o600);
      try { await handle.chmod(0o600); } finally { await handle.close(); }
      const db = new DatabaseSync(filename);
      try {
        db.exec(`
          PRAGMA journal_mode = WAL;
          PRAGMA synchronous = FULL;
          CREATE TABLE IF NOT EXISTS artifact_feedback (file TEXT PRIMARY KEY, snapshot TEXT NOT NULL);
        `);
        this.database = db;
      } catch (error) { db.close(); throw error; }
    })();
  }

  private serial<T>(operation: (db: DatabaseSync) => T): Promise<T> {
    if (this.closing) return Promise.reject(new BoardError(503, 'Feedback store is closed'));
    const result = this.tail.then(() => this.initialise()).then(() => {
      if (!this.database) throw new Error('Feedback database is not initialised');
      return operation(this.database);
    });
    this.tail = result.catch(() => undefined);
    return result;
  }

  private read(db: DatabaseSync, file: string): ArtifactFeedback {
    const row = db.prepare('SELECT snapshot FROM artifact_feedback WHERE file = ?').get(file);
    if (!row) return { file, revision: 0, updatedAt: null, values: {} };
    const source = z.string().parse(row.snapshot);
    if (Buffer.byteLength(source) > MAX_FEEDBACK_BYTES + 1024) throw new Error('Persisted feedback exceeds size limit');
    const feedback = artifactFeedbackSchema.parse(JSON.parse(source));
    if (feedback.file !== file) throw new Error('Persisted feedback filename mismatch');
    return feedback;
  }

  get(file: string) {
    artifactFeedbackSchema.shape.file.parse(file);
    return this.serial(db => this.read(db, file));
  }

  update(file: string, input: unknown) {
    artifactFeedbackSchema.shape.file.parse(file);
    const update = feedbackUpdateSchema.parse(input);
    return this.serial(db => {
      // Lock before reading so CAS remains correct even with another SQLite connection.
      db.exec('BEGIN IMMEDIATE');
      try {
        const current = this.read(db, file);
        if (update.baseRevision !== current.revision) throw new FeedbackConflictError(current);
        if (isDeepStrictEqual(current.values, update.values)) {
          db.exec('ROLLBACK');
          return current;
        }
        const feedback = artifactFeedbackSchema.parse({ file, revision: current.revision + 1, updatedAt: new Date().toISOString(), values: update.values });
        db.prepare('INSERT INTO artifact_feedback (file, snapshot) VALUES (?, ?) ON CONFLICT(file) DO UPDATE SET snapshot = excluded.snapshot')
          .run(file, JSON.stringify(feedback));
        db.exec('COMMIT');
        return feedback;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    });
  }

  close() {
    return this.closing ??= (async () => {
      await this.tail;
      this.database?.close();
      this.database = undefined;
    })();
  }
}
