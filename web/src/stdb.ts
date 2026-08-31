import { DbConnection } from './module_bindings';
import type { Entity, GameTable, Light, MapImage, Participant, Prop, Wall } from './module_bindings/types';
import type { Identity } from 'spacetimedb';

export type Snapshot = {
  connected: boolean;
  subscribed: boolean;
  identity: Identity | null;
  tables: GameTable[];
  participants: Participant[];
  entities: Entity[];
  walls: Wall[];
  lights: Light[];
  mapImages: MapImage[];
  props: Prop[];
};

type Listener = () => void;

// Per-tab identity is deliberate: sessionStorage (not localStorage) so a second
// tab is a distinct participant — the two-tab demo needs a DM tab and a player tab.
const TOKEN_KEY = 'stdb_token';

class Store {
  conn: DbConnection | null = null;
  private listeners = new Set<Listener>();
  private tables = new Map<string, GameTable>();
  private participants = new Map<string, Participant>();
  private entities = new Map<string, Entity>();
  private walls = new Map<string, Wall>();
  private lights = new Map<string, Light>();
  private mapImages = new Map<string, MapImage>();
  private props = new Map<string, Prop>();
  private snapshot: Snapshot = {
    connected: false,
    subscribed: false,
    identity: null,
    tables: [],
    participants: [],
    entities: [],
    walls: [],
    lights: [],
    mapImages: [],
    props: [],
  };

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): Snapshot => this.snapshot;

  private bump(partial?: Partial<Pick<Snapshot, 'connected' | 'subscribed' | 'identity'>>) {
    this.snapshot = {
      ...this.snapshot,
      ...partial,
      tables: [...this.tables.values()],
      participants: [...this.participants.values()],
      entities: [...this.entities.values()],
      walls: [...this.walls.values()],
      lights: [...this.lights.values()],
      mapImages: [...this.mapImages.values()],
      props: [...this.props.values()],
    };
    this.listeners.forEach((fn) => fn());
  }

  connect() {
    if (this.conn) return;
    this.conn = DbConnection.builder()
      .withUri((import.meta.env.VITE_STDB_URI as string | undefined) ?? 'ws://localhost:3000')
      .withDatabaseName((import.meta.env.VITE_STDB_MODULE as string | undefined) ?? '3dvtt')
      .withToken(sessionStorage.getItem(TOKEN_KEY) ?? undefined)
      .onConnect((conn, identity, token) => {
        sessionStorage.setItem(TOKEN_KEY, token);
        this.registerRowCallbacks(conn);
        conn
          .subscriptionBuilder()
          .onApplied(() => this.bump({ subscribed: true }))
          // Subscribe to everything for the skeleton; RLS still trims hidden
          // entities server-side. Per-table subscriptions come with scale.
          .subscribe([
            'SELECT * FROM game_table',
            'SELECT * FROM participant',
            'SELECT * FROM entity',
            'SELECT * FROM wall',
            'SELECT * FROM light',
            'SELECT * FROM map_image',
            'SELECT * FROM prop',
          ]);
        this.bump({ connected: true, identity });
      })
      .onDisconnect(() => this.bump({ connected: false, subscribed: false }))
      .onConnectError((_ctx, err) => {
        console.error('stdb connect error', err);
        this.bump({ connected: false });
      })
      .build();
  }

  private registerRowCallbacks(conn: DbConnection) {
    conn.db.game_table.onInsert((_ctx, row) => {
      this.tables.set(row.id.toString(), row);
      this.bump();
    });
    conn.db.game_table.onDelete((_ctx, row) => {
      this.tables.delete(row.id.toString());
      this.bump();
    });
    conn.db.participant.onInsert((_ctx, row) => {
      this.participants.set(row.id.toString(), row);
      this.bump();
    });
    conn.db.participant.onUpdate((_ctx, _old, row) => {
      this.participants.set(row.id.toString(), row);
      this.bump();
    });
    conn.db.participant.onDelete((_ctx, row) => {
      this.participants.delete(row.id.toString());
      this.bump();
    });
    conn.db.entity.onInsert((_ctx, row) => {
      this.entities.set(row.id.toString(), row);
      this.bump();
    });
    conn.db.entity.onUpdate((_ctx, _old, row) => {
      this.entities.set(row.id.toString(), row);
      this.bump();
    });
    conn.db.entity.onDelete((_ctx, row) => {
      this.entities.delete(row.id.toString());
      this.bump();
    });
    conn.db.wall.onInsert((_ctx, row) => {
      this.walls.set(row.id.toString(), row);
      this.bump();
    });
    conn.db.wall.onDelete((_ctx, row) => {
      this.walls.delete(row.id.toString());
      this.bump();
    });
    conn.db.light.onInsert((_ctx, row) => {
      this.lights.set(row.id.toString(), row);
      this.bump();
    });
    conn.db.light.onDelete((_ctx, row) => {
      this.lights.delete(row.id.toString());
      this.bump();
    });
    conn.db.map_image.onInsert((_ctx, row) => {
      this.mapImages.set(row.id.toString(), row);
      this.bump();
    });
    conn.db.map_image.onUpdate((_ctx, _old, row) => {
      this.mapImages.set(row.id.toString(), row);
      this.bump();
    });
    conn.db.map_image.onDelete((_ctx, row) => {
      this.mapImages.delete(row.id.toString());
      this.bump();
    });
    conn.db.prop.onInsert((_ctx, row) => {
      this.props.set(row.id.toString(), row);
      this.bump();
    });
    conn.db.prop.onUpdate((_ctx, _old, row) => {
      this.props.set(row.id.toString(), row);
      this.bump();
    });
    conn.db.prop.onDelete((_ctx, row) => {
      this.props.delete(row.id.toString());
      this.bump();
    });
  }
}

export const store = new Store();

export const reducers = () => {
  const conn = store.conn;
  if (!conn) throw new Error('not connected');
  return conn.reducers;
};

export function sameIdentity(a: Identity | null | undefined, b: Identity | null | undefined): boolean {
  if (!a || !b) return false;
  return a.toHexString() === b.toHexString();
}
