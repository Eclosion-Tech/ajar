mod migrations;
mod reducers;
mod tables;

pub use tables::{EntityKind, LightInput, Role, WallInput};

use spacetimedb::{client_visibility_filter, Filter};

#[client_visibility_filter]
const ENTITY_VISIBLE: Filter = Filter::Sql("SELECT * FROM entity WHERE hidden = false");

#[client_visibility_filter]
const ENTITY_DM: Filter = Filter::Sql("SELECT * FROM entity WHERE dm_identity = :sender");
