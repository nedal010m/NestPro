import {
  getBBox,
  normalizeShapeGeometry,
  pointInPolygon,
  polygonArea,
  simplifyPolygon,
} from "./geometry";
import type { Point, Polygon, Shape, ShapeSource } from "./types";

export type SvgUnit = "mm" | "cm" | "pt" | "px" | "in" | "auto";
export type SvgGrouping = "path" | "group";

const PALETTE = [
  "#10b981", // Emerald (Corel accent)
  "#06b6d4", // Cyan
  "#3b82f6", // Blue
  "#f59e0b", // Amber
  "#ec4899", // Pink
  "#8b5cf6", // Violet
  "#14b8a6", // Teal
  "#f97316", // Orange
  "#84cc16", // Lime
  "#6366f1", // Indigo
];

let colorIdx = 0;
function nextColor(): string {
  const c = PALETTE[colorIdx % PALETTE.length];
  colorIdx++;
  return c;
}

function uid(prefix = "part"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36).slice(-3)}`;
}

const UNIT_TO_MM: Record<Exclude<SvgUnit, "auto">, number> = {
  mm: 1,
  cm: 10,
  in: 25.4,
  pt: 25.4 / 72,
  px: 25.4 / 96,
};

/**
 * Sample an SVG path `d` attribute into one or more closed polygons (subpaths).
 */
export function sampleSvgPathD(d: string, scale = 1): Polygon[] {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g);
  if (!tokens) return [];

  const subpaths: Polygon[] = [];
  let cur: Polygon = [];
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;
  let prevCtrlX = 0;
  let prevCtrlY = 0;
  let cmd = "";
  let i = 0;

  const num = () => parseFloat(tokens[i++] || "0");
  const hasMoreNums = () => i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i]);

  const pushPt = (x: number, y: number) => {
    cur.push({ x: x * scale, y: y * scale });
  };

  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i])) {
      cmd = tokens[i++];
    }
    const isRel = cmd === cmd.toLowerCase();
    const upper = cmd.toUpperCase();

    if (upper === "M") {
      if (cur.length >= 3) subpaths.push(cur);
      cur = [];
      const x = num() + (isRel ? cx : 0);
      const y = num() + (isRel ? cy : 0);
      cx = startX = x;
      cy = startY = y;
      pushPt(cx, cy);
      while (hasMoreNums()) {
        const lx = num() + (isRel ? cx : 0);
        const ly = num() + (isRel ? cy : 0);
        cx = lx;
        cy = ly;
        pushPt(cx, cy);
      }
      prevCtrlX = cx;
      prevCtrlY = cy;
    } else if (upper === "L") {
      while (hasMoreNums()) {
        const x = num() + (isRel ? cx : 0);
        const y = num() + (isRel ? cy : 0);
        cx = x;
        cy = y;
        pushPt(cx, cy);
      }
      prevCtrlX = cx;
      prevCtrlY = cy;
    } else if (upper === "H") {
      while (hasMoreNums()) {
        cx = num() + (isRel ? cx : 0);
        pushPt(cx, cy);
      }
      prevCtrlX = cx;
      prevCtrlY = cy;
    } else if (upper === "V") {
      while (hasMoreNums()) {
        cy = num() + (isRel ? cy : 0);
        pushPt(cx, cy);
      }
      prevCtrlX = cx;
      prevCtrlY = cy;
    } else if (upper === "C") {
      while (hasMoreNums()) {
        const x1 = num() + (isRel ? cx : 0);
        const y1 = num() + (isRel ? cy : 0);
        const x2 = num() + (isRel ? cx : 0);
        const y2 = num() + (isRel ? cy : 0);
        const x = num() + (isRel ? cx : 0);
        const y = num() + (isRel ? cy : 0);
        const steps = 12;
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          const mt = 1 - t;
          const px =
            mt * mt * mt * cx +
            3 * mt * mt * t * x1 +
            3 * mt * t * t * x2 +
            t * t * t * x;
          const py =
            mt * mt * mt * cy +
            3 * mt * mt * t * y1 +
            3 * mt * t * t * y2 +
            t * t * t * y;
          pushPt(px, py);
        }
        prevCtrlX = x2;
        prevCtrlY = y2;
        cx = x;
        cy = y;
      }
    } else if (upper === "S") {
      while (hasMoreNums()) {
        const x1 = 2 * cx - prevCtrlX;
        const y1 = 2 * cy - prevCtrlY;
        const x2 = num() + (isRel ? cx : 0);
        const y2 = num() + (isRel ? cy : 0);
        const x = num() + (isRel ? cx : 0);
        const y = num() + (isRel ? cy : 0);
        const steps = 10;
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          const mt = 1 - t;
          const px =
            mt * mt * mt * cx +
            3 * mt * mt * t * x1 +
            3 * mt * t * t * x2 +
            t * t * t * x;
          const py =
            mt * mt * mt * cy +
            3 * mt * mt * t * y1 +
            3 * mt * t * t * y2 +
            t * t * t * y;
          pushPt(px, py);
        }
        prevCtrlX = x2;
        prevCtrlY = y2;
        cx = x;
        cy = y;
      }
    } else if (upper === "Q") {
      while (hasMoreNums()) {
        const x1 = num() + (isRel ? cx : 0);
        const y1 = num() + (isRel ? cy : 0);
        const x = num() + (isRel ? cx : 0);
        const y = num() + (isRel ? cy : 0);
        const steps = 10;
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          const mt = 1 - t;
          const px = mt * mt * cx + 2 * mt * t * x1 + t * t * x;
          const py = mt * mt * cy + 2 * mt * t * y1 + t * t * y;
          pushPt(px, py);
        }
        prevCtrlX = x1;
        prevCtrlY = y1;
        cx = x;
        cy = y;
      }
    } else if (upper === "A") {
      while (hasMoreNums()) {
        const rx = Math.abs(num());
        const ry = Math.abs(num());
        const xAxisRotation = num();
        const largeArcFlag = num();
        const sweepFlag = num();
        const x = num() + (isRel ? cx : 0);
        const y = num() + (isRel ? cy : 0);
        const arcPts = sampleSvgArc(cx, cy, rx, ry, xAxisRotation, largeArcFlag, sweepFlag, x, y);
        for (const p of arcPts) pushPt(p.x, p.y);
        cx = x;
        cy = y;
      }
      prevCtrlX = cx;
      prevCtrlY = cy;
    } else if (upper === "Z") {
      cx = startX;
      cy = startY;
      if (cur.length >= 3) {
        subpaths.push(cur);
      }
      cur = [];
    } else {
      i++;
    }
  }

  if (cur.length >= 3) {
    subpaths.push(cur);
  }

  return subpaths.map((sp) => simplifyPolygon(sp, 0.12)).filter((sp) => sp.length >= 3);
}

function sampleSvgArc(
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  phiDeg: number,
  fa: number,
  fs: number,
  x2: number,
  y2: number
): Point[] {
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) {
    return [{ x: x2, y: y2 }];
  }
  const phi = (phiDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx2 = (x1 - x2) / 2;
  const dy2 = (y1 - y2) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  let rxSq = rx * rx;
  let rySq = ry * ry;
  const x1pSq = x1p * x1p;
  const y1pSq = y1p * y1p;

  const radiiCheck = x1pSq / rxSq + y1pSq / rySq;
  if (radiiCheck > 1) {
    const s = Math.sqrt(radiiCheck);
    rx *= s;
    ry *= s;
    rxSq = rx * rx;
    rySq = ry * ry;
  }

  const sign = fa === fs ? -1 : 1;
  const sq = Math.max(
    0,
    (rxSq * rySq - rxSq * y1pSq - rySq * x1pSq) / (rxSq * y1pSq + rySq * x1pSq)
  );
  const coef = sign * Math.sqrt(sq);
  const cxp = coef * ((rx * y1p) / ry);
  const cyp = coef * (-(ry * x1p) / rx);

  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  const angle = (u: { x: number; y: number }, v: { x: number; y: number }) => {
    const dot = u.x * v.x + u.y * v.y;
    const len = Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y);
    const ang = Math.acos(Math.min(1, Math.max(-1, dot / (len || 1))));
    return u.x * v.y - u.y * v.x < 0 ? -ang : ang;
  };

  const v1 = { x: (x1p - cxp) / rx, y: (y1p - cyp) / ry };
  const v2 = { x: (-x1p - cxp) / rx, y: (-y1p - cyp) / ry };
  const theta1 = angle({ x: 1, y: 0 }, v1);
  let dTheta = angle(v1, v2);
  if (!fs && dTheta > 0) dTheta -= 2 * Math.PI;
  if (fs && dTheta < 0) dTheta += 2 * Math.PI;

  const steps = Math.max(6, Math.ceil((Math.abs(dTheta) * 18) / Math.PI));
  const pts: Point[] = [];
  for (let s = 1; s <= steps; s++) {
    const t = theta1 + (dTheta * s) / steps;
    const xr = rx * Math.cos(t);
    const yr = ry * Math.sin(t);
    pts.push({
      x: cosPhi * xr - sinPhi * yr + cx,
      y: sinPhi * xr + cosPhi * yr + cy,
    });
  }
  return pts;
}

/**
 * Check if two bounding boxes and areas represent a duplicate contour (e.g. Fill + Stroke of the same shape).
 */
export function isDuplicateContour(
  a: { bb: ReturnType<typeof getBBox>; area: number },
  b: { bb: ReturnType<typeof getBBox>; area: number }
): boolean {
  const minDim = Math.max(1, Math.min(a.bb.w, a.bb.h, b.bb.w, b.bb.h));
  const tol = Math.max(0.8, minDim * 0.035);
  const sameBBox =
    Math.abs(a.bb.minX - b.bb.minX) <= tol &&
    Math.abs(a.bb.maxX - b.bb.maxX) <= tol &&
    Math.abs(a.bb.minY - b.bb.minY) <= tol &&
    Math.abs(a.bb.maxY - b.bb.maxY) <= tol;
  if (!sameBBox) return false;
  const maxArea = Math.max(a.area, b.area, 1e-6);
  return Math.abs(a.area - b.area) / maxArea < 0.15;
}

/**
 * Check if `child` polygon is strictly inside `parent` polygon as a true interior cutout hole
 * (never a duplicate contour, outlined stroke ring, or touching outer boundary).
 */
export function isStrictInteriorHole(
  child: { poly: Polygon; bb: ReturnType<typeof getBBox>; area: number },
  parent: { poly: Polygon; bb: ReturnType<typeof getBBox>; area: number }
): boolean {
  // A true cutout hole must be meaningfully smaller than its enclosing parent contour
  if (child.area >= parent.area * 0.78) return false;
  if (isDuplicateContour(child, parent)) return false;

  const dLeft = child.bb.minX - parent.bb.minX;
  const dRight = parent.bb.maxX - child.bb.maxX;
  const dTop = child.bb.minY - parent.bb.minY;
  const dBottom = parent.bb.maxY - child.bb.maxY;

  const margin = Math.min(0.25, Math.min(parent.bb.w, parent.bb.h) * 0.01);
  if (dLeft <= margin || dRight <= margin || dTop <= margin || dBottom <= margin) {
    return false;
  }

  // Reject "Outlined Stroke" / "Convert Outline to Object" inner border rings:
  // When a designer outlines a stroke in Illustrator/CorelDRAW, the inner edge of the stroke
  // forms a parallel contour inset by a small stroke width on all 4 sides (e.g. 0.3mm - 4mm).
  const minParentDim = Math.min(parent.bb.w, parent.bb.h);
  const maxWall = Math.max(dLeft, dRight, dTop, dBottom);
  if (
    child.area >= parent.area * 0.62 &&
    maxWall <= Math.max(4.0, minParentDim * 0.065) &&
    Math.abs(dLeft - dRight) <= Math.max(1.5, minParentDim * 0.03) &&
    Math.abs(dTop - dBottom) <= Math.max(1.5, minParentDim * 0.03)
  ) {
    return false;
  }

  // Verify multiple sample points of child lie strictly inside parent
  const n = child.poly.length;
  const p0 = child.poly[0];
  const p1 = child.poly[Math.floor(n / 3)];
  const p2 = child.poly[Math.floor((2 * n) / 3)];
  return (
    pointInPolygon(p0, parent.poly) &&
    pointInPolygon(p1, parent.poly) &&
    pointInPolygon(p2, parent.poly)
  );
}

/**
 * Separate a list of closed polygons into outer contours and their enclosed holes.
 * Includes:
 * 1. Automatic removal of duplicate contours (e.g. Fill + Stroke emitted twice in PDF/AI/SVG/DXF).
 * 2. Optional stripping of giant Artboard / Page / Sheet border rectangles that enclose multiple separate parts.
 * 3. Strict interior hole validation so solid shapes are never hollowed out by their own outline.
 */
export function classifyOutersAndHoles(
  rings: Polygon[],
  options: { stripArtboardContainer?: boolean; allowHoles?: boolean } = {}
): { outer: Polygon; holes: Polygon[] }[] {
  const { stripArtboardContainer = true, allowHoles = true } = options;
  if (rings.length === 0) return [];
  if (rings.length === 1) return [{ outer: rings[0], holes: [] }];

  const rawItems = rings
    .map((poly) => ({ poly, area: polygonArea(poly), bb: getBBox(poly) }))
    .filter((it) => it.area > 0.25 && it.bb.w >= 0.4 && it.bb.h >= 0.4)
    .sort((a, b) => b.area - a.area);

  if (rawItems.length === 0) return [];

  // Step 1: Deduplicate identical/near-identical contours (e.g., Fill path + Stroke path of the same shape)
  const deduped: typeof rawItems = [];
  for (const item of rawItems) {
    const isDup = deduped.some((existing) => isDuplicateContour(existing, item));
    if (!isDup) {
      deduped.push(item);
    }
  }

  if (deduped.length === 1) {
    return [{ outer: deduped[0].poly, holes: [] }];
  }

  // Step 2: Detect and strip a giant Artboard / Page / Sheet container rectangle if it encloses multiple parts
  let items = deduped;
  if (stripArtboardContainer && items.length >= 3) {
    const biggest = items[0];
    const rectArea = Math.max(1, biggest.bb.w * biggest.bb.h);
    const rectangularity = biggest.area / rectArea;
    // Check how many of the remaining shapes are inside `biggest`
    const enclosed = items.slice(1).filter((ch) => isStrictInteriorHole(ch, biggest));
    if (rectangularity > 0.92 && enclosed.length >= 2) {
      const enclosedAreaSum = enclosed.reduce((acc, ch) => acc + ch.area, 0);
      // If a rectangular frame encloses multiple separate shapes (or almost all shapes in the file)
      // and is not a thick ring/flange with tiny bolt holes, strip the artboard/sheet container!
      const isLikelyArtboardOrSheetFrame =
        enclosed.length === items.length - 1 &&
        (biggest.bb.w >= 180 || biggest.bb.h >= 180 || enclosed.length >= 3) &&
        enclosedAreaSum < biggest.area * 0.85;
      if (isLikelyArtboardOrSheetFrame) {
        items = items.slice(1);
      }
    }
  }

  if (!allowHoles) {
    return items.map((it) => ({ outer: it.poly, holes: [] }));
  }

  // Step 3: Compute strict containment tree (depth 0, 2, ... = outer parts; depth 1, 3, ... = holes)
  const n = items.length;
  const depth = new Array<number>(n).fill(0);
  const immediateParent = new Array<number>(n).fill(-1);

  for (let i = 0; i < n; i++) {
    const child = items[i];
    for (let j = i - 1; j >= 0; j--) {
      const parent = items[j];
      if (isStrictInteriorHole(child, parent)) {
        if (immediateParent[i] === -1) {
          immediateParent[i] = j;
        }
        depth[i]++;
      }
    }
  }

  const outByIndex = new Map<number, { outer: Polygon; holes: Polygon[] }>();
  for (let i = 0; i < n; i++) {
    if (depth[i] % 2 === 0) {
      outByIndex.set(i, { outer: items[i].poly, holes: [] });
    }
  }

  for (let i = 0; i < n; i++) {
    if (depth[i] % 2 === 1) {
      const pIdx = immediateParent[i];
      const parentGroup = outByIndex.get(pIdx);
      if (parentGroup) {
        parentGroup.holes.push(items[i].poly);
      } else {
        // Fallback: if parent was not an even-depth outer, never lose the shape!
        outByIndex.set(i, { outer: items[i].poly, holes: [] });
      }
    }
  }

  return Array.from(outByIndex.values());
}

/**
 * Determine unit scale from SVG root attributes (`width`, `height`, `viewBox`) or user unit.
 */
function resolveSvgScale(svgEl: Element, unit: SvgUnit): number {
  const widthAttr = svgEl.getAttribute("width")?.trim() || "";
  const heightAttr = svgEl.getAttribute("height")?.trim() || "";
  const viewBoxAttr = svgEl.getAttribute("viewBox")?.trim() || "";

  if (unit === "auto") {
    const match = widthAttr.match(/^([0-9.]+)\s*(mm|cm|in|pt|px)?$/i);
    if (match && viewBoxAttr) {
      const val = parseFloat(match[1]);
      const u = (match[2]?.toLowerCase() || "px") as Exclude<SvgUnit, "auto">;
      const vbParts = viewBoxAttr.split(/[\s,]+/).map(Number);
      if (vbParts.length === 4 && vbParts[2] > 0 && val > 0) {
        const physicalWidthMm = val * (UNIT_TO_MM[u] || 1);
        return physicalWidthMm / vbParts[2];
      }
    }
    if (widthAttr.endsWith("mm") || heightAttr.endsWith("mm")) return 1;
    if (widthAttr.endsWith("cm")) return 10;
    if (widthAttr.endsWith("in")) return 25.4;
    return UNIT_TO_MM.mm;
  }

  return UNIT_TO_MM[unit];
}

function elementToPolygons(el: Element, scale: number): Polygon[] {
  const tag = el.tagName.toLowerCase();
  if (tag === "path") {
    const d = el.getAttribute("d") || "";
    return sampleSvgPathD(d, scale);
  }
  if (tag === "rect") {
    const x = parseFloat(el.getAttribute("x") || "0") * scale;
    const y = parseFloat(el.getAttribute("y") || "0") * scale;
    const w = parseFloat(el.getAttribute("width") || "0") * scale;
    const h = parseFloat(el.getAttribute("height") || "0") * scale;
    if (w <= 0 || h <= 0) return [];
    return [
      [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ],
    ];
  }
  if (tag === "circle") {
    const cx = parseFloat(el.getAttribute("cx") || "0") * scale;
    const cy = parseFloat(el.getAttribute("cy") || "0") * scale;
    const r = parseFloat(el.getAttribute("r") || "0") * scale;
    if (r <= 0) return [];
    const pts: Polygon = [];
    const steps = 36;
    for (let i = 0; i < steps; i++) {
      const a = (i * 2 * Math.PI) / steps;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return [pts];
  }
  if (tag === "ellipse") {
    const cx = parseFloat(el.getAttribute("cx") || "0") * scale;
    const cy = parseFloat(el.getAttribute("cy") || "0") * scale;
    const rx = parseFloat(el.getAttribute("rx") || "0") * scale;
    const ry = parseFloat(el.getAttribute("ry") || "0") * scale;
    if (rx <= 0 || ry <= 0) return [];
    const pts: Polygon = [];
    const steps = 36;
    for (let i = 0; i < steps; i++) {
      const a = (i * 2 * Math.PI) / steps;
      pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
    }
    return [pts];
  }
  if (tag === "polygon" || tag === "polyline") {
    const raw = el.getAttribute("points")?.trim() || "";
    const nums = raw.split(/[\s,]+/).map(Number).filter((n) => !isNaN(n));
    const pts: Polygon = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      pts.push({ x: nums[i] * scale, y: nums[i + 1] * scale });
    }
    return pts.length >= 3 ? [simplifyPolygon(pts, 0.1)] : [];
  }
  return [];
}

/**
 * Parse an SVG file into NestPro shapes.
 * - When `grouping === "path"` (default): Each element's own subpaths (`<path d="M...Z M...Z">`)
 *   form a part and its compound holes, so separate elements on an artboard NEVER hollow each other out!
 * - When `grouping === "group"`: Elements inside the same `<g>` group (or root) are paired into outer + holes,
 *   while stripping any full-artboard background `<rect>`.
 */
export function parseSVG(
  svgText: string,
  unit: SvgUnit = "auto",
  grouping: SvgGrouping = "path",
  fileName = "shape.svg"
): Shape[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  const svgEl = doc.querySelector("svg");
  if (!svgEl) {
    throw new Error("ملف SVG غير صالح");
  }

  const scale = resolveSvgScale(svgEl, unit);
  const baseName = fileName.replace(/\.[a-z0-9]+$/i, "");

  // Detect SVG viewBox dimensions in mm to ignore full-canvas background/artboard rectangles
  let viewBoxW = 0;
  let viewBoxH = 0;
  const vbAttr = svgEl.getAttribute("viewBox")?.trim();
  if (vbAttr) {
    const vbNums = vbAttr.split(/[\s,]+/).map(Number);
    if (vbNums.length === 4 && vbNums[2] > 0 && vbNums[3] > 0) {
      viewBoxW = vbNums[2] * scale;
      viewBoxH = vbNums[3] * scale;
    }
  }

  const geomEls = Array.from(
    svgEl.querySelectorAll("path, rect, circle, ellipse, polygon, polyline")
  ).filter((el) => {
    // Ignore elements inside <defs>, <clipPath>, or <mask>
    if (el.closest("defs, clipPath, mask, pattern, symbol")) return false;
    const cls = el.getAttribute("class") || "";
    const id = el.getAttribute("id") || "";
    if (cls.includes("sheet-border") || id.toLowerCase().includes("artboard")) return false;
    return true;
  });

  const classifiedList: { outer: Polygon; holes: Polygon[] }[] = [];

  if (grouping === "path") {
    // Each SVG geometry element is evaluated independently for compound subpaths,
    // then deduplicated across elements so separate shapes NEVER turn into holes of each other!
    const rawElementPolys: { outer: Polygon; holes: Polygon[]; bb: ReturnType<typeof getBBox>; area: number }[] = [];
    for (const el of geomEls) {
      const rings = elementToPolygons(el, scale);
      if (rings.length === 0) continue;
      // Within a single <path d="M...Z M...Z">, subpaths can be compound holes of that path
      const parts = classifyOutersAndHoles(rings, { stripArtboardContainer: false, allowHoles: true });
      for (const p of parts) {
        const bb = getBBox(p.outer);
        const area = polygonArea(p.outer);
        if (bb.w < 0.5 || bb.h < 0.5 || area < 0.25) continue;
        rawElementPolys.push({ outer: p.outer, holes: p.holes, bb, area });
      }
    }

    // Filter out any full-viewBox artboard background rectangle if there are other parts
    const filtered =
      rawElementPolys.length > 1 && viewBoxW > 0 && viewBoxH > 0
        ? rawElementPolys.filter((item) => {
            const isFullArtboardRect =
              item.holes.length === 0 &&
              Math.abs(item.bb.w - viewBoxW) <= Math.max(2, viewBoxW * 0.03) &&
              Math.abs(item.bb.h - viewBoxH) <= Math.max(2, viewBoxH * 0.03) &&
              item.area / Math.max(1, item.bb.w * item.bb.h) > 0.94;
            return !isFullArtboardRect;
          })
        : rawElementPolys;

    // Deduplicate identical Fill + Stroke elements at the exact same location
    const deduped: typeof filtered = [];
    for (const item of filtered) {
      const isDup = deduped.some((ex) => isDuplicateContour(ex, item));
      if (!isDup) {
        deduped.push(item);
        classifiedList.push({ outer: item.outer, holes: item.holes });
      }
    }
  } else {
    // grouping === "group": Combine rings into outer + holes (stripping artboard container if present)
    const allRings: Polygon[] = [];
    for (const el of geomEls) {
      allRings.push(...elementToPolygons(el, scale));
    }
    classifiedList.push(
      ...classifyOutersAndHoles(allRings, { stripArtboardContainer: true, allowHoles: true })
    );
  }

  const shapes: Shape[] = [];
  classifiedList.forEach((item, idx) => {
    const norm = normalizeShapeGeometry(item.outer, item.holes);
    if (norm.w >= 0.5 && norm.h >= 0.5) {
      shapes.push({
        id: uid("svg"),
        name:
          classifiedList.length === 1
            ? baseName
            : `${baseName} #${idx + 1}`,
        points: norm.points,
        holes: norm.holes,
        qty: 1,
        fill: false,
        enabled: true,
        color: nextColor(),
        source: "svg",
        origX: norm.origX,
        origY: norm.origY,
        w: norm.w,
        h: norm.h,
      });
    }
  });

  if (!shapes.length) {
    throw new Error("لم يتم العثور على مسارات مغلقة صالحة داخل ملف SVG");
  }
  return shapes;
}

