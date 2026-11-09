import {
  detectDominantEdgeAngles,
  getBBox,
  pointInPolygon,
  polygonArea,
  rotatePolygon,
  shapeArea,
  translatePolygon,
} from "./geometry";
import type {
  NestSettings,
  NestSnapshot,
  Placement,
  Polygon,
  Shape,
  UnplacedItem,
} from "./types";

export interface RasterMask {
  angle: number;
  /** Width in grid cells */
  wCells: number;
  /** Height in grid cells */
  hCells: number;
  /** Number of 32-bit words per row: Math.ceil(wCells / 32) */
  wordsPerRow: number;
  /** Tight mask of the part (outer minus holes if holes=true) */
  tightBits: Uint32Array;
  /** Dilated mask by spacing+kerf for collision checking */
  dilatedBits: Uint32Array;
  /** Exact rotated bounding box in mm */
  bboxW: number;
  bboxH: number;
  /** A guaranteed solid cell (x, y) on the part for point-in-hole verification */
  sampleSolidX: number;
  sampleSolidY: number;
  /** Rotated outer polygon normalized to (0,0) in mm */
  normOuterMm: Polygon;
  /** Rotated outer polygon normalized to (0,0) in grid cells (sampled vertices for fast hole containment) */
  normOuterCells: Polygon;
  /** Rotated hole polygons normalized to outer (0,0) in mm */
  normHolesMm: Polygon[];
}

export interface PlacedHoleRegion {
  sheetIdx: number;
  parentShapeId: string;
  minGX: number;
  minGY: number;
  maxGX: number;
  maxGY: number;
  /** Hole polygon in sheet grid cell coordinates */
  holePolyCells: Polygon;
}

/**
 * Scanline polygon rasterizer into a Uint8Array grid of size (wCells x hCells).
 * Uses sub-cell center sampling so outer contours are not artificially bloated
 * and inner holes are not artificially shrunk.
 */
function scanlineFillPolygon(
  poly: Polygon,
  wCells: number,
  hCells: number,
  cellSize: number,
  grid: Uint8Array,
  fillValue: 0 | 1
): void {
  const n = poly.length;
  if (n < 3) return;
  const xIntersections: number[] = [];

  for (let row = 0; row < hCells; row++) {
    const y = (row + 0.5) * cellSize;
    xIntersections.length = 0;

    for (let i = 0, j = n - 1; i < n; j = i++) {
      const p1 = poly[j];
      const p2 = poly[i];
      if ((p1.y <= y && p2.y > y) || (p2.y <= y && p1.y > y)) {
        const x = p1.x + ((y - p1.y) * (p2.x - p1.x)) / (p2.y - p1.y);
        xIntersections.push(x);
      }
    }

    xIntersections.sort((a, b) => a - b);
    const rowOffset = row * wCells;

    if (fillValue === 1) {
      for (let k = 0; k < xIntersections.length - 1; k += 2) {
        const xLeft = xIntersections[k] / cellSize;
        const xRight = xIntersections[k + 1] / cellSize;
        const xStart = Math.max(0, Math.ceil(xLeft - 0.5));
        const xEnd = Math.min(wCells - 1, Math.floor(xRight - 0.5));
        if (xEnd >= xStart) {
          for (let col = xStart; col <= xEnd; col++) {
            grid[rowOffset + col] = 1;
          }
        } else {
          const midCol = Math.min(wCells - 1, Math.max(0, Math.floor((xLeft + xRight) * 0.5)));
          grid[rowOffset + midCol] = 1;
        }
      }
    } else {
      // Carving a hole (fillValue === 0): clear all cells whose center lies inside the hole
      for (let k = 0; k < xIntersections.length - 1; k += 2) {
        const xLeft = xIntersections[k] / cellSize;
        const xRight = xIntersections[k + 1] / cellSize;
        const xStart = Math.max(0, Math.ceil(xLeft - 0.45));
        const xEnd = Math.min(wCells - 1, Math.floor(xRight - 0.55));
        for (let col = xStart; col <= xEnd; col++) {
          grid[rowOffset + col] = 0;
        }
      }
    }
  }

  // For solid outer boundaries (fillValue === 1), ensure perimeter cells are marked so thin walls never leak
  if (fillValue === 1) {
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const p1 = poly[j];
      const p2 = poly[i];
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const steps = Math.max(1, Math.ceil(dist / (cellSize * 0.6)));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const cx = Math.min(
          wCells - 1,
          Math.max(0, Math.floor((p1.x + (p2.x - p1.x) * t) / cellSize))
        );
        const cy = Math.min(
          hCells - 1,
          Math.max(0, Math.floor((p1.y + (p2.y - p1.y) * t) / cellSize))
        );
        grid[cy * wCells + cx] = 1;
      }
    }
  }
}

/**
 * Dilate a binary Uint8Array grid by `radius` cells using an exact Euclidean disk stencil
 * so circular holes and angled edges are not clipped by square corners.
 */
