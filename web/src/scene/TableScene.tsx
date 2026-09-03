import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useLoader, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, useCursor } from '@react-three/drei';
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { wallSegmentsToGeometry } from '../lib/uvtt/geometry';
import { buildProp } from '../lib/props';
import { MINI_SNAP, PROP_SNAP } from '../lib/props/catalog';
import { woodGrainTexture } from './grain';
import { isSelected, type Selection } from '../selection';
import type { Placement } from '../placement';
import type { Entity, Light, MapImage, Prop, Wall } from '../module_bindings/types';

type DragKind = 'mini' | 'prop';

type Props = {
  entities: Entity[];
  walls: Wall[];
  lights: Light[];
  mapImage: MapImage | null;
  props: Prop[];
  isDm: boolean;
  canDrag?: (type: DragKind, id: bigint) => boolean;
  selection: Selection;
  placement: Placement;
  wallSelection: ReadonlySet<bigint>;
  wallDraw: { start: { x: number; z: number } | null } | null;
  onSelect: (sel: Selection) => void;
  onWallClick: (id: bigint, additive: boolean) => void;
  onWallEndpoint: (id: bigint, end: 'a' | 'b', x: number, z: number, commit: boolean) => void;
  onWallDrawPoint: (x: number, z: number) => void;
  onPlace: (x: number, z: number, rotY: number) => void;
  onDragMove: (type: DragKind, id: bigint, x: number, z: number) => void;
  onDragEnd: (type: DragKind, id: bigint, x: number, z: number) => void;
  cameraPosition?: [number, number, number];
  cameraTarget?: [number, number, number];
  cameraFov?: number;
};

// Forward rendering pays for every light on every fragment: keep only the
// strongest few as real point lights. ?lights=N overrides while calibrating.
const params = new URLSearchParams(window.location.search);
const hashQuery = window.location.hash.split('?')[1];
if (hashQuery) {
  for (const [k, v] of new URLSearchParams(hashQuery)) {
    if (!params.has(k)) params.set(k, v);
  }
}
const POINT_LIGHT_BUDGET = Number(params.get('lights') ?? 12);

const DRAG_THRESHOLD_PX = 5;
const GROUND_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
// Shared unit box, scaled per use: JSX geometry args that change per row
// update make R3F dispose the old geometry immediately, racing in-flight
// WebGPU frames (the "vertex buffer 0" pipeline death). Scaling allocates
// nothing.
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

function pickSpread(ranked: Light[], budget: number, minDist = 3.5): Light[] {
  const picked: Light[] = [];
  for (const l of ranked) {
    if (picked.length >= budget) break;
    if (picked.every((p) => Math.hypot(p.x - l.x, p.z - l.z) >= minDist)) picked.push(l);
  }
  for (const l of ranked) {
    if (picked.length >= budget) break;
    if (!picked.includes(l)) picked.push(l);
  }
  return picked;
}

const snap = (v: number, step: number, free: boolean) => (free ? v : Math.round(v / step) * step);

/** Grid-snap a point, then weld to any nearby existing wall endpoint so drawn
 * and dragged chains stay watertight. */
function weldSnap(
  x: number,
  z: number,
  walls: Wall[],
  excludeId: bigint | null,
  free: boolean,
): { x: number; z: number } {
  let wx = snap(x, PROP_SNAP, free);
  let wz = snap(z, PROP_SNAP, free);
  let best = 0.25;
  for (const w of walls) {
    if (excludeId !== null && w.id === excludeId) continue;
    for (const [ex, ez] of [
      [w.ax, w.az],
      [w.bx, w.bz],
    ] as const) {
      const d = Math.hypot(x - ex, z - ez);
      if (d < best) {
        best = d;
        wx = ex;
        wz = ez;
      }
    }
  }
  return { x: wx, z: wz };
}

/** Midpoint/orientation transform for a wall-segment box. */
function wallTransform(ax: number, az: number, bx: number, bz: number) {
  return {
    len: Math.hypot(bx - ax, bz - az),
    cx: (ax + bx) / 2,
    cz: (az + bz) / 2,
    rot: -Math.atan2(bz - az, bx - ax),
  };
}

