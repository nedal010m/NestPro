import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Crosshair,
  Eye,
  Grid,
  Layers,
  Maximize2,
  Move,
  RotateCw,
  Route,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { polygonToPathD, shapePerimeter, transformShapeToSheet } from "../lib/geometry";
import type { NestSettings, NestSnapshot, Placement, Shape } from "../lib/types";

interface PreviewProps {
  shapes: Shape[];
  snap: NestSnapshot | null;
  sheet: number;
  st: NestSettings;
  unitFactor: number;
  unitLabel: string;
  showOutline: boolean;
  onUpdatePlacement?: (placementId: string, patch: Partial<Placement>) => void;
}

export default function Preview({
  shapes,
  snap,
  sheet,
  st,
  unitFactor,
  unitLabel,
  showOutline,
  onUpdatePlacement,
}: PreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null);
  const [hoveredPlacementId, setHoveredPlacementId] = useState<string | null>(null);

  // CAD Overlay toggles
  const [showGrid, setShowGrid] = useState(true);
  const [showCutPath, setShowCutPath] = useState(false);
  const [showRemnantBox, setShowRemnantBox] = useState(true);
  const [hairlineMode, setHairlineMode] = useState(false);

  const shapeById = useMemo(() => new Map(shapes.map((s) => [s.id, s])), [shapes]);

  const sheetPlacements = useMemo(() => {
    if (!snap) return [];
    return snap.placements
      .filter((p) => p.sheet === sheet)
      .sort((a, b) => (a.cutOrder || 0) - (b.cutOrder || 0));
  }, [snap, sheet]);

  const transformedItems = useMemo(() => {
    return sheetPlacements
      .map((p, idx) => {
        const sh = shapeById.get(p.shapeId);
        if (!sh) return null;
        const tr = transformShapeToSheet(sh, p.x, p.y, p.angle);
        const activeHoles = st.holes ? tr.holes : [];
        const cx = (tr.bbox.minX + tr.bbox.maxX) / 2;
        const cy = (tr.bbox.minY + tr.bbox.maxY) / 2;
        return {
          placement: p,
          shape: sh,
          outerD: polygonToPathD(tr.outer, activeHoles),
          outerOnlyD: polygonToPathD(tr.outer),
          holesD: activeHoles.map((h) => polygonToPathD(h)),
          bbox: tr.bbox,
          cx,
          cy,
          orderNum: p.cutOrder || idx + 1,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [sheetPlacements, shapeById, st.holes]);

  // Compute bounding box of all placed parts on the active sheet + remnant offcut
  const usedBounds = useMemo(() => {
    if (!transformedItems.length) return null;
    let maxX = 0;
    let maxY = 0;
    for (const it of transformedItems) {
      if (it.bbox.maxX > maxX) maxX = it.bbox.maxX;
      if (it.bbox.maxY > maxY) maxY = it.bbox.maxY;
    }
    return {
      maxX: Math.min(st.sheetW, maxX),
      maxY: Math.min(st.sheetH, maxY),
      remnantW: Math.max(0, st.sheetW - maxX),
      remnantH: Math.max(0, st.sheetH - maxY),
    };
  }, [transformedItems, st.sheetW, st.sheetH]);

  // Calculate total laser travel distance & cutting perimeter on this sheet
  const cutMetrics = useMemo(() => {
    let cutLenMm = 0;
    let rapidLenMm = 0;
    let prevX = 0;
    let prevY = 0;
    for (const it of transformedItems) {
      cutLenMm += shapePerimeter(it.shape);
      rapidLenMm += Math.hypot(it.cx - prevX, it.cy - prevY);
      prevX = it.cx;
      prevY = it.cy;
    }
    const estSeconds = st.cutSpeed > 0 ? cutLenMm / st.cutSpeed + rapidLenMm / 250 : 0;
    return { cutLenMm, rapidLenMm, estSeconds };
  }, [transformedItems, st.cutSpeed]);

  const selectedItem = useMemo(
    () => transformedItems.find((it) => it.placement.id === selectedPlacementId) || null,
    [transformedItems, selectedPlacementId]
  );

  useEffect(() => {
    if (
      selectedPlacementId &&
      !transformedItems.some((it) => it.placement.id === selectedPlacementId)
    ) {
      setSelectedPlacementId(null);
    }
  }, [transformedItems, selectedPlacementId]);

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    setZoom((z) => Math.min(8, Math.max(0.4, Math.round(z * factor * 100) / 100)));
  };

  const pad = Math.max(st.sheetW, st.sheetH) * 0.055;
  const vbW = st.sheetW + pad * 2;
  const vbH = st.sheetH + pad * 2;

  // Grid step in mm (adaptive to sheet size)
  const majorGridStep = useMemo(() => {
    const maxD = Math.max(st.sheetW, st.sheetH);
    if (maxD <= 400) return 50;
    if (maxD <= 1500) return 100;
    return 200;
  }, [st.sheetW, st.sheetH]);

  const fmtU = (mmVal: number) => (mmVal / unitFactor).toFixed(unitFactor === 1 ? 0 : 1);

  return (
    <div
      ref={containerRef}
      data-testid="cad-preview-viewport"
      className="relative flex h-full w-full flex-col overflow-hidden rounded-xl border border-slate-800 bg-[#050912] select-none"
    >
      {/* Top CAD Canvas Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/90 bg-[#09101f]/90 px-3 py-1.5 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowGrid((v) => !v)}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors whitespace-nowrap shrink-0 ${
              showGrid
                ? "bg-slate-800 text-emerald-400 border border-emerald-500/30"
                : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
            }`}
          >
            <Grid className="h-3.5 w-3.5" />
            <span>الشبكة والمساطر</span>
          </button>

          <button
            type="button"
            onClick={() => setHairlineMode((v) => !v)}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors whitespace-nowrap shrink-0 ${
              hairlineMode
                ? "bg-slate-800 text-rose-400 border border-rose-500/30"
                : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>وضع خطوط القص (Hairline)</span>
          </button>

          <button
            type="button"
            onClick={() => setShowCutPath((v) => !v)}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors whitespace-nowrap shrink-0 ${
              showCutPath
                ? "bg-slate-800 text-amber-300 border border-amber-500/30"
                : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
            }`}
          >
            <Route className="h-3.5 w-3.5" />
            <span>مسار وتسلسل الليزر</span>
          </button>

          <button
            type="button"
            onClick={() => setShowRemnantBox((v) => !v)}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors whitespace-nowrap shrink-0 ${
              showRemnantBox
                ? "bg-slate-800 text-cyan-300 border border-cyan-500/30"
                : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
            }`}
          >
            <Eye className="h-3.5 w-3.5" />
            <span>حدود الفضلة المتبقية</span>
          </button>
        </div>

        {/* Zoom & View Controls */}
        <div className="flex items-center gap-1.5">
          {snap && transformedItems.length > 0 && (
            <div className="hidden md:flex items-center gap-2 text-[11px] text-slate-400 ml-2 font-mono tabular-nums">
              <span>طول القص: {(cutMetrics.cutLenMm / 1000).toFixed(2)} م</span>
              <span aria-hidden="true">·</span>
              <span>زمن الليزر: {Math.ceil(cutMetrics.estSeconds)} ث</span>
            </div>
          )}
          <button
            type="button"
            aria-label="تصغير العرض"
            onClick={() => setZoom((z) => Math.max(0.4, Math.round((z - 0.2) * 10) / 10))}
            className="rounded-md border border-slate-700/80 bg-slate-800/80 p-1 text-slate-300 hover:border-slate-600 hover:text-white"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-[46px] text-center font-mono text-[11px] text-slate-300 tabular-nums" dir="ltr">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            aria-label="تكبير العرض"
            onClick={() => setZoom((z) => Math.min(8, Math.round((z + 0.2) * 10) / 10))}
            className="rounded-md border border-slate-700/80 bg-slate-800/80 p-1 text-slate-300 hover:border-slate-600 hover:text-white"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={resetView}
            className="flex items-center gap-1 rounded-md border border-slate-700/80 bg-slate-800/80 px-2 py-1 text-[11px] text-slate-300 hover:border-slate-600 hover:text-white whitespace-nowrap shrink-0"
          >
            <Maximize2 className="h-3 w-3" />
            <span>ملاءمة</span>
          </button>
        </div>
      </div>

      {/* Main Interactive SVG Canvas */}
      <div
        onWheel={handleWheel}
        onMouseDown={(e) => {
          if (e.button === 0) {
            setIsPanning(true);
            setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
          }
        }}
        onMouseMove={(e) => {
          if (isPanning) {
            setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
          }
        }}
        onMouseUp={() => setIsPanning(false)}
        onMouseLeave={() => setIsPanning(false)}
        className={`relative flex-1 overflow-hidden ${isPanning ? "cursor-grabbing" : "cursor-grab"}`}
      >
        <svg
          viewBox={`${-pad} ${-pad} ${vbW} ${vbH}`}
          className="h-full w-full"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "center center",
            transition: isPanning ? "none" : "transform 120ms cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          <defs>
            <pattern
              id="cadMinorGrid"
              width={majorGridStep / 5}
              height={majorGridStep / 5}
              patternUnits="userSpaceOnUse"
            >
              <path
                d={`M ${majorGridStep / 5} 0 L 0 0 0 ${majorGridStep / 5}`}
                fill="none"
                stroke="#1e293b"
                strokeWidth={Math.max(0.4, vbW * 0.0006)}
                strokeOpacity="0.45"
              />
            </pattern>
            <pattern
              id="cadMajorGrid"
              width={majorGridStep}
              height={majorGridStep}
              patternUnits="userSpaceOnUse"
            >
              <rect width={majorGridStep} height={majorGridStep} fill="url(#cadMinorGrid)" />
              <path
                d={`M ${majorGridStep} 0 L 0 0 0 ${majorGridStep}`}
                fill="none"
                stroke="#334155"
                strokeWidth={Math.max(0.8, vbW * 0.001)}
                strokeOpacity="0.65"
              />
            </pattern>
          </defs>

          {/* Raw Material Sheet Background */}
          <rect
            x={0}
            y={0}
            width={st.sheetW}
            height={st.sheetH}
            fill={showGrid ? "url(#cadMajorGrid)" : "#0b1324"}
            stroke="#475569"
            strokeWidth={Math.max(1.2, vbW * 0.0018)}
          />

          {/* Margin Safe Zone Guide */}
          {st.margin > 0 && st.sheetW > st.margin * 2 && st.sheetH > st.margin * 2 && (
            <rect
              x={st.margin}
              y={st.margin}
              width={st.sheetW - st.margin * 2}
              height={st.sheetH - st.margin * 2}
              fill="none"
              stroke="#0ea5e9"
              strokeOpacity={0.35}
              strokeWidth={Math.max(0.8, vbW * 0.001)}
              strokeDasharray={`${vbW * 0.006},${vbW * 0.004}`}
            />
          )}

          {/* Top & Left Rulers */}
          {showGrid && (
            <g className="pointer-events-none">
              {Array.from(
                { length: Math.floor(st.sheetW / majorGridStep) + 1 },
                (_, i) => i * majorGridStep
              ).map((xVal) => (
                <g key={`rx_${xVal}`}>
                  <line
                    x1={xVal}
                    y1={-pad * 0.25}
                    x2={xVal}
                    y2={0}
                    stroke="#64748b"
                    strokeWidth={vbW * 0.001}
                  />
                  <text
                    x={xVal}
                    y={-pad * 0.35}
                    fill="#94a3b8"
                    fontSize={Math.max(9, vbW * 0.012)}
                    textAnchor="middle"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {fmtU(xVal)}
                  </text>
                </g>
              ))}
              {Array.from(
                { length: Math.floor(st.sheetH / majorGridStep) + 1 },
                (_, i) => i * majorGridStep
              ).map((yVal) => (
                <g key={`ry_${yVal}`}>
                  <line
                    x1={-pad * 0.25}
                    y1={yVal}
                    x2={0}
                    y2={yVal}
                    stroke="#64748b"
                    strokeWidth={vbW * 0.001}
                  />
                  <text
                    x={-pad * 0.35}
                    y={yVal}
                    fill="#94a3b8"
                    fontSize={Math.max(9, vbW * 0.012)}
                    textAnchor="end"
                    dominantBaseline="central"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {fmtU(yVal)}
                  </text>
                </g>
              ))}
              {/* Sheet Overall Dimension Labels */}
              <text
                x={st.sheetW / 2}
                y={st.sheetH + pad * 0.55}
                fill="#cbd5e1"
                fontSize={Math.max(11, vbW * 0.0135)}
                fontWeight="bold"
                textAnchor="middle"
                fontFamily="JetBrains Mono, monospace"
              >
                {fmtU(st.sheetW)} × {fmtU(st.sheetH)} {unitLabel}
              </text>
            </g>
          )}

          {/* Used Area & Remnant Offcut Indicator */}
          {showRemnantBox && usedBounds && (
            <g className="pointer-events-none">
              <rect
                x={0}
                y={0}
                width={usedBounds.maxX}
                height={usedBounds.maxY}
                fill="#10b981"
                fillOpacity={0.03}
                stroke="#10b981"
                strokeOpacity={0.5}
                strokeWidth={Math.max(1, vbW * 0.0012)}
                strokeDasharray={`${vbW * 0.008},${vbW * 0.005}`}
              />
              {usedBounds.remnantW > st.sheetW * 0.08 && (
                <g>
                  <line
                    x1={usedBounds.maxX}
                    y1={st.sheetH * 0.5}
                    x2={st.sheetW}
                    y2={st.sheetH * 0.5}
                    stroke="#38bdf8"
                    strokeWidth={Math.max(1, vbW * 0.0012)}
                    strokeDasharray={`${vbW * 0.005},${vbW * 0.005}`}
                  />
                  <text
                    x={(usedBounds.maxX + st.sheetW) / 2}
                    y={st.sheetH * 0.5 - pad * 0.25}
                    fill="#38bdf8"
                    fontSize={Math.max(11, vbW * 0.013)}
                    fontWeight="bold"
                    textAnchor="middle"
                    fontFamily="Cairo, JetBrains Mono, sans-serif"
                  >
                    فضلة: {fmtU(usedBounds.remnantW)} {unitLabel}
                  </text>
                </g>
              )}
            </g>
          )}

          {/* Placed Nested Parts */}
          <g>
            {transformedItems.map((it) => {
              const isSelected = it.placement.id === selectedPlacementId;
              const isHovered = it.placement.id === hoveredPlacementId;
              const strokeW = hairlineMode
                ? Math.max(0.8, vbW * 0.0012)
                : showOutline
                  ? Math.max(1, vbW * 0.0014)
                  : 0.3;

              return (
                <g
                  key={it.placement.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedPlacementId(isSelected ? null : it.placement.id);
                  }}
                  onMouseEnter={() => setHoveredPlacementId(it.placement.id)}
                  onMouseLeave={() => setHoveredPlacementId(null)}
                  className="cursor-pointer transition-opacity"
                >
                  {hairlineMode ? (
                    <>
                      {/* CorelDRAW / Laser Hairline Preview: Inner Holes in Blue (#3b82f6), Outer Cut in Red (#ef4444) */}
                      {it.holesD.map((hd, hi) => (
                        <path
                          key={hi}
                          d={hd}
                          fill="none"
                          stroke="#3b82f6"
                          strokeWidth={strokeW}
                        />
                      ))}
                      <path
                        d={it.outerOnlyD}
                        fill={isSelected || isHovered ? "#ef444422" : "transparent"}
                        stroke={isSelected ? "#fbbf24" : "#ef4444"}
                        strokeWidth={isSelected ? strokeW * 1.8 : strokeW}
                      />
                    </>
                  ) : (
                    <path
                      d={it.outerD}
                      fill={it.shape.color}
                      fillOpacity={isSelected ? 0.88 : isHovered ? 0.75 : 0.58}
                      fillRule="evenodd"
                      stroke={isSelected ? "#ffffff" : showOutline ? "#e2e8f0" : it.shape.color}
                      strokeWidth={isSelected ? strokeW * 1.8 : strokeW}
                    />
                  )}

                  {/* Selection Bounding Frame */}
                  {isSelected && (
                    <rect
                      x={it.bbox.minX}
                      y={it.bbox.minY}
                      width={it.bbox.w}
                      height={it.bbox.h}
                      fill="none"
                      stroke="#fbbf24"
                      strokeWidth={Math.max(1, vbW * 0.0014)}
                      strokeDasharray={`${vbW * 0.004},${vbW * 0.003}`}
                    />
                  )}
                </g>
              );
            })}
          </g>

          {/* Laser / CNC Rapid Path & Cut Sequence Numbers */}
          {showCutPath && transformedItems.length > 0 && (
            <g className="pointer-events-none">
              <polyline
                points={[
                  "0,0",
                  ...transformedItems.map((it) => `${it.cx.toFixed(1)},${it.cy.toFixed(1)}`),
                ].join(" ")}
                fill="none"
                stroke="#fbbf24"
                strokeWidth={Math.max(1, vbW * 0.0013)}
                strokeDasharray={`${vbW * 0.005},${vbW * 0.004}`}
                strokeOpacity={0.85}
              />
              {transformedItems.map((it) => {
                const r = Math.max(6, vbW * 0.009);
                return (
                  <g key={`ord_${it.placement.id}`}>
                    <circle
                      cx={it.cx}
                      cy={it.cy}
                      r={r}
                      fill="#0f172a"
                      stroke="#fbbf24"
                      strokeWidth={Math.max(0.8, vbW * 0.001)}
                    />
                    <text
                      x={it.cx}
                      y={it.cy}
                      fill="#fde68a"
                      fontSize={r * 1.15}
                      fontWeight="bold"
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {it.orderNum}
                    </text>
                  </g>
                );
              })}
            </g>
          )}
        </svg>

        {/* Empty State Overlay when no snapshot yet */}
        {!snap && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-[#050912]/60 backdrop-blur-[1px] p-6 text-center">
            <div className="max-w-md rounded-2xl border border-slate-800/90 bg-[#0a1222]/95 p-5 shadow-2xl">
              <Crosshair className="mx-auto mb-2.5 h-8 w-8 text-emerald-400" />
              <h4 className="text-sm font-bold text-white">
                مساحة عمل اللوح الخام جاهزة ({fmtU(st.sheetW)} × {fmtU(st.sheetH)} {unitLabel})
              </h4>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                اضغط على زر <strong className="text-emerald-400">«ابدأ التعشيق الذكي»</strong> بالأعلى لتشغيل محرك التعشيق النقطي عالي الكثافة مع حساب تعشيق الفتحات الداخلية ومسارات الليزر.
              </p>
            </div>
          </div>
        )}

        {/* Interactive Selected Part Inspector Bar */}
        {selectedItem && (
          <div
            onMouseDown={(e) => e.stopPropagation()}
            className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700/90 bg-[#0b1324]/95 px-3.5 py-2 text-xs shadow-xl backdrop-blur-md"
          >
            <div className="flex flex-wrap items-center gap-3">
              <span
                className="inline-block h-3 w-3 rounded-sm"
                style={{ backgroundColor: selectedItem.shape.color }}
              />
              <span className="font-bold text-white">{selectedItem.shape.name}</span>
              <span className="text-slate-400 font-mono tabular-nums" dir="ltr">
                X: {fmtU(selectedItem.placement.x)} {unitLabel} · Y: {fmtU(selectedItem.placement.y)} {unitLabel} · ∠ {selectedItem.placement.angle}° · #{selectedItem.orderNum}
              </span>
            </div>
            {onUpdatePlacement && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    onUpdatePlacement(selectedItem.placement.id, {
                      angle: (selectedItem.placement.angle + 15) % 360,
                    })
                  }
                  className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-200 hover:border-emerald-500/50 hover:text-emerald-300"
                >
                  <RotateCw className="h-3 w-3" />
                  <span>تدوير +15°</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onUpdatePlacement(selectedItem.placement.id, {
                      x: Math.max(st.margin, selectedItem.placement.x - 2),
                    })
                  }
                  className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700"
                >
                  <Move className="h-3 w-3" />
                  <span>إزاحة يمين/يسار</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedPlacementId(null)}
                  className="rounded-md bg-slate-800 px-2 py-1 text-[11px] text-slate-400 hover:text-white"
                >
                  إغلاق
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
