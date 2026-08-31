import { describe, expect, it } from 'vitest';
import { buildProp, normalizeTableParams } from './index';

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
