import { useLayoutEffect, useState, type RefObject } from 'react';
import type { Annotation } from './contract';
import { pointInArtifact } from './capture';

/** Element marks follow their DOM target; freehand/region marks retain capture coordinates. */
export function useAnchoredMarks(items: Annotation[], root: RefObject<HTMLDivElement | null>) {
  const [bounds, setBounds] = useState<Record<string, Annotation['bounds']>>({});
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const container = element;
    let frame = 0;
    function resolve() {
      const next: Record<string, Annotation['bounds']> = {};
      for (const item of items) {
        if (item.kind !== 'element' || !item.anchor?.selector) continue;
        let target: Element | null = null;
        try { target = item.anchor.selector === ':scope' ? container : container.querySelector(item.anchor.selector); }
        catch { /* Historical selectors may no longer be valid after a page update. */ }
        if (!target) continue;
        const rect = target.getBoundingClientRect();
        next[item.id] = { ...pointInArtifact(container, rect.left, rect.top), width: rect.width, height: rect.height };
      }
      setBounds(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    }
    function schedule() { cancelAnimationFrame(frame); frame = requestAnimationFrame(resolve); }
    const observer = new MutationObserver(records => {
      if (records.some(record => !(record.target instanceof Element ? record.target : record.target.parentElement)?.closest('.annotation-marks,.annotation-preview'))) schedule();
    });
    observer.observe(element, { subtree: true, childList: true, characterData: true, attributes: true });
    const resize = new ResizeObserver(schedule); resize.observe(element);
    window.addEventListener('resize', schedule);
    resolve();
    return () => { observer.disconnect(); resize.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('resize', schedule); };
  }, [items, root]);
  return items.map(item => bounds[item.id] ? { ...item, bounds: bounds[item.id] } : item);
}
