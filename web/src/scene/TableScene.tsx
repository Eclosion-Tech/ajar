import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { wallSegmentsToGeometry } from '../lib/uvtt/geometry';
import { buildProp } from '../lib/props';
import { isSelected, type Selection } from '../selection';
import type { Entity, Light, MapImage, Prop, Wall } from '../module_bindings/types';

type Props = {
  entities: Entity[];
  walls: Wall[];
  lights: Light[];
  mapImage: MapImage | null;
  props: Prop[];
  isDm: boolean;
  selection: Selection;
  onSelect: (sel: Selection) => void;
  onMove: (x: number, z: number) => void;
};

// Forward rendering pays for every light on every fragment: keep only the
// strongest few as real point lights; the rest render as emissive glows.
// ?lights=N (before the # or after the hash route) overrides the budget while
// we calibrate; a change needs one refresh.
const params = new URLSearchParams(window.location.search);
const hashQuery = window.location.hash.split('?')[1];
if (hashQuery) {
  for (const [k, v] of new URLSearchParams(hashQuery)) {
    if (!params.has(k)) params.set(k, v);
  }
}
const POINT_LIGHT_BUDGET = Number(params.get('lights') ?? 12);

// Greedy spatial spread: strongest first, but keep min spacing so one wall of
// sconces doesn't eat the whole budget while the room center goes dark.
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

export default function TableScene({ entities, walls, lights, mapImage, props, isDm, selection, onSelect, onMove }: Props) {
  const lit = lights.length > 0;
  const realLights = useMemo(() => {
    const ranked = [...lights].sort((a, b) => b.intensity * b.range - a.intensity * a.range);
    return pickSpread(ranked, POINT_LIGHT_BUDGET);
  }, [lights]);
  return (
    <Canvas
      className="scene"
      camera={{ position: [8, 10, 8], fov: 50 }}
      // WebGPU with three's built-in WebGL2 backend fallback; built-in materials
      // are converted automatically, so no GLSL ShaderMaterials in this tree.
      gl={async (glProps) => {
        const renderer = new WebGPURenderer({ ...(glProps as object), antialias: true } as never);
        await renderer.init();
        return renderer;
      }}
    >
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
      <Ground onGroundClick={onMove} onMiss={() => onSelect(null)} />
      {mapImage && (
        <Suspense fallback={null}>
          <MapFloor image={mapImage} onGroundClick={onMove} />
        </Suspense>
      )}
      <MergedWalls walls={walls} />
      {props.map((p) => (
        <ProcProp
          key={p.id.toString()}
          prop={p}
          dmGhost={isDm && p.hidden}
          selected={isSelected(selection, 'prop', p.id)}
          onClick={() => onSelect({ type: 'prop', id: p.id })}
        />
      ))}
      {entities.map((e) => (
        <Mini
          key={e.id.toString()}
          entity={e}
          dmGhost={isDm && e.hidden}
          selected={isSelected(selection, 'mini', e.id)}
          onClick={() => onSelect({ type: 'mini', id: e.id })}
        />
      ))}
      <OrbitControls makeDefault maxPolarAngle={Math.PI / 2.1} />
    </Canvas>
  );
}

function ProcProp({
  prop,
  dmGhost,
  selected,
  onClick,
}: {
  prop: Prop;
  dmGhost: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  const geometry = useMemo(() => buildProp(prop.kind, prop.params, prop.seed), [prop.kind, prop.params, prop.seed]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;
  return (
    <group position={[prop.x, 0, prop.z]} rotation={[0, prop.rotY, 0]}>
      <mesh
        geometry={geometry}
        onPointerDown={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        <meshStandardMaterial vertexColors flatShading transparent={dmGhost} opacity={dmGhost ? 0.45 : 1} />
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

function MapFloor({ image, onGroundClick }: { image: MapImage; onGroundClick: (x: number, z: number) => void }) {
  const texture = useLoader(THREE.TextureLoader, image.url);
  texture.colorSpace = THREE.SRGBColorSpace;
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[image.offsetX, 0.02, image.offsetZ]}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.button === 0) onGroundClick(e.point.x, e.point.z);
      }}
    >
      <planeGeometry args={[image.width, image.height]} />
      <meshStandardMaterial map={texture} />
    </mesh>
  );
}

function MergedWalls({ walls }: { walls: Wall[] }) {
  // One merged geometry, one draw call, regardless of segment count.
  const geometry = useMemo(() => wallSegmentsToGeometry(walls), [walls]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  if (walls.length === 0) return null;
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color="#5c6b84" />
    </mesh>
  );
}

function Ground({ onGroundClick, onMiss }: { onGroundClick: (x: number, z: number) => void; onMiss: () => void }) {
  return (
    <group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerDown={(e) => {
          e.stopPropagation();
          if (e.button === 0) onGroundClick(e.point.x, e.point.z);
        }}
        onPointerMissed={onMiss}
      >
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#1d2430" />
      </mesh>
      <gridHelper args={[40, 40, '#3b4a63', '#2a3345']} position={[0, 0.01, 0]} />
    </group>
  );
}

function Mini({
  entity,
  dmGhost,
  selected,
  onClick,
}: {
  entity: Entity;
  dmGhost: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  const group = useRef<THREE.Group>(null);
  const target = new THREE.Vector3(entity.x, 0, entity.z);

  // Remote moves arrive as row updates; damp toward the latest authoritative
  // position instead of snapping.
  useFrame((_state, dt) => {
    const g = group.current;
    if (!g) return;
    const k = 1 - Math.exp(-14 * dt);
    g.position.lerp(target, k);
  });

  return (
    <group ref={group} position={[entity.x, 0, entity.z]}>
      <mesh
        position={[0, 0.75, 0]}
        onPointerDown={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        <capsuleGeometry args={[0.35, 0.8, 6, 16]} />
        <meshStandardMaterial
          color={entity.color}
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
