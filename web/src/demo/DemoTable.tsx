import { useEffect, useMemo, useRef, useState } from 'react';
import TableScene from '../scene/TableScene';
import { isUvttError, parse, toLights, toWallSegments } from '../lib/uvtt';
import { PROP_KINDS, draftParams, randomSeed, type PropKind } from '../lib/props/catalog';
import type { Placement } from '../placement';
import type { Selection } from '../selection';
import type { Entity, Light, MapImage, Prop, Wall } from '../module_bindings/types';

export type DemoRole = 'gm' | 'player';
export type DemoShot = 'hero' | 'wide';

type DemoScene = {
  walls: Wall[];
  lights: Light[];
  mapImage: MapImage;
};

type WallDraw = { start: { x: number; z: number } | null } | null;

type PropSpec = {
  kind: 'table' | 'seat' | 'barrel' | 'crate' | 'chest';
  params: Record<string, unknown>;
  x: number;
  z: number;
  rot?: number;
  hidden?: boolean;
};

const TABLE = 1n;
const PLAYER_MINI = 101n;
const NO_IDENTITY = null as never;
const angle = (degrees: number) => (degrees * Math.PI) / 180;

const propSpecs: PropSpec[] = [
  { kind: 'table', params: { shape: 'round', width: 2.1, depth: 1, height: 0.76, wood: 1 }, x: -8.1, z: 1.1, rot: angle(7) },
  { kind: 'seat', params: { style: 'chair', width: 0.52, wood: 1 }, x: -9.5, z: 1.1, rot: angle(90) },
  { kind: 'seat', params: { style: 'chair', width: 0.52, wood: 1 }, x: -6.7, z: 1.1, rot: angle(-90) },
  { kind: 'seat', params: { style: 'chair', width: 0.52, wood: 1 }, x: -8.1, z: -0.35 },
  { kind: 'seat', params: { style: 'chair', width: 0.52, wood: 1 }, x: -8.1, z: 2.55, rot: angle(180) },

  { kind: 'table', params: { shape: 'round', width: 1.75, depth: 1, height: 0.75, wood: 3 }, x: -9.1, z: 5.35 },
  { kind: 'seat', params: { style: 'chair', width: 0.48, wood: 3 }, x: -10.35, z: 5.4, rot: angle(90) },
  { kind: 'seat', params: { style: 'chair', width: 0.48, wood: 3 }, x: -7.85, z: 5.4, rot: angle(-90) },
  { kind: 'seat', params: { style: 'chair', width: 0.48, wood: 3 }, x: -9.1, z: 4.1 },

  { kind: 'table', params: { shape: 'round', width: 2.15, depth: 1, height: 0.76, wood: 0 }, x: -4.25, z: 8.0 },
  { kind: 'seat', params: { style: 'chair', width: 0.52, wood: 0 }, x: -5.75, z: 8.0, rot: angle(90) },
  { kind: 'seat', params: { style: 'chair', width: 0.52, wood: 0 }, x: -2.75, z: 8.0, rot: angle(-90) },
  { kind: 'seat', params: { style: 'chair', width: 0.52, wood: 0 }, x: -4.25, z: 6.55 },

  { kind: 'table', params: { shape: 'rect', width: 3.0, depth: 1.25, height: 0.76, wood: 1 }, x: 2.0, z: 4.0 },
  { kind: 'seat', params: { style: 'bench', width: 2.35, wood: 1 }, x: 2.0, z: 2.95 },
  { kind: 'seat', params: { style: 'bench', width: 2.35, wood: 1 }, x: 2.0, z: 5.05, rot: angle(180) },
  { kind: 'table', params: { shape: 'rect', width: 3.15, depth: 1.3, height: 0.76, wood: 3 }, x: 7.55, z: 4.0 },
  { kind: 'seat', params: { style: 'chair', width: 0.5, wood: 3 }, x: 6.35, z: 2.95 },
  { kind: 'seat', params: { style: 'chair', width: 0.5, wood: 3 }, x: 7.55, z: 2.95 },
  { kind: 'seat', params: { style: 'chair', width: 0.5, wood: 3 }, x: 8.75, z: 2.95 },
  { kind: 'seat', params: { style: 'chair', width: 0.5, wood: 3 }, x: 6.35, z: 5.05, rot: angle(180) },
  { kind: 'seat', params: { style: 'chair', width: 0.5, wood: 3 }, x: 7.55, z: 5.05, rot: angle(180) },
  { kind: 'seat', params: { style: 'chair', width: 0.5, wood: 3 }, x: 8.75, z: 5.05, rot: angle(180) },

  { kind: 'table', params: { shape: 'rect', width: 2.2, depth: 1.15, height: 0.76, wood: 0 }, x: 4.2, z: -6.7, rot: angle(2) },
  { kind: 'seat', params: { style: 'chair', width: 0.52, wood: 0 }, x: 2.85, z: -6.7, rot: angle(90) },
  { kind: 'seat', params: { style: 'chair', width: 0.52, wood: 0 }, x: 5.55, z: -6.7, rot: angle(-90) },

  { kind: 'seat', params: { style: 'stool', width: 0.44, wood: 1 }, x: 0.3, z: -2.35, rot: angle(180) },
  { kind: 'seat', params: { style: 'stool', width: 0.44, wood: 1 }, x: 1.45, z: -2.35, rot: angle(180) },
  { kind: 'seat', params: { style: 'stool', width: 0.44, wood: 1 }, x: 2.6, z: -2.35, rot: angle(180) },
  { kind: 'seat', params: { style: 'stool', width: 0.44, wood: 1 }, x: 3.75, z: -2.35, rot: angle(180) },
  { kind: 'seat', params: { style: 'stool', width: 0.44, wood: 1 }, x: 4.9, z: -2.35, rot: angle(180) },

  { kind: 'barrel', params: { radius: 0.37, height: 0.82, wood: 3 }, x: -11.8, z: -5.8 },
  { kind: 'barrel', params: { radius: 0.34, height: 0.74, wood: 0 }, x: -10.8, z: -5.6 },
  { kind: 'barrel', params: { radius: 0.36, height: 0.78, wood: 1 }, x: -12.4, z: -4.7 },
  { kind: 'barrel', params: { radius: 0.33, height: 0.7, wood: 3 }, x: -11.35, z: -4.45 },
  { kind: 'crate', params: { width: 0.85, depth: 0.72, height: 0.76, wood: 0 }, x: -8.1, z: -5.1, rot: angle(9) },
  { kind: 'crate', params: { width: 0.75, depth: 0.7, height: 0.69, wood: 1 }, x: -7.2, z: -4.7, rot: angle(-6) },
  { kind: 'crate', params: { width: 0.9, depth: 0.76, height: 0.8, wood: 3 }, x: -8.7, z: -4.1, rot: angle(5) },
  { kind: 'chest', params: { width: 1.05, depth: 0.63, height: 0.63, wood: 1 }, x: -12.5, z: 4.2, rot: angle(-11) },
  { kind: 'chest', params: { width: 0.9, depth: 0.54, height: 0.58, wood: 3 }, x: 9.9, z: -1.3, rot: angle(90), hidden: true },
];