function dilateGrid(
  src: Uint8Array,
  w: number,
  h: number,
  radius: number
): Uint8Array {
  if (radius <= 0) return new Uint8Array(src);
  const rInt = Math.ceil(radius);
  const rSq = (radius + 0.15) * (radius + 0.15);
  const offsets: { dx: number; dy: number }[] = [];
  for (let dy = -rInt; dy <= rInt; dy++) {
    for (let dx = -rInt; dx <= rInt; dx++) {
      if (dx * dx + dy * dy <= rSq) {
        offsets.push({ dx, dy });
      }
    }
  }

  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const rowOff = y * w;
    for (let x = 0; x < w; x++) {
      if (src[rowOff + x] === 0) continue;
      for (let k = 0; k < offsets.length; k++) {
        const nx = x + offsets[k].dx;
        const ny = y + offsets[k].dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
          out[ny * w + nx] = 1;
        }
      }
    }
  }
  return out;
}

function packBits(grid: Uint8Array, w: number, h: number): { bits: Uint32Array; wordsPerRow: number } {
  const wordsPerRow = Math.ceil(w / 32);
  const bits = new Uint32Array(wordsPerRow * h);
  for (let y = 0; y < h; y++) {
    const rowOff = y * w;
    const bitRowOff = y * wordsPerRow;
    for (let x = 0; x < w; x++) {
      if (grid[rowOff + x]) {
        bits[bitRowOff + (x >>> 5)] |= 1 << (x & 31);
      }
    }
  }
  return { bits, wordsPerRow };
}

/**
 * Build candidate rotation angles for a shape based on settings and shape constraints.
 */
export function getCandidateAngles(shape: Shape, st: NestSettings): number[] {
  if (shape.lockRotation || st.rotStep >= 360) {
    return [0];
  }
  if (shape.grainLock) {
    return [0, 180];
  }
  const step = Math.max(1, Math.min(360, st.rotStep));
  const angleSet = new Set<number>([0, 90, 180, 270]);
  for (let a = 0; a < 360; a += step) {
    angleSet.add(Math.round(a * 10) / 10);
  }
  if (st.edgeAlign) {
    const dom = detectDominantEdgeAngles(shape.points, 3);
    for (const d of dom) {
      angleSet.add(Math.round(d * 10) / 10);
      angleSet.add(Math.round(((d + 90) % 360) * 10) / 10);
      angleSet.add(Math.round(((d + 180) % 360) * 10) / 10);
    }
  }
  return Array.from(angleSet).sort((a, b) => a - b);
}

/**
 * Rasterize a shape at a specific angle into a 32-bit packed mask.
 * - `tightBits` is packed from the 100% SOLID outer contour so a part being placed can NEVER
 *   straddle or be placed on top of an already-placed part.
 * - `dilatedBits` (stamped onto the sheet after placement) carves out genuine large holes (>= 10x10 mm)
 *   when `allowHoles` is true, allowing subsequent smaller parts to nest cleanly inside those holes.
 */
