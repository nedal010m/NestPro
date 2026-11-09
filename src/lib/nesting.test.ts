import test from "node:test";
import assert from "node:assert/strict";
import {
  getBBox,
  polygonArea,
  rotatePolygon,
  shapeArea,
} from "./geometry";
import { demoShapes, parseCADJsonExport, parseDXF } from "./importers";
import { parseDirectPdfOrAiBuffer, parsePdfContentStreamToPolygons } from "./directCadParser";
import { runNestingSync } from "./nestingEngine";
import { buildCorelApplyMacro, buildCorelExportMacro, buildCorelOneClickVBS } from "./corel";
import { sheetToDXF, sheetToHPGL, sheetToSVG } from "./exporters";
import type { NestSettings } from "./types";

const defaultSettings: NestSettings = {
  sheetW: 2000,
  sheetH: 1300,
  margin: 5,
  spacing: 1.5,
  kerf: 0.2,
  rotStep: 45,
  edgeAlign: true,
  holes: true,
  resolution: 400,
  timeBudget: 0,
  maxSheets: 2,
  strategy: "gravity-bl",
  sheetCost: 450,
  cutSpeed: 35,
  corelVersion: "2024-2026",
};

test("geometry calculations compute accurate areas and hole subtractions", () => {
  const outer = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
  const hole = [
    { x: 20, y: 20 },
    { x: 80, y: 20 },
    { x: 80, y: 80 },
    { x: 20, y: 80 },
  ];
  assert.equal(polygonArea(outer), 10000);
  assert.equal(polygonArea(hole), 3600);
  assert.equal(shapeArea({ points: outer, holes: [hole] }, true), 6400);
  assert.equal(shapeArea({ points: outer, holes: [hole] }, false), 10000);

  const rot90 = rotatePolygon(outer, 90);
  const bb = getBBox(rot90);
  assert.ok(Math.abs(bb.w - 100) < 1e-6);
  assert.ok(Math.abs(bb.h - 100) < 1e-6);
});

test("true-shape nesting engine places demo shapes within sheet margins and nests small parts inside large holes", () => {
  const shapes = demoShapes();
  assert.ok(shapes.length >= 5);

  const st1000x1300: NestSettings = {
    ...defaultSettings,
    sheetW: 1000,
    sheetH: 1300,
    resolution: 500,
    rotStep: 15,
  };
  const snap = runNestingSync(shapes, st1000x1300);
  assert.equal(snap.placements.length, 43, "Should place all 43 demo shapes onto the 1000x1300 sheet");
  assert.equal(snap.unplaced.length, 0, "All demo shapes should fit on a single 1000x1300 sheet");
  assert.equal(snap.sheets, 1, "Should only need 1 sheet");

  // Verify that small parts (Stars and Hexes) are genuinely placed INSIDE the holes of the Frames and Gears
  const shapeById = new Map(shapes.map((s) => [s.id, s]));
  const parentBBoxes = snap.placements
    .filter((p) => (shapeById.get(p.shapeId)?.holes.length || 0) > 0)
    .map((p) => {
      const sh = shapeById.get(p.shapeId)!;
      const rot = rotatePolygon(sh.points, p.angle);
      const bb = getBBox(rot);
      return {
        id: p.id,
        minX: p.x,
        minY: p.y,
        maxX: p.x + bb.w,
        maxY: p.y + bb.h,
      };
    });

  let nestedInsideHoles = 0;
  for (const p of snap.placements) {
    const sh = shapeById.get(p.shapeId)!;
    if (sh.holes.length > 0) continue;
    const rot = rotatePolygon(sh.points, p.angle);
    const bb = getBBox(rot);
    const cx = p.x + bb.w * 0.5;
    const cy = p.y + bb.h * 0.5;
    const isInsideParent = parentBBoxes.some(
      (parent) =>
        cx > parent.minX + 15 &&
        cx < parent.maxX - 15 &&
        cy > parent.minY + 15 &&
        cy < parent.maxY - 15
    );
    if (isInsideParent) nestedInsideHoles++;
  }

  assert.ok(
    nestedInsideHoles >= 12,
    `Expected at least 12 small shapes nested inside holes of large shapes, got ${nestedInsideHoles}`
  );

  // Also test 1 single Gear Ring + 1 single Star on an open 1000x1300 sheet: Star MUST go inside Gear hole!
  const singleGear = { ...shapes[0], qty: 1 };
  const singleStar = { ...shapes[4], qty: 1 };
  const pairSnap = runNestingSync([singleGear, singleStar], st1000x1300);
  assert.equal(pairSnap.placements.length, 2);
  const gearP = pairSnap.placements.find((p) => p.shapeId === singleGear.id)!;
  const starP = pairSnap.placements.find((p) => p.shapeId === singleStar.id)!;
  assert.ok(
    starP.x > gearP.x + 25 &&
      starP.x + singleStar.w < gearP.x + singleGear.w - 25 &&
      starP.y > gearP.y + 25 &&
      starP.y + singleStar.h < gearP.y + singleGear.h - 25,
    "Single small star must nest strictly inside single large gear ring hole"
  );
});