const demoProps: Prop[] = propSpecs.map((spec, index) => ({
  id: BigInt(index + 1),
  tableId: TABLE,
  dmIdentity: NO_IDENTITY,
  kind: spec.kind,
  params: JSON.stringify(spec.params),
  seed: BigInt(0xa7a000 + index * 997),
  x: spec.x,
  z: spec.z,
  rotY: spec.rot ?? 0,
  hidden: spec.hidden ?? false,
})) as Prop[];

const demoEntities = [
  { id: 101n, name: 'Mira Thorne', color: '#4cc9f0', x: -0.5, z: 1.0, hidden: false },
  { id: 102n, name: 'Brother Fen', color: '#ffd166', x: 0.8, z: 2.0, hidden: false },
  { id: 103n, name: 'Kestrel', color: '#80ed99', x: -1.7, z: 2.55, hidden: false },
  { id: 104n, name: 'The Cellar Thing', color: '#ef476f', x: -10.4, z: -7.0, hidden: true },
].map((entity) => ({
  ...entity,
  tableId: TABLE,
  dmIdentity: NO_IDENTITY,
  kind: { tag: 'Mini' },
  y: 0,
  rotY: 0,
  createdBy: NO_IDENTITY,
})) as Entity[];

function imageDataUrl(base64: string): string {
  const mime = base64.startsWith('iVBOR') ? 'image/png' : base64.startsWith('UklGR') ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${base64}`;
}

export default function DemoTable({ role, shot }: { role: DemoRole; shot: DemoShot }) {
  const [scene, setScene] = useState<DemoScene | null>(null);
  const [propRows, setPropRows] = useState<Prop[]>(() => demoProps.map((prop) => ({ ...prop })));
  const [entityRows, setEntityRows] = useState<Entity[]>(() => demoEntities.map((entity) => ({ ...entity })));
  const [selection, setSelection] = useState<Selection>(null);
  const [placement, setPlacement] = useState<Placement>(null);
  const [wallSelection, setWallSelection] = useState<ReadonlySet<bigint>>(new Set());
  const [wallDraw, setWallDraw] = useState<WallDraw>(null);
  const [error, setError] = useState<string | null>(null);
  const initialScene = useRef<DemoScene | null>(null);
  const nextWallId = useRef(10_000n);
  const nextPropId = useRef(10_000n);
  const isDm = role === 'gm';

  useEffect(() => {
    let cancelled = false;
    fetch('/demo/pig-and-whistle.uvtt')
      .then((response) => {
        if (!response.ok) throw new Error(`fixture returned ${response.status}`);
        return response.json() as Promise<unknown>;
      })
      .then((raw) => {
        const map = parse(raw);
        if (isUvttError(map)) throw new Error(map.message);
        if (!map.image) throw new Error('fixture has no embedded floor image');
        const cx = map.resolution.mapSize.x / 2;
        const cz = map.resolution.mapSize.z / 2;
        const wallRows = toWallSegments(map, { includeObjects: true }).map((wall, index) => ({
          ...wall,
          id: BigInt(index + 1),
          tableId: TABLE,
          ax: wall.ax - cx,
          az: wall.az - cz,
          bx: wall.bx - cx,
          bz: wall.bz - cz,
        })) as Wall[];
        const lightRows = toLights(map).map((light, index) => ({
          id: BigInt(index + 1),
          tableId: TABLE,
          x: light.x - cx,
          z: light.z - cz,
          range: light.range,
          intensity: light.intensity,
          colorRgb: light.colorHex,
        })) as Light[];
        if (!cancelled) {
          const loadedScene = {
            walls: wallRows,
            lights: lightRows,
            mapImage: {
              id: 1n,
              tableId: TABLE,
              url: imageDataUrl(map.image),
              width: map.resolution.mapSize.x,
              height: map.resolution.mapSize.z,
              offsetX: 0,
              offsetZ: 0,
            },
          } satisfies DemoScene;
          initialScene.current = loadedScene;
          setScene(loadedScene);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (isDm) return;
    setSelection(null);
    setPlacement(null);
    setWallSelection(new Set());
    setWallDraw(null);
  }, [isDm]);

  const visibleProps = useMemo(() => isDm ? propRows : propRows.filter((prop) => !prop.hidden), [isDm, propRows]);
  const visibleEntities = useMemo(
    () => isDm ? entityRows : entityRows.filter((entity) => !entity.hidden),
    [entityRows, isDm],
  );
  const camera = shot === 'wide'
    ? { position: [13, 20, 17] as [number, number, number], target: [0, 0, 0] as [number, number, number], fov: 47 }
    : { position: [8.5, 12.5, 11] as [number, number, number], target: [-0.5, 0, 1.7] as [number, number, number], fov: 46 };

  const armPlacement = (kind: PropKind) => {
    if (!isDm) return;
    setPlacement((current) => current?.kind === kind
      ? null
      : { kind, params: draftParams(kind), seed: randomSeed(), rotY: 0 });
    setWallDraw(null);
    setWallSelection(new Set());
    setSelection(null);
  };

  const armWallDraw = () => {
    if (!isDm) return;
    setWallDraw((current) => current ? null : { start: null });
    setPlacement(null);
    setWallSelection(new Set());
    setSelection(null);
  };

  const deleteSelection = () => {
    if (!isDm) return;
    if (wallSelection.size > 0) {
      setScene((current) => current && ({
        ...current,
        walls: current.walls.filter((wall) => !wallSelection.has(wall.id)),
      }));
      setWallSelection(new Set());
      return;
    }
    if (!selection) return;
    if (selection.type === 'prop') {
      setPropRows((rows) => rows.filter((prop) => prop.id !== selection.id));
    } else {
      setEntityRows((rows) => rows.filter((entity) => entity.id !== selection.id));
    }
    setSelection(null);
  };

  const resetDemo = () => {
    if (!isDm) return;
    const original = initialScene.current;
    if (original) {
      setScene({
        ...original,
        walls: original.walls.map((wall) => ({ ...wall })),
        lights: original.lights.map((light) => ({ ...light })),
        mapImage: { ...original.mapImage },
      });
    }
    setPropRows(demoProps.map((prop) => ({ ...prop })));
    setEntityRows(demoEntities.map((entity) => ({ ...entity })));
    setSelection(null);
    setPlacement(null);
    setWallSelection(new Set());
    setWallDraw(null);
    nextWallId.current = 10_000n;
    nextPropId.current = 10_000n;
  };

  useEffect(() => {
    if (!isDm) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable)) return;
      if (event.key === 'Escape') {
        if (wallDraw?.start) setWallDraw({ start: null });
        else if (wallDraw) setWallDraw(null);
        else if (placement) setPlacement(null);
        else if (wallSelection.size > 0) setWallSelection(new Set());
        else setSelection(null);
        return;
      }
      if (event.key === '6') {
        armWallDraw();
        return;
      }
      const digit = Number(event.key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= PROP_KINDS.length) {
        armPlacement(PROP_KINDS[digit - 1]);
        return;
      }
      if (event.key === 'r' || event.key === 'R') {
        if (placement) {
          setPlacement({ ...placement, rotY: placement.rotY + Math.PI / 4 });
        } else if (selection?.type === 'prop') {
          setPropRows((rows) => rows.map((prop) => prop.id === selection.id
            ? { ...prop, rotY: prop.rotY + Math.PI / 4 }
            : prop));
        }
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDm, placement, selection, wallDraw, wallSelection]);

  const hasSelection = selection !== null || wallSelection.size > 0;
  const gmHint = wallDraw
    ? wallDraw.start ? 'Choose the next point · Esc ends the run' : 'Click the map to start a wall · Esc cancels'
    : placement
      ? `Click the map to place a ${placement.kind} · R rotates`
      : wallSelection.size > 0
        ? 'Drag either gold handle to reshape · Delete removes'
        : selection
          ? 'Drag to move · R rotates props · Delete removes'
          : 'GM sandbox · drag a piece or select a wall';

  return (
    <div className={`demo-view ${isDm ? 'demo-dm' : 'demo-player'}`}>
      {scene ? (
        <TableScene
          entities={visibleEntities}
          walls={scene.walls}
          lights={scene.lights}
          mapImage={scene.mapImage}
          props={visibleProps}
          isDm={isDm}
          canDrag={(type, id) => isDm || (type === 'mini' && id === PLAYER_MINI)}
          selection={selection}
          placement={isDm ? placement : null}
          wallSelection={isDm ? wallSelection : new Set<bigint>()}
          wallDraw={isDm ? wallDraw : null}
          onSelect={(nextSelection) => {
            if (!isDm && nextSelection !== null && !(nextSelection.type === 'mini' && nextSelection.id === PLAYER_MINI)) return;
            setSelection(nextSelection);
            setWallSelection(new Set());
          }}
          onWallClick={(id, additive) => {
            if (!isDm) return;
            setSelection(null);
            setWallSelection((current) => {
              const next = new Set(additive ? current : []);
              if (additive && next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            });
          }}
          onWallEndpoint={(id, end, x, z) => {
            if (!isDm) return;
            setScene((current) => current && ({
              ...current,
              walls: current.walls.map((wall) => wall.id === id
                ? end === 'a' ? { ...wall, ax: x, az: z } : { ...wall, bx: x, bz: z }
                : wall),
            }));
          }}
          onWallDrawPoint={(x, z) => {
            if (!isDm || !wallDraw) return;
            if (!wallDraw.start) {
              setWallDraw({ start: { x, z } });
              return;
            }
            const start = wallDraw.start;
            if (Math.hypot(x - start.x, z - start.z) < 0.05) return;
            const wall: Wall = {
              id: nextWallId.current++,
              tableId: TABLE,
              ax: start.x,
              az: start.z,
              bx: x,
              bz: z,
              height: 2.5,
              thickness: 0.15,
            };
            setScene((current) => current && ({ ...current, walls: [...current.walls, wall] }));
            setWallDraw({ start: { x, z } });
          }}
          onPlace={(x, z, rotY) => {
            if (!isDm || !placement) return;
            const prop: Prop = {
              id: nextPropId.current++,
              tableId: TABLE,
              dmIdentity: NO_IDENTITY,
              kind: placement.kind,
              params: JSON.stringify(placement.params),
              seed: placement.seed,
              x,
              z,
              rotY,
              hidden: false,
            };
            setPropRows((rows) => [...rows, prop]);
            setPlacement({ ...placement, seed: randomSeed(), rotY });
          }}
          onDragMove={() => undefined}
          onDragEnd={(type, id, x, z) => {
            if (!isDm && !(type === 'mini' && id === PLAYER_MINI)) return;
            if (type === 'prop') {
              setPropRows((rows) => rows.map((prop) => prop.id === id ? { ...prop, x, z } : prop));
            } else {
              setEntityRows((rows) => rows.map((entity) => entity.id === id ? { ...entity, x, z } : entity));
            }
          }}
          cameraPosition={camera.position}
          cameraTarget={camera.target}
          cameraFov={camera.fov}
        />
      ) : (
        <div className="demo-loading">{error ? `Could not load showcase: ${error}` : 'Opening the Pig & Whistle…'}</div>
      )}

      <header className="demo-topbar">
        <a className="demo-brand" href="#/demo?role=gm&shot=hero" aria-label="Ajar demo home"><img src="/brand/ajar-mark.svg" alt="" width="64" height="64" />ajar</a>
        <span className="demo-divider" />
        <div className="demo-table-name"><b>The Pig &amp; Whistle</b><span>Taproom · Night</span></div>
        <div className="demo-party" aria-label="Four people at the table">
          <span className="demo-avatar cyan">MT</span><span className="demo-avatar gold">BF</span><span className="demo-avatar green">K</span><span className="demo-avatar dm">GM</span>
          <b><i /> 4 at the table</b>
        </div>
        <nav className="demo-role-switch" aria-label="Demo perspective">
          <a className={isDm ? 'active' : ''} href={`#/demo?role=gm&shot=${shot}`}>GM</a>
          <a className={!isDm ? 'active' : ''} href={`#/demo?role=player&shot=${shot}`}>Player</a>
        </nav>
      </header>

      {isDm && (
        <aside className="demo-tools" aria-label="GM table tools">
          <button
            className={!placement && !wallDraw ? 'active' : ''}
            aria-label="Select and move"
            title="Select and move"
            onClick={() => { setPlacement(null); setWallDraw(null); }}
          >↖</button>
          <button
            aria-label="Delete selection"
            title="Delete selection"
            disabled={!hasSelection}
            onClick={deleteSelection}
          >⌫</button>
          <button aria-label="Reset demo" title="Reset demo" onClick={resetDemo}>↺</button>
        </aside>
      )}

      {isDm ? (
        <div className="demo-palette" aria-label="Place objects">
          {PROP_KINDS.map((kind, index) => (
            <button
              key={kind}
              className={`palette-item ${placement?.kind === kind ? 'active' : ''}`}
              aria-pressed={placement?.kind === kind}
              aria-label={`Place ${kind}`}
              title={`Place ${kind} (${index + 1})`}
              onClick={() => armPlacement(kind)}
            >
              <kbd>{index + 1}</kbd><i className={`icon-${kind}`} /><span>{kind}</span>
            </button>
          ))}
          <span className="palette-divider" />
          <button
            className={`palette-item ${wallDraw ? 'active' : ''}`}
            aria-pressed={wallDraw !== null}
            aria-label="Draw walls"
            title="Draw walls (6)"
            onClick={armWallDraw}
          ><kbd>6</kbd><i className="icon-wall" /><span>Wall</span></button>
        </div>
      ) : (
        <div className="player-pill"><span className="demo-avatar cyan">MT</span><div><b>Mira Thorne</b><small>Player · move your token</small></div></div>
      )}

      <div className="demo-status"><span>UVTT</span><b>{scene ? `${scene.walls.length} surfaces · ${scene.lights.length} lights · ${visibleProps.length} props` : 'reading map…'}</b></div>
      <div className={`demo-secret ${isDm ? '' : 'readonly'}`}><i />{isDm ? gmHint : 'Player view · your blue token is movable'}</div>
    </div>
  );
}