export function buildRasterMask(
  shape: Shape,
  angle: number,
  cellSize: number,
  clearanceCells: number,
  allowHoles: boolean
): RasterMask {
  const rotOuter = rotatePolygon(shape.points, angle);
  const rbb = getBBox(rotOuter);
  const normOuter = translatePolygon(rotOuter, -rbb.minX, -rbb.minY);
  const wCells = Math.max(1, Math.ceil(rbb.w / cellSize));
  const hCells = Math.max(1, Math.ceil(rbb.h / cellSize));

  // 1. Solid outer contour grid — used for `tightBits` collision testing so this part never overlaps existing parts
  const solidGrid = new Uint8Array(wCells * hCells);
  scanlineFillPolygon(normOuter, wCells, hCells, cellSize, solidGrid, 1);
  const { bits: tightBits, wordsPerRow } = packBits(solidGrid, wCells, hCells);

  // 2. Stamp grid — carves out genuine nestable holes (>= 10x10 mm) when allowHoles=true before dilating by spacing+kerf
  const stampGrid = new Uint8Array(solidGrid);
  const normHolesMm: Polygon[] = [];
  if (shape.holes && shape.holes.length > 0) {
    let carvedAnyHole = false;
    for (const h of shape.holes) {
      const rotHole = translatePolygon(rotatePolygon(h, angle), -rbb.minX, -rbb.minY);
      normHolesMm.push(rotHole);
      if (allowHoles) {
        const hbb = getBBox(rotHole);
        // Only carve holes in the raster occupancy grid if they are large enough (>= 10x10mm) to potentially fit a part
        if (hbb.w >= 10 && hbb.h >= 10 && polygonArea(rotHole) >= 60) {
          scanlineFillPolygon(rotHole, wCells, hCells, cellSize, stampGrid, 0);
          carvedAnyHole = true;
        }
      }
    }
    if (carvedAnyHole) {
      // Re-mark outer contour boundary so thin outer walls remain unbroken
      const n = normOuter.length;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const p1 = normOuter[j];
        const p2 = normOuter[i];
        const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const steps = Math.max(1, Math.ceil(dist / (cellSize * 0.6)));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const cx = Math.min(
            wCells - 1,
            Math.max(0, Math.floor((p1.x + (p2.x - p1.x) * t) / cellSize))
          );
          const cy = Math.min(
            hCells - 1,
            Math.max(0, Math.floor((p1.y + (p2.y - p1.y) * t) / cellSize))
          );
          stampGrid[cy * wCells + cx] = 1;
        }
      }
    }
  }

  const dilatedGrid = dilateGrid(stampGrid, wCells, hCells, clearanceCells);
  const { bits: dilatedBits } = packBits(dilatedGrid, wCells, hCells);

  // Pick a solid cell near the center of the part
  let sampleSolidX = Math.floor(wCells / 2);
  let sampleSolidY = Math.floor(hCells / 2);
  if (!stampGrid[sampleSolidY * wCells + sampleSolidX]) {
    foundSolid: for (let y = 0; y < hCells; y++) {
      const rowOff = y * wCells;
      for (let x = 0; x < wCells; x++) {
        if (stampGrid[rowOff + x]) {
          sampleSolidX = x;
          sampleSolidY = y;
          break foundSolid;
        }
      }
    }
  }

  const stepV = Math.max(1, Math.floor(normOuter.length / 16));
  const normOuterCells: Polygon = [];
  for (let i = 0; i < normOuter.length; i += stepV) {
    normOuterCells.push({
      x: normOuter[i].x / cellSize,
      y: normOuter[i].y / cellSize,
    });
  }

  return {
    angle,
    wCells,
    hCells,
    wordsPerRow,
    tightBits,
    dilatedBits,
    bboxW: rbb.w,
    bboxH: rbb.h,
    sampleSolidX,
    sampleSolidY,
    normOuterMm: normOuter,
    normOuterCells,
    normHolesMm,
  };
}

class SheetBitGrid {
  readonly wCells: number;
  readonly hCells: number;
  readonly wordsPerRow: number;
  readonly bits: Uint32Array;
  maxUsedX = 0;
  maxUsedY = 0;

  constructor(wCells: number, hCells: number) {
    this.wCells = wCells;
    this.hCells = hCells;
    this.wordsPerRow = Math.ceil(wCells / 32);
    this.bits = new Uint32Array(this.wordsPerRow * hCells);
  }

  /**
   * Test if `mask.tightBits` collides with `this.bits` at cell offset `(gx, gy)`.
   */
  canPlace(mask: RasterMask, gx: number, gy: number): boolean {
    if (gx < 0 || gy < 0 || gx + mask.wCells > this.wCells || gy + mask.hCells > this.hCells) {
      return false;
    }
    const wordStart = gx >>> 5;
    const bitShift = gx & 31;
    const maskWords = mask.wordsPerRow;
    const sheetWords = this.wordsPerRow;

    if (bitShift === 0) {
      for (let r = 0; r < mask.hCells; r++) {
        const sOff = (gy + r) * sheetWords + wordStart;
        const mOff = r * maskWords;
        for (let w = 0; w < maskWords; w++) {
          if ((this.bits[sOff + w] & mask.tightBits[mOff + w]) !== 0) {
            return false;
          }
        }
      }
    } else {
      const invShift = 32 - bitShift;
      for (let r = 0; r < mask.hCells; r++) {
        const sOff = (gy + r) * sheetWords + wordStart;
        const mOff = r * maskWords;
        for (let w = 0; w < maskWords; w++) {
          const mVal = mask.tightBits[mOff + w];
          if (mVal === 0) continue;
          const lo = mVal << bitShift;
          if ((this.bits[sOff + w] & lo) !== 0) return false;
          const hi = mVal >>> invShift;
          if (hi !== 0 && (this.bits[sOff + w + 1] & hi) !== 0) return false;
        }
      }
    }
    return true;
  }

  /**
   * Stamp `mask.dilatedBits` onto `this.bits` at `(gx, gy)`.
   */
  stamp(mask: RasterMask, gx: number, gy: number): void {
    const wordStart = gx >>> 5;
    const bitShift = gx & 31;
    const maskWords = mask.wordsPerRow;
    const sheetWords = this.wordsPerRow;

    if (bitShift === 0) {
      for (let r = 0; r < mask.hCells; r++) {
        const sOff = (gy + r) * sheetWords + wordStart;
        const mOff = r * maskWords;
        for (let w = 0; w < maskWords; w++) {
          this.bits[sOff + w] |= mask.dilatedBits[mOff + w];
        }
      }
    } else {
      const invShift = 32 - bitShift;
      for (let r = 0; r < mask.hCells; r++) {
        const sOff = (gy + r) * sheetWords + wordStart;
        const mOff = r * maskWords;
        for (let w = 0; w < maskWords; w++) {
          const mVal = mask.dilatedBits[mOff + w];
          if (mVal === 0) continue;
          this.bits[sOff + w] |= mVal << bitShift;
          const hi = mVal >>> invShift;
          if (hi !== 0 && wordStart + w + 1 < sheetWords) {
            this.bits[sOff + w + 1] |= hi;
          }
        }
      }
    }

    if (gx + mask.wCells > this.maxUsedX) this.maxUsedX = gx + mask.wCells;
    if (gy + mask.hCells > this.maxUsedY) this.maxUsedY = gy + mask.hCells;
  }
}