/** Intersect the event's ray with the y=0 plane — captured-event hit points
 * stay on the captured object, so never use e.point during a drag. */
function groundPoint(e: ThreeEvent<PointerEvent>, out: THREE.Vector3): THREE.Vector3 | null {
  return e.ray.intersectPlane(GROUND_PLANE, out);
}

type DragState = {
  type: DragKind;
  id: bigint;
  offX: number;
  offZ: number;
  sx: number;
  sy: number;
  moved: boolean;
  lastX: number;
  lastZ: number;
  group: THREE.Group;
};

export default function TableScene(props: Props) {
  return (
    <Canvas
      className="scene"
      camera={{ position: props.cameraPosition ?? [8, 10, 8], fov: props.cameraFov ?? 50 }}
      // WebGPU with three's built-in WebGL2 backend fallback; built-in materials
      // are converted automatically, so no GLSL ShaderMaterials in this tree.
      gl={async (glProps) => {
        const renderer = new WebGPURenderer({ ...(glProps as object), antialias: true } as never);
        await renderer.init();
        return renderer;
      }}
    >
      <SceneContent {...props} />
    </Canvas>
  );
}

function SceneContent({
  entities,
  walls,
  lights,
  mapImage,
  props,
  isDm,
  canDrag,
  selection,
  placement,
  wallSelection,
  wallDraw,
  onSelect,
  onWallClick,
  onWallEndpoint,
  onWallDrawPoint,
  onPlace,
  onDragMove,
  onDragEnd,
  cameraTarget,
}: Props) {
  const lit = lights.length > 0;
  const realLights = useMemo(() => {
    const ranked = [...lights].sort((a, b) => b.intensity * b.range - a.intensity * a.range);
    return pickSpread(ranked, POINT_LIGHT_BUDGET);
  }, [lights]);

  const controls = useThree((s) => s.controls as { enabled: boolean } | null);
  const drag = useRef<DragState | null>(null);
  const ghostGroup = useRef<THREE.Group | null>(null);
  const drawGhost = useRef<THREE.Mesh | null>(null);
  const drawCursor = useRef<THREE.Mesh | null>(null);
  const surfaceDown = useRef<{ sx: number; sy: number } | null>(null);
  const scratch = useMemo(() => new THREE.Vector3(), []);
  const modeArmed = placement !== null || wallDraw !== null;

  // Shift axis-locks the pending draw segment to the dominant axis.
  const drawPoint = (e: ThreeEvent<PointerEvent>): { x: number; z: number } | null => {
    if (!groundPoint(e, scratch)) return null;
    let { x, z } = weldSnap(scratch.x, scratch.z, walls, null, e.nativeEvent.altKey);
    const start = wallDraw?.start;
    if (start && e.nativeEvent.shiftKey) {
      if (Math.abs(x - start.x) >= Math.abs(z - start.z)) z = start.z;
      else x = start.x;
    }
    return { x, z };
  };

  const surfaceSize = Math.max(
    80,
    (mapImage ? Math.max(mapImage.width, mapImage.height) : 0) + 20,
  );
  const gridSize = Math.ceil(surfaceSize / 2) * 2;

  const beginDrag = (
    e: ThreeEvent<PointerEvent>,
    type: DragKind,
    id: bigint,
    x: number,
    z: number,
    group: THREE.Group | null,
  ) => {
    if (e.button !== 0 || !group || drag.current) return;
    if (canDrag && !canDrag(type, id)) return;
    if (type === 'prop' && !isDm) {
      // players can select props but not move them
      onSelect({ type, id });
      return;
    }
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    if (!groundPoint(e, scratch)) return;
    drag.current = {
      type,
      id,
      offX: x - scratch.x,
      offZ: z - scratch.z,
      sx: e.clientX,
      sy: e.clientY,
      moved: false,
      lastX: x,
      lastZ: z,
      group,
    };
    if (controls) controls.enabled = false;
  };

  const dragMove = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current;
    if (!d) return;
    e.stopPropagation();
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < DRAG_THRESHOLD_PX) return;
    d.moved = true;
    if (!groundPoint(e, scratch)) return;
    const free = e.nativeEvent.altKey;
    const step = d.type === 'mini' ? MINI_SNAP : PROP_SNAP;
    d.lastX = snap(scratch.x + d.offX, step, free);
    d.lastZ = snap(scratch.z + d.offZ, step, free);
    d.group.position.set(d.lastX, 0, d.lastZ);
    onDragMove(d.type, d.id, d.lastX, d.lastZ);
  };

  const dragEnd = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current;
    if (!d) return;
    e.stopPropagation();
    drag.current = null;
    if (controls) controls.enabled = true;
    if (d.moved) {
      onDragEnd(d.type, d.id, d.lastX, d.lastZ);
    } else {
      onSelect({ type: d.type, id: d.id });
    }
  };

  const dragApi = { begin: beginDrag, move: dragMove, end: dragEnd };

  return (
    <>
      <ambientLight intensity={lit ? 0.32 : 0.6} />
      <hemisphereLight args={['#35405c', '#3d2c1c', lit ? 0.5 : 0.3]} />
      <directionalLight position={[6, 12, 4]} intensity={lit ? 0.7 : 1.6} />
      {realLights.map((l) => (
        <pointLight
          key={l.id.toString()}
          position={[l.x, 1.6, l.z]}
          color={l.colorRgb}
          intensity={Math.max(l.intensity, 0.4) * 8}
          distance={l.range * 2.2}
          decay={1.6}
        />
      ))}

      {/* Single interaction surface: ghost tracking, placement commits, and
          idle-click deselection all live here. Visual ground is separate. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.001, 0]}
        onPointerDown={(e) => {
          if (e.button === 0) surfaceDown.current = { sx: e.clientX, sy: e.clientY };
        }}
        onPointerMove={(e) => {
          if (drag.current) return;
          if (wallDraw) {
            const p = drawPoint(e);
            if (!p) return;
            drawCursor.current?.position.set(p.x, 0.06, p.z);
            const m = drawGhost.current;
            if (m) {
              const start = wallDraw.start;
              if (start) {
                const t = wallTransform(start.x, start.z, p.x, p.z);
                m.visible = t.len > 0.01;
                m.position.set(t.cx, 1.25, t.cz);
                m.rotation.y = t.rot;
                m.scale.setX(Math.max(t.len, 0.001));
              } else {
                m.visible = false;
              }
            }
            return;
          }
          if (!placement) return;
          if (!groundPoint(e, scratch)) return;
          const free = e.nativeEvent.altKey;
          ghostGroup.current?.position.set(
            snap(scratch.x, PROP_SNAP, free),
            0,
            snap(scratch.z, PROP_SNAP, free),
          );
        }}
        onPointerUp={(e) => {
          const down = surfaceDown.current;
          surfaceDown.current = null;
          if (drag.current || e.button !== 0 || !down) return;
          if (Math.hypot(e.clientX - down.sx, e.clientY - down.sy) >= DRAG_THRESHOLD_PX) return; // orbit
          if (wallDraw) {
            const p = drawPoint(e);
            if (p) onWallDrawPoint(p.x, p.z);
          } else if (placement) {
            if (!groundPoint(e, scratch)) return;
            const free = e.nativeEvent.altKey;
            onPlace(snap(scratch.x, PROP_SNAP, free), snap(scratch.z, PROP_SNAP, free), placement.rotY);
          } else {
            onSelect(null);
          }
        }}
      >
        <planeGeometry args={[surfaceSize, surfaceSize]} />
        <meshBasicMaterial visible={false} />
      </mesh>

      <group>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[gridSize, gridSize]} />
          <meshStandardMaterial color="#1d2430" />
        </mesh>
        <gridHelper args={[gridSize, gridSize, '#3b4a63', '#2a3345']} position={[0, 0.01, 0]} />
      </group>
      {mapImage && (
        <Suspense fallback={null}>
          <MapFloor image={mapImage} />
        </Suspense>
      )}
      <MergedWalls walls={walls} />

      {isDm &&
        walls.map((w) => (
          <WallProxy
            key={w.id.toString()}
            wall={w}
            armed={modeArmed}
            selected={wallSelection.has(w.id)}
            onWallClick={onWallClick}

          />
        ))}
      {isDm &&
        wallSelection.size === 1 &&
        (() => {
          const w = walls.find((row) => wallSelection.has(row.id));
          return w ? <WallHandles wall={w} walls={walls} onWallEndpoint={onWallEndpoint} /> : null;
        })()}
      {wallDraw && (
        <>
          <mesh ref={drawCursor} position={[0, 0.06, 0]}>
            <sphereGeometry args={[0.12, 10, 10]} />
            <meshBasicMaterial color="#4cc9f0" />
          </mesh>
          <mesh ref={drawGhost} visible={false}>
            <boxGeometry args={[1, 2.5, 0.15]} />
            <meshBasicMaterial color="#4cc9f0" transparent opacity={0.35} depthWrite={false} />
          </mesh>
        </>
      )}

      {placement && <Ghost placement={placement} groupRef={ghostGroup} />}

      {props.map((p) => (
        <ProcProp
          key={p.id.toString()}
          prop={p}
          dmGhost={isDm && p.hidden}
          selected={isSelected(selection, 'prop', p.id)}
          dragRef={drag}
          dragApi={dragApi}
        />
      ))}
      {entities.map((e) => (
        <Mini
          key={e.id.toString()}
          entity={e}
          dmGhost={isDm && e.hidden}
          selected={isSelected(selection, 'mini', e.id)}
          dragRef={drag}
          dragApi={dragApi}
        />
      ))}
      <OrbitControls makeDefault target={cameraTarget ?? [0, 0, 0]} maxPolarAngle={Math.PI / 2.1} />
    </>
  );
}

type DragApi = {
  begin: (
    e: ThreeEvent<PointerEvent>,
    type: DragKind,
    id: bigint,
    x: number,
    z: number,
    group: THREE.Group | null,
  ) => void;
  move: (e: ThreeEvent<PointerEvent>) => void;
  end: (e: ThreeEvent<PointerEvent>) => void;
};

/** Damp toward the authoritative row position — unless this object is being
 * dragged locally, in which case the drag owns the transform. Position is
 * deliberately NOT a JSX prop: re-renders must not teleport mid-lerp. */
function useAuthoritativePosition(
  group: React.RefObject<THREE.Group | null>,
  x: number,
  z: number,
  isDragged: () => boolean,
) {
  const initialized = useRef(false);
  useEffect(() => {
    if (!initialized.current && group.current) {
      group.current.position.set(x, 0, z);
      initialized.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useFrame((_state, dt) => {
    const g = group.current;
    if (!g || isDragged()) return;
    const k = 1 - Math.exp(-14 * dt);
    g.position.lerp(scratchTarget.set(x, 0, z), k);
  });
}
const scratchTarget = new THREE.Vector3();

// Dispose the geometry a component *replaced*, never the live one on unmount:
// StrictMode remounts reuse the memoized geometry, so an unmount-dispose frees
// GPU buffers still bound to the mesh (setIndexBuffer crash). Disposal is
// DEFERRED because the WebGPU renderer can still reference the old buffers in
// an in-flight frame — immediate dispose under rapid param edits eventually
// kills the pipeline ("requires vertex buffer 0 to be set" freeze).
function useReplacedGeometryDisposal(geometry: THREE.BufferGeometry | null) {
  const prev = useRef<THREE.BufferGeometry | null>(null);
  useEffect(() => {
    if (prev.current && prev.current !== geometry) {
      const old = prev.current;
      setTimeout(() => old.dispose(), 300);
    }
    prev.current = geometry;
  }, [geometry]);
}

function Ghost({
  placement,
  groupRef,
}: {
  placement: NonNullable<Placement>;
  groupRef: React.MutableRefObject<THREE.Group | null>;
}) {
  const paramsJson = useMemo(() => JSON.stringify(placement.params), [placement.params]);
  const geometry = useMemo(
    () => buildProp(placement.kind, paramsJson, placement.seed),
    [placement.kind, paramsJson, placement.seed],
  );
  useReplacedGeometryDisposal(geometry);
  if (!geometry) return null;
  return (
    <group ref={groupRef} rotation={[0, placement.rotY, 0]}>
      <mesh geometry={geometry} raycast={() => null}>
        <meshStandardMaterial
          vertexColors
          flatShading
          map={woodGrainTexture()}
          roughness={0.92}
          metalness={0}
          transparent
          opacity={0.5}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function ProcProp({
  prop,
  dmGhost,
  selected,
  dragRef,
  dragApi,
}: {
  prop: Prop;
  dmGhost: boolean;
  selected: boolean;
  dragRef: React.MutableRefObject<DragState | null>;
  dragApi: DragApi;
}) {
  const group = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);
  const geometry = useMemo(() => buildProp(prop.kind, prop.params, prop.seed), [prop.kind, prop.params, prop.seed]);
  useReplacedGeometryDisposal(geometry);
  useAuthoritativePosition(
    group,
    prop.x,
    prop.z,
    () => dragRef.current?.type === 'prop' && dragRef.current.id === prop.id,
  );
  if (!geometry) return null;
  return (
    <group ref={group} rotation={[0, prop.rotY, 0]}>
      <mesh
        geometry={geometry}
        onPointerDown={(e) => dragApi.begin(e, 'prop', prop.id, prop.x, prop.z, group.current)}
        onPointerMove={dragApi.move}
        onPointerUp={dragApi.end}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
      >
        <meshStandardMaterial
          vertexColors
          flatShading
          map={woodGrainTexture()}
          roughness={0.92}
          metalness={0}
          emissive="#4cc9f0"
          emissiveIntensity={hovered ? 0.18 : 0}
          transparent={dmGhost}
          opacity={dmGhost ? 0.45 : 1}
        />
      </mesh>
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[0.6, 0.72, 32]} />
          <meshBasicMaterial color="#ffd166" />
        </mesh>
      )}
    </group>
  );
}

function Mini({
  entity,
  dmGhost,
  selected,
  dragRef,
  dragApi,
}: {
  entity: Entity;
  dmGhost: boolean;
  selected: boolean;
  dragRef: React.MutableRefObject<DragState | null>;
  dragApi: DragApi;
}) {
  const group = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);
  useAuthoritativePosition(
    group,
    entity.x,
    entity.z,
    () => dragRef.current?.type === 'mini' && dragRef.current.id === entity.id,
  );
  return (
    <group ref={group}>
      <mesh
        position={[0, 0.75, 0]}
        onPointerDown={(e) => dragApi.begin(e, 'mini', entity.id, entity.x, entity.z, group.current)}
        onPointerMove={dragApi.move}
        onPointerUp={dragApi.end}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
      >
        <capsuleGeometry args={[0.35, 0.8, 6, 16]} />
        <meshStandardMaterial
          color={entity.color}
          emissive="#ffffff"
          emissiveIntensity={hovered ? 0.15 : 0}
          transparent={dmGhost}
          opacity={dmGhost ? 0.45 : 1}
        />
      </mesh>
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[0.5, 0.62, 32]} />
          <meshBasicMaterial color="#ffd166" />
        </mesh>
      )}
      {dmGhost && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[0.66, 0.74, 32]} />
          <meshBasicMaterial color="#ef476f" />
        </mesh>
      )}
    </group>
  );
}

