export interface WorldPoint {
  readonly x: number;
  readonly z: number;
}

export interface UvttResolution {
  /** All parsed maps use a world-space origin of zero. */
  readonly mapOrigin: WorldPoint;
  readonly mapSize: WorldPoint;
  readonly pixelsPerGrid: number | null;
}

export interface UvttPortal {
  readonly position: WorldPoint;
  readonly bounds: readonly [WorldPoint, WorldPoint];
  readonly rotation: number | null;
  readonly closed: boolean | null;
  readonly freestanding: boolean | null;
}

export interface UvttLight {
  readonly position: WorldPoint;
  readonly range: number;
  readonly intensity: number;
  /** Normalized eight-digit RGBA hex, without a leading '#'. */
  readonly color: string;
  readonly shadows: boolean | null;
}

export interface UvttEnvironment {
  readonly bakedLighting: boolean | null;
  /** Normalized eight-digit RGBA hex, without a leading '#'. */
  readonly ambientLight: string | null;
}

export interface UvttMap {
  readonly ok: true;
  readonly format: number | null;
  readonly resolution: UvttResolution;
  readonly lineOfSight: readonly (readonly WorldPoint[])[];
  readonly objectsLineOfSight: readonly (readonly WorldPoint[])[];
  readonly portals: readonly UvttPortal[];
  readonly lights: readonly UvttLight[];
  readonly environment: UvttEnvironment | null;
  readonly image: string | null;
}

export type UvttErrorCode =
  | 'INVALID_JSON'
  | 'INVALID_INPUT'
  | 'MISSING_RESOLUTION'
  | 'INVALID_RESOLUTION'
  | 'INVALID_LINE_OF_SIGHT'
  | 'INVALID_FIELD';

export interface UvttError {
  readonly ok: false;
  readonly code: UvttErrorCode;
  readonly message: string;
  readonly path?: string;
}

export interface WallSegmentOptions {
  readonly height?: number;
  readonly thickness?: number;
}

export interface WallSegment {
  readonly ax: number;
  readonly az: number;
  readonly bx: number;
  readonly bz: number;
  readonly height: number;
  readonly thickness: number;
}

export interface SceneLight {
  readonly x: number;
  readonly z: number;
  readonly range: number;
  readonly intensity: number;
  /** RGB as a Three.js-compatible numeric hex value. */
  readonly colorHex: number;
}

type UnknownRecord = Record<string, unknown>;

const GEOMETRY_EPSILON = 1e-6;
const DEFAULT_WALL_HEIGHT = 2.5;
const DEFAULT_WALL_THICKNESS = 0.15;

