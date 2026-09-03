import { describe, expect, it } from 'vitest';

import roomJson from './fixtures/four-wall-room.dd2vtt?raw';
import lShapedJson from './fixtures/l-shaped.dd2vtt?raw';
import {
  imageBlob,
  parse,
  toLights,
  toWallSegments,
  type UvttMap,
} from './index';

function validMap(json: string): UvttMap {
  const result = parse(json);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result;
}

describe('parse', () => {
  it('normalizes map origin and maps 2D y coordinates to world z', () => {
    const map = validMap(lShapedJson);

    expect(map.resolution.mapOrigin).toEqual({ x: 0, z: 0 });
    expect(map.resolution.mapSize).toEqual({ x: 3, z: 4 });
    expect(map.lineOfSight[0]).toEqual([
      { x: 0, z: 0 },
      { x: 3, z: 0 },
      { x: 3, z: 4 },
    ]);
    expect(toWallSegments(map)).toHaveLength(2);
  });

  it('returns typed errors for malformed required input', () => {
    expect(parse({ line_of_sight: [] })).toMatchObject({
      ok: false,
      code: 'MISSING_RESOLUTION',
      path: 'resolution',
    });
    expect(parse({
      resolution: {
        map_origin: { x: 0, y: 0 },
        map_size: { x: 1, y: 1 },
      },
      line_of_sight: {},
    })).toMatchObject({
      ok: false,
      code: 'INVALID_LINE_OF_SIGHT',
      path: 'line_of_sight',
    });
    expect(parse('{not json')).toMatchObject({ ok: false, code: 'INVALID_JSON' });
  });
});

describe('UVTT projections', () => {
  it('splits a wall into two segments where a portal overlaps it', () => {
    const map = validMap(roomJson);
    const segments = toWallSegments(map, { height: 3, thickness: 0.2 });
    const topWall = segments.filter((segment) => segment.az === 0 && segment.bz === 0);

    expect(segments).toHaveLength(5);
    expect(topWall).toEqual([
      { ax: 0, az: 0, bx: 2, bz: 0, height: 3, thickness: 0.2 },
      { ax: 4, az: 0, bx: 6, bz: 0, height: 3, thickness: 0.2 },
    ]);
  });

  it('drops RGBA alpha when converting lights', () => {
    const lights = toLights(validMap(roomJson));

    expect(lights).toEqual([{
      x: 1.5,
      z: 2,
      range: 4.5,
      intensity: 1,
      colorHex: 0xffcc88,
    }]);
  });

  it('decodes the optional base64 map image', () => {
    expect(imageBlob(validMap(roomJson))).toEqual(Uint8Array.from([1, 2, 3, 4]));
  });

  it('keeps long narrow closed object outlines at furniture height', () => {
    const map = validMap(JSON.stringify({
      resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: 12, y: 4 } },
      line_of_sight: [],
      objects_line_of_sight: [[
        { x: 1, y: 1 }, { x: 11, y: 1 }, { x: 11, y: 2 },
        { x: 1, y: 2 }, { x: 1, y: 1 },
      ]],
    }));

    expect(toWallSegments(map, { includeObjects: true })).toHaveLength(4);
    expect(toWallSegments(map, { includeObjects: true }).every((segment) => segment.height === 0.9)).toBe(true);
  });
});
