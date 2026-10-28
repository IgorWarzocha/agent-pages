import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { registerMcpResources } from './mcp-resources.ts';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { boardIdSchema, boardMetadataSchema, createBoardSchema, updateBoardSchema } from '../src/features/whiteboard/contract.ts';
import { artifactFileSchema, artifactWriteSchema } from './artifacts-api.ts';
import { AgentPagesClient, sceneMetadata } from './http-client.ts';
import { artifactFeedbackSchema } from '../src/features/feedback/contract.ts';
import { annotationDocumentSchema, clearAnnotationsSchema } from '../src/features/annotations/contract.ts';
import { waitForAnnotations } from './annotation-client.ts';

const MAX_TOOL_TEXT = 100_000;
const text = (value: unknown): CallToolResult => {
  const output = JSON.stringify(value);
  if (output.length > MAX_TOOL_TEXT) return { isError: true, content: [{ type: 'text', text: 'Result exceeds 100,000 characters. Use tool pagination where available, or the HTTP API for oversized individual elements or metadata.' }] };
  return { content: [{ type: 'text', text: output }] };
};
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const checkpointRead = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const skillEntry = new URL('../.agents/agent-pages/SKILL.md', import.meta.url);
const skillReferences = {
  artifacts: new URL('../.agents/agent-pages/references/artifacts.md', import.meta.url),
  whiteboards: new URL('../.agents/agent-pages/references/whiteboards.md', import.meta.url),
};

