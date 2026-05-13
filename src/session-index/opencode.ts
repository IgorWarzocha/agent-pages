import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SessionRecord } from '../domain/session.ts';
import os from 'node:os';
import { projectName } from '../domain/path.ts';

const execFileAsync = promisify(execFile);

type OpenCodeRow = { id?: string; directory?: string; title?: string; time_created?: number; time_updated?: number; project_name?: string; worktree?: string };

export async function collectOpenCodeSessions(db: string): Promise<SessionRecord[]> {
  if (!existsSync(db)) return [];
  const sql = `select s.id, s.directory, s.title, s.time_created, s.time_updated, p.name as project_name, p.worktree from session s left join project p on p.id=s.project_id order by s.time_updated desc;`;
  const { stdout } = await execFileAsync('sqlite3', ['-json', db, sql], { maxBuffer: 1024 * 1024 * 32 });
  const rows = JSON.parse(stdout || '[]') as OpenCodeRow[];
  return rows.map((row) => {
    const cwd = row.directory || row.worktree || 'unknown';
    return {
      id: row.id ?? `opencode-${row.time_updated ?? Date.now()}`,
      cwd,
      title: row.title || 'opencode session',
      projectName: row.project_name || projectName(cwd, os.homedir()),
      updatedAt: new Date(row.time_updated || row.time_created || Date.now()).toISOString(),
      source: db,
      kind: 'opencode',
    };
  });
}
