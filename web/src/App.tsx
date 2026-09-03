import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { store, reducers, sameIdentity } from './stdb';
import type { GameTable } from './module_bindings/types';
import type { Selection } from './selection';
import type { Placement } from './placement';
import { PROP_KINDS, draftParams, randomSeed, rememberParams, type PropKind } from './lib/props/catalog';
import { throttled } from './throttle';
import TableScene from './scene/TableScene';
import Toolbar from './ui/Toolbar';
import ImportLab from './lab/ImportLab';
import DemoTable, { type DemoRole, type DemoShot } from './demo/DemoTable';

function safeParseParams(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json) as unknown;
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function useRoute(): { slug: string | null; lab: boolean; demo: boolean; demoRole: DemoRole; demoShot: DemoShot } {
  const read = () => {
    const hash = window.location.hash;
    const demo = hash.startsWith('#/demo');
    const query = new URLSearchParams(hash.split('?')[1] ?? '');
    return {
      slug: parseSlug(),
      lab: hash.startsWith('#/lab'),
      demo,
      demoRole: query.get('role') === 'player' ? 'player' as const : 'gm' as const,
      demoShot: query.get('shot') === 'wide' ? 'wide' as const : 'hero' as const,
    };
  };
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onHash = () => setRoute(read());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}

