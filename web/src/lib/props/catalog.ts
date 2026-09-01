import { WOOD_TONES } from './palette';

/**
 * The prop catalog: the one place that knows which kinds exist and how to
 * roll a fresh draft of params for each. Palette, ghost placement, and
 * duplication all consume this. Kept deliberately tiny — a lookup, not a
 * framework (PROJECT.md footnote 1).
 */
export const PROP_KINDS = ['table', 'seat', 'barrel', 'crate', 'chest'] as const;
export type PropKind = (typeof PROP_KINDS)[number];

export const PROP_SNAP = 0.5;
export const MINI_SNAP = 1.0;

export const randomSeed = (): bigint => BigInt(Math.floor(Math.random() * 0xffffffff));

const randomWood = () => Math.floor(Math.random() * WOOD_TONES.length);

export function randomParams(kind: PropKind): Record<string, unknown> {
  const wood = randomWood();
  switch (kind) {
    case 'table': {
      const round = Math.random() < 0.4;
      return {
        shape: round ? 'round' : 'rect',
        width: round ? 1.2 + Math.random() * 0.5 : 1.4 + Math.random() * 0.8,
        depth: 0.8 + Math.random() * 0.3,
        height: 0.72 + Math.random() * 0.06,
        wood,
      };
    }
    case 'seat': {
      const styles = ['stool', 'chair', 'bench'] as const;
      const style = styles[Math.floor(Math.random() * styles.length)];
      return {
        style,
        width:
          style === 'stool'
            ? 0.36 + Math.random() * 0.1
            : style === 'bench'
              ? 1.1 + Math.random() * 0.7
              : 0.45 + Math.random() * 0.14,
        wood,
      };
    }
    case 'barrel':
      return { radius: 0.27 + Math.random() * 0.1, height: 0.62 + Math.random() * 0.2, wood };
    case 'crate':
      return {
        width: 0.6 + Math.random() * 0.3,
        depth: 0.45 + Math.random() * 0.2,
        height: 0.45 + Math.random() * 0.2,
        wood,
      };
    case 'chest': {
      const width = 0.75 + Math.random() * 0.3;
      return {
        width,
        depth: width * (0.55 + Math.random() * 0.12),
        height: width * (0.55 + Math.random() * 0.14),
        wood,
      };
    }
  }
}

// Armed placement keeps the same params across stamps (a matching dining set)
// and remembers them per kind for the next arming session.
const lastParams = new Map<PropKind, Record<string, unknown>>();

export function draftParams(kind: PropKind): Record<string, unknown> {
  const remembered = lastParams.get(kind);
  return remembered ? { ...remembered } : randomParams(kind);
}

export function rememberParams(kind: PropKind, params: Record<string, unknown>): void {
  lastParams.set(kind, { ...params });
}
