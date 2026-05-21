import type { AgentKind } from '../../domain/session';
import type { SidebarFilter } from './filter';

const logoPath = (file: string) => `${import.meta.env.BASE_URL}agent-logos/${file}`;

export const agents: { id: AgentKind; label: string; logo?: string; color: string }[] = [
  { id: 'pi', label: 'Pi', logo: logoPath('pi.svg'), color: '#8abeb7' },
  { id: 'codex', label: 'Codex', logo: logoPath('codex.svg'), color: '#00d7ff' },
  { id: 'opencode', label: 'opencode', logo: logoPath('opencode.svg'), color: '#b5bd68' },
  { id: 'claude', label: 'Claude', logo: logoPath('claude.svg'), color: '#f0c674' },
];

export const filterOptions: { id: SidebarFilter; label: string; logo?: string; color: string }[] = [
  ...agents,
  { id: 'orphaned', label: 'Orphaned', color: '#cc6666' },
];
