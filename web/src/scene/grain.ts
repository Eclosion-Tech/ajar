import * as THREE from 'three';

/**
 * Procedurally generated tiling wood-grain texture — no asset files, keeps the
 * client zero-download. Grayscale near white; prop vertex colors multiply in
 * the actual wood tone. Generated once per session.
 */
let cached: THREE.Texture | null = null;

export function woodGrainTexture(): THREE.Texture | null {
  if (cached) return cached;
  if (typeof document === 'undefined') return null;

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#e8e2d6';
  ctx.fillRect(0, 0, size, size);

  // Long horizontal streaks in layered low alpha = grain running along U.
  for (let i = 0; i < 520; i += 1) {
    const y = Math.random() * size;
    const len = 30 + Math.random() * 220;
    const x = Math.random() * size - len / 2;
    const dark = Math.random() < 0.72;
    const alpha = 0.03 + Math.random() * 0.09;
    ctx.strokeStyle = dark ? `rgba(70, 52, 34, ${alpha})` : `rgba(255, 248, 235, ${alpha})`;
    ctx.lineWidth = 0.6 + Math.random() * 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    // slight waver so streaks aren't ruler-straight
    ctx.bezierCurveTo(x + len * 0.3, y + (Math.random() - 0.5) * 3, x + len * 0.7, y + (Math.random() - 0.5) * 3, x + len, y);
    ctx.stroke();
  }

  // A few knots.
  for (let i = 0; i < 5; i += 1) {
    const cx = Math.random() * size;
    const cy = Math.random() * size;
    for (let r = 6; r > 1; r -= 1.5) {
      ctx.strokeStyle = `rgba(60, 44, 28, ${0.05 + (6 - r) * 0.015})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 1.6, r, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  cached = texture;
  return texture;
}
