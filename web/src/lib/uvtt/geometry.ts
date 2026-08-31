import {
  BoxGeometry,
  BufferGeometry,
  Matrix4,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import type { WallSegment } from './parse';

/** Realize each wall segment as a box resting on the y=0 ground plane. */
export function wallSegmentsToGeometry(segments: readonly WallSegment[]): BufferGeometry {
  if (segments.length === 0) {
    return new BufferGeometry();
  }

  const boxes = segments.flatMap((segment) => {
    const dx = segment.bx - segment.ax;
    const dz = segment.bz - segment.az;
    const length = Math.hypot(dx, dz);
    if (length === 0) {
      return [];
    }

    const box = new BoxGeometry(length, segment.height, segment.thickness);
    const transform = new Matrix4()
      .makeRotationY(-Math.atan2(dz, dx))
      .setPosition(
        (segment.ax + segment.bx) / 2,
        segment.height / 2,
        (segment.az + segment.bz) / 2,
      );
    box.applyMatrix4(transform);
    return [box];
  });

  if (boxes.length === 0) {
    return new BufferGeometry();
  }

  const merged = mergeGeometries(boxes, false) ?? new BufferGeometry();
  for (const box of boxes) {
    box.dispose();
  }
  return merged;
}

export const toWallGeometry = wallSegmentsToGeometry;
