import JSZip from "jszip";
import {
  getBBox,
  normalizeShapeGeometry,
  pointInPolygon,
  polygonArea,
  simplifyPolygon,
} from "./geometry";
import {
  classifyOutersAndHoles,
  isDuplicateContour,
  isStrictInteriorHole,
  parseCADJsonExport,
  parseDXF,
  parseSVG,
  type SvgGrouping,
  type SvgUnit,
} from "./importers";
import type { Point, Polygon, Shape, ShapeSource } from "./types";

const PT_TO_MM = 25.4 / 72;

const PALETTE = [
  "#10b981",
  "#06b6d4",
  "#3b82f6",
  "#f59e0b",
  "#ec4899",
  "#8b5cf6",
  "#14b8a6",
  "#f97316",
];
let colorCursor = 0;
function pickColor(): string {
  return PALETTE[colorCursor++ % PALETTE.length];
}

function makeId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36).slice(-3)}`;
}

/**
 * Decompress a PDF FlateDecode stream using browser/Node native DecompressionStream.
 */
async function inflateBytes(compressed: Uint8Array): Promise<string | null> {
  if (typeof DecompressionStream === "undefined") return null;

  const tryFormat = async (format: "deflate" | "deflate-raw"): Promise<string | null> => {
    try {
      const ds = new DecompressionStream(format);
      const writer = ds.writable.getWriter();
      void writer.write(new Uint8Array(compressed)).catch(() => {});
      void writer.close().catch(() => {});
      const reader = ds.readable.getReader();
      const chunks: Uint8Array[] = [];
      let totalLen = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          totalLen += value.length;
        }
      }
      const merged = new Uint8Array(totalLen);
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.length;
      }
      return new TextDecoder("latin1").decode(merged);
    } catch {
      return null;
    }
  };

  const res = await tryFormat("deflate");
  if (res) return res;
  if (compressed.length > 2) {
    const rawRes = await tryFormat("deflate-raw");
    if (rawRes) return rawRes;
  }
  return null;
}

type Matrix2D = [number, number, number, number, number, number];

function multiplyMatrix(m1: Matrix2D, m2: Matrix2D): Matrix2D {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function applyMatrix(pt: Point, m: Matrix2D, scaleMm: number): Point {
  const x = pt.x * m[0] + pt.y * m[2] + m[4];
  const y = pt.x * m[1] + pt.y * m[3] + m[5];
  // PDF Y-axis points UP; invert Y for top-down screen coordinates
  return { x: x * scaleMm, y: -y * scaleMm };
}

/**
 * Parse a decompressed PDF / Adobe Illustrator / PostScript vector content stream
 * into compound path groups (each painted path operation `f`/`f*`/`B`/`B*`/`S`/`s`
 * produces a group of subpaths `Polygon[]`).
 * This guarantees that separate objects on an Illustrator/CorelDRAW page never hollow each other out!
 */
export function parsePdfContentStreamToPathGroups(
  streamText: string,
  userUnit = 1
): Polygon[][] {
  const scaleMm = PT_TO_MM * userUnit;
  const pathGroups: Polygon[][] = [];

  // Tokenize numbers and PDF/PS path operators
  const tokenRegex = /[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?|[a-zA-Z*]+/g;
  const tokens = streamText.match(tokenRegex);
  if (!tokens) return [];

  const numStack: number[] = [];
  const ctmStack: Matrix2D[] = [];
  let ctm: Matrix2D = [1, 0, 0, 1, 0, 0];

  let currentSubpaths: Polygon[] = [];
  let currentRing: Polygon = [];
  let curX = 0;
  let curY = 0;
  let startX = 0;
  let startY = 0;

  const flushRing = () => {
    if (currentRing.length >= 3) {
      currentSubpaths.push(currentRing);
    }
    currentRing = [];
  };

  const commitPath = () => {
    flushRing();
    const validGroup: Polygon[] = [];
    for (const sp of currentSubpaths) {
      const simplified = simplifyPolygon(sp, 0.12);
      if (simplified.length >= 3 && polygonArea(simplified) > 0.5) {
        validGroup.push(simplified);
      }
    }
    if (validGroup.length > 0) {
      pathGroups.push(validGroup);
    }
    currentSubpaths = [];
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const firstChar = tok.charCodeAt(0);
    const isNum =
      (firstChar >= 48 && firstChar <= 57) ||
      firstChar === 45 ||
      firstChar === 43 ||
      firstChar === 46;

    if (isNum) {
      const v = parseFloat(tok);
      if (!isNaN(v)) {
        numStack.push(v);
        if (numStack.length > 32) numStack.shift();
        continue;
      }
    }

    switch (tok) {
      case "q":
        ctmStack.push([...ctm]);
        numStack.length = 0;
        break;
      case "Q":
        if (ctmStack.length > 0) ctm = ctmStack.pop()!;
        numStack.length = 0;
        break;
      case "cm":
        if (numStack.length >= 6) {
          const f = numStack.pop()!;
          const e = numStack.pop()!;
          const d = numStack.pop()!;
          const c = numStack.pop()!;
          const b = numStack.pop()!;
          const a = numStack.pop()!;
          ctm = multiplyMatrix(ctm, [a, b, c, d, e, f]);
        }
        numStack.length = 0;
        break;
      case "m":
        if (numStack.length >= 2) {
          flushRing();
          const y = numStack.pop()!;
          const x = numStack.pop()!;
          curX = startX = x;
          curY = startY = y;
          currentRing.push(applyMatrix({ x, y }, ctm, scaleMm));
        }
        numStack.length = 0;
        break;
      case "l":
      case "L":
        if (numStack.length >= 2) {
          const y = numStack.pop()!;
          const x = numStack.pop()!;
          curX = x;
          curY = y;
          currentRing.push(applyMatrix({ x, y }, ctm, scaleMm));
        }
        numStack.length = 0;
        break;
      case "c":
      case "C":
        if (numStack.length >= 6) {
          const y3 = numStack.pop()!;
          const x3 = numStack.pop()!;
          const y2 = numStack.pop()!;
          const x2 = numStack.pop()!;
          const y1 = numStack.pop()!;
          const x1 = numStack.pop()!;
          const steps = 10;
          for (let s = 1; s <= steps; s++) {
            const t = s / steps;
            const mt = 1 - t;
            const px =
              mt * mt * mt * curX +
              3 * mt * mt * t * x1 +
              3 * mt * t * t * x2 +
              t * t * t * x3;
            const py =
              mt * mt * mt * curY +
              3 * mt * mt * t * y1 +
              3 * mt * t * t * y2 +
              t * t * t * y3;
            currentRing.push(applyMatrix({ x: px, y: py }, ctm, scaleMm));
          }
          curX = x3;
          curY = y3;
        }
        numStack.length = 0;
        break;
      case "v":
      case "V":
        if (numStack.length >= 4) {
          const y3 = numStack.pop()!;
          const x3 = numStack.pop()!;
          const y2 = numStack.pop()!;
          const x2 = numStack.pop()!;
          const x1 = curX;
          const y1 = curY;
          const steps = 10;
          for (let s = 1; s <= steps; s++) {
            const t = s / steps;
            const mt = 1 - t;
            const px =
              mt * mt * mt * curX +
              3 * mt * mt * t * x1 +
              3 * mt * t * t * x2 +
              t * t * t * x3;
            const py =
              mt * mt * mt * curY +
              3 * mt * mt * t * y1 +
              3 * mt * t * t * y2 +
              t * t * t * y3;
            currentRing.push(applyMatrix({ x: px, y: py }, ctm, scaleMm));
          }
          curX = x3;
          curY = y3;
        }
        numStack.length = 0;
        break;
      case "y":
      case "Y":
        if (numStack.length >= 4) {
          const y3 = numStack.pop()!;
          const x3 = numStack.pop()!;
          const y1 = numStack.pop()!;
          const x1 = numStack.pop()!;
          const steps = 10;
          for (let s = 1; s <= steps; s++) {
            const t = s / steps;
            const mt = 1 - t;
            const px =
              mt * mt * mt * curX +
              3 * mt * mt * t * x1 +
              3 * mt * t * t * x3 +
              t * t * t * x3;
            const py =
              mt * mt * mt * curY +
              3 * mt * mt * t * y1 +
              3 * mt * t * t * y3 +
              t * t * t * y3;
            currentRing.push(applyMatrix({ x: px, y: py }, ctm, scaleMm));
          }
          curX = x3;
          curY = y3;
        }
        numStack.length = 0;
        break;
      case "re":
        if (numStack.length >= 4) {
          flushRing();
          const h = numStack.pop()!;
          const w = numStack.pop()!;
          const y = numStack.pop()!;
          const x = numStack.pop()!;
          if (Math.abs(w) > 0.1 && Math.abs(h) > 0.1) {
            currentSubpaths.push([
              applyMatrix({ x, y }, ctm, scaleMm),
              applyMatrix({ x: x + w, y }, ctm, scaleMm),
              applyMatrix({ x: x + w, y: y + h }, ctm, scaleMm),
              applyMatrix({ x, y: y + h }, ctm, scaleMm),
            ]);
          }
        }
        numStack.length = 0;
        break;
      case "h":
      case "H":
        curX = startX;
        curY = startY;
        flushRing();
        numStack.length = 0;
        break;
      case "S":
      case "s":
      case "f":
      case "F":
      case "f*":
      case "B":
      case "B*":
      case "b":
      case "b*":
        commitPath();
        numStack.length = 0;
        break;
      case "n":
      case "W":
      case "W*":
        // End path / clipping path without stroke: discard clipping rect
        currentRing = [];
        currentSubpaths = [];
        numStack.length = 0;
        break;
      default:
        numStack.length = 0;
        break;
    }
  }

  commitPath();
  return pathGroups;
}

/**
 * Legacy helper returning flattened polygons from a PDF/AI content stream.
 */
export function parsePdfContentStreamToPolygons(
  streamText: string,
  userUnit = 1
): Polygon[] {
  return parsePdfContentStreamToPathGroups(streamText, userUnit).flat();
}

/**
 * Build NestPro shapes from compound path groups extracted from PDF/AI/EPS streams.
 * - Classifies holes ONLY within each compound path group so separate objects on the page never hollow each other out.
 * - Deduplicates identical Fill + Stroke contours (`isDuplicateContour`).
 * - Automatically strips PDF `/MediaBox`, `/ArtBox`, `/CropBox`, `/TrimBox` page rectangles or giant artboard frames.
 */
export function buildShapesFromPathGroups(
  pathGroups: Polygon[][],
  baseName: string,
  source: ShapeSource,
  pageBoxesMm: { w: number; h: number }[] = []
): Shape[] {
  if (!pathGroups.length) return [];

  interface ExtractedPart {
    outer: Polygon;
    holes: Polygon[];
    bb: ReturnType<typeof getBBox>;
    area: number;
  }

  const parts: ExtractedPart[] = [];
  for (const group of pathGroups) {
    if (!group.length) continue;
    // Within a single painted path operation, subpaths may be compound holes (e.g. m...h m...h f*)
    const classified = classifyOutersAndHoles(group, {
      stripArtboardContainer: false,
      allowHoles: true,
    });
    for (const item of classified) {
      const bb = getBBox(item.outer);
      const area = polygonArea(item.outer);
      if (bb.w < 0.5 || bb.h < 0.5 || area < 1) continue;
      parts.push({ outer: item.outer, holes: item.holes, bb, area });
    }
  }

  if (!parts.length) return [];

  // Deduplicate identical contours (e.g. Fill operation followed by Stroke operation on the exact same path)
  const deduped: ExtractedPart[] = [];
  for (const p of parts) {
    const existing = deduped.find((ex) => isDuplicateContour(ex, p));
    if (existing) {
      // If one copy had compound holes and the stroke copy didn't, keep the copy with holes
      if (existing.holes.length === 0 && p.holes.length > 0) {
        existing.holes = p.holes;
      }
    } else {
      deduped.push(p);
    }
  }

  // Strip any solid rectangle that matches the PDF page MediaBox/CropBox/ArtBox/TrimBox
  // or encloses the other parts on the page as an artboard background
  let filtered = deduped;
  if (filtered.length > 1) {
    filtered = filtered.filter((cand) => {
      if (cand.holes.length > 0) return true;
      const rectRatio = cand.area / Math.max(1, cand.bb.w * cand.bb.h);
      if (rectRatio < 0.92) return true;

      // Check if it matches any PDF page box (MediaBox / CropBox / ArtBox / TrimBox)
      const matchesPageBox = pageBoxesMm.some(
        (box) =>
          (Math.abs(cand.bb.w - box.w) <= Math.max(3, box.w * 0.025) &&
            Math.abs(cand.bb.h - box.h) <= Math.max(3, box.h * 0.025)) ||
          (Math.abs(cand.bb.w - box.h) <= Math.max(3, box.h * 0.025) &&
            Math.abs(cand.bb.h - box.w) <= Math.max(3, box.w * 0.025))
      );
      if (matchesPageBox) return false;

      // Check if this rectangle encloses most of the other shapes on the page (artboard border)
      const enclosedOthers = deduped.filter(
        (other) => other !== cand && isStrictInteriorHole({ poly: other.outer, bb: other.bb, area: other.area }, { poly: cand.outer, bb: cand.bb, area: cand.area })
      );
      if (enclosedOthers.length >= 2 && enclosedOthers.length >= deduped.length - 1) {
        return false;
      }
      return true;
    });
    if (filtered.length === 0) filtered = deduped;
  }

  const shapes: Shape[] = [];
  let idx = 1;
  for (const item of filtered) {
    const norm = normalizeShapeGeometry(item.outer, item.holes);
    if (norm.w < 0.5 || norm.h < 0.5) continue;
    shapes.push({
      id: makeId(source),
      name: filtered.length === 1 ? baseName : `${baseName} #${idx++}`,
      points: norm.points,
      holes: norm.holes,
      qty: 1,
      fill: false,
      enabled: true,
      color: pickColor(),
      source,
      origX: norm.origX,
      origY: norm.origY,
      w: norm.w,
      h: norm.h,
    });
  }
  return shapes;
}

