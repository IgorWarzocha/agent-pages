import { afterEach, expect, mock, test } from 'bun:test';
import { boardSceneSchema } from '../src/features/whiteboard/contract';
import { connectBoard, type Scene } from '../src/features/whiteboard/sync';

const descriptors = ['window', 'EventSource'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
const originalFetch = globalThis.fetch;
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanups.splice(0)) close();
  globalThis.fetch = originalFetch;
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const events = new EventTarget();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  Object.defineProperty(globalThis, 'EventSource', { configurable: true, value: class {
    addEventListener = events.addEventListener.bind(events);
    close() {}
  } });
  const empty = boardSceneSchema.parse({ id: 'f1212bde-dd01-4dd7-8427-f7c8e5ff0de7', title: 'Shared', revision: 0, updatedAt: new Date().toISOString(), elements: [], files: {} });
  return { empty, emit: (scene: typeof empty) => events.dispatchEvent(new MessageEvent('scene', { data: JSON.stringify(scene) })) };
}

test('own SSE acknowledgements do not replace editor objects or discard a newer local edit', async () => {
  const { empty, emit } = fixture();
  const initialised = deferred<void>();
  const firstWrite = deferred<void>();
  const response = deferred<Response>();
  const secondWrite = deferred<void>();
  let local: Scene = { elements: [], files: {} };
  let writes = 0;
  const bodies: { baseRevision: number; elements: Scene['elements']; files: Scene['files'] }[] = [];
  globalThis.fetch = mock(async (_url, init) => {
    if (!init?.method) return Response.json(empty);
    const body = JSON.parse(String(init.body));
    bodies.push(body);
    if (++writes === 1) { firstWrite.resolve(); return response.promise; }
    const committed = Response.json({ ...empty, ...body, baseRevision: undefined, revision: 2 });
    secondWrite.resolve();
    return committed;
  });
  const merge = mock(() => {});
  const connection = connectBoard(empty.id, { read: () => local, merge, ready: () => true, status: status => { if (status === 'saved') initialised.resolve(); } });
  cleanups.push(connection.close);
  await initialised.promise;
  // A versioned file stands in for any local scene mutation. The controller
  // owns ordering and acknowledgements, not Excalidraw's geometry algorithms.
  const file = { id: 'image', mimeType: 'image/png', dataURL: 'data:image/png;base64,', created: 1 };
  local = { elements: [], files: { image: { ...file, version: 1 } } as Scene['files'] };
  connection.changed();
  await firstWrite.promise;
  local = { elements: [], files: { image: { ...file, version: 2 } } as Scene['files'] };
  connection.changed();
  const committed = boardSceneSchema.parse({ ...empty, revision: 1, elements: bodies[0].elements, files: bodies[0].files });
  emit(committed);
  expect(merge).not.toHaveBeenCalled();
  expect(connection.dirty()).toBe(true);
  response.resolve(Response.json(committed));
  await secondWrite.promise;
  expect(bodies[1].baseRevision).toBe(1);
  expect(bodies[1].files.image.version).toBe(2);
  expect(merge).not.toHaveBeenCalled();
});

test('remote scenes wait for asynchronous image initialisation, and stale GET results cannot rewind SSE state', async () => {
  const { empty, emit } = fixture();
  const read = deferred<Response>();
  let local: Scene = { elements: [], files: {} };
  let ready = false;
  globalThis.fetch = mock(() => read.promise);
  const merge = mock(() => { local = { elements: [], files: {} }; });
  const status = mock(() => {});
  const connection = connectBoard(empty.id, { read: () => local, merge, ready: () => ready, status });
  cleanups.push(connection.close);
  emit({ ...empty, revision: 2, files: { screenshot: { id: 'screenshot', mimeType: 'image/png', dataURL: 'data:image/png;base64,', created: 1 } } });
  expect(merge).not.toHaveBeenCalled();
  ready = true;
  connection.changed();
  expect(merge).toHaveBeenCalledTimes(1);
  const calls = status.mock.calls.length;
  read.resolve(Response.json({ ...empty, revision: 1 }));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(status.mock.calls.length).toBe(calls);
});

test('the additive SDK file cache cannot restore remotely removed attachments', async () => {
  const { empty, emit } = fixture();
  const initialised = deferred<void>();
  const screenshot = { id: 'screenshot', mimeType: 'image/png', dataURL: 'data:image/png;base64,', created: 1 };
  const initial = { ...empty, files: { screenshot } };
  const cache: Scene = { elements: [], files: initial.files as Scene['files'] };
  const fetch = mock(async () => Response.json(initial));
  globalThis.fetch = fetch;
  const connection = connectBoard(empty.id, {
    read: () => cache, merge: () => {}, ready: () => true,
    status: status => { if (status === 'saved') initialised.resolve(); },
  });
  cleanups.push(connection.close);
  await initialised.promise;
  emit({ ...empty, revision: 1 });
  connection.changed();
  expect(connection.dirty()).toBe(false);
  // No compensating PATCH is allowed, even though the SDK still caches it.
  await new Promise(resolve => setTimeout(resolve, 210));
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('live acknowledgements remain synced until a durability event, which never overwrites a newer local edit', async () => {
  const { empty, emit } = fixture();
  const initialised = deferred<void>();
  let local: Scene = { elements: [], files: {} };
  const statuses: { status: string; error?: string }[] = [];
  globalThis.fetch = mock(async () => Response.json({ ...empty, durableRevision: 0 }));
  const merge = mock(() => {});
  const connection = connectBoard(empty.id, {
    read: () => local, merge, ready: () => true,
    status(status, error) { statuses.push({ status, error }); if (status === 'saved') initialised.resolve(); },
  });
  cleanups.push(connection.close);
  await initialised.promise;
  emit({ ...empty, revision: 1, durableRevision: 0 });
  expect(statuses.at(-1)?.status).toBe('synced');
  emit({ ...empty, revision: 1, durableRevision: 0, persistenceError: 'Disk full' });
  expect(statuses.at(-1)).toEqual({ status: 'synced', error: 'Disk full' });
  emit({ ...empty, revision: 1, durableRevision: 1 });
  expect(statuses.at(-1)).toEqual({ status: 'saved', error: undefined });
  const file = { id: 'image', mimeType: 'image/png', dataURL: 'data:image/png;base64,', created: 1 };
  local = { elements: [], files: { image: file } as Scene['files'] };
  connection.changed();
  emit({ ...empty, revision: 1, durableRevision: 1 });
  expect(statuses.at(-1)?.status).toBe('saving');
  expect(connection.dirty()).toBe(true);
  expect(merge).not.toHaveBeenCalled();
});
