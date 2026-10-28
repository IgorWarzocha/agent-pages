import { randomUUID } from 'node:crypto';
import { lstat, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { z } from 'zod';
import { json, readJson } from './http.ts';
import { BoardError } from './whiteboards.ts';

export const artifactFileSchema = z.string().min(1).max(240).regex(/^[^/\\\x00]+\.tsx$/).refine(file => file !== '..' && !file.startsWith('.'), 'Invalid artifact filename');
export const artifactWriteSchema = z.object({ file: artifactFileSchema, content: z.string().max(2 * 1024 * 1024) }).strict();

async function artifactPath(pagesDir: string, file: string) {
  const resolved = path.join(pagesDir, artifactFileSchema.parse(file));
  try { if ((await lstat(resolved)).isSymbolicLink()) throw new BoardError(400, 'Artifact symlinks are forbidden'); }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  return resolved;
}

export async function artifactsApi(req: IncomingMessage, res: ServerResponse, url: URL, pagesDir: string) {
  if (req.method === 'GET') {
    const file = url.searchParams.get('file');
    if (file) return json(res, 200, { file, content: await readFile(await artifactPath(pagesDir, file), 'utf8') });
    return json(res, 200, (await readdir(pagesDir)).filter(file => artifactFileSchema.safeParse(file).success).sort());
  }
  if (req.method === 'PUT') {
    const { file, content } = artifactWriteSchema.parse(await readJson(req, 2 * 1024 * 1024));
    const target = await artifactPath(pagesDir, file);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, content, { flag: 'wx' }); await rename(temporary, target); }
    finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    return json(res, 200, { file });
  }
  if (req.method === 'DELETE') {
    const payload = z.object({ file: artifactFileSchema.optional(), files: z.array(artifactFileSchema).min(1).max(100).optional() }).strict().parse(await readJson(req, 32 * 1024));
    const files = payload.files ?? (payload.file ? [payload.file] : []);
    if (!files.length) throw new BoardError(400, 'No files provided');
    const resolved = await Promise.all(files.map(file => artifactPath(pagesDir, file)));
    await Promise.all(resolved.map(file => unlink(file)));
    return json(res, 200, { ok: true, deleted: files });
  }
  throw new BoardError(405, 'Method not allowed');
}
