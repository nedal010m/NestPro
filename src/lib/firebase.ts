import { initializeApp } from "firebase/app";
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";
import type { NestSettings, NestSnapshot, Placement, Polygon, Shape } from "./types";

const app = initializeApp(firebaseConfig);
export const db = getFirestoreInstance();
export const auth = getAuth(app);

import { getFirestore } from "firebase/firestore";
function getFirestoreInstance() {
  return getFirestore(app, firebaseConfig.firestoreDatabaseId);
}

// Validate connection to Firestore on boot as required by Firebase skill
async function testConnection() {
  try {
    await getDocFromServer(doc(db, "test", "connection"));
  } catch (error) {
    if (error instanceof Error && error.message.includes("the client is offline")) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
void testConnection();

export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error("Firestore Error: ", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validation constants synced verbatim with firebase-blueprint.json
export const PROJECT_NAME_MAX_LEN = 120;
export const PRESET_LABEL_MAX_LEN = 60;
export const ID_REGEX = /^[a-zA-Z0-9_-]+$/;
export const MAX_SHAPES_COUNT = 100;
export const MAX_PLACEMENTS_COUNT = 500;

export interface CloudProjectRecord {
  id: string;
  ownerId: string;
  name: string;
  sheetW: number;
  sheetH: number;
  partsCount: number;
  efficiency: number;
  settings: NestSettings;
  shapes: Shape[];
  placements: Placement[];
  updatedAtMs: number;
  isLocalOnly?: boolean;
}

export interface SheetPresetRecord {
  id: string;
  ownerId: string;
  label: string;
  widthMm: number;
  heightMm: number;
  isBuiltIn?: boolean;
}

/**
 * Built-in standard & industrial saved sheet sizes (including the user's 4 requested sizes).
 */
export const BUILT_IN_SHEET_PRESETS: SheetPresetRecord[] = [
  {
    id: "preset_1000_1300",
    ownerId: "system",
    label: "1000 × 1300 مم",
    widthMm: 1000,
    heightMm: 1300,
    isBuiltIn: true,
  },
  {
    id: "preset_2000_1300",
    ownerId: "system",
    label: "2000 × 1300 مم",
    widthMm: 2000,
    heightMm: 1300,
    isBuiltIn: true,
  },
  {
    id: "preset_1250_3200",
    ownerId: "system",
    label: "1250 × 3200 مم",
    widthMm: 1250,
    heightMm: 3200,
    isBuiltIn: true,
  },
  {
    id: "preset_1500_3500",
    ownerId: "system",
    label: "1500 × 3500 مم",
    widthMm: 1500,
    heightMm: 3500,
    isBuiltIn: true,
  },
  {
    id: "preset_1300_900",
    ownerId: "system",
    label: "1300 × 900 مم (ليزر)",
    widthMm: 1300,
    heightMm: 900,
    isBuiltIn: true,
  },
  {
    id: "preset_900_600",
    ownerId: "system",
    label: "900 × 600 مم (ليزر)",
    widthMm: 900,
    heightMm: 600,
    isBuiltIn: true,
  },
  {
    id: "preset_1220_2440",
    ownerId: "system",
    label: "1220 × 2440 مم (لوح كامل)",
    widthMm: 1220,
    heightMm: 2440,
    isBuiltIn: true,
  },
  {
    id: "preset_1000_700",
    ownerId: "system",
    label: "1000 × 700 مم",
    widthMm: 1000,
    heightMm: 700,
    isBuiltIn: true,
  },
];

/**
 * Flatten a Shape into a Firestore-safe Map (no nested array-of-arrays).
 */
function serializeShapeForFirestore(s: Shape): Record<string, unknown> {
  const ptsFlat: number[] = [];
  const step = s.points.length > 180 ? Math.ceil(s.points.length / 180) : 1;
  for (let i = 0; i < s.points.length; i += step) {
    ptsFlat.push(
      Math.round(s.points[i].x * 100) / 100,
      Math.round(s.points[i].y * 100) / 100
    );
  }

  const holeCounts: number[] = [];
  const holesFlat: number[] = [];
  for (const h of (s.holes || []).slice(0, 25)) {
    const hStep = h.length > 80 ? Math.ceil(h.length / 80) : 1;
    let count = 0;
    for (let i = 0; i < h.length; i += hStep) {
      holesFlat.push(Math.round(h[i].x * 100) / 100, Math.round(h[i].y * 100) / 100);
      count++;
    }
    if (count >= 3) holeCounts.push(count);
  }

  return {
    id: String(s.id).slice(0, 80),
    name: String(s.name || "Part").slice(0, 100),
    ptsFlat,
    holeCounts,
    holesFlat,
    qty: Math.max(0, Math.min(10000, Number(s.qty) || 1)),
    fill: Boolean(s.fill),
    enabled: Boolean(s.enabled),
    lockRotation: Boolean(s.lockRotation),
    grainLock: Boolean(s.grainLock),
    color: String(s.color || "#10b981").slice(0, 20),
    source: String(s.source || "svg").slice(0, 20),
    origId: String(s.origId || "").slice(0, 60),
    w: Number(s.w) || 10,
    h: Number(s.h) || 10,
  };
}

function deserializeShapeFromFirestore(raw: any): Shape {
  const ptsFlat: number[] = Array.isArray(raw.ptsFlat) ? raw.ptsFlat : [];
  const points: Polygon = [];
  for (let i = 0; i + 1 < ptsFlat.length; i += 2) {
    points.push({ x: Number(ptsFlat[i]) || 0, y: Number(ptsFlat[i + 1]) || 0 });
  }

  const holeCounts: number[] = Array.isArray(raw.holeCounts) ? raw.holeCounts : [];
  const holesFlat: number[] = Array.isArray(raw.holesFlat) ? raw.holesFlat : [];
  const holes: Polygon[] = [];
  let cursor = 0;
  for (const count of holeCounts) {
    const ring: Polygon = [];
    for (let k = 0; k < count && cursor + 1 < holesFlat.length; k++) {
      ring.push({ x: Number(holesFlat[cursor]) || 0, y: Number(holesFlat[cursor + 1]) || 0 });
      cursor += 2;
    }
    if (ring.length >= 3) holes.push(ring);
  }

  return {
    id: String(raw.id || `sh_${Math.random().toString(36).slice(2, 7)}`),
    name: String(raw.name || "قطعة"),
    points: points.length >= 3 ? points : [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }],
    holes,
    qty: Number(raw.qty) ?? 1,
    fill: Boolean(raw.fill),
    enabled: raw.enabled !== false,
    lockRotation: Boolean(raw.lockRotation),
    grainLock: Boolean(raw.grainLock),
    color: String(raw.color || "#10b981"),
    source: (raw.source as Shape["source"]) || "svg",
    origId: raw.origId ? String(raw.origId) : undefined,
    w: Number(raw.w) || 20,
    h: Number(raw.h) || 20,
  };
}

export async function signInWithGooglePopup(): Promise<User> {
  const provider = new GoogleAuthProvider();
  const res = await signInWithPopup(auth, provider);
  return res.user;
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}

export function subscribeToAuth(cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, cb);
}

const LOCAL_PROJECTS_KEY = "nestpro_local_projects_v2";
const LOCAL_PRESETS_KEY = "nestpro_local_presets_v2";

export function loadLocalProjects(): CloudProjectRecord[] {
  try {
    const raw = localStorage.getItem(LOCAL_PROJECTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLocalProjects(list: CloudProjectRecord[]): void {
  try {
    localStorage.setItem(LOCAL_PROJECTS_KEY, JSON.stringify(list.slice(0, 30)));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadLocalCustomPresets(): SheetPresetRecord[] {
  try {
    const raw = localStorage.getItem(LOCAL_PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLocalCustomPresets(list: SheetPresetRecord[]): void {
  try {
    localStorage.setItem(LOCAL_PRESETS_KEY, JSON.stringify(list.slice(0, 40)));
  } catch {
    // Ignore
  }
}

/**
 * Subscribe to the authenticated user's Cloud Projects in real time.
 */
export function subscribeUserProjects(
  userId: string,
  onData: (projects: CloudProjectRecord[]) => void
): () => void {
  const q = query(collection(db, "projects"), where("ownerId", "==", userId));
  return onSnapshot(
    q,
    (snap) => {
      const list: CloudProjectRecord[] = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        const ts = d.updatedAt instanceof Timestamp ? d.updatedAt.toMillis() : Date.now();
        list.push({
          id: docSnap.id,
          ownerId: String(d.ownerId),
          name: String(d.name || "مشروع بدون اسم"),
          sheetW: Number(d.sheetW) || 1000,
          sheetH: Number(d.sheetH) || 700,
          partsCount: Number(d.partsCount) || 0,
          efficiency: Number(d.efficiency) || 0,
          settings: d.settings as NestSettings,
          shapes: Array.isArray(d.shapes)
            ? d.shapes.map(deserializeShapeFromFirestore)
            : [],
          placements: Array.isArray(d.placements) ? (d.placements as Placement[]) : [],
          updatedAtMs: ts,
          isLocalOnly: false,
        });
      });
      list.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
      onData(list);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, "projects");
    }
  );
}

/**
 * Save or update a project in Cloud Firestore (and mirror in localStorage).
 */
export async function saveProjectToCloud(params: {
  projectId?: string;
  name: string;
  shapes: Shape[];
  settings: NestSettings;
  snap: NestSnapshot | null;
  efficiency: number;
}): Promise<CloudProjectRecord> {
  const cleanName = params.name.trim().slice(0, PROJECT_NAME_MAX_LEN) || "مشروع تعشيق جديد";
  const rawId =
    params.projectId && ID_REGEX.test(params.projectId)
      ? params.projectId
      : `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const partsCount = params.shapes
    .filter((s) => s.enabled)
    .reduce((acc, s) => acc + s.qty, 0);

  const boundedShapes = params.shapes.slice(0, MAX_SHAPES_COUNT);
  const boundedPlacements = (params.snap?.placements || [])
    .slice(0, MAX_PLACEMENTS_COUNT)
    .map((p) => ({
      id: String(p.id).slice(0, 80),
      shapeId: String(p.shapeId).slice(0, 80),
      sheet: Number(p.sheet) || 0,
      x: Math.round(p.x * 100) / 100,
      y: Math.round(p.y * 100) / 100,
      angle: Math.round(p.angle * 100) / 100,
      cutOrder: Number(p.cutOrder) || 1,
      isFiller: Boolean(p.isFiller),
    }));

  const localRecord: CloudProjectRecord = {
    id: rawId,
    ownerId: auth.currentUser?.uid || "local",
    name: cleanName,
    sheetW: Math.min(50000, Math.max(1, Number(params.settings.sheetW) || 1000)),
    sheetH: Math.min(50000, Math.max(1, Number(params.settings.sheetH) || 700)),
    partsCount: Math.min(100000, Math.max(0, partsCount)),
    efficiency: Math.min(100, Math.max(0, Math.round((params.efficiency || 0) * 10) / 10)),
    settings: params.settings,
    shapes: boundedShapes,
    placements: boundedPlacements,
    updatedAtMs: Date.now(),
    isLocalOnly: !auth.currentUser,
  };

  // Always save to local storage immediately for zero-latency offline backup
  const existingLocals = loadLocalProjects().filter((p) => p.id !== rawId);
  saveLocalProjects([localRecord, ...existingLocals]);

  if (auth.currentUser) {
    const docRef = doc(db, "projects", rawId);
    const serializedShapes = boundedShapes.map(serializeShapeForFirestore);
    const payloadBase = {
      ownerId: auth.currentUser.uid,
      name: localRecord.name,
      sheetW: localRecord.sheetW,
      sheetH: localRecord.sheetH,
      partsCount: localRecord.partsCount,
      efficiency: localRecord.efficiency,
      settings: {
        sheetW: params.settings.sheetW,
        sheetH: params.settings.sheetH,
        margin: params.settings.margin,
        spacing: params.settings.spacing,
        kerf: params.settings.kerf,
        rotStep: params.settings.rotStep,
        edgeAlign: params.settings.edgeAlign,
        holes: params.settings.holes,
        resolution: params.settings.resolution,
        timeBudget: params.settings.timeBudget,
        maxSheets: params.settings.maxSheets,
        strategy: params.settings.strategy,
        sheetCost: params.settings.sheetCost,
        cutSpeed: params.settings.cutSpeed,
        corelVersion: params.settings.corelVersion,
      },
      shapes: serializedShapes,
      placements: boundedPlacements,
      updatedAt: serverTimestamp(),
    };

    try {
      if (params.projectId) {
        await updateDoc(docRef, {
          name: payloadBase.name,
          sheetW: payloadBase.sheetW,
          sheetH: payloadBase.sheetH,
          partsCount: payloadBase.partsCount,
          efficiency: payloadBase.efficiency,
          settings: payloadBase.settings,
          shapes: payloadBase.shapes,
          placements: payloadBase.placements,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(docRef, {
          ...payloadBase,
          createdAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(
        error,
        params.projectId ? OperationType.UPDATE : OperationType.CREATE,
        `projects/${rawId}`
      );
    }
  }

  return localRecord;
}

export async function deleteProjectFromCloud(projectId: string): Promise<void> {
  const nextLocals = loadLocalProjects().filter((p) => p.id !== projectId);
  saveLocalProjects(nextLocals);

  if (auth.currentUser && ID_REGEX.test(projectId)) {
    try {
      await deleteDoc(doc(db, "projects", projectId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `projects/${projectId}`);
    }
  }
}

export function subscribeUserPresets(
  userId: string,
  onData: (presets: SheetPresetRecord[]) => void
): () => void {
  const q = query(collection(db, "presets"), where("ownerId", "==", userId));
  return onSnapshot(
    q,
    (snap) => {
      const list: SheetPresetRecord[] = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        list.push({
          id: docSnap.id,
          ownerId: String(d.ownerId),
          label: String(d.label),
          widthMm: Number(d.widthMm) || 1000,
          heightMm: Number(d.heightMm) || 700,
          isBuiltIn: false,
        });
      });
      onData(list);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, "presets");
    }
  );
}

export async function saveCustomSheetPreset(
  widthMm: number,
  heightMm: number,
  customLabel?: string
): Promise<SheetPresetRecord> {
  const w = Math.min(50000, Math.max(1, Math.round(widthMm)));
  const h = Math.min(50000, Math.max(1, Math.round(heightMm)));
  const label = (customLabel?.trim() || `${w} × ${h} مم`).slice(0, PRESET_LABEL_MAX_LEN);
  const presetId = `preset_${w}_${h}_${Date.now().toString(36).slice(-4)}`;

  const record: SheetPresetRecord = {
    id: presetId,
    ownerId: auth.currentUser?.uid || "local",
    label,
    widthMm: w,
    heightMm: h,
    isBuiltIn: false,
  };

  const locals = loadLocalCustomPresets().filter(
    (p) => !(p.widthMm === w && p.heightMm === h)
  );
  saveLocalCustomPresets([record, ...locals]);

  if (auth.currentUser) {
    try {
      await setDoc(doc(db, "presets", presetId), {
        ownerId: auth.currentUser.uid,
        label,
        widthMm: w,
        heightMm: h,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `presets/${presetId}`);
    }
  }

  return record;
}

export async function deleteCustomSheetPreset(presetId: string): Promise<void> {
  const locals = loadLocalCustomPresets().filter((p) => p.id !== presetId);
  saveLocalCustomPresets(locals);

  if (auth.currentUser && ID_REGEX.test(presetId)) {
    try {
      await deleteDoc(doc(db, "presets", presetId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `presets/${presetId}`);
    }
  }
}
