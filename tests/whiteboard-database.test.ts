import { afterEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WhiteboardDatabase } from '../server/whiteboard-database.ts';
import { boardSceneSchema, type BoardScene } from '../src/features/whiteboard/contract.ts';

const cleanups: (() => Promise<unknown> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture(initialise = true) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-pages-sqlite-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const database = new WhiteboardDatabase(directory);
  cleanups.push(() => database.close());
  if (initialise) await database.initialise();
  return { database, directory };
}
function scene(): BoardScene {
  return boardSceneSchema.parse({
    id: randomUUID(), title: 'Durable drawing', revision: 0, updatedAt: '2026-01-01T00:00:00.000Z',
    elements: [{ id: 'image', type: 'image', x: 0, y: 0, width: 50, height: 50, fileId: 'asset', status: 'saved', scale: [1, 1] }],
    files: { asset: { id: 'asset', mimeType: 'image/png', dataURL: 'data:image/png;base64,YQ==', created: 1, extra: 'preserved' } },
  });
}
const preview = { revision: 0, dataURL: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/F4sAAAAASUVORK5CYII=' };

describe('whiteboard SQLite durability', () => {
  test('migrates scenes, evolving file metadata and previews once, leaving legacy files intact', async () => {
    const { database, directory } = await fixture(false);
    const board = scene();
    const source = JSON.stringify({ ...board, durableRevision: 0, persistenceError: 'old failure', checkpointId: randomUUID() });
    const legacy = path.join(directory, `${board.id}.json`);
    await writeFile(legacy, source);
    await writeFile(`${legacy}.preview`, JSON.stringify(preview));
    await database.initialise();
    expect(database.get(board.id)).toEqual(board);
    expect(database.list()).toEqual([board]);
    expect(database.getPreview(board.id)).toEqual(preview);
    expect(await readFile(legacy, 'utf8')).toBe(source);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(directory, 'boards.sqlite'))).mode & 0o777).toBe(0o600);
    database.save({ ...board, revision: 1, files: {} });
    database.close();
    await writeFile(legacy, '{invalid legacy JSON ignored after migration');
    await database.initialise();
    expect(database.get(board.id)?.revision).toBe(1);
    expect(database.get(board.id)?.files).toEqual({});
  });

  test('checkpoints keep the exact files across autosaves, ID reuse, and restart without duplicating payloads', async () => {
    const { database, directory } = await fixture();
    const board = scene();
    database.save({ ...board, durableRevision: 0, persistenceError: 'temporary', checkpointId: randomUUID() },
      { id: 'agent-batch', createdAt: board.updatedAt });
    database.save({ ...board, revision: 1 });
    database.save({ ...board, revision: 2, files: { asset: { ...board.files.asset, dataURL: 'data:image/png;base64,Yg==' } } });
    database.save({ ...board, revision: 3, files: {} });
    database.close();
    await database.initialise();
    expect(database.get(board.id)?.revision).toBe(3);
    expect(database.get(board.id)?.files).toEqual({});
    expect(database.checkpoint(board.id, 'agent-batch')).toEqual(board);
    expect(database.checkpoint(board.id, 'missing')).toBeUndefined();
    expect(database.get(randomUUID())).toBeUndefined();
    const inspection = new DatabaseSync(path.join(directory, 'boards.sqlite'));
    try {
      expect(inspection.prepare('SELECT count(*) AS count FROM blobs').get()?.count).toBe(2);
      expect(inspection.prepare('SELECT count(*) AS count FROM checkpoints').get()?.count).toBe(1);
      const saved = inspection.prepare('SELECT snapshot FROM checkpoints').get()?.snapshot;
      expect(typeof saved).toBe('string');
      expect(String(saved)).not.toContain('data:image');
    } finally { inspection.close(); }
  });

  test('a checkpoint conflict rolls back scene and new blobs together', async () => {
    const { database, directory } = await fixture();
    const board = scene();
    const checkpoint = { id: 'immutable', createdAt: board.updatedAt };
    database.save(board, checkpoint, preview);
    const changed = { ...board, revision: 1, files: { asset: { ...board.files.asset, dataURL: 'data:image/png;base64,Yw==' } } };
    expect(() => database.save(changed, checkpoint, { ...preview, revision: 1 })).toThrow();
    expect(database.get(board.id)).toEqual(board);
    expect(database.getPreview(board.id)).toEqual(preview);
    expect(database.checkpoint(board.id, checkpoint.id)).toEqual(board);
    const inspection = new DatabaseSync(path.join(directory, 'boards.sqlite'));
    try { expect(inspection.prepare('SELECT count(*) AS count FROM blobs').get()?.count).toBe(1); }
    finally { inspection.close(); }
    database.save(changed, undefined, { ...preview, revision: 1 });
    expect(database.get(board.id)).toEqual(changed);
    expect(database.getPreview(board.id)?.revision).toBe(1);
  });
});
