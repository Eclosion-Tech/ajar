import { BoxGeometry, BufferGeometry, CylinderGeometry, Matrix4 } from 'three';
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

export type SeatParams = {
  style: 'stool' | 'chair' | 'bench';
  width: number;
  wood: number;
};

export function normalizeSeatParams(raw: unknown): SeatParams {
  const p = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<SeatParams>;
  const style = p.style === 'stool' || p.style === 'bench' ? p.style : 'chair';
  const defaultWidth = style === 'stool' ? 0.4 : style === 'bench' ? 1.35 : 0.5;
  const clamp = (v: unknown, lo: number, hi: number, dflt: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt;
  return {
    style,
    width: clamp(p.width, 0.35, 3, defaultWidth),
    wood: clamp(p.wood, 0, 3, 0),
  };
}

function finishWood(
  geometry: BufferGeometry,
  rng: Rng,
  tone: number,
  grainLength: number,
): BufferGeometry {
  scaleUV(geometry, Math.max(0.35, grainLength), 0.35);
  offsetUV(geometry, rng() * 4, rng() * 4);
  return paint(geometry, worn(rng, tone));
}

function addPlankedSeat(
  length: number,
  depth: number,
  top: number,
  tone: number,
  rng: Rng,
  pieces: BufferGeometry[],
): void {
  const thickness = 0.055;
  const under = new BoxGeometry(length * 0.985, thickness * 0.45, depth * 0.97);
  under.applyMatrix4(new Matrix4().setPosition(0, top - thickness * 0.75, 0));
  pieces.push(paint(under, shade(tone, 0.3)));

  let z = -depth / 2;
  for (const boardWidth of boardWidths(rng, depth)) {
    const boardZ = z + boardWidth / 2;
    z += boardWidth;
    let x = -length / 2;
    for (const sectionLength of sectionLengths(rng, length)) {
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
          top - thickness / 2 + jitter(rng, 0.0025),
          boardZ + jitter(rng, 0.002),
        ),
      );
      pieces.push(finishWood(board, rng, tone, sectionLength));
    }
  }
}

function addSquareLeg(
  x: number,
  z: number,
  height: number,
  size: number,
  tone: number,
  rng: Rng,
  pieces: BufferGeometry[],
): void {
  const leg = new BoxGeometry(size, height, size);
  leg.applyMatrix4(
    new Matrix4()
      .makeRotationZ(jitter(rng, 0.014))
      .multiply(new Matrix4().makeRotationX(jitter(rng, 0.014)))
      .setPosition(x + jitter(rng, 0.006), height / 2, z + jitter(rng, 0.006)),
  );
  pieces.push(finishWood(leg, rng, tone, height));
}

function buildStool(width: number, tone: number, rng: Rng, pieces: BufferGeometry[]): void {
  const seatHeight = 0.46;
  const thickness = 0.065;
  const radius = width / 2;
  const seat = new CylinderGeometry(radius * 0.98, radius, thickness, 9);
  scaleUV(seat, Math.max(0.35, width), 0.35);
  offsetUV(seat, rng() * 4, rng() * 4);
  seat.applyMatrix4(new Matrix4().setPosition(0, seatHeight - thickness / 2, 0));
  pieces.push(paint(seat, worn(rng, tone)));

  const legCount = rng() < 0.45 ? 3 : 4;
  const legHeight = seatHeight - thickness;
  const legSize = Math.min(0.075, Math.max(0.052, width * 0.15));
  const lean = 0.075 + rng() * 0.035;
  const radialCenter = Math.max(0.08, radius * 0.58);
  for (let i = 0; i < legCount; i += 1) {
    const angle = (i / legCount) * Math.PI * 2 + jitter(rng, 0.025);
    const leg = new BoxGeometry(legSize, legHeight, legSize);
    leg.applyMatrix4(
      new Matrix4()
        .makeRotationY(-angle)
        .multiply(new Matrix4().makeRotationZ(-lean + jitter(rng, 0.012)))
        .setPosition(
          Math.cos(angle) * radialCenter,
          legHeight / 2,
          Math.sin(angle) * radialCenter,
        ),
    );
    pieces.push(finishWood(leg, rng, shade(tone, 0.78), legHeight));
  }
}

function buildChair(width: number, tone: number, rng: Rng, pieces: BufferGeometry[]): void {
  const seatHeight = 0.46;
  const depth = Math.min(0.65, Math.max(0.34, width * 0.88));
  const legSize = Math.min(0.075, Math.max(0.06, width * 0.13));
  const inset = legSize * 0.75;
  addPlankedSeat(width, depth, seatHeight, tone, rng, pieces);

  const x = Math.max(0.07, width / 2 - inset);
  const frontZ = depth / 2 - inset;
  const backZ = -depth / 2 + inset;
  addSquareLeg(x, frontZ, seatHeight - 0.055, legSize, shade(tone, 0.78), rng, pieces);
  addSquareLeg(-x, frontZ, seatHeight - 0.055, legSize, shade(tone, 0.78), rng, pieces);

  const backHeight = 0.86;
  for (const sx of [-1, 1] as const) {
    const post = new BoxGeometry(legSize, backHeight, legSize);
    post.applyMatrix4(
      new Matrix4()
        .makeRotationX(-0.025 + jitter(rng, 0.012))
        .setPosition(sx * x + jitter(rng, 0.005), backHeight / 2, backZ),
    );
    pieces.push(finishWood(post, rng, shade(tone, 0.76), backHeight));
  }

  const slatWidth = Math.max(0.12, x * 2 - legSize * 0.25);
  for (const y of [0.59, 0.71, 0.82]) {
    const slat = new BoxGeometry(slatWidth, 0.065, 0.035);
    slat.applyMatrix4(
      new Matrix4()
        .makeRotationZ(jitter(rng, 0.012))
        .setPosition(jitter(rng, 0.004), y, backZ - legSize * 0.18),
    );
    pieces.push(finishWood(slat, rng, shade(tone, 0.9), slatWidth));
  }
}

function buildBench(width: number, tone: number, rng: Rng, pieces: BufferGeometry[]): void {
  const seatHeight = 0.46;
  const depth = Math.min(0.48, Math.max(0.34, width * 0.3));
  const legSize = 0.075;
  addPlankedSeat(width, depth, seatHeight, tone, rng, pieces);

  const x = Math.max(0.07, width / 2 - 0.13);
  const z = Math.max(0.08, depth / 2 - 0.08);
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      addSquareLeg(
        sx * x,
        sz * z,
        seatHeight - 0.055,
        legSize,
        shade(tone, 0.76),
        rng,
        pieces,
      );
    }
  }

  const apron = new BoxGeometry(Math.max(0.12, width - 0.16), 0.07, 0.045);
  apron.applyMatrix4(new Matrix4().setPosition(0, seatHeight - 0.1, 0));
  pieces.push(finishWood(apron, rng, shade(tone, 0.72), width));
}

export function buildSeat(params: SeatParams, seed: number): BufferGeometry {
  const rng = mulberry32(seed);
  const tone = woodTone(params.wood);
  const pieces: BufferGeometry[] = [];

  if (params.style === 'stool') buildStool(params.width, tone, rng, pieces);
  else if (params.style === 'bench') buildBench(params.width, tone, rng, pieces);
  else buildChair(params.width, tone, rng, pieces);

  return mergePropPieces(pieces, rng);
}
