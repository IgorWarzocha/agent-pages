import { Moon, PanelLeftClose, PanelLeftOpen, Sun } from 'lucide-react';
import { useState } from 'react';
import type { ProjectGroup } from '../../domain/session';
import { displayPath, projectName } from '../../domain/path';
import { agents, filterOptions } from './agents';
import { currentAgentKind, isOrphaned, matchesFilters, matchesSearch, type SidebarFilter } from './filter';

type Props = {
  groups: ProjectGroup[];
  activeGroup?: ProjectGroup;
  activePage?: string;
  filters: Set<SidebarFilter>;
  query: string;
  onToggleFilter: (filter: SidebarFilter) => void;
  onQueryChange: (query: string) => void;
  onSelectGroup: (group: ProjectGroup) => void;
  onSelectPage: (group: ProjectGroup, file: string) => void;
  onDeleteArtifact: (file: string) => void;
  onDeleteOrphaned: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onHome: () => void;
  sidebarHidden: boolean;
  onToggleSidebar: () => void;
};

function groupAgent(group: ProjectGroup) {
  return agents.find(a => a.id === currentAgentKind(group));
}

function filterLabel(filters: Set<SidebarFilter>) {
  if (filters.size === 0) return 'All agents';
  return filterOptions.filter(option => filters.has(option.id)).map(option => option.label).join(', ');
}

function GroupTitle({ group, collapsed }: { group: ProjectGroup; collapsed: boolean }) {
  const project = group.sessions[0]?.projectName || projectName(group.cwd);
  return <div className="group-title"><div className="project-line"><span className="chevron" aria-hidden>{collapsed ? '›' : '⌄'}</span><strong>{project}</strong></div><span>{displayPath(group.cwd, group.slug)}</span></div>;
}

function ProviderIcon({ logo, label }: { logo?: string; label: string; color?: string }) {
  return <span className="provider-icon" title={label}>{logo ? <span className="provider-glyph" style={{ maskImage: `url(${logo})`, WebkitMaskImage: `url(${logo})` }} /> : <span className="provider-letter">?</span>}</span>;
}

function AgentMarks({ group }: { group: ProjectGroup }) {
  if (isOrphaned(group)) return <div className="agent-marks"><ProviderIcon label="Orphaned artifact" color="#cc6666" /></div>;
  const agent = groupAgent(group);
  return <div className="agent-marks">{agent && <ProviderIcon logo={agent.logo} label={agent.label} color={agent.color} />}</div>;
}

export function Sidebar(props: Props) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const pageGroups = props.groups.filter(g => g.pages.length > 0 && matchesFilters(g, props.filters) && matchesSearch(g, props.query));
  const orphanedFiles = props.groups.filter(isOrphaned).flatMap(g => g.pages.map(p => p.file));
  const toggleGroup = (slug: string) => setCollapsedGroups(prev => { const next = new Set(prev); next.has(slug) ? next.delete(slug) : next.add(slug); return next; });
  return <aside className={`sidebar ${props.sidebarHidden ? 'sidebar-hidden' : ''}`}>
    <div className="sidebar-head"><button className="brand" type="button" onClick={props.onHome}><span>agent</span><b>pages</b></button><div className="sidebar-controls"><button className="theme-toggle" type="button" aria-label="Toggle light mode" aria-pressed={props.theme === 'light'} onClick={props.onToggleTheme}><Moon className="theme-icon theme-icon-dark" size={12} strokeWidth={2.4} /><Sun className="theme-icon theme-icon-light" size={12} strokeWidth={2.4} /><span /></button><button className="icon-toggle" type="button" aria-label={props.sidebarHidden ? 'Show sidebar' : 'Hide sidebar'} aria-pressed={props.sidebarHidden} onClick={props.onToggleSidebar}>{props.sidebarHidden ? <PanelLeftOpen size={14} strokeWidth={2.3} /> : <PanelLeftClose size={14} strokeWidth={2.3} />}</button></div></div>
    <details className="agent-select">
      <summary><span>{filterLabel(props.filters)}</span><b>⌄</b></summary>
      <div className="agent-menu">{filterOptions.map(option => <label key={option.id}><input type="checkbox" checked={props.filters.has(option.id)} onChange={() => props.onToggleFilter(option.id)} /><ProviderIcon logo={option.logo} label={option.label} color={option.color} />{option.label}</label>)}{orphanedFiles.length > 0 && <button className="danger-action menu-danger" onClick={props.onDeleteOrphaned}>Remove orphaned artifacts</button>}</div>
    </details>
    <input className="session-search" value={props.query} onChange={event => props.onQueryChange(event.target.value)} placeholder="Search sessions or artifacts…" aria-label="Search sessions or artifacts" />
    <nav aria-label="Dashboard pages">{pageGroups.map(g => { const collapsed = collapsedGroups.has(g.slug); return <section key={g.slug} className={`group-card ${g.slug === props.activeGroup?.slug ? 'active' : ''} ${collapsed ? 'collapsed' : ''}`}><button className="group-top" aria-expanded={!collapsed} onClick={() => { props.onSelectGroup(g); toggleGroup(g.slug); }}><GroupTitle group={g} collapsed={collapsed} /><AgentMarks group={g} /></button>{!collapsed && <div className="page-list">{g.pages.map(p => <button className={`artifact-row ${p.file === props.activePage ? 'selected' : ''}`} key={p.file} onClick={(e)=>{e.stopPropagation();props.onSelectPage(g, p.file)}}><span>{p.slug}</span><span className="artifact-actions" onClick={(e)=>e.stopPropagation()}><AgentMarks group={g} /><span className="delete-artifact" role="button" tabIndex={0} title={`Permanently delete ${p.file}`} onClick={()=>props.onDeleteArtifact(p.file)} onKeyDown={(e)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();props.onDeleteArtifact(p.file)}}}>×</span></span></button>)}</div>}</section>})}</nav>
  </aside>;
}
