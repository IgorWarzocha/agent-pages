import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { Check, Circle, Eraser, Hand, LoaderCircle, MessageSquarePlus, MousePointer2, MoveUpRight, Pencil, Send, Square, Trash2, Type, Undo2, X } from 'lucide-react';
import type { Annotation } from './contract';
import { describeTarget, pointInArtifact, pointsBounds, simplifyPoints } from './capture';
import { AnnotationMarks } from './AnnotationMarks';
import { usePageAnnotations } from './usePageAnnotations';
import { useAnchoredMarks } from './useAnchoredMarks';
import { reconcileSentDrafts } from './drafts';
import './annotations.css';

type Tool = Annotation['kind'];
type Point = Annotation['points'][number];
type Gesture = { tool: Tool; points: Point[]; target: Element; pointerId: number };
const tools = [
  { tool: 'element', Icon: MousePointer2, label: 'Select element' },
  { tool: 'rectangle', Icon: Square, label: 'Rectangle' },
  { tool: 'arrow', Icon: MoveUpRight, label: 'Arrow' },
  { tool: 'draw', Icon: Pencil, label: 'Draw' },
  { tool: 'text', Icon: Type, label: 'Text' },
] as const;

export function AnnotationSurface({ file, children }: { file: string; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const commentInput = useRef<HTMLTextAreaElement>(null);
  const preview = useRef<SVGPolylineElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [drafts, setDrafts] = useState<Annotation[]>([]);
  const draftRef = useRef(drafts); draftRef.current = drafts;
  const [tool, setTool] = useState<Tool>('element');
  const [armed, setArmed] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(0);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState('');
  const [batchId, setBatchId] = useState(() => crypto.randomUUID());
  const annotations = usePageAnnotations(file);
  const sent = useMemo(() => annotations.document.batches.flatMap(batch => batch.annotations), [annotations.document.batches]);
  const items = useMemo(() => [...sent, ...drafts.filter(item => !sent.some(saved => saved.id === item.id))], [sent, drafts]);
  const positioned = useAnchoredMarks(items, root);
  const selected = items.find(item => item.id === active);
  const editable = drafts.some(item => item.id === active);
  const emptyText = drafts.some(item => item.kind === 'text' && !item.comment.trim());

  useEffect(() => {
    if (selected?.kind === 'text' && editable) commentInput.current?.focus();
  }, [selected?.id, selected?.kind, editable]);

  useEffect(() => {
    const reconciled = reconcileSentDrafts(draftRef.current, sent);
    if (!reconciled.acknowledged) return;
    // A durable SSE acknowledgement is authoritative even if the POST response
    // is lost. Do not leave an already-sent batch looking like an editable draft.
    setDrafts(reconciled.remaining);
    setActive(previous => previous ? reconciled.replacements.get(previous) ?? previous : previous);
    setBatchId(crypto.randomUUID());
    setNotice(reconciled.replacements.size ? 'Sent. Newer edits remain as drafts.' : '');
  }, [sent]);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    // Absolute SVG overlays contribute to scrollWidth/scrollHeight. Measuring
    // those would pin the page to its old desktop size after a narrow resize.
    const resize = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    resize();
    const observer = new ResizeObserver(resize); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    function protect(event: Event) { if (draftRef.current.length || busyRef.current) event.preventDefault(); }
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      gesture.current = null;
      preview.current?.setAttribute('points', '');
      setArmed(false);
    }
    window.addEventListener('beforeunload', protect);
    window.addEventListener('agent-pages-before-navigate', protect);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('beforeunload', protect);
      window.removeEventListener('agent-pages-before-navigate', protect);
      window.removeEventListener('keydown', escape);
    };
  }, []);
  function start(event: PointerEvent<HTMLDivElement>) {
    if ((!event.ctrlKey && !armed) || event.button !== 0 || !(event.target instanceof Element) || event.target.closest('[data-annotation-ui]') || !root.current || busyRef.current) return;
    event.preventDefault(); event.stopPropagation();
    gesture.current = { tool: armed ? tool : 'element', points: [pointInArtifact(root.current, event.clientX, event.clientY)], target: event.target, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    setOpen(true); setNotice('');
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current || !root.current) return;
    event.preventDefault(); event.stopPropagation();
    if (current.tool === 'text') return;
    const point = pointInArtifact(root.current, event.clientX, event.clientY);
    if (current.tool === 'draw') current.points = simplifyPoints([...current.points, point], 1000);
    else current.points = [current.points[0], point];
    const bounds = pointsBounds(current.points);
    const points = current.tool === 'draw' || current.tool === 'arrow' ? current.points
      : [{ x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y + bounds.height }, { x: bounds.x, y: bounds.y + bounds.height }, { x: bounds.x, y: bounds.y }];
    preview.current?.setAttribute('points', points.map(point => `${point.x},${point.y}`).join(' '));
  }
  async function finish(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current || !root.current) return;
    event.preventDefault(); event.stopPropagation(); gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    preview.current?.setAttribute('points', '');
    const element = root.current;
    const bounds = pointsBounds(current.points);
    const kind = current.tool === 'element' && Math.hypot(bounds.width, bounds.height) > 5 ? 'rectangle' : current.tool;
    const captured: Annotation = { id: crypto.randomUUID(), kind, points: current.points, bounds, comment: '', viewport: { width: innerWidth, height: innerHeight }, pageSize: { ...size } };
    if (kind === 'element') {
      const box = current.target.getBoundingClientRect();
      const point = pointInArtifact(element, box.left, box.top);
      captured.bounds = { ...point, width: box.width, height: box.height };
    }
    // Keep the DOM target stable across async source-context lookup.
    setDrafts(previous => [...previous, captured]); setActive(captured.id);
    setBatchId(crypto.randomUUID());
    setCapturing(count => count + 1);
    try {
      const anchor = await describeTarget(current.target, element);
      setDrafts(previous => previous.map(item => item.id === captured.id ? { ...item, anchor } : item));
    } catch { setNotice('The selected element moved before context capture. The visual mark is kept.'); }
    finally { setCapturing(count => count - 1); }
  }
  function select(id: string) { setActive(id); setOpen(true); }
  function removePending(id: string) {
    setDrafts(previous => previous.filter(item => item.id !== id));
    setBatchId(crypto.randomUUID());
  }
  async function send() {
    if (busyRef.current || capturing || emptyText || !drafts.length) return;
    busyRef.current = true; setBusy(true); setNotice('');
    const submitted = drafts;
    try {
      await annotations.submit(batchId, submitted);
      setDrafts(previous => previous.filter(item => !submitted.some(sent => sent.id === item.id)));
      setBatchId(crypto.randomUUID());
    } catch { /* The connection owns the visible error. Keep the batch for retry. */ }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function clear(ids?: string[]) {
    if (busyRef.current || !confirm(ids ? 'Clear this sent annotation for everyone?' : 'Clear all sent annotations for this page?')) return;
    busyRef.current = true; setBusy(true);
    try { await annotations.clear(annotations.document.revision, ids); setNotice(''); }
    catch { /* The connection reports conflicts and storage failures. */ }
    finally { busyRef.current = false; setBusy(false); }
  }
  return <div className={`annotation-surface ${armed ? 'annotation-armed' : ''}`}>
    <div ref={root} className="annotation-content" onPointerDownCapture={start} onPointerMoveCapture={move} onPointerUpCapture={event => void finish(event)} onPointerCancel={() => { gesture.current = null; preview.current?.setAttribute('points', ''); }} onClickCapture={event => { if ((event.ctrlKey || armed) && !(event.target instanceof Element && event.target.closest('[data-annotation-ui]'))) { event.preventDefault(); event.stopPropagation(); } }}>
      {children}
      <AnnotationMarks items={positioned} active={active} onSelect={select} {...size} />
      <svg className="annotation-preview" width={size.width} height={size.height} aria-hidden="true"><polyline ref={preview} fill="none" /></svg>
    </div>
    <aside className={`annotation-panel ${open ? 'is-open' : ''}`} data-annotation-ui aria-label="Page annotation controls">
      <div className="annotation-header"><button onClick={() => setOpen(value => !value)} aria-expanded={open}><MessageSquarePlus size={17} aria-hidden />Annotate{!!items.length && <span className="annotation-count" aria-label={`${drafts.length} drafts, ${sent.length} sent`}>{items.length}</span>}</button>{open && <button className="annotation-icon" onClick={() => { setOpen(false); setArmed(false); }} aria-label="Close annotation controls" title="Close"><X size={18} aria-hidden /></button>}</div>
      {open && <>
        <div className="annotation-tools" role="group" aria-label="Markup tools">
          <button className="annotation-icon" aria-label="Interact with page" title="Interact with page (Esc)" aria-pressed={!armed} onClick={() => setArmed(false)}><Hand size={18} aria-hidden /></button>
          {tools.map(({ tool: value, Icon, label }) => <button className="annotation-icon" key={value} aria-label={label} title={value === 'element' ? `${label} (Ctrl-click)` : label} aria-pressed={armed && tool === value} onClick={() => { setTool(value); setArmed(true); }}><Icon size={18} aria-hidden /></button>)}
        </div>
        {selected && <div className="annotation-note">
          <div className="annotation-note-header"><label htmlFor="annotation-comment">{selected.kind === 'text' ? 'Text' : 'Comment'}</label><button className="annotation-icon" disabled={busy} aria-label={editable ? 'Remove draft' : 'Clear sent annotation'} title={editable ? 'Remove draft' : 'Clear sent annotation'} onClick={() => editable ? removePending(selected.id) : void clear([selected.id])}><Trash2 size={16} aria-hidden /></button></div>
          <textarea ref={commentInput} id="annotation-comment" maxLength={4000} readOnly={!editable || busy} value={selected.comment} onChange={event => { const comment = event.target.value; setDrafts(previous => previous.map(item => item.id === active ? { ...item, comment } : item)); setBatchId(crypto.randomUUID()); }} />
          {selected.viewport.width !== innerWidth && <p className="annotation-warning">Marked at {selected.viewport.width} × {selected.viewport.height}. Positions may differ.</p>}
        </div>}
        {!!items.length && <ol className="annotation-list">{items.map((item, index) => {
          const pending = drafts.some(draft => draft.id === item.id);
          const Status = pending ? Circle : Check;
          return <li key={item.id}><button aria-current={item.id === active ? 'true' : undefined} onClick={() => select(item.id)}><span className="annotation-number">{index + 1}</span><span className="annotation-list-comment">{item.comment || tools.find(value => value.tool === item.kind)?.label}</span><Status className="annotation-state" size={14} aria-label={pending ? 'Draft' : 'Sent'}><title>{pending ? 'Draft' : 'Sent'}</title></Status></button></li>;
        })}</ol>}
        {!!items.length && <div className="annotation-actions">
          {!!sent.length && <button className="annotation-icon" disabled={busy} aria-label="Clear all sent annotations" title="Clear all sent annotations" onClick={() => void clear()}><Eraser size={18} aria-hidden /></button>}
          {!!drafts.length && <><button className="annotation-icon" disabled={busy} aria-label="Discard all drafts" title="Discard all drafts" onClick={() => { if (confirm('Discard all pending marks?')) { setDrafts([]); setBatchId(crypto.randomUUID()); } }}><Undo2 size={18} aria-hidden /></button><button className="annotation-send" disabled={busy || !!capturing || emptyText || !annotations.ready} aria-busy={busy || !!capturing} title={emptyText ? 'Enter text or remove the empty text mark' : capturing ? 'Capturing source context' : undefined} onClick={() => void send()}>{busy || capturing ? <LoaderCircle className="annotation-spinner" size={17} aria-hidden /> : <Send size={17} aria-hidden />}Send<span className="annotation-count">{drafts.length}</span></button></>}
        </div>}
        {notice && <p role="status">{notice}</p>}{annotations.error && <p role="alert">{annotations.error}</p>}
      </>}
    </aside>
  </div>;
}
