import { getBBox, rotatePolygon, transformShapeToSheet } from "./geometry";
import type { NestSettings, NestSnapshot, Shape } from "./types";

const MM_TO_PT = 72 / 25.4;

/**
 * Generates the Adobe Illustrator ExtendScript (.jsx) that exports selected shapes to JSON.
 */
export function buildIllustratorExportScript(): string {
  return `// ============================================================================
// NestPro Studio — Adobe Illustrator Exporter Script (.jsx)
// Run via: File > Scripts > Other Script... (Ctrl+F12)
// ============================================================================
#target illustrator

(function () {
  if (app.documents.length === 0) {
    alert("الرجاء فتح مستند Illustrator أولاً.");
    return;
  }
  var doc = app.activeDocument;
  var sel = doc.selection;
  if (!sel || sel.length === 0) {
    alert("الرجاء تحديد العناصر المراد تعشيقها أولاً.");
    return;
  }

  var PT_TO_MM = 25.4 / 72.0;
  var items = [];

  function samplePathItem(pi) {
    var pts = [];
    var pp = pi.pathPoints;
    var n = pp.length;
    if (n === 0) return pts;
    for (var i = 0; i < n; i++) {
      var p0 = pp[i];
      var p1 = pp[(i + 1) % n];
      var a0 = p0.anchor;
      var r0 = p0.rightDirection;
      var l1 = p1.leftDirection;
      var a1 = p1.anchor;
      var isCurved =
        Math.abs(r0[0] - a0[0]) > 0.05 ||
        Math.abs(r0[1] - a0[1]) > 0.05 ||
        Math.abs(l1[0] - a1[0]) > 0.05 ||
        Math.abs(l1[1] - a1[1]) > 0.05;
      var steps = isCurved ? 8 : 1;
      for (var s = 0; s < steps; s++) {
        var t = s / steps;
        var mt = 1 - t;
        var x =
          mt * mt * mt * a0[0] +
          3 * mt * mt * t * r0[0] +
          3 * mt * t * t * l1[0] +
          t * t * t * a1[0];
        var y =
          mt * mt * mt * a0[1] +
          3 * mt * mt * t * r0[1] +
          3 * mt * t * t * l1[1] +
          t * t * t * a1[1];
        pts.push([
          Math.round(x * PT_TO_MM * 1000) / 1000,
          Math.round(-y * PT_TO_MM * 1000) / 1000
        ]);
      }
    }
    return pts;
  }

  function polyArea(pts) {
    var sum = 0;
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i];
      var b = pts[(i + 1) % pts.length];
      sum += a[0] * b[1] - b[0] * a[1];
    }
    return Math.abs(sum * 0.5);
  }

  function collectGroupPaths(grp, list) {
    for (var g = 0; g < grp.pageItems.length; g++) {
      var sub = grp.pageItems[g];
      if (sub.guides) continue;
      if (sub.typename === "PathItem") {
        var pts = samplePathItem(sub);
        if (pts.length >= 3) list.push({ pts: pts, area: polyArea(pts), clipping: !!sub.clipping });
      } else if (sub.typename === "CompoundPathItem" && sub.pathItems.length > 0) {
        for (var h = 0; h < sub.pathItems.length; h++) {
          var sPts = samplePathItem(sub.pathItems[h]);
          if (sPts.length >= 3) list.push({ pts: sPts, area: polyArea(sPts), clipping: !!sub.pathItems[h].clipping });
        }
      } else if (sub.typename === "GroupItem") {
        collectGroupPaths(sub, list);
      }
    }
  }

  function exportItem(it, idx) {
    if (it.guides) return;
    var tag = "NP_" + idx + "_" + (new Date().getTime() % 100000);
    try { it.note = tag; } catch (e) {}

    if (it.typename === "PathItem") {
      var sampledSingle = samplePathItem(it);
      if (sampledSingle.length >= 3) {
        items.push({
          origId: tag,
          name: it.name || ("Path #" + idx),
          qty: 1,
          points: sampledSingle,
          holes: []
        });
      }
    } else if (it.typename === "CompoundPathItem" && it.pathItems.length > 0) {
      var rings = [];
      for (var h = 0; h < it.pathItems.length; h++) {
        if (it.pathItems[h].guides) continue;
        var sampled = samplePathItem(it.pathItems[h]);
        if (sampled.length >= 3) {
          rings.push({ pts: sampled, area: polyArea(sampled) });
        }
      }
      rings.sort(function (a, b) { return b.area - a.area; });
      if (rings.length > 0) {
        var holes = [];
        for (var k = 1; k < rings.length; k++) holes.push(rings[k].pts);
        items.push({
          origId: tag,
          name: it.name || ("Compound #" + idx),
          qty: 1,
          points: rings[0].pts,
          holes: holes
        });
      }
    } else if (it.typename === "GroupItem") {
      // Export a selected GroupItem as ONE unified solid piece so its internal artwork is never hollowed out or scattered!
      var grpPaths = [];
      collectGroupPaths(it, grpPaths);
      grpPaths.sort(function (a, b) { return b.area - a.area; });
      var gb = it.geometricBounds; // [left, top, right, bottom] in pt
      var gw = Math.abs(gb[2] - gb[0]) * PT_TO_MM;
      var gh = Math.abs(gb[1] - gb[3]) * PT_TO_MM;
      var gbArea = gw * gh;
      var outerPts = null;
      // If there is a clipping mask or a single outer contour covering >= 70% of the group's bounds, use its exact true-shape contour
      for (var pIdx = 0; pIdx < grpPaths.length; pIdx++) {
        if (grpPaths[pIdx].clipping || grpPaths[pIdx].area >= gbArea * 0.70) {
          outerPts = grpPaths[pIdx].pts;
          break;
        }
      }
      if (!outerPts) {
        var x1 = Math.round(gb[0] * PT_TO_MM * 1000) / 1000;
        var y1 = Math.round(-gb[1] * PT_TO_MM * 1000) / 1000;
        var x2 = Math.round(gb[2] * PT_TO_MM * 1000) / 1000;
        var y2 = Math.round(-gb[3] * PT_TO_MM * 1000) / 1000;
        outerPts = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
      }
      items.push({
        origId: tag,
        name: it.name || ("Group #" + idx),
        qty: 1,
        points: outerPts,
        holes: []
      });
    }
  }

  for (var i = 0; i < sel.length; i++) {
    exportItem(sel[i], i + 1);
  }

  var outFile = new File(Folder.desktop + "/NestPro_AI_Export.json");
  outFile.encoding = "UTF-8";
  outFile.open("w");
  outFile.write('{\\n  "host": "ai",\\n  "doc": "' + doc.name.replace(/"/g, '\\\\"') + '",\\n  "shapes": ' + toJson(items) + '\\n}');
  outFile.close();

  alert("تم تصدير " + items.length + " عنصر إلى سطح المكتب:\\n" + outFile.fsName);

  function toJson(v) {
    if (v === null || v === undefined) return "null";
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (typeof v === "string") return '"' + v.replace(/\\\\/g, "\\\\\\\\").replace(/"/g, '\\\\"') + '"';
    if (v instanceof Array) {
      var a = [];
      for (var k = 0; k < v.length; k++) a.push(toJson(v[k]));
      return "[" + a.join(",") + "]";
    }
    var pairs = [];
    for (var key in v) {
      if (v.hasOwnProperty(key)) pairs.push(toJson(key) + ":" + toJson(v[key]));
    }
    return "{" + pairs.join(",") + "}";
  }
})();
`;
}

