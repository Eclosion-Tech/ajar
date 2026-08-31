use spacetimedb::{table, Identity, SpacetimeType, Timestamp};

#[derive(SpacetimeType)]
pub enum Role {
    Dm,
    Player,
}

#[derive(SpacetimeType)]
pub enum EntityKind {
    Mini,
    Prop,
}

#[table(accessor = game_table, public)]
pub struct GameTable {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[unique]
    pub slug: String,
    pub name: String,
    pub dm_identity: Identity,
    pub created_at: Timestamp,
}

#[table(accessor = participant, public)]
pub struct Participant {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub table_id: u64,
    #[index(btree)]
    pub identity: Identity,
    pub display_name: String,
    pub role: Role,
    pub online: bool,
}

#[table(accessor = entity, public)]
pub struct Entity {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub table_id: u64,
    pub dm_identity: Identity,
    pub kind: EntityKind,
    pub name: String,
    pub color: String,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub rot_y: f32,
    pub hidden: bool,
    pub created_by: Identity,
}

#[table(accessor = migration_state)]
pub struct MigrationState {
    #[primary_key]
    pub step_key: String,
    pub applied_at: Timestamp,
}
