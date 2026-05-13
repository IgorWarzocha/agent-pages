import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { SessionRecord } from '../domain/session.ts';
import { sessionBase, walkJsonl } from './common.ts';
import { isRecord, tryJson } from './common.ts';

function cwdFromProjectDir(projectDir: string) {
  const name = path.basename(projectDir);
  if (!name.startsWith('-')) return 'unknown';
  return '/' + name.slice(1).replaceAll('-', '/');
}

export async function collectClaudeSessions(projectsDir: string): Promise<SessionRecord[]> {
  const sessions = new Map<string, SessionRecord>();
  for await (const file of walkJsonl(projectsDir, true)) {
    if (file.includes(`${path.sep}subagents${path.sep}`)) continue;
    const fileStat = await stat(file);
    const fallbackCwd = cwdFromProjectDir(path.dirname(file));
    const fallbackId = path.basename(file, '.jsonl');
    let id = fallbackId;
    let cwd = fallbackCwd;
    let title = fallbackId;
    let updatedAt = fileStat.mtime.toISOString();
    const text = await import('node:fs/promises').then(fs => fs.readFile(file, 'utf8')).catch(() => '');
    for (const line of text.split('\n').filter(Boolean).slice(0, 100)) {
      const data = tryJson(line);
      if (!isRecord(data)) continue;
      if (typeof data.sessionId === 'string') id = data.sessionId;
      if (typeof data.cwd === 'string') cwd = data.cwd;
      if (typeof data.timestamp === 'string') updatedAt = data.timestamp;
      const message = isRecord(data.message) ? data.message : undefined;
      if (message && typeof message.content === 'string' && !message.content.startsWith('<')) title = message.content.slice(0, 90);
      if (id && cwd !== 'unknown' && title !== fallbackId) break;
    }
    const existing = sessions.get(id);
    const next = sessionBase({ id, cwd, title, updatedAt, source: file, kind: 'claude' });
    if (!existing || (next.updatedAt ?? '').localeCompare(existing.updatedAt ?? '') > 0) sessions.set(id, next);
  }
  return [...sessions.values()];
}
