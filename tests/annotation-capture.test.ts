import { expect, test } from 'bun:test';
import { pointInArtifact, pointsBounds, simplifyPoints } from '../src/features/annotations/capture.ts';

function artifactRoot(left = 120, top = -300) {
  return {
    getBoundingClientRect: () => ({ x: left, y: top, left, top, width: 600, height: 400, right: left + 600, bottom: top + 400, toJSON: () => ({}) }),
    scrollWidth: 1000,
    scrollHeight: 2000,
    clientLeft: 2,
    clientTop: 3,
    scrollLeft: 40,
    scrollTop: 75,
  };
}

test('pointer coordinates account for ancestor scroll, root scroll and borders', () => {
  const root = artifactRoot();
  expect(pointInArtifact(root, 182, 103)).toEqual({ x: 100, y: 475 });
  // The same content location moves upward in the viewport when an ancestor scrolls.
  expect(pointInArtifact(artifactRoot(120, -500), 182, -97)).toEqual({ x: 100, y: 475 });
  // Scrolling the root changes its content position without changing its rect.
  expect(pointInArtifact({ ...root, scrollTop: 175 }, 182, 3)).toEqual({ x: 100, y: 475 });
});

test('dragging beyond the artifact is clamped to its content extent, not its viewport', () => {
  const root = artifactRoot();
  expect(pointInArtifact(root, -1000, -1000)).toEqual({ x: 0, y: 0 });
  expect(pointInArtifact(root, 10000, 10000)).toEqual({ x: 1000, y: 2000 });
  expect(pointInArtifact({ ...root, scrollLeft: 0, scrollTop: 0 }, 722, 103)).toEqual({ x: 600, y: 400 });
  expect(() => pointInArtifact(root, NaN, 0)).toThrow(RangeError);
});

test('bounds work for reverse drags, freehand extrema, single points and empty paths', () => {
  expect(pointsBounds([{ x: 90, y: 100 }, { x: 10, y: 20 }])).toEqual({ x: 10, y: 20, width: 80, height: 80 });
  expect(pointsBounds([{ x: 20, y: 5 }, { x: 2, y: 40 }, { x: 90, y: 10 }])).toEqual({ x: 2, y: 5, width: 88, height: 35 });
  expect(pointsBounds([{ x: 12, y: 13 }])).toEqual({ x: 12, y: 13, width: 0, height: 0 });
  expect(pointsBounds([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  expect(() => pointsBounds([{ x: Infinity, y: 0 }])).toThrow(RangeError);
});

test('sampling is bounded, ordered and preserves endpoints without mutating the input', () => {
  const points = Array.from({ length: 10001 }, (_, x) => ({ x, y: x % 11 }));
  const sampled = simplifyPoints(points);
  expect(sampled).toHaveLength(1000);
  expect(sampled[0]).toEqual(points[0]);
  expect(sampled.at(-1)).toEqual(points.at(-1));
  expect(sampled.every((point, index) => index === 0 || point.x > sampled[index - 1].x)).toBe(true);
  expect(points).toHaveLength(10001);
  expect(simplifyPoints(points, 2)).toEqual([points[0], points[points.length - 1]]);
  expect(simplifyPoints(points.slice(0, 3), 3)).toEqual(points.slice(0, 3));
  expect(simplifyPoints([])).toEqual([]);
  expect(simplifyPoints([points[0]])).toEqual([points[0]]);
  for (const limit of [0, 1, 2.5, NaN]) expect(() => simplifyPoints(points, limit)).toThrow(RangeError);
});
