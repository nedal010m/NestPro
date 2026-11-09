import React, { useState } from "react";
import { Plus, Shapes, X } from "lucide-react";
import { normalizeShapeGeometry } from "../lib/geometry";
import type { Polygon, Shape } from "../lib/types";

interface ParametricShapeModalProps {
  onClose: () => void;
  onAddShape: (sh: Shape) => void;
}

type Kind = "rect-plate" | "ring" | "polygon";

export default function ParametricShapeModal({
  onClose,
  onAddShape,
}: ParametricShapeModalProps) {
  const [kind, setKind] = useState<Kind>("rect-plate");
  const [name, setName] = useState("فلانشة مستطيلة بفتحات");
  const [qty, setQty] = useState(4);
  const [w, setW] = useState(200);
  const [h, setH] = useState(120);
  const [holeDia, setHoleDia] = useState(60);
  const [cornerHoles, setCornerHoles] = useState(true);
  const [cornerHoleDia, setCornerHoleDia] = useState(8);
  const [sides, setSides] = useState(6);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    let outer: Polygon = [];
    const holes: Polygon[] = [];

    const makeCircle = (cx: number, cy: number, r: number, steps = 32): Polygon => {
      const pts: Polygon = [];
      for (let i = 0; i < steps; i++) {
        const a = (i * 2 * Math.PI) / steps;
        pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
      }
      return pts;
    };

    if (kind === "rect-plate") {
      const rw = Math.max(5, w);
      const rh = Math.max(5, h);
      outer = [
        { x: 0, y: 0 },
        { x: rw, y: 0 },
        { x: rw, y: rh },
        { x: 0, y: rh },
      ];
      if (holeDia > 0 && holeDia < Math.min(rw, rh) - 4) {
        holes.push(makeCircle(rw / 2, rh / 2, holeDia / 2, 32));
      }
      if (cornerHoles && cornerHoleDia > 0) {
        const cr = cornerHoleDia / 2;
        const inset = Math.max(cr + 4, Math.min(rw, rh) * 0.12);
        if (rw > inset * 2.5 && rh > inset * 2.5) {
          holes.push(makeCircle(inset, inset, cr, 16));
          holes.push(makeCircle(rw - inset, inset, cr, 16));
          holes.push(makeCircle(rw - inset, rh - inset, cr, 16));
          holes.push(makeCircle(inset, rh - inset, cr, 16));
        }
      }
    } else if (kind === "ring") {
      const rOut = Math.max(5, w / 2);
      outer = makeCircle(rOut, rOut, rOut, 40);
      if (holeDia > 0 && holeDia < w - 2) {
        holes.push(makeCircle(rOut, rOut, holeDia / 2, 32));
      }
    } else {
      const rOut = Math.max(5, w / 2);
      const nSides = Math.max(3, Math.min(24, sides));
      outer = [];
      for (let i = 0; i < nSides; i++) {
        const a = (i * 2 * Math.PI) / nSides - Math.PI / 2;
        outer.push({ x: rOut + rOut * Math.cos(a), y: rOut + rOut * Math.sin(a) });
      }
      if (holeDia > 0 && holeDia < w * 0.8) {
        holes.push(makeCircle(rOut, rOut, holeDia / 2, 28));
      }
    }

    const norm = normalizeShapeGeometry(outer, holes);
    onAddShape({
      id: `param_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim() || "قطعة قياسية",
      points: norm.points,
      holes: norm.holes,
      qty: Math.max(1, qty),
      fill: false,
      enabled: true,
      color: "#10b981",
      source: "svg",
      w: norm.w,
      h: norm.h,
    });
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="parametric-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-700 bg-[#0a1120] text-slate-100 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <Shapes className="h-5 w-5 text-emerald-400" />
            <h2 id="parametric-modal-title" className="text-sm font-extrabold text-white">
              مولد القطع الهندسية السريع (بالمليمتر)
            </h2>
          </div>
          <button
            type="button"
            aria-label="إغلاق نافذة إضافة شكل"
            onClick={onClose}
            className="rounded-lg border border-slate-700 bg-slate-800/80 p-1 text-slate-400 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleCreate} className="space-y-3.5 p-5 text-xs">
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: "rect-plate", label: "لوحة / فلانشة مستطيلة", defName: "فلانشة مستطيلة بفتحات" },
              { id: "ring", label: "حلقة / قرص دائري", defName: "حلقة دائرية مفرغة" },
              { id: "polygon", label: "مضلع / صامولة سداسية", defName: "فلانشة سداسية" },
            ].map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => {
                  setKind(item.id as Kind);
                  setName(item.defName);
                }}
                className={`rounded-lg border py-2 px-2 font-bold transition-colors ${
                  kind === item.id
                    ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                    : "border-slate-800 bg-slate-900 text-slate-400 hover:text-white"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-slate-400">اسم القطعة</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-[#060a12] px-3 py-1.5 text-white outline-none focus:border-emerald-400"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-slate-400">الكمية المطلوبة</span>
              <input
                type="number"
                min={1}
                max={5000}
                value={qty}
                onChange={(e) => setQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-full rounded-lg border border-slate-700 bg-[#060a12] px-3 py-1.5 font-mono text-white outline-none focus:border-emerald-400"
                dir="ltr"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-slate-400">
                {kind === "rect-plate" ? "العرض (مم)" : "القطر الخارجي (مم)"}
              </span>
              <input
                type="number"
                min={5}
                max={10000}
                value={w}
                onChange={(e) => setW(Math.max(5, parseFloat(e.target.value) || 10))}
                className="w-full rounded-lg border border-slate-700 bg-[#060a12] px-3 py-1.5 font-mono text-white outline-none focus:border-emerald-400"
                dir="ltr"
              />
            </label>

            {kind === "rect-plate" ? (
              <label className="block">
                <span className="mb-1 block text-slate-400">الارتفاع (مم)</span>
                <input
                  type="number"
                  min={5}
                  max={10000}
                  value={h}
                  onChange={(e) => setH(Math.max(5, parseFloat(e.target.value) || 10))}
                  className="w-full rounded-lg border border-slate-700 bg-[#060a12] px-3 py-1.5 font-mono text-white outline-none focus:border-emerald-400"
                  dir="ltr"
                />
              </label>
            ) : kind === "polygon" ? (
              <label className="block">
                <span className="mb-1 block text-slate-400">عدد الأضلاع</span>
                <input
                  type="number"
                  min={3}
                  max={24}
                  value={sides}
                  onChange={(e) => setSides(Math.max(3, parseInt(e.target.value, 10) || 6))}
                  className="w-full rounded-lg border border-slate-700 bg-[#060a12] px-3 py-1.5 font-mono text-white outline-none focus:border-emerald-400"
                  dir="ltr"
                />
              </label>
            ) : null}

            <label className="block">
              <span className="mb-1 block text-slate-400">
                قطر الفتحة الوسطى (مم) — 0 لبدون فتحة
              </span>
              <input
                type="number"
                min={0}
                max={9000}
                value={holeDia}
                onChange={(e) => setHoleDia(Math.max(0, parseFloat(e.target.value) || 0))}
                className="w-full rounded-lg border border-slate-700 bg-[#060a12] px-3 py-1.5 font-mono text-white outline-none focus:border-emerald-400"
                dir="ltr"
              />
            </label>

            {kind === "rect-plate" && (
              <label className="block">
                <span className="mb-1 block text-slate-400">قطر ثقوب التثبيت بالأركان (مم)</span>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={cornerHoles}
                    onChange={(e) => setCornerHoles(e.target.checked)}
                    className="h-4 w-4 accent-emerald-400"
                  />
                  <input
                    type="number"
                    min={0}
                    max={500}
                    disabled={!cornerHoles}
                    value={cornerHoleDia}
                    onChange={(e) =>
                      setCornerHoleDia(Math.max(0, parseFloat(e.target.value) || 0))
                    }
                    className="w-full rounded-lg border border-slate-700 bg-[#060a12] px-3 py-1.5 font-mono text-white outline-none disabled:opacity-40"
                    dir="ltr"
                  />
                </div>
              </label>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-slate-800 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-slate-800 px-4 py-2 font-semibold text-slate-300 hover:bg-slate-700"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 font-extrabold text-slate-950 hover:bg-emerald-400"
            >
              <Plus className="h-4 w-4" />
              <span>إضافة القطعة للقائمة</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
