import { artifactFeedbackSchema, type ArtifactFeedback } from './contract';

type Values = ArtifactFeedback['values'];
export type FeedbackState = {
  status: 'loading' | 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict';
  values: Values; revision: number; updatedAt: string | null;
  ready: boolean; dirty: boolean; error?: string;
};

/** Explicit submissions are durable. Drafts never overwrite another browser's answers. */
export function createFeedbackConnection(file: string) {
  let abort = new AbortController();
  let epoch = 0, started = false;
  let editVersion = 0;
  const listeners = new Set<() => void>();
  let baseline: ArtifactFeedback | undefined;
  let values: Values = {};
  let saving = false, refreshing = false;
  let error: string | undefined;
  let conflict = false;
  let state: FeedbackState = { status: 'loading', values, revision: 0, updatedAt: null, ready: false, dirty: false };
  let timer: ReturnType<typeof setInterval> | undefined;
  const route = '/api/artifact-feedback?file=' + encodeURIComponent(file);

  function dirty() { return !!baseline && JSON.stringify(values) !== JSON.stringify(baseline.values); }
  function publish() {
    const unsaved = dirty();
    state = { values, revision: baseline?.revision ?? 0, updatedAt: baseline?.updatedAt ?? null,
      ready: !!baseline, dirty: unsaved, error,
      status: saving ? 'saving' : conflict ? 'conflict' : error ? 'error' : !baseline ? 'loading' : unsaved ? 'unsaved' : 'saved' };
    for (const listener of listeners) listener();
  }
  async function request(init?: RequestInit) {
    const response = await fetch(route, { ...init, signal: abort.signal });
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Shared feedback needs the running Agent Pages server.');
    const body = await response.json();
    return { response, body };
  }
  async function refresh(discard = false) {
    if (saving || refreshing || abort.signal.aborted || (!discard && dirty())) return;
    refreshing = true;
    const token = epoch;
    const editsAtStart = editVersion;
    try {
      const { response, body } = await request();
      if (token !== epoch) return;
      if (!response.ok) throw new Error(body.error || 'Could not load feedback');
      const next = artifactFeedbackSchema.parse(body);
      if (baseline && next.revision < baseline.revision) return;
      if (editsAtStart !== editVersion) {
        if (discard) error = 'Your new edits were kept. Load saved responses again only if you want to discard them.';
        return;
      }
      // The user may have started typing while this GET was in flight.
      if (!dirty() || discard) { baseline = next; values = next.values; error = undefined; conflict = false; }
    } catch (failure) {
      if (token === epoch && !abort.signal.aborted) error = failure instanceof Error ? failure.message : 'Could not load feedback';
    } finally { if (token === epoch) { refreshing = false; if (!abort.signal.aborted) publish(); } }
  }
  async function save() {
    if (!baseline || saving || !dirty() || abort.signal.aborted) return;
    saving = true; error = undefined; conflict = false;
    const submitted = structuredClone(values);
    const revision = baseline.revision;
    const token = epoch;
    publish();
    try {
      const { response, body } = await request({ method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseRevision: revision, values: submitted }) });
      if (token !== epoch) return;
      if (response.status === 409) {
        conflict = true;
        throw new Error('Feedback changed in another browser. Your draft is intact. Copy it before loading the saved responses.');
      }
      if (!response.ok) throw new Error(body.error || 'Could not save feedback');
      const next = artifactFeedbackSchema.parse(body);
      baseline = next;
      if (JSON.stringify(values) === JSON.stringify(submitted)) values = next.values;
    } catch (failure) {
      if (token === epoch && !abort.signal.aborted) error = failure instanceof Error ? failure.message : 'Could not save feedback';
    } finally { if (token === epoch) { saving = false; if (!abort.signal.aborted) publish(); } }
  }
  function protect(event: Event) { if (dirty()) event.preventDefault(); }
  function focus() { void refresh(); }
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot: () => state,
    setValue(key: string, value: Values[string]) {
      if (!baseline || abort.signal.aborted) return;
      editVersion++;
      values = { ...values, [key]: value };
      error = undefined;
      publish();
    },
    save,
    refresh: () => refresh(),
    discardAndReload: () => refresh(true),
    start() {
      if (started) return;
      started = true;
      if (abort.signal.aborted) abort = new AbortController();
      void refresh();
      timer = setInterval(() => void refresh(), 3_000);
      window.addEventListener('focus', focus);
      window.addEventListener('beforeunload', protect);
      window.addEventListener('agent-pages-before-navigate', protect);
    },
    close() {
      started = false; epoch++; refreshing = false; saving = false;
      abort.abort(); clearInterval(timer);
      window.removeEventListener('focus', focus);
      window.removeEventListener('beforeunload', protect);
      window.removeEventListener('agent-pages-before-navigate', protect);
      listeners.clear();
    },
  };
}
