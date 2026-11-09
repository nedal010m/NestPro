import { polygonArea, shapeArea } from "./geometry";
import {
  buildRasterMask,
  getCandidateAngles,
  type PartInstance,
  type RasterMask,
  runSingleTrial,
  sortPartInstancesForNesting,
} from "./nestingEngine";
import type { NestSnapshot, WorkerIn, WorkerOut } from "./types";

const ctx = self as unknown as {
  postMessage: (msg: WorkerOut) => void;
  onmessage: ((e: MessageEvent<WorkerIn>) => void) | null;
};

function post(msg: WorkerOut) {
  ctx.postMessage(msg);
}

ctx.onmessage = (e: MessageEvent<WorkerIn>) => {
  const data = e.data;
  if (!data || data.type !== "start") return;

  try {
    const t0 = performance.now();
    const { shapes, settings: st } = data;
    const usableW = st.sheetW - st.margin * 2;
    const usableH = st.sheetH - st.margin * 2;

    if (usableW <= 2 || usableH <= 2) {
      post({ type: "error", msg: "مقاس اللوح بعد خصم الهوامش صغير جداً" });
      return;
    }

    const activeShapes = shapes.filter((s) => s.enabled && (s.qty > 0 || s.fill));
    if (!activeShapes.length) {
      post({ type: "error", msg: "لا توجد قطع مفعّلة للتعشيق" });
      return;
    }

    const maxDim = Math.max(usableW, usableH);
    const resolution = Math.max(150, Math.min(2000, st.resolution || 600));
    const cellSize = maxDim / resolution;
    const wCells = Math.max(1, Math.floor(usableW / cellSize));
    const hCells = Math.max(1, Math.floor(usableH / cellSize));
    const totalClearanceMm = Math.max(0, (st.spacing || 0) + (st.kerf || 0));
    const clearanceCells = Math.max(0, totalClearanceMm / cellSize);

    // Phase 1: Build raster masks for all active shapes & candidate rotations
    const masksByShapeId = new Map<string, RasterMask[]>();
    let totalAngles = 0;
    const shapeAnglesList = activeShapes.map((s) => {
      const angles = getCandidateAngles(s, st);
      totalAngles += angles.length;
      return { shape: s, angles };
    });

    let doneAngles = 0;
    for (const item of shapeAnglesList) {
      const masks: RasterMask[] = [];
      for (const ang of item.angles) {
        masks.push(buildRasterMask(item.shape, ang, cellSize, clearanceCells, st.holes));
        doneAngles++;
        if (doneAngles % 12 === 0 || doneAngles === totalAngles) {
          const pct = Math.min(25, Math.round((doneAngles / Math.max(1, totalAngles)) * 25));
          post({
            type: "progress",
            pct,
            msg: `تجهيز الأقنعة النقطية (${doneAngles}/${totalAngles})...`,
          });
        }
      }
      masks.sort((a, b) => {
        const areaDiff = a.wCells * a.hCells - b.wCells * b.hCells;
        if (Math.abs(areaDiff) > 2) return areaDiff;
        const orthoA = a.angle % 90 === 0 ? 0 : 1;
        const orthoB = b.angle % 90 === 0 ? 0 : 1;
        return orthoA - orthoB;
      });
      masksByShapeId.set(item.shape.id, masks);
    }

    // Prepare required part instances
    const rawInstances: PartInstance[] = [];
    for (const s of activeShapes) {
      const outerArea = polygonArea(s.points);
      const area = shapeArea(s, st.holes);
      for (let k = 0; k < s.qty; k++) {
        rawInstances.push({
          shape: s,
          instanceIdx: k,
          outerArea,
          area,
          isFiller: false,
        });
      }
    }

    const baseInstances = sortPartInstancesForNesting(rawInstances);
    const fillerShapes = activeShapes.filter((s) => s.fill);

    // Phase 2: Multi-pass optimization within timeBudget
    const budgetMs = Math.max(0, st.timeBudget * 1000);
    let bestSnap: NestSnapshot | null = null;
    let bestScore = -Infinity;
    let bestOrder = [...baseInstances];
    let trials = 0;

    while (true) {
      const candidateOrder =
        trials === 0
          ? [...baseInstances]
          : mutateOrder(bestOrder, trials);

      const { snap, score } = runSingleTrial(
        candidateOrder,
        fillerShapes,
        masksByShapeId,
        st,
        cellSize,
        wCells,
        hCells,
        trials
      );
      trials++;
      snap.trials = trials;

      const elapsed = performance.now() - t0;
      if (score > bestScore || !bestSnap) {
        bestScore = score;
        bestSnap = snap;
        bestOrder = candidateOrder;
        post({ type: "best", snap: bestSnap, elapsed, trials });
      }

      if (budgetMs <= 0 || elapsed >= budgetMs) {
        break;
      }

      const pct = Math.min(99, 25 + Math.round((elapsed / budgetMs) * 74));
      post({
        type: "progress",
        pct,
        msg: `تحسين التعشيق • محاولة #${trials} (${Math.round(elapsed / 1000)}/${st.timeBudget} ث)`,
      });
    }

    const finalElapsed = performance.now() - t0;
    if (bestSnap) {
      bestSnap.trials = trials;
      post({ type: "done", snap: bestSnap, elapsed: finalElapsed, trials });
    }
  } catch (err) {
    post({
      type: "error",
      msg: (err as Error)?.message || "حدث خطأ غير متوقع أثناء التعشيق",
    });
  }
};

function mutateOrder(order: PartInstance[], seed: number): PartInstance[] {
  const next = [...order];
  if (next.length <= 1) return next;

  // Deterministic pseudo-random generator
  let s = (seed * 1664525 + 1013904223) >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };

  // Separate parts with holes (parents) from solid parts so parents are always placed before small children
  const parents = next.filter((p) => (p.shape.holes?.length || 0) > 0);
  const others = next.filter((p) => (p.shape.holes?.length || 0) === 0);

  if (seed === 1) {
    parents.sort((a, b) => Math.max(b.shape.w, b.shape.h) - Math.max(a.shape.w, a.shape.h));
    others.sort((a, b) => Math.max(b.shape.w, b.shape.h) - Math.max(a.shape.w, a.shape.h));
    return [...parents, ...others];
  }
  if (seed === 2) {
    parents.sort((a, b) => b.shape.w * b.shape.h - a.shape.w * a.shape.h);
    others.sort((a, b) => b.shape.w * b.shape.h - a.shape.w * a.shape.h);
    return [...parents, ...others];
  }

  // Perturb within parents and within solid parts (preserving parent-before-child ordering)
  const swapGroup = (arr: PartInstance[]) => {
    if (arr.length <= 1) return;
    const swaps = Math.max(1, Math.min(3, Math.floor(arr.length * 0.25)));
    for (let k = 0; k < swaps; k++) {
      const i = Math.floor(rand() * arr.length);
      const span = Math.max(2, Math.floor(arr.length * 0.35));
      const j = Math.min(arr.length - 1, Math.max(0, i + Math.floor((rand() - 0.5) * span)));
      if ((arr[i].shape.priority ?? 2) === (arr[j].shape.priority ?? 2)) {
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
      }
    }
  };

  swapGroup(parents);
  swapGroup(others);
  return [...parents, ...others];
}
