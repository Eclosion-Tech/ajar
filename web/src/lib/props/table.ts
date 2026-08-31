import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  Matrix4,
  Shape,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { jitter, mulberry32, type Rng } from './rng';
import { shade, woodTone } from './palette';

export type TableParams = {
  shape: 'round' | 'rect';
  /** Rect: x span. Round: diameter. World units (1 = one grid square). */
  width: number;
  /** Rect only: z span. */
  depth: number;
  height: number;
  /** Palette index into WOOD_TONES. */
  wood: number;
};

export function normalizeTableParams(raw: unknown): TableParams {
  const p = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<TableParams>;
  const clamp = (v: unknown, lo: number, hi: number, dflt: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt;
  return {
    shape: p.shape === 'round' ? 'round' : 'rect',
    width: clamp(p.width, 0.5, 4, 1.8),
    depth: clamp(p.depth, 0.5, 4, 0.9),
    height: clamp(p.height, 0.5, 1.1, 0.75),
    wood: clamp(p.wood, 0, 3, 0),
  };
}

/** Paint every vertex of a geometry one flat color. */
function paint(geometry: BufferGeometry, hex: number): BufferGeometry {
  const c = new Color(hex);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}

/** Per-piece tone wobble so the wood doesn't read as machine-uniform. */
const worn = (rng: Rng, hex: number) => shade(hex, 1 + jitter(rng, 0.05));

/** Scale UVs so the tiling grain texture keeps uniform density across pieces. */
function scaleUV(geometry: BufferGeometry, s: number, t: number): void {
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i += 1) {
    uv.setXY(i, uv.getX(i) * s, uv.getY(i) * t);
  }
}

/** Shift UVs so each board samples a different stretch of the grain. */
function offsetUV(geometry: BufferGeometry, du: number, dv: number): void {
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i += 1) {
    uv.setXY(i, uv.getX(i) + du, uv.getY(i) + dv);
  }
}

/** Split a span into seeded board widths (with a hair of gap between). */
function boardWidths(rng: Rng, span: number): number[] {
  const widths: number[] = [];
  let used = 0;
  while (used < span - 0.05) {
    const w = Math.min(0.13 + rng() * 0.11, span - used);
    widths.push(w);
    used += w;
  }
  if (widths.length > 0) widths[widths.length - 1] += span - used;
  return widths;
}

const BOARD_GAP = 0.007;
const END_GAP = 0.01;
const MAX_SECTION = 1.35;

/** Split a board's length into end-jointed sections; seeded per board, so
 * joints stagger naturally across neighboring boards. */
function sectionLengths(rng: Rng, length: number): number[] {
  if (length <= MAX_SECTION) return [length];
  const sections: number[] = [];
  let remaining = length;
  while (remaining > MAX_SECTION) {
    const s = 0.65 + rng() * 0.6;
    sections.push(s);
    remaining -= s;
  }
  if (remaining < 0.3 && sections.length > 0) {
    sections[sections.length - 1] += remaining;
  } else {
    sections.push(remaining);
  }
  return sections;
}

/**
 * A board cut to a circle: a strip from z0..z1 whose ends follow the arc.
 * Extruded in XY then rotated flat; arc sampled coarsely so the rim stays
 * faceted in-style.
 */
