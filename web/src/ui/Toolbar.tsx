import { useEffect, useRef, useState } from 'react';
import { reducers } from '../stdb';
import { EntityKind } from '../module_bindings/types';
import type { Entity, Prop, Wall } from '../module_bindings/types';
import { throttled } from '../throttle';
import { imageBlob, isUvttError, parse, toLights, toWallSegments } from '../lib/uvtt';
import { WOOD_TONES } from '../lib/props';
import { PROP_KINDS, randomSeed, type PropKind } from '../lib/props/catalog';
import type { Placement } from '../placement';

// Per-kind param panel schemas. Generators normalize/clamp server-agnostically,
// so the panel only needs sensible ranges, not validation.
const PROP_PANELS: Record<
  string,
  {
    cycle?: { key: string; values: readonly string[] };
    sliders: { key: string; label: string; min: number; max: number }[];
  }
> = {
  table: {
    cycle: { key: 'shape', values: ['rect', 'round'] },
    sliders: [
      { key: 'width', label: 'w', min: 0.5, max: 4 },
      { key: 'depth', label: 'd', min: 0.5, max: 4 },
      { key: 'height', label: 'h', min: 0.5, max: 1.1 },
    ],
  },
  seat: {
    cycle: { key: 'style', values: ['stool', 'chair', 'bench'] },
    sliders: [{ key: 'width', label: 'w', min: 0.35, max: 3 }],
  },
  barrel: {
    sliders: [
      { key: 'radius', label: 'r', min: 0.15, max: 0.5 },
      { key: 'height', label: 'h', min: 0.4, max: 1.1 },
    ],
  },
  crate: {
    sliders: [
      { key: 'width', label: 'w', min: 0.3, max: 1.5 },
      { key: 'depth', label: 'd', min: 0.3, max: 1.5 },
      { key: 'height', label: 'h', min: 0.3, max: 1.5 },
    ],
  },
  chest: {
    sliders: [
      { key: 'width', label: 'w', min: 0.4, max: 1.4 },
      { key: 'depth', label: 'd', min: 0.25, max: 1 },
      { key: 'height', label: 'h', min: 0.25, max: 1 },
    ],
  },
};


const BLOBD_URI = (import.meta.env.VITE_BLOBD_URI as string | undefined) ?? 'http://localhost:8787';

const MINI_COLORS = ['#4cc9f0', '#80ed99', '#ffd166', '#c77dff', '#f4a261'];

function spawnSpot(): { x: number; z: number } {
  return { x: (Math.random() - 0.5) * 8, z: (Math.random() - 0.5) * 8 };
}

export default function Toolbar({
  tableId,
  selected,
  selectedProp,
  placement,
  onArm,
  wallDrawArmed,
  onArmWall,
  selectedWalls,
  onClearWallSelection,
  onDeselect,
}: {
  tableId: bigint;
  selected: Entity | null;
  selectedProp: Prop | null;
  placement: Placement;
  onArm: (kind: PropKind) => void;
  wallDrawArmed: boolean;
  onArmWall: () => void;
  selectedWalls: Wall[];
  onClearWallSelection: () => void;
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
      <span className="sep" />
      {PROP_KINDS.map((kind, i) => (
        <button
          key={kind}
          className={`chip ${placement?.kind === kind ? 'chip-active' : ''}`}
          onClick={() => onArm(kind)}
        >
          <span className="chip-key">{i + 1}</span> {kind}
        </button>
      ))}
      <button className={`chip ${wallDrawArmed ? 'chip-active' : ''}`} onClick={onArmWall}>
        <span className="chip-key">6</span> wall
      </button>
      {placement && (
        <span className="mode-strip">
          placing {placement.kind} · click place · R rotate · alt free · esc done
        </span>
      )}
      {wallDrawArmed && (
        <span className="mode-strip">
          drawing walls · click to chain · shift axis-lock · alt free · esc done
        </span>
      )}
      {selectedWalls.length > 0 && (
        <WallPanel walls={selectedWalls} onClear={onClearWallSelection} />
      )}
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
  const params = safeParse(prop.params) as Record<string, unknown>;
  const schema = PROP_PANELS[prop.kind] ?? { sliders: [] };
  const throttle = useRef<{ timer: ReturnType<typeof setTimeout> | null; next: Record<string, unknown> | null }>({
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
  function send(patch: Record<string, unknown>) {
    const t = throttle.current;
    t.next = { ...params, ...t.next, ...patch };
    if (t.timer) return;
    t.timer = setTimeout(() => {
      t.timer = null;
      if (t.next) reducers().updatePropParams({ propId: prop.id, params: JSON.stringify(t.next) });
      t.next = null;
    }, 120);
  }

  const num = (key: string, fallback: number) => {
    const v = params[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  };

  return (
    <>
      <span className="sep" />
      <span className="selected-name">{prop.kind}</span>
      {schema.cycle && (
        <button
          onClick={() => {
            const values = schema.cycle!.values;
            const current = String(params[schema.cycle!.key] ?? values[0]);
            const next = values[(values.indexOf(current) + 1) % values.length];
            send({ [schema.cycle!.key]: next });
          }}
        >
          {String(params[schema.cycle.key] ?? schema.cycle.values[0])}
        </button>
      )}
      {schema.sliders.map((s) => (
        <label key={s.key} className="slider">
          {s.label}
          <input
            type="range"
            min={s.min}
            max={s.max}
            step={0.05}
            value={num(s.key, (s.min + s.max) / 2)}
            onChange={(e) => send({ [s.key]: Number(e.target.value) })}
          />
        </label>
      ))}
      <span className="swatches">
        {WOOD_TONES.map((tone, i) => (
          <button
            key={tone}
            className={`swatch ${num('wood', 0) === i ? 'swatch-active' : ''}`}
            style={{ background: `#${tone.toString(16).padStart(6, '0')}` }}
            onClick={() => send({ wood: i })}
          />
        ))}
      </span>
      <button
        onClick={() =>
          reducers().moveProp({ propId: prop.id, x: prop.x, z: prop.z, rotY: prop.rotY + Math.PI / 4 })
        }
      >
        rotate
      </button>
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
            rotY: prop.rotY,
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

function WallPanel({ walls, onClear }: { walls: Wall[]; onClear: () => void }) {
  const first = walls[0];
  // One throttle for the whole selection; ids resolved at send time.
  const send = useRef(
    throttled((rows: Wall[], height: number, thickness: number) => {
      for (const w of rows) {
        reducers().updateWall({ wallId: w.id, ax: w.ax, az: w.az, bx: w.bx, bz: w.bz, height, thickness });
      }
    }, 150),
  ).current;
  useEffect(() => () => send.flush(), [send]);

  return (
    <>
      <span className="sep" />
      <span className="selected-name">
        {walls.length} wall{walls.length > 1 ? 's' : ''}
      </span>
      <label className="slider">
        h
        <input
          type="range"
          min={0.2}
          max={4}
          step={0.05}
          value={first.height}
          onChange={(e) => send.call(walls, Number(e.target.value), first.thickness)}
        />
      </label>
      <label className="slider">
        t
        <input
          type="range"
          min={0.05}
          max={0.6}
          step={0.01}
          value={first.thickness}
          onChange={(e) => send.call(walls, first.height, Number(e.target.value))}
        />
      </label>
      <button
        onClick={() => {
          for (const w of walls) reducers().deleteWall({ wallId: w.id });
          onClear();
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
