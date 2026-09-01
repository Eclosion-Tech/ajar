# Walking Skeleton — Module Contract

The coordination contract between `server/spacetimedb` (Rust STDB module) and `web/`
(client). Change this file first; code follows it.

**Scope:** the validation-demo vertical slice. Two browser tabs, one table: create a
table, join by slug, spawn minis, move them (synced live), DM hides/reveals a monster
that players cannot see. Nothing else — no chat, dice, turn tracker, or UVTT import yet.

Toolchain: `spacetimedb = "=2.0.3"` with `features = ["unstable"]` (row-level security),
`crate-type = ["cdylib"]`. Mirrors the Pear module's conventions.

## Tables (all `public`; RLS restricts `entity`)

### `game_table`
| column | type | notes |
|---|---|---|
| id | u64 | `#[primary_key]` `#[auto_inc]` |
| slug | String | `#[unique]` — the join code in the URL |
| name | String | |
| dm_identity | Identity | creator; the DM |
| created_at | Timestamp | |

### `participant`
| column | type | notes |
|---|---|---|
| id | u64 | `#[primary_key]` `#[auto_inc]` |
| table_id | u64 | btree index |
| identity | Identity | btree index; (table_id, identity) uniqueness enforced in reducers |
| display_name | String | |
| role | Role | enum `Dm \| Player` (SpacetimeType) |
| online | bool | |

### `entity`
| column | type | notes |
|---|---|---|
| id | u64 | `#[primary_key]` `#[auto_inc]` |
| table_id | u64 | btree index |
| dm_identity | Identity | denormalized copy of the table's DM, for single-table RLS |
| kind | EntityKind | enum `Mini \| Prop` (SpacetimeType) |
| name | String | |
| color | String | hex like `#c0ffee` |
| x, y, z | f32 | position; y is up; grid plane is y=0 |
| rot_y | f32 | radians |
| hidden | bool | true ⇒ DM-only |
| created_by | Identity | |

### `wall` (added for UVTT import — synced structural geometry)
| column | type | notes |
|---|---|---|
| id | u64 | `#[primary_key]` `#[auto_inc]` |
| table_id | u64 | btree index |
| ax, az, bx, bz | f32 | segment endpoints on the ground plane |
| height | f32 | |
| thickness | f32 | |

Public, no RLS — players see walls. Import replaces: `import_walls` deletes the
table's existing walls, then inserts the new set.

Additional reducers (all DM-only, `Result<(), String>`):
- `import_walls(table_id: u64, walls: Vec<WallInput>)` — `WallInput` is a
  `SpacetimeType` struct `{ ax, az, bx, bz, height, thickness: f32 }`. Replace-all
  semantics. Reject > 4096 walls.
- `clear_walls(table_id: u64)`
- `add_wall(table_id: u64, ax, az, bx, bz, height, thickness: f32)` — single
  segment, for the Sims-style wall-drawing tool. Finite-validated.
- `update_wall(wall_id: u64, ax, az, bx, bz, height, thickness: f32)` — full-row
  update, for endpoint drags and height/thickness edits (the imported-bar-as-wall
  fix: select the run, drop height to counter height). Finite-validated.
- `delete_wall(wall_id: u64)`

### `light` (synced from UVTT import; rendered as point lights)
| column | type | notes |
|---|---|---|
| id | u64 | `#[primary_key]` `#[auto_inc]` |
| table_id | u64 | btree index |
| x, z | f32 | position (y implied ~wall-mid height client-side) |
| range | f32 | |
| intensity | f32 | |
| color_rgb | u32 | 0xRRGGBB |

Public, no RLS. Reducers (DM-only): `import_lights(table_id, lights: Vec<LightInput>)`
(replace-all, cap 1024; `LightInput` mirrors the row minus id/table_id) and
`clear_lights(table_id)`.

### `map_image` (floor texture; the image itself lives in blob storage, not STDB)
| column | type | notes |
|---|---|---|
| id | u64 | `#[primary_key]` `#[auto_inc]` |
| table_id | u64 | btree index; one row per table (upsert in reducer) |
| url | String | blob URL (dev: local blob sidecar; prod: blob store) |
| width, height | f32 | world units |
| offset_x, offset_z | f32 | world position of the image center |

