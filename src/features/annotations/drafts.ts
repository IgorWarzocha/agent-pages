import type { Annotation } from './contract';

/** Reconcile durable echoes, including a POST whose response was lost. */
export function reconcileSentDrafts(drafts: Annotation[], sent: Annotation[]) {
  const saved = new Map(sent.map(item => [item.id, item]));
  const replacements = new Map<string, string>();
  let acknowledged = 0;
  const remaining = drafts.flatMap(draft => {
    const match = saved.get(draft.id);
    if (!match) return [draft];
    acknowledged++;
    // Comments are the only editable field after capture. Keep post-send edits
    // as a new pending note rather than mutating an already-committed identity.
    if (match.comment !== draft.comment) {
      const id = crypto.randomUUID(); replacements.set(draft.id, id);
      return [{ ...draft, id }];
    }
    return [];
  });
  return { remaining, replacements, acknowledged };
}
