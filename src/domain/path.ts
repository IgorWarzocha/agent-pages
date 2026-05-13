export type FilePath = string & { readonly __brand: 'FilePath' };
export type GroupSlug = string & { readonly __brand: 'GroupSlug' };

function withoutTrailingSlash(value: string) {
  return value.replace(/[\\/]+$/, '');
}

export function collapseHome(filePath: string, homeDir = '') {
  const home = withoutTrailingSlash(homeDir);
  const current = withoutTrailingSlash(filePath);
  if (!home) return filePath;
  if (current === home) return '~';
  return current.startsWith(home + '/') || current.startsWith(home + '\\') ? `~${current.slice(home.length).replaceAll('\\', '/')}` : filePath;
}

export function toGroupSlug(cwd = 'unknown', homeDir = ''): GroupSlug {
  return (collapseHome(cwd, homeDir).replace(/[^a-zA-Z0-9._~-]+/g, '-').replace(/^-|-$/g, '') || 'unknown') as GroupSlug;
}

export function prettyPath(slug: string) {
  if (slug === '~') return '~/';
  if (slug.startsWith('~-')) return '~/' + slug.slice(2).replaceAll('-', '/');
  return slug.replaceAll('-', '/');
}

export function displayPath(cwd: string, slug: string, homeDir = '') {
  const collapsed = collapseHome(cwd, homeDir);
  return collapsed !== cwd ? collapsed.replace(/^~$/, '~/') : prettyPath(slug);
}

export function projectName(cwd: string, homeDir = '') {
  if (!cwd || cwd === 'unknown') return 'unknown';
  const home = withoutTrailingSlash(homeDir);
  const current = withoutTrailingSlash(cwd);
  if (home && current === home) return home.split(/[\\/]/).filter(Boolean).at(-1) || 'home';
  return current.split(/[\\/]/).filter(Boolean).at(-1) || cwd;
}
