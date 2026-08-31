import type { BufferGeometry } from 'three';
import { buildTable, normalizeTableParams } from './table';
import type { TableParams } from './table';

export type { TableParams };
export { normalizeTableParams };
export { WOOD_TONES } from './palette';

/**
 * The generator registry. A prop row is (kind, params JSON, seed); geometry is
 * derived deterministically on every client — the params ARE the asset.
 * Generators stay plain functions; this never grows into an authoring
 * framework (PROJECT.md footnote 1 discipline).
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
    case 'table':
      return buildTable(normalizeTableParams(raw), seed32);
    default:
      return null;
  }
}
