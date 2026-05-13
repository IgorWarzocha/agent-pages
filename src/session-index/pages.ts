import { mkdir, readdir } from 'node:fs/promises';
import type { ArtifactPage } from '../domain/session.ts';

export async function collectPages(pagesDir: string): Promise<ArtifactPage[]> {
  await mkdir(pagesDir, { recursive: true });
  const files = (await readdir(pagesDir)).filter(f => f.endsWith('.tsx')).sort();
  return files.map(file => {
    const m = file.match(/^(.+?)__(.+)\.tsx$/);
    return { file, group: m?.[1] ?? 'inbox', slug: m?.[2]?.replace(/\.tsx$/, '') ?? file.replace(/\.tsx$/, '') };
  });
}