export interface PartInstance {
  shape: Shape;
  instanceIdx: number;
  /** Outer contour area for parent-before-child ordering */
  outerArea: number;
  /** Net area for reporting */
  area: number;
  isFiller: boolean;
}

/**
 * Sequence cut order on each sheet using nearest-neighbor starting from origin (0,0)
 * so laser/CNC heads travel minimal rapid distance.
 */
function assignCutOrder(placements: Placement[], totalSheets: number): void {
  for (let s = 0; s < totalSheets; s++) {
    const sheetPlacements = placements.filter((p) => p.sheet === s);
    const visited = new Set<Placement>();
    let curX = 0;
    let curY = 0;
    let order = 1;
    while (visited.size < sheetPlacements.length) {
      let bestP: Placement | null = null;
      let bestDist = Infinity;
      for (const p of sheetPlacements) {
        if (visited.has(p)) continue;
        const d = Math.hypot(p.x - curX, p.y - curY);
        if (d < bestDist) {
          bestDist = d;
          bestP = p;
        }
      }
      if (!bestP) break;
      visited.add(bestP);
      bestP.cutOrder = order++;
      curX = bestP.x;
      curY = bestP.y;
    }
  }
}

/**
 * Evaluate placement score according to the selected strategy. Lower score = better position.
 * Balances strip compactness (saving reusable sheet remnant) with interlocking and orthogonal alignment.
 */
function scorePosition(
  gx: number,
  gy: number,
  mask: RasterMask,
  sheet: SheetBitGrid,
  strategy: NestSettings["strategy"]
): number {
  const rightEdge = gx + mask.wCells;
  const bottomEdge = gy + mask.hCells;
  const bboxArea = mask.wCells * mask.hCells;
  const nonOrthoPenalty = mask.angle % 90 === 0 ? 0 : 12;

  switch (strategy) {
    case "gravity-tl": {
      // Horizontal row packing (preserve bottom height remnant)
      const newMaxY = Math.max(sheet.maxUsedY, bottomEdge);
      const heightExpansion = Math.max(0, bottomEdge - sheet.maxUsedY);
      const widthExpansion = Math.max(0, rightEdge - sheet.maxUsedX);
      return (
        newMaxY * 90 +
        heightExpansion * 60 +
        widthExpansion * 25 +
        gx * 16 +
        rightEdge * 10 +
        gy * 18 +
        bottomEdge * 12 +
        bboxArea * 0.08 +
        nonOrthoPenalty
      );
    }
    case "squeeze": {
      // Corner squeeze toward (0,0)
      const newMaxX = Math.max(sheet.maxUsedX, rightEdge);
      const newMaxY = Math.max(sheet.maxUsedY, bottomEdge);
      return (
        newMaxX * 45 +
        newMaxY * 45 +
        (gx + rightEdge) * 14 +
        (gy + bottomEdge) * 14 +
        bboxArea * 0.08 +
        nonOrthoPenalty
      );
    }
    case "box-compact": {
      const newMaxX = Math.max(sheet.maxUsedX, rightEdge);
      const newMaxY = Math.max(sheet.maxUsedY, bottomEdge);
      return (
        newMaxX * newMaxY * 0.5 +
        (rightEdge + bottomEdge) * 20 +
        (gx + gy) * 10 +
        bboxArea * 0.08 +
        nonOrthoPenalty
      );
    }
    case "gravity-bl":
    default: {
      // Vertical column packing (preserve right width remnant while keeping columns balanced and dense)
      const newMaxX = Math.max(sheet.maxUsedX, rightEdge);
      const widthExpansion = Math.max(0, rightEdge - sheet.maxUsedX);
      const heightExpansion = Math.max(0, bottomEdge - sheet.maxUsedY);
      return (
        newMaxX * 90 +
        widthExpansion * 60 +
        heightExpansion * 25 +
        gy * 16 +
        bottomEdge * 10 +
        gx * 18 +
        rightEdge * 12 +
        bboxArea * 0.08 +
        nonOrthoPenalty
      );
    }
  }
}

