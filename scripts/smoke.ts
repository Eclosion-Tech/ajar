/**
 * Headless two-client smoke test against a running local SpacetimeDB with the
 * 3dvtt module published. Verifies the walking-skeleton contract end to end:
 * create/join, spawn, move sync, and — the product feature — that RLS keeps
 * hidden entities out of a player's replica entirely.
 *
 * Run: pnpm smoke   (bundles with esbuild, runs in node)
 */
import { DbConnection } from '../web/src/module_bindings/index.ts';
import { EntityKind } from '../web/src/module_bindings/types.ts';

const URI = process.env.STDB_URI ?? 'ws://localhost:3000';
const MODULE = process.env.STDB_MODULE ?? '3dvtt';

type Client = {
  conn: DbConnection;
  label: string;
  identityHex: string;
};

function connect(label: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}: connect timeout`)), 10_000);
    DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(MODULE)
      .onConnect((conn, identity) => {
        conn
          .subscriptionBuilder()
          .onApplied(() => {
            clearTimeout(timer);
            resolve({ conn, label, identityHex: identity.toHexString() });
          })
          .subscribe([
            'SELECT * FROM game_table',
            'SELECT * FROM participant',
            'SELECT * FROM entity',
          ]);
      })
      .onConnectError((_ctx, err) => {
        clearTimeout(timer);
        reject(new Error(`${label}: ${err}`));
      })
      .build();
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(label: string, fn: () => T | undefined, ms = 5000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v !== undefined) return v;
    if (Date.now() > deadline) throw new Error(`timeout waiting for: ${label}`);
    await sleep(50);
  }
}

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const dm = await connect('dm');
const player = await connect('player');
check('distinct identities', dm.identityHex !== player.identityHex);

// DM creates a table.
dm.conn.reducers.createTable({ name: 'smoke test', displayName: 'DM' });
const table = await waitFor('created table', () =>
  [...dm.conn.db.game_table.iter()].find((t) => t.dmIdentity.toHexString() === dm.identityHex),
);
check('table created with slug', /^[a-z0-9]{6}$/.test(table.slug), table.slug);

// Player joins by slug.
player.conn.reducers.joinTable({ slug: table.slug, displayName: 'Player' });
await waitFor('player participant', () =>
  [...dm.conn.db.participant.iter()].find(
    (p) => p.identity.toHexString() === player.identityHex && p.tableId === table.id,
  ),
);
check('player joined as Player role', true);

// DM spawns a visible mini and a hidden monster.
dm.conn.reducers.spawnEntity({
  tableId: table.id, kind: EntityKind.Mini, name: 'hero', color: '#4cc9f0', x: 1, z: 1, hidden: false,
});
dm.conn.reducers.spawnEntity({
  tableId: table.id, kind: EntityKind.Mini, name: 'monster', color: '#ef476f', x: 5, z: 5, hidden: true,
});
await waitFor('dm sees both entities', () => {
  const rows = [...dm.conn.db.entity.iter()].filter((e) => e.tableId === table.id);
  return rows.length === 2 ? rows : undefined;
});
check('DM replica has 2 entities (incl. hidden)', true);

await sleep(500); // let the player's replica settle before asserting absence
const playerRows = [...player.conn.db.entity.iter()].filter((e) => e.tableId === table.id);
check(
  'RLS: player replica has ONLY the visible entity',
  playerRows.length === 1 && playerRows[0].name === 'hero',
  `saw ${playerRows.length} rows: ${playerRows.map((e) => e.name).join(', ')}`,
);

// Player moves the visible mini; DM should see the move.
const hero = playerRows[0];
player.conn.reducers.moveEntity({ entityId: hero.id, x: 9, y: 0, z: 9, rotY: 0 });
await waitFor('move synced to DM', () => {
  const row = [...dm.conn.db.entity.iter()].find((e) => e.id === hero.id);
  return row && row.x === 9 && row.z === 9 ? row : undefined;
});
check('player move syncs to DM replica', true);

// Player must NOT be able to reveal the monster (DM-only reducer).
const monster = [...dm.conn.db.entity.iter()].find((e) => e.name === 'monster')!;
let rejected = false;
try {
  await player.conn.reducers.setEntityHidden({ entityId: monster.id, hidden: false });
} catch (e) {
  rejected = String(e).includes('only the DM');
}
const monsterAfter = [...dm.conn.db.entity.iter()].find((e) => e.id === monster.id);
check('player cannot reveal hidden entity', rejected && monsterAfter?.hidden === true);

// DM reveals; the row should appear in the player replica.
dm.conn.reducers.setEntityHidden({ entityId: monster.id, hidden: false });
await waitFor('reveal reaches player', () => {
  return [...player.conn.db.entity.iter()].find((e) => e.id === monster.id);
});
check('reveal pushes row into player replica', true);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
