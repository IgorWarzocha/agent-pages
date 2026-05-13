import { existsSync } from 'node:fs';
import { readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SessionIndex, SessionRecord } from '../domain/session.ts';
import { groupSessions, sessionBase, walkJsonl } from './common.ts';
import { readJsonlSession } from './jsonl.ts';
import { collectOpenCodeSessions } from './opencode.ts';
import { collectClaudeSessions } from './claude.ts';
import { collectPages } from './pages.ts';

export type IndexConfig = { piDir: string; codexDir: string; opencodeDb: string; claudeProjectsDir: string; pagesDir: string; out: string };

async function collectPiDirectorySessions(piDir: string): Promise<SessionRecord[]> {
  if (!existsSync(piDir)) return [];
  const sessions: SessionRecord[] = [];
  for (const entry of await readdir(piDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(piDir, entry.name);
    const s = await stat(full).catch(() => null);
    const decoded = entry.name.replace(/^--|--$/g, '').replaceAll('-', '/');
    const cwd = decoded.startsWith('home/') || decoded.startsWith('Users/') ? `/${decoded}` : decoded;
    sessions.push(sessionBase({ id: entry.name, cwd, title: entry.name, updatedAt: s?.mtime?.toISOString(), source: full, kind: 'pi' }));
  }
  return sessions;
}

export async function collectSessions(config: IndexConfig): Promise<SessionRecord[]> {
  const sessions: SessionRecord[] = [];
  for await (const file of walkJsonl(config.piDir, true)) sessions.push(await readJsonlSession(file, 'pi'));
  sessions.push(...await collectPiDirectorySessions(config.piDir));
  for await (const file of walkJsonl(config.codexDir, true)) sessions.push(await readJsonlSession(file, 'codex'));
  sessions.push(...await collectOpenCodeSessions(config.opencodeDb));
  sessions.push(...await collectClaudeSessions(config.claudeProjectsDir));
  return sessions;
}

export async function buildIndex(config: IndexConfig): Promise<SessionIndex> {
  const sessions = await collectSessions(config);
  const pages = await collectPages(config.pagesDir);
  return { generatedAt: new Date().toISOString(), groups: groupSessions(sessions, pages) };
}

export async function writeIndex(config: IndexConfig): Promise<SessionIndex> {
  const index = await buildIndex(config);
  await writeFile(config.out, JSON.stringify(index, null, 2));
  return index;
}
