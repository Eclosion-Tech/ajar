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

#[derive(SpacetimeType)]
pub struct WallInput {
    pub ax: f32,
    pub az: f32,
    pub bx: f32,
    pub bz: f32,
    pub height: f32,
    pub thickness: f32,
}

#[derive(SpacetimeType)]
pub struct LightInput {
    pub x: f32,
    pub z: f32,
    pub range: f32,
    pub intensity: f32,
    pub color_rgb: u32,
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

#[table(accessor = wall, public)]
pub struct Wall {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub table_id: u64,
    pub ax: f32,
    pub az: f32,
    pub bx: f32,
    pub bz: f32,
    pub height: f32,
    pub thickness: f32,
}

#[table(accessor = light, public)]
pub struct Light {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub table_id: u64,
    pub x: f32,
    pub z: f32,
    pub range: f32,
    pub intensity: f32,
    pub color_rgb: u32,
}

#[table(accessor = map_image, public)]
pub struct MapImage {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub table_id: u64,
    pub url: String,
    pub width: f32,
    pub height: f32,
    pub offset_x: f32,
    pub offset_z: f32,
}

#[table(accessor = prop, public)]
pub struct Prop {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub table_id: u64,
    pub dm_identity: Identity,
    pub kind: String,
    pub params: String,
    pub seed: u64,
    pub x: f32,
    pub z: f32,
    pub rot_y: f32,
    pub hidden: bool,
}

#[table(accessor = migration_state)]
pub struct MigrationState {
    #[primary_key]
    pub step_key: String,
    pub applied_at: Timestamp,
}
