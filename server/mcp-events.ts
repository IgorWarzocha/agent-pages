import { z } from 'zod';
import type { AgentPagesClient } from './http-client.ts';

const eventSchema = z.object({ uri: z.string().max(1024).optional() });

/** One upstream feed per serving entry; disconnects are visible and reconnects invalidate discovery. */
export function watchMcpChanges(client: AgentPagesClient, notify: (uri?: string) => void | Promise<void>, disconnected: (previouslyConnected: boolean) => void) {
  const controller = new AbortController();
  const task = (async () => {
    let connectedBefore = false;
    let recovering = false;
    while (!controller.signal.aborted) {
      try {
        const response = await fetch(`${client.url}/api/changes`, { redirect: 'error', signal: controller.signal });
        if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error(`Change feed unavailable (${response.status})`);
        connectedBefore = true;
        // Also end listeners opened during the outage, before accepting the
        // new stream as authoritative. They may already have missed changes.
        if (recovering) disconnected(true);
        recovering = false;
        const reader = response.body.getReader();
        try {
          const decoder = new TextDecoder();
          let buffer = '';
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) throw new Error('Change feed disconnected');
            buffer += decoder.decode(chunk.value, { stream: true });
            if (buffer.length > 8192) throw new Error('Change feed frame exceeds limit');
            let end: number;
            while ((end = buffer.indexOf('\n\n')) >= 0) {
              const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
              const data = frame.split('\n').find(line => line.startsWith('data:'));
              if (data) await notify(eventSchema.parse(JSON.parse(data.slice(5))).uri);
            }
          }
        } finally { await reader.cancel().catch(() => undefined); }
      } catch (error) {
        if (controller.signal.aborted) break;
        console.error('MCP change feed:', error instanceof Error ? error.message : error);
        // A broken upstream may have lost updates. End downstream listeners
        // rather than leaving a successful subscription silently stale.
        disconnected(connectedBefore);
        recovering = true;
        if (controller.signal.aborted) break;
        await new Promise<void>(resolve => {
          const done = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', done); resolve(); };
          const timer = setTimeout(done, 2000);
          controller.signal.addEventListener('abort', done, { once: true });
        });
      }
    }
  })();
  return async () => { controller.abort(); await task; };
}
