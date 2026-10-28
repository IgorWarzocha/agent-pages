import { z } from 'zod';

export const MAX_SCENE_BYTES = 20 * 1024 * 1024;
export const MAX_PREVIEW_BYTES = 4 * 1024 * 1024;
export const MAX_PREVIEW_REQUEST_BYTES = Math.ceil(MAX_PREVIEW_BYTES / 3) * 4 + 256;
export const boardPreviewSchema = z.object({
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  dataURL: z.string().max(MAX_PREVIEW_REQUEST_BYTES).regex(/^data:image\/png;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
}).strict();
export type BoardPreview = z.infer<typeof boardPreviewSchema>;
export const boardIdSchema = z.uuid();
export const titleSchema = z.string().trim().min(1).max(160);

// Preserve Excalidraw's evolving fields while validating the stable scene boundary.
export const elementSchema = z.object({
  id: z.string().min(1).max(256),
  type: z.enum(['rectangle', 'diamond', 'ellipse', 'line', 'arrow', 'freedraw', 'text', 'image', 'frame', 'magicframe', 'embeddable', 'iframe']),
  x: z.number().finite(), y: z.number().finite(),
  width: z.number().finite().nonnegative(), height: z.number().finite().nonnegative(),
  version: z.number().int().nonnegative().default(1),
  versionNonce: z.number().int().nonnegative().default(0),
  isDeleted: z.boolean().default(false),
  angle: z.number().finite().default(0),
  strokeColor: z.string().max(256).default('#1e1e1e'),
  backgroundColor: z.string().max(256).default('transparent'),
  fillStyle: z.enum(['hachure', 'cross-hatch', 'solid', 'zigzag']).default('solid'),
  strokeWidth: z.number().finite().nonnegative().default(1),
  strokeStyle: z.enum(['solid', 'dashed', 'dotted']).default('solid'),
  roughness: z.number().finite().nonnegative().default(1),
  opacity: z.number().min(0).max(100).default(100),
  seed: z.number().int().default(1),
  groupIds: z.array(z.string()).default([]),
  frameId: z.string().nullable().default(null),
  roundness: z.object({ type: z.number().int(), value: z.number().optional() }).nullable().default(null),
  boundElements: z.array(z.object({ id: z.string(), type: z.enum(['arrow', 'text']) })).nullable().default(null),
  updated: z.number().finite().default(0),
  link: z.string().nullable().default(null),
  locked: z.boolean().default(false),
  index: z.string().nullable().optional(),
}).catchall(z.json()).superRefine((element, ctx) => {
  const require = (key: string, schema: z.ZodType) => {
    const result = schema.safeParse(element[key]);
    if (!result.success) ctx.addIssue({ code: 'custom', path: [key], message: `Invalid ${key} for ${element.type}` });
  };
  if (element.type === 'text') {
    require('text', z.string());
    require('fontSize', z.number().finite().positive());
    require('fontFamily', z.number().int().positive());
    require('textAlign', z.enum(['left', 'center', 'right']));
    require('verticalAlign', z.enum(['top', 'middle', 'bottom']));
    require('lineHeight', z.number().finite().positive());
    require('originalText', z.string());
    require('containerId', z.string().nullable());
    require('autoResize', z.boolean());
  }
  if (['line', 'arrow', 'freedraw'].includes(element.type)) require('points', z.array(z.tuple([z.number().finite(), z.number().finite()])).min(1).max(100_000));
  if (element.type === 'freedraw') {
    require('pressures', z.array(z.number().finite()));
    require('simulatePressure', z.boolean());
  }
  if (element.type === 'image') {
    require('fileId', z.string().nullable());
    require('status', z.enum(['pending', 'saved', 'error']));
    require('scale', z.tuple([z.number().finite(), z.number().finite()]));
    if (element.crop !== undefined && element.crop !== null) require('crop', z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite(), height: z.number().finite(), naturalWidth: z.number().finite(), naturalHeight: z.number().finite() }));
  }
  if (element.type === 'line' || element.type === 'arrow') {
    const binding = z.object({ elementId: z.string(), focus: z.number().finite(), gap: z.number().finite(), fixedPoint: z.tuple([z.number().finite(), z.number().finite()]).nullable().optional() }).nullable();
    require('startBinding', binding);
    require('endBinding', binding);
    const arrowhead = z.enum(['arrow', 'bar', 'dot', 'circle', 'circle_outline', 'triangle', 'triangle_outline', 'diamond', 'diamond_outline', 'crowfoot_one', 'crowfoot_many', 'crowfoot_one_or_many']).nullable();
    require('startArrowhead', arrowhead);
    require('endArrowhead', arrowhead);
  }
  if (element.type === 'frame' || element.type === 'magicframe') require('name', z.string().nullable());
});

export const binaryFileSchema = z.object({
  id: z.string().min(1).max(256),
  mimeType: z.string().min(1).max(100),
  dataURL: z.string().startsWith('data:').max(MAX_SCENE_BYTES),
  created: z.number().finite(),
  version: z.number().finite().optional(),
}).catchall(z.json());

export const sceneContentSchema = z.object({
  elements: z.array(elementSchema).max(10_000)
    .refine(elements => new Set(elements.map(element => element.id)).size === elements.length, 'Duplicate element IDs'),
  files: z.record(z.string().min(1).max(256), binaryFileSchema)
    .refine(files => Object.keys(files).length <= 100, 'At most 100 files')
    .refine(files => Object.entries(files).every(([id, file]) => id === file.id), 'File keys must match file IDs'),
});

export const createBoardSchema = z.object({ title: titleSchema }).strict();
export const updateBoardSchema = sceneContentSchema.extend({
  baseRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1),
  checkpoint: z.boolean().optional(),
}).strict();
export const boardMetadataSchema = z.object({
  id: boardIdSchema, title: titleSchema,
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  updatedAt: z.iso.datetime(),
});
export const boardSceneSchema = sceneContentSchema.extend(boardMetadataSchema.shape).extend({
  durableRevision: z.number().int().nonnegative().optional(),
  persistenceError: z.string().optional(),
  checkpointId: boardIdSchema.optional(),
}).strict();
export const checkpointRequestSchema = z.object({ baseRevision: updateBoardSchema.shape.baseRevision.optional() }).strict();
export const boardCheckpointSchema = z.object({
  id: boardIdSchema, boardId: boardIdSchema,
  revision: boardMetadataSchema.shape.revision, createdAt: z.iso.datetime(),
});
export const boardChangesSchema = z.object({
  checkpointId: boardIdSchema, fromRevision: boardMetadataSchema.shape.revision,
  nextCheckpointId: boardIdSchema.optional(),
  toRevision: boardMetadataSchema.shape.revision,
  added: z.array(elementSchema), updated: z.array(elementSchema), deletedIds: z.array(z.string()),
  orderChanged: z.boolean(),
  files: z.object({ addedIds: z.array(z.string()), updatedIds: z.array(z.string()), removedIds: z.array(z.string()) }),
});
export type BoardScene = z.infer<typeof boardSceneSchema>;
export type BoardMetadata = z.infer<typeof boardMetadataSchema>;
export type BoardUpdate = z.infer<typeof updateBoardSchema>;