/**
 * Parse JSON exported from either CorelDRAW VBA Macro or Illustrator ExtendScript JSX.
 * Keeps each exported object independent (never absorbs separate selected objects as holes!),
 * while validating compound subpaths so disjoint islands become standalone parts and only strict interior subpaths become holes.
 */
export function parseCADJsonExport(
  jsonText: string
): { shapes: Shape[]; doc?: string; host: "corel" | "ai" } {
  const cleanText = jsonText.replace(/^\uFEFF/, "").trim();
  const data = JSON.parse(cleanText);
  const rawItems: any[] = Array.isArray(data) ? data : data.shapes || data.items || [];
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new Error("ملف JSON لا يحتوي على عناصر صالحة");
  }

  const isCorel =
    data.host === "corel" ||
    data.app === "CorelDRAW" ||
    rawItems.some((it) => it.source === "corel" || it.staticId !== undefined);
  const source: ShapeSource = isCorel ? "corel" : "ai";

  interface CandidateShape {
    name: string;
    origId: string;
    qty: number;
    fill: boolean;
    color?: string;
    outer: Polygon;
    holes: Polygon[];
    bb: ReturnType<typeof getBBox>;
    area: number;
  }

  const candidates: CandidateShape[] = [];

  rawItems.forEach((item, idx) => {
    const rawOuter: any[] = item.points || item.outer || item.path || [];
    const pts: Polygon = rawOuter
      .map((p: any) =>
        Array.isArray(p) ? { x: Number(p[0]), y: Number(p[1]) } : { x: Number(p.x), y: Number(p.y) }
      )
      .filter((p) => !isNaN(p.x) && !isNaN(p.y));

    if (pts.length < 3) return;

    const rawHoles: any[][] = item.holes || [];
    const holeRings: Polygon[] = rawHoles
      .map((h) =>
        h
          .map((p: any) =>
            Array.isArray(p) ? { x: Number(p[0]), y: Number(p[1]) } : { x: Number(p.x), y: Number(p.y) }
          )
          .filter((p) => !isNaN(p.x) && !isNaN(p.y))
      )
      .filter((h) => h.length >= 3)
      .map((h) => simplifyPolygon(h, 0.08));

    const simplifiedOuter = simplifyPolygon(pts, 0.08);
    if (simplifiedOuter.length < 3) return;

    const baseItemName =
      item.name || `${isCorel ? "عنصر كوريل" : "عنصر إليستريتور"} #${idx + 1}`;
    const origId = String(item.origId ?? item.staticId ?? item.tag ?? idx + 1);
    const qty = Math.max(1, Number(item.qty) || 1);
    const fill = Boolean(item.fill);

    if (holeRings.length === 0) {
      const bb = getBBox(simplifiedOuter);
      const area = polygonArea(simplifiedOuter);
      if (bb.w >= 0.2 && bb.h >= 0.2 && area >= 0.25) {
        candidates.push({
          name: baseItemName,
          origId,
          qty,
          fill,
          color: item.color,
          outer: simplifiedOuter,
          holes: [],
          bb,
          area,
        });
      }
    } else {
      // Validate compound subpaths: separate disjoint islands into standalone parts
      // and keep only genuine strict interior subpaths as holes!
      const classified = classifyOutersAndHoles([simplifiedOuter, ...holeRings], {
        stripArtboardContainer: false,
        allowHoles: true,
      });
      classified.forEach((part, subIdx) => {
        const bb = getBBox(part.outer);
        const area = polygonArea(part.outer);
        if (bb.w < 0.2 || bb.h < 0.2 || area < 0.25) return;
        candidates.push({
          name: classified.length === 1 ? baseItemName : `${baseItemName} (${subIdx + 1})`,
          origId: classified.length === 1 ? origId : `${origId}_${subIdx + 1}`,
          qty,
          fill,
          color: item.color,
          outer: part.outer,
          holes: part.holes,
          bb,
          area,
        });
      });
    }
  });

  // Deduplicate identical overlapping contours (e.g. if a Group had both a Fill path and a Stroke path at the same position)
  const deduped: CandidateShape[] = [];
  for (const cand of candidates) {
    const isDup = deduped.some(
      (ex) => ex.holes.length === cand.holes.length && isDuplicateContour(ex, cand)
    );
    if (!isDup) {
      deduped.push(cand);
    }
  }

  const out: Shape[] = [];
  deduped.forEach((item) => {
    const norm = normalizeShapeGeometry(item.outer, item.holes);
    out.push({
      id: uid(source),
      name: item.name,
      points: norm.points,
      holes: norm.holes,
      qty: item.qty,
      fill: item.fill,
      enabled: true,
      color: item.color || nextColor(),
      source,
      origId: item.origId,
      origX: norm.origX,
      origY: norm.origY,
      w: norm.w,
      h: norm.h,
    });
  });

  if (!out.length) {
    throw new Error("تعذر استخراج أشكال هندسية صالحة من ملف JSON");
  }

  return {
    shapes: out,
    doc: data.doc || data.documentName || undefined,
    host: isCorel ? "corel" : "ai",
  };
}