test("Direct PDF and Adobe Illustrator (.ai) vector stream parser extracts outer contours and inner holes in mm", async () => {
  // Construct a synthetic PDF / Illustrator content stream with an outer 283.46x141.73 pt (100x50 mm) rectangle
  // and an inner 56.69x56.69 pt (20x20 mm) cutout hole
  const pdfStreamContent = [
    "q",
    "1 0 0 1 0 0 cm",
    "0 0 283.464567 141.732283 re",
    "50 30 m",
    "106.6929 30 l",
    "106.6929 86.6929 l",
    "50 86.6929 l",
    "h",
    "B",
    "Q",
  ].join("\n");

  const rings = parsePdfContentStreamToPolygons(pdfStreamContent, 1);
  assert.equal(rings.length, 2, "Should extract both outer rectangle and inner cutout subpath");

  const fakePdfDoc = `%PDF-1.6\n1 0 obj\n<< /Length ${pdfStreamContent.length} >>\nstream\n${pdfStreamContent}\nendstream\nendobj\n%%EOF`;
  const encoder = new TextEncoder();
  const shapes = await parseDirectPdfOrAiBuffer(encoder.encode(fakePdfDoc).buffer, "SignagePart.ai");
  assert.equal(shapes.length, 1, "Outer path with enclosed hole should group into 1 compound shape");
  assert.equal(shapes[0].holes.length, 1, "Should preserve the inner hole");
  assert.equal(shapes[0].source, "ai");
  assert.ok(Math.abs(shapes[0].w - 100) < 0.2, "Width should be ~100 mm");
  assert.ok(Math.abs(shapes[0].h - 50) < 0.2, "Height should be ~50 mm");
});

test("CorelDRAW JSON importer and VBA / VBS / DXF / HPGL exporters generate valid CAD output", () => {
  const sampleCorelJson = JSON.stringify({
    host: "corel",
    doc: "Signage_Job.cdr",
    shapes: [
      {
        staticId: 1042,
        name: "Acrylic_Logo_Base",
        qty: 2,
        points: [
          [0, 0],
          [120, 0],
          [120, 80],
          [0, 80],
        ],
        holes: [
          [
            [20, 20],
            [100, 20],
            [100, 60],
            [20, 60],
          ],
        ],
      },
    ],
  });

  const parsed = parseCADJsonExport(sampleCorelJson);
  assert.equal(parsed.host, "corel");
  assert.equal(parsed.doc, "Signage_Job.cdr");
  assert.equal(parsed.shapes.length, 1);
  assert.equal(parsed.shapes[0].origId, "1042");
  assert.equal(parsed.shapes[0].holes.length, 1);

  const snap = runNestingSync(parsed.shapes, defaultSettings);
  assert.equal(snap.placements.length, 2);

  const exportBas = buildCorelExportMacro();
  assert.ok(exportBas.includes("Public Sub NestPro_ExportSelection()"));
  assert.ok(exportBas.includes("cdrMillimeter"));

  const applyBas = buildCorelApplyMacro(parsed.shapes, snap, defaultSettings, true);
  assert.ok(applyBas.includes("Public Sub NestPro_ApplyLayout()"));
  assert.ok(applyBas.includes("StaticID:=1042"));

  const vbs = buildCorelOneClickVBS(parsed.shapes, snap, defaultSettings);
  assert.ok(vbs.includes('CreateObject("CorelDRAW.Application")'));

  const dxf = sheetToDXF(parsed.shapes, snap, 0, defaultSettings);
  assert.ok(dxf.includes("INNER_HOLES"));
  assert.ok(dxf.includes("OUTER_CUT"));
  const reimportedDxf = parseDXF(dxf, "test.dxf");
  assert.ok(reimportedDxf.length >= 2);

  const svg = sheetToSVG(parsed.shapes, snap, 0, defaultSettings);
  assert.ok(svg.includes('width="2000mm"'));
  assert.ok(svg.includes("Layer_1_Inner_Holes_CutFirst"));

  const plt = sheetToHPGL(parsed.shapes, snap, 0, defaultSettings);
  assert.ok(plt.startsWith("IN;\nSP1;"));
});

