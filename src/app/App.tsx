import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { artifactLoader, groupsWithPages } from '../artifacts/registry';
import type { ProjectGroup, SessionIndex } from '../domain/session';
import { emptyIndex } from '../domain/session';
import { demoSessionIndex } from '../demo-session';
import { Sidebar } from '../features/sidebar/Sidebar';
import { isOrphaned, type SidebarFilter } from '../features/sidebar/filter';

function useSessionIndex() {
  const [index, setIndex] = useState<SessionIndex>(emptyIndex);
  useEffect(() => { if (import.meta.env.VITE_AGENT_PAGES_DEMO === '1') { setIndex(demoSessionIndex); return; } fetch(`${import.meta.env.BASE_URL}session-index.json`).then(r => r.json()).then(setIndex).catch(() => setIndex(emptyIndex)); }, []);
  return index;
}

async function deleteArtifacts(files: string[]) {
  if (!files.length) return;
  const response = await fetch('/api/artifacts', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files }) });
  if (!response.ok) throw new Error(await response.text());
  location.reload();
}

function PageView({ file }: { file?: string }) {
  const Component = useMemo(() => { const loader = file ? artifactLoader(file) : null; return loader ? React.lazy(loader as never) : null; }, [file]);
  if (!Component) return <Landing />;
  return <Suspense fallback={<main className="empty"><span className="loader" />Loading page…</main>}><Component /></Suspense>;
}

function currentGroupSlug() { return location.hash.match(/group=([^&]+)/)?.[1] ?? '~'; }

function Landing() { return <main className="landing"><section className="landing-hero"><p className="eyebrow">agent pages 101</p><h1>Ask for an artifact. Mark it up. Send it back.</h1><p>A local canvas for agent-made options, diagrams, prototypes, and review notes.</p></section><section className="landing-grid"><article><b>1</b><h2>Ask your agent</h2><p>Tell your agent to use <code>agent-pages</code> when chat is too flat.</p></article><article><b>2</b><h2>Review the artifact</h2><p>Open the page from the project group on the left.</p></article><article><b>3</b><h2>Annotate with React Grab</h2><p>Use the white React Grab control to annotate, copy feedback, and paste it back.</p></article></section><section className="landing-panel"><div><h2>Example prompts</h2><ul><li><code>Use agent-pages to compare three options.</code></li><li><code>Create a flow diagram with risks.</code></li><li><code>Show this UI direction as an artifact.</code></li><li><code>Turn this review into a visual checklist.</code></li></ul></div><pre>{`# agent-side discovery
curl -s http://127.0.0.1:47983/api/agent-pages

# response includes the artifact directory
{
  "pagesDir": "/path/to/agent-pages/src/pages",
  "url": "http://127.0.0.1:47983"
}`}</pre></section></main>; }

export function App() {
  const groups = groupsWithPages(useSessionIndex());
  const [groupSlug, setGroupSlug] = useState(currentGroupSlug());
  const [pageFile, setPageFile] = useState<string | undefined>();
  const [filters, setFilters] = useState<Set<SidebarFilter>>(new Set());
  const [query, setQuery] = useState('');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => localStorage.getItem('agent-pages-theme') === 'light' ? 'light' : 'dark');
  const [sidebarHidden, setSidebarHidden] = useState(false);
  useEffect(() => { localStorage.setItem('agent-pages-theme', theme); }, [theme]);
  const group = groups.find(g => g.slug === groupSlug) ?? groups.find(g => g.pages.length > 0) ?? groups[0];
  const page = pageFile;
  function selectGroup(next: ProjectGroup) { setGroupSlug(next.slug); setPageFile(undefined); location.hash = `group=${next.slug}`; }
  function selectPage(next: ProjectGroup, file: string) { setGroupSlug(next.slug); setPageFile(file); location.hash = `group=${next.slug}&page=${file}`; }
  function showHome() { setPageFile(undefined); location.hash = ''; }
  function toggleFilter(filter: SidebarFilter) { setFilters(prev => { const next = new Set(prev); next.has(filter) ? next.delete(filter) : next.add(filter); return next; }); }
  function removeArtifact(file: string) { if (confirm(`Permanently delete artifact ${file}?`)) void deleteArtifacts([file]); }
  function removeOrphaned() { const files = groups.filter(isOrphaned).flatMap(g => g.pages.map(p => p.file)); if (confirm(`Permanently delete ${files.length} orphaned artifact${files.length === 1 ? '' : 's'}?`)) void deleteArtifacts(files); }
  return <div className={`app ${theme === 'light' ? 'theme-light' : 'theme-dark'} ${sidebarHidden ? 'sidebar-is-hidden' : ''}`}><Sidebar theme={theme} onToggleTheme={() => setTheme(t => t === 'light' ? 'dark' : 'light')} sidebarHidden={sidebarHidden} onToggleSidebar={() => setSidebarHidden(v => !v)} onHome={showHome} groups={groups} activeGroup={group} activePage={page} filters={filters} query={query} onToggleFilter={toggleFilter} onQueryChange={setQuery} onSelectGroup={selectGroup} onSelectPage={selectPage} onDeleteArtifact={removeArtifact} onDeleteOrphaned={removeOrphaned} /><PageView file={page} /></div>;
}