function buildShapesFromRings(
  rings: Polygon[],
  baseName: string,
  source: ShapeSource
): Shape[] {
  if (!rings.length) return [];
  const classified = classifyOutersAndHoles(rings, {
    stripArtboardContainer: true,
    allowHoles: true,
  });
  const shapes: Shape[] = [];
  let idx = 1;
  for (const item of classified) {
    const norm = normalizeShapeGeometry(item.outer, item.holes);
    if (norm.w < 0.5 || norm.h < 0.5) continue;
    shapes.push({
      id: makeId(source),
      name: classified.length === 1 ? baseName : `${baseName} #${idx++}`,
      points: norm.points,
      holes: norm.holes,
      qty: 1,
      fill: false,
      enabled: true,
      color: pickColor(),
      source,
      origX: norm.origX,
      origY: norm.origY,
      w: norm.w,
      h: norm.h,
    });
  }
  return shapes;
}

/**
 * Parse a direct Adobe Illustrator (.ai), PDF (.pdf), or EPS (.eps) file buffer into physical mm Shapes.
 */
export async function parseDirectPdfOrAiBuffer(
  buffer: ArrayBuffer,
  fileName: string
): Promise<Shape[]> {
  const bytes = new Uint8Array(buffer);
  const rawText = new TextDecoder("latin1").decode(bytes);
  const ext = fileName.toLowerCase().endsWith(".ai") ? "ai" : "svg";
  const baseName = fileName.replace(/\.[a-z0-9]+$/i, "");

  // Check if the file is actually an SVG or JSON saved with a different extension
  if (rawText.trimStart().startsWith("<svg") || rawText.includes("<svg")) {
    return parseSVG(rawText, "auto", "path", fileName);
  }
  if (rawText.trimStart().startsWith("{")) {
    return parseCADJsonExport(rawText).shapes;
  }

  // Detect PDF /UserUnit if present (PDF 1.6+ large format Illustrator/Corel documents)
  let userUnit = 1;
  const userUnitMatch = rawText.match(/\/UserUnit\s+(\d+(?:\.\d+)?)/);
  if (userUnitMatch) {
    userUnit = parseFloat(userUnitMatch[1]) || 1;
  }

  // Extract PDF /MediaBox, /CropBox, /ArtBox, /TrimBox dimensions in mm so page rectangles can be ignored
  const scaleMm = PT_TO_MM * userUnit;
  const pageBoxesMm: { w: number; h: number }[] = [];
  const boxRegex = /\/(?:MediaBox|CropBox|ArtBox|TrimBox|BleedBox)\s*\[\s*([-+0-9.]+)\s+([-+0-9.]+)\s+([-+0-9.]+)\s+([-+0-9.]+)\s*\]/g;
  let boxMatch: RegExpExecArray | null;
  while ((boxMatch = boxRegex.exec(rawText)) !== null) {
    const x1 = parseFloat(boxMatch[1]);
    const y1 = parseFloat(boxMatch[2]);
    const x2 = parseFloat(boxMatch[3]);
    const y2 = parseFloat(boxMatch[4]);
    const bw = Math.abs(x2 - x1) * scaleMm;
    const bh = Math.abs(y2 - y1) * scaleMm;
    if (bw > 1 && bh > 1) {
      pageBoxesMm.push({ w: bw, h: bh });
    }
  }

  const allPathGroups: Polygon[][] = [];

  // Locate all `stream` ... `endstream` blocks in the PDF/AI file
  let searchPos = 0;
  while (searchPos < rawText.length) {
    const streamIdx = rawText.indexOf("stream", searchPos);
    if (streamIdx === -1) break;

    if (streamIdx >= 3 && rawText.slice(streamIdx - 3, streamIdx) === "end") {
      searchPos = streamIdx + 6;
      continue;
    }

    let dataStart = streamIdx + 6;
    if (rawText[dataStart] === "\r" && rawText[dataStart + 1] === "\n") {
      dataStart += 2;
    } else if (rawText[dataStart] === "\n" || rawText[dataStart] === "\r") {
      dataStart += 1;
    } else {
      searchPos = streamIdx + 6;
      continue;
    }

    const endStreamIdx = rawText.indexOf("endstream", dataStart);
    if (endStreamIdx === -1) break;

    let dataEnd = endStreamIdx;
    if (rawText[dataEnd - 2] === "\r" && rawText[dataEnd - 1] === "\n") {
      dataEnd -= 2;
    } else if (rawText[dataEnd - 1] === "\n" || rawText[dataEnd - 1] === "\r") {
      dataEnd -= 1;
    }

    const headerWindow = rawText.slice(Math.max(0, streamIdx - 350), streamIdx);
    const isFlate = headerWindow.includes("/FlateDecode");
    const isImageOrFont =
      headerWindow.includes("/Subtype /Image") ||
      headerWindow.includes("/Subtype/Image") ||
      headerWindow.includes("/FontFile") ||
      headerWindow.includes("/Metadata");

    if (!isImageOrFont && dataEnd > dataStart) {
      const slice = bytes.subarray(dataStart, dataEnd);
      let decodedStream: string | null = null;
      if (isFlate) {
        decodedStream = await inflateBytes(slice);
      } else {
        decodedStream = rawText.slice(dataStart, dataEnd);
      }

      if (decodedStream && decodedStream.length > 4) {
        const groups = parsePdfContentStreamToPathGroups(decodedStream, userUnit);
        if (groups.length > 0) {
          allPathGroups.push(...groups);
        }
      }
    }

    searchPos = endStreamIdx + 9;
  }

  // Fallback for uncompressed PostScript / Illustrator 8 / EPS files without `stream...endstream`
  if (allPathGroups.length === 0) {
    const psGroups = parsePdfContentStreamToPathGroups(rawText, userUnit);
    allPathGroups.push(...psGroups);
  }

  const shapes = buildShapesFromPathGroups(allPathGroups, baseName, ext, pageBoxesMm);
  if (!shapes.length) {
    throw new Error(
      `تعذر استخراج مسارات فيكتور مغلقة من الملف (${fileName}). تأكد من حفظ ملف Illustrator/Corel بخيار PDF Compatible أو تصديره كـ SVG / DXF / PDF.`
    );
  }
  return shapes;
}

