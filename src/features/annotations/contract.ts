import { z } from 'zod';

export const MAX_ANNOTATION_REQUEST_BYTES = 512 * 1024;
export const MAX_ANNOTATION_DOCUMENT_BYTES = 2 * 1024 * 1024;
export const MAX_ANNOTATION_BATCHES = 100;
export const MAX_ANNOTATIONS = 2000;
export const MAX_ANNOTATIONS_PER_BATCH = 100;
export const MAX_ANNOTATION_POINTS = 2000;

// Browser-safe equivalent of the artifact API filename boundary.
const artifactFileSchema = z.string().min(1).max(240).regex(/^[^/\\\x00]+\.tsx$/).refine(file => !file.startsWith('.'), 'Invalid artifact filename');
const coordinate = z.number().finite().nonnegative();
const sizeSchema = z.object({ width: coordinate, height: coordinate }).strict();
const uniqueIds = (items: { id: string }[]) => new Set(items.map(item => item.id)).size === items.length;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

/** Coordinates are CSS pixels relative to the artifact root, not the window. */
export const annotationSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['element', 'rectangle', 'arrow', 'draw', 'text']),
  points: z.array(z.object({ x: coordinate, y: coordinate }).strict()).max(MAX_ANNOTATION_POINTS),
  bounds: z.object({ x: coordinate, y: coordinate, width: coordinate, height: coordinate }).strict(),
  comment: z.string().max(4000),
  anchor: z.object({ selector: z.string().max(2048), text: z.string().max(2000), tag: z.string().max(80), context: z.string().max(12000) }).strict().optional(),
  viewport: sizeSchema,
  pageSize: sizeSchema,
}).strict().refine(annotation => annotation.kind !== 'text' || annotation.comment.trim().length > 0, 'Text annotations need text');

export const annotationBatchSchema = z.object({
  id: z.uuid(),
  file: artifactFileSchema,
  createdAt: z.iso.datetime(),
  annotations: z.array(annotationSchema).min(1).max(MAX_ANNOTATIONS_PER_BATCH).refine(uniqueIds, 'Duplicate annotation IDs'),
}).strict();

export const annotationDocumentSchema = z.object({
  file: artifactFileSchema,
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  updatedAt: z.iso.datetime().nullable(),
  batches: z.array(annotationBatchSchema).max(MAX_ANNOTATION_BATCHES),
}).strict()
  .refine(doc => doc.batches.every(batch => batch.file === doc.file), 'Batch filename mismatch')
  .refine(doc => uniqueIds(doc.batches), 'Duplicate batch IDs')
  .refine(doc => uniqueIds(doc.batches.flatMap(batch => batch.annotations)), 'Duplicate annotation IDs')
  .refine(doc => doc.batches.reduce((count, batch) => count + batch.annotations.length, 0) <= MAX_ANNOTATIONS, 'Too many annotations')
  // Reserve space for conflict envelopes and SSE framing within the 2 MiB response cap.
  .refine(doc => bytes(doc) <= MAX_ANNOTATION_DOCUMENT_BYTES - 1024, 'Annotation document exceeds the 2 MiB response budget');

export const submitAnnotationsSchema = z.object({
  batchId: z.uuid(),
  annotations: z.array(annotationSchema).min(1).max(MAX_ANNOTATIONS_PER_BATCH).refine(uniqueIds, 'Duplicate annotation IDs'),
}).strict().refine(value => bytes(value) <= MAX_ANNOTATION_REQUEST_BYTES, 'Annotation request exceeds 512 KiB');

export const clearAnnotationsSchema = z.object({
  baseRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  ids: z.array(z.uuid()).max(MAX_ANNOTATIONS).optional(),
}).strict().refine(value => bytes(value) <= MAX_ANNOTATION_REQUEST_BYTES, 'Annotation request exceeds 512 KiB');

export type Annotation = z.infer<typeof annotationSchema>;
export type AnnotationBatch = z.infer<typeof annotationBatchSchema>;
export type AnnotationDocument = z.infer<typeof annotationDocumentSchema>;
