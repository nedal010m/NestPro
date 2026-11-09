import type { Point, Polygon, Shape } from "./types";

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  w: number;
  h: number;
}

export function getBBox(pts: Polygon): BBox {
  if (!pts.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

export function signedPolygonArea(pts: Polygon): number {
  const n = pts.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum * 0.5;
}

export function polygonArea(pts: Polygon): number {
  return Math.abs(signedPolygonArea(pts));
}

export function polygonPerimeter(pts: Polygon): number {
  const n = pts.length;
  if (n < 2) return 0;
  let len = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    len += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return len;
}

export function shapeArea(s: Pick<Shape, "points" | "holes">, subtractHoles = true): number {
  const outer = polygonArea(s.points);
  if (!subtractHoles || !s.holes?.length) return outer;
  let holeSum = 0;
  for (const h of s.holes) {
    holeSum += polygonArea(h);
  }
  return Math.max(0.01, outer - holeSum);
}

export function shapePerimeter(s: Pick<Shape, "points" | "holes">): number {
  let len = polygonPerimeter(s.points);
  if (s.holes) {
    for (const h of s.holes) {
      len += polygonPerimeter(h);
    }
  }
  return len;
}

/**
 * Rotate polygon around origin (0,0) by `angleDeg` degrees.
 */
export function rotatePolygon(pts: Polygon, angleDeg: number): Polygon {
  if (angleDeg === 0) return pts.map((p) => ({ x: p.x, y: p.y }));
  const rad = (angleDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const out: Polygon = new Array(pts.length);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    out[i] = {
      x: p.x * c - p.y * s,
      y: p.x * s + p.y * c,
    };
  }
  return out;
}

/**
 * Translate polygon by (dx, dy).
 */
export function translatePolygon(pts: Polygon, dx: number, dy: number): Polygon {
  return pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

/**
 * Normalize outer contour and holes so the outer bounding box starts at (0,0).
 */
export function normalizeShapeGeometry(
  outer: Polygon,
  holes: Polygon[] = []
): { points: Polygon; holes: Polygon[]; w: number; h: number; origX: number; origY: number } {
  const bb = getBBox(outer);
  const points = translatePolygon(outer, -bb.minX, -bb.minY);
  const normHoles = holes.map((h) => translatePolygon(h, -bb.minX, -bb.minY));
  return {
    points,
    holes: normHoles,
    w: bb.w,
    h: bb.h,
    origX: bb.minX,
    origY: bb.minY,
  };
}

/**
 * Transform a shape (outer + holes) by rotating `angleDeg` and placing at `(x, y)` on sheet.
 */
export function transformShapeToSheet(
  shape: Pick<Shape, "points" | "holes">,
  x: number,
  y: number,
  angleDeg: number
): { outer: Polygon; holes: Polygon[]; bbox: BBox } {
  const rotOuter = rotatePolygon(shape.points, angleDeg);
  const rbb = getBBox(rotOuter);
  const dx = x - rbb.minX;
  const dy = y - rbb.minY;
  const outer = translatePolygon(rotOuter, dx, dy);
  const holes = (shape.holes || []).map((h) => translatePolygon(rotatePolygon(h, angleDeg), dx, dy));
  const bbox = {
    minX: x,
    minY: y,
    maxX: x + rbb.w,
    maxY: y + rbb.h,
    w: rbb.w,
    h: rbb.h,
  };
  return { outer, holes, bbox };
}

/**
 * Point-in-polygon check using ray-casting algorithm.
 */
export function pointInPolygon(pt: Point, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect =
      yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Simplify a polygon using Ramer-Douglas-Peucker algorithm to keep vertex count fast and clean.
 */
export function simplifyPolygon(pts: Polygon, tolerance = 0.15): Polygon {
  if (pts.length <= 4) return pts;
  // Remove consecutive duplicate points first
  const cleaned: Polygon = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = cleaned[cleaned.length - 1];
    if (!prev || Math.hypot(pts[i].x - prev.x, pts[i].y - prev.y) > 1e-4) {
      cleaned.push(pts[i]);
    }
  }
  if (cleaned.length > 2) {
    const first = cleaned[0];
    const last = cleaned[cleaned.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-3) {
      cleaned.pop();
    }
  }
  if (cleaned.length <= 6) return cleaned;

  const sqTol = tolerance * tolerance;
  const keep = new Uint8Array(cleaned.length);
  keep[0] = 1;
  keep[cleaned.length - 1] = 1;

  function sqSegDist(p: Point, p1: Point, p2: Point): number {
    let x = p1.x;
    let y = p1.y;
    let dx = p2.x - x;
    let dy = p2.y - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) {
        x = p2.x;
        y = p2.y;
      } else if (t > 0) {
        x += dx * t;
        y += dy * t;
      }
    }
    dx = p.x - x;
    dy = p.y - y;
    return dx * dx + dy * dy;
  }

  function simplifyStep(first: number, last: number) {
    let maxSqDist = sqTol;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const sqDist = sqSegDist(cleaned[i], cleaned[first], cleaned[last]);
      if (sqDist > maxSqDist) {
        index = i;
        maxSqDist = sqDist;
      }
    }
    if (index !== -1) {
      keep[index] = 1;
      if (index - first > 1) simplifyStep(first, index);
      if (last - index > 1) simplifyStep(index, last);
    }
  }

  simplifyStep(0, cleaned.length - 1);
  const result: Polygon = [];
  for (let i = 0; i < cleaned.length; i++) {
    if (keep[i]) result.push(cleaned[i]);
  }
  return result.length >= 3 ? result : cleaned;
}

/**
 * Detect dominant straight edge angles of a polygon so `edgeAlign` can align angled edges flush with the sheet/other parts.
 */
export function detectDominantEdgeAngles(pts: Polygon, maxAngles = 4): number[] {
  const n = pts.length;
  if (n < 3) return [];
  const buckets = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 2) continue;
    let deg = (-Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    deg = ((Math.round(deg) % 90) + 90) % 90;
    if (deg > 2 && deg < 88) {
      buckets.set(deg, (buckets.get(deg) || 0) + len);
    }
  }
  const sorted = Array.from(buckets.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxAngles);
  const angles: number[] = [];
  for (const [baseDeg] of sorted) {
    angles.push(baseDeg, (baseDeg + 90) % 360, (baseDeg + 180) % 360, (baseDeg + 270) % 360);
  }
  return angles;
}

/**
 * Convert a polygon (and optional holes) into an SVG `d` path string.
 */
export function polygonToPathD(outer: Polygon, holes: Polygon[] = []): string {
  const ringToD = (pts: Polygon) => {
    if (!pts.length) return "";
    let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
    for (let i = 1; i < pts.length; i++) {
      d += ` L ${pts[i].x.toFixed(2)} ${pts[i].y.toFixed(2)}`;
    }
    return d + " Z";
  };
  let full = ringToD(outer);
  for (const h of holes) {
    full += " " + ringToD(h);
  }
  return full;
}
