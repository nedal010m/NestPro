import { getBBox, rotatePolygon, transformShapeToSheet } from "./geometry";
import type { NestSettings, NestSnapshot, Shape } from "./types";

/**
 * Generates the CorelDRAW VBA Macro (.bas) that exports the currently selected shapes
 * in CorelDRAW (X7 / 2020 / 2022 / 2024 / 2026) into a JSON file on the Desktop.
 */
export function buildCorelExportMacro(): string {
  return `' ============================================================================
' NestPro Studio — CorelDRAW Shape Exporter Macro (VBA)
' Compatible with CorelDRAW X7, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026
' ============================================================================
Option Explicit

Public Sub NestPro_ExportSelection()
    If Application.Documents.Count = 0 Then
        MsgBox "الرجاء فتح مستند CorelDRAW أولاً.", vbExclamation, "NestPro Studio"
        Exit Sub
    End If

    Dim doc As Document
    Set doc = ActiveDocument
    doc.Unit = cdrMillimeter
    doc.ReferencePoint = cdrBottomLeft

    Dim sel As ShapeRange
    Set sel = ActiveSelectionRange
    If sel.Count = 0 Then
        MsgBox "الرجاء تحديد القطع المراد تعشيقها داخل CorelDRAW ثم تشغيل الماكرو.", vbExclamation, "NestPro Studio"
        Exit Sub
    End If

    Dim json As String
    json = "{" & vbCrLf
    json = json & "  ""host"": ""corel""," & vbCrLf
    json = json & "  ""doc"": """ & EscapeJson(doc.Name) & """," & vbCrLf
    json = json & "  ""shapes"": [" & vbCrLf

    Dim idx As Long
    idx = 0
    Dim s As Shape
    For Each s In sel
        ' Tag shape name for direct re-application
        If Left(s.Name, 3) <> "NP#" Then
            s.Name = "NP#" & CStr(s.StaticID) & "_" & s.Name
        End If

        Dim crv As Curve
        On Error Resume Next
        Set crv = Nothing
        Set crv = s.DisplayCurve
        On Error GoTo 0

        If Not crv Is Nothing Then
            If crv.SubPaths.Count > 0 Then
                idx = idx + 1
                If idx > 1 Then json = json & "," & vbCrLf

                ' Find largest subpath as outer contour, others as inner holes
                Dim mainSp As SubPath
                Set mainSp = crv.SubPaths(1)
                Dim maxArea As Double
                maxArea = 0
                Dim sp As SubPath
                For Each sp In crv.SubPaths
                    Dim bbArea As Double
                    bbArea = sp.BoundingBox.Width * sp.BoundingBox.Height
                    If bbArea > maxArea Then
                        maxArea = bbArea
                        Set mainSp = sp
                    End If
                Next sp

                json = json & "    {" & vbCrLf
                json = json & "      ""staticId"": " & CStr(s.StaticID) & "," & vbCrLf
                json = json & "      ""origId"": """ & CStr(s.StaticID) & """," & vbCrLf
                json = json & "      ""name"": """ & EscapeJson(s.Name) & """," & vbCrLf
                json = json & "      ""qty"": 1," & vbCrLf
                json = json & "      ""points"": " & SampleSubPathToJson(mainSp, 24) & "," & vbCrLf
                json = json & "      ""holes"": ["

                Dim hCount As Long
                hCount = 0
                For Each sp In crv.SubPaths
                    If sp.Index <> mainSp.Index Then
                        hCount = hCount + 1
                        If hCount > 1 Then json = json & ", "
                        json = json & SampleSubPathToJson(sp, 16)
                    End If
                Next sp
                json = json & "]" & vbCrLf
                json = json & "    }"
            End If
        ElseIf s.SizeWidth > 0.1 And s.SizeHeight > 0.1 Then
            ' Group shape fallback: export group outer bounding contour as 1 unified solid shape
            idx = idx + 1
            If idx > 1 Then json = json & "," & vbCrLf
            Dim gx1 As String, gy1 As String, gx2 As String, gy2 As String
            gx1 = FormatNum(s.LeftX)
            gy1 = FormatNum(-s.TopY)
            gx2 = FormatNum(s.RightX)
            gy2 = FormatNum(-s.BottomY)
            json = json & "    {" & vbCrLf
            json = json & "      ""staticId"": " & CStr(s.StaticID) & "," & vbCrLf
            json = json & "      ""origId"": """ & CStr(s.StaticID) & """," & vbCrLf
            json = json & "      ""name"": """ & EscapeJson(s.Name) & """," & vbCrLf
            json = json & "      ""qty"": 1," & vbCrLf
            json = json & "      ""points"": [[" & gx1 & "," & gy1 & "],[" & gx2 & "," & gy1 & "],[" & gx2 & "," & gy2 & "],[" & gx1 & "," & gy2 & "]]," & vbCrLf
            json = json & "      ""holes"": []" & vbCrLf
            json = json & "    }"
        End If
    Next s

    json = json & vbCrLf & "  ]" & vbCrLf & "}"

    Dim outPath As String
    outPath = Environ("USERPROFILE") & "\\Desktop\\NestPro_Corel_Export.json"

    Dim fso As Object, ts As Object
    Set fso = CreateObject("Scripting.FileSystemObject")
    Set ts = fso.CreateTextFile(outPath, True, True) ' Unicode
    ts.Write json
    ts.Close

    MsgBox "تم تصدير " & CStr(idx) & " قطعة بنجاح إلى سطح المكتب:" & vbCrLf & outPath, vbInformation, "NestPro Studio"
End Sub

Private Function SampleSubPathToJson(sp As SubPath, ByVal segSamples As Long) As String
    Dim res As String
    res = "["
    Dim first As Boolean
    first = True
    Dim seg As Segment
    Dim i As Long
    For Each seg In sp.Segments
        Dim steps As Long
        If seg.Type = cdrLineSegment Then steps = 1 Else steps = 6
        For i = 0 To steps - 1
            Dim t As Double
            t = CDbl(i) / CDbl(steps)
            Dim px As Double, py As Double
            seg.GetPointPositionAt px, py, t, cdrParametricSegmentOffset
            If Not first Then res = res & ","
            first = False
            ' Note: CorelDRAW Y axis points UP; negate Y so top-down screen coordinates match
            res = res & "[" & FormatNum(px) & "," & FormatNum(-py) & "]"
        Next i
    Next seg
    res = res & "]"
    SampleSubPathToJson = res
End Function

Private Function FormatNum(ByVal v As Double) As String
    FormatNum = Replace(Format(v, "0.000"), ",", ".")
End Function

Private Function EscapeJson(ByVal txt As String) As String
    Dim r As String
    r = Replace(txt, "\\", "\\\\")
    r = Replace(r, """", "\\""")
    EscapeJson = r
End Function
`;
}