/**
 * Parse a CorelDRAW (.cdr) file buffer directly.
 * CorelDRAW X4–2026 files are ZIP archives containing `content/riffData.cdr` or embedded vector/SVG streams.
 */
export async function parseDirectCdrBuffer(
  buffer: ArrayBuffer,
  fileName: string
): Promise<Shape[]> {
  const bytes = new Uint8Array(buffer);
  const baseName = fileName.replace(/\.cdr$/i, "");

  // Check if it's a ZIP archive (PK\x03\x04) — CorelDRAW X4 through 2026
  if (bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const zip = await JSZip.loadAsync(buffer);
    const shapes: Shape[] = [];

    // 1. Check for any embedded SVG / XML / CMX vector entries inside the CDR container
    const entryNames = Object.keys(zip.files);
    for (const name of entryNames) {
      const lower = name.toLowerCase();
      if (lower.endsWith(".svg") || lower.endsWith(".xml")) {
        const txt = await zip.files[name].async("string");
        if (txt.includes("<svg") || txt.includes("<path")) {
          try {
            const parsed = parseSVG(txt, "auto", "path", baseName);
            if (parsed.length > 0) {
              return parsed.map((s) => ({ ...s, source: "corel" as const }));
            }
          } catch {
            // Continue searching other entries
          }
        }
      }
      if (lower.endsWith(".pdf") || lower.endsWith(".ai")) {
        const subBuf = await zip.files[name].async("arraybuffer");
        try {
          const parsed = await parseDirectPdfOrAiBuffer(subBuf, baseName + ".pdf");
          if (parsed.length > 0) {
            return parsed.map((s) => ({ ...s, source: "corel" as const }));
          }
        } catch {
          // Continue
        }
      }
    }

    // 2. Inspect `content/riffData.cdr` or `content/root.dat` for RIFF vector coordinate pairs
    for (const name of entryNames) {
      if (name.toLowerCase().endsWith(".cdr") || name.toLowerCase().endsWith(".dat")) {
        const riffBytes = await zip.files[name].async("uint8array");
        const riffShapes = extractRiffCdrPolygons(riffBytes, baseName);
        if (riffShapes.length > 0) return riffShapes;
      }
    }

    void shapes;
  }

  // Check if it's a direct RIFF CDR file (`RIFF....CDR`)
  if (
    bytes.length > 12 &&
    bytes[0] === 0x52 && // 'R'
    bytes[1] === 0x49 && // 'I'
    bytes[2] === 0x46 && // 'F'
    bytes[3] === 0x46    // 'F'
  ) {
    const riffShapes = extractRiffCdrPolygons(bytes, baseName);
    if (riffShapes.length > 0) return riffShapes;
  }

  throw new Error(
    `ملف CorelDRAW (${fileName}) مضغوط بترميز ثنائي مغلق. لاستيراده فوراً بدقة 100%: احفظه من CorelDRAW بصيغة PDF أو SVG أو DXF، أو استخدم زر «الربط مع CorelDRAW» لتصديره بضغطة واحدة.`
  );
}

