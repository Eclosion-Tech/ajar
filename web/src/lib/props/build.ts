import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ExtrudeGeometry,
  Shape,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { jitter, type Rng } from './rng';
import { shade } from './palette';

export const BOARD_GAP = 0.007;
export const END_GAP = 0.006;
const MAX_SECTION = 1.35;

/** Paint every vertex of a geometry one flat color. */
export function paint(geometry: BufferGeometry, hex: number): BufferGeometry {
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
export const worn = (rng: Rng, hex: number) => shade(hex, 1 + jitter(rng, 0.05));

/** Scale UVs so the tiling grain texture keeps uniform density across pieces. */
export function scaleUV(geometry: BufferGeometry, s: number, t: number): void {
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i += 1) {
    uv.setXY(i, uv.getX(i) * s, uv.getY(i) * t);
  }
}

/** Shift UVs so each board samples a different stretch of the grain. */
export function offsetUV(geometry: BufferGeometry, du: number, dv: number): void {
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i += 1) {
    uv.setXY(i, uv.getX(i) + du, uv.getY(i) + dv);
  }
}

/** Split a span into seeded board widths (with a hair of gap between). */
export function boardWidths(rng: Rng, span: number): number[] {
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

/** Split a board's length into end-jointed sections. */
export function sectionLengths(rng: Rng, length: number): number[] {
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

/** A board cut to a circle, extruded and rotated to lie flat in XZ. */
export function roundBoard(
  z0: number,
  z1: number,
  radius: number,
  thickness: number,
): BufferGeometry {
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

/** Subtle per-triangle brightness variation on non-indexed geometry. */
export function facetJitter(geometry: BufferGeometry, rng: Rng, amount: number): void {
  const color = geometry.getAttribute('color');
  if (!color) return;
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

/** Merge construction pieces into the flat-shaded, non-indexed house format. */
export function mergePropPieces(
  pieces: BufferGeometry[],
  rng: Rng,
  facetAmount = 0.045,
): BufferGeometry {
  const flattened = pieces.map((piece) => {
    if (!piece.index) return piece;
    const nonIndexed = piece.toNonIndexed();
    piece.dispose();
    return nonIndexed;
  });
  const merged = mergeGeometries(flattened, false) ?? new BufferGeometry();
  for (const piece of flattened) piece.dispose();
  facetJitter(merged, rng, facetAmount);
  return merged;
}