function isMaskCompletelyInsideHole(
  mask: RasterMask,
  gx: number,
  gy: number,
  holePolyCells: Polygon
): boolean {
  const testCenter = {
    x: gx + mask.sampleSolidX + 0.5,
    y: gy + mask.sampleSolidY + 0.5,
  };
  if (!pointInPolygon(testCenter, holePolyCells)) return false;

  const verts = mask.normOuterCells;
  for (let i = 0; i < verts.length; i++) {
    const pt = { x: gx + verts[i].x, y: gy + verts[i].y };
    if (!pointInPolygon(pt, holePolyCells)) {
      return false;
    }
  }
  return true;
}

/**
 * Dedicated Pass 1: Search inside all holes of already-placed larger parts at 1-cell exact resolution!
 * Ensures small parts always nest inside large cutouts first (consuming 0% extra sheet area).
 */
function findPlacementInsideHoles(
  partShapeId: string,
  masks: RasterMask[],
  sheets: SheetBitGrid[],
  placedHoles: PlacedHoleRegion[],
  angleJitter = 0
): { sheetIdx: number; gx: number; gy: number; mask: RasterMask } | null {
  if (placedHoles.length === 0) return null;

  let bestHoleScore = Infinity;
  let bestChoice: { sheetIdx: number; gx: number; gy: number; mask: RasterMask } | null = null;

  for (let hIdx = 0; hIdx < placedHoles.length; hIdx++) {
    const hole = placedHoles[hIdx];
    // Avoid attempting to place an identical shape inside its own hole
    if (hole.parentShapeId === partShapeId) continue;

    const holeW = hole.maxGX - hole.minGX;
    const holeH = hole.maxGY - hole.minGY;
    const holeBBoxCells = holeW * holeH;
    const sheet = sheets[hole.sheetIdx];
    if (!sheet) continue;

    for (let mIdx = 0; mIdx < masks.length; mIdx++) {
      const mask = masks[(mIdx + angleJitter) % masks.length];
      if (mask.wCells > holeW || mask.hCells > holeH) continue;
      // Prevent a long low-solidity arch from blocking an entire window hole that can fit multiple small parts
      if (
        Math.max(mask.bboxW, mask.bboxH) > 115 &&
        mask.wCells * mask.hCells > holeBBoxCells * 0.72
      ) {
        continue;
      }

      const endGX = hole.maxGX - mask.wCells;
      const endGY = hole.maxGY - mask.hCells;

      // Scan inside the hole bounding box with exact 1-cell precision
      outerHX: for (let gx = hole.minGX; gx <= endGX; gx++) {
        for (let gy = hole.minGY; gy <= endGY; gy++) {
          if (
            sheet.canPlace(mask, gx, gy) &&
            isMaskCompletelyInsideHole(mask, gx, gy, hole.holePolyCells)
          ) {
            // Refine tightly toward top-left of the hole while staying completely inside the hole
            let rx = gx;
            let ry = gy;
            while (
              rx > hole.minGX &&
              sheet.canPlace(mask, rx - 1, ry) &&
              isMaskCompletelyInsideHole(mask, rx - 1, ry, hole.holePolyCells)
            ) {
              rx--;
            }
            while (
              ry > hole.minGY &&
              sheet.canPlace(mask, rx, ry - 1) &&
              isMaskCompletelyInsideHole(mask, rx, ry - 1, hole.holePolyCells)
            ) {
              ry--;
            }

            const sc =
              hole.sheetIdx * 1_000_000 +
              hIdx * 5_000 +
              (rx - hole.minGX) * 20 +
              (ry - hole.minGY) * 15 +
              mask.wCells * mask.hCells * 0.05;

            if (sc < bestHoleScore) {
              bestHoleScore = sc;
              bestChoice = { sheetIdx: hole.sheetIdx, gx: rx, gy: ry, mask };
            }
            break outerHX;
          }
        }
      }
    }
    // If we found a valid fit in the earliest available hole, return it immediately
    if (bestChoice) return bestChoice;
  }

  return bestChoice;
}

/**
 * Find the best valid position and angle for a part across existing or new sheets.
 */
