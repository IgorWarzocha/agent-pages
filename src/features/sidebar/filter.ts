import type { AgentKind, ProjectGroup } from '../../domain/session';

export type SidebarFilter = AgentKind | 'orphaned';

export function isOrphaned(group: ProjectGroup) {
  return group.pages.length > 0 && group.sessions.length === 0;
}

export function matchesFilters(group: ProjectGroup, filters: Set<SidebarFilter>) {
  if (filters.size === 0) return true;
  return [...filters].some(filter => filter === 'orphaned' ? isOrphaned(group) : group.sessions.some(s => s.kind === filter));
}

export function matchesSearch(group: ProjectGroup, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    group.cwd, group.slug, group.title,
    ...group.pages.flatMap(p => [p.slug, p.file]),
    ...group.sessions.flatMap(s => [s.title, s.projectName, s.cwd, s.id]),
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(q);
}