function roundBoard(z0: number, z1: number, radius: number, thickness: number): BufferGeometry {
  const X = (z: number) => Math.sqrt(Math.max(0.0009, radius * radius - z * z));
  const N = 5;
  const shape = new Shape();
  shape.moveTo(X(z0), z0);
  for (let i = 1; i <= N; i += 1) {
    const z = z0 + ((z1 - z0) * i) / N;
    shape.lineTo(X(z), z);
  }
  for (let i = 0; i <= N; i += 1) {
    const z = z1 + ((z0 - z1) * i) / N;
    shape.lineTo(-X(z), z);
  }
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/**
 * A tabletop as actual carpentry: boards laid along the long axis, each with
 * its own width, tone, grain offset, hair-height offset, and slightly
 * staggered ends. Round tops clip board lengths to the circle's chords,
 * giving a stepped rustic edge. A near-black underlayer catches gap
 * sightlines so seams read as shadow.
 */
function buildPlankedTop(
  shape: 'round' | 'rect',
  width: number,
  depth: number,
  thickness: number,
  height: number,
  tone: number,
  rng: Rng,
  pieces: BufferGeometry[],
): void {
  const alongX = shape === 'round' || width >= depth;
  const span = shape === 'round' ? width : alongX ? depth : width;
  const radius = width / 2;
  const y = height - thickness / 2;

  const under =
    shape === 'round'
      ? new CylinderGeometry(radius * 0.97, radius * 0.97, thickness * 0.5, 14)
      : new BoxGeometry((alongX ? width : depth) * 0.985, thickness * 0.5, span * 0.985);
  if (shape !== 'round' && !alongX) under.applyMatrix4(new Matrix4().makeRotationY(Math.PI / 2));
  under.applyMatrix4(new Matrix4().setPosition(0, y - thickness * 0.25, 0));
  pieces.push(paint(under, shade(tone, 0.28)));

  const widths = boardWidths(rng, span);
  let cursor = -span / 2;
  for (const bw of widths) {
    const center = cursor + bw / 2;
    cursor += bw;

    const boardTone = shade(tone, 1 + jitter(rng, 0.07));
    const boardY = y + jitter(rng, 0.0035);

    if (shape === 'round') {
      // Full-length boards cut to the circle's arc — the top was assembled
      // square and sawn round, like real carpentry.
      const z0 = Math.max(-radius + 0.01, center - bw / 2 + BOARD_GAP / 2);
      const z1 = Math.min(radius - 0.01, center + bw / 2 - BOARD_GAP / 2);
      if (z1 - z0 < 0.03) continue;
      const board = roundBoard(z0, z1, radius * 0.995, thickness);
      offsetUV(board, rng() * 4, rng() * 4);
      board.applyMatrix4(new Matrix4().setPosition(jitter(rng, 0.004), boardY - thickness / 2, 0));
      pieces.push(paint(board, worn(rng, boardTone)));
      continue;
    }

    const length = (alongX ? width : depth) * (0.99 + jitter(rng, 0.01));
    let along = -length / 2;
    for (const sec of sectionLengths(rng, length)) {
      const secCenter = along + sec / 2;
      along += sec;
      const section = new BoxGeometry(Math.max(0.05, sec - END_GAP), thickness, Math.max(0.04, bw - BOARD_GAP));
      scaleUV(section, Math.max(1, sec), 0.35);
      offsetUV(section, rng() * 4, rng() * 4);
      section.applyMatrix4(
        new Matrix4()
          .makeRotationY(alongX ? 0 : Math.PI / 2)
          .setPosition(
            alongX ? secCenter : center,
            boardY + jitter(rng, 0.0015),
            alongX ? center : secCenter,
          ),
      );
      pieces.push(paint(section, worn(rng, boardTone)));
    }
  }
}

/**
 * Subtle per-triangle brightness variation on non-indexed geometry — the
 * low-poly faceted patchwork read. Deterministic via the shared rng.
 */
function facetJitter(geometry: BufferGeometry, rng: Rng, amount: number): void {
  const color = geometry.getAttribute('color');
  for (let tri = 0; tri < color.count / 3; tri += 1) {
    const f = 1 + jitter(rng, amount);
    for (let v = 0; v < 3; v += 1) {
      const i = tri * 3 + v;
      color.setXYZ(
        i,
        Math.min(1, color.getX(i) * f),
        Math.min(1, color.getY(i) * f),
        Math.min(1, color.getZ(i) * f),
      );
    }
  }
}

export function buildTable(params: TableParams, seed: number): BufferGeometry {
  const rng = mulberry32(seed);
  const { shape, width, depth, height, wood } = params;
  const tone = woodTone(wood);
  const legTone = shade(tone, 0.78);
  const topThickness = 0.06;
  const pieces: BufferGeometry[] = [];

  // Top as actual carpentry — individual boards, not a veneer slab.
  buildPlankedTop(shape, width, depth, topThickness, height, tone, rng, pieces);

  const underHeight = height - topThickness;

  if (shape === 'round') {
    // Pedestal + splayed angular base, tavern-style.
    const pedestal = new CylinderGeometry(0.07, 0.1, underHeight, 7);
    pedestal.applyMatrix4(new Matrix4().setPosition(0, underHeight / 2, 0));
    pieces.push(paint(pedestal, worn(rng, legTone)));

    const base = new CylinderGeometry(Math.min(0.3, width * 0.28), Math.min(0.34, width * 0.32), 0.05, 9);
    base.applyMatrix4(new Matrix4().setPosition(0, 0.025, 0));
    pieces.push(paint(base, worn(rng, shade(legTone, 0.9))));
  } else {
    // Apron under the top.
    const apron = new BoxGeometry(width - 0.24, 0.08, depth - 0.24);
    apron.applyMatrix4(new Matrix4().setPosition(0, underHeight - 0.05, 0));
    pieces.push(paint(apron, worn(rng, legTone)));

    // Four legs, inset, each with a seeded lean — wear, not wonk.
    const legW = 0.09;
    const ix = width / 2 - 0.14;
    const iz = depth / 2 - 0.14;
    for (const [sx, sz] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const) {
      const leg = new BoxGeometry(legW, underHeight, legW);
      leg.applyMatrix4(
        new Matrix4()
          .makeRotationZ(jitter(rng, 0.018))
          .multiply(new Matrix4().makeRotationX(jitter(rng, 0.018)))
          .setPosition(sx * ix + jitter(rng, 0.012), underHeight / 2, sz * iz + jitter(rng, 0.012)),
      );
      pieces.push(paint(leg, worn(rng, legTone)));
    }
  }

  const indexed = mergeGeometries(pieces, false) ?? new BufferGeometry();
  for (const piece of pieces) piece.dispose();
  // Non-indexed: flat shading wants split vertices anyway, per-triangle facet
  // jitter needs them, and it removes the index buffer from the GPU path.
  const merged = indexed.index ? indexed.toNonIndexed() : indexed;
  if (merged !== indexed) indexed.dispose();
  facetJitter(merged, rng, 0.045);
  return merged;
}