Public. Reducers (DM-only): `set_map_image(table_id, url, width, height, offset_x, offset_z)`
(insert or update the single row) and `clear_map_image(table_id)`.

### `prop` (parametric procedural props — params are the asset)
| column | type | notes |
|---|---|---|
| id | u64 | `#[primary_key]` `#[auto_inc]` |
| table_id | u64 | btree index |
| dm_identity | Identity | denormalized for RLS, like `entity` |
| kind | String | generator name, e.g. `"table"` |
| params | String | generator-specific JSON; reducers cap length at 4096 |
| seed | u64 | deterministic jitter — same (kind, params, seed) ⇒ same mesh on every client |
| x, z | f32 | position on ground plane |
| rot_y | f32 | radians |
| hidden | bool | DM-only when true (mimic chests are a feature) |

RLS: the same two union-ed filters as `entity` (`hidden = false` OR `dm_identity = :sender`).

Reducers (ALL DM-only via require_table_dm; `Result<(), String>`):
- `spawn_prop(table_id: u64, kind: String, params: String, seed: u64, x: f32, z: f32, rot_y: f32)` — reject params.len() > 4096. Ghost placement commits rotation atomically.
- `update_prop_params(prop_id: u64, params: String)` — same length cap. Live slider edits stream through this (client throttles).
- `move_prop(prop_id: u64, x: f32, z: f32, rot_y: f32)`
- `set_prop_hidden(prop_id: u64, hidden: bool)`
- `delete_prop(prop_id: u64)`

Transform validation (applies to spawn_entity, move_entity, spawn_prop, move_prop):
reject non-finite (NaN/±inf) position and rotation inputs with an error — a NaN
transform poisons every client's render.

## Row-level security (the product feature)

Two union-ed filters on `entity`, Pear idiom:

```rust
#[client_visibility_filter]
const ENTITY_VISIBLE: Filter = Filter::Sql("SELECT * FROM entity WHERE hidden = false");

#[client_visibility_filter]
const ENTITY_DM: Filter = Filter::Sql("SELECT * FROM entity WHERE dm_identity = :sender");
```

Players never receive hidden rows — hiding is server-side, not a client render flag.
`game_table` and `participant` stay fully public for the skeleton.

## Reducers (all return `Result<(), String>`)

- `create_table(name: String, display_name: String)` — generate a 6-char lowercase
  alphanumeric slug (from `ctx.rng()`; retry on collision), insert `game_table` with
  sender as `dm_identity`, insert sender as online `Dm` participant.
- `join_table(slug: String, display_name: String)` — look up table by slug (err if
  missing). Upsert participant: role `Dm` if sender == `dm_identity`, else `Player`;
  set `online = true`, update `display_name`.
- `spawn_entity(table_id: u64, kind: EntityKind, name: String, color: String, x: f32, z: f32, hidden: bool)`
  — sender must be the table's DM. y = 0, rot_y = 0. Copy `dm_identity` from the table.
- `move_entity(entity_id: u64, x: f32, y: f32, z: f32, rot_y: f32)` — sender must be an
  online participant of the entity's table; if the entity is hidden, DM only.
- `set_entity_hidden(entity_id: u64, hidden: bool)` — DM of the entity's table only.
- `delete_entity(entity_id: u64)` — DM only.
- `client_disconnected` (lifecycle) — set `online = false` on all participant rows for
  the sender identity.
- `run_pending_migrations()` — cloud-compat convention from Pear: idempotent, consults a
  private `migration_state` table (`step_key: String` pk, `applied_at: Timestamp`),
  currently zero steps. Structure it so steps append as
  `run_step(ctx, "some_backfill_v1", |ctx| { ... })`.

## Client wiring (info for web/, not the module)

- Connection: `@clockworklabs/spacetimedb-sdk`, module name `3dvtt` on local
  `spacetime start` (default `http://localhost:3000`).
- Bindings generated with
  `spacetime generate --lang typescript --out-dir web/src/module_bindings --project-path server/spacetimedb`.
- Client subscribes per table: `SELECT * FROM entity WHERE table_id = ...` etc. RLS
  intersects with subscriptions server-side.
