import type { PropKind } from './lib/props/catalog';

/** Armed ghost-placement state. rotY advances in 45° steps via the R key. */
export type Placement = {
  kind: PropKind;
  params: Record<string, unknown>;
  seed: bigint;
  rotY: number;
} | null;
