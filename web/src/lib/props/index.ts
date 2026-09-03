import type { BufferGeometry } from 'three';
import { buildBarrel, normalizeBarrelParams } from './barrel';
import type { BarrelParams } from './barrel';
import { buildChest, normalizeChestParams } from './chest';
import type { ChestParams } from './chest';
import { buildCrate, normalizeCrateParams } from './crate';
import type { CrateParams } from './crate';
import { buildSeat, normalizeSeatParams } from './seat';
import type { SeatParams } from './seat';
import { buildTable, normalizeTableParams } from './table';
import type { TableParams } from './table';

export type { BarrelParams, ChestParams, CrateParams, SeatParams, TableParams };
export {
  normalizeBarrelParams,
  normalizeChestParams,
  normalizeCrateParams,
  normalizeSeatParams,
  normalizeTableParams,
};
export { WOOD_TONES } from './palette';

/**
 * The generator registry. A prop row is (kind, params JSON, seed); geometry is
 * derived deterministically on every client — the params ARE the asset.
 * Generators stay plain functions; this never grows into an authoring
 * framework.
 */
export function buildProp(kind: string, paramsJson: string, seed: bigint | number): BufferGeometry | null {
  let raw: unknown = {};
  try {
    raw = JSON.parse(paramsJson);
  } catch {
    // tolerate malformed params; generators normalize to defaults
  }
  const seed32 = Number(BigInt(seed) & 0xffffffffn);
  switch (kind) {
    case 'barrel':
      return buildBarrel(normalizeBarrelParams(raw), seed32);
    case 'chest':
      return buildChest(normalizeChestParams(raw), seed32);
    case 'crate':
      return buildCrate(normalizeCrateParams(raw), seed32);
    case 'seat':
      return buildSeat(normalizeSeatParams(raw), seed32);
    case 'table':
      return buildTable(normalizeTableParams(raw), seed32);
    default:
      return null;
  }
}
