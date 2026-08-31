# UVTT Import — parser spec (delegation-ready, not yet built)

The v1 prep-cost answer: parse Universal VTT exports (`.dd2vtt` / `.uvtt` /
`.df2vtt`, as produced by Dungeondraft and Dungeon Alchemist) and extrude a 3D
room from the vector data they already contain. Parsing, not vision.

## Input format (JSON)

Known fields (format versions ~0.2–1.0 are all shaped like this):

```jsonc
{
  "format": 0.3,
  "resolution": {
    "map_origin": { "x": 0, "y": 0 },
    "map_size": { "x": 30, "y": 20 },      // grid squares
    "pixels_per_grid": 256
  },
  "line_of_sight": [ [ {"x":1.0,"y":2.5}, {"x":5,"y":2.5} ], ... ],   // wall polylines, grid units
  "objects_line_of_sight": [ ... ],        // same shape; furniture etc.
  "portals": [ { "position": {...}, "bounds": [{...},{...}], "rotation": 0, "closed": true, "freestanding": false } ],
  "lights": [ { "position": {"x":3,"y":4}, "range": 4.5, "intensity": 1.0, "color": "ffcc88ff", "shadows": true } ],
  "environment": { "baked_lighting": true, "ambient_light": "ffffffff" },
  "image": "<base64 png/webp of the rendered 2D map>"
}
```

Tolerate missing optional fields; fail with a typed error, not a throw-string, on
absent `resolution` or non-array `line_of_sight`.

## Package shape

`web/src/lib/uvtt/` — pure TypeScript, zero three.js imports, unit-testable:

- `parse(json: unknown): UvttMap | UvttError` — validate + normalize into a typed
  model. Coordinates normalized to **world units where 1 grid square = 1 unit**,
  origin shifted so map_origin is (0,0), and the 2D `y` axis mapped to world `z`.
- `toWallSegments(map: UvttMap, opts): WallSegment[]` — polylines → segments
  `{ ax, az, bx, bz, height, thickness }`, with portal bounds subtracted from any
  overlapping wall segment (a door = a gap; door meshes come later). Default
  height 2.5, thickness 0.15 (opts-overridable).
- `toLights(map: UvttMap): SceneLight[]` — `{ x, z, range, intensity, colorHex }`;
  UVTT colors are RGBA hex — drop alpha.
- `imageBlob(map: UvttMap): Uint8Array | null` — decoded map image bytes for the
  ground-plane texture.

Geometry realization (BufferGeometry from WallSegment[]) lives beside it in
`web/src/lib/uvtt/geometry.ts` and may import three; keep it thin — box per
segment is fine for the demo.

## Tests

Vitest. Fixtures: hand-write two small `.dd2vtt` JSON fixtures (a 4-wall room
with one portal; an L-shaped polyline) rather than committing a real export.
Assert: normalization/origin shift, portal gap subtraction (segment split into
two), light color parsing, graceful rejection of malformed input.

## Out of scope (for the parser delegation)

Syncing imported geometry through SpacetimeDB (row design for walls + where the
map image lives — STDB bytes row vs. blob store) is an integration decision made
after the parser exists. The parser stays pure either way.
