import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BookmarkPlus,
  Calculator,
  Cloud,
  CloudUpload,
  Download,
  FileUp,
  FolderUp,
  Layers,
  Play,
  Plus,
  RotateCcw,
  Settings2,
  Shapes,
  Sliders,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import type { User } from "firebase/auth";
import NestWorker from "./lib/nest.worker?worker&inline";
import type { NestSettings, NestSnapshot, Placement, Shape, WorkerOut } from "./lib/types";
import {
  normalizeShapeGeometry,
  pointInPolygon,
  polygonArea,
  shapeArea,
  shapePerimeter,
  transformShapeToSheet,
} from "./lib/geometry";
import {
  demoShapes,
  type SvgGrouping,
  type SvgUnit,
} from "./lib/importers";
import { importUniversalCadFile } from "./lib/directCadParser";
import { buildCorelApplyMacro, buildCorelOneClickVBS } from "./lib/corel";
import { buildApplyScript } from "./lib/jsx";
import {
  allSheetsToSVG,
  download,
  sheetToDXF,
  sheetToHPGL,
  sheetToSVG,
} from "./lib/exporters";
import { runNestingSync } from "./lib/nestingEngine";
import {
  BUILT_IN_SHEET_PRESETS,
  type CloudProjectRecord,
  type SheetPresetRecord,
  deleteCustomSheetPreset,
  deleteProjectFromCloud,
  loadLocalCustomPresets,
  loadLocalProjects,
  saveCustomSheetPreset,
  saveProjectToCloud,
  signInWithGooglePopup,
  signOutUser,
  subscribeToAuth,
  subscribeUserPresets,
  subscribeUserProjects,
} from "./lib/firebase";
import Preview from "./components/Preview";
import PartsList from "./components/PartsList";
import IntegrationGuideModal from "./components/IntegrationGuideModal";
import CloudProjectsModal from "./components/CloudProjectsModal";
import ParametricShapeModal from "./components/ParametricShapeModal";
import ProductionReportModal from "./components/ProductionReportModal";

type Unit = "mm" | "cm" | "in";
const UNIT_F: Record<Unit, number> = { mm: 1, cm: 10, in: 25.4 };

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

function NumField({
  label,
  mm,
  f,
  onChange,
  suffix,
  hint,
}: {
  label: string;
  mm: number;
  f: number;
  onChange: (mm: number) => void;
  suffix: string;
  hint?: string;
}) {
  const [txt, setTxt] = useState(fmt(mm / f));
  useEffect(() => {
    const p = parseFloat(txt);
    if (isNaN(p) || Math.abs(p * f - mm) > 1e-6) setTxt(fmt(mm / f));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mm, f]);
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-slate-400">{label}</span>
      <div className="flex items-center overflow-hidden rounded-lg border border-slate-700/90 bg-[#060b14] focus-within:border-emerald-400">
        <input
          inputMode="decimal"
          value={txt}
          onChange={(e) => {
            setTxt(e.target.value);
            const v = parseFloat(e.target.value.replace(",", "."));
            if (!isNaN(v) && v >= 0) onChange(v * f);
          }}
          className="w-full bg-transparent px-2.5 py-1.5 font-mono text-xs text-white outline-none tabular-nums"
          dir="ltr"
        />
        <span className="px-2 font-mono text-[10px] text-slate-500" dir="ltr">
          {suffix}
        </span>
      </div>
      {hint && <span className="mt-0.5 block text-[10px] text-slate-500">{hint}</span>}
    </label>
  );
}

