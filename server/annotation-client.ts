import { annotationDocumentSchema } from '../src/features/annotations/contract.ts';
import type { AgentPagesClient } from './http-client.ts';

/** One active MCP wait, backed by the authority's SSE feed rather than polling. */
export async function waitForAnnotations(client: AgentPagesClient, file: string, afterRevision: number, timeoutMs: number, signal?: AbortSignal) {
  const query = '?file=' + encodeURIComponent(file);
  let current = annotationDocumentSchema.parse(await client.request('/api/annotations' + query, 'GET', undefined, signal));
  if (current.revision !== afterRevision || timeoutMs === 0) return { changed: current.revision !== afterRevision, annotations: current };
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new Error('Annotation wait timed out')), timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(client.url + '/api/annotations/events' + query, { signal: combined, redirect: 'error' });
    if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream') || !response.body) throw new Error('Annotation event stream unavailable');
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error('Annotation event stream closed before the wait completed');
      buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n');
      if (Buffer.byteLength(buffer) > 2 * 1024 * 1024 + 1024) throw new Error('Annotation event exceeds size limit');
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const event = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (!event.split('\n').some(line => line.trim() === 'event: annotations')) continue;
        const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        current = annotationDocumentSchema.parse(JSON.parse(data));
        if (current.revision !== afterRevision) return { changed: true, annotations: current };
      }
    }
  } catch (failure) {
    if (signal?.aborted) throw signal.reason ?? failure;
    if (timeout.signal.aborted) return { changed: false, annotations: current };
    throw failure;
  } finally {
    clearTimeout(timer);
    await reader?.cancel().catch(() => undefined);
  }
}