function error(code: UvttErrorCode, message: string, path?: string): UvttError {
  return path === undefined ? { ok: false, code, message } : { ok: false, code, message, path };
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isUvttError(value: unknown): value is UvttError {
  return isRecord(value) && value.ok === false && typeof value.code === 'string';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readPoint(value: unknown, path: string): { x: number; y: number } | UvttError {
  if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) {
    return error('INVALID_FIELD', `Expected ${path} to contain finite numeric x and y values`, path);
  }

  return { x: value.x, y: value.y };
}

function normalizePoint(point: { x: number; y: number }, origin: { x: number; y: number }): WorldPoint {
  return { x: point.x - origin.x, z: point.y - origin.y };
}

function readPolylineArray(
  value: unknown,
  path: string,
  origin: { x: number; y: number },
  code: UvttErrorCode = 'INVALID_FIELD',
): readonly (readonly WorldPoint[])[] | UvttError {
  if (!Array.isArray(value)) {
    return error(code, `Expected ${path} to be an array of polylines`, path);
  }

  const polylines: WorldPoint[][] = [];
  for (let polylineIndex = 0; polylineIndex < value.length; polylineIndex += 1) {
    const rawPolyline: unknown = value[polylineIndex];
    if (!Array.isArray(rawPolyline)) {
      return error(code, `Expected ${path}[${polylineIndex}] to be an array`, `${path}[${polylineIndex}]`);
    }

    const polyline: WorldPoint[] = [];
    for (let pointIndex = 0; pointIndex < rawPolyline.length; pointIndex += 1) {
      const pointPath = `${path}[${polylineIndex}][${pointIndex}]`;
      const point = readPoint(rawPolyline[pointIndex], pointPath);
      if (!('x' in point)) {
        return error(code, point.message, point.path);
      }
      polyline.push(normalizePoint(point, origin));
    }
    polylines.push(polyline);
  }

  return polylines;
}

function optionalNumber(value: unknown, path: string): number | null | UvttError {
  if (value === undefined) {
    return null;
  }
  return isFiniteNumber(value)
    ? value
    : error('INVALID_FIELD', `Expected ${path} to be a finite number`, path);
}

function optionalBoolean(value: unknown, path: string): boolean | null | UvttError {
  if (value === undefined) {
    return null;
  }
  return typeof value === 'boolean'
    ? value
    : error('INVALID_FIELD', `Expected ${path} to be a boolean`, path);
}

function normalizeRgbaHex(value: unknown, path: string): string | UvttError {
  if (typeof value !== 'string') {
    return error('INVALID_FIELD', `Expected ${path} to be an RGBA hex string`, path);
  }

  const withoutHash = value.startsWith('#') ? value.slice(1) : value;
  if (!/^[0-9a-fA-F]{8}$/.test(withoutHash)) {
    return error('INVALID_FIELD', `Expected ${path} to contain exactly eight hex digits`, path);
  }
  return withoutHash.toLowerCase();
}

function readPortals(
  value: unknown,
  origin: { x: number; y: number },
): readonly UvttPortal[] | UvttError {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return error('INVALID_FIELD', 'Expected portals to be an array', 'portals');
  }

  const portals: UvttPortal[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const rawPortal = value[index];
    const portalPath = `portals[${index}]`;
    if (!isRecord(rawPortal)) {
      return error('INVALID_FIELD', `Expected ${portalPath} to be an object`, portalPath);
    }

    const position = readPoint(rawPortal.position, `${portalPath}.position`);
    if (!('x' in position)) {
      return position;
    }
    if (!Array.isArray(rawPortal.bounds) || rawPortal.bounds.length !== 2) {
      return error(
        'INVALID_FIELD',
        `Expected ${portalPath}.bounds to contain exactly two points`,
        `${portalPath}.bounds`,
      );
    }
    const firstBound = readPoint(rawPortal.bounds[0], `${portalPath}.bounds[0]`);
    if (!('x' in firstBound)) {
      return firstBound;
    }
    const secondBound = readPoint(rawPortal.bounds[1], `${portalPath}.bounds[1]`);
    if (!('x' in secondBound)) {
      return secondBound;
    }

    const rotation = optionalNumber(rawPortal.rotation, `${portalPath}.rotation`);
    if (typeof rotation === 'object' && rotation !== null) {
      return rotation;
    }
    const closed = optionalBoolean(rawPortal.closed, `${portalPath}.closed`);
    if (typeof closed === 'object' && closed !== null) {
      return closed;
    }
    const freestanding = optionalBoolean(rawPortal.freestanding, `${portalPath}.freestanding`);
    if (typeof freestanding === 'object' && freestanding !== null) {
      return freestanding;
    }

    portals.push({
      position: normalizePoint(position, origin),
      bounds: [normalizePoint(firstBound, origin), normalizePoint(secondBound, origin)],
      rotation,
      closed,
      freestanding,
    });
  }
  return portals;
}

function readLights(
  value: unknown,
  origin: { x: number; y: number },
): readonly UvttLight[] | UvttError {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return error('INVALID_FIELD', 'Expected lights to be an array', 'lights');
  }

  const lights: UvttLight[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const rawLight = value[index];
    const lightPath = `lights[${index}]`;
    if (!isRecord(rawLight)) {
      return error('INVALID_FIELD', `Expected ${lightPath} to be an object`, lightPath);
    }

    const position = readPoint(rawLight.position, `${lightPath}.position`);
    if (!('x' in position)) {
      return position;
    }
    if (!isFiniteNumber(rawLight.range) || !isFiniteNumber(rawLight.intensity)) {
      return error(
        'INVALID_FIELD',
        `Expected ${lightPath}.range and ${lightPath}.intensity to be finite numbers`,
        lightPath,
      );
    }
    const color = normalizeRgbaHex(rawLight.color, `${lightPath}.color`);
    if (typeof color !== 'string') {
      return color;
    }
    const shadows = optionalBoolean(rawLight.shadows, `${lightPath}.shadows`);
    if (typeof shadows === 'object' && shadows !== null) {
      return shadows;
    }

    lights.push({
      position: normalizePoint(position, origin),
      range: rawLight.range,
      intensity: rawLight.intensity,
      color,
      shadows,
    });
  }
  return lights;
}

