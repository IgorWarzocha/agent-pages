import { exportToBlob, getNonDeletedElements } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { Scene } from './sync';

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not encode preview'));
    reader.onerror = () => reject(reader.error ?? new Error('Could not encode preview'));
    reader.readAsDataURL(blob);
  });
}

/** Preview work never changes scene revisions or the editor's saved state. */
export function createBoardPreview(id: string, api: ExcalidrawImperativeAPI, report: (error: string) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | undefined;
  let generation = 0;
  let completed = -1;
  let scheduled = -1;
  let current: { revision: number; scene: Scene } | undefined;

  function pause() {
    generation++;
    clearTimeout(timer);
    request?.abort();
    scheduled = -1;
  }
  async function render(revision: number, scene: Scene, token: number) {
    const abort = new AbortController();
    request = abort;
    try {
      const blob = await exportToBlob({
        elements: getNonDeletedElements(scene.elements), files: scene.files, mimeType: 'image/png',
        maxWidthOrHeight: 1600,
        appState: { ...api.getAppState(), exportBackground: true, exportWithDarkMode: false, viewBackgroundColor: '#ffffff' },
      });
      if (token !== generation) return;
      if (blob.size > 3 * 1024 * 1024) throw new Error('The board preview exceeds 3 MiB. Export it from the editor instead.');
      const encoded = await dataUrl(blob);
      if (token !== generation) return;
      const response = await fetch('/api/boards/' + id + '/preview', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ revision, dataURL: encoded }), signal: abort.signal,
      });
      if (token !== generation) return;
      if (response.status === 409) return; // A newer scene will schedule its own preview.
      if (!response.ok) throw new Error((await response.json()).error || 'Could not save preview');
      completed = revision;
      report('');
    } catch (error) {
      if (token === generation && !abort.signal.aborted) report(error instanceof Error ? error.message : 'Could not render preview');
    } finally { if (token === generation) scheduled = -1; }
  }
  function schedule(revision: number, scene: Scene) {
    current = { revision, scene };
    if (revision === completed || revision === scheduled) return;
    pause();
    scheduled = revision;
    const token = generation;
    timer = setTimeout(() => void render(revision, scene, token), 350);
  }
  return {
    schedule,
    pause,
    retry() { completed = -1; if (current) schedule(current.revision, current.scene); },
    close: pause,
  };
}