export function parseAIExport(jsonText: string): { shapes: Shape[]; doc?: string } {
  const res = parseCADJsonExport(jsonText);
  return { shapes: res.shapes, doc: res.doc };
}

/**
 * Parse AutoCAD / CorelDRAW DXF files (LWPOLYLINE, POLYLINE, CIRCLE, LINE).
 */
export function parseDXF(dxfText: string, fileName = "drawing.dxf"): Shape[] {
  const lines = dxfText.replace(/\r\n/g, "\n").split("\n");
  const rings: Polygon[] = [];
  const lineSegments: { p1: Point; p2: Point }[] = [];

  let i = 0;
  const nextPair = (): { code: number; val: string } | null => {
    while (i < lines.length && lines[i].trim() === "") i++;
    if (i + 1 >= lines.length) return null;
    const code = parseInt(lines[i].trim(), 10);
    const val = lines[i + 1].trim();
    i += 2;
    return { code, val };
  };

  while (i < lines.length) {
    const pair = nextPair();
    if (!pair) break;
    if (pair.code === 0 && pair.val === "LWPOLYLINE") {
      const poly: Polygon = [];
      let curX: number | null = null;
      while (i < lines.length) {
        const saveI = i;
        const p = nextPair();
        if (!p || p.code === 0) {
          i = saveI;
          break;
        }
        if (p.code === 10) {
          curX = parseFloat(p.val);
        } else if (p.code === 20 && curX !== null) {
          poly.push({ x: curX, y: -parseFloat(p.val) });
          curX = null;
        }
      }
      if (poly.length >= 3) rings.push(simplifyPolygon(poly, 0.1));
    } else if (pair.code === 0 && pair.val === "POLYLINE") {
      const poly: Polygon = [];
      let layerName = "";
      while (i < lines.length) {
        const p = nextPair();
        if (!p) break;
        if (p.code === 8 && !layerName) layerName = p.val.toUpperCase();
        if (p.code === 0 && p.val === "SEQEND") break;
        if (p.code === 0 && p.val === "VERTEX") {
          let vx: number | null = null;
          let vy: number | null = null;
          while (i < lines.length) {
            const saveI = i;
            const vp = nextPair();
            if (!vp || vp.code === 0) {
              i = saveI;
              break;
            }
            if (vp.code === 10) vx = parseFloat(vp.val);
            else if (vp.code === 20) vy = -parseFloat(vp.val);
          }
          if (vx !== null && vy !== null) {
            poly.push({ x: vx, y: vy });
          }
        }
      }
      if (poly.length >= 3 && layerName !== "SHEET_BORDER") {
        rings.push(simplifyPolygon(poly, 0.1));
      }
    } else if (pair.code === 0 && pair.val === "CIRCLE") {
      let cx = 0;
      let cy = 0;
      let r = 0;
      while (i < lines.length) {
        const saveI = i;
        const p = nextPair();
        if (!p || p.code === 0) {
          i = saveI;
          break;
        }
        if (p.code === 10) cx = parseFloat(p.val);
        else if (p.code === 20) cy = -parseFloat(p.val);
        else if (p.code === 40) r = parseFloat(p.val);
      }
      if (r > 0) {
        const circlePts: Polygon = [];
        for (let k = 0; k < 36; k++) {
          const a = (k * 2 * Math.PI) / 36;
          circlePts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
        }
        rings.push(circlePts);
      }
    } else if (pair.code === 0 && pair.val === "LINE") {
      let x1 = 0,
        y1 = 0,
        x2 = 0,
        y2 = 0;
      while (i < lines.length) {
        const saveI = i;
        const p = nextPair();
        if (!p || p.code === 0) {
          i = saveI;
          break;
        }
        if (p.code === 10) x1 = parseFloat(p.val);
        else if (p.code === 20) y1 = -parseFloat(p.val);
        else if (p.code === 11) x2 = parseFloat(p.val);
        else if (p.code === 21) y2 = -parseFloat(p.val);
      }
      if (Math.hypot(x2 - x1, y2 - y1) > 0.05) {
        lineSegments.push({ p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 } });
      }
    }
  }

  // Chain standalone LINE segments into closed loops if present
  if (lineSegments.length >= 3) {
    const used = new Uint8Array(lineSegments.length);
    for (let s = 0; s < lineSegments.length; s++) {
      if (used[s]) continue;
      used[s] = 1;
      const chain: Polygon = [lineSegments[s].p1, lineSegments[s].p2];
      let extended = true;
      while (extended) {
        extended = false;
        const tail = chain[chain.length - 1];
        for (let k = 0; k < lineSegments.length; k++) {
          if (used[k]) continue;
          const seg = lineSegments[k];
          if (Math.hypot(seg.p1.x - tail.x, seg.p1.y - tail.y) < 0.5) {
            chain.push(seg.p2);
            used[k] = 1;
            extended = true;
            break;
          } else if (Math.hypot(seg.p2.x - tail.x, seg.p2.y - tail.y) < 0.5) {
            chain.push(seg.p1);
            used[k] = 1;
            extended = true;
            break;
          }
        }
      }
      if (chain.length >= 3) {
        rings.push(simplifyPolygon(chain, 0.1));
      }
    }
  }

  const classified = classifyOutersAndHoles(rings);
  const baseName = fileName.replace(/\.dxf$/i, "");
  const shapes: Shape[] = classified
    .map((c, idx) => {
      const norm = normalizeShapeGeometry(c.outer, c.holes);
      return {
        id: uid("dxf"),
        name: `${baseName} #${idx + 1}`,
        points: norm.points,
        holes: norm.holes,
        qty: 1,
        fill: false,
        enabled: true,
        color: nextColor(),
        source: "dxf" as const,
        origX: norm.origX,
        origY: norm.origY,
        w: norm.w,
        h: norm.h,
      };
    })
    .filter((s) => s.w >= 0.5 && s.h >= 0.5);

  if (!shapes.length) {
    throw new Error("لم يتم العثور على مضلعات مغلقة (LWPOLYLINE / CIRCLE / LINE) داخل ملف DXF");
  }
  return shapes;
}

