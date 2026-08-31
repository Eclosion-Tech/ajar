import { reducers } from '../stdb';
import { EntityKind } from '../module_bindings/types';
import type { Entity } from '../module_bindings/types';

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
  return (
    <div className="hud hud-bottom">
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
