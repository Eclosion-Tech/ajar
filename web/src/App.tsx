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

function safeParseParams(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json) as unknown;
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function useRoute(): { slug: string | null; lab: boolean } {
  const read = () => ({ slug: parseSlug(), lab: window.location.hash.startsWith('#/lab') });
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
  const { slug, lab } = useRoute();
  const [name, setName] = useState(() => sessionStorage.getItem('display_name') ?? '');
  const [selection, setSelection] = useState<Selection>(null);
  const [placement, setPlacement] = useState<Placement>(null);

  // Stream drag positions at a bounded rate; the final exact position is sent
  // separately on release (after cancel), so nothing is ever dropped.
  const dragThrottle = useRef(
    throttled((type: 'mini' | 'prop', id: bigint, x: number, z: number, rotY: number) => {
      if (type === 'prop') reducers().moveProp({ propId: id, x, z, rotY });
      else reducers().moveEntity({ entityId: id, x, y: 0, z, rotY });
    }, 120),
  ).current;

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
    }
  }, [slug]);

  // Keyboard: Esc exit/deselect · 1-5 arm palette · R rotate · D duplicate · Delete.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable)) return;
      const tbl = snap.tables.find((row) => row.slug === slug);
      if (!tbl) return;
      const dm = sameIdentity(tbl.dmIdentity, snap.identity);

      if (e.key === 'Escape') {
        if (placement) setPlacement(null);
        else setSelection(null);
        return;
      }
      const digit = Number(e.key);
      if (dm && Number.isInteger(digit) && digit >= 1 && digit <= PROP_KINDS.length) {
        const kind = PROP_KINDS[digit - 1];
        setPlacement((p) =>
          p?.kind === kind ? null : { kind, params: draftParams(kind), seed: randomSeed(), rotY: 0 },
        );
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
  }, [slug, snap, selection, placement]);

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

  const armPlacement = (kind: PropKind) =>
    setPlacement((p) =>
      p?.kind === kind ? null : { kind, params: draftParams(kind), seed: randomSeed(), rotY: 0 },
    );

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
        onSelect={setSelection}
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
