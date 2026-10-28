import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BoardError, WhiteboardStore, persistenceDeadline } from '../server/whiteboards.ts';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-pages-boards-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const store = new WhiteboardStore(directory);
  cleanups.push(() => store.close());
  return { store, directory };
}
const rectangle = { id: 'box', type: 'rectangle', x: 0, y: 0, width: 100, height: 40 };

describe('whiteboard authority', () => {
  test('serialises competing revisions and recovers the committed scene after restart', async () => {
    const { store, directory } = await fixture();
    const board = await store.create({ title: 'Shared diagram' });
    const results = await Promise.allSettled([
      store.update(board.id, { baseRevision: 0, elements: [rectangle], files: {} }),
      store.update(board.id, { baseRevision: 0, elements: [], files: {} }),
    ]);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    if (results[1].status === 'rejected') {
      expect(results[1].reason).toBeInstanceOf(BoardError);
      expect(results[1].reason.status).toBe(409);
      expect(results[1].reason.scene.revision).toBe(1);
    }
    await store.close();
    const reopened = new WhiteboardStore(directory);
    cleanups.push(() => reopened.close());
    const scene = await reopened.get(board.id);
    expect(scene.revision).toBe(1);
    expect(scene.elements[0].id).toBe('box');
    expect((await reopened.list())[0]).toEqual({ id: board.id, title: board.title, revision: 1, updatedAt: scene.updatedAt });
  });

  test('failed durable agent batch does not publish, while a browser edit remains live and retryable', async () => {
    const { store, directory } = await fixture();
    const board = await store.create({ title: 'Durability' });
    const revisions: number[] = [];
    await store.subscribe(board.id, { scene: scene => revisions.push(scene.revision), close: () => {} });
    const inspection = new DatabaseSync(path.join(directory, 'boards.sqlite'));
    cleanups.push(async () => inspection.close());
    inspection.exec("CREATE TRIGGER fail_save BEFORE UPDATE ON scenes BEGIN SELECT RAISE(ABORT, 'disk unavailable'); END;");
    await expect(store.update(board.id, { baseRevision: 0, elements: [rectangle], files: {}, checkpoint: true })).rejects.toThrow('disk unavailable');
    expect(revisions).toEqual([0]);
    const live = await store.update(board.id, { baseRevision: 0, elements: [rectangle], files: {} });
    expect(live.revision).toBe(1);
    expect(live.durableRevision).toBe(0);
    expect(revisions).toEqual([0, 1]);
    await expect(store.save(board.id)).rejects.toThrow('disk unavailable');
    await expect(store.checkpoint(board.id, {})).rejects.toThrow('disk unavailable');
    expect(inspection.prepare('SELECT count(*) AS n FROM checkpoints').get()?.n).toBe(0);
    expect((await store.get(board.id)).elements[0].id).toBe('box');
    inspection.exec('DROP TRIGGER fail_save');
    expect((await store.save(board.id)).durableRevision).toBe(1);
    expect(revisions).toEqual([0, 1, 1]);
  });

  test('checkpoints retain one agent baseline while later user edits yield compact diffs without writes', async () => {
    const { store, directory } = await fixture();
    const board = await store.create({ title: 'Changes since agent batch' });
    const committed = await store.update(board.id, { baseRevision: 0, elements: [rectangle, { ...rectangle, id: 'remove' }], files: {}, checkpoint: true });
    expect(committed.checkpointId).toBeString();
    expect(committed.durableRevision).toBe(1);
    const inspection = new DatabaseSync(path.join(directory, 'boards.sqlite'));
    cleanups.push(async () => inspection.close());
    inspection.exec('CREATE TABLE commits (revision INTEGER); CREATE TRIGGER count_saves AFTER UPDATE ON scenes BEGIN INSERT INTO commits VALUES (1); END;');
    const live = await store.update(board.id, { baseRevision: 1, elements: [
      { ...rectangle, width: 300, version: 2, versionNonce: 10 },
      { ...rectangle, id: 'remove', isDeleted: true }, { ...rectangle, id: 'new' },
    ], files: {} });
    expect(live.durableRevision).toBe(1);
    const diff = await store.changes(board.id, committed.checkpointId!);
    expect(diff.fromRevision).toBe(1);
    expect(diff.toRevision).toBe(2);
    expect(diff.added.map(e => e.id)).toEqual(['new']);
    expect(diff.updated.map(e => e.id)).toEqual(['box']);
    expect(diff.deletedIds).toEqual(['remove']);
    const before = await store.get(board.id);
    before.elements.length = 0;
    await store.list();
    await store.changes(board.id, committed.checkpointId!);
    expect((await store.get(board.id)).elements).toHaveLength(3);
    expect(inspection.prepare('SELECT count(*) AS n FROM commits').get()?.n).toBe(0);
    expect(inspection.prepare('SELECT count(*) AS n FROM checkpoints').get()?.n).toBe(1);
    await store.close();
    const reopened = new WhiteboardStore(directory);
    cleanups.push(() => reopened.close());
    expect(await reopened.changes(board.id, committed.checkpointId!)).toEqual(diff);
    await expect(reopened.checkpoint(board.id, { baseRevision: 1 })).rejects.toMatchObject({ status: 409 });
  });

  test('save deadlines enforce idle delay, minimum interval and maximum continuous-edit wait', () => {
    expect(persistenceDeadline(0, 0, 0)).toBe(5_000);
    expect(persistenceDeadline(6_000, 6_000, 0)).toBe(8_000);
    expect(persistenceDeadline(6_000, 15_000, 0)).toBe(16_000);
    expect(persistenceDeadline(6_000, 15_000, 13_000)).toBe(18_000);
  });

  test('background failures notify subscribers, retain live edits and clear after a successful retry', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-pages-save-retry-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const store = new WhiteboardStore(directory, { idleMs: 10, minIntervalMs: 40, maxWaitMs: 80 });
    cleanups.push(() => store.close());
    const board = await store.create({ title: 'Retry persistence' });
    const inspection = new DatabaseSync(path.join(directory, 'boards.sqlite'));
    cleanups.push(async () => inspection.close());
    inspection.exec("CREATE TRIGGER fail_save BEFORE UPDATE ON scenes BEGIN SELECT RAISE(ABORT, 'disk unavailable'); END;");
    const report = spyOn(console, 'error').mockImplementation(() => {});
    let failed!: () => void, recovered!: () => void;
    const failure = new Promise<void>(resolve => { failed = resolve; });
    const recovery = new Promise<void>(resolve => { recovered = resolve; });
    const notifications: { revision: number; durableRevision?: number; error?: string }[] = [];
    await store.subscribe(board.id, { scene(scene) {
      notifications.push({ revision: scene.revision, durableRevision: scene.durableRevision, error: scene.persistenceError });
      if (scene.persistenceError) failed();
      if (scene.revision === 1 && scene.durableRevision === 1 && !scene.persistenceError) recovered();
    }, close() {} });
    try {
      await store.update(board.id, { baseRevision: 0, elements: [rectangle], files: {} });
      await failure;
      expect((await store.get(board.id)).elements[0].id).toBe('box');
      expect(notifications.at(-1)).toMatchObject({ revision: 1, durableRevision: 0 });
      expect(notifications.at(-1)?.error).toContain('disk unavailable');
      expect(report).toHaveBeenCalled();
      inspection.exec('DROP TRIGGER fail_save');
      await recovery;
      expect(notifications.at(-1)).toEqual({ revision: 1, durableRevision: 1, error: undefined });
    } finally {
      inspection.exec('DROP TRIGGER IF EXISTS fail_save');
      report.mockRestore();
    }
  });
});
