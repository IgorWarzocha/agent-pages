import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { boardMetadataSchema, boardSceneSchema, type BoardMetadata } from './contract';
import { boardRequest, type SyncStatus } from './sync';
import './whiteboard.css';

const WhiteboardEditor = lazy(() => import('./WhiteboardEditor'));

class EditorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) return <div className="whiteboard-error" role="alert">The editor stopped: {this.state.error.message} <button onClick={() => location.reload()}>Reload editor</button></div>;
    return this.props.children;
  }
}

export function Whiteboards({ id, theme, onOpen, onUnsavedChange }: { id?: string; theme: 'dark' | 'light'; onOpen: (id?: string) => void; onUnsavedChange: (unsaved: boolean) => void }) {
  const [boards, setBoards] = useState<BoardMetadata[]>([]);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const [sync, setSync] = useState<{ status: SyncStatus; error?: string; retry?: () => void; save?: () => void }>({ status: 'connecting' });
  const onStatus = useCallback((status: SyncStatus, error?: string, retry?: () => void, save?: () => void) => {
    setSync({ status, error, retry, save });
    onUnsavedChange(status !== 'saved' && status !== 'synced');
  }, [onUnsavedChange]);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    boardRequest('', { signal: abort.signal }).then(data => {
      setBoards(boardMetadataSchema.array().parse(data));
      setError('');
    }).catch(error => { if (!abort.signal.aborted) setError(error.message); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [id]);
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    setError('');
    try {
      const board = boardSceneSchema.parse(await boardRequest('', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: title.trim() }),
      }));
      setTitle('');
      onOpen(board.id);
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not create whiteboard'); }
    finally { creatingRef.current = false; setCreating(false); }
  }
  const board = boards.find(board => board.id === id);
  if (id) return <main className="whiteboard-workspace">
    <header className="whiteboard-toolbar">
      <button onClick={() => onOpen()}>← Whiteboards</button>
      <h1>{board?.title ?? 'Whiteboard'}</h1>
      <span role="status">{sync.status === 'saved' ? 'Saved · live' : sync.status === 'synced' ? 'Synced · awaiting disk save' : sync.status === 'saving' ? 'Syncing…' : sync.status === 'offline' ? 'Not synced' : 'Connecting…'}</span>
      <button onClick={sync.save} disabled={!sync.save || sync.status === 'connecting' || sync.status === 'saved'}>Save</button>
      <button onClick={() => { void navigator.clipboard.writeText(location.href).catch(() => setError('Could not copy link. Copy the address from your browser.')); }}>Copy link</button>
    </header>
    {(sync.error || error) && <div className="whiteboard-error" role="alert">{sync.error || error} {sync.retry && <button onClick={sync.retry}>Retry</button>}</div>}
    <EditorBoundary key={id}><Suspense fallback={<p className="whiteboard-loading">Loading editor…</p>}><WhiteboardEditor id={id} theme={theme} onStatus={onStatus} /></Suspense></EditorBoundary>
  </main>;
  return <main className="whiteboards">
    <h1>Whiteboards</h1>
    <form onSubmit={event => void create(event)} className="whiteboard-create">
      <label htmlFor="board-title">Board name</label>
      <div><input id="board-title" value={title} onChange={event => setTitle(event.target.value)} maxLength={160} required /><button disabled={creating || !title.trim()}>{creating ? 'Creating…' : 'Create whiteboard'}</button></div>
    </form>
    {error && <p className="whiteboard-error" role="alert">{error}</p>}
    {loading ? <p role="status">Loading boards…</p> : boards.length === 0 && !error ? <p>No whiteboards yet.</p> : <ul className="whiteboard-list">{boards.map(board => <li key={board.id}><a href={'#view=whiteboards&board=' + board.id}><strong>{board.title}</strong><time dateTime={board.updatedAt}>{new Date(board.updatedAt).toLocaleString()}</time></a></li>)}</ul>}
  </main>;
}
