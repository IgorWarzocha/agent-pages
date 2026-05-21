import type { ArtifactPage, ProjectGroup, SessionIndex } from '../domain/session';
import { prettyPath } from '../domain/path';

const realArtifactModules = import.meta.glob('../pages/*.tsx');
const demoArtifactModules = import.meta.glob('../demo-pages/*.tsx');

export const artifactModules = import.meta.env.VITE_AGENT_PAGES_DEMO === '1' ? demoArtifactModules : realArtifactModules;

export function artifactLoader(file: string) {
  return artifactModules[`../pages/${file}`] ?? artifactModules[`../demo-pages/${file}`];
}

export function pageFromPath(key: string): ArtifactPage {
  const file = key.replace('../pages/', '').replace('../demo-pages/', '');
  const match = file.match(/^(.+?)__(.+)\.tsx$/);
  return { file, group: match?.[1] ?? 'inbox', slug: match?.[2] ?? file.replace(/\.tsx$/, '') };
}

export function groupsWithPages(index: SessionIndex): ProjectGroup[] {
  const map = new Map<string, ProjectGroup>();
  for (const group of index.groups) map.set(group.slug, { ...group, pages: [] });
  for (const page of Object.keys(artifactModules).map(pageFromPath).sort((a, b) => a.file.localeCompare(b.file))) {
    const group = map.get(page.group) ?? { slug: page.group, title: prettyPath(page.group), cwd: page.group, sessions: [], pages: [] };
    group.pages.push(page);
    map.set(page.group, group);
  }
  return [...map.values()].sort((a, b) => Number(b.pages.length > 0) - Number(a.pages.length > 0) || (b.sessions[0]?.updatedAt ?? '').localeCompare(a.sessions[0]?.updatedAt ?? ''));
}
