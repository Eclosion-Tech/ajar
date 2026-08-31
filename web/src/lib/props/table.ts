import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Matrix4,
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

  // Top — a 9-segment cylinder keeps the round top angular, not smooth.
  const top =
    shape === 'round'
      ? new CylinderGeometry(width / 2, width / 2, topThickness, 9)
      : new BoxGeometry(width, topThickness, depth);
  scaleUV(top, Math.max(1, width), Math.max(1, shape === 'round' ? width : depth));
  top.applyMatrix4(
    new Matrix4()
      .makeRotationY(shape === 'round' ? jitter(rng, Math.PI / 9) : 0)
      .setPosition(0, height - topThickness / 2, 0),
  );
  pieces.push(paint(top, worn(rng, tone)));

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
