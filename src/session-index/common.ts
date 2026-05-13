import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { projectName, toGroupSlug } from '../domain/path.ts';
import type { ProjectGroup, SessionRecord } from '../domain/session.ts';

export async function* walkJsonl(dir: string, recursive: boolean): AsyncGenerator<string> {
  if (!existsSync(dir)) return;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith('.jsonl')) yield full;
    else if (recursive && entry.isDirectory()) yield* walkJsonl(full, true);
  }
}

export function tryJson(line: string): unknown {
  try { return JSON.parse(line); } catch { return null; }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function groupSessions(sessions: SessionRecord[], pages: { file: string; group: string; slug: string }[]): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  for (const s of sessions) {
    const slug = toGroupSlug(s.cwd, os.homedir());
    const g = groups.get(slug) ?? { slug, title: slug, cwd: s.cwd, sessions: [], pages: [] };
    g.sessions.push(s);
    g.sessions.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    groups.set(slug, g);
  }
  for (const p of pages) {
    const g = groups.get(p.group) ?? { slug: p.group, title: p.group, cwd: p.group, sessions: [], pages: [] };
    g.pages.push(p);
    groups.set(p.group, g);
  }
  return [...groups.values()].sort((a, b) => (b.sessions[0]?.updatedAt ?? '').localeCompare(a.sessions[0]?.updatedAt ?? ''));
}

export function sessionBase(input: { id: string; cwd: string; title?: string; updatedAt?: string; source: string; kind: SessionRecord['kind'] }): SessionRecord {
  return { ...input, title: input.title ?? input.id, projectName: projectName(input.cwd, os.homedir()), updatedAt: input.updatedAt, kind: input.kind };
}
