import type { BoardScene } from '../src/features/whiteboard/contract.ts';

/** Compare explicit agent checkpoints, never materialise per-autosave history. */
export function sceneChanges(checkpointId: string, baseline: BoardScene, current: BoardScene) {
  const before = new Map(baseline.elements.filter(element => !element.isDeleted).map(element => [element.id, element]));
  const after = new Map(current.elements.filter(element => !element.isDeleted).map(element => [element.id, element]));
  const added = [], updated = [];
  for (const [id, element] of after) {
    if (!before.has(id)) added.push(element);
    else if (JSON.stringify(before.get(id)) !== JSON.stringify(element)) updated.push(element);
  }
  return structuredClone({
    checkpointId, fromRevision: baseline.revision, toRevision: current.revision,
    added, updated, deletedIds: Array.from(before.keys()).filter(id => !after.has(id)),
    orderChanged: JSON.stringify(Array.from(before.keys())) !== JSON.stringify(Array.from(after.keys())),
    files: {
      addedIds: Object.keys(current.files).filter(id => !Object.hasOwn(baseline.files, id)),
      updatedIds: Object.keys(current.files).filter(id => Object.hasOwn(baseline.files, id) && JSON.stringify(baseline.files[id]) !== JSON.stringify(current.files[id])),
      removedIds: Object.keys(baseline.files).filter(id => !Object.hasOwn(current.files, id)),
    },
  });
}