function findBestPlacementForPart(
  partShapeId: string,
  masks: RasterMask[],
  sheets: SheetBitGrid[],
  placedHoles: PlacedHoleRegion[],
  allowHoles: boolean,
  maxSheets: number,
  wCells: number,
  hCells: number,
  strategy: NestSettings["strategy"],
  angleJitter = 0
): { sheetIdx: number; gx: number; gy: number; mask: RasterMask } | null {
  // PASS 1: Try nesting inside holes of already-placed parts first (100% free sheet space!)
  if (allowHoles && placedHoles.length > 0) {
    const holePlacement = findPlacementInsideHoles(
      partShapeId,
      masks,
      sheets,
      placedHoles,
      angleJitter
    );
    if (holePlacement) {
      return holePlacement;
    }
  }

  // PASS 2: Search existing sheets for the most compact gravity & pocket placement
  for (let sIdx = 0; sIdx < sheets.length; sIdx++) {
    const sheet = sheets[sIdx];
    let bestScore = Infinity;
    let bestChoice: { sheetIdx: number; gx: number; gy: number; mask: RasterMask } | null = null;

    const scanStep = Math.max(2, Math.floor(Math.min(wCells, hCells) / 180));

    for (let mIdx = 0; mIdx < masks.length; mIdx++) {
      const mask = masks[(mIdx + angleJitter) % masks.length];
      if (mask.wCells > wCells || mask.hCells > hCells) continue;

      const maxX = wCells - mask.wCells;
      const maxY = hCells - mask.hCells;
      const bboxArea = mask.wCells * mask.hCells;
      const nonOrthoPenalty = mask.angle % 90 === 0 ? 0 : 12;

      if (strategy === "gravity-tl") {
        // Scan Y outer, X inner, checking every pocket transition
        outerY: for (let gy = 0; gy <= maxY; gy += scanStep) {
          const bottomEdge = gy + mask.hCells;
          const heightExpansion = Math.max(0, bottomEdge - sheet.maxUsedY);
          const minPossibleScore =
            Math.max(sheet.maxUsedY, bottomEdge) * 90 +
            heightExpansion * 60 +
            gy * 18 +
            bottomEdge * 12 +
            mask.wCells * 10 +
            bboxArea * 0.08 +
            nonOrthoPenalty;
          if (minPossibleScore >= bestScore) break outerY;

          let wasBlocked = true;
          let pocketsFound = 0;
          const limitX = Math.min(maxX, sheet.maxUsedX + scanStep * 2);
          for (let gx = 0; gx <= maxX; gx += scanStep) {
            if (sheet.canPlace(mask, gx, gy)) {
              if (wasBlocked) {
                wasBlocked = false;
                pocketsFound++;
                let rx = gx;
                let ry = gy;
                while (ry > 0 && sheet.canPlace(mask, rx, ry - 1)) ry--;
                while (rx > 0 && sheet.canPlace(mask, rx - 1, ry)) rx--;
                const sc = scorePosition(rx, ry, mask, sheet, strategy);
                if (sc < bestScore) {
                  bestScore = sc;
                  bestChoice = { sheetIdx: sIdx, gx: rx, gy: ry, mask };
                }
                if (pocketsFound >= 2 || gx >= limitX) break;
              }
            } else {
              wasBlocked = true;
            }
            if (pocketsFound >= 1 && gx > limitX) break;
          }
        }
      } else {
        // Default: Scan X outer, Y inner, checking up to 2 pocket transitions in the column
        outerX: for (let gx = 0; gx <= maxX; gx += scanStep) {
          const rightEdge = gx + mask.wCells;
          if (strategy === "gravity-bl") {
            const widthExpansion = Math.max(0, rightEdge - sheet.maxUsedX);
            const minPossibleScore =
              Math.max(sheet.maxUsedX, rightEdge) * 90 +
              widthExpansion * 60 +
              gx * 18 +
              rightEdge * 12 +
              mask.hCells * 10 +
              bboxArea * 0.08 +
              nonOrthoPenalty;
            if (minPossibleScore >= bestScore) break outerX;
          }

          let wasBlocked = true;
          let pocketsFound = 0;
          const limitY = Math.min(maxY, sheet.maxUsedY + scanStep * 2);
          for (let gy = 0; gy <= maxY; gy += scanStep) {
            if (sheet.canPlace(mask, gx, gy)) {
              if (wasBlocked) {
                wasBlocked = false;
                pocketsFound++;
                let rx = gx;
                let ry = gy;
                while (rx > 0 && sheet.canPlace(mask, rx - 1, ry)) rx--;
                while (ry > 0 && sheet.canPlace(mask, rx, ry - 1)) ry--;
                const sc = scorePosition(rx, ry, mask, sheet, strategy);
                if (sc < bestScore) {
                  bestScore = sc;
                  bestChoice = { sheetIdx: sIdx, gx: rx, gy: ry, mask };
                }
                if (pocketsFound >= 2 || gy >= limitY) break;
              }
            } else {
              wasBlocked = true;
            }
            if (pocketsFound >= 1 && gy > limitY) break;
          }
        }
      }
    }

    if (bestChoice) return bestChoice;
  }

  // Allocate a new sheet if allowed
  if (sheets.length < maxSheets) {
    const newSheet = new SheetBitGrid(wCells, hCells);
    let bestMask: RasterMask | null = null;
    let bestScore = Infinity;
    for (const m of masks) {
      if (m.wCells <= wCells && m.hCells <= hCells) {
        const sc = scorePosition(0, 0, m, newSheet, strategy);
        if (sc < bestScore) {
          bestScore = sc;
          bestMask = m;
        }
      }
    }
    if (bestMask && newSheet.canPlace(bestMask, 0, 0)) {
      sheets.push(newSheet);
      return { sheetIdx: sheets.length - 1, gx: 0, gy: 0, mask: bestMask };
    }
  }

  return null;
}

