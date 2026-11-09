import React from "react";
import { Lock, SplitSquareVertical, Trash2, Unlock } from "lucide-react";
import { polygonToPathD, shapeArea } from "../lib/geometry";
import type { Shape } from "../lib/types";

interface PartsListProps {
  shapes: Shape[];
  unitFactor: number;
  unitLabel: string;
  allowHoles?: boolean;
  onChange: (id: string, patch: Partial<Shape>) => void;
  onRemove: (id: string) => void;
  onExtractHolesAsParts?: (id: string) => void;
}

export default function PartsList({
  shapes,
  unitFactor,
  unitLabel,
  allowHoles = true,
  onChange,
  onRemove,
  onExtractHolesAsParts,
}: PartsListProps) {
  if (shapes.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-700/80 bg-slate-900/40 p-4 text-center">
        <p className="text-xs font-medium text-slate-400">
          لا توجد قطع مضافة حالياً
        </p>
        <p className="mt-1 text-[11px] text-slate-500">
          استورد من CorelDRAW أو Illustrator أو SVG / DXF أو اضغط «نماذج تجريبية» للبدء الفوري.
        </p>
      </div>
    );
  }

  const fmtDim = (mm: number) => (mm / unitFactor).toFixed(unitFactor === 1 ? 0 : 1);

  return (
    <div className="max-h-[310px] space-y-2 overflow-y-auto pl-1">
      {shapes.map((s) => {
        const effectiveHoles = allowHoles ? s.holes : [];
        const pathD = polygonToPathD(s.points, effectiveHoles);
        const pad = Math.max(s.w, s.h) * 0.08 + 1;
        const areaCm2 = (shapeArea(s, allowHoles) / 100).toFixed(1);

        return (
          <div
            key={s.id}
            className={`group rounded-lg border p-2 transition-colors ${
              s.enabled
                ? "border-slate-700/80 bg-slate-900/70 hover:border-slate-600"
                : "border-slate-800/60 bg-slate-950/40 opacity-55"
            }`}
          >
            <div className="flex items-center gap-2.5">
              {/* Enable Checkbox */}
              <input
                type="checkbox"
                aria-label={`تفعيل ${s.name}`}
                checked={s.enabled}
                onChange={(e) => onChange(s.id, { enabled: e.target.checked })}
                className="h-4 w-4 cursor-pointer accent-emerald-500 shrink-0"
              />

              {/* Mini CAD Vector Thumbnail */}
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-800 bg-[#060a12] p-1">
                <svg
                  viewBox={`${-pad} ${-pad} ${s.w + pad * 2} ${s.h + pad * 2}`}
                  className="h-full w-full"
                >
                  <path
                    d={pathD}
                    fill={s.color}
                    fillOpacity={0.72}
                    fillRule="evenodd"
                    stroke={s.color}
                    strokeWidth={Math.max(0.8, Math.max(s.w, s.h) * 0.04)}
                  />
                </svg>
              </div>

              {/* Part Name & Metadata */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <input
                    type="text"
                    value={s.name}
                    aria-label="اسم القطعة"
                    onChange={(e) => onChange(s.id, { name: e.target.value })}
                    className="w-full truncate bg-transparent text-xs font-bold text-slate-100 outline-none focus:border-b focus:border-emerald-400"
                  />
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-400 font-mono tabular-nums">
                  <span dir="ltr">
                    {fmtDim(s.w)}×{fmtDim(s.h)} {unitLabel}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{areaCm2} سم²</span>
                  {s.holes.length > 0 ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-emerald-400">
                        {allowHoles ? `${s.holes.length} فتحة` : `${s.holes.length} فتحة (مصمت)`}
                      </span>
                    </>
                  ) : (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-slate-400">مصمت</span>
                    </>
                  )}
                </div>
              </div>

              {/* Quantity Stepper */}
              <div className="flex items-center rounded-md border border-slate-700 bg-slate-950" dir="ltr">
                <button
                  type="button"
                  aria-label={`تقليل كمية ${s.name}`}
                  onClick={() => onChange(s.id, { qty: Math.max(0, s.qty - 1) })}
                  className="px-1.5 py-1 text-xs font-bold text-slate-400 hover:bg-slate-800 hover:text-white"
                >
                  -
                </button>
                <input
                  type="number"
                  min={0}
                  max={9999}
                  aria-label={`كمية ${s.name}`}
                  value={s.qty}
                  onChange={(e) =>
                    onChange(s.id, { qty: Math.max(0, parseInt(e.target.value, 10) || 0) })
                  }
                  className="w-10 bg-transparent text-center font-mono text-xs font-bold text-white outline-none tabular-nums"
                />
                <button
                  type="button"
                  aria-label={`زيادة كمية ${s.name}`}
                  onClick={() => onChange(s.id, { qty: s.qty + 1 })}
                  className="px-1.5 py-1 text-xs font-bold text-slate-400 hover:bg-slate-800 hover:text-white"
                >
                  +
                </button>
              </div>

              {/* Delete Part */}
              <button
                type="button"
                aria-label={`حذف ${s.name}`}
                onClick={() => onRemove(s.id)}
                className="rounded p-1 text-slate-500 hover:bg-rose-950/60 hover:text-rose-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Bottom Controls: Rotation Lock, Filler Mode & Hole Solid/Split Actions */}
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1.5 border-t border-slate-800/80 pt-1.5 text-[11px] text-slate-400">
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => onChange(s.id, { lockRotation: !s.lockRotation })}
                  className={`flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors ${
                    s.lockRotation
                      ? "bg-amber-500/15 text-amber-300"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {s.lockRotation ? (
                    <Lock className="h-3 w-3" />
                  ) : (
                    <Unlock className="h-3 w-3" />
                  )}
                  <span>{s.lockRotation ? "ثابت الزاوية (0°)" : "دوران مسموح"}</span>
                </button>

                <label className="flex cursor-pointer items-center gap-1 hover:text-slate-200">
                  <input
                    type="checkbox"
                    checked={s.fill}
                    onChange={(e) => onChange(s.id, { fill: e.target.checked })}
                    className="h-3 w-3 accent-cyan-400"
                  />
                  <span>ملء فراغات اللوح</span>
                </label>

                {s.holes.length > 0 && (
                  <>
                    <button
                      type="button"
                      title="إلغاء التفريغ وتحويل الشكل إلى قطعة مصمتة بالكامل"
                      onClick={() => onChange(s.id, { holes: [] })}
                      className="rounded border border-slate-700 bg-slate-800/90 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300 hover:border-amber-500/50 hover:bg-slate-800"
                    >
                      إلغاء التفريغ (مصمت)
                    </button>
                    {onExtractHolesAsParts && (
                      <button
                        type="button"
                        title="فصل المسارات الداخلية كقطع مستقلة بذاتها"
                        onClick={() => onExtractHolesAsParts(s.id)}
                        className="flex items-center gap-0.5 rounded border border-slate-700 bg-slate-800/90 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-300 hover:border-cyan-500/50 hover:bg-slate-800"
                      >
                        <SplitSquareVertical className="h-2.5 w-2.5" />
                        <span>فصل كقطع</span>
                      </button>
                    )}
                  </>
                )}
              </div>

              <span className="text-[10px] text-slate-500 uppercase font-mono">
                {s.source === "corel"
                  ? "COREL"
                  : s.source === "ai"
                    ? "AI"
                    : s.source.toUpperCase()}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