/**
 * Scan uncompressed CorelDRAW RIFF `loda` / `crv` chunks for 32-bit signed integer coordinate arrays
 * (in CorelDRAW RIFF, 1 unit = 0.001 mm = 1 micrometer).
 */
function extractRiffCdrPolygons(bytes: Uint8Array, baseName: string): Shape[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rings: Polygon[] = [];

  // Look for standard CorelDRAW bounding box / curve point blocks
  for (let i = 0; i + 24 < bytes.length; i += 2) {
    // Check for 'loda' or 'trfd' chunk fourCC
    if (
      bytes[i] === 0x6c && // 'l'
      bytes[i + 1] === 0x6f && // 'o'
      bytes[i + 2] === 0x64 && // 'd'
      bytes[i + 3] === 0x61 // 'a'
    ) {
      const chunkSize = view.getUint32(i + 4, true);
      if (chunkSize > 16 && chunkSize < 200000 && i + 8 + chunkSize <= bytes.length) {
        // Attempt to read point count and 32-bit micron coordinates
        for (let p = i + 8; p + 24 < i + 8 + chunkSize; p += 4) {
          const nPts = view.getUint32(p, true);
          if (nPts >= 3 && nPts <= 500 && p + 4 + nPts * 8 <= i + 8 + chunkSize) {
            const poly: Polygon = [];
            let valid = true;
            for (let k = 0; k < nPts; k++) {
              const rx = view.getInt32(p + 4 + k * 8, true) / 1000;
              const ry = -view.getInt32(p + 4 + k * 8 + 4, true) / 1000;
              if (Math.abs(rx) > 25000 || Math.abs(ry) > 25000) {
                valid = false;
                break;
              }
              poly.push({ x: rx, y: ry });
            }
            if (valid && poly.length >= 3) {
              const bb = getBBox(poly);
              if (bb.w >= 2 && bb.h >= 2 && bb.w <= 10000 && bb.h <= 10000) {
                rings.push(simplifyPolygon(poly, 0.15));
                break;
              }
            }
          }
        }
      }
    }
  }

  return buildShapesFromRings(rings, baseName, "corel");
}