export function createMcpServer(client = new AgentPagesClient(), era: 'legacy' | 'modern' = 'modern') {
  const server = new McpServer({ name: 'agent-pages', version: '1.0.0' }, { capabilities: { resources: { subscribe: era === 'modern', listChanged: era === 'modern' } } });
  server.registerTool('get_skill', {
    description: 'Read before creating artifacts or collaborating on whiteboards',
    inputSchema: { reference: z.enum(['artifacts', 'whiteboards']).optional() }, annotations: readOnly,
  }, async ({ reference }, extra) => ({ content: [{ type: 'text', text: await readFile(reference ? skillReferences[reference] : skillEntry, { encoding: 'utf8', signal: extra.mcpReq.signal }) }] }));
  server.registerTool('list_whiteboards', { inputSchema: {}, annotations: readOnly }, async (_args, extra) => text(await client.list(extra.mcpReq.signal)));
  server.registerTool('create_whiteboard', { inputSchema: createBoardSchema, annotations: { destructiveHint: false, openWorldHint: false } }, async ({ title }, extra) => text(await client.create(title, extra.mcpReq.signal)));
  server.registerTool('get_whiteboard', {
    description: 'Read + durable checkpointId; paginate using that ID and nextOffset; no attachment data',
    inputSchema: { id: boardIdSchema, checkpointId: boardIdSchema.optional(), offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(10_000).default(10_000) }, annotations: checkpointRead,
  }, async ({ id, checkpointId, offset, limit }, extra) => {
    if (offset > 0 && !checkpointId) throw new Error('Pagination requires the checkpointId returned by the first page');
    const scene = sceneMetadata(await client.read(id, checkpointId, extra.mcpReq.signal));
    let count = Math.min(limit, Math.max(0, scene.elements.length - offset));
    const page = () => ({ ...scene, elements: scene.elements.slice(offset, offset + count), totalElements: scene.elements.length, nextOffset: offset + count < scene.elements.length ? offset + count : null });
    while (count > 1 && JSON.stringify(page()).length > MAX_TOOL_TEXT) count = Math.max(1, Math.floor(count / 2));
    return text(page());
  });
  server.registerTool('update_whiteboard', {
    description: 'Durable batch + checkpointId; on 409, read current scene and reconcile before retrying',
    inputSchema: updateBoardSchema.omit({ checkpoint: true }).extend({
      id: boardIdSchema,
      elements: updateBoardSchema.shape.elements.describe('Complete replacement; preserve untouched elements and tombstones; increment version + change versionNonce on edits'),
      files: updateBoardSchema.shape.files.optional().describe('Omit to preserve attachments; supply complete file data to replace'),
    }),
    annotations: { destructiveHint: true, openWorldHint: false },
  }, async ({ id, ...update }, extra) => {
    const files = update.files ?? (await client.get(id, extra.mcpReq.signal)).files;
    const scene = sceneMetadata(await client.update(id, { ...update, files, checkpoint: true }, extra.mcpReq.signal));
    return text(JSON.stringify(scene).length <= MAX_TOOL_TEXT ? scene : { ...boardMetadataSchema.parse(scene), durableRevision: scene.durableRevision, checkpointId: scene.checkpointId, committed: true, totalElements: scene.elements.length, detail: 'Scene omitted due to size. Use get_whiteboard to read element pages.' });
  });
  server.registerTool('checkpoint_whiteboard', {
    description: 'Save a baseline without editing; retain its id for later changes',
    inputSchema: { id: boardIdSchema, baseRevision: updateBoardSchema.shape.baseRevision },
    annotations: { destructiveHint: false, openWorldHint: false },
  }, async ({ id, baseRevision }, extra) => text(await client.checkpoint(id, baseRevision, extra.mcpReq.signal)));
  server.registerTool('get_whiteboard_changes', {
    description: 'Changes since checkpointId + durable nextCheckpointId; paginate with it as toCheckpointId',
    inputSchema: {
      id: boardIdSchema, checkpointId: boardIdSchema,
      toCheckpointId: boardIdSchema.optional(),
      offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(10_000).default(10_000),
    }, annotations: checkpointRead,
  }, async ({ id, checkpointId, toCheckpointId, offset, limit }, extra) => {
    if (offset > 0 && !toCheckpointId) throw new Error('Pagination requires toCheckpointId from the first page\'s nextCheckpointId');
    const diff = await client.readChanges(id, checkpointId, toCheckpointId, extra.mcpReq.signal);
    const changes = [
      ...diff.added.map(element => ({ kind: 'added' as const, element })),
      ...diff.updated.map(element => ({ kind: 'updated' as const, element })),
      ...diff.deletedIds.map(id => ({ kind: 'deleted' as const, id })),
    ];
    const { added: _added, updated: _updated, deletedIds: _deleted, ...metadata } = diff;
    let count = Math.min(limit, Math.max(0, changes.length - offset));
    const page = () => ({ ...metadata, changes: changes.slice(offset, offset + count), totalChanges: changes.length, nextOffset: offset + count < changes.length ? offset + count : null });
    while (count > 1 && JSON.stringify(page()).length > MAX_TOOL_TEXT) count = Math.max(1, Math.floor(count / 2));
    return text(page());
  });
  server.registerTool('wait_for_whiteboard_change', {
    description: 'Poll without writes; checkpoint the returned scene',
    inputSchema: {
      id: boardIdSchema, afterRevision: z.number().int().nonnegative(),
      timeoutMs: z.number().int().min(0).max(30_000).default(25_000),
    }, annotations: checkpointRead,
  }, async ({ id, afterRevision, timeoutMs }, extra) => {
    await client.wait(id, afterRevision, timeoutMs, extra.mcpReq.signal);
    const scene = await client.read(id, undefined, extra.mcpReq.signal);
    return text({ changed: scene.revision !== afterRevision, scene: sceneMetadata(scene) });
  });
  server.registerTool('read_whiteboard_preview', {
    description: 'Full canvas, current revision; open board in browser to generate a missing preview',
    inputSchema: { id: boardIdSchema }, annotations: readOnly,
  }, async ({ id }, extra) => {
    const preview = await client.getPreview(id, extra.mcpReq.signal);
    return { content: [{ type: 'text', text: JSON.stringify({ revision: preview.revision }) }, { type: 'image', mimeType: 'image/png', data: preview.dataURL.slice('data:image/png;base64,'.length) }] };
  });
  server.registerTool('read_whiteboard_image', {
    description: 'Original attachment, not canvas; PNG/JPEG/GIF/WebP',
    inputSchema: { id: boardIdSchema, fileId: z.string().min(1).max(256) }, annotations: readOnly,
  }, async ({ id, fileId }, extra) => {
    const scene = await client.get(id, extra.mcpReq.signal);
    const file = Object.hasOwn(scene.files, fileId) ? scene.files[fileId] : undefined;
    if (!file) throw new Error('Image file not found in this whiteboard');
    const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(file.dataURL);
    if (!match || match[1] !== file.mimeType || !match[2] || match[2].length % 4 !== 0) throw new Error('Use a PNG, JPEG, GIF or WebP base64 image attachment');
    return { content: [{ type: 'image', mimeType: match[1], data: match[2] }] };
  });
  server.registerTool('get_app_info', { inputSchema: {}, annotations: readOnly }, async (_args, extra) => text(await client.request('/api/agent-pages', 'GET', undefined, extra.mcpReq.signal)));
  server.registerTool('list_artifacts', { inputSchema: {}, annotations: readOnly }, async (_args, extra) => text(await client.request('/api/artifacts', 'GET', undefined, extra.mcpReq.signal)));
  server.registerTool('get_artifact_feedback', {
    description: 'Saved user choices and comments, not page source; drafts are not submitted responses',
    inputSchema: { file: artifactFileSchema }, annotations: readOnly,
  }, async ({ file }, extra) => text(artifactFeedbackSchema.parse(await client.request(`/api/artifact-feedback?file=${encodeURIComponent(file)}`, 'GET', undefined, extra.mcpReq.signal))));
  server.registerTool('get_page_annotations', {
    description: 'Sent visual notes + React source context; paginate at the returned revision',
    inputSchema: { file: artifactFileSchema, revision: z.number().int().nonnegative().optional(), offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(2000).default(2000) }, annotations: readOnly,
  }, async ({ file, revision, offset, limit }, extra) => {
    if (offset > 0 && revision === undefined) throw new Error('Pagination requires the revision returned by the first page');
    const doc = annotationDocumentSchema.parse(await client.request(`/api/annotations?file=${encodeURIComponent(file)}`, 'GET', undefined, extra.mcpReq.signal));
    if (revision !== undefined && revision !== doc.revision) throw new Error('Annotations changed while paging. Restart from offset 0.');
    const items = doc.batches.flatMap(batch => batch.annotations.map(annotation => ({ ...annotation, batchId: batch.id, createdAt: batch.createdAt })));
    let count = Math.min(limit, Math.max(0, items.length - offset));
    const page = () => ({ file, revision: doc.revision, updatedAt: doc.updatedAt, annotations: items.slice(offset, offset + count), totalAnnotations: items.length, nextOffset: offset + count < items.length ? offset + count : null });
    while (count > 1 && JSON.stringify(page()).length > MAX_TOOL_TEXT) count = Math.max(1, Math.floor(count / 2));
    return text(page());
  });
  server.registerTool('clear_page_annotations', {
    description: 'Clear only inspected notes; omit ids to clear all at baseRevision',
    inputSchema: clearAnnotationsSchema.safeExtend({ file: artifactFileSchema }), annotations: { destructiveHint: true, openWorldHint: false },
  }, async ({ file, ...update }, extra) => {
    const doc = annotationDocumentSchema.parse(await client.request(`/api/annotations?file=${encodeURIComponent(file)}`, 'DELETE', update, extra.mcpReq.signal));
    return text({ file, revision: doc.revision, remainingAnnotations: doc.batches.reduce((count, batch) => count + batch.annotations.length, 0) });
  });
  server.registerTool('wait_for_page_annotations', {
    description: 'Wait on live events for a sent batch or clear; read get_page_annotations after changed',
    inputSchema: { file: artifactFileSchema, afterRevision: z.number().int().nonnegative(), timeoutMs: z.number().int().min(0).max(30_000).default(25_000) }, annotations: readOnly,
  }, async ({ file, afterRevision, timeoutMs }, extra) => {
    const result = await waitForAnnotations(client, file, afterRevision, timeoutMs, extra.mcpReq.signal);
    return text({ changed: result.changed, file, revision: result.annotations.revision, totalAnnotations: result.annotations.batches.reduce((count, batch) => count + batch.annotations.length, 0) });
  });
  server.registerTool('read_artifact', {
    description: 'TSX source; offset/limit in characters; follow nextOffset',
    inputSchema: { file: artifactFileSchema, offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(50_000).default(50_000) }, annotations: readOnly,
  }, async ({ file, offset, limit }, extra) => {
    const artifact = z.object({ file: z.string(), content: z.string() }).parse(await client.request(`/api/artifacts?file=${encodeURIComponent(file)}`, 'GET', undefined, extra.mcpReq.signal));
    let count = Math.min(limit, Math.max(0, artifact.content.length - offset));
    const page = () => ({ file, content: artifact.content.slice(offset, offset + count), totalCharacters: artifact.content.length, nextOffset: offset + count < artifact.content.length ? offset + count : null });
    while (count > 1 && JSON.stringify(page()).length > MAX_TOOL_TEXT) count = Math.max(1, Math.floor(count / 2));
    return text(page());
  });
  server.registerTool('write_artifact', {
    description: 'Create/replace self-contained TSX in pagesDir',
    inputSchema: artifactWriteSchema, annotations: { destructiveHint: true, openWorldHint: false },
  }, async (input, extra) => text(await client.request('/api/artifacts', 'PUT', input, extra.mcpReq.signal)));
  registerMcpResources(server, client);
  return server;
}
