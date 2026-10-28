import { lstat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { MAX_FEEDBACK_BYTES } from '../src/features/feedback/contract.ts';
import { artifactFileSchema } from './artifacts-api.ts';
import { FeedbackConflictError, type FeedbackStore } from './feedback.ts';
import { json, readJson } from './http.ts';
import { BoardError } from './whiteboards.ts';

export async function feedbackApi(req: IncomingMessage, res: ServerResponse, url: URL, pagesDir: string, store: FeedbackStore) {
  if (req.method !== 'GET' && req.method !== 'PATCH') throw new BoardError(405, 'Method not allowed');
  const file = artifactFileSchema.parse(url.searchParams.get('file'));
  try {
    const stat = await lstat(path.join(pagesDir, file));
    if (stat.isSymbolicLink() || !stat.isFile()) throw new BoardError(400, 'Feedback requires a regular artifact file, not a symlink');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') throw new BoardError(404, 'Artifact not found');
    throw error;
  }
  if (req.method === 'GET') return json(res, 200, await store.get(file));
  try {
    return json(res, 200, await store.update(file, await readJson(req, MAX_FEEDBACK_BYTES)));
  } catch (error) {
    if (error instanceof FeedbackConflictError) return json(res, 409, { error: error.message, feedback: error.feedback });
    throw error;
  }
}
