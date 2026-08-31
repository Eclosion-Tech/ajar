# 3dvtt (working title)

A browser-native 3D virtual tabletop: the table is a URL, the DM pays, players join
free in any browser, no install. See [PROJECT.md](PROJECT.md) for the full thesis and
[docs/CONTRACT.md](docs/CONTRACT.md) for the current module contract.

**Status: walking skeleton.** Two tabs, one table, synced minis, DM-only hidden
entities enforced server-side.

## Layout

- `server/spacetimedb` — SpacetimeDB module (Rust): authoritative scene graph, RLS visibility
- `web` — Vite + React + three.js WebGPU client (WebGL2 fallback)

## Run locally

```bash
spacetime start                                  # local SpacetimeDB (terminal 1)
spacetime publish 3dvtt -p server/spacetimedb    # build + publish the module
spacetime generate --lang typescript --out-dir web/src/module_bindings -p server/spacetimedb
pnpm install
pnpm --filter web dev                            # client on http://localhost:5173
```

Open two browser tabs, create a table in one, join by link in the other.

## License

AGPL-3.0 — see [LICENSE](LICENSE). The hosted service will run this same code with no
exclusive features; self-hosting is and stays a first-class path.
