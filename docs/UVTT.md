# UVTT Import — Implementation Notes

The first prep-cost path is implemented: Universal VTT exports (`.dd2vtt`, `.uvtt`,
and `.df2vtt`, as produced by tools such as Dungeondraft and Dungeon Alchemist) are
parsed into wall segments, portal gaps, lights, and an optional floor image. The map's
existing vector data creates the room; no vision model is needed for structural import.

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

The parser tolerates missing optional fields and returns a typed error, rather than
throwing a string, for absent `resolution`, invalid fields, or non-array
`line_of_sight` data.

## Package shape

`web/src/lib/uvtt/parse.ts` is pure TypeScript with no Three.js imports:

- `parse(json: unknown): UvttMap | UvttError` — validate + normalize into a typed
  model. Coordinates normalized to **world units where 1 grid square = 1 unit**,
  origin shifted so map_origin is (0,0), and the 2D `y` axis mapped to world `z`.
- `toWallSegments(map: UvttMap, opts): WallSegment[]` — polylines → segments
  `{ ax, az, bx, bz, height, thickness }`, with portal bounds subtracted from any
  overlapping wall segment (a door = a gap; door meshes come later). Default
  height 2.5, thickness 0.15 (opts-overridable).
- `toLights(map: UvttMap): SceneLight[]` — `{ x, z, range, intensity, colorHex }`;
  UVTT colors are RGBA hex — drop alpha. (`colorHex` is numeric RGB, three-ready.)
- `imageBlob(map: UvttMap): Uint8Array | null` — decoded map image bytes for the
  ground-plane texture.

Geometry realization lives in `web/src/lib/uvtt/geometry.ts`: it merges box geometry
for all wall segments into one renderable `BufferGeometry`.

## Import pipeline

The DM toolbar owns the current end-to-end import:

1. Parse the selected file and derive portal-subtracted wall segments.
2. Use `line_of_sight` as structural walls. If it is empty, fall back to
   `objects_line_of_sight`; small closed object outlines receive furniture-height
   extrusion rather than full wall height.
3. Center walls and lights around the scene origin, then call the DM-only
   replace-all `import_walls` and `import_lights` reducers.
4. Decode an embedded image, upload it to the development blob service, and upsert
   its URL and world dimensions into `map_image`.
5. Render the image as the floor, the walls as merged geometry, and a spread-limited
   subset of imported lights as real point lights.

The blob service is intentionally minimal and development-only. It accepts PNG, JPEG,
or WebP bytes, stores them by SHA-256, and returns an immutable local URL.

## Tests

Vitest uses two hand-written fixtures: a four-wall room with a portal and an L-shaped
polyline. Tests cover origin normalization, portal-gap subtraction, light color
parsing, image decoding, and graceful rejection of malformed input.

## Current limitations

- Portals become wall gaps; door meshes and door state do not exist yet.
- A map import replaces walls and lights through separate reducer calls, not one
  cross-table transaction.
- If a file has no embedded image, or its blob upload fails, structural import still
  succeeds. An existing floor image is left unchanged.
- The local blob service returns `localhost` URLs and has no production auth,
  retention, or object-storage integration.
- Native `.dungeondraft_map` object extraction is not implemented.
- The `#/lab` VLM harness can overlay proposed furniture detections, but detections
  are not yet reviewed or converted into `prop` rows.
