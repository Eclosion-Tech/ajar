/** Deterministic PRNG — same seed must yield the same mesh on every client. */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform in [lo, hi). */
export const range = (rng: Rng, lo: number, hi: number) => lo + rng() * (hi - lo);

/** Symmetric jitter in [-amount, +amount]. */
export const jitter = (rng: Rng, amount: number) => (rng() * 2 - 1) * amount;
