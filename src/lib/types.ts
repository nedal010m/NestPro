export interface Point {
  x: number;
  y: number;
}

export type Polygon = Point[];

export type ShapeSource = "corel" | "ai" | "svg" | "dxf" | "demo";

export type HostApp = "corel" | "illustrator" | "cnc";

export interface Shape {
  id: string;
  name: string;
  /** Outer contour normalized so minX = 0, minY = 0 (or centered at centroid) */
  points: Polygon;
  /** Optional inner hole polygons in the same coordinate space as points */
  holes: Polygon[];
  /** Requested quantity */
  qty: number;
  /** Fill remaining sheet space with this shape after all required parts are placed */
  fill: boolean;
  /** Whether this shape is active in the current nesting run */
  enabled: boolean;
  /** Lock rotation (0° only, e.g. for wood grain or brushed acrylic direction) */
  lockRotation?: boolean;
  /** Allow 180° flip only (grain direction lock) */
  grainLock?: boolean;
  /** Priority order (1 = highest priority, placed first; default = 2) */
  priority?: number;
  /** Visual color in preview */
  color: string;
  /** Source format */
  source: ShapeSource;
  /** Original host element tag / StaticID in CorelDRAW or Note tag in Illustrator */
  origId?: string;
  /** Original center or reference point in host document (mm) */
  origX?: number;
  origY?: number;
  /** Cached bounding box width (mm) */
  w: number;
  /** Cached bounding box height (mm) */
  h: number;
}

export type PlacementStrategy = "gravity-bl" | "gravity-tl" | "squeeze" | "box-compact";

export interface NestSettings {
  /** Sheet width in mm */
  sheetW: number;
  /** Sheet height in mm */
  sheetH: number;
  /** Margin from sheet edges in mm */
  margin: number;
  /** Minimum spacing between parts in mm */
  spacing: number;
  /** Laser/CNC kerf compensation in mm (added to spacing or exported offset) */
  kerf: number;
  /** Rotation step in degrees (e.g. 1, 2, 5, 10, 15, 45, 90, 180, 360) */
  rotStep: number;
  /** Automatically detect polygon straight edges and add their angles to candidate rotations */
  edgeAlign: boolean;
  /** Allow nesting smaller parts inside inner holes of larger parts */
  holes: boolean;
  /** Rasterization grid resolution along the longest sheet dimension (cells) */
  resolution: number;
  /** Optimization time budget in seconds (0 = single fast pass) */
  timeBudget: number;
  /** Maximum number of sheets to allocate */
  maxSheets: number;
  /** Placement gravity direction / heuristic */
  strategy: PlacementStrategy;
  /** Sheet material cost (for cost & waste estimation) */
  sheetCost: number;
  /** Cutting speed in mm/s (for laser/CNC time estimation) */
  cutSpeed: number;
  /** CorelDRAW version target for VBA / VBS macro generation */
  corelVersion: "2024-2026" | "2020-2023" | "X7-2019";
}

export interface Placement {
  /** Unique placement instance id */
  id: string;
  shapeId: string;
  sheet: number;
  /** Translation X on sheet (mm) applied after rotating shape around (0,0) */
  x: number;
  /** Translation Y on sheet (mm) applied after rotating shape around (0,0) */
  y: number;
  /** Clockwise rotation angle in degrees */
  angle: number;
  /** Cut sequence order on the sheet (1-indexed) */
  cutOrder?: number;
  /** Whether placed as a filler part */
  isFiller?: boolean;
}

export interface UnplacedItem {
  shapeId: string;
  count: number;
}

export interface NestSnapshot {
  sheets: number;
  placements: Placement[];
  unplaced: UnplacedItem[];
  trials: number;
  /** Used bounding box width on the active sheets (mm) */
  usedWidthMm?: number;
  /** Used bounding box height on the active sheets (mm) */
  usedHeightMm?: number;
}

export type WorkerIn = {
  type: "start";
  shapes: Shape[];
  settings: NestSettings;
};

export type WorkerOut =
  | { type: "progress"; pct: number; msg: string }
  | { type: "best"; snap: NestSnapshot; elapsed: number; trials: number }
  | { type: "done"; snap: NestSnapshot; elapsed: number; trials: number }
  | { type: "error"; msg: string };