function readEnvironment(value: unknown): UvttEnvironment | null | UvttError {
  if (value === undefined) {
    return null;
  }
  if (!isRecord(value)) {
    return error('INVALID_FIELD', 'Expected environment to be an object', 'environment');
  }

  const bakedLighting = optionalBoolean(value.baked_lighting, 'environment.baked_lighting');
  if (typeof bakedLighting === 'object' && bakedLighting !== null) {
    return bakedLighting;
  }
  let ambientLight: string | null = null;
  if (value.ambient_light !== undefined) {
    const parsedAmbientLight = normalizeRgbaHex(value.ambient_light, 'environment.ambient_light');
    if (typeof parsedAmbientLight !== 'string') {
      return parsedAmbientLight;
    }
    ambientLight = parsedAmbientLight;
  }

  return { bakedLighting, ambientLight };
}

/** Parse a UVTT object or JSON string into normalized world-space data. */
export function parse(json: unknown): UvttMap | UvttError {
  let input = json;
  if (typeof json === 'string') {
    try {
      input = JSON.parse(json) as unknown;
    } catch {
      return error('INVALID_JSON', 'Input is not valid JSON');
    }
  }

  if (!isRecord(input)) {
    return error('INVALID_INPUT', 'Expected UVTT input to be a JSON object');
  }
  if (input.resolution === undefined) {
    return error('MISSING_RESOLUTION', 'UVTT input is missing resolution', 'resolution');
  }
  if (!isRecord(input.resolution)) {
    return error('INVALID_RESOLUTION', 'Expected resolution to be an object', 'resolution');
  }

  const rawOrigin = readPoint(input.resolution.map_origin, 'resolution.map_origin');
  if (!('x' in rawOrigin)) {
    return error('INVALID_RESOLUTION', rawOrigin.message, rawOrigin.path);
  }
  const rawMapSize = readPoint(input.resolution.map_size, 'resolution.map_size');
  if (!('x' in rawMapSize)) {
    return error('INVALID_RESOLUTION', rawMapSize.message, rawMapSize.path);
  }
  if (rawMapSize.x < 0 || rawMapSize.y < 0) {
    return error('INVALID_RESOLUTION', 'Expected map_size dimensions to be non-negative', 'resolution.map_size');
  }
  const pixelsPerGrid = optionalNumber(
    input.resolution.pixels_per_grid,
    'resolution.pixels_per_grid',
  );
  if (typeof pixelsPerGrid === 'object' && pixelsPerGrid !== null) {
    return error('INVALID_RESOLUTION', pixelsPerGrid.message, pixelsPerGrid.path);
  }
  if (pixelsPerGrid !== null && pixelsPerGrid <= 0) {
    return error(
      'INVALID_RESOLUTION',
      'Expected resolution.pixels_per_grid to be positive',
      'resolution.pixels_per_grid',
    );
  }

  const lineOfSight = readPolylineArray(
    input.line_of_sight,
    'line_of_sight',
    rawOrigin,
    'INVALID_LINE_OF_SIGHT',
  );
  if (isUvttError(lineOfSight)) {
    return lineOfSight;
  }
  const objectsLineOfSight = readPolylineArray(
    input.objects_line_of_sight ?? [],
    'objects_line_of_sight',
    rawOrigin,
  );
  if (isUvttError(objectsLineOfSight)) {
    return objectsLineOfSight;
  }
  const portals = readPortals(input.portals, rawOrigin);
  if (isUvttError(portals)) {
    return portals;
  }
  const lights = readLights(input.lights, rawOrigin);
  if (isUvttError(lights)) {
    return lights;
  }
  const environment = readEnvironment(input.environment);
  if (environment !== null && 'ok' in environment) {
    return environment;
  }

  const format = optionalNumber(input.format, 'format');
  if (typeof format === 'object' && format !== null) {
    return format;
  }
  if (input.image !== undefined && typeof input.image !== 'string') {
    return error('INVALID_FIELD', 'Expected image to be a base64 string', 'image');
  }

  return {
    ok: true,
    format,
    resolution: {
      mapOrigin: { x: 0, z: 0 },
      mapSize: { x: rawMapSize.x, z: rawMapSize.y },
      pixelsPerGrid,
    },
    lineOfSight,
    objectsLineOfSight,
    portals,
    lights,
    environment,
    image: input.image ?? null,
  };
}

