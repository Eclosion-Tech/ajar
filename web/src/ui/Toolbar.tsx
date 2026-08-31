import { useRef, useState } from 'react';
import { reducers } from '../stdb';
import { EntityKind } from '../module_bindings/types';
import type { Entity } from '../module_bindings/types';
import { imageBlob, isUvttError, parse, toLights, toWallSegments } from '../lib/uvtt';

const BLOBD_URI = (import.meta.env.VITE_BLOBD_URI as string | undefined) ?? 'http://localhost:8787';

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

      // Center the map on the world origin so it lands under the camera.
      const cx = map.resolution.mapSize.x / 2;
      const cz = map.resolution.mapSize.z / 2;
      walls = walls.map((w) => ({ ...w, ax: w.ax - cx, az: w.az - cz, bx: w.bx - cx, bz: w.bz - cz }));
      const lights = toLights(map).map((l) => ({
        x: l.x - cx,
        z: l.z - cz,
        range: l.range,
        intensity: l.intensity,
        colorRgb: l.colorHex,
      }));

      await reducers().importWalls({ tableId, walls });
      await reducers().importLights({ tableId, lights });

      let imageNote = '';
      const img = imageBlob(map);
      if (img) {
        try {
          const res = await fetch(`${BLOBD_URI}/blobs`, { method: 'PUT', body: new Blob([img.slice()]) });
          if (!res.ok) throw new Error(`blobd ${res.status}`);
          const { url } = (await res.json()) as { url: string };
          await reducers().setMapImage({
            tableId,
            url,
            width: map.resolution.mapSize.x,
            height: map.resolution.mapSize.z,
            offsetX: 0,
            offsetZ: 0,
          });
        } catch {
          imageNote = '; floor image skipped (is blobd running? pnpm blobd)';
        }
      }
      setImportNote(`imported ${walls.length} walls, ${lights.length} lights${imageNote}`);
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
