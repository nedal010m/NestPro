import React, { useState } from "react";
import { Calculator, Printer, X } from "lucide-react";
import { polygonToPathD, shapeArea, shapePerimeter, transformShapeToSheet } from "../lib/geometry";
import type { NestSettings, NestSnapshot, Shape } from "../lib/types";

interface ProductionReportModalProps {
  onClose: () => void;
  projectName: string;
  shapes: Shape[];
  snap: NestSnapshot;
  st: NestSettings;
}

export default function ProductionReportModal({
  onClose,
  projectName,
  shapes,
  snap,
  st,
}: ProductionReportModalProps) {
  const [machineMinuteRate, setMachineMinuteRate] = useState(5);
  const [setupFee, setSetupFee] = useState(50);

  const shapeById = new Map(shapes.map((s) => [s.id, s]));

  // Aggregate totals across all sheets
  let totalAreaMm2 = 0;
  let totalCutLenMm = 0;
  const placedByShapeId = new Map<string, number>();

  for (const p of snap.placements) {
    const sh = shapeById.get(p.shapeId);
    if (!sh) continue;
    totalAreaMm2 += shapeArea(sh, st.holes);
    totalCutLenMm += shapePerimeter(sh);
    placedByShapeId.set(sh.id, (placedByShapeId.get(sh.id) || 0) + 1);
  }

  const totalSheetAreaMm2 = Math.max(1, snap.sheets * st.sheetW * st.sheetH);
  const overallEff = (totalAreaMm2 / totalSheetAreaMm2) * 100;
  const totalCutMinutes = st.cutSpeed > 0 ? totalCutLenMm / st.cutSpeed / 60 : 0;
  const totalMaterialCost = snap.sheets * st.sheetCost;
  const totalMachineCost = totalCutMinutes * machineMinuteRate;
  const grandTotalQuote = totalMaterialCost + totalMachineCost + setupFee;
  const unitAvgCost = snap.placements.length > 0 ? grandTotalQuote / snap.placements.length : 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-[#0a1120] text-slate-100 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5 print:hidden">
          <div className="flex items-center gap-2.5">
            <Calculator className="h-5 w-5 text-emerald-400" />
            <div>
              <h2 id="report-modal-title" className="text-base font-extrabold text-white">
                تقرير التشغيل، المقايسة، وحاسبة تكلفة الورشة
              </h2>
              <p className="text-xs text-slate-400">
                حساب تكلفة الخامات وتشغيل ماكينة الليزر/الراوتر وبيان القطع التفصيلي
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 py-1.5 text-xs font-extrabold text-slate-950 hover:bg-emerald-400"
            >
              <Printer className="h-4 w-4" />
              <span>طباعة التقرير / PDF</span>
            </button>
            <button
              type="button"
              aria-label="إغلاق التقرير"
              onClick={onClose}
              className="rounded-lg border border-slate-700 bg-slate-800 p-1.5 text-slate-400 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Report Content */}
        <div className="flex-1 space-y-4 overflow-y-auto p-5 text-xs">
          {/* Pricing Inputs */}
          <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-800 bg-[#070c18] p-3.5 sm:grid-cols-3 print:hidden">
            <div>
              <span className="mb-1 block text-slate-400">تكلفة دقيقة الليزر / CNC</span>
              <input
                type="number"
                min={0}
                step={0.5}
                value={machineMinuteRate}
                onChange={(e) => setMachineMinuteRate(Math.max(0, parseFloat(e.target.value) || 0))}
                className="w-full rounded-lg border border-slate-700 bg-[#060a12] px-3 py-1.5 font-mono text-white outline-none focus:border-emerald-400"
                dir="ltr"
              />
            </div>
            <div>
              <span className="mb-1 block text-slate-400">رسوم تجهيز وتشغيل (Setup)</span>
              <input
                type="number"
                min={0}
                step={5}
                value={setupFee}
                onChange={(e) => setSetupFee(Math.max(0, parseFloat(e.target.value) || 0))}
                className="w-full rounded-lg border border-slate-700 bg-[#060a12] px-3 py-1.5 font-mono text-white outline-none focus:border-emerald-400"
                dir="ltr"
              />
            </div>
            <div className="flex flex-col justify-center rounded-lg border border-emerald-500/30 bg-emerald-950/20 px-3 py-2">
              <span className="text-[11px] text-emerald-300">إجمالي تسعير الطلبية المقترح</span>
              <span className="font-mono text-lg font-extrabold text-emerald-400 tabular-nums" dir="ltr">
                {grandTotalQuote.toFixed(1)} (متوسط القطعة: {unitAvgCost.toFixed(2)})
              </span>
            </div>
          </div>

          {/* Summary KPI Grid */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-800 bg-[#070c18] p-3">
              <div className="text-slate-400">المشروع ومقاس اللوح</div>
              <div className="mt-1 font-bold text-white">{projectName}</div>
              <div className="font-mono text-[11px] text-emerald-400" dir="ltr">
                {st.sheetW} × {st.sheetH} mm ({snap.sheets} لوح)
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#070c18] p-3">
              <div className="text-slate-400">كفاءة الاستغلال والهدر</div>
              <div className="mt-1 font-mono text-base font-extrabold text-emerald-400 tabular-nums" dir="ltr">
                {overallEff.toFixed(1)}% استغلال
              </div>
              <div className="font-mono text-[11px] text-rose-400" dir="ltr">
                {(100 - overallEff).toFixed(1)}% هدر / فضلة
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#070c18] p-3">
              <div className="text-slate-400">إجمالي طول وزمن القص</div>
              <div className="mt-1 font-mono text-base font-extrabold text-cyan-300 tabular-nums" dir="ltr">
                {(totalCutLenMm / 1000).toFixed(2)} m
              </div>
              <div className="font-mono text-[11px] text-slate-400" dir="ltr">
                {totalCutMinutes.toFixed(1)} دقيقة ({st.cutSpeed} mm/s)
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-[#070c18] p-3">
              <div className="text-slate-400">تفصيل التكلفة</div>
              <div className="mt-1 font-mono text-sm font-bold text-amber-300 tabular-nums">
                خامات: {totalMaterialCost.toFixed(0)} · تشغيل: {totalMachineCost.toFixed(0)}
              </div>
              <div className="font-mono text-[11px] text-slate-400">
                الإجمالي شامل التجهيز: {grandTotalQuote.toFixed(1)}
              </div>
            </div>
          </div>

          {/* Visual Sheet Layout Preview */}
          <div className="rounded-xl border border-slate-800 bg-[#060a12] p-3">
            <h3 className="mb-2 font-bold text-slate-200">مخطط رص الألواح (Sheet Layout)</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: snap.sheets }, (_, sIdx) => {
                const pls = snap.placements.filter((p) => p.sheet === sIdx);
                return (
                  <div key={sIdx} className="rounded-lg border border-slate-800 bg-[#09101d] p-2">
                    <div className="mb-1 flex justify-between text-[11px] text-slate-400 font-mono">
                      <span>لوح #{sIdx + 1}</span>
                      <span dir="ltr">
                        {st.sheetW}×{st.sheetH} mm ({pls.length} قطعة)
                      </span>
                    </div>
                    <svg
                      viewBox={`0 0 ${st.sheetW} ${st.sheetH}`}
                      className="h-36 w-full rounded border border-slate-700 bg-[#050912]"
                    >
                      {pls.map((p) => {
                        const sh = shapeById.get(p.shapeId);
                        if (!sh) return null;
                        const tr = transformShapeToSheet(sh, p.x, p.y, p.angle);
                        return (
                          <path
                            key={p.id}
                            d={polygonToPathD(tr.outer, tr.holes)}
                            fill={sh.color}
                            fillOpacity={0.65}
                            fillRule="evenodd"
                            stroke="#ffffff"
                            strokeWidth={Math.max(1, st.sheetW * 0.0015)}
                          />
                        );
                      })}
                    </svg>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Parts Manifest Table */}
          <div className="overflow-hidden rounded-xl border border-slate-800 bg-[#070c18]">
            <table className="w-full text-right text-xs">
              <thead className="border-b border-slate-800 bg-[#0b1324] text-slate-300">
                <tr>
                  <th className="px-3 py-2">القطعة</th>
                  <th className="px-3 py-2">الأبعاد (مم)</th>
                  <th className="px-3 py-2">المساحة الصافية</th>
                  <th className="px-3 py-2">الكمية المطلوبة</th>
                  <th className="px-3 py-2">الكمية المعشّقة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 font-mono tabular-nums">
                {shapes
                  .filter((s) => s.enabled)
                  .map((s) => {
                    const placed = placedByShapeId.get(s.id) || 0;
                    return (
                      <tr key={s.id} className="hover:bg-slate-900/50">
                        <td className="px-3 py-2 font-sans font-bold text-white">{s.name}</td>
                        <td className="px-3 py-2 text-slate-300" dir="ltr">
                          {s.w.toFixed(1)} × {s.h.toFixed(1)} mm
                        </td>
                        <td className="px-3 py-2 text-slate-300">
                          {(shapeArea(s, true) / 100).toFixed(1)} سم²
                        </td>
                        <td className="px-3 py-2 text-slate-300">{s.qty}</td>
                        <td className="px-3 py-2 font-bold text-emerald-400">{placed}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
