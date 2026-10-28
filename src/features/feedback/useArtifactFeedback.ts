import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ArtifactFeedback } from './contract';
import { createFeedbackConnection } from './sync';

/** Supported artifact API. The page remains one TSX file, with its own controls. */
export function useArtifactFeedback(file: string, defaults: ArtifactFeedback['values'] = {}) {
  const connection = useMemo(() => createFeedbackConnection(file), [file]);
  const state = useSyncExternalStore(connection.subscribe, connection.snapshot);
  useEffect(() => { connection.start(); return () => connection.close(); }, [connection]);
  return { ...state, values: { ...defaults, ...state.values }, setValue: connection.setValue,
    save: connection.save, refresh: connection.refresh, discardAndReload: connection.discardAndReload };
}