test("Solid shapes with Fill+Stroke duplicate paths, Outlined Strokes, or Artboard MediaBox frames are never hollowed out", async () => {
  // 1. PDF/AI file with a MediaBox (1000x700 pt), an artboard rectangle (0 0 1000 700 re f),
  // and 3 solid shapes that each have both a Fill operation (f) and a duplicate Stroke operation (S),
  // plus 1 shape that has an Outlined 2mm Stroke (100x100 mm outer + 96x96 mm inner stroke edge)
  const ptPerMm = 72 / 25.4;
  const w100 = (100 * ptPerMm).toFixed(3);
  const w80 = (80 * ptPerMm).toFixed(3);
  const w60 = (60 * ptPerMm).toFixed(3);
  const off2 = (2 * ptPerMm).toFixed(3);
  const w96 = (96 * ptPerMm).toFixed(3);

  const aiContentStream = [
    // Artboard background rect matching MediaBox
    "0 0 1000 700 re f",
    // Shape 1: 100x80mm solid rect painted with Fill (f) AND duplicate Stroke (S)
    `50 50 ${w100} ${w80} re f`,
    `50 50 ${w100} ${w80} re S`,
    // Shape 2: 80x60mm solid rect painted with Fill (f) AND duplicate Stroke (S)
    `400 50 ${w80} ${w60} re f`,
    `400 50 ${w80} ${w60} re S`,
    // Shape 3: 100x100mm shape with an Outlined 2mm Stroke (outer 100x100 + inner 96x96 in a compound path)
    `50 300 ${w100} ${w100} re ${50 + parseFloat(off2)} ${300 + parseFloat(off2)} ${w96} ${w96} re f*`,
  ].join("\n");

  const aiPdf = `%PDF-1.6\n1 0 obj\n<< /Type /Page /MediaBox [0 0 1000 700] /Contents 2 0 R >>\nendobj\n2 0 obj\n<< /Length ${aiContentStream.length} >>\nstream\n${aiContentStream}\nendstream\nendobj\n%%EOF`;
  const importedShapes = await parseDirectPdfOrAiBuffer(
    new TextEncoder().encode(aiPdf).buffer,
    "SolidPartsJob.ai"
  );

  assert.equal(
    importedShapes.length,
    3,
    "Should strip the artboard rect, deduplicate Fill+Stroke paths, and return exactly 3 parts"
  );
  for (const sh of importedShapes) {
    assert.equal(
      sh.holes.length,
      0,
      `Shape ${sh.name} (${sh.w.toFixed(1)}x${sh.h.toFixed(1)}mm) must be 100% solid with 0 holes`
    );
  }

  // 2. Verify JSON export from Illustrator/CorelDRAW keeps separate items independent and solid
  const multiPartJson = JSON.stringify({
    host: "ai",
    doc: "Stickers.ai",
    shapes: [
      {
        origId: "NP_1",
        name: "Outer_Plate",
        qty: 1,
        points: [
          [0, 0],
          [300, 0],
          [300, 200],
          [0, 200],
        ],
        holes: [],
      },
      {
        origId: "NP_2",
        name: "Small_Badge_1",
        qty: 1,
        points: [
          [30, 30],
          [90, 30],
          [90, 80],
          [30, 80],
        ],
        holes: [],
      },
      {
        origId: "NP_3",
        name: "Small_Badge_2",
        qty: 1,
        points: [
          [120, 30],
          [180, 30],
          [180, 80],
          [120, 80],
        ],
        holes: [],
      },
    ],
  });

  const parsedJson = parseCADJsonExport(multiPartJson);
  assert.equal(
    parsedJson.shapes.length,
    3,
    "Separate selected items in JSON must remain 3 independent parts and never absorb each other as holes"
  );
  for (const s of parsedJson.shapes) {
    assert.equal(s.holes.length, 0, "Each independent JSON part should remain 100% solid");
  }
});

