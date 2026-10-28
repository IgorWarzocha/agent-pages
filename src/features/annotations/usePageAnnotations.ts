import { useCallback, useEffect, useRef, useState } from 'react';
import { annotationDocumentSchema, type Annotation, type AnnotationDocument } from './contract';

export function usePageAnnotations(file: string) {
  const [document, setDocument] = useState<AnnotationDocument>({ file, revision: 0, updatedAt: null, batches: [] });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  const route = '/api/annotations?file=' + encodeURIComponent(file);
  const accept = useCallback((value: unknown) => {
    const next = annotationDocumentSchema.parse(value);
    setDocument(current => next.revision >= current.revision ? next : current);
    setReady(true); setError('');
    return next;
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    abort.current = controller;
    const events = new EventSource('/api/annotations/events?file=' + encodeURIComponent(file));
    events.addEventListener('annotations', event => {
      if (controller.signal.aborted) return;
      try { accept(JSON.parse(event.data)); }
      catch (failure) { setError(failure instanceof Error ? failure.message : 'Invalid annotation event'); }
    });
    events.onerror = () => { if (!controller.signal.aborted) setError('Annotation connection lost. Reconnecting…'); };
    return () => { controller.abort(); events.close(); };
  }, [file, accept]);
  const request = useCallback(async (method: string, body: unknown) => {
    const controller = abort.current;
    if (!controller || controller.signal.aborted) throw new Error('Annotations are not connected');
    try {
      const response = await fetch(route, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Annotations need the running Agent Pages server');
      const value = await response.json();
      if (controller.signal.aborted) throw new Error('Annotation request cancelled');
      if (!response.ok) {
        if (response.status === 409 && value.annotations) accept(value.annotations);
        throw new Error(value.error || 'Could not save annotations');
      }
      return accept(value);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Annotation request failed');
      throw failure;
    }
  }, [route, accept]);
  return { document, ready, error,
    submit: (batchId: string, annotations: Annotation[]) => request('POST', { batchId, annotations }),
    clear: (baseRevision: number, ids?: string[]) => request('DELETE', { baseRevision, ...(ids ? { ids } : {}) }),
  };
}
