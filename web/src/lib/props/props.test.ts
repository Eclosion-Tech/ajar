import { describe, expect, it } from 'vitest';
import {
  buildProp,
  normalizeBarrelParams,
  normalizeChestParams,
  normalizeCrateParams,
  normalizeSeatParams,
  normalizeTableParams,
} from './index';

const PARAMS = JSON.stringify({ shape: 'rect', width: 1.8, depth: 0.9, height: 0.75, wood: 1 });

describe('prop generators', () => {
  it('is deterministic: same (kind, params, seed) yields identical vertices', () => {
    const a = buildProp('table', PARAMS, 42n);
    const b = buildProp('table', PARAMS, 42n);
    expect(a).not.toBeNull();
    expect(Array.from(a!.getAttribute('position').array)).toEqual(
      Array.from(b!.getAttribute('position').array),
    );
  });

  it('different seeds produce different jitter', () => {
    const a = buildProp('table', PARAMS, 1n);
    const b = buildProp('table', PARAMS, 2n);
    expect(Array.from(a!.getAttribute('position').array)).not.toEqual(
      Array.from(b!.getAttribute('position').array),
    );
  });

  it('builds round tables with real geometry (mixed indexed/extruded pieces)', () => {
    const g = buildProp('table', JSON.stringify({ shape: 'round', width: 1.4, height: 0.75, wood: 0 }), 11n);
    expect(g).not.toBeNull();
    expect(g!.getAttribute('position').count).toBeGreaterThan(100);
    expect(g!.getAttribute('color')).toBeDefined();
  });

  it('has vertex colors', () => {
    const g = buildProp('table', PARAMS, 7n)!;
    expect(g.getAttribute('color')).toBeDefined();
    expect(g.getAttribute('color').count).toBe(g.getAttribute('position').count);
  });

  it('tolerates malformed params and unknown kinds', () => {
    expect(buildProp('table', 'not json{{', 1n)).not.toBeNull();
    expect(buildProp('chair', '{}', 1n)).toBeNull();
  });

  it('clamps out-of-range params', () => {
    const p = normalizeTableParams({ width: 99, height: -3, shape: 'banana' });
    expect(p.width).toBe(4);
    expect(p.height).toBe(0.5);
    expect(p.shape).toBe('rect');
  });
});

const NEW_PROP_CASES = [
  {
    kind: 'seat',
    params: JSON.stringify({ style: 'chair', width: 0.52, wood: 1 }),
    assertClamping: () => {
      const p = normalizeSeatParams({ style: 'sofa', width: 99, wood: -2 });
      expect(p).toEqual({ style: 'chair', width: 3, wood: 0 });
    },
  },
  {
    kind: 'barrel',
    params: JSON.stringify({ radius: 0.31, height: 0.72, wood: 2 }),
    assertClamping: () => {
      const p = normalizeBarrelParams({ radius: 99, height: -2, wood: 99 });
      expect(p).toEqual({ radius: 0.5, height: 0.4, wood: 3 });
    },
  },
  {
    kind: 'crate',
    params: JSON.stringify({ width: 0.72, depth: 0.56, height: 0.55, wood: 3 }),
    assertClamping: () => {
      const p = normalizeCrateParams({ width: 99, depth: -2, height: 99, wood: -2 });
      expect(p).toEqual({ width: 1.5, depth: 0.3, height: 1.5, wood: 0 });
    },
  },
  {
    kind: 'chest',
    params: JSON.stringify({ width: 0.86, depth: 0.53, height: 0.55, wood: 0 }),
    assertClamping: () => {
      const p = normalizeChestParams({ width: 99, depth: 99, height: -2, wood: 99 });
      expect(p).toMatchObject({ width: 1.4, depth: 1, wood: 3 });
      expect(p.height).toBeCloseTo(0.532);
    },
  },
] as const;

describe.each(NEW_PROP_CASES)('$kind generator', ({ kind, params, assertClamping }) => {
  it('is deterministic: same params and seed yield identical vertices', () => {
    const a = buildProp(kind, params, 42n);
    const b = buildProp(kind, params, 42n);
    expect(a).not.toBeNull();
    expect(Array.from(a!.getAttribute('position').array)).toEqual(
      Array.from(b!.getAttribute('position').array),
    );
  });

  it('changes vertex positions for a different seed', () => {
    const a = buildProp(kind, params, 1n)!;
    const b = buildProp(kind, params, 2n)!;
    expect(Array.from(a.getAttribute('position').array)).not.toEqual(
      Array.from(b.getAttribute('position').array),
    );
  });

  it('has vertex colors', () => {
    const geometry = buildProp(kind, params, 7n)!;
    expect(geometry.getAttribute('color')).toBeDefined();
    expect(geometry.getAttribute('color').count).toBe(geometry.getAttribute('position').count);
    expect(geometry.index).toBeNull();
  });

  it('clamps out-of-range params', () => {
    assertClamping();
  });
});

it('builds every seat construction style', () => {
  for (const style of ['stool', 'chair', 'bench'] as const) {
    const geometry = buildProp('seat', JSON.stringify({ style, width: 1, wood: 0 }), 9n);
    expect(geometry).not.toBeNull();
    expect(geometry!.getAttribute('position').count).toBeGreaterThan(100);
  }
});
