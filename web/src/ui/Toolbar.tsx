import { useEffect, useRef, useState } from 'react';
import { reducers } from '../stdb';
import { EntityKind } from '../module_bindings/types';
import type { Entity, Prop } from '../module_bindings/types';
import { imageBlob, isUvttError, parse, toLights, toWallSegments } from '../lib/uvtt';
import { normalizeTableParams, WOOD_TONES, type TableParams } from '../lib/props';

const randomSeed = () => BigInt(Math.floor(Math.random() * 0xffffffff));

const BLOBD_URI = (import.meta.env.VITE_BLOBD_URI as string | undefined) ?? 'http://localhost:8787';

const MINI_COLORS = ['#4cc9f0', '#80ed99', '#ffd166', '#c77dff', '#f4a261'];

function spawnSpot(): { x: number; z: number } {
  return { x: (Math.random() - 0.5) * 8, z: (Math.random() - 0.5) * 8 };
}

export default function Toolbar({
  tableId,
  selected,
  selectedProp,
  onDeselect,
}: {
  tableId: bigint;
  selected: Entity | null;
  selectedProp: Prop | null;
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
      <button
        onClick={() => {
          const { x, z } = spawnSpot();
          const round = Math.random() < 0.4;
          const params: TableParams = {
            shape: round ? 'round' : 'rect',
            width: round ? 1.2 + Math.random() * 0.5 : 1.4 + Math.random() * 0.8,
            depth: 0.8 + Math.random() * 0.3,
            height: 0.72 + Math.random() * 0.06,
            wood: Math.floor(Math.random() * WOOD_TONES.length),
          };
          reducers().spawnProp({ tableId, kind: 'table', params: JSON.stringify(params), seed: randomSeed(), x, z });
        }}
      >
        + table
      </button>
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
      {selectedProp && <PropPanel prop={selectedProp} tableId={tableId} onDeselect={onDeselect} />}
    </div>
  );
}

function PropPanel({ prop, tableId, onDeselect }: { prop: Prop; tableId: bigint; onDeselect: () => void }) {
  const params = normalizeTableParams(safeParse(prop.params));
  const throttle = useRef<{ timer: ReturnType<typeof setTimeout> | null; next: TableParams | null }>({
    timer: null,
    next: null,
  });
  useEffect(() => {
    const t = throttle.current;
    return () => {
      if (t.timer) clearTimeout(t.timer);
    };
  }, []);

  // Live-edit sync: send at most every 120ms (trailing) so slider drags stream
  // as a handful of row updates, not hundreds.
  function send(next: TableParams) {
    const t = throttle.current;
    t.next = next;
    if (t.timer) return;
    t.timer = setTimeout(() => {
      t.timer = null;
      if (t.next) reducers().updatePropParams({ propId: prop.id, params: JSON.stringify(t.next) });
      t.next = null;
    }, 120);
  }

  return (
    <>
      <span className="sep" />
      <span className="selected-name">{prop.kind}</span>
      <button onClick={() => send({ ...params, shape: params.shape === 'round' ? 'rect' : 'round' })}>
        {params.shape}
      </button>
      <label className="slider">
        w
        <input
          type="range"
          min={0.5}
          max={4}
          step={0.05}
          value={params.width}
          onChange={(e) => send({ ...params, width: Number(e.target.value) })}
        />
      </label>
      {params.shape === 'rect' && (
        <label className="slider">
          d
          <input
            type="range"
            min={0.5}
            max={4}
            step={0.05}
            value={params.depth}
            onChange={(e) => send({ ...params, depth: Number(e.target.value) })}
          />
        </label>
      )}
      <span className="swatches">
        {WOOD_TONES.map((tone, i) => (
          <button
            key={tone}
            className={`swatch ${params.wood === i ? 'swatch-active' : ''}`}
            style={{ background: `#${tone.toString(16).padStart(6, '0')}` }}
            onClick={() => send({ ...params, wood: i })}
          />
        ))}
      </span>
      <button
        onClick={() => {
          // Reroll the jitter: respawn in place with a fresh seed.
          reducers().spawnProp({
            tableId,
            kind: prop.kind,
            params: JSON.stringify(params),
            seed: randomSeed(),
            x: prop.x,
            z: prop.z,
          });
          reducers().deleteProp({ propId: prop.id });
          onDeselect();
        }}
      >
        reroll
      </button>
      <button onClick={() => reducers().setPropHidden({ propId: prop.id, hidden: !prop.hidden })}>
        {prop.hidden ? 'reveal' : 'hide'}
      </button>
      <button
        onClick={() => {
          reducers().deleteProp({ propId: prop.id });
          onDeselect();
        }}
      >
        delete
      </button>
    </>
  );
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}
