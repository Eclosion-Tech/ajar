import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import type { Entity } from '../module_bindings/types';

type Props = {
  entities: Entity[];
  isDm: boolean;
  selectedId: bigint | null;
  onSelect: (id: bigint | null) => void;
  onMove: (id: bigint, x: number, z: number) => void;
};

export default function TableScene({ entities, isDm, selectedId, onSelect, onMove }: Props) {
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
      <ambientLight intensity={0.5} />
      <directionalLight position={[6, 12, 4]} intensity={1.4} />
      <Ground
        onGroundClick={(x, z) => {
          if (selectedId !== null) onMove(selectedId, x, z);
        }}
        onMiss={() => onSelect(null)}
      />
      {entities.map((e) => (
        <Mini
          key={e.id.toString()}
          entity={e}
          dmGhost={isDm && e.hidden}
          selected={e.id === selectedId}
          onClick={() => onSelect(e.id)}
        />
      ))}
      <OrbitControls makeDefault maxPolarAngle={Math.PI / 2.1} />
    </Canvas>
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
