import { useEffect, useState } from 'react';
import { CaptureUpdateAction, Excalidraw, reconcileElements, restoreElements } from '@excalidraw/excalidraw';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { RemoteExcalidrawElement } from '@excalidraw/excalidraw/data/reconcile';
import type { BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import '@excalidraw/excalidraw/index.css';
import { connectBoard, type SyncStatus } from './sync';
import { createBoardPreview } from './preview';

// Fonts stay on the local server, including when working without Internet.
window.EXCALIDRAW_ASSET_PATH = import.meta.env.BASE_URL + 'excalidraw-assets/';

export default function WhiteboardEditor({ id, theme, onStatus }: {
  id: string;
  theme: 'dark' | 'light';
  onStatus: (status: SyncStatus, error?: string, retry?: () => void, save?: () => void) => void;
}) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [retryPreview, setRetryPreview] = useState<(() => void) | undefined>();
  useEffect(() => {
    if (!api) return;
    const preview = createBoardPreview(id, api, setPreviewError);
    setRetryPreview(() => () => preview.retry());
    const connection = connectBoard(id, {
      read: () => ({ elements: api.getSceneElementsIncludingDeleted(), files: api.getFiles() }),
      // The SDK initialises pasted images asynchronously using object identity.
      // Do not replace the scene while one is still acquiring its file ID.
      ready: () => api.getSceneElements().every(element => element.type !== 'image' || element.fileId !== null),
      merge(board) {
        // The schema checks the wire boundary; Excalidraw restores its own
        // evolving element fields and branded IDs before reconciliation.
        const remote = restoreElements(board.elements as ExcalidrawElement[], null);
        const elements = reconcileElements(api.getSceneElementsIncludingDeleted(), remote as RemoteExcalidrawElement[], api.getAppState());
        api.addFiles(Object.values(board.files as BinaryFiles));
        api.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
      },
      status: (status, error, revision, scene) => {
        if ((status === 'saved' || status === 'synced') && revision !== undefined && scene) preview.schedule(revision, scene);
        else preview.pause();
        onStatus(status, error, () => void connection.retry(), () => void connection.flush());
      },
    });
    const unsubscribe = api.onChange(() => connection.changed());
    return () => { unsubscribe(); connection.close(); preview.close(); };
  }, [api, id, onStatus]);
  return <>{previewError && <div className="whiteboard-error" role="alert">Agent preview unavailable: {previewError} <button onClick={retryPreview}>Retry preview</button></div>}<div className="whiteboard-canvas"><Excalidraw excalidrawAPI={setApi} theme={theme} isCollaborating name="Agent Pages whiteboard" UIOptions={{ canvasActions: { toggleTheme: false } }} /></div></>;
}
