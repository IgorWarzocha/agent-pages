import { createHash } from 'node:crypto';
import { chmod, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { annotationDocumentSchema, clearAnnotationsSchema, MAX_ANNOTATION_DOCUMENT_BYTES, submitAnnotationsSchema, type AnnotationDocument } from '../src/features/annotations/contract.ts';
import { artifactFileSchema } from './artifacts-api.ts';
import { BoardError } from './whiteboards.ts';

export class AnnotationConflictError extends Error {
  constructor(public annotations: AnnotationDocument, message = 'Revision conflict. Read current annotations before clearing again.') { super(message); }
}

type Listener = { annotations(document: AnnotationDocument): void; close(): void };
export const MAX_ANNOTATION_RECEIPTS = 10_000;

/** Explicit batch commits only; the queue owns SQLite and subscription ordering. */
export class AnnotationStore {
  private database?: DatabaseSync;
  private ready?: Promise<void>;
  private tail: Promise<unknown> = Promise.resolve();
  private closing?: Promise<void>;
  private listeners = new Map<string, Set<Listener>>();

  constructor(readonly directory: string) {}

  private initialise() {
    return this.ready ??= (async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await chmod(this.directory, 0o700);
      const filename = path.join(this.directory, 'annotations.sqlite');
      const handle = await open(filename, 'a', 0o600);
      try { await handle.chmod(0o600); } finally { await handle.close(); }
      const db = new DatabaseSync(filename);
      try {
        db.exec(`
          PRAGMA journal_mode = WAL;
          PRAGMA synchronous = FULL;
          CREATE TABLE IF NOT EXISTS artifact_annotations (file TEXT PRIMARY KEY, snapshot TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS annotation_receipts (
            file TEXT NOT NULL, batch_id TEXT NOT NULL, hash TEXT NOT NULL,
            PRIMARY KEY (file, batch_id)
          );
        `);
        this.database = db;
      } catch (error) { db.close(); throw error; }
    })();
  }

  private serial<T>(operation: (db: DatabaseSync) => T): Promise<T> {
    if (this.closing) return Promise.reject(new BoardError(503, 'Annotation store is closed'));
    const result = this.tail.then(() => this.initialise()).then(() => {
      if (!this.database) throw new Error('Annotation database is not initialised');
      return operation(this.database);
    });
    this.tail = result.catch(() => undefined);
    return result;
  }

  private read(db: DatabaseSync, file: string): AnnotationDocument {
    const row = db.prepare('SELECT snapshot FROM artifact_annotations WHERE file = ?').get(file);
    if (!row) return { file, revision: 0, updatedAt: null, batches: [] };
    const source = z.string().parse(row.snapshot);
    if (Buffer.byteLength(source) > MAX_ANNOTATION_DOCUMENT_BYTES) throw new Error('Persisted annotations exceed size limit');
    const document = annotationDocumentSchema.parse(JSON.parse(source));
    if (document.file !== file) throw new Error('Persisted annotation filename mismatch');
    return document;
  }

  get(file: string) {
    artifactFileSchema.parse(file);
    return this.serial(db => this.read(db, file));
  }

  private change(file: string, transform: (current: AnnotationDocument, db: DatabaseSync) => AnnotationDocument) {
    return this.serial(db => {
      // Lock before reading so CAS and batch deduplication cover other SQLite connections.
      db.exec('BEGIN IMMEDIATE');
      let document: AnnotationDocument;
      try {
        const current = this.read(db, file);
        const candidate = transform(current, db);
        if (candidate === current) { db.exec('ROLLBACK'); return current; }
        document = annotationDocumentSchema.parse({ ...candidate, revision: current.revision + 1, updatedAt: new Date().toISOString() });
        db.prepare('INSERT INTO artifact_annotations (file, snapshot) VALUES (?, ?) ON CONFLICT(file) DO UPDATE SET snapshot = excluded.snapshot')
          .run(file, JSON.stringify(document));
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      // Listener failures must never turn an already committed write into a failed response.
      for (const listener of this.listeners.get(file) ?? []) {
        try { listener.annotations(structuredClone(document)); }
        catch (error) {
          this.listeners.get(file)?.delete(listener);
          try { listener.close(); } catch (closeError) { console.error('[annotations subscription close]', closeError); }
          console.error('[annotations subscription]', error);
        }
      }
      return document;
    });
  }

  submit(file: string, input: unknown) {
    artifactFileSchema.parse(file);
    const submission = submitAnnotationsSchema.parse(input);
    const hash = createHash('sha256').update(JSON.stringify(submission.annotations)).digest('hex');
    return this.change(file, (current, db) => {
      const receipt = db.prepare('SELECT hash FROM annotation_receipts WHERE file = ? AND batch_id = ?').get(file, submission.batchId);
      if (receipt) {
        if (receipt.hash !== hash) throw new AnnotationConflictError(current, 'Batch ID already exists with different annotations');
        return current;
      }
      // Receipts contain no annotation content and survive clears. Eviction would let a
      // delayed retry resurrect cleared annotations, so fail visibly at a bounded cap.
      const count = db.prepare('SELECT COUNT(*) AS count FROM annotation_receipts WHERE file = ?').get(file);
      if (z.number().parse(count?.count) >= MAX_ANNOTATION_RECEIPTS) throw new AnnotationConflictError(current, 'Annotation receipt capacity reached; no new batches can be accepted for this artifact');
      const ids = new Set(current.batches.flatMap(batch => batch.annotations.map(annotation => annotation.id)));
      if (submission.annotations.some(annotation => ids.has(annotation.id))) throw new AnnotationConflictError(current, 'Annotation ID already exists');
      db.prepare('INSERT INTO annotation_receipts (file, batch_id, hash) VALUES (?, ?, ?)').run(file, submission.batchId, hash);
      return { ...current, batches: [...current.batches, { id: submission.batchId, file, createdAt: new Date().toISOString(), annotations: submission.annotations }] };
    });
  }

  clear(file: string, input: unknown) {
    artifactFileSchema.parse(file);
    const clear = clearAnnotationsSchema.parse(input);
    return this.change(file, current => {
      if (clear.baseRevision !== current.revision) throw new AnnotationConflictError(current);
      const ids = clear.ids === undefined ? undefined : new Set(clear.ids);
      const batches = ids === undefined ? [] : current.batches.map(batch => ({ ...batch, annotations: batch.annotations.filter(annotation => !ids.has(annotation.id)) })).filter(batch => batch.annotations.length);
      if (isDeepStrictEqual(batches, current.batches)) return current;
      return { ...current, batches };
    });
  }

  subscribe(file: string, listener: Listener): Promise<() => void> {
    artifactFileSchema.parse(file);
    return this.serial(db => {
      const document = this.read(db, file);
      const listeners = this.listeners.get(file) ?? new Set<Listener>();
      listeners.add(listener);
      this.listeners.set(file, listeners);
      const stop = () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(file); };
      try { listener.annotations(document); } catch (error) { stop(); throw error; }
      return stop;
    });
  }

  close() {
    return this.closing ??= (async () => {
      await this.tail;
      try {
        for (const listeners of this.listeners.values()) for (const listener of listeners) {
          try { listener.close(); } catch (error) { console.error('[annotations subscription close]', error); }
        }
      } finally {
        this.listeners.clear();
        this.database?.close();
        this.database = undefined;
      }
    })();
  }
}