/**
 * Register hole bounding boxes of a newly placed part so subsequent smaller parts can nest inside them.
 */
function registerPlacedHoles(
  placedHoles: PlacedHoleRegion[],
  shape: Shape,
  sheetIdx: number,
  gx: number,
  gy: number,
  mask: RasterMask,
  cellSize: number,
  wCells: number,
  hCells: number
): void {
  if (!mask.normHolesMm || mask.normHolesMm.length === 0) return;

  for (const holeMm of mask.normHolesMm) {
    const hbb = getBBox(holeMm);
    // Ignore tiny mounting bolt holes (< 8mm) that cannot fit parts
    if (hbb.w < 8 || hbb.h < 8) continue;

    const minGX = Math.max(0, gx + Math.floor(hbb.minX / cellSize));
    const minGY = Math.max(0, gy + Math.floor(hbb.minY / cellSize));
    const maxGX = Math.min(wCells, gx + Math.ceil(hbb.maxX / cellSize));
    const maxGY = Math.min(hCells, gy + Math.ceil(hbb.maxY / cellSize));

    if (maxGX - minGX >= 2 && maxGY - minGY >= 2) {
      const holePolyCells = holeMm.map((p) => ({
        x: gx + p.x / cellSize,
        y: gy + p.y / cellSize,
      }));
      placedHoles.push({
        sheetIdx,
        parentShapeId: shape.id,
        minGX,
        minGY,
        maxGX,
        maxGY,
        holePolyCells,
      });
    }
  }
}

/**
 * Run a single deterministic nesting trial with a given ordered list of parts.
 */
export function runSingleTrial(
  orderedParts: PartInstance[],
  fillerShapes: Shape[],
  masksByShapeId: Map<string, RasterMask[]>,
  st: NestSettings,
  cellSize: number,
  wCells: number,
  hCells: number,
  trialIdx = 0
): { snap: NestSnapshot; score: number } {
  const sheets: SheetBitGrid[] = [new SheetBitGrid(wCells, hCells)];
  const placedHoles: PlacedHoleRegion[] = [];
  const placements: Placement[] = [];
  const unplacedCounts = new Map<string, number>();
  const margin = Math.max(0, st.margin);

  for (let i = 0; i < orderedParts.length; i++) {
    const item = orderedParts[i];
    const masks = masksByShapeId.get(item.shape.id) || [];
    const angleOffset = trialIdx === 0 ? 0 : trialIdx * 3 + i;
    const found = findBestPlacementForPart(
      item.shape.id,
      masks,
      sheets,
      placedHoles,
      st.holes,
      st.maxSheets,
      wCells,
      hCells,
      st.strategy,
      angleOffset
    );

    if (found) {
      const targetSheet = sheets[found.sheetIdx];
      targetSheet.stamp(found.mask, found.gx, found.gy);
      if (st.holes && item.shape.holes && item.shape.holes.length > 0) {
        registerPlacedHoles(
          placedHoles,
          item.shape,
          found.sheetIdx,
          found.gx,
          found.gy,
          found.mask,
          cellSize,
          wCells,
          hCells
        );
      }
      placements.push({
        id: `${item.shape.id}_${item.instanceIdx}_${placements.length}`,
        shapeId: item.shape.id,
        sheet: found.sheetIdx,
        x: margin + found.gx * cellSize,
        y: margin + found.gy * cellSize,
        angle: found.mask.angle,
        isFiller: false,
      });
    } else {
      unplacedCounts.set(item.shape.id, (unplacedCounts.get(item.shape.id) || 0) + 1);
    }
  }

  // If there are filler shapes (fill=true), pack as many as fit into remaining space on allocated sheets
  if (fillerShapes.length > 0) {
    const sortedFillers = [...fillerShapes].sort(
      (a, b) => polygonArea(b.points) - polygonArea(a.points)
    );
    for (const fShape of sortedFillers) {
      const masks = masksByShapeId.get(fShape.id) || [];
      let fillerCount = 0;
      const maxFillers = 250;
      while (fillerCount < maxFillers) {
        const found = findBestPlacementForPart(
          fShape.id,
          masks,
          sheets,
          placedHoles,
          st.holes,
          sheets.length,
          wCells,
          hCells,
          st.strategy,
          fillerCount
        );
        if (!found) break;
        sheets[found.sheetIdx].stamp(found.mask, found.gx, found.gy);
        if (st.holes && fShape.holes && fShape.holes.length > 0) {
          registerPlacedHoles(
            placedHoles,
            fShape,
            found.sheetIdx,
            found.gx,
            found.gy,
            found.mask,
            cellSize,
            wCells,
            hCells
          );
        }
        fillerCount++;
        placements.push({
          id: `${fShape.id}_fill_${fillerCount}`,
          shapeId: fShape.id,
          sheet: found.sheetIdx,
          x: margin + found.gx * cellSize,
          y: margin + found.gy * cellSize,
          angle: found.mask.angle,
          isFiller: true,
        });
      }
    }
  }

  const unplaced: UnplacedItem[] = Array.from(unplacedCounts.entries()).map(([shapeId, count]) => ({
    shapeId,
    count,
  }));

  const usedW = sheets[0] ? margin * 2 + sheets[0].maxUsedX * cellSize : 0;
  const usedH = sheets[0] ? margin * 2 + sheets[0].maxUsedY * cellSize : 0;

  assignCutOrder(placements, sheets.length);

  const requiredPlaced = placements.filter((p) => !p.isFiller).length;
  const fillerPlaced = placements.length - requiredPlaced;
  const lastSheet = sheets[sheets.length - 1];

  let compactnessBonus = 0;
  if (lastSheet) {
    if (st.strategy === "gravity-bl") {
      compactnessBonus = (1 - lastSheet.maxUsedX / Math.max(1, wCells)) * 2000;
    } else if (st.strategy === "gravity-tl") {
      compactnessBonus = (1 - lastSheet.maxUsedY / Math.max(1, hCells)) * 2000;
    } else {
      compactnessBonus =
        (1 - (lastSheet.maxUsedX * lastSheet.maxUsedY) / Math.max(1, wCells * hCells)) * 2000;
    }
  }

  const score =
    requiredPlaced * 1_000_000 -
    sheets.length * 10_000 +
    fillerPlaced * 500 +
    compactnessBonus;

  return {
    snap: {
      sheets: sheets.length,
      placements,
      unplaced,
      trials: trialIdx + 1,
      usedWidthMm: Math.min(st.sheetW, usedW),
      usedHeightMm: Math.min(st.sheetH, usedH),
    },
    score,
  };
}