/**
 * Create rich, realistic industrial & signage CAD demo parts with inner holes and angled edges.
 */
export function demoShapes(): Shape[] {
  // 1. Industrial Gear Ring with large inner cutout (180mm outer, 96mm inner hole)
  const gearOuter: Polygon = [];
  const teeth = 12;
  for (let i = 0; i < teeth * 4; i++) {
    const angle = (i * 2 * Math.PI) / (teeth * 4);
    const r = i % 4 < 2 ? 90 : 76;
    gearOuter.push({ x: 90 + r * Math.cos(angle), y: 90 + r * Math.sin(angle) });
  }
  const gearHole: Polygon = [];
  for (let i = 0; i < 32; i++) {
    const angle = (i * 2 * Math.PI) / 32;
    gearHole.push({ x: 90 + 48 * Math.cos(angle), y: 90 + 48 * Math.sin(angle) });
  }
  const normGear = normalizeShapeGeometry(gearOuter, [gearHole]);

  // 2. Acrylic Signage Frame with rectangular window hole (220x140mm outer, 140x70mm hole)
  const frameOuter: Polygon = [
    { x: 0, y: 0 },
    { x: 220, y: 0 },
    { x: 220, y: 140 },
    { x: 0, y: 140 },
  ];
  const frameHole: Polygon = [
    { x: 40, y: 35 },
    { x: 180, y: 35 },
    { x: 180, y: 105 },
    { x: 40, y: 105 },
  ];
  const normFrame = normalizeShapeGeometry(frameOuter, [frameHole]);

  // 3. CNC Angled L-Bracket with 45° Gusset (150x120mm)
  const bracketOuter: Polygon = [
    { x: 0, y: 0 },
    { x: 150, y: 0 },
    { x: 150, y: 42 },
    { x: 65, y: 42 },
    { x: 42, y: 65 },
    { x: 42, y: 120 },
    { x: 0, y: 120 },
  ];
  const normBracket = normalizeShapeGeometry(bracketOuter, []);

  // 4. Crescent Flange / Arc Cam (130x85mm)
  const crescentOuter: Polygon = [];
  for (let i = 0; i <= 20; i++) {
    const a = (Math.PI * i) / 20;
    crescentOuter.push({ x: 65 + 65 * Math.cos(a), y: 65 * Math.sin(a) });
  }
  for (let i = 20; i >= 0; i--) {
    const a = (Math.PI * i) / 20;
    crescentOuter.push({ x: 65 + 32 * Math.cos(a), y: 12 + 32 * Math.sin(a) });
  }
  const normCrescent = normalizeShapeGeometry(crescentOuter, []);

  // 5. Star / Rosette Sign Badge (58x58mm — fits inside gear and frame holes!)
  const starOuter: Polygon = [];
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const r = i % 2 === 0 ? 29 : 14;
    starOuter.push({ x: 29 + r * Math.cos(a), y: 29 + r * Math.sin(a) });
  }
  const normStar = normalizeShapeGeometry(starOuter, []);

  // 6. Small Hex Lock Washer (36x31mm — great for hole & corner packing!)
  const hexOuter: Polygon = [];
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    hexOuter.push({ x: 18 + 18 * Math.cos(a), y: 18 + 18 * Math.sin(a) });
  }
  const normHex = normalizeShapeGeometry(hexOuter, []);

  return [
    {
      id: uid("demo"),
      name: "ترس صناعي مفرّغ (Gear Ring)",
      points: normGear.points,
      holes: normGear.holes,
      qty: 4,
      fill: false,
      enabled: true,
      color: "#10b981",
      source: "demo",
      w: normGear.w,
      h: normGear.h,
    },
    {
      id: uid("demo"),
      name: "إطار يافطة أكريليك (Sign Frame)",
      points: normFrame.points,
      holes: normFrame.holes,
      qty: 3,
      fill: false,
      enabled: true,
      color: "#06b6d4",
      source: "demo",
      w: normFrame.w,
      h: normFrame.h,
    },
    {
      id: uid("demo"),
      name: "زاوية تثبيت CNC (L-Bracket)",
      points: normBracket.points,
      holes: normBracket.holes,
      qty: 6,
      fill: false,
      enabled: true,
      color: "#3b82f6",
      source: "demo",
      w: normBracket.w,
      h: normBracket.h,
    },
    {
      id: uid("demo"),
      name: "ذراع هلالي (Crescent Cam)",
      points: normCrescent.points,
      holes: normCrescent.holes,
      qty: 6,
      fill: false,
      enabled: true,
      color: "#f59e0b",
      source: "demo",
      w: normCrescent.w,
      h: normCrescent.h,
    },
    {
      id: uid("demo"),
      name: "نجمة ديكور (تُعشّق داخل الفتحات)",
      points: normStar.points,
      holes: normStar.holes,
      qty: 10,
      fill: false,
      enabled: true,
      color: "#ec4899",
      source: "demo",
      w: normStar.w,
      h: normStar.h,
    },
    {
      id: uid("demo"),
      name: "سداسي تثبيت صغير (Hex Spacer)",
      points: normHex.points,
      holes: normHex.holes,
      qty: 14,
      fill: false,
      enabled: true,
      color: "#8b5cf6",
      source: "demo",
      w: normHex.w,
      h: normHex.h,
    },
  ];
}