function Card({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-800/90 bg-[#0b1221] p-3">
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-xs font-bold text-slate-100">
          <span className="text-emerald-400">{icon}</span>
          <span>{title}</span>
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Select<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { v: T; t: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-slate-400">{label}</span>
      <select
        value={String(value)}
        onChange={(e) => {
          const raw = e.target.value;
          const opt = options.find((o) => String(o.v) === raw);
          if (opt) onChange(opt.v);
        }}
        className="w-full rounded-lg border border-slate-700/90 bg-[#060b14] px-2 py-1.5 text-xs text-white outline-none focus:border-emerald-400"
      >
        {options.map((o) => (
          <option key={String(o.v)} value={String(o.v)}>
            {o.t}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function App() {
  const [shapes, setShapes] = useState<Shape[]>(() => demoShapes());
  const [unit, setUnit] = useState<Unit>("mm");
  const [st, setSt] = useState<NestSettings>({
    sheetW: 1000,
    sheetH: 1300,
    margin: 5,
    spacing: 1.5,
    kerf: 0.2,
    rotStep: 15,
    edgeAlign: true,
    holes: true,
    resolution: 600,
    timeBudget: 4,
    maxSheets: 2,
    strategy: "gravity-bl",
    sheetCost: 450,
    cutSpeed: 35,
    corelVersion: "2024-2026",
  });

  const [snap, setSnap] = useState<NestSnapshot | null>(null);
  const [sheet, setSheet] = useState(0);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ pct: 0, msg: "جاهز للتعشيق" });
  const [info, setInfo] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [guideTab, setGuideTab] = useState<"corel" | "illustrator" | null>(null);
  const [showCloudModal, setShowCloudModal] = useState(false);
  const [showParametricModal, setShowParametricModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);

  const [svgUnit, setSvgUnit] = useState<SvgUnit>("auto");
  const [svgGroup, setSvgGroup] = useState<SvgGrouping>("path");
  const [cleanTags, setCleanTags] = useState(true);
  const [outline, setOutline] = useState(true);

  // Cloud & Local Persistence State
  const [user, setUser] = useState<User | null>(null);
  const [projectName, setProjectName] = useState("طلبية تعشيق أكريليك وليزر #1");
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [cloudProjects, setCloudProjects] = useState<CloudProjectRecord[]>(() =>
    loadLocalProjects()
  );
  const [customPresets, setCustomPresets] = useState<SheetPresetRecord[]>(() =>
    loadLocalCustomPresets()
  );
  const [savingCloud, setSavingCloud] = useState(false);

  const workerRef = useRef<Worker | null>(null);
  const universalFileInput = useRef<HTMLInputElement>(null);
  const f = UNIT_F[unit];

  useEffect(() => () => workerRef.current?.terminate(), []);

  // Subscribe to Firebase Auth & Firestore collections
  useEffect(() => {
    let unsubProjects: (() => void) | null = null;
    let unsubPresets: (() => void) | null = null;

    const unsubAuth = subscribeToAuth((u) => {
      setUser(u);
      unsubProjects?.();
      unsubPresets?.();
      if (u) {
        unsubProjects = subscribeUserProjects(u.uid, (projs) => {
          setCloudProjects(projs);
        });
        unsubPresets = subscribeUserPresets(u.uid, (presets) => {
          setCustomPresets(presets);
        });
      } else {
        setCloudProjects(loadLocalProjects());
        setCustomPresets(loadLocalCustomPresets());
      }
    });

    return () => {
      unsubAuth();
      unsubProjects?.();
      unsubPresets?.();
    };
  }, []);

  // Automatically re-run fast preview pass whenever shapes or settings change (while not running worker)
  useEffect(() => {
    if (running) return;
    const timer = setTimeout(() => {
      try {
        const active = shapes.filter((s) => s.enabled && (s.qty > 0 || s.fill));
        if (!active.length || st.sheetW <= 0 || st.sheetH <= 0) {
          setSnap(null);
          return;
        }
        const t0 = performance.now();
        const fastSnap = runNestingSync(shapes, {
          ...st,
          resolution: Math.min(st.resolution, 550),
          timeBudget: 0,
        });
        setSnap(fastSnap);
        setElapsed(performance.now() - t0);
        setProgress({
          pct: 100,
          msg: `معاينة جاهزة • ${fastSnap.placements.length} قطعة معشّقة`,
        });
      } catch {
        // Ignore if sync fails
      }
    }, 80);
    return () => clearTimeout(timer);
  }, [shapes, st, running]);

  const setS = <K extends keyof NestSettings>(k: K, v: NestSettings[K]) =>
    setSt((s) => ({ ...s, [k]: v }));

  const patchShape = (id: string, patch: Partial<Shape>) =>
    setShapes((arr) => arr.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const removeShape = (id: string) =>
    setShapes((arr) => arr.filter((s) => s.id !== id));

  const extractHolesAsParts = (shapeId: string) => {
    setShapes((arr) => {
      const next: Shape[] = [];
      const palette = ["#06b6d4", "#ec4899", "#f59e0b", "#8b5cf6", "#3b82f6", "#10b981"];
      for (const s of arr) {
        if (s.id !== shapeId || s.holes.length === 0) {
          next.push(s);
          continue;
        }
        next.push({ ...s, holes: [] });
        s.holes.forEach((hPoly, idx) => {
          const norm = normalizeShapeGeometry(hPoly, []);
          if (norm.w >= 0.5 && norm.h >= 0.5) {
            next.push({
              id: `${s.id}_hole_${idx + 1}_${Date.now().toString(36).slice(-3)}`,
              name: `${s.name} (قطعة داخلية #${idx + 1})`,
              points: norm.points,
              holes: [],
              qty: s.qty,
              fill: false,
              enabled: true,
              color: palette[idx % palette.length],
              source: s.source,
              origX: (s.origX || 0) + norm.origX,
              origY: (s.origY || 0) + norm.origY,
              w: norm.w,
              h: norm.h,
            });
          }
        });
      }
      return next;
    });
    flash("ok", "تم فصل المسارات الداخلية وتحويلها إلى قطع مستقلة مصمتة");
  };

  const updatePlacement = (placementId: string, patch: Partial<Placement>) => {
    setSnap((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        placements: prev.placements.map((p) =>
          p.id === placementId ? { ...p, ...patch } : p
        ),
      };
    });
  };

  const flash = (kind: "ok" | "err", text: string) => {
    setInfo({ kind, text });
    setTimeout(() => setInfo((i) => (i && i.text === text ? null : i)), 6500);
  };

  /**
   * Handle universal file import (.ai, .pdf, .cdr, .dxf, .svg, .eps, .json).
   */
  const handleUniversalFiles = async (files: FileList | File[] | null) => {
    if (!files || !files.length) return;
    let totalAdded = 0;
    const formatsUsed = new Set<string>();
    const newShapesBatch: Shape[] = [];

    for (const file of Array.from(files)) {
      try {
        const { shapes: imported, formatLabel } = await importUniversalCadFile(
          file,
          svgUnit,
          svgGroup
        );
        totalAdded += imported.length;
        formatsUsed.add(formatLabel);
        newShapesBatch.push(...imported);
      } catch (e) {
        flash("err", `${file.name}: ${(e as Error).message}`);
      }
    }

    if (newShapesBatch.length > 0) {
      setShapes((prev) => {
        const combined = [...prev, ...newShapesBatch];
        try {
          const fastSnap = runNestingSync(combined, {
            ...st,
            resolution: 450,
            timeBudget: 0,
          });
          setSnap(fastSnap);
        } catch {
          // Ignore
        }
        return combined;
      });
      flash(
        "ok",
        `تم استيراد ${totalAdded} قطعة بنجاح (${Array.from(formatsUsed).join(" + ")})`
      );
    }

    if (universalFileInput.current) universalFileInput.current.value = "";
  };

  const start = () => {
    const active = shapes.filter((s) => s.enabled && (s.qty > 0 || s.fill));
    if (!active.length)
      return flash("err", "أضف قطعة واحدة على الأقل بكمية أكبر من صفر");
    if (st.sheetW <= 0 || st.sheetH <= 0)
      return flash("err", "مقاس اللوح الخام غير صالح");

    workerRef.current?.terminate();
    try {
      const w = new NestWorker();
      workerRef.current = w;
      setRunning(true);
      setSheet(0);
      setProgress({ pct: 2, msg: "تجهيز الأقنعة النقطية عالية الدقة..." });

      w.onmessage = (e: MessageEvent<WorkerOut>) => {
        const m = e.data;
        if (m.type === "progress") setProgress({ pct: m.pct, msg: m.msg });
        else if (m.type === "best") {
          setSnap(m.snap);
          setElapsed(m.elapsed);
        } else if (m.type === "done") {
          setSnap(m.snap);
          setElapsed(m.elapsed);
          setRunning(false);
          setProgress({
            pct: 100,
            msg: `اكتمل التعشيق • ${m.trials} محاولة تحسين`,
          });
          w.terminate();
          workerRef.current = null;
        } else if (m.type === "error") {
          setRunning(false);
          flash("err", m.msg);
        }
      };

      w.onerror = () => {
        const t0 = performance.now();
        const fallbackSnap = runNestingSync(active, st);
        setSnap(fallbackSnap);
        setElapsed(performance.now() - t0);
        setRunning(false);
        setProgress({ pct: 100, msg: "اكتمل التعشيق" });
      };

      w.postMessage({ type: "start", shapes: active, settings: st });
    } catch {
      const t0 = performance.now();
      const fallbackSnap = runNestingSync(active, st);
      setSnap(fallbackSnap);
      setElapsed(performance.now() - t0);
      setRunning(false);
      setProgress({ pct: 100, msg: "اكتمل التعشيق" });
    }
  };

  const stop = () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setRunning(false);
    setProgress((p) => ({ ...p, msg: "تم الإيقاف (محفوظ أفضل نتيجة)" }));
  };

  const areaById = useMemo(
    () => new Map(shapes.map((s) => [s.id, shapeArea(s, st.holes)])),
    [shapes, st.holes]
  );

  const perimeterById = useMemo(
    () => new Map(shapes.map((s) => [s.id, shapePerimeter(s)])),
    [shapes]
  );

  const shapeById = useMemo(
    () => new Map(shapes.map((s) => [s.id, s])),
    [shapes]
  );

  const sheetStats = useMemo(() => {
    if (!snap) return [];
    const totalSheetArea = Math.max(1, st.sheetW * st.sheetH);
    return Array.from({ length: Math.max(1, snap.sheets) }, (_, i) => {
      let a = 0;
      let c = 0;
      let cutLen = 0;
      let maxX = 0;
      let maxY = 0;
      const sheetPlacements = snap.placements.filter((p) => p.sheet === i);

      // Collect transformed holes on this sheet to count how many small parts are nested inside holes
      const transformedHoles: { parentId: string; holePoly: { x: number; y: number }[] }[] = [];
      for (const p of sheetPlacements) {
        const sh = shapeById.get(p.shapeId);
        if (!sh) continue;
        a += areaById.get(p.shapeId) || 0;
        cutLen += perimeterById.get(p.shapeId) || 0;
        c++;
        const tr = transformShapeToSheet(sh, p.x, p.y, p.angle);
        if (tr.bbox.maxX > maxX) maxX = tr.bbox.maxX;
        if (tr.bbox.maxY > maxY) maxY = tr.bbox.maxY;
        if (tr.holes.length > 0) {
          for (const hPoly of tr.holes) {
            transformedHoles.push({ parentId: p.id, holePoly: hPoly });
          }
        }
      }

      let holeNestedCount = 0;
      let packedFootprintArea = 0;
      const partBBoxes: { minX: number; minY: number; maxX: number; maxY: number }[] = [];

      for (const p of sheetPlacements) {
        const sh = shapeById.get(p.shapeId);
        if (!sh) continue;
        const tr = transformShapeToSheet(sh, p.x, p.y, p.angle);
        partBBoxes.push(tr.bbox);
        const center = {
          x: (tr.bbox.minX + tr.bbox.maxX) * 0.5,
          y: (tr.bbox.minY + tr.bbox.maxY) * 0.5,
        };
        const insideAnyHole =
          transformedHoles.length > 0 &&
          transformedHoles.some(
            (th) => th.parentId !== p.id && pointInPolygon(center, th.holePoly)
          );
        if (insideAnyHole) {
          holeNestedCount++;
          packedFootprintArea += (areaById.get(p.shapeId) || 0) * 0.5;
        } else {
          packedFootprintArea += polygonArea(sh.points);
        }
      }

      // Compute used column-strip envelope area so clean reusable remnants and step corners are not miscounted as scrap waste
      const usedW = Math.min(st.sheetW, Math.max(10, maxX + st.margin));
      const usedH = Math.min(st.sheetH, Math.max(10, maxY + st.margin));
      const sliceCount = 20;
      const sliceW = usedW / sliceCount;
      let stripEnvelopeArea = 0;
      for (let sIdx = 0; sIdx < sliceCount; sIdx++) {
        const sx0 = sIdx * sliceW;
        const sx1 = sx0 + sliceW;
        let sliceMaxY = 0;
        for (const bb of partBBoxes) {
          if (bb.maxX > sx0 && bb.minX < sx1) {
            if (bb.maxY > sliceMaxY) sliceMaxY = bb.maxY;
          }
        }
        stripEnvelopeArea += sliceW * Math.min(st.sheetH, sliceMaxY + st.margin);
      }
      const effectiveEnvelope = Math.max(a, stripEnvelopeArea, 1);
      const clusterEff = Math.min(96.8, (packedFootprintArea / effectiveEnvelope) * 100);
      const sheetSharePct = Math.min(100, ((usedW * usedH) / totalSheetArea) * 100);
      const remnantWidthMm = Math.max(0, st.sheetW - usedW);

      return {
        count: c,
        eff: clusterEff,
        sheetSharePct,
        remnantWidthMm,
        holeNestedCount,
        areaMm2: a,
        cutLenMm: cutLen,
      };
    });
  }, [snap, shapeById, areaById, perimeterById, st.sheetW, st.sheetH, st.margin]);

  const requested = shapes
    .filter((s) => s.enabled)
    .reduce((n, s) => n + s.qty, 0);
  const placedCount = snap?.placements.length ?? 0;
  const cur = sheetStats[sheet] || {
    count: 0,
    eff: 0,
    sheetSharePct: 0,
    remnantWidthMm: 0,
    holeNestedCount: 0,
    areaMm2: 0,
    cutLenMm: 0,
  };
  const unplacedList = snap
    ? snap.unplaced.map((u) => ({
        name: shapes.find((s) => s.id === u.shapeId)?.name || "?",
        count: u.count,
      }))
    : [];

  const allSheetPresets = useMemo(
    () => [...BUILT_IN_SHEET_PRESETS, ...customPresets],
    [customPresets]
  );

  const handleSaveCloudProject = async (asNew = false) => {
    setSavingCloud(true);
    try {
      const rec = await saveProjectToCloud({
        projectId: asNew ? undefined : activeProjectId || undefined,
        name: projectName,
        shapes,
        settings: st,
        snap,
        efficiency: cur.eff,
      });
      setActiveProjectId(rec.id);
      if (!user) {
        setCloudProjects(loadLocalProjects());
      }
      flash(
        "ok",
        user
          ? `تم حفظ المشروع «${rec.name}» على السحابة بنجاح`
          : `تم حفظ المشروع «${rec.name}» محلياً (سجّل الدخول لمزامنته سحابياً)`
      );
    } catch (e) {
      flash("err", "تعذر حفظ المشروع: " + (e as Error).message);
    } finally {
      setSavingCloud(false);
    }
  };

  const handleLoadProject = (proj: CloudProjectRecord) => {
    setProjectName(proj.name);
    setActiveProjectId(proj.id);
    setSt(proj.settings);
    setShapes(proj.shapes);
    setSheet(0);
    if (proj.placements && proj.placements.length > 0) {
      const maxSheetIdx = proj.placements.reduce((m, p) => Math.max(m, p.sheet), 0);
      setSnap({
        sheets: maxSheetIdx + 1,
        placements: proj.placements,
        unplaced: [],
        trials: 1,
      });
    } else {
      const s = runNestingSync(proj.shapes, {
        ...proj.settings,
        resolution: 450,
        timeBudget: 0,
      });
      setSnap(s);
    }
    flash("ok", `تم فتح المشروع «${proj.name}» بنجاح`);
  };

  const handleSaveCurrentSheetPreset = async () => {
    try {
      const rec = await saveCustomSheetPreset(st.sheetW, st.sheetH);
      if (!user) {
        setCustomPresets(loadLocalCustomPresets());
      }
      flash("ok", `تم حفظ المقاس ${rec.label} في قائمة المقاسات المحفوظة`);
    } catch (e) {
      flash("err", (e as Error).message);
    }
  };

  return (
    <div
      dir="rtl"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingFiles(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setIsDraggingFiles(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDraggingFiles(false);
        void handleUniversalFiles(e.dataTransfer.files);
      }}
      className="relative flex min-h-screen lg:h-screen flex-col bg-[#060a12] text-slate-200"
    >
      {/* Full-Screen Drag & Drop Overlay */}
      {isDraggingFiles && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-emerald-950/75 backdrop-blur-sm p-8">
          <div className="flex flex-col items-center rounded-2xl border-2 border-dashed border-emerald-400 bg-[#07101e] px-10 py-8 text-center shadow-2xl">
            <FileUp className="mb-3 h-12 w-12 text-emerald-400" />
            <h2 className="text-lg font-extrabold text-white">
              أفلت ملفاتك هنا للاستيراد الفوري
            </h2>
            <p className="mt-1 text-xs text-emerald-300">
              يدعم ملفات Illustrator (.ai) · CorelDRAW (.cdr / .pdf / .svg) · AutoCAD (.dxf) · JSON
            </p>
          </div>
        </div>
      )}

      {/* Top Bar Contract: Zone 1 (Brand) — Zone 2 (4 Concise Nav Links) — Zone 3 (Primary CTA) */}
      <header className="flex items-center justify-between gap-8 border-b border-slate-800/90 bg-[#090f1d] px-5 py-2.5">
        <a
          href="#top"
          onClick={(e) => e.preventDefault()}
          className="text-base font-extrabold tracking-tight text-white whitespace-nowrap shrink-0"
        >
          NestPro Studio
        </a>

        <nav className="hidden md:flex items-center gap-6 text-xs font-medium text-slate-300">
          <button
            type="button"
            onClick={() => universalFileInput.current?.click()}
            className="hover:text-emerald-400 transition-colors whitespace-nowrap shrink-0"
          >
            استيراد AI / PDF / CDR / DXF / SVG
          </button>
          <button
            type="button"
            onClick={() => setShowParametricModal(true)}
            className="hover:text-emerald-400 transition-colors whitespace-nowrap shrink-0"
          >
            مولد الأشكال السريع
          </button>
          <button
            type="button"
            onClick={() => setShowReportModal(true)}
            className="hover:text-emerald-400 transition-colors whitespace-nowrap shrink-0"
          >
            تقرير التشغيل والتسعير
          </button>
          <button
            type="button"
            onClick={() => setGuideTab("corel")}
            className="hover:text-emerald-400 transition-colors whitespace-nowrap shrink-0"
          >
            الربط مع CorelDRAW و AI
          </button>
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowCloudModal(true)}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 py-1.5 text-xs font-extrabold text-slate-950 hover:bg-emerald-400 transition-colors whitespace-nowrap shrink-0"
          >
            <Cloud className="h-3.5 w-3.5" />
            <span>
              {user
                ? `السحابة (${cloudProjects.length})`
                : `المشاريع والسحابة (${cloudProjects.length})`}
            </span>
          </button>
        </div>
      </header>

      {/* Main Workspace Grid */}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[405px_1fr]">
        {/* Sidebar */}
        <aside className="min-h-0 space-y-2.5 overflow-y-auto border-l border-slate-800/90 bg-[#080d19] p-3">
          <Card
            title="الاستيراد المباشر الشامل (سحب وإفلات)"
            icon={<FolderUp className="h-4 w-4" />}
          >
            <div className="grid grid-cols-2 gap-2">
              <Select
                label="وحدة القياس للملفات"
                value={svgUnit}
                onChange={setSvgUnit}
                options={[
                  { v: "auto", t: "تلقائي (mm / PDF / Corel)" },
                  { v: "mm", t: "مليمتر (mm)" },
                  { v: "cm", t: "سنتيمتر (cm)" },
                  { v: "pt", t: "نقطة (pt - Illustrator)" },
                  { v: "px", t: "بكسل (96dpi)" },
                  { v: "in", t: "بوصة (in)" },
                ]}
              />
              <Select
                label="تجميع المسارات"
                value={svgGroup}
                onChange={setSvgGroup}
                options={[
                  { v: "path", t: "كل مسار مغلق = قطعة" },
                  { v: "group", t: "دمج المجموعة = قطعة" },
                ]}
              />
            </div>

            <div className="mt-2.5 space-y-2">
              <button
                type="button"
                onClick={() => universalFileInput.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-extrabold text-slate-950 hover:bg-emerald-400 transition-colors"
              >
                <FileUp className="h-4 w-4" />
                <span>اختر ملفات (AI · CDR · PDF · DXF · SVG · JSON)</span>
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setShowParametricModal(true)}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/90 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
                >
                  <Shapes className="h-3.5 w-3.5 text-emerald-400" />
                  <span>+ شكل قياسي سريع</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const demos = demoShapes();
                    setShapes((a) => [...a, ...demos]);
                    flash("ok", `تمت إضافة ${demos.length} قطع تجريبية مع فتحات داخلية`);
                  }}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/90 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
                >
                  <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
                  <span>نماذج تجريبية</span>
                </button>
              </div>
            </div>

            <input
              ref={universalFileInput}
              type="file"
              accept=".ai,.pdf,.cdr,.dxf,.svg,.eps,.json,application/pdf,image/svg+xml,application/json"
              multiple
              hidden
              onChange={(e) => void handleUniversalFiles(e.target.files)}
            />
          </Card>

          <Card
            title={`قائمة القطع (${shapes.length} نوع • ${requested} قطعة)`}
            icon={<Layers className="h-4 w-4" />}
            action={
              shapes.length > 0 && (
                <div className="flex items-center gap-1 text-[11px]">
                  <button
                    type="button"
                    onClick={() =>
                      setShapes((a) => a.map((s) => ({ ...s, qty: s.qty + 1 })))
                    }
                    className="rounded bg-slate-800 px-2 py-0.5 text-slate-300 hover:bg-slate-700 hover:text-white"
                  >
                    +1 للكل
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShapes([]);
                      setSnap(null);
                    }}
                    className="rounded bg-rose-950/70 px-2 py-0.5 text-rose-300 hover:bg-rose-900"
                  >
                    مسح الكل
                  </button>
                </div>
              )
            }
          >
            {shapes.some((s) => s.holes.length > 0) && (
              <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5 rounded-lg border border-slate-800 bg-[#060b14] px-2.5 py-1.5 text-[11px]">
                <span className="text-slate-400">
                  التحكم بالمسارات الداخلية:
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setShapes((arr) => arr.map((s) => ({ ...s, holes: [] })));
                      flash("ok", "تم إلغاء تفريغ جميع الأشكال وتحويلها إلى قطع مصمتة بالكامل");
                    }}
                    className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-semibold text-amber-300 hover:bg-amber-500/20"
                  >
                    إلغاء تفريغ الكل (مصمت)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShapes((arr) => {
                        const next: Shape[] = [];
                        const palette = ["#06b6d4", "#ec4899", "#f59e0b", "#8b5cf6", "#3b82f6", "#10b981"];
                        for (const s of arr) {
                          if (s.holes.length === 0) {
                            next.push(s);
                            continue;
                          }
                          next.push({ ...s, holes: [] });
                          s.holes.forEach((hPoly, idx) => {
                            const norm = normalizeShapeGeometry(hPoly, []);
                            if (norm.w >= 0.5 && norm.h >= 0.5) {
                              next.push({
                                id: `${s.id}_hole_${idx + 1}_${Date.now().toString(36).slice(-3)}`,
                                name: `${s.name} (قطعة #${idx + 1})`,
                                points: norm.points,
                                holes: [],
                                qty: s.qty,
                                fill: false,
                                enabled: true,
                                color: palette[idx % palette.length],
                                source: s.source,
                                origX: (s.origX || 0) + norm.origX,
                                origY: (s.origY || 0) + norm.origY,
                                w: norm.w,
                                h: norm.h,
                              });
                            }
                          });
                        }
                        return next;
                      });
                      flash("ok", "تم فصل كافة المسارات الداخلية كقطع مستقلة مصمتة");
                    }}
                    className="rounded border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 font-semibold text-cyan-300 hover:bg-cyan-500/20"
                  >
                    فصل الكل كقطع مستقلة
                  </button>
                </div>
              </div>
            )}
            <PartsList
              shapes={shapes}
              unitFactor={f}
              unitLabel={unit}
              allowHoles={st.holes}
              onChange={patchShape}
              onRemove={removeShape}
              onExtractHolesAsParts={extractHolesAsParts}
            />
          </Card>

          <Card
            title="اللوح الخام والمقاسات المحفوظة"
            icon={<Sliders className="h-4 w-4" />}
            action={
              <button
                type="button"
                onClick={() => void handleSaveCurrentSheetPreset()}
                className="flex items-center gap-1 rounded bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold text-emerald-300 hover:bg-emerald-500/25"
              >
                <BookmarkPlus className="h-3 w-3" />
                <span>حفظ المقاس الحالي</span>
              </button>
            }
          >
            {/* Highlighted Saved Sheet Presets (including 1300*100, 2000*1300, 1250*3200, 1500*3500) */}
            <div className="mb-2.5">
              <span className="mb-1.5 block text-[11px] font-semibold text-emerald-400">
                المقاسات المحفوظة الجاهزة (اضغط للاختيار الفوري):
              </span>
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                {allSheetPresets.map((preset) => {
                  const isActive =
                    Math.abs(st.sheetW - preset.widthMm) < 0.5 &&
                    Math.abs(st.sheetH - preset.heightMm) < 0.5;
                  return (
                    <div
                      key={preset.id}
                      className={`inline-flex items-center rounded-md border transition-colors ${
                        isActive
                          ? "border-emerald-400 bg-emerald-500/20 text-emerald-200 font-bold"
                          : "border-slate-700/90 bg-[#060b14] text-slate-300 hover:border-emerald-500/50 hover:text-emerald-300"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          const nextSt = {
                            ...st,
                            sheetW: preset.widthMm,
                            sheetH: preset.heightMm,
                          };
                          setSt(nextSt);
                          if (!running && shapes.length > 0) {
                            const t0 = performance.now();
                            const fastSnap = runNestingSync(shapes, {
                              ...nextSt,
                              resolution: 450,
                              timeBudget: 0,
                            });
                            setSnap(fastSnap);
                            setElapsed(performance.now() - t0);
                            setProgress({
                              pct: 100,
                              msg: `مقاس ${preset.widthMm}×${preset.heightMm} مم • ${fastSnap.placements.length} قطعة معشّقة`,
                            });
                          }
                        }}
                        className="px-2 py-1 font-mono tabular-nums"
                        dir="ltr"
                      >
                        {preset.widthMm}×{preset.heightMm} مم
                      </button>
                      {!preset.isBuiltIn && (
                        <button
                          type="button"
                          aria-label={`حذف مقاس ${preset.label}`}
                          onClick={() => {
                            void deleteCustomSheetPreset(preset.id).then(() => {
                              if (!user) setCustomPresets(loadLocalCustomPresets());
                            });
                          }}
                          className="border-r border-slate-700/80 px-1 py-1 text-slate-500 hover:text-rose-400"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mb-2 grid grid-cols-2 gap-2">
              <Select
                label="وحدة العرض والقياس"
                value={unit}
                onChange={setUnit}
                options={[
                  { v: "mm", t: "مليمتر (mm)" },
                  { v: "cm", t: "سنتيمتر (cm)" },
                  { v: "in", t: "بوصة (in)" },
                ]}
              />
              <NumField
                label="سعر اللوح الخام"
                mm={st.sheetCost}
                f={1}
                suffix="ج.م / $"
                onChange={(v) => setS("sheetCost", v)}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <NumField
                label="عرض اللوح (W)"
                mm={st.sheetW}
                f={f}
                suffix={unit}
                onChange={(v) => setS("sheetW", v)}
              />
              <NumField
                label="ارتفاع اللوح (H)"
                mm={st.sheetH}
                f={f}
                suffix={unit}
                onChange={(v) => setS("sheetH", v)}
              />
              <NumField
                label="هامش الأمان"
                mm={st.margin}
                f={f}
                suffix={unit}
                onChange={(v) => setS("margin", v)}
              />
              <NumField
                label="التباعد بين القطع"
                mm={st.spacing}
                f={f}
                suffix={unit}
                onChange={(v) => setS("spacing", v)}
              />
              <NumField
                label="تعويض شعاع الليزر (Kerf)"
                mm={st.kerf}
                f={f}
                suffix={unit}
                onChange={(v) => setS("kerf", v)}
                hint="يضاف لخلوص الأمان"
              />
              <NumField
                label="سرعة القص"
                mm={st.cutSpeed}
                f={1}
                suffix="mm/s"
                onChange={(v) => setS("cutSpeed", Math.max(1, v))}
                hint="لحساب زمن الليزر"
              />
            </div>
          </Card>

          <Card title="إعدادات خوارزمية التعشيق والدوران" icon={<Settings2 className="h-4 w-4" />}>
            <div className="grid grid-cols-2 gap-2">
              <Select
                label="زاوية الدوران الحر"
                value={st.rotStep}
                onChange={(v) => setS("rotStep", v)}
                options={[
                  { v: 360, t: "بدون تدوير (0°)" },
                  { v: 180, t: "كل 180° (اتجاه العرق)" },
                  { v: 90, t: "كل 90°" },
                  { v: 45, t: "كل 45°" },
                  { v: 30, t: "كل 30°" },
                  { v: 15, t: "كل 15° (قياسي)" },
                  { v: 10, t: "كل 10°" },
                  { v: 5, t: "كل 5° (دقيق)" },
                  { v: 2, t: "كل 2° (حر عالي)" },
                ]}
              />
              <Select
                label="دقة الشبكة النقطية"
                value={st.resolution}
                onChange={(v) => setS("resolution", v)}
                options={[
                  { v: 350, t: "سريعة (350)" },
                  { v: 600, t: "متوازنة (600)" },
                  { v: 900, t: "دقيقة (900)" },
                  { v: 1300, t: "عالية جداً (1300)" },
                ]}
              />
              <Select
                label="اتجاه الجاذبية والرص"
                value={st.strategy}
                onChange={(v) => setS("strategy", v)}
                options={[
                  { v: "gravity-bl", t: "رص عمودي (حفظ فضلة عرضية)" },
                  { v: "gravity-tl", t: "رص أفقي (حفظ فضلة طولية)" },
                  { v: "squeeze", t: "ضغط أقصى نحو الزاوية" },
                  { v: "box-compact", t: "أصغر مستطيل محيط" },
                ]}
              />
              <Select
                label="ميزانية وقت التحسين"
                value={st.timeBudget}
                onChange={(v) => setS("timeBudget", v)}
                options={[
                  { v: 0, t: "فوري (محاولة واحدة)" },
                  { v: 4, t: "4 ثوانٍ (سريع)" },
                  { v: 10, t: "10 ثوانٍ (موصى به)" },
                  { v: 25, t: "25 ثانية (مكثف)" },
                  { v: 60, t: "60 ثانية (قصوى)" },
                ]}
              />
              <Select
                label="الحد الأقصى للألواح"
                value={st.maxSheets}
                onChange={(v) => setS("maxSheets", v)}
                options={[1, 2, 3, 5, 10, 20].map((n) => ({
                  v: n,
                  t: n === 1 ? "لوح واحد فقط" : `حتى ${n} ألواح`,
                }))}
              />
              <Select
                label="إصدار CorelDRAW"
                value={st.corelVersion}
                onChange={(v) => setS("corelVersion", v)}
                options={[
                  { v: "2024-2026", t: "CorelDRAW 2024–2026" },
                  { v: "2020-2023", t: "CorelDRAW 2020–2023" },
                  { v: "X7-2019", t: "CorelDRAW X7–2019" },
                ]}
              />
            </div>

            <div className="mt-2.5 space-y-1.5 text-xs text-slate-300">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={st.edgeAlign}
                  onChange={(e) => setS("edgeAlign", e.target.checked)}
                  className="accent-emerald-400"
                />
                <span>محاذاة الحواف المائلة تلقائياً (Edge Alignment)</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={st.holes}
                  onChange={(e) => setS("holes", e.target.checked)}
                  className="accent-emerald-400"
                />
                <span>تعشيق القطع الصغيرة داخل الفتحات الداخلية (Hole-in-Hole)</span>
              </label>
            </div>
          </Card>
        </aside>

        {/* Main Viewport & Export Center */}
        <main className="flex min-h-0 flex-col gap-2.5 p-3">
          {/* Action, Cloud Save & Progress Toolbar */}
          <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-slate-800/90 bg-[#0b1221] p-2.5">
            {!running ? (
              <button
                type="button"
                onClick={start}
                className="flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-2 text-xs font-extrabold text-slate-950 shadow-lg shadow-emerald-950/50 hover:bg-emerald-400 transition-colors whitespace-nowrap shrink-0"
              >
                <Play className="h-4 w-4 fill-current" />
                <span>ابدأ التعشيق الذكي</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={stop}
                className="flex items-center gap-2 rounded-lg bg-rose-600 px-5 py-2 text-xs font-extrabold text-white hover:bg-rose-500 whitespace-nowrap shrink-0"
              >
                <Square className="h-4 w-4 fill-current" />
                <span>إيقاف وحفظ النتيجة</span>
              </button>
            )}

            <button
              type="button"
              disabled={running}
              onClick={() => {
                const t0 = performance.now();
                const fastSnap = runNestingSync(shapes, {
                  ...st,
                  resolution: 450,
                  timeBudget: 0,
                });
                setSnap(fastSnap);
                setElapsed(performance.now() - t0);
                setProgress({
                  pct: 100,
                  msg: `تعشيق فوري • ${fastSnap.placements.length} قطعة`,
                });
              }}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/90 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700 disabled:opacity-40 whitespace-nowrap shrink-0"
            >
              <RotateCcw className="h-3.5 w-3.5 text-emerald-400" />
              <span>رص فوري</span>
            </button>

            <button
              type="button"
              disabled={savingCloud}
              onClick={() => void handleSaveCloudProject(false)}
              className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-xs font-bold text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40 whitespace-nowrap shrink-0"
            >
              <CloudUpload className="h-3.5 w-3.5" />
              <span>{savingCloud ? "جارٍ الحفظ..." : "حفظ في السحابة"}</span>
            </button>

            {snap && (
              <button
                type="button"
                onClick={() => setShowReportModal(true)}
                className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/90 px-3 py-2 text-xs font-bold text-cyan-300 hover:bg-slate-700 whitespace-nowrap shrink-0"
              >
                <Calculator className="h-3.5 w-3.5" />
                <span>تقرير التشغيل والتسعير</span>
              </button>
            )}

            <div className="min-w-[160px] flex-1">
              <div className="mb-1 flex justify-between text-[11px] text-slate-400">
                <span className="truncate">{progress.msg || "جاهز"}</span>
                <span dir="ltr" className="font-mono tabular-nums">
                  {Math.round(progress.pct)}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all duration-150"
                  style={{ width: `${progress.pct}%` }}
                />
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-400 whitespace-nowrap shrink-0">
              <input
                type="checkbox"
                checked={outline}
                onChange={(e) => setOutline(e.target.checked)}
                className="accent-emerald-400"
              />
              <span>إظهار الحدود</span>
            </label>
          </div>

          {/* Notification Banner */}
          {info && (
            <div
              role="status"
              className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
                info.kind === "ok"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-rose-500/30 bg-rose-500/10 text-rose-300"
              }`}
            >
              {info.text}
            </div>
          )}

          {/* Multi-Sheet Selector Bar */}
          {snap && snap.sheets > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {Array.from({ length: snap.sheets }, (_, i) => (
                <button
                  type="button"
                  key={i}
                  onClick={() => setSheet(i)}
                  className={`rounded-lg px-3 py-1 text-xs font-bold transition-colors ${
                    sheet === i
                      ? "bg-emerald-500 text-slate-950"
                      : "border border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  لوح #{i + 1} · {sheetStats[i]?.count || 0} قطعة (
                  <span className="font-mono tabular-nums">
                    {sheetStats[i]?.eff.toFixed(1)}%
                  </span>
                  )
                </button>
              ))}
            </div>
          )}

          {/* Interactive CAD Preview Canvas */}
          <div className="min-h-[340px] flex-1">
            <Preview
              shapes={shapes}
              snap={snap}
              sheet={sheet}
              st={st}
              unitFactor={f}
              unitLabel={unit}
              showOutline={outline}
              onUpdatePlacement={updatePlacement}
            />
          </div>

          {/* Quantitative Telemetry Row (Full-Width 5 Columns) */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
            <Stat
              label="كفاءة التعشيق الفعلي"
              value={snap ? cur.eff.toFixed(1) + "%" : "—"}
              sub={
                snap
                  ? `${(cur.areaMm2 / 10000).toFixed(2)} دسم² صافي (${cur.sheetSharePct.toFixed(0)}% من اللوح)`
                  : ""
              }
              color="text-emerald-400"
            />
            <Stat
              label="نسبة الهدر الفعلي"
              value={snap ? Math.max(0, 100 - cur.eff).toFixed(1) + "%" : "—"}
              sub={
                snap
                  ? cur.remnantWidthMm > 30
                    ? `فضلة سليمة متوفرة: ${Math.round(cur.remnantWidthMm)} مم`
                    : `تكلفة المستغل: ${((cur.sheetSharePct / 100) * st.sheetCost).toFixed(0)}`
                  : ""
              }
              color="text-rose-400"
            />
            <Stat
              label="القطع المعشّقة"
              value={snap ? `${placedCount} / ${requested}` : "—"}
              sub={
                snap
                  ? cur.holeNestedCount > 0
                    ? `منها ${cur.holeNestedCount} قطعة داخل الفتحات`
                    : `على ${snap.sheets} لوح (${st.sheetW}×${st.sheetH})`
                  : ""
              }
              color="text-cyan-300"
            />
            <Stat
              label="إجمالي مسار القص"
              value={snap ? `${(cur.cutLenMm / 1000).toFixed(2)} م` : "—"}
              sub={
                snap && st.cutSpeed > 0
                  ? `~${Math.ceil(cur.cutLenMm / st.cutSpeed)} ثانية ليزر`
                  : ""
              }
              color="text-blue-300"
            />
            <Stat
              label="زمن المعالجة"
              value={snap ? (elapsed / 1000).toFixed(2) + " ث" : "—"}
              sub={snap ? `${snap.trials || 1} محاولة تحسين` : ""}
              color="text-amber-300"
            />
          </div>

          {/* Dedicated CorelDRAW / CNC / Illustrator Export Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800/90 bg-[#0b1221] px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!snap || running}
                onClick={() =>
                  snap &&
                  download(
                    "NestPro_RunInCorel.vbs",
                    buildCorelOneClickVBS(shapes, snap, st),
                    "text/vbscript"
                  )
                }
                className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 py-2 text-xs font-extrabold text-slate-950 hover:bg-emerald-400 disabled:opacity-40 whitespace-nowrap shrink-0"
              >
                <Download className="h-3.5 w-3.5" />
                <span>إرسال مباشر لـ CorelDRAW (.vbs)</span>
              </button>

              <button
                type="button"
                disabled={!snap || running}
                onClick={() =>
                  snap &&
                  download(
                    "NestPro_Corel_Apply.bas",
                    buildCorelApplyMacro(shapes, snap, st, cleanTags),
                    "text/plain"
                  )
                }
                className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-xs font-bold text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40 whitespace-nowrap shrink-0"
              >
                <Download className="h-3.5 w-3.5" />
                <span>ماكرو Corel (.bas)</span>
              </button>

              <button
                type="button"
                disabled={!snap || running}
                onClick={() =>
                  snap &&
                  download(
                    `NestPro_Sheet_${sheet + 1}.dxf`,
                    sheetToDXF(shapes, snap, sheet, st),
                    "application/dxf"
                  )
                }
                className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-40 whitespace-nowrap shrink-0"
              >
                <Download className="h-3.5 w-3.5 text-cyan-400" />
                <span>DXF (كاد / ليزر)</span>
              </button>

              <button
                type="button"
                disabled={!snap || running}
                onClick={() =>
                  snap &&
                  download(
                    `NestPro_Sheet_${sheet + 1}.svg`,
                    sheetToSVG(shapes, snap, sheet, st),
                    "image/svg+xml"
                  )
                }
                className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-40 whitespace-nowrap shrink-0"
              >
                <Download className="h-3.5 w-3.5 text-emerald-400" />
                <span>SVG (بالمليمتر)</span>
              </button>

              <button
                type="button"
                disabled={!snap || running}
                onClick={() =>
                  snap &&
                  download(
                    `NestPro_Sheet_${sheet + 1}.plt`,
                    sheetToHPGL(shapes, snap, sheet, st),
                    "application/plt"
                  )
                }
                className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-40 whitespace-nowrap shrink-0"
              >
                <Download className="h-3.5 w-3.5 text-purple-400" />
                <span>PLT (كتر بلوتر)</span>
              </button>

              <button
                type="button"
                disabled={!snap || running}
                onClick={() =>
                  snap &&
                  download(
                    "NestPro_AI_Apply.jsx",
                    buildApplyScript(shapes, snap, st, cleanTags),
                    "application/javascript"
                  )
                }
                className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-xs font-bold text-amber-300 hover:bg-amber-500/25 disabled:opacity-40 whitespace-nowrap shrink-0"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Illustrator (.jsx)</span>
              </button>
            </div>

            <div className="flex items-center gap-3 text-[11px] text-slate-400">
              <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap shrink-0">
                <input
                  type="checkbox"
                  checked={cleanTags}
                  onChange={(e) => setCleanTags(e.target.checked)}
                  className="accent-emerald-400"
                />
                <span>تنظيف وسوم الأصل بعد التطبيق</span>
              </label>
            </div>
          </div>

          {/* Footer Hints & Unplaced Warning */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
            <div className="flex flex-wrap items-center gap-3">
              <span>
                المشروع النشط: <strong className="text-slate-200">{projectName}</strong>
              </span>
              {snap && snap.sheets > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    download(
                      "NestPro_All_Sheets.svg",
                      allSheetsToSVG(shapes, snap, st),
                      "image/svg+xml"
                    )
                  }
                  className="text-emerald-400 underline hover:text-emerald-300"
                >
                  تحميل جميع الألواح ({snap.sheets}) في ملف SVG واحد
                </button>
              )}
            </div>

            {unplacedList.length > 0 ? (
              <span className="rounded border border-rose-500/30 bg-rose-500/10 px-2.5 py-0.5 text-rose-300">
                لم تتسع على اللوح:{" "}
                {unplacedList.map((u) => `${u.name} ×${u.count}`).join(" · ")} — كبّر مقاس اللوح أو زد عدد الألواح
              </span>
            ) : (
              <span>
                معيار الألوان للقص: <strong className="text-blue-400">الأزرق = الفتحات الداخلية (تُقص أولاً)</strong> · <strong className="text-rose-400">الأحمر = الحدود الخارجية</strong>
              </span>
            )}
          </div>
        </main>
      </div>

      {guideTab && (
        <IntegrationGuideModal
          initialTab={guideTab}
          onClose={() => setGuideTab(null)}
          shapes={shapes}
          snap={snap}
          st={st}
          cleanTags={cleanTags}
        />
      )}

      {showCloudModal && (
        <CloudProjectsModal
          onClose={() => setShowCloudModal(false)}
          user={user}
          projectName={projectName}
          onChangeProjectName={setProjectName}
          projects={cloudProjects}
          activeProjectId={activeProjectId}
          saving={savingCloud}
          onSignIn={ async () => {
            await signInWithGooglePopup();
            flash("ok", "تم تسجيل الدخول ومزامنة مشاريع السحابة بنجاح");
          }}
          onSignOut={async () => {
            await signOutUser();
            flash("ok", "تم تسجيل الخروج والعودة للحفظ المحلي");
          }}
          onSaveCurrent={handleSaveCloudProject}
          onLoadProject={handleLoadProject}
          onDeleteProject={async (id) => {
            await deleteProjectFromCloud(id);
            if (!user) setCloudProjects(loadLocalProjects());
            if (activeProjectId === id) setActiveProjectId(null);
            flash("ok", "تم حذف المشروع");
          }}
        />
      )}

      {showParametricModal && (
        <ParametricShapeModal
          onClose={() => setShowParametricModal(false)}
          onAddShape={(newSh) => {
            setShapes((prev) => [...prev, newSh]);
            flash("ok", `تمت إضافة «${newSh.name}» إلى قائمة القطع`);
          }}
        />
      )}

      {showReportModal && snap && (
        <ProductionReportModal
          onClose={() => setShowReportModal(false)}
          projectName={projectName}
          shapes={shapes}
          snap={snap}
          st={st}
        />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800/90 bg-[#0b1221] px-3 py-2">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div
        className={`mt-0.5 font-mono text-lg font-extrabold tabular-nums ${color}`}
        dir="ltr"
        style={{ textAlign: "right" }}
      >
        {value}
      </div>
      {sub && <div className="text-[10px] text-slate-500 font-mono tabular-nums">{sub}</div>}
    </div>
  );
}
