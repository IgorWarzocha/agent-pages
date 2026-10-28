import type { Annotation } from './contract.ts';

type Point = Annotation['points'][number];
type Anchor = NonNullable<Annotation['anchor']>;

export function pointsBounds(points: readonly Point[]): Annotation['bounds'] {
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const { x, y } of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError('Annotation points must be finite');
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Bounded, deterministic sampling; the first and last pointer positions survive. */
export function simplifyPoints(points: readonly Point[], max = 1000): Point[] {
  if (!Number.isInteger(max) || max < 2) throw new RangeError('Point limit must be an integer of at least 2');
  if (points.length <= max) return points.slice();
  return Array.from({ length: max }, (_, index) => points[Math.round(index * (points.length - 1) / (max - 1))]);
}

/** Root content/padding coordinates, including scrolling by the root itself. */
export function pointInArtifact(
  root: Pick<HTMLElement, 'getBoundingClientRect' | 'scrollWidth' | 'scrollHeight' | 'clientLeft' | 'clientTop' | 'scrollLeft' | 'scrollTop'>,
  clientX: number,
  clientY: number,
): Point {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) throw new RangeError('Pointer coordinates must be finite');
  const rect = root.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(root.scrollWidth, clientX - rect.left - root.clientLeft + root.scrollLeft)),
    y: Math.max(0, Math.min(root.scrollHeight, clientY - rect.top - root.clientTop + root.scrollTop)),
  };
}

// CSS string escaping works for attribute selectors without relying on CSS.escape.
function selectorString(value: string): string {
  return value.replace(/[\0-\x1f\x7f"\\]/g, character => `\\${character.charCodeAt(0).toString(16)} `);
}

function uniqueSelector(root: HTMLElement, element: Element): string {
  if (element === root) return ':scope';
  const path: string[] = [];
  let current: Element | null = element;
  for (let depth = 0; current && current !== root && depth < 8; depth++, current = current.parentElement) {
    const suffix = path.length ? ` > ${path.join(' > ')}` : '';
    for (const attribute of ['data-testid', 'data-test', 'data-cy', 'id']) {
      const value = current.getAttribute(attribute);
      if (!value || value.length > 256) continue;
      const candidate = `:scope [${attribute}="${selectorString(value)}"]${suffix}`;
      const matches = root.querySelectorAll(candidate);
      if (candidate.length <= 2048 && matches.length === 1 && matches[0] === element) return candidate;
    }
    const tag = /^[a-zA-Z][\w-]*$/.test(current.localName) ? current.localName : '*';
    let position = 1;
    for (let sibling = current.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
      if (sibling.localName === current.localName && sibling.namespaceURI === current.namespaceURI) position++;
    }
    path.unshift(`${tag}:nth-of-type(${position})`);
    const candidate = `:scope${current.parentElement === root ? ' > ' : ' '}${path.join(' > ')}`;
    const matches = root.querySelectorAll(candidate);
    if (candidate.length <= 2048 && matches.length === 1 && matches[0] === element) return candidate;
  }
  return '';
}

const privateContent = 'input, textarea, select, option, script, style, [contenteditable]:not([contenteditable="false"])';

function targetText(element: Element): string {
  if (element.closest(privateContent)) return '';
  // Reject editable subtrees rather than copying textContent (textarea defaults and
  // contenteditable text are form contents too). Never inspect input.value.
  const walker = element.ownerDocument.createTreeWalker(element, 1 | 4, {
    acceptNode(node) {
      if (node.nodeType === 1 && (node as Element).matches(privateContent)) return 2;
      return node.nodeType === 3 ? 1 : 3;
    },
  });
  let text = '';
  for (let visited = 0, node = walker.nextNode(); node && visited < 500 && text.length < 2000; visited++, node = walker.nextNode()) {
    text += (node.nodeValue ?? '').slice(0, 2000 - text.length);
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, 2000);
}

async function sourceContext(element: Element): Promise<string> {
  try {
    // The core entry has no toolbar auto-init. formatElementInfo also serializes
    // DOM attributes/text, including editable contents; use its supported stack
    // API instead, retaining only source metadata and never frame args/source.
    const { getStack } = await import('react-grab/core');
    const frames = await getStack(element);
    const context = (frames ?? []).slice(0, 8).flatMap(frame => {
      if (!frame.fileName && !frame.functionName) return [];
      const location = frame.fileName ? `${frame.fileName}${frame.lineNumber ? `:${frame.lineNumber}` : ''}${frame.columnNumber ? `:${frame.columnNumber}` : ''}` : '';
      return [`  in ${frame.functionName || '<anonymous>'}${location ? ` (at ${location})` : ''}`];
    }).join('\n');
    return context ? context.slice(0, 12000) : 'Source context unavailable: React Grab found no instrumented React stack. DOM anchor remains valid.';
  } catch {
    return 'Source context unavailable: React Grab could not read the React stack. DOM anchor remains valid.';
  }
}

export async function describeTarget(element: Element, root: HTMLElement): Promise<Anchor> {
  if (!root.contains(element)) throw new RangeError('Annotation target must be inside the artifact root');
  const selector = uniqueSelector(root, element);
  const text = targetText(element);
  let context = await sourceContext(element);
  if (!selector) context = `DOM selector unavailable within the 8-level path limit.\n${context}`.slice(0, 12000);
  return { selector, text, tag: element.localName.slice(0, 80), context };
}
