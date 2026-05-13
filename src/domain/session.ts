export type AgentKind = 'pi' | 'codex' | 'opencode' | 'claude';
export type AgentFilter = AgentKind | 'all';

export type SessionRecord = {
  id: string;
  cwd: string;
  updatedAt?: string;
  kind: AgentKind;
  projectName: string;
  title: string;
  source: string;
};

export type ArtifactPage = { file: string; group: string; slug: string };
export type ProjectGroup = { slug: string; title: string; cwd: string; pages: ArtifactPage[]; sessions: SessionRecord[] };
export type SessionIndex = { generatedAt: string; groups: ProjectGroup[] };

export const emptyIndex: SessionIndex = { generatedAt: '', groups: [] };
