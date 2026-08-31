import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Matrix4,
} from 'three';
import { jitter, mulberry32, type Rng } from './rng';
import { shade, woodTone } from './palette';
import {
  BOARD_GAP,
  END_GAP,
  boardWidths,
  mergePropPieces,
  offsetUV,
  paint,
  roundBoard,
  scaleUV,
  sectionLengths,
  worn,
} from './build';

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
  pieces.push(paint(under, shade(tone, 0.52)));

  const widths = boardWidths(rng, span);
  let cursor = -span / 2;
  for (const bw of widths) {
    const center = cursor + bw / 2;
    cursor += bw;

    const boardTone = shade(tone, 1 + jitter(rng, 0.07));
    const boardY = y + jitter(rng, 0.002);

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

  // Normalize every piece to non-indexed BEFORE merging — mergeGeometries
  // refuses to mix indexed (Box/Cylinder) with non-indexed (Extrude) inputs.
  // Non-indexed is what we want anyway: flat shading uses split vertices and
  // the per-triangle facet jitter needs them.
  return mergePropPieces(pieces, rng);
}
