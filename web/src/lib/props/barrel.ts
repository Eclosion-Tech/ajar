import { BoxGeometry, BufferGeometry, CylinderGeometry, Matrix4 } from 'three';
import {
  BOARD_GAP,
  boardWidths,
  mergePropPieces,
  offsetUV,
  paint,
  roundBoard,
  scaleUV,
  worn,
} from './build';
import { shade, woodTone } from './palette';
import { jitter, mulberry32, type Rng } from './rng';

export type BarrelParams = {
  radius: number;
  height: number;
  wood: number;
};

export function normalizeBarrelParams(raw: unknown): BarrelParams {
  const p = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<BarrelParams>;
  const clamp = (v: unknown, lo: number, hi: number, dflt: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt;
  return {
    radius: clamp(p.radius, 0.15, 0.5, 0.31),
    height: clamp(p.height, 0.4, 1.1, 0.72),
    wood: clamp(p.wood, 0, 3, 0),
  };
}

function finishStave(
  geometry: BufferGeometry,
  rng: Rng,
  tone: number,
  height: number,
): BufferGeometry {
  scaleUV(geometry, Math.max(0.5, height), 0.3);
  offsetUV(geometry, rng() * 4, rng() * 4);
  return paint(geometry, worn(rng, tone));
}

function addStaves(
  radius: number,
  height: number,
  tone: number,
  rng: Rng,
  pieces: BufferGeometry[],
): number {
  const count = Math.max(10, Math.round(radius * 34));
  const endRadius = radius * 0.91;
  const middleRadius = radius * 1.015;
  const staveDepth = Math.max(0.022, radius * 0.12);
  const staveWidth = (2 * Math.PI * middleRadius * 0.91) / count;
  const rise = height / 2;
  const lean = Math.atan((middleRadius - endRadius) / rise);
  const segmentLength = rise / Math.cos(lean) + 0.006;
  const segmentRadius = (endRadius + middleRadius) / 2;

  for (let i = 0; i < count; i += 1) {
    const theta = (i / count) * Math.PI * 2 + jitter(rng, 0.004);
    const staveTone = shade(tone, 1 + jitter(rng, 0.07));
    for (const half of [0, 1] as const) {
      const stave = new BoxGeometry(staveWidth, segmentLength, staveDepth);
      stave.applyMatrix4(
        new Matrix4()
          .makeRotationY(theta)
          .multiply(new Matrix4().makeRotationX(half === 0 ? lean : -lean))
          .setPosition(
            Math.sin(theta) * (segmentRadius + jitter(rng, radius * 0.006)),
            (half + 0.5) * rise + jitter(rng, 0.0015),
            Math.cos(theta) * (segmentRadius + jitter(rng, radius * 0.006)),
          ),
      );
      pieces.push(finishStave(stave, rng, staveTone, segmentLength));
    }
  }
  return count;
}

function addLid(
  radius: number,
  height: number,
  tone: number,
  rng: Rng,
  pieces: BufferGeometry[],
): void {
  const thickness = 0.035;
  const under = new CylinderGeometry(radius * 0.9, radius * 0.9, thickness * 0.45, 12);
  under.applyMatrix4(new Matrix4().setPosition(0, height - thickness * 0.75, 0));
  pieces.push(paint(under, shade(tone, 0.28)));

  let z = -radius;
  for (const boardWidth of boardWidths(rng, radius * 2)) {
    const center = z + boardWidth / 2;
    z += boardWidth;
    const z0 = Math.max(-radius + 0.008, center - boardWidth / 2 + BOARD_GAP / 2);
    const z1 = Math.min(radius - 0.008, center + boardWidth / 2 - BOARD_GAP / 2);
    if (z1 - z0 < 0.025) continue;
    const board = roundBoard(z0, z1, radius * 0.94, thickness);
    scaleUV(board, Math.max(0.5, radius * 2), 0.35);
    offsetUV(board, rng() * 4, rng() * 4);
    board.applyMatrix4(
      new Matrix4().setPosition(jitter(rng, 0.0025), height - thickness + jitter(rng, 0.0015), 0),
    );
    pieces.push(paint(board, worn(rng, shade(tone, 0.93))));
  }
}

export function buildBarrel(params: BarrelParams, seed: number): BufferGeometry {
  const rng = mulberry32(seed);
  const { radius, height } = params;
  const tone = woodTone(params.wood);
  const pieces: BufferGeometry[] = [];
  const lidThickness = 0.035;
  const bodyHeight = height - lidThickness;
  const staveCount = addStaves(radius, bodyHeight, tone, rng, pieces);

  const hoopCount = height > 0.62 ? 3 : 2;
  const hoopTone = shade(0x55544e, 0.38);
  const hoopHeight = Math.min(0.038, height * 0.055);
  for (let i = 0; i < hoopCount; i += 1) {
    const fraction = hoopCount === 2 ? 0.2 + i * 0.6 : 0.16 + i * 0.34;
    const fromMiddle = Math.abs(fraction - 0.5) * 2;
    const hoopRadius = radius * (1.085 - fromMiddle * 0.09);
    const hoop = new CylinderGeometry(hoopRadius, hoopRadius, hoopHeight, staveCount, 1, true);
    offsetUV(hoop, rng() * 2, rng() * 2);
    hoop.applyMatrix4(
      new Matrix4().setPosition(0, bodyHeight * fraction + jitter(rng, 0.002), 0),
    );
    pieces.push(paint(hoop, shade(hoopTone, 1 + jitter(rng, 0.06))));
  }

  addLid(radius, height, tone, rng, pieces);
  return mergePropPieces(pieces, rng);
}