/**
 * Universal CAD / Vector File Importer supporting:
 * - `.svg` (CorelDRAW / Illustrator / Inkscape SVG)
 * - `.dxf` (AutoCAD / CorelDRAW / Laser DXF)
 * - `.pdf` (CorelDRAW / Illustrator Vector PDF)
 * - `.ai`  (Adobe Illustrator native PDF-compatible `.ai` or PostScript `.ai`)
 * - `.cdr` (CorelDRAW archive / RIFF `.cdr`)
 * - `.eps` (Encapsulated PostScript)
 * - `.json` (CorelDRAW VBA / Illustrator JSX Direct Bridge JSON)
 */
export async function importUniversalCadFile(
  file: File,
  svgUnit: SvgUnit = "auto",
  svgGroup: SvgGrouping = "path"
): Promise<{ shapes: Shape[]; formatLabel: string }> {
  const name = file.name;
  const lower = name.toLowerCase();

  if (lower.endsWith(".json")) {
    const txt = await file.text();
    const res = parseCADJsonExport(txt);
    return {
      shapes: res.shapes,
      formatLabel: res.host === "corel" ? "CorelDRAW JSON" : "Illustrator JSON",
    };
  }

  if (lower.endsWith(".dxf")) {
    const txt = await file.text();
    return {
      shapes: parseDXF(txt, name),
      formatLabel: "AutoCAD / Corel DXF",
    };
  }

  if (lower.endsWith(".svg")) {
    const txt = await file.text();
    return {
      shapes: parseSVG(txt, svgUnit, svgGroup, name),
      formatLabel: "SVG Vector",
    };
  }

  if (lower.endsWith(".pdf") || lower.endsWith(".ai") || lower.endsWith(".eps")) {
    const buf = await file.arrayBuffer();
    const shapes = await parseDirectPdfOrAiBuffer(buf, name);
    const label = lower.endsWith(".ai")
      ? "Adobe Illustrator (.ai)"
      : lower.endsWith(".pdf")
        ? "Vector PDF (.pdf)"
        : "PostScript (.eps)";
    return { shapes, formatLabel: label };
  }

  if (lower.endsWith(".cdr")) {
    const buf = await file.arrayBuffer();
    const shapes = await parseDirectCdrBuffer(buf, name);
    return { shapes, formatLabel: "CorelDRAW (.cdr)" };
  }

  // Fallback: inspect file content header
  const txt = await file.text();
  if (txt.includes("<svg")) {
    return { shapes: parseSVG(txt, svgUnit, svgGroup, name), formatLabel: "SVG" };
  }
  if (txt.includes("SECTION") && txt.includes("ENTITIES")) {
    return { shapes: parseDXF(txt, name), formatLabel: "DXF" };
  }
  const buf = await file.arrayBuffer();
  return {
    shapes: await parseDirectPdfOrAiBuffer(buf, name),
    formatLabel: "CAD Vector",
  };
}
