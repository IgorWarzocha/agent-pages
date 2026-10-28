import { afterEach, expect, mock, test } from 'bun:test';
import { createFeedbackConnection } from '../src/features/feedback/sync';

const originalFetch = globalThis.fetch;
const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanups.splice(0)) close();
  globalThis.fetch = originalFetch;
  if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
  else Reflect.deleteProperty(globalThis, 'window');
});
const saved = { file: 'test__feedback.tsx', revision: 0, updatedAt: null, values: {} };
function fixture() {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  const connection = createFeedbackConnection(saved.file);
  cleanups.push(connection.close);
  return connection;
}
function until(connection: ReturnType<typeof fixture>, predicate: () => boolean) {
  if (predicate()) return Promise.resolve();
  return new Promise<void>(resolve => { const stop = connection.subscribe(() => { if (predicate()) { stop(); resolve(); } }); });
}

test('draft edits cause no writes, explicit submission saves and newer edits survive an in-flight acknowledgement', async () => {
  const connection = fixture();
  let acknowledge!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { acknowledge = resolve; });
  const fetch = mock(async (_url, init) => init?.method === 'PATCH' ? pending : Response.json(saved));
  globalThis.fetch = fetch;
  connection.start();
  await until(connection, () => connection.snapshot().ready);
  connection.setValue('choice', 'first');
  connection.setValue('comment', 'My comment');
  expect(fetch).toHaveBeenCalledTimes(1);
  const navigation = new Event('agent-pages-before-navigate', { cancelable: true });
  window.dispatchEvent(navigation);
  expect(navigation.defaultPrevented).toBe(true);
  const saving = connection.save();
  connection.setValue('comment', 'A newer comment');
  acknowledge(Response.json({ ...saved, revision: 1, updatedAt: new Date().toISOString(), values: { choice: 'first', comment: 'My comment' } }));
  await saving;
  expect(connection.snapshot().values.comment).toBe('A newer comment');
  expect(connection.snapshot().status).toBe('unsaved');
  expect(connection.snapshot().revision).toBe(1);
});

test('conflict and network failure preserve drafts; explicit reload restores shared answers', async () => {
  const connection = fixture();
  let remote = saved;
  globalThis.fetch = mock(async (_url, init) => init?.method === 'PATCH'
    ? Response.json({ error: 'Conflict', feedback: remote }, { status: 409 }) : Response.json(remote));
  connection.start();
  await until(connection, () => connection.snapshot().ready);
  connection.setValue('comment', 'Keep my draft');
  await connection.save();
  expect(connection.snapshot().status).toBe('conflict');
  expect(connection.snapshot().values.comment).toBe('Keep my draft');
  globalThis.fetch = mock(async () => { throw new Error('Offline'); });
  await connection.save();
  expect(connection.snapshot().status).toBe('error');
  expect(connection.snapshot().values.comment).toBe('Keep my draft');
  remote = { ...saved, revision: 2, values: { comment: 'Shared answer' } };
  globalThis.fetch = mock(async () => Response.json(remote));
  await connection.discardAndReload();
  expect(connection.snapshot().values.comment).toBe('Shared answer');
  expect(connection.snapshot().dirty).toBe(false);
});

test('remote refresh cannot overwrite a draft started during the request, and lifecycle restart reconnects', async () => {
  const connection = fixture();
  globalThis.fetch = mock(async () => Response.json(saved));
  connection.start();
  await until(connection, () => connection.snapshot().ready);
  let resolve!: (response: Response) => void;
  globalThis.fetch = mock(() => new Promise<Response>(done => { resolve = done; }));
  const refreshing = connection.refresh();
  connection.setValue('comment', 'Typing');
  resolve(Response.json({ ...saved, revision: 1, values: { comment: 'Remote' } }));
  await refreshing;
  expect(connection.snapshot().values.comment).toBe('Typing');
  const discarding = connection.discardAndReload();
  connection.setValue('comment', 'New edits after confirming discard');
  resolve(Response.json({ ...saved, revision: 2, values: { comment: 'Saved remotely' } }));
  await discarding;
  expect(connection.snapshot().values.comment).toBe('New edits after confirming discard');
  expect(connection.snapshot().dirty).toBe(true);
  connection.close();
  globalThis.fetch = mock(async () => Response.json({ ...saved, revision: 2, values: { comment: 'Restarted' } }));
  connection.start();
  await connection.discardAndReload();
  // Restart keeps drafts unless the caller explicitly discards them.
  expect(connection.snapshot().values.comment).toBe('Restarted');
});