/**
 * Sort part instances so larger outer contours and parts with holes are placed first,
 * allowing smaller parts to nest inside their holes.
 */
export function sortPartInstancesForNesting(instances: PartInstance[]): PartInstance[] {
  return [...instances].sort((a, b) => {
    const pa = a.shape.priority ?? 2;
    const pb = b.shape.priority ?? 2;
    if (pa !== pb) return pa - pb;
    // Always place parts by largest OUTER contour area first so parent shapes with holes are on the sheet before small parts
    if (Math.abs(b.outerArea - a.outerArea) > 1e-2) {
      return b.outerArea - a.outerArea;
    }
    return b.area - a.area;
  });
}

/**
 * Synchronous entry point for unit testing and instant single-pass nesting.
 */
export function runNestingSync(shapes: Shape[], st: NestSettings): NestSnapshot {
  const usableW = Math.max(1, st.sheetW - st.margin * 2);
  const usableH = Math.max(1, st.sheetH - st.margin * 2);
  const maxDim = Math.max(usableW, usableH);
  const resolution = Math.max(150, Math.min(2000, st.resolution || 600));
  const cellSize = maxDim / resolution;
  const wCells = Math.max(1, Math.floor(usableW / cellSize));
  const hCells = Math.max(1, Math.floor(usableH / cellSize));
  const totalClearanceMm = Math.max(0, (st.spacing || 0) + (st.kerf || 0));
  const clearanceCells = Math.max(0, totalClearanceMm / cellSize);

  const activeShapes = shapes.filter((s) => s.enabled && (s.qty > 0 || s.fill));
  const masksByShapeId = new Map<string, RasterMask[]>();

  for (const s of activeShapes) {
    const angles = getCandidateAngles(s, st);
    const masks = angles.map((ang) =>
      buildRasterMask(s, ang, cellSize, clearanceCells, st.holes)
    );
    // Order masks so smallest bounding-box area and orthogonal angles are evaluated first
    masks.sort((a, b) => {
      const areaDiff = a.wCells * a.hCells - b.wCells * b.hCells;
      if (Math.abs(areaDiff) > 2) return areaDiff;
      const orthoA = a.angle % 90 === 0 ? 0 : 1;
      const orthoB = b.angle % 90 === 0 ? 0 : 1;
      return orthoA - orthoB;
    });
    masksByShapeId.set(s.id, masks);
  }

  const requiredInstances: PartInstance[] = [];
  for (const s of activeShapes) {
    const outerArea = polygonArea(s.points);
    const area = shapeArea(s, st.holes);
    for (let k = 0; k < s.qty; k++) {
      requiredInstances.push({
        shape: s,
        instanceIdx: k,
        outerArea,
        area,
        isFiller: false,
      });
    }
  }

  const orderedInstances = sortPartInstancesForNesting(requiredInstances);
  const fillerShapes = activeShapes.filter((s) => s.fill);
  const { snap } = runSingleTrial(
    orderedInstances,
    fillerShapes,
    masksByShapeId,
    st,
    cellSize,
    wCells,
    hCells,
    0
  );
  return snap;
}