function distanceFromLine(point: WorldPoint, start: WorldPoint, dx: number, dz: number): number {
  return Math.abs(dx * (start.z - point.z) - (start.x - point.x) * dz) / Math.hypot(dx, dz);
}

function pointAt(start: WorldPoint, dx: number, dz: number, distanceRatio: number): WorldPoint {
  return { x: start.x + dx * distanceRatio, z: start.z + dz * distanceRatio };
}

function portalInterval(
  portal: UvttPortal,
  start: WorldPoint,
  dx: number,
  dz: number,
  lengthSquared: number,
): readonly [number, number] | null {
  const [first, second] = portal.bounds;
  if (
    distanceFromLine(first, start, dx, dz) > GEOMETRY_EPSILON
    || distanceFromLine(second, start, dx, dz) > GEOMETRY_EPSILON
  ) {
    return null;
  }

  const project = (point: WorldPoint): number => (
    ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared
  );
  const lower = Math.max(0, Math.min(project(first), project(second)));
  const upper = Math.min(1, Math.max(project(first), project(second)));
  return upper - lower > GEOMETRY_EPSILON ? [lower, upper] : null;
}

/** Convert line-of-sight polylines into wall boxes, subtracting portal gaps. */
export function toWallSegments(map: UvttMap, opts: WallSegmentOptions = {}): WallSegment[] {
  const height = opts.height ?? DEFAULT_WALL_HEIGHT;
  const thickness = opts.thickness ?? DEFAULT_WALL_THICKNESS;
  const segments: WallSegment[] = [];

  for (const polyline of map.lineOfSight) {
    for (let index = 1; index < polyline.length; index += 1) {
      const start = polyline[index - 1];
      const end = polyline[index];
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const lengthSquared = dx * dx + dz * dz;
      if (lengthSquared <= GEOMETRY_EPSILON * GEOMETRY_EPSILON) {
        continue;
      }

      const gaps = map.portals
        .map((portal) => portalInterval(portal, start, dx, dz, lengthSquared))
        .filter((interval): interval is readonly [number, number] => interval !== null)
        .sort((left, right) => left[0] - right[0]);

      let cursor = 0;
      for (const [gapStart, gapEnd] of gaps) {
        if (gapStart - cursor > GEOMETRY_EPSILON) {
          const wallStart = pointAt(start, dx, dz, cursor);
          const wallEnd = pointAt(start, dx, dz, gapStart);
          segments.push({
            ax: wallStart.x,
            az: wallStart.z,
            bx: wallEnd.x,
            bz: wallEnd.z,
            height,
            thickness,
          });
        }
        cursor = Math.max(cursor, gapEnd);
      }

      if (1 - cursor > GEOMETRY_EPSILON) {
        const wallStart = pointAt(start, dx, dz, cursor);
        segments.push({
          ax: wallStart.x,
          az: wallStart.z,
          bx: end.x,
          bz: end.z,
          height,
          thickness,
        });
      }
    }
  }

  return segments;
}

/** Convert normalized UVTT lights into renderer-friendly scene lights. */
export function toLights(map: UvttMap): SceneLight[] {
  return map.lights.map((light) => ({
    x: light.position.x,
    z: light.position.z,
    range: light.range,
    intensity: light.intensity,
    colorHex: Number.parseInt(light.color.slice(0, 6), 16),
  }));
}

/** Decode the map image without relying on Node's Buffer API. */
export function imageBlob(map: UvttMap): Uint8Array | null {
  if (map.image === null) {
    return null;
  }

  const commaIndex = map.image.indexOf(',');
  const base64 = map.image.startsWith('data:') && commaIndex >= 0
    ? map.image.slice(commaIndex + 1)
    : map.image;
  try {
    const decoded = atob(base64.replace(/\s/g, ''));
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1) {
      bytes[index] = decoded.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}
