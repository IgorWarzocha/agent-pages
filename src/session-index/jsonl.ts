import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { AgentKind, SessionRecord } from '../domain/session.ts';
import { isRecord, sessionBase, tryJson } from './common.ts';

function payload(value: Record<string, unknown>) { return isRecord(value.payload) ? value.payload : undefined; }

function findCwd(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const p = payload(value);
  if (typeof value.cwd === 'string') return value.cwd;
  if (typeof p?.cwd === 'string') return p.cwd;
  if (Array.isArray(p?.content)) {
    for (const item of p.content) {
      if (!isRecord(item) || typeof item.text !== 'string') continue;
      const match = item.text.match(/<cwd>(.*?)<\/cwd>/) ?? item.text.match(/cwd[=:]\s*([^\s<]+)/i);
      if (match?.[1]) return match[1];
    }
  }
  return undefined;
}

export async function readJsonlSession(file: string, kind: AgentKind): Promise<SessionRecord> {
  const text = await readFile(file, 'utf8').catch(() => '');
  const lines = text.split('\n').filter(Boolean);
  const fileStat = await stat(file);
  const fallbackId = path.basename(file, '.jsonl');
  let id: string | undefined;
  let cwd: string | undefined;
  let timestamp: string | undefined;

  for (const line of lines.slice(0, 80)) {
    const data = tryJson(line);
    if (!isRecord(data)) continue;
    const p = payload(data);
    id ??= typeof data.id === 'string' ? data.id : typeof p?.id === 'string' ? p.id : typeof data.session_id === 'string' ? data.session_id : undefined;
    timestamp ??= typeof data.timestamp === 'string' ? data.timestamp : typeof p?.timestamp === 'string' ? p.timestamp : undefined;
    cwd ??= findCwd(data);
    if (id && cwd) break;
  }

  if (!cwd && kind === 'codex') cwd = text.match(/<environment_context>[\s\S]{0,8000}?<cwd>(.*?)<\/cwd>/)?.[1];
  if (!cwd && kind === 'pi') {
    const first = tryJson(lines[0]);
    cwd = isRecord(first) && typeof first.cwd === 'string' ? first.cwd : undefined;
  }

  return sessionBase({ id: id ?? fallbackId, cwd: cwd ?? 'unknown', title: fallbackId, updatedAt: (timestamp ? new Date(timestamp) : fileStat.mtime).toISOString(), source: file, kind });
}