/**
 * Generates a CorelDRAW VBA Macro (.bas) that applies the computed nesting layout
 * directly inside CorelDRAW (creates raw material sheets, clones/transforms original shapes
 * or reconstructs vector curves with Hairline cut contours).
 */
export function buildCorelApplyMacro(
  shapes: Shape[],
  snap: NestSnapshot,
  st: NestSettings,
  cleanTags = true
): string {
  const shapeById = new Map(shapes.map((s) => [s.id, s]));
  const sheetGap = 40; // 40mm gap between sheets in CorelDRAW workspace

  const lines: string[] = [
    "' ============================================================================",
    "' NestPro Studio — CorelDRAW Auto-Apply Nesting Macro (VBA)",
    `' Sheets: ${snap.sheets} | Placed Parts: ${snap.placements.length} | Sheet Size: ${st.sheetW}x${st.sheetH} mm`,
    "' ============================================================================",
    "Option Explicit",
    "",
    "Public Sub NestPro_ApplyLayout()",
    "    Dim doc As Document",
    "    If Application.Documents.Count = 0 Then",
    "        Set doc = Application.CreateDocument()",
    "    Else",
    "        Set doc = ActiveDocument",
    "    End If",
    "",
    "    doc.Unit = cdrMillimeter",
    "    doc.ReferencePoint = cdrBottomLeft",
    "    Application.Optimization = True",
    "    doc.BeginCommandGroup \"NestPro True-Shape Nesting\"",
    "    On Error GoTo ErrHandler",
    "",
    "    Dim lyrSheet As Layer, lyrInner As Layer, lyrOuter As Layer",
    "    Set lyrSheet = GetOrCreateLayer(doc.ActivePage, \"NestPro_Sheets\")",
    "    Set lyrInner = GetOrCreateLayer(doc.ActivePage, \"NestPro_Inner_Cut\")",
    "    Set lyrOuter = GetOrCreateLayer(doc.ActivePage, \"NestPro_Outer_Cut\")",
    "",
    "    Dim sRect As Shape, mRect As Shape",
  ];

  // Draw sheet borders & margin guides
  for (let s = 0; s < snap.sheets; s++) {
    const offsetX = s * (st.sheetW + sheetGap);
    const x1 = offsetX.toFixed(3);
    const y1 = (-st.sheetH).toFixed(3);
    const x2 = (offsetX + st.sheetW).toFixed(3);
    const y2 = "0.000";
    lines.push(
      `    ' --- Sheet #${s + 1} (${st.sheetW} x ${st.sheetH} mm) ---`,
      `    Set sRect = lyrSheet.CreateRectangle2(${x1}, ${y1}, ${st.sheetW.toFixed(3)}, ${st.sheetH.toFixed(3)})`,
      `    sRect.Fill.ApplyNoFill`,
      `    sRect.Outline.SetProperties 0.25, , CreateRGBColor(100, 116, 139)`,
      `    sRect.Name = "Sheet_${s + 1}"`
    );
    if (st.margin > 0) {
      const mx = (offsetX + st.margin).toFixed(3);
      const my = (-st.sheetH + st.margin).toFixed(3);
      const mw = (st.sheetW - st.margin * 2).toFixed(3);
      const mh = (st.sheetH - st.margin * 2).toFixed(3);
      lines.push(
        `    Set mRect = lyrSheet.CreateRectangle2(${mx}, ${my}, ${mw}, ${mh})`,
        `    mRect.Fill.ApplyNoFill`,
        `    mRect.Outline.SetProperties 0.1, , CreateRGBColor(71, 85, 105)`
      );
    }
  }

  lines.push("");
  lines.push("    ' --- Place Nested Parts ---");
  lines.push("    Dim origShape As Shape, dup As Shape");

  const sortedPlacements = [...snap.placements].sort((a, b) => {
    if (a.sheet !== b.sheet) return a.sheet - b.sheet;
    return (a.cutOrder || 0) - (b.cutOrder || 0);
  });

  for (let i = 0; i < sortedPlacements.length; i++) {
    const p = sortedPlacements[i];
    const sh = shapeById.get(p.shapeId);
    if (!sh) continue;

    const sheetOffsetX = p.sheet * (st.sheetW + sheetGap);
    const rotPts = rotatePolygon(sh.points, p.angle);
    const rbb = getBBox(rotPts);

    // CorelDRAW uses Y-up coordinates, so a top-down Y position [p.y, p.y + rbb.h]
    // maps to Corel bottom-left (X = sheetOffsetX + p.x, BottomY = -(p.y + rbb.h))
    const targetLeftX = (sheetOffsetX + p.x).toFixed(3);
    const targetBottomY = (-(p.y + rbb.h)).toFixed(3);
    // Clockwise angle in top-down space = Counter-clockwise (-angle) in Corel Y-up space
    const corelAngle = ((-p.angle % 360) + 360) % 360;

    if (sh.source === "corel" && sh.origId && /^\d+$/.test(sh.origId)) {
      lines.push(
        `    Set origShape = doc.ActivePage.FindShape(StaticID:=${sh.origId})`,
        `    If Not origShape Is Nothing Then`,
        `        Set dup = origShape.Duplicate(0, 0)`,
        `        dup.MoveToLayer lyrOuter`,
        `        If ${corelAngle.toFixed(3)} <> 0 Then dup.Rotate ${corelAngle.toFixed(3)}`,
        `        dup.LeftX = ${targetLeftX}`,
        `        dup.BottomY = ${targetBottomY}`,
        `        dup.Name = "${sh.name.replace(/"/g, "")}_#${i + 1}"`,
        `    Else`,
        ... emitVectorCurveFallback(sh, p.x + sheetOffsetX, p.y, p.angle, i + 1),
        `    End If`
      );
    } else {
      lines.push(
        ...emitVectorCurveFallback(sh, p.x + sheetOffsetX, p.y, p.angle, i + 1)
      );
    }
  }

  if (cleanTags) {
    lines.push(
      "",
      "    ' Clean temporary NP# tags on original shapes",
      "    Dim chk As Shape",
      "    For Each chk In doc.ActivePage.Shapes.All",
      "        If Left(chk.Name, 3) = \"NP#\" Then",
      "            Dim uPos As Long",
      "            uPos = InStr(chk.Name, \"_\")",
      "            If uPos > 0 Then chk.Name = Mid(chk.Name, uPos + 1)",
      "        End If",
      "    Next chk"
    );
  }

  lines.push(
    "",
    "ErrHandler:",
    "    doc.EndCommandGroup",
    "    Application.Optimization = False",
    "    ActiveWindow.Refresh",
    "    Application.Refresh",
    `    MsgBox "تم تطبيق التعشيق بنجاح داخل CorelDRAW (${snap.placements.length} قطعة على ${snap.sheets} لوح)!", vbInformation, "NestPro Studio"`,
    "End Sub",
    "",
    "Private Function GetOrCreateLayer(pg As Page, ByVal lyrName As String) As Layer",
    "    Dim l As Layer",
    "    For Each l In pg.Layers",
    "        If l.Name = lyrName Then",
    "            Set GetOrCreateLayer = l",
    "            Exit Function",
    "        End If",
    "    Next l",
    "    Set GetOrCreateLayer = pg.CreateLayer(lyrName)",
    "End Function",
    "",
    "Private Function DrawPolyOnLayer(doc As Document, lyr As Layer, pts As Variant, ByVal isHole As Boolean, ByVal sName As String) As Shape",
    "    Dim crv As Curve",
    "    Set crv = doc.CreateCurve()",
    "    Dim sp As SubPath",
    "    Dim lb As Long, ub As Long, k As Long",
    "    lb = LBound(pts)",
    "    ub = UBound(pts)",
    "    Set sp = crv.CreateSubPath(CDbl(pts(lb)), CDbl(pts(lb + 1)))",
    "    For k = lb + 2 To ub Step 2",
    "        sp.AppendLineSegment CDbl(pts(k)), CDbl(pts(k + 1))",
    "    Next k",
    "    sp.Closed = True",
    "    Dim sh As Shape",
    "    Set sh = lyr.CreateCurve(crv)",
    "    sh.Fill.ApplyNoFill",
    "    If isHole Then",
    "        sh.Outline.SetProperties 0.0762, , CreateRGBColor(0, 120, 255) ' Hairline Blue for Inner Holes",
    "    Else",
    "        sh.Outline.SetProperties 0.0762, , CreateRGBColor(255, 0, 0)   ' Hairline Red for Outer Cut",
    "    End If",
    "    sh.Name = sName",
    "    Set DrawPolyOnLayer = sh",
    "End Function"
  );

  return lines.join("\r\n");
}

