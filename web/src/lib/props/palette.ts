/**
 * Muted, desaturated wood tones — the Zomboid/old-school-RuneScape register.
 * Grounded and weathered, never candy-colored.
 */
export const WOOD_TONES = [
  0x8a795d, // weathered oak
  0x5c4633, // dark walnut
  0x77705f, // grey ash
  0x704a35, // aged redwood
] as const;

export const woodTone = (index: number): number =>
  WOOD_TONES[Math.abs(Math.trunc(index)) % WOOD_TONES.length];

/** Scale an 0xRRGGBB color's brightness (0..~1.3). */
export function shade(hex: number, factor: number): number {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((hex >> 16) & 0xff) * factor);
  const g = clamp(((hex >> 8) & 0xff) * factor);
  const b = clamp((hex & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}
