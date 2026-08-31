import { useRef, useState } from 'react';
import { reducers } from '../stdb';
import { EntityKind } from '../module_bindings/types';
import type { Entity } from '../module_bindings/types';
import { isUvttError, parse, toWallSegments } from '../lib/uvtt';

const MINI_COLORS = ['#4cc9f0', '#80ed99', '#ffd166', '#c77dff', '#f4a261'];

function spawnSpot(): { x: number; z: number } {
  return { x: (Math.random() - 0.5) * 8, z: (Math.random() - 0.5) * 8 };
}

export default function Toolbar({
  tableId,
  selected,
  onDeselect,
}: {
  tableId: bigint;
  selected: Entity | null;
  onDeselect: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importNote, setImportNote] = useState<string | null>(null);

  async function importFile(file: File) {
    try {
      const map = parse(JSON.parse(await file.text()));
      if (isUvttError(map)) {
        setImportNote(`import failed: ${map.message}`);
        return;
      }
      // Dungeondraft puts walls in line_of_sight; Arkenforge-style exports put
      // them all in objects_line_of_sight — fall back when the primary is empty.
      let walls = toWallSegments(map, {});
      if (walls.length === 0) walls = toWallSegments(map, { includeObjects: true });
      await reducers().importWalls({ tableId, walls });
      setImportNote(`imported ${walls.length} wall segments`);
    } catch (e) {
      setImportNote(`import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div className="hud hud-bottom">
      <input
        ref={fileRef}
        type="file"
        accept=".dd2vtt,.uvtt,.df2vtt,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void importFile(file);
        }}
      />
      <button onClick={() => fileRef.current?.click()}>import map</button>
      <button onClick={() => reducers().clearWalls({ tableId })}>clear walls</button>
      {importNote && <span className="role-note">{importNote}</span>}
      <span className="sep" />
      <button
        onClick={() => {
          const { x, z } = spawnSpot();
          const color = MINI_COLORS[Math.floor(Math.random() * MINI_COLORS.length)];
          reducers().spawnEntity({ tableId, kind: EntityKind.Mini, name: 'mini', color, x, z, hidden: false });
        }}
      >
        + mini
      </button>
      <button
        onClick={() => {
          const { x, z } = spawnSpot();
          reducers().spawnEntity({ tableId, kind: EntityKind.Mini, name: 'monster', color: '#ef476f', x, z, hidden: true });
        }}
      >
        + hidden monster
      </button>
      {selected && (
        <>
          <span className="sep" />
          <span className="selected-name">{selected.name}</span>
          <button onClick={() => reducers().setEntityHidden({ entityId: selected.id, hidden: !selected.hidden })}>
            {selected.hidden ? 'reveal' : 'hide'}
          </button>
          <button
            onClick={() => {
              reducers().deleteEntity({ entityId: selected.id });
              onDeselect();
            }}
          >
            delete
          </button>
        </>
      )}
    </div>
  );
}
