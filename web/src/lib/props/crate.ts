import { BoxGeometry, BufferGeometry, Matrix4 } from 'three';
import {
  BOARD_GAP,
  END_GAP,
  boardWidths,
  mergePropPieces,
  offsetUV,
  paint,
  scaleUV,
  sectionLengths,
  worn,
} from './build';
import { shade, woodTone } from './palette';
import { jitter, mulberry32, type Rng } from './rng';

export type CrateParams = {
  width: number;
  depth: number;
  height: number;
  wood: number;
};

export function normalizeCrateParams(raw: unknown): CrateParams {
  const p = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<CrateParams>;
  const clamp = (v: unknown, lo: number, hi: number, dflt: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt;
  return {
    width: clamp(p.width, 0.3, 1.5, 0.72),
    depth: clamp(p.depth, 0.3, 1.5, 0.56),
    height: clamp(p.height, 0.3, 1.5, 0.55),
    wood: clamp(p.wood, 0, 3, 0),
  };
}

function finishBoard(
  geometry: BufferGeometry,
  rng: Rng,
  tone: number,
  grainLength: number,
): BufferGeometry {
  scaleUV(geometry, Math.max(0.35, grainLength), 0.35);
  offsetUV(geometry, rng() * 4, rng() * 4);
  return paint(geometry, worn(rng, tone));
}

function addSidePanel(
  axis: 'x' | 'z',
  length: number,
  height: number,
  fixed: number,
  tone: number,
  rng: Rng,
  pieces: BufferGeometry[],
): void {
  const thickness = 0.035;
  const under = new BoxGeometry(
    axis === 'x' ? length * 0.98 : thickness * 0.45,
    height * 0.98,
    axis === 'x' ? thickness * 0.45 : length * 0.98,
  );
  under.applyMatrix4(
    new Matrix4().setPosition(axis === 'x' ? 0 : fixed, height / 2, axis === 'x' ? fixed : 0),
  );
  pieces.push(paint(under, shade(tone, 0.52)));

  let y = 0;
  for (const boardHeight of boardWidths(rng, height)) {
    const boardY = y + boardHeight / 2;
    y += boardHeight;
    let along = -length / 2;
    for (const sectionLength of sectionLengths(rng, length)) {
      const sectionCenter = along + sectionLength / 2;
      along += sectionLength;
      const board = new BoxGeometry(
        Math.max(0.05, sectionLength - END_GAP),
        Math.max(0.04, boardHeight - BOARD_GAP),
        thickness,
      );
      board.applyMatrix4(
        new Matrix4()
          .makeRotationY(axis === 'x' ? 0 : Math.PI / 2)
          .setPosition(
            axis === 'x' ? sectionCenter : fixed + jitter(rng, 0.0015),
            boardY + jitter(rng, 0.002),
            axis === 'x' ? fixed + jitter(rng, 0.0015) : sectionCenter,
          ),
      );
      pieces.push(finishBoard(board, rng, tone, sectionLength));
    }
  }
}

function addPlankedTop(
  width: number,
  depth: number,
  height: number,
  tone: number,
  rng: Rng,
  pieces: BufferGeometry[],
): void {
  const thickness = 0.045;
  const under = new BoxGeometry(width * 0.98, thickness * 0.45, depth * 0.98);
  under.applyMatrix4(new Matrix4().setPosition(0, height - thickness * 0.75, 0));
  pieces.push(paint(under, shade(tone, 0.52)));

  let z = -depth / 2;
  for (const boardWidth of boardWidths(rng, depth)) {
    const boardZ = z + boardWidth / 2;
    z += boardWidth;
    let x = -width / 2;
    for (const sectionLength of sectionLengths(rng, width)) {
      const sectionX = x + sectionLength / 2;
      x += sectionLength;
      const board = new BoxGeometry(
        Math.max(0.05, sectionLength - END_GAP),
        thickness,
        Math.max(0.04, boardWidth - BOARD_GAP),
      );
      board.applyMatrix4(
        new Matrix4().setPosition(
          sectionX,
          height - thickness / 2 + jitter(rng, 0.002),
          boardZ + jitter(rng, 0.0015),
        ),
      );
      pieces.push(finishBoard(board, rng, shade(tone, 0.96), sectionLength));
    }
  }
}

export function buildCrate(params: CrateParams, seed: number): BufferGeometry {
  const rng = mulberry32(seed);
  const { width, depth, height } = params;
  const tone = woodTone(params.wood);
  const pieces: BufferGeometry[] = [];
  const topThickness = 0.045;
  const bodyHeight = height - topThickness;
  const panelInset = 0.0175;

  addSidePanel('x', width, bodyHeight, depth / 2 - panelInset, tone, rng, pieces);
  addSidePanel('x', width, bodyHeight, -depth / 2 + panelInset, tone, rng, pieces);
  addSidePanel('z', depth, bodyHeight, width / 2 - panelInset, tone, rng, pieces);
  addSidePanel('z', depth, bodyHeight, -width / 2 + panelInset, tone, rng, pieces);

  const postSize = Math.min(0.07, Math.max(0.052, Math.min(width, depth) * 0.13));
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      const post = new BoxGeometry(postSize, bodyHeight, postSize);
      post.applyMatrix4(
        new Matrix4()
          .makeRotationY(jitter(rng, 0.018))
          .setPosition(
            sx * (width / 2 - postSize / 2),
            bodyHeight / 2,
            sz * (depth / 2 - postSize / 2),
          ),
      );
      pieces.push(finishBoard(post, rng, shade(tone, 0.76), bodyHeight));
    }
  }

  addPlankedTop(width, depth, height, tone, rng, pieces);
  return mergePropPieces(pieces, rng);
}
