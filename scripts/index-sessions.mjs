import path from 'node:path';
import os from 'node:os';
import { writeIndex } from '../src/session-index/indexer.ts';

const root = path.resolve(import.meta.dirname, '..');
const config = {
  piDir: path.join(os.homedir(), '.pi', 'agent', 'sessions'),
  codexDir: path.join(os.homedir(), '.codex', 'sessions'),
  opencodeDb: path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db'),
  claudeProjectsDir: path.join(os.homedir(), '.claude', 'projects'),
  pagesDir: path.join(root, 'src/pages'),
  out: path.join(root, 'public/session-index.json'),
};

const index = await writeIndex(config);
const sessions = index.groups.flatMap(g => g.sessions);
const counts = sessions.reduce((acc, s) => (acc[s.kind] = (acc[s.kind] ?? 0) + 1, acc), {});
console.log(`indexed ${sessions.length} sessions (${Object.entries(counts).map(([k,v]) => `${k}: ${v}`).join(', ')}) and wrote ${config.out}`);