/** Invisible raycast proxy per wall segment: the merged wall render stays one
 * draw call; this is what makes individual segments clickable. Carries the
 * hover/selection highlight as a child. */
function WallProxy({
  wall,
  armed,
  selected,
  onWallClick,
}: {
  wall: Wall;
  armed: boolean;
  selected: boolean;
  onWallClick: (id: bigint, additive: boolean) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const down = useRef<{ sx: number; sy: number } | null>(null);
  useCursor(hovered && !armed);
  const t = wallTransform(wall.ax, wall.az, wall.bx, wall.bz);
  if (t.len < 0.01) return null;
  return (
    <group position={[t.cx, wall.height / 2, t.cz]} rotation={[0, t.rot, 0]}>
      <mesh
        geometry={UNIT_BOX}
        scale={[t.len, wall.height, wall.thickness + 0.12]}
        onPointerDown={(e) => {
          if (armed || e.button !== 0) return;
          e.stopPropagation();
          down.current = { sx: e.clientX, sy: e.clientY };
        }}
        onPointerUp={(e) => {
          const d = down.current;
          down.current = null;
          if (armed || e.button !== 0 || !d) return;
          if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) >= DRAG_THRESHOLD_PX) return;
          e.stopPropagation();
          onWallClick(wall.id, e.nativeEvent.shiftKey);
        }}
        onPointerOver={(e) => {
          if (armed) return;
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
      >
        <meshBasicMaterial visible={false} />
      </mesh>
      <mesh
        geometry={UNIT_BOX}
        scale={[t.len + 0.02, wall.height + 0.04, wall.thickness + 0.16]}
        visible={selected || (hovered && !armed)}
        raycast={() => null}
      >
        <meshBasicMaterial
          color={selected ? '#ffd166' : '#4cc9f0'}
          transparent
          opacity={selected ? 0.28 : 0.15}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/** Draggable endpoint spheres for a single selected wall. */
function WallHandles({
  wall,
  walls,
  onWallEndpoint,
}: {
  wall: Wall;
  walls: Wall[];
  onWallEndpoint: (id: bigint, end: 'a' | 'b', x: number, z: number, commit: boolean) => void;
}) {
  const controls = useThree((s) => s.controls as { enabled: boolean } | null);
  const active = useRef<'a' | 'b' | null>(null);
  const scratch = useMemo(() => new THREE.Vector3(), []);

  const resolve = (e: ThreeEvent<PointerEvent>) => {
    if (!e.ray.intersectPlane(GROUND_PLANE, scratch)) return null;
    return weldSnap(scratch.x, scratch.z, walls, wall.id, e.nativeEvent.altKey);
  };

  const handle = (end: 'a' | 'b') => {
    const x = end === 'a' ? wall.ax : wall.bx;
    const z = end === 'a' ? wall.az : wall.bz;
    return (
      <mesh
        position={[x, wall.height + 0.15, z]}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          (e.target as Element).setPointerCapture(e.pointerId);
          active.current = end;
          if (controls) controls.enabled = false;
        }}
        onPointerMove={(e) => {
          if (active.current !== end) return;
          e.stopPropagation();
          const p = resolve(e);
          if (p) onWallEndpoint(wall.id, end, p.x, p.z, false);
        }}
        onPointerUp={(e) => {
          if (active.current !== end) return;
          e.stopPropagation();
          active.current = null;
          if (controls) controls.enabled = true;
          const p = resolve(e);
          if (p) onWallEndpoint(wall.id, end, p.x, p.z, true);
        }}
      >
        <sphereGeometry args={[0.16, 12, 12]} />
        <meshBasicMaterial color="#ffd166" />
      </mesh>
    );
  };

  return (
    <>
      {handle('a')}
      {handle('b')}
    </>
  );
}

function MapFloor({ image }: { image: MapImage }) {
  const texture = useLoader(THREE.TextureLoader, image.url);
  texture.colorSpace = THREE.SRGBColorSpace;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[image.offsetX, 0.02, image.offsetZ]}>
      <planeGeometry args={[image.width, image.height]} />
      <meshStandardMaterial map={texture} />
    </mesh>
  );
}

function MergedWalls({ walls }: { walls: Wall[] }) {
  const geometry = useMemo(() => wallSegmentsToGeometry(walls), [walls]);
  useReplacedGeometryDisposal(geometry);
  if (walls.length === 0) return null;
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color="#5c6b84" />
    </mesh>
  );
}
