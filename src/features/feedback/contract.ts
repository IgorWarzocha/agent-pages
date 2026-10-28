import { z } from 'zod';

export const MAX_FEEDBACK_BYTES = 64 * 1024;
const fieldKey = z.string().min(1).max(128).regex(/^[A-Za-z0-9_][A-Za-z0-9_.:-]*$/);
const boundedString = z.string().refine(value => new TextEncoder().encode(value).length <= 8 * 1024, 'String exceeds 8 KiB');
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function jsonValue(depth: number): z.ZodType<JsonValue> {
  const scalar = z.union([z.null(), z.boolean(), z.number().finite(), boundedString]);
  if (!depth) return scalar;
  const child = jsonValue(depth - 1);
  return z.union([scalar, z.array(child).max(128), z.record(fieldKey, child).refine(value => Object.keys(value).length <= 128, 'Too many fields')]);
}

const valuesSchema = z.record(fieldKey, jsonValue(8))
  .refine(value => Object.keys(value).length <= 128, 'Too many fields')
  .refine(value => new TextEncoder().encode(JSON.stringify(value)).length <= MAX_FEEDBACK_BYTES, 'Feedback exceeds 64 KiB');

export const artifactFeedbackSchema = z.object({
  file: z.string().min(1).max(240).regex(/^[^/\\\x00]+\.tsx$/).refine(file => !file.startsWith('.'), 'Invalid artifact filename'),
  revision: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime().nullable(),
  values: valuesSchema,
}).strict();

export const feedbackUpdateSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  values: valuesSchema,
}).strict().refine(value => new TextEncoder().encode(JSON.stringify(value)).length <= MAX_FEEDBACK_BYTES, 'Feedback request exceeds 64 KiB');

export type ArtifactFeedback = z.infer<typeof artifactFeedbackSchema>;
export type FeedbackUpdate = z.infer<typeof feedbackUpdateSchema>;
