import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { store, reducers, sameIdentity } from './stdb';
import type { GameTable } from './module_bindings/types';
import TableScene from './scene/TableScene';
import Toolbar from './ui/Toolbar';

function useSlug(): string | null {
  const [slug, setSlug] = useState(() => parseSlug());
  useEffect(() => {
    const onHash = () => setSlug(parseSlug());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return slug;
}

function parseSlug(): string | null {
  const m = window.location.hash.match(/^#\/t\/([a-z0-9]+)$/);
  return m ? m[1] : null;
}

export default function App() {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const slug = useSlug();
  const [name, setName] = useState(() => sessionStorage.getItem('display_name') ?? '');
  const [selectedId, setSelectedId] = useState<bigint | null>(null);

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
  const tableParticipants = snap.participants.filter((p) => p.tableId === table.id && p.online);

  return (
    <div className="table-view">
      <TableScene
        entities={tableEntities}
        isDm={isDm}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onMove={(id, x, z) => reducers().moveEntity({ entityId: id, x, y: 0, z, rotY: 0 })}
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
          selected={tableEntities.find((e) => e.id === selectedId) ?? null}
          onDeselect={() => setSelectedId(null)}
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
