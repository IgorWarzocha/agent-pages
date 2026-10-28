import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { artifactLoader, groupsWithPages } from '../artifacts/registry';
import type { ProjectGroup, SessionIndex } from '../domain/session';
import { emptyIndex } from '../domain/session';
import { demoSessionIndex } from '../demo-session';
import { Sidebar } from '../features/sidebar/Sidebar';
import { isOrphaned, type SidebarFilter } from '../features/sidebar/filter';
import { Whiteboards } from '../features/whiteboard/Whiteboards';
import { AnnotationSurface } from '../features/annotations/AnnotationSurface';

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
  if (!Component || !file) return <Landing />;
  const content = <Suspense fallback={<main className="page-loading"><span className="loader" />Loading page…</main>}><Component /></Suspense>;
  return import.meta.env.VITE_AGENT_PAGES_DEMO === '1' ? content : <AnnotationSurface key={file} file={file}>{content}</AnnotationSurface>;
}

function currentRoute() {
  const hash = new URLSearchParams(location.hash.slice(1));
  return { hash: location.hash, group: hash.get('group') ?? '~', page: hash.get('page') ?? undefined, whiteboards: hash.get('view') === 'whiteboards', board: hash.get('board') ?? undefined };
}

function Landing() { return <main className="landing"><section className="landing-hero"><h1>Ask for an artifact. Mark it up. Send it back.</h1><p>A local canvas for agent-made options, diagrams, prototypes, and review notes.</p><p className="install-link"><span>Installation instructions for agents:</span> <a href="https://github.com/IgorWarzocha/agent-pages/blob/main/INSTALL.md" target="_blank" rel="noreferrer">github.com/IgorWarzocha/agent-pages/blob/main/INSTALL.md</a></p></section><section className="landing-grid"><article><b>1</b><h2>Ask your agent</h2><p>Tell your agent to use <code>agent-pages</code> when chat is too flat.</p></article><article><b>2</b><h2>Review the artifact</h2><p>Open the page from the project group on the left.</p></article><article><b>3</b><h2>Mark changes in place</h2><p>Hold Ctrl and click or drag to add notes. Send a batch for your agent to read.</p></article></section><section className="landing-panel"><div><h2>Example prompts</h2><ul><li><code>Use agent-pages to compare three options.</code></li><li><code>Create a flow diagram with risks.</code></li><li><code>Show this UI direction as an artifact.</code></li><li><code>Turn this review into a visual checklist.</code></li></ul></div><pre>{`# agent-side discovery
curl -s http://127.0.0.1:47983/api/agent-pages

# response includes the artifact directory
{
  "pagesDir": "/path/to/agent-pages/src/pages",
  "url": "http://127.0.0.1:47983"
}`}</pre></section></main>; }

export function App() {
  const groups = groupsWithPages(useSessionIndex());
  const [route, setRoute] = useState(currentRoute);
  const [unsavedBoard, setUnsavedBoard] = useState(false);
  const [filters, setFilters] = useState<Set<SidebarFilter>>(new Set());
  const [query, setQuery] = useState('');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => localStorage.getItem('agent-pages-theme') === 'light' ? 'light' : 'dark');
  const [sidebarHidden, setSidebarHidden] = useState(false);
  useEffect(() => { localStorage.setItem('agent-pages-theme', theme); }, [theme]);
  useEffect(() => {
    function changed() {
      const feedbackNavigation = new Event('agent-pages-before-navigate', { cancelable: true });
      window.dispatchEvent(feedbackNavigation);
      if ((unsavedBoard || feedbackNavigation.defaultPrevented) && !confirm('This page has unsaved changes. Leave it?')) {
        history.replaceState(null, '', location.pathname + location.search + route.hash);
        return;
      }
      setUnsavedBoard(false);
      setRoute(currentRoute());
    }
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, [route.hash, unsavedBoard]);
  const group = groups.find(g => g.slug === route.group) ?? groups.find(g => g.pages.length > 0) ?? groups[0];
  const page = route.page;
  function selectGroup(next: ProjectGroup) { location.hash = new URLSearchParams({ group: next.slug }).toString(); }
  function selectPage(next: ProjectGroup, file: string) { location.hash = new URLSearchParams({ group: next.slug, page: file }).toString(); }
  function showHome() { location.hash = ''; }
  function openWhiteboards(id?: string) { location.hash = new URLSearchParams({ view: 'whiteboards', ...(id ? { board: id } : {}) }).toString(); }
  function toggleFilter(filter: SidebarFilter) { setFilters(prev => { const next = new Set(prev); next.has(filter) ? next.delete(filter) : next.add(filter); return next; }); }
  function removeArtifact(file: string) { if (confirm(`Permanently delete artifact ${file}?`)) void deleteArtifacts([file]); }
  function removeOrphaned() { const files = groups.filter(isOrphaned).flatMap(g => g.pages.map(p => p.file)); if (confirm(`Permanently delete ${files.length} orphaned artifact${files.length === 1 ? '' : 's'}?`)) void deleteArtifacts(files); }
  return <div className={`app ${theme === 'light' ? 'theme-light' : 'theme-dark'} ${sidebarHidden ? 'sidebar-is-hidden' : ''} ${route.whiteboards ? 'view-whiteboards' : ''}`}><Sidebar theme={theme} onToggleTheme={() => setTheme(t => t === 'light' ? 'dark' : 'light')} sidebarHidden={sidebarHidden} onToggleSidebar={() => setSidebarHidden(v => !v)} onHome={showHome} groups={groups} activeGroup={group} activePage={page} filters={filters} query={query} onToggleFilter={toggleFilter} onQueryChange={setQuery} onSelectGroup={selectGroup} onSelectPage={selectPage} onDeleteArtifact={removeArtifact} onDeleteOrphaned={removeOrphaned} />{route.whiteboards ? <Whiteboards id={route.board} theme={theme} onOpen={openWhiteboards} onUnsavedChange={setUnsavedBoard} /> : <PageView file={page} />}</div>;
}
