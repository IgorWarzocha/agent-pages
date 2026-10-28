import { expect, test } from 'bun:test';
import { reconcileSentDrafts } from '../src/features/annotations/drafts';
import type { Annotation } from '../src/features/annotations/contract';

function note(comment: string): Annotation {
  return { id: crypto.randomUUID(), kind: 'element', comment, points: [{ x: 10, y: 20 }], bounds: { x: 10, y: 20, width: 50, height: 40 }, viewport: { width: 800, height: 600 }, pageSize: { width: 700, height: 1000 } };
}
test('durable echo removes a draft even when its submit response was lost', () => {
  const sent = note('Keep the title');
  const pending = note('Another unsent note');
  const result = reconcileSentDrafts([sent, pending], [{ ...sent }]);
  expect(result.acknowledged).toBe(1);
  expect(result.remaining).toEqual([pending]);
  expect(result.replacements.size).toBe(0);
});
test('new comments after an uncertain send keep their text under a fresh retry identity', () => {
  const sent = note('Original comment');
  const edited = { ...sent, comment: 'An edit made after the request failed' };
  const result = reconcileSentDrafts([edited], [sent]);
  expect(result.remaining).toHaveLength(1);
  expect(result.remaining[0].comment).toBe(edited.comment);
  expect(result.remaining[0].id).not.toBe(sent.id);
  expect(result.replacements.get(sent.id)).toBe(result.remaining[0].id);
  expect(reconcileSentDrafts(result.remaining, [sent]).acknowledged).toBe(0);
});
