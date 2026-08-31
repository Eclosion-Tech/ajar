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

export type ChestParams = {
  width: number;
  depth: number;
  height: number;
  wood: number;
};

export function normalizeChestParams(raw: unknown): ChestParams {
  const p = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<ChestParams>;
  const clamp = (v: unknown, lo: number, hi: number, dflt: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt;
  const width = clamp(p.width, 0.4, 1.4, 0.86);
  const minDepth = Math.max(0.25, width * 0.42);
  const maxDepth = Math.min(1, width * 0.85);
  const minHeight = Math.max(0.28, width * 0.38);
  const maxHeight = Math.min(1.05, width * 0.85);
  return {
    width,
    depth: clamp(p.depth, minDepth, maxDepth, Math.max(minDepth, Math.min(maxDepth, width * 0.62))),
    height: clamp(
      p.height,
      minHeight,
      maxHeight,
      Math.max(minHeight, Math.min(maxHeight, width * 0.64)),
    ),
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

function addBodyPanel(
  axis: 'x' | 'z',
  length: number,
  height: number,
  fixed: number,
  tone: number,
  rng: Rng,
  pieces: BufferGeometry[],
): void {
  const thickness = 0.034;
  const under = new BoxGeometry(
    axis === 'x' ? length * 0.98 : thickness * 0.45,
    height * 0.98,
    axis === 'x' ? thickness * 0.45 : length * 0.98,
  );
  under.applyMatrix4(
    new Matrix4().setPosition(axis === 'x' ? 0 : fixed, height / 2, axis === 'x' ? fixed : 0),
  );
  pieces.push(paint(under, shade(tone, 0.27)));

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

function addLid(
  width: number,
  depth: number,
  height: number,
  tone: number,
  rng: Rng,
  pieces: BufferGeometry[],
): void {
  const thickness = 0.055;
  const overhang = 0.025;
  const lidWidth = width + overhang * 2;
  const lidDepth = depth + overhang * 2;
  const under = new BoxGeometry(lidWidth * 0.99, thickness * 0.45, lidDepth * 0.99);
  under.applyMatrix4(new Matrix4().setPosition(0, height - thickness * 0.75, 0));
  pieces.push(paint(under, shade(tone, 0.27)));

  let z = -lidDepth / 2;
  for (const boardWidth of boardWidths(rng, lidDepth)) {
    const boardZ = z + boardWidth / 2;
    z += boardWidth;
    let x = -lidWidth / 2;
    for (const sectionLength of sectionLengths(rng, lidWidth)) {
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
      pieces.push(finishBoard(board, rng, shade(tone, 0.95), sectionLength));
    }
  }
}

function addIronBanding(
  width: number,
  depth: number,
  height: number,
  bodyHeight: number,
  rng: Rng,
  pieces: BufferGeometry[],
): void {
  const iron = shade(0x55544e, 0.37);
  const strapWidth = Math.min(0.055, width * 0.065);
  const strapDepth = 0.012;
  for (const sx of [-1, 1] as const) {
    const x = sx * width * 0.25;
    for (const sz of [-1, 1] as const) {
      const face = new BoxGeometry(strapWidth, bodyHeight, strapDepth);
      offsetUV(face, rng() * 2, rng() * 2);
      face.applyMatrix4(
        new Matrix4().setPosition(
          x + jitter(rng, 0.002),
          bodyHeight / 2,
          sz * (depth / 2 + strapDepth * 0.2),
        ),
      );
      pieces.push(paint(face, shade(iron, 1 + jitter(rng, 0.06))));
    }

    const top = new BoxGeometry(strapWidth, 0.012, depth + 0.055);
    scaleUV(top, Math.max(0.35, depth), 0.35);
    offsetUV(top, rng() * 2, rng() * 2);
    top.applyMatrix4(new Matrix4().setPosition(x, height + 0.004, 0));
    pieces.push(paint(top, shade(iron, 1 + jitter(rng, 0.06))));
  }

  const hasp = new BoxGeometry(Math.min(0.11, width * 0.16), 0.13, 0.025);
  offsetUV(hasp, rng() * 2, rng() * 2);
  hasp.applyMatrix4(new Matrix4().setPosition(0, bodyHeight - 0.025, depth / 2 + 0.02));
  pieces.push(paint(hasp, shade(iron, 0.9)));
}

export function buildChest(params: ChestParams, seed: number): BufferGeometry {
  const rng = mulberry32(seed);
  const { width, depth, height } = params;
  const tone = woodTone(params.wood);
  const pieces: BufferGeometry[] = [];
  const lidThickness = 0.055;
  const bodyHeight = height - lidThickness;
  const panelInset = 0.017;

  addBodyPanel('x', width, bodyHeight, depth / 2 - panelInset, tone, rng, pieces);
  addBodyPanel('x', width, bodyHeight, -depth / 2 + panelInset, tone, rng, pieces);
  addBodyPanel('z', depth, bodyHeight, width / 2 - panelInset, tone, rng, pieces);
  addBodyPanel('z', depth, bodyHeight, -width / 2 + panelInset, tone, rng, pieces);
  addLid(width, depth, height, tone, rng, pieces);
  addIronBanding(width, depth, height, bodyHeight, rng, pieces);

  return mergePropPieces(pieces, rng);
}
