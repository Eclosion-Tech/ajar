# 3dvtt (working title)

A browser-native 3D virtual tabletop: the table is a URL, the DM pays, players join
free in any browser, no install. See [docs/CONTRACT.md](docs/CONTRACT.md) for the current
module contract.

**Status: pre-validation demo prototype.** The two-tab multiplayer loop works, including
synced minis and server-enforced DM-only visibility. The DM can import a UVTT map,
edit its walls, place deterministic procedural furniture, and share the table URL.
The next milestone is a timed public demo that tests whether a usable 3D encounter
can be prepared in under five minutes.

## What works today

- Create a table, join by URL, and show online participants across browser tabs.
- Spawn and move minis; hide entities and props so player replicas never receive them.
- Import `.dd2vtt`, `.uvtt`, and `.df2vtt` maps: walls, portal gaps, lights, and the
  embedded floor image.
- Draw and edit walls, including endpoint dragging, connected/range selection, and
  bulk height or thickness changes.
- Place, move, rotate, duplicate, hide, and live-edit five procedural prop kinds:
  tables, seats, barrels, crates, and chests.
- Inspect experimental VLM furniture detection in the dev-only `#/lab` harness.

Not built yet: chat, dice, turn tracking, table-scoped guest credentials, production
hosting, and native Dungeondraft-map-to-prop import.

## Layout

- `server/spacetimedb` — SpacetimeDB module (Rust): authoritative scene graph, RLS visibility
- `server/blobd` — development content-addressed storage for imported map images
- `web` — Vite + React + three.js WebGPU client (WebGL2 fallback)
- `scripts/smoke.ts` — live two-client integration and authorization smoke test
- `docs` — current server/client contract and UVTT implementation notes

## Run locally

```bash
pnpm install
spacetime start                                  # local SpacetimeDB (terminal 1)
pnpm blobd                                       # blob store for map images (terminal 2)
spacetime publish 3dvtt --module-path server/spacetimedb    # build + publish the module
spacetime generate --lang typescript --out-dir web/src/module_bindings --module-path server/spacetimedb
pnpm --filter web dev                            # client on http://localhost:5173
```

Open two browser tabs, create a table in one, join by link in the other.

`pnpm smoke` runs a headless two-client test against the published local instance. It
covers create/join, movement sync, walls, lights, map metadata, procedural props,
DM-only reducers, and the RLS guarantee that players never receive hidden rows.

Useful static checks:

```bash
pnpm --filter web test
pnpm --filter web typecheck
pnpm build
(cd server/spacetimedb && cargo check --locked)
```

The furniture-detection lab is available at `http://localhost:5173/#/lab`. Detection
requires `ANTHROPIC_API_KEY` or an authenticated `ant` CLI profile in the environment
running Vite; the lab is an evaluation harness and does not yet create props in a
table.

The local landing-page showcase is available at `http://localhost:5173/#/demo` and
loads `samples/pig-and-whistle-tavern.uvtt` through the real importer and renderer.
Its 40 deterministic props are intentionally staged for product captures; they are
not inferred from the UVTT file. Add `?role=player&shot=wide` (or `role=gm`) to switch
the capture perspective.

## License

AGPL-3.0 — see [LICENSE](LICENSE). The hosted service will run this same code with no
exclusive features; self-hosting is and stays a first-class path.