function emitVectorCurveFallback(
  sh: Shape,
  sheetX: number,
  sheetY: number,
  angle: number,
  partNum: number
): string[] {
  const tr = transformShapeToSheet(sh, sheetX, sheetY, angle);
  const out: string[] = [];
  const safeName = sh.name.replace(/"/g, "");

  // Emit holes first on Inner Cut layer
  tr.holes.forEach((h, hIdx) => {
    const coords = h.map((pt) => `${pt.x.toFixed(2)}, ${(-pt.y).toFixed(2)}`).join(", ");
    out.push(
      `        Call DrawPolyOnLayer(doc, lyrInner, Array(${coords}), True, "${safeName}_Hole_${partNum}_${hIdx + 1}")`
    );
  });

  // Emit outer contour on Outer Cut layer
  const outerCoords = tr.outer
    .map((pt) => `${pt.x.toFixed(2)}, ${(-pt.y).toFixed(2)}`)
    .join(", ");
  out.push(
    `        Call DrawPolyOnLayer(doc, lyrOuter, Array(${outerCoords}), False, "${safeName}_#${partNum}")`
  );
  return out;
}

/**
 * Generates a standalone Windows VBScript (.vbs) file that connects to CorelDRAW via COM Automation
 * when double-clicked on Windows, creating the sheets and nested vectors automatically without opening the VBA IDE!
 */
export function buildCorelOneClickVBS(
  shapes: Shape[],
  snap: NestSnapshot,
  st: NestSettings
): string {
  const shapeById = new Map(shapes.map((s) => [s.id, s]));
  const sheetGap = 40;

  const lines: string[] = [
    "' ============================================================================",
    "' NestPro Studio — One-Click CorelDRAW Automation Script (.vbs)",
    "' Double-click this file on Windows while CorelDRAW is open!",
    "' ============================================================================",
    "Option Explicit",
    "On Error Resume Next",
    "Dim app, doc, pg, lyrSheet, lyrCut",
    "Set app = CreateObject(\"CorelDRAW.Application\")",
    "If Err.Number <> 0 Or app Is Nothing Then",
    "    MsgBox \"تعذر الاتصال ببرنامج CorelDRAW. تأكد من أن البرنامج مثبت ومفتوح على جهازك.\", 48, \"NestPro Studio\"",
    "    WScript.Quit",
    "End If",
    "On Error GoTo 0",
    "app.Visible = True",
    "If app.Documents.Count = 0 Then",
    "    Set doc = app.CreateDocument()",
    "Else",
    "    Set doc = app.ActiveDocument",
    "End If",
    "doc.Unit = 3 ' cdrMillimeter = 3",
    "doc.ReferencePoint = 7 ' cdrBottomLeft = 7",
    "Set pg = doc.ActivePage",
    "pg.SetSize " + st.sheetW.toFixed(2) + ", " + st.sheetH.toFixed(2),
    "Set lyrSheet = pg.CreateLayer(\"NestPro_Sheets\")",
    "Set lyrCut = pg.CreateLayer(\"NestPro_Cut_Layout\")",
  ];

  for (let s = 0; s < snap.sheets; s++) {
    const offsetX = s * (st.sheetW + sheetGap);
    lines.push(
      `Call lyrSheet.CreateRectangle2(${offsetX.toFixed(2)}, 0, ${st.sheetW.toFixed(2)}, ${st.sheetH.toFixed(2)})`
    );
  }

  for (let i = 0; i < snap.placements.length; i++) {
    const p = snap.placements[i];
    const sh = shapeById.get(p.shapeId);
    if (!sh) continue;
    const offsetX = p.sheet * (st.sheetW + sheetGap);
    const tr = transformShapeToSheet(sh, offsetX + p.x, p.y, p.angle);

    const emitRing = (pts: { x: number; y: number }[]) => {
      if (pts.length < 3) return;
      lines.push("Dim crv, sp");
      lines.push("Set crv = doc.CreateCurve()");
      lines.push(
        `Set sp = crv.CreateSubPath(${pts[0].x.toFixed(2)}, ${(st.sheetH - pts[0].y).toFixed(2)})`
      );
      for (let k = 1; k < pts.length; k++) {
        lines.push(
          `Call sp.AppendLineSegment(${pts[k].x.toFixed(2)}, ${(st.sheetH - pts[k].y).toFixed(2)})`
        );
      }
      lines.push("sp.Closed = True");
      lines.push("Call lyrCut.CreateCurve(crv)");
    };

    for (const h of tr.holes) emitRing(h);
    emitRing(tr.outer);
  }

  lines.push(
    "app.Refresh",
    `MsgBox "تم إرسال وتطبيق التعشيق مباشرة داخل CorelDRAW (${snap.placements.length} قطعة)!", 64, "NestPro Studio"`
  );

  return lines.join("\r\n");
}