function parseSlug(): string | null {
  // Tolerate query params in either position: ?tiled=1#/t/abc or #/t/abc?tiled=1
  const m = window.location.hash.match(/^#\/t\/([a-z0-9]+)(?:[?&].*)?$/);
  return m ? m[1] : null;
}

export default function App() {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { slug, lab, demo, demoRole, demoShot } = useRoute();
  const [name, setName] = useState(() => sessionStorage.getItem('display_name') ?? '');
  const [selection, setSelection] = useState<Selection>(null);
  const [placement, setPlacement] = useState<Placement>(null);
  // Walls fork their own multi-selection (a bar run is many segments); never
  // mixed with the single prop/mini selection.
  const [wallSelection, setWallSelection] = useState<ReadonlySet<bigint>>(new Set());
  const [wallDraw, setWallDraw] = useState<null | { start: { x: number; z: number } | null }>(null);

  // Stream drag positions at a bounded rate; the final exact position is sent
  // separately on release (after cancel), so nothing is ever dropped.
  const dragThrottle = useRef(
    throttled((type: 'mini' | 'prop', id: bigint, x: number, z: number, rotY: number) => {
      if (type === 'prop') reducers().moveProp({ propId: id, x, z, rotY });
      else reducers().moveEntity({ entityId: id, x, y: 0, z, rotY });
    }, 120),
  ).current;
  const wallThrottle = useRef(
    throttled(
      (id: bigint, ax: number, az: number, bx: number, bz: number, height: number, thickness: number) =>
        reducers().updateWall({ wallId: id, ax, az, bx, bz, height, thickness }),
      120,
    ),
  ).current;
  const lastWallClick = useRef<{ id: bigint; at: number } | null>(null);
  const wallAnchor = useRef<bigint | null>(null);

  const table: GameTable | undefined = snap.tables.find((t) => t.slug === slug);
  const isDm = table ? sameIdentity(table.dmIdentity, snap.identity) : false;

  // Join once per (connection, slug) after the subscription lands.
  const joinedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!snap.subscribed || !slug || !table || !name) return;
    const key = `${slug}`;
    if (joinedFor.current === key) return;
    joinedFor.current = key;
    reducers().joinTable({ slug, displayName: name });
  }, [snap.subscribed, slug, table, name]);

  // Clear stale state: a deleted row must not linger as a selection, and
  // leaving the table drops any armed placement.
  useEffect(() => {
    if (!selection) return;
    const exists =
      selection.type === 'prop'
        ? snap.props.some((p) => p.id === selection.id)
        : snap.entities.some((e) => e.id === selection.id);
    if (!exists) setSelection(null);
  }, [snap.props, snap.entities, selection]);

  useEffect(() => {
    if (!slug) {
      setPlacement(null);
      setSelection(null);
      setWallSelection(new Set());
      setWallDraw(null);
    }
  }, [slug]);

  // Prune wall selection ids whose rows disappeared; drop the range-select
  // anchor when the selection empties.
  useEffect(() => {
    if (wallSelection.size === 0) {
      wallAnchor.current = null;
      return;
    }
    const live = new Set([...wallSelection].filter((id) => snap.walls.some((w) => w.id === id)));
    if (live.size !== wallSelection.size) setWallSelection(live);
  }, [snap.walls, wallSelection]);

  // Keyboard: Esc exit/deselect · 1-5 arm palette · R rotate · D duplicate · Delete.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable)) return;
      const tbl = snap.tables.find((row) => row.slug === slug);
      if (!tbl) return;
      const dm = sameIdentity(tbl.dmIdentity, snap.identity);

      if (e.key === 'Escape') {
        if (wallDraw?.start) setWallDraw({ start: null });
        else if (wallDraw) setWallDraw(null);
        else if (placement) setPlacement(null);
        else if (wallSelection.size > 0) setWallSelection(new Set());
        else setSelection(null);
        return;
      }
      if (dm && e.key === '6') {
        setWallDraw((w) => (w ? null : { start: null }));
        setPlacement(null);
        setWallSelection(new Set());
        return;
      }
      const digit = Number(e.key);
      if (dm && Number.isInteger(digit) && digit >= 1 && digit <= PROP_KINDS.length) {
        const kind = PROP_KINDS[digit - 1];
        setPlacement((p) =>
          p?.kind === kind ? null : { kind, params: draftParams(kind), seed: randomSeed(), rotY: 0 },
        );
        setWallDraw(null);
        setWallSelection(new Set());
        return;
      }
      if (e.key === 'r' || e.key === 'R') {
        if (placement) {
          setPlacement({ ...placement, rotY: placement.rotY + Math.PI / 4 });
        } else if (dm && selection?.type === 'prop') {
          const row = snap.props.find((p) => p.id === selection.id);
          if (row) reducers().moveProp({ propId: row.id, x: row.x, z: row.z, rotY: row.rotY + Math.PI / 4 });
        }
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && dm && wallSelection.size > 0) {
        for (const id of wallSelection) reducers().deleteWall({ wallId: id });
        setWallSelection(new Set());
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && dm && selection) {
        if (selection.type === 'prop') reducers().deleteProp({ propId: selection.id });
        else reducers().deleteEntity({ entityId: selection.id });
        setSelection(null);
        return;
      }
      if ((e.key === 'd' || e.key === 'D') && dm && selection?.type === 'prop') {
        const row = snap.props.find((p) => p.id === selection.id);
        if (row && (PROP_KINDS as readonly string[]).includes(row.kind)) {
          setPlacement({
            kind: row.kind as PropKind,
            params: safeParseParams(row.params),
            seed: randomSeed(),
            rotY: row.rotY,
          });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [slug, snap, selection, placement, wallSelection, wallDraw]);

  // The showcase is a deterministic, server-free rendering of the real
  // importer, scene, prop generators, lighting, and player visibility rules.
  if (demo) return <DemoTable role={demoRole} shot={demoShot} />;

  // The import lab needs no table connection.
  if (lab) return <ImportLab />;

  if (!snap.connected || !snap.subscribed) {
    return <div className="center-note">connecting to table server…</div>;
  }

  if (!name) {
    return <NamePrompt onSubmit={(n) => { sessionStorage.setItem('display_name', n); setName(n); }} />;
  }

  if (!slug) {
    return <Lobby name={name} tables={snap.tables} />;
  }

  if (!table) {
    return (
      <div className="center-note">
        table <code>{slug}</code> not found — <a href="#/">back to lobby</a>
      </div>
    );
  }

  const tableEntities = snap.entities.filter((e) => e.tableId === table.id);
  const tableWalls = snap.walls.filter((w) => w.tableId === table.id);
  const tableLights = snap.lights.filter((l) => l.tableId === table.id);
  const tableMapImage = snap.mapImages.find((m) => m.tableId === table.id) ?? null;
  const tableProps = snap.props.filter((p) => p.tableId === table.id);
  const tableParticipants = snap.participants.filter((p) => p.tableId === table.id && p.online);

  const rowRotY = (type: 'mini' | 'prop', id: bigint): number =>
    type === 'prop'
      ? (tableProps.find((p) => p.id === id)?.rotY ?? 0)
      : (tableEntities.find((e) => e.id === id)?.rotY ?? 0);

  const armPlacement = (kind: PropKind) => {
    setPlacement((p) =>
      p?.kind === kind ? null : { kind, params: draftParams(kind), seed: randomSeed(), rotY: 0 },
    );
    setWallDraw(null);
    setWallSelection(new Set());
  };

  const wallsTouch = (a: (typeof tableWalls)[number], b: (typeof tableWalls)[number]) => {
    const eps = 0.02;
    const near = (x1: number, z1: number, x2: number, z2: number) => Math.hypot(x1 - x2, z1 - z2) < eps;
    return (
      near(a.ax, a.az, b.ax, b.az) ||
      near(a.ax, a.az, b.bx, b.bz) ||
      near(a.bx, a.bz, b.ax, b.az) ||
      near(a.bx, a.bz, b.bx, b.bz)
    );
  };

  // BFS shortest path through the wall graph, for click + shift-click range select.
  const findWallPath = (fromId: bigint, toId: bigint): bigint[] | null => {
    const parent = new Map<bigint, bigint | null>([[fromId, null]]);
    const queue = [fromId];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur === toId) break;
      const w = tableWalls.find((row) => row.id === cur);
      if (!w) continue;
      for (const o of tableWalls) {
        if (parent.has(o.id)) continue;
        if (wallsTouch(w, o)) {
          parent.set(o.id, cur);
          queue.push(o.id);
        }
      }
    }
    if (!parent.has(toId)) return null;
    const path: bigint[] = [];
    let cur: bigint | null = toId;
    while (cur !== null) {
      path.push(cur);
      cur = parent.get(cur) ?? null;
    }
    return path;
  };

  const selectWall = (id: bigint, additive: boolean) => {
    setSelection(null);
    // Double-click detection lives here (not in the scene) because this is
    // the one place clicks provably arrive.
    const prev = lastWallClick.current;
    const now = performance.now();
    lastWallClick.current = { id, at: now };
    if (prev && prev.id === id && now - prev.at < 400) {
      lastWallClick.current = null;
      chainSelectWall(id);
      return;
    }
    const anchor = wallAnchor.current;
    wallAnchor.current = id;
    // Shift-click with an anchor: select the connected run between the two
    // clicks (file-manager range select over the wall graph).
    if (additive && anchor !== null && anchor !== id) {
      const path = findWallPath(anchor, id);
      if (path) {
        setWallSelection((prevSel) => new Set([...prevSel, ...path]));
        return;
      }
    }
    setWallSelection((prevSel) => {
      const next = new Set(additive ? prevSel : []);
      if (additive && next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Walk connected segments (shared endpoints) — the whole bar in one gesture.
  const chainSelectWall = (id: bigint) => {
    const eps = 0.02;
    const near = (x1: number, z1: number, x2: number, z2: number) => Math.hypot(x1 - x2, z1 - z2) < eps;
    const selected = new Set<bigint>([id]);
    const queue = [id];
    while (queue.length > 0) {
      const w = tableWalls.find((row) => row.id === queue.pop());
      if (!w) continue;
      for (const o of tableWalls) {
        if (selected.has(o.id)) continue;
        if (
          near(w.ax, w.az, o.ax, o.az) ||
          near(w.ax, w.az, o.bx, o.bz) ||
          near(w.bx, w.bz, o.ax, o.az) ||
          near(w.bx, w.bz, o.bx, o.bz)
        ) {
          selected.add(o.id);
          queue.push(o.id);
        }
      }
    }
    setSelection(null);
    setWallSelection(selected);
  };

  return (
    <div className="table-view">
      <TableScene
        entities={tableEntities}
        walls={tableWalls}
        lights={tableLights}
        mapImage={tableMapImage}
        props={tableProps}
        isDm={isDm}
        selection={selection}
        placement={isDm ? placement : null}
        wallSelection={wallSelection}
        wallDraw={isDm ? wallDraw : null}
        onSelect={(sel) => {
          setSelection(sel);
          if (sel) setWallSelection(new Set());
          else setWallSelection(new Set());
        }}
        onWallClick={selectWall}
        onWallEndpoint={(id, end, x, z, commit) => {
          const w = tableWalls.find((row) => row.id === id);
          if (!w) return;
          const [ax, az, bx, bz] = end === 'a' ? [x, z, w.bx, w.bz] : [w.ax, w.az, x, z];
          if (commit) {
            wallThrottle.cancel();
            reducers().updateWall({ wallId: id, ax, az, bx, bz, height: w.height, thickness: w.thickness });
          } else {
            wallThrottle.call(id, ax, az, bx, bz, w.height, w.thickness);
          }
        }}
        onWallDrawPoint={(x, z) => {
          if (!wallDraw) return;
          if (!wallDraw.start) {
            setWallDraw({ start: { x, z } });
            return;
          }
          const s = wallDraw.start;
          if (Math.hypot(x - s.x, z - s.z) < 0.05) return;
          reducers().addWall({ tableId: table.id, ax: s.x, az: s.z, bx: x, bz: z, height: 2.5, thickness: 0.15 });
          setWallDraw({ start: { x, z } });
        }}
        onPlace={(x, z, rotY) => {
          if (!placement) return;
          reducers().spawnProp({
            tableId: table.id,
            kind: placement.kind,
            params: JSON.stringify(placement.params),
            seed: placement.seed,
            x,
            z,
            rotY,
          });
          rememberParams(placement.kind, placement.params);
          setPlacement({ ...placement, seed: randomSeed(), rotY });
        }}
        onDragMove={(type, id, x, z) => dragThrottle.call(type, id, x, z, rowRotY(type, id))}
        onDragEnd={(type, id, x, z) => {
          dragThrottle.cancel();
          const rotY = rowRotY(type, id);
          if (type === 'prop') reducers().moveProp({ propId: id, x, z, rotY });
          else reducers().moveEntity({ entityId: id, x, y: 0, z, rotY });
        }}
      />
      <div className="hud hud-top">
        <span className="table-name">{table.name}</span>
        <button
          onClick={() => {
            navigator.clipboard.writeText(window.location.href);
          }}
        >
          copy join link
        </button>
        <span className="participants">
          {tableParticipants.map((p) => (
            <span key={p.id.toString()} className={`badge ${p.role.tag === 'Dm' ? 'badge-dm' : ''}`}>
              {p.displayName}
            </span>
          ))}
        </span>
        <span className="role-note">{isDm ? 'you are the DM' : 'player'}</span>
      </div>
      {isDm && (
        <Toolbar
          tableId={table.id}
          placement={placement}
          onArm={armPlacement}
          wallDrawArmed={wallDraw !== null}
          onArmWall={() => {
            setWallDraw((w) => (w ? null : { start: null }));
            setPlacement(null);
            setWallSelection(new Set());
          }}
          selectedWalls={tableWalls.filter((w) => wallSelection.has(w.id))}
          onClearWallSelection={() => setWallSelection(new Set())}
          onChainSelect={() => {
            const first = tableWalls.find((w) => wallSelection.has(w.id));
            if (first) chainSelectWall(first.id);
          }}
          selected={
            selection?.type === 'mini' ? (tableEntities.find((e) => e.id === selection.id) ?? null) : null
          }
          selectedProp={
            selection?.type === 'prop' ? (tableProps.find((p) => p.id === selection.id) ?? null) : null
          }
          onDeselect={() => setSelection(null)}
        />
      )}
    </div>
  );
}

function NamePrompt({ onSubmit }: { onSubmit: (name: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <form
      className="center-note"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSubmit(value.trim());
      }}
    >
      <label>
        what should the table call you?
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <button type="submit">continue</button>
    </form>
  );
}

function Lobby({ name, tables }: { name: string; tables: GameTable[] }) {
  const snap = store.getSnapshot();
  const [tableName, setTableName] = useState('');
  const pendingSince = useRef<Set<string> | null>(null);

  // After create_table, the new row (dm = us) arrives via subscription; navigate to it.
  useEffect(() => {
    if (!pendingSince.current) return;
    const mine = tables.find(
      (t) => sameIdentity(t.dmIdentity, snap.identity) && !pendingSince.current!.has(t.id.toString()),
    );
    if (mine) {
      pendingSince.current = null;
      window.location.hash = `/t/${mine.slug}`;
    }
  }, [tables, snap.identity]);

  return (
    <form
      className="center-note"
      onSubmit={(e) => {
        e.preventDefault();
        if (!tableName.trim()) return;
        pendingSince.current = new Set(tables.map((t) => t.id.toString()));
        reducers().createTable({ name: tableName.trim(), displayName: name });
      }}
    >
      <h1>3dvtt</h1>
      <p>hey {name} — start a table, then share the link.</p>
      <label>
        table name
        <input autoFocus value={tableName} onChange={(e) => setTableName(e.target.value)} />
      </label>
      <button type="submit">create table</button>
    </form>
  );
}