/**
 * Generates the Adobe Illustrator ExtendScript (.jsx) that applies the nested layout.
 */
export function buildApplyScript(
  shapes: Shape[],
  snap: NestSnapshot,
  st: NestSettings,
  cleanTags = true
): string {
  const shapeById = new Map(shapes.map((s) => [s.id, s]));
  const sheetGapMm = 30;

  const lines: string[] = [
    "// ============================================================================",
    "// NestPro Studio — Adobe Illustrator Auto-Apply Script (.jsx)",
    `// Sheets: ${snap.sheets} | Placed Parts: ${snap.placements.length} | Sheet: ${st.sheetW}x${st.sheetH} mm`,
    "// ============================================================================",
    "#target illustrator",
    "(function () {",
    "  var MM = 72.0 / 25.4;",
    "  var doc = app.documents.length ? app.activeDocument : app.documents.add(DocumentColorSpace.CMYK, " +
      (st.sheetW * MM_TO_PT).toFixed(2) +
      ", " +
      (st.sheetH * MM_TO_PT).toFixed(2) +
      ");",
    "  var lyr = doc.layers.add();",
    '  lyr.name = "NestPro_Layout";',
    "  var byNote = {};",
    "  for (var i = 0; i < doc.pageItems.length; i++) {",
    "    var pi = doc.pageItems[i];",
    "    if (pi.note) byNote[pi.note] = pi;",
    "  }",
  ];

  for (let s = 0; s < snap.sheets; s++) {
    const ox = s * (st.sheetW + sheetGapMm);
    lines.push(
      `  var sheetRect_${s} = lyr.pathItems.rectangle(0, ${(ox * MM_TO_PT).toFixed(3)}, ${(st.sheetW * MM_TO_PT).toFixed(3)}, ${(st.sheetH * MM_TO_PT).toFixed(3)});`,
      `  sheetRect_${s}.filled = false;`,
      `  sheetRect_${s}.stroked = true;`
    );
  }

  for (let i = 0; i < snap.placements.length; i++) {
    const p = snap.placements[i];
    const sh = shapeById.get(p.shapeId);
    if (!sh) continue;
    const ox = p.sheet * (st.sheetW + sheetGapMm);
    const rotPts = rotatePolygon(sh.points, p.angle);
    const rbb = getBBox(rotPts);
    const leftPt = ((ox + p.x) * MM_TO_PT).toFixed(3);
    const topPt = (-p.y * MM_TO_PT).toFixed(3);
    const aiAngle = ((-p.angle % 360) + 360) % 360;
    const tr = transformShapeToSheet(sh, ox + p.x, p.y, p.angle);
    const outerPtsStr = tr.outer
      .map((pt) => `[${(pt.x * MM_TO_PT).toFixed(2)}, ${(-pt.y * MM_TO_PT).toFixed(2)}]`)
      .join(",");

    const fallbackLines: string[] = [];
    if (tr.holes.length > 0 && st.holes) {
      fallbackLines.push(`    var cp_${i} = lyr.compoundPathItems.add();`);
      fallbackLines.push(
        `    var po_${i} = cp_${i}.pathItems.add();`,
        `    po_${i}.setEntirePath([${outerPtsStr}]);`,
        `    po_${i}.closed = true;`
      );
      tr.holes.forEach((h, hIdx) => {
        const hStr = h
          .map((pt) => `[${(pt.x * MM_TO_PT).toFixed(2)}, ${(-pt.y * MM_TO_PT).toFixed(2)}]`)
          .join(",");
        fallbackLines.push(
          `    var ph_${i}_${hIdx} = cp_${i}.pathItems.add();`,
          `    ph_${i}_${hIdx}.setEntirePath([${hStr}]);`,
          `    ph_${i}_${hIdx}.closed = true;`
        );
      });
    } else {
      fallbackLines.push(
        `    var p_${i} = lyr.pathItems.add();`,
        `    p_${i}.setEntirePath([${outerPtsStr}]);`,
        `    p_${i}.closed = true;`,
        `    p_${i}.stroked = true;`
      );
    }

    if (sh.origId) {
      const baseOrigId = sh.origId.replace(/_\d+$/, "");
      lines.push(
        `  var src_${i} = byNote[${JSON.stringify(sh.origId)}] || byNote[${JSON.stringify(baseOrigId)}];`,
        `  if (src_${i}) {`,
        `    var dup_${i} = src_${i}.duplicate(lyr, ElementPlacement.PLACEATBEGINNING);`,
        `    if (${aiAngle.toFixed(3)} !== 0) dup_${i}.rotate(${aiAngle.toFixed(3)});`,
        `    dup_${i}.position = [${leftPt}, ${topPt}];`,
        cleanTags ? `    dup_${i}.note = "";` : "",
        `  } else {`,
        ...fallbackLines,
        `  }`
      );
    } else {
      lines.push(...fallbackLines);
    }
    void rbb;
  }

  if (cleanTags) {
    lines.push(
      "  for (var k in byNote) { if (byNote.hasOwnProperty(k)) byNote[k].note = ''; }"
    );
  }

  lines.push(
    '  alert("تم تطبيق التعشيق بنجاح داخل Illustrator!");',
    "})();"
  );

  return lines.join("\n");
}
